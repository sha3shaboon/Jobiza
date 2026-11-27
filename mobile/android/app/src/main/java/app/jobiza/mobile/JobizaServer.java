package app.jobiza.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.system.Os;
import android.util.Log;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.SecureRandom;
import java.util.Iterator;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONObject;

/**
 * Runs Jobiza's server on the phone: Node.js (packaged as libnode.so) with the
 * same Next.js server as the desktop app, an embedded database, and the
 * embedding model. The WebView talks to it on 127.0.0.1 with a random port.
 */
final class JobizaServer {

    interface Listener {
        void onStatus(String text);

        void onReady(String sessionUrl);

        void onFailed(String message, String details);
    }

    private static final String TAG = "Jobiza";
    private static JobizaServer instance;

    private final Context ctx;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Process process;
    private int port;
    private String token;
    private volatile boolean ready;
    private volatile boolean starting;

    static synchronized JobizaServer get(Context ctx) {
        if (instance == null) instance = new JobizaServer(ctx.getApplicationContext());
        return instance;
    }

    private JobizaServer(Context ctx) {
        this.ctx = ctx;
    }

    File dataDir() {
        return new File(ctx.getFilesDir(), "library");
    }

    File inboxDir() {
        return new File(dataDir(), "inbox");
    }

    File logFile() {
        return new File(ctx.getFilesDir(), "logs/jobiza.log");
    }

    String baseUrl() {
        return "http://127.0.0.1:" + port;
    }

    boolean isReady() {
        return ready && alive();
    }

