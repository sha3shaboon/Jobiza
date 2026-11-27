package app.jobiza.mobile;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInstaller;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Updates from this repository's GitHub releases: checks for a newer version,
 * downloads the signed phone APK, checks it against the release's SHA256SUMS.txt,
 * and hands it to Android's package installer (Android asks you to confirm).
 * Android also checks the new APK is signed with the same key as this app.
 */
final class Updater {

    interface Listener {
        void onState(JSONObject state);
    }

    private static final String TAG = "Jobiza";
    private static final String LATEST = "https://api.github.com/repos/sha3shaboon/Jobiza/releases/latest";
    private static final long CHECK_EVERY_MS = 6 * 60 * 60_000L;
    static final String ACTION_INSTALL_RESULT = "app.jobiza.mobile.INSTALL_RESULT";

    private static Updater instance;

    private final Context ctx;
    private final SharedPreferences prefs;
    private Listener listener;
    private volatile boolean busy;

    // What the Settings page shows; same shape as the desktop app's.
    private String status = "idle"; // idle | checking | latest | available | downloading | ready | error | unsupported | permission
    private String latest;
    private String notes;
    private String error;
    private Integer progress;
    private String checkedAt;
    private String apkUrl;
    private String apkSha256;
    private File apkFile;

    static synchronized Updater get(Context ctx) {
        if (instance == null) instance = new Updater(ctx.getApplicationContext());
        return instance;
    }

    private Updater(Context ctx) {
        this.ctx = ctx;
        this.prefs = ctx.getSharedPreferences("jobiza", Context.MODE_PRIVATE);
        if (!canUpdateItself()) {
            status = "unsupported";
            error = "This test build can't update itself. Install the latest version from GitHub once, and updates are automatic after that.";
        }
    }

    void setListener(Listener l) {
        listener = l;
    }

    /** Debug builds are signed with a throwaway key, so Android would refuse their updates. */
    private boolean canUpdateItself() {
        return (ctx.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) == 0 && Build.SUPPORTED_ABIS.length > 0 && Build.SUPPORTED_ABIS[0].equals("arm64-v8a");
    }

    String version() {
        try {
            return ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "0";
        }
    }

    boolean autoUpdate() {
        return prefs.getBoolean("autoUpdate", true);
    }

    synchronized JSONObject state() {
        JSONObject s = new JSONObject();
        try {
            s.put("version", version());
            s.put("auto", autoUpdate());
            s.put("status", status);
            s.put("latest", latest == null ? JSONObject.NULL : latest);
            s.put("progress", progress == null ? JSONObject.NULL : progress);
            s.put("notes", notes == null ? JSONObject.NULL : notes);
            s.put("error", error == null ? JSONObject.NULL : error);
            s.put("checkedAt", checkedAt == null ? JSONObject.NULL : checkedAt);
        } catch (Exception ignored) {
            // all fields are plain values
        }
        return s;
    }

    private void changed() {
        if (listener != null) listener.onState(state());
    }

    void setAuto(boolean on) {
        prefs.edit().putBoolean("autoUpdate", on).apply();
        changed();
        if (on) maybeCheck();
    }

    /** At start-up and when the app comes back: check if it's been a while, and download on Wi-Fi. */
    void maybeCheck() {
        if (!autoUpdate() || "unsupported".equals(status) || busy) return;
        if (System.currentTimeMillis() - prefs.getLong("lastCheck", 0) < CHECK_EVERY_MS && !"available".equals(status)) return;
        check(true);
    }

    void check(boolean autoDownload) {
        if ("unsupported".equals(status) || busy || "ready".equals(status)) {
            changed();
            return;
        }
        busy = true;
        status = "checking";
        error = null;
        changed();
        new Thread(
            () -> {
                try {
                    JSONObject release = new JSONObject(get(LATEST));
                    String tag = release.getString("tag_name").replaceFirst("^v", "");
                    prefs.edit().putLong("lastCheck", System.currentTimeMillis()).apply();
                    checkedAt = Instant.now().toString();
                    if (compare(tag, version()) <= 0) {
                        status = "latest";
                        latest = version();
                        return;
                    }
                    JSONArray assets = release.getJSONArray("assets");
                    String apkName = null;
                    String sumsUrl = null;
                    for (int i = 0; i < assets.length(); i++) {
                        JSONObject a = assets.getJSONObject(i);
                        String name = a.getString("name");
                        if (name.matches("Jobiza-.*-android-arm64\\.apk")) {
                            apkName = name;
                            apkUrl = a.getString("browser_download_url");
                        }
                        if (name.equals("SHA256SUMS.txt")) sumsUrl = a.getString("browser_download_url");
                    }
                    if (apkName == null || sumsUrl == null) throw new IOException("The release has no signed phone app yet.");
                    apkSha256 = null;
                    for (String line : get(sumsUrl).split("\n")) {
                        String[] parts = line.trim().split("\\s+");
                        if (parts.length == 2 && parts[1].replaceFirst("^\\*", "").equals(apkName)) apkSha256 = parts[0].toLowerCase();
                    }
                    if (apkSha256 == null) throw new IOException("The release has no checksum for the phone app.");
                    latest = tag;
                    String body = release.optString("body", "");
                    notes = body.length() > 4000 ? body.substring(0, 4000) : body;
                    status = "available";
                } catch (Exception e) {
                    Log.w(TAG, "Update check failed", e);
                    status = "error";
                    error = friendly(e);
                } finally {
                    busy = false;
                    changed();
                }
                if ("available".equals(status) && autoDownload && autoUpdate() && !metered()) download();
            },
            "jobiza-update-check"
        ).start();
    }