    String sessionUrl(String next) {
        try {
            return baseUrl() + "/api/desktop/session?token=" + token + "&next=" + URLEncoder.encode(next, "UTF-8");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Start (or reuse) the server; the listener is called on the main thread. */
    void start(Listener l) {
        if (isReady()) {
            main.post(() -> l.onReady(sessionUrl("/app")));
            return;
        }
        if (starting) return;
        starting = true;
        new Thread(
            () -> {
                try {
                    prepare(l);
                    launch();
                    waitUntilReady(l);
                    ready = true;
                    main.post(() -> l.onReady(sessionUrl("/app")));
                } catch (Exception e) {
                    Log.e(TAG, "Server failed to start", e);
                    String details = tail(logFile(), 4000);
                    main.post(() -> l.onFailed(e.getMessage() == null ? e.toString() : e.getMessage(), details));
                } finally {
                    starting = false;
                }
            },
            "jobiza-start"
        ).start();
    }

    /* ───────────── Unpacking ───────────── */

    private void prepare(Listener l) throws Exception {
        File files = ctx.getFilesDir();
        File server = new File(files, "server");
        String version = new JSONObject(readAsset("bundle.json")).getString("version");
        SharedPreferences prefs = ctx.getSharedPreferences("jobiza", Context.MODE_PRIVATE);
        boolean fresh = !new File(server, "server.js").exists();
        if (fresh || !version.equals(prefs.getString("bundleVersion", ""))) {
            status(l, fresh ? "Setting up Jobiza on this phone… (first launch only)" : "Updating Jobiza…");
            unzipAsset("server.zip", server);
            unzipAsset("models.zip", new File(files, "models"));
            prefs.edit().putString("bundleVersion", version).apply();
        }
        status(l, "Opening your library…");
    }

    private void unzipAsset(String asset, File dest) throws Exception {
        File tmp = new File(dest.getParentFile(), dest.getName() + ".new");
        deleteRecursive(tmp);
        if (!tmp.mkdirs()) throw new IOException("Couldn't create " + tmp);
        String root = tmp.getCanonicalPath() + File.separator;
        byte[] buf = new byte[1 << 16];
        String symlinks = "{}";
        try (ZipInputStream zip = new ZipInputStream(ctx.getAssets().open(asset))) {
            ZipEntry e;
            while ((e = zip.getNextEntry()) != null) {
                File out = new File(tmp, e.getName());
                // Refuse entries that would land outside the folder.
                if (!out.getCanonicalPath().startsWith(root)) throw new IOException("Bad entry " + e.getName());
                if (e.getName().equals("symlinks.json")) {
                    symlinks = new String(readAll(zip), StandardCharsets.UTF_8);
                    continue;
                }
                if (e.isDirectory()) {
                    out.mkdirs();
                    continue;
                }
                out.getParentFile().mkdirs();
                try (OutputStream os = new FileOutputStream(out)) {
                    int n;
                    while ((n = zip.read(buf)) > 0) os.write(buf, 0, n);
                }
            }
        }
        JSONObject links = new JSONObject(symlinks);
        for (Iterator<String> it = links.keys(); it.hasNext(); ) {
            String rel = it.next();
            File link = new File(tmp, rel);
            link.getParentFile().mkdirs();
            Os.symlink(links.getString(rel), link.getPath());
        }
        deleteRecursive(dest);
        if (!tmp.renameTo(dest)) throw new IOException("Couldn't move " + tmp + " into place");
    }

    /* ───────────── Process ───────────── */

    private void launch() throws Exception {
        stopLeftover();
        JSONObject secrets = SecretStore.load(ctx);
        File files = ctx.getFilesDir();
        File server = new File(files, "server");
        File nativeDir = new File(ctx.getApplicationInfo().nativeLibraryDir);
        File node = new File(nativeDir, "libnode.so");
        dataDir().mkdirs();
        inboxDir().mkdirs();
        port = freePort();
        token = randomHex(32);

        ProcessBuilder pb = new ProcessBuilder(node.getPath(), "--use-bundled-ca", "--max-old-space-size=512", new File(server, "server-entry.cjs").getPath());
        pb.directory(server);
        pb.redirectErrorStream(true);
        Map<String, String> env = pb.environment();
        env.put("LD_LIBRARY_PATH", nativeDir.getPath());
        env.put("HOME", files.getPath());
        env.put("TMPDIR", ctx.getCacheDir().getPath());
        env.put("NODE_ENV", "production");
        env.put("NEXT_TELEMETRY_DISABLED", "1");
        env.put("PORT", String.valueOf(port));
        env.put("HOSTNAME", "127.0.0.1");
        env.put("JOBIZA_DESKTOP", "1");
        env.put("JOBIZA_ONNX", "wasm");
        env.put("JOBIZA_DATA_DIR", dataDir().getPath());
        env.put("JOBIZA_PID_FILE", new File(files, "server.pid").getPath());
        env.put("JOBIZA_LAUNCH_TOKEN", token);
        env.put("JOBIZA_LOCAL_PASSWORD", secrets.getString("localPassword"));
        env.put("BETTER_AUTH_SECRET", secrets.getString("authSecret"));
        env.put("BETTER_AUTH_URL", baseUrl());
        env.put("ENCRYPTION_KEY", secrets.getString("encryptionKey"));
        env.put("UPLOAD_DIR", new File(dataDir(), "uploads").getPath());
        env.put("MODEL_CACHE_DIR", new File(files, "models").getPath());
        env.put("JOBIZA_DEVICE_NAME", deviceName());

        rotateLog();
        process = pb.start();
        Process p = process;
        new Thread(
            () -> {
                try (
                    BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8));
                    FileWriter w = new FileWriter(logFile(), true)
                ) {
                    String line;
                    while ((line = r.readLine()) != null) {
                        w.write(line);
                        w.write('\n');
                        w.flush();
                    }
                } catch (IOException ignored) {
                    // process ended
                }
                Log.i(TAG, "Server process ended");
                ready = false;
            },
            "jobiza-log"
        ).start();
    }

    private void waitUntilReady(Listener l) throws Exception {
        long deadline = System.currentTimeMillis() + 180_000; // first launch applies migrations
        while (System.currentTimeMillis() < deadline) {
            if (!alive()) throw new IOException("Jobiza's engine stopped while starting.");
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(baseUrl() + "/api/desktop/session").openConnection();
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(1000);
                c.setReadTimeout(5000);
                int code = c.getResponseCode();
                c.disconnect();
                // It refuses a request without the launch token once it's up.
                if (code == 403) {
                    Log.i(TAG, "Server ready on port " + port);
                    return;
                }
            } catch (IOException ignored) {
                // not listening yet
            }
            Thread.sleep(300);
        }
        throw new IOException("Jobiza took too long to start.");
    }

    boolean alive() {
        if (process == null) return false;
        try {
            process.exitValue();
            return false;
        } catch (IllegalThreadStateException running) {
            return true;
        }
    }

    /** Write everything to disk: Android may stop a background app without warning. */
    void flush() {
        if (!isReady()) return;
        new Thread(
            () -> {
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(baseUrl() + "/api/desktop/flush").openConnection();
                    c.setRequestMethod("POST");
                    c.setRequestProperty("x-jobiza-launch-token", token);
                    c.setConnectTimeout(2000);
                    c.setReadTimeout(10_000);
                    c.getResponseCode();
                    c.disconnect();
                } catch (IOException e) {
                    Log.w(TAG, "Flush failed", e);
                }
            },
            "jobiza-flush"
        ).start();
    }

    /** Ask the server to close its database and exit (SIGTERM), then make sure it's gone. */
    void stop() {
        ready = false;
        int pid = readPid();
        if (pid > 0) android.os.Process.sendSignal(pid, 15);
        Process p = process;
        process = null;
        if (p == null) return;
        new Thread(
            () -> {
                try {
                    for (int i = 0; i < 50 && isRunning(p); i++) Thread.sleep(100);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
                p.destroy();
            },
            "jobiza-stop"
        ).start();
    }

    private static boolean isRunning(Process p) {
        try {
            p.exitValue();
            return false;
        } catch (IllegalThreadStateException e) {
            return true;
        }
    }

    /** A server from an earlier launch must not share the database with a new one. */
    private void stopLeftover() throws InterruptedException {
        int pid = readPid();
        if (pid <= 0) return;
        File cmdline = new File("/proc/" + pid + "/cmdline");
        try {
            if (cmdline.exists() && new String(Files.readAllBytes(cmdline.toPath()), StandardCharsets.UTF_8).contains("libnode.so")) {
                Log.w(TAG, "Stopping a leftover server, pid " + pid);
                android.os.Process.sendSignal(pid, 15);
                for (int i = 0; i < 50 && cmdline.exists(); i++) Thread.sleep(100);
                if (cmdline.exists()) android.os.Process.killProcess(pid);
            }
        } catch (IOException ignored) {
            // gone already
        }
    }

    private int readPid() {
        try {
            return Integer.parseInt(new String(Files.readAllBytes(new File(ctx.getFilesDir(), "server.pid").toPath()), StandardCharsets.UTF_8).trim());
        } catch (Exception e) {
            return -1;
        }
    }

    /* ───────────── Helpers ───────────── */

    /** "Pixel 9 Pro" rather than a code name, for the paired-devices list. */
    private static String deviceName() {
        String maker = android.os.Build.MANUFACTURER == null ? "" : android.os.Build.MANUFACTURER;
        String model = android.os.Build.MODEL == null ? "Android phone" : android.os.Build.MODEL;
        String name = model.toLowerCase().startsWith(maker.toLowerCase()) ? model : maker + " " + model;
        return name.trim().isEmpty() ? "Android phone" : Character.toUpperCase(name.charAt(0)) + name.substring(1);
    }

    private void status(Listener l, String text) {
        main.post(() -> l.onStatus(text));
    }

    private static int freePort() throws IOException {
        try (ServerSocket s = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
            return s.getLocalPort();
        }
    }

    private static String randomHex(int bytes) {
        byte[] b = new byte[bytes];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    private void rotateLog() {
        File log = logFile();
        log.getParentFile().mkdirs();
        if (log.length() > 5_000_000) log.renameTo(new File(log.getPath() + ".old"));
    }

    static String tail(File f, int max) {
        try {
            byte[] all = Files.readAllBytes(f.toPath());
            int from = Math.max(0, all.length - max);
            return new String(all, from, all.length - from, StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "";
        }
    }

    private String readAsset(String name) throws IOException {
        try (InputStream in = ctx.getAssets().open(name)) {
            return new String(readAll(in), StandardCharsets.UTF_8);
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[1 << 14];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    static void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        // Don't follow symlinks into the folders they point at.
        boolean link = false;
        try {
            link = Files.isSymbolicLink(f.toPath());
        } catch (Exception ignored) {
            // treat as a regular file
        }
        if (f.isDirectory() && !link) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteRecursive(k);
        }
        f.delete();
    }
}