    void download() {
        if (!"available".equals(status) && !"error".equals(status)) {
            changed();
            return;
        }
        if (apkUrl == null || busy) return;
        busy = true;
        status = "downloading";
        progress = 0;
        changed();
        new Thread(
            () -> {
                File dir = new File(ctx.getCacheDir(), "updates");
                dir.mkdirs();
                File out = new File(dir, "Jobiza-" + latest + ".apk");
                try {
                    HttpURLConnection c = open(apkUrl);
                    long total = c.getContentLengthLong();
                    MessageDigest sha = MessageDigest.getInstance("SHA-256");
                    try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(out)) {
                        byte[] buf = new byte[1 << 16];
                        long done = 0;
                        int n;
                        int last = -1;
                        while ((n = in.read(buf)) > 0) {
                            os.write(buf, 0, n);
                            sha.update(buf, 0, n);
                            done += n;
                            int pct = total > 0 ? (int) (done * 100 / total) : 0;
                            if (pct != last) {
                                last = pct;
                                progress = pct;
                                changed();
                            }
                        }
                    }
                    if (!hex(sha.digest()).equals(apkSha256)) {
                        out.delete();
                        throw new IOException("The download didn't match its checksum.");
                    }
                    apkFile = out;
                    status = "ready";
                    progress = 100;
                } catch (Exception e) {
                    Log.w(TAG, "Update download failed", e);
                    out.delete();
                    status = "error";
                    error = e instanceof IOException && e.getMessage() != null && e.getMessage().contains("checksum") ? "The download was damaged. Try again." : friendly(e);
                    progress = null;
                } finally {
                    busy = false;
                    changed();
                }
            },
            "jobiza-update-download"
        ).start();
    }

    /** Hand the APK to Android's installer. The first time, Android asks to allow installs from Jobiza. */
    void install(Context activity, Runnable beforeInstall) {
        if (!"ready".equals(status) && !"permission".equals(status)) return;
        if (apkFile == null || !apkFile.exists()) {
            status = "available";
            changed();
            download();
            return;
        }
        if (!ctx.getPackageManager().canRequestPackageInstalls()) {
            status = "permission";
            error = "Allow Jobiza to install updates, then come back and tap Install again.";
            changed();
            Intent allow = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(allow);
            return;
        }
        status = "ready";
        error = null;
        changed();
        beforeInstall.run();
        new Thread(
            () -> {
                try {
                    PackageInstaller pi = ctx.getPackageManager().getPackageInstaller();
                    PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                    params.setAppPackageName(ctx.getPackageName());
                    if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
                    int id = pi.createSession(params);
                    try (PackageInstaller.Session session = pi.openSession(id)) {
                        try (OutputStream os = session.openWrite("jobiza.apk", 0, apkFile.length()); InputStream in = new FileInputStream(apkFile)) {
                            byte[] buf = new byte[1 << 16];
                            int n;
                            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                            session.fsync(os);
                        }
                        Intent result = new Intent(ctx, InstallResultReceiver.class).setAction(ACTION_INSTALL_RESULT);
                        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                        session.commit(PendingIntent.getBroadcast(ctx, id, result, flags).getIntentSender());
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Update install failed", e);
                    status = "error";
                    error = "Android couldn't install the update. Try again.";
                    changed();
                }
            },
            "jobiza-update-install"
        ).start();
    }

    /** Called with the installer's answer (see InstallResultReceiver). */
    void installResult(int code, String message) {
        if (code == PackageInstaller.STATUS_SUCCESS) return; // the app restarts as the new version
        if (code == PackageInstaller.STATUS_FAILURE_ABORTED) {
            status = "ready";
            error = null;
        } else {
            status = "error";
            error = code == PackageInstaller.STATUS_FAILURE_CONFLICT || code == PackageInstaller.STATUS_FAILURE_INCOMPATIBLE
                ? "This update is signed differently from the installed app. Uninstall Jobiza and install the new version from GitHub (sync with a computer first to keep your library)."
                : "Android couldn't install the update" + (message == null ? "." : ": " + message);
        }
        changed();
    }

    /* ───────────── Helpers ───────────── */

    private boolean metered() {
        ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
        return cm != null && cm.isActiveNetworkMetered();
    }

    private static HttpURLConnection open(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestProperty("User-Agent", "Jobiza-Android");
        c.setRequestProperty("Accept", url.contains("api.github.com") ? "application/vnd.github+json" : "*/*");
        c.setConnectTimeout(15_000);
        c.setReadTimeout(60_000);
        c.setInstanceFollowRedirects(true);
        int code = c.getResponseCode();
        if (code == 404) throw new IOException("No releases yet");
        if (code == 403 || code == 429) throw new IOException("rate limit");
        if (code != 200) throw new IOException("HTTP " + code);
        return c;
    }

    private static String get(String url) throws IOException {
        HttpURLConnection c = open(url);
        try (InputStream in = c.getInputStream()) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[1 << 14];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static String friendly(Exception e) {
        String m = String.valueOf(e.getMessage());
        if (m.contains("rate limit")) return "GitHub is limiting requests right now. Jobiza will try again later.";
        if (m.contains("No releases")) return "No released version was found on GitHub yet.";
        if (e instanceof java.net.UnknownHostException || e instanceof java.net.SocketTimeoutException || e instanceof java.net.ConnectException) {
            return "Couldn't reach GitHub. Check your internet connection.";
        }
        if (m.contains("signed phone app") || m.contains("checksum for")) return m;
        return "Couldn't check for updates. Jobiza will try again later.";
    }

    /** 0.2.10 > 0.2.9; ignores anything after a dash. */
    static int compare(String a, String b) {
        String[] x = a.split("-")[0].split("\\.");
        String[] y = b.split("-")[0].split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? parse(x[i]) : 0;
            int q = i < y.length ? parse(y[i]) : 0;
            if (p != q) return Integer.compare(p, q);
        }
        return 0;
    }

    private static int parse(String s) {
        try {
            return Integer.parseInt(s.replaceAll("\\D", ""));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }
}
