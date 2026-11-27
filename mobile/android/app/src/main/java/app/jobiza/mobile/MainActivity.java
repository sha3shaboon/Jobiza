package app.jobiza.mobile;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * Jobiza on Android. The bundled page (www/index.html) shows progress while the
 * on-phone server starts; then the WebView opens the library from 127.0.0.1.
 */
public class MainActivity extends BridgeActivity implements JobizaServer.Listener {

    private static final String TAG = "Jobiza";
    private static final Pattern LINK = Pattern.compile("(https?://\\S+|\\b10\\.\\d{4,9}/\\S+)", Pattern.CASE_INSENSITIVE);

    private JobizaServer server;
    private String lastStatus = "Starting…";
    private boolean appLoaded;
    private boolean openLibraryWhenReady;
    private boolean clearHistoryOnLoad;
    private WifiManager.MulticastLock discovery;
    private Updater updater;
    /** The page in the WebView, so only Jobiza's own pages can use the update bridge. */
    private volatile String currentUrl = "";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        server = JobizaServer.get(this);
        WebView web = bridge.getWebView();
        updater = Updater.get(this);
        updater.setListener(state -> runOnUiThread(() -> bridge.getWebView().evaluateJavascript("window.__jobizaUpdate && window.__jobizaUpdate(" + state + ")", null)));
        web.addJavascriptInterface(new UpdateBridge(), "JobizaAndroid");

        // There's no sign-in on the phone: if the app ever lands on it, sign in again.
        bridge.setWebViewClient(
            new BridgeWebViewClient(bridge) {
                @Override
                public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                    super.doUpdateVisitedHistory(view, url, isReload);
                    currentUrl = url;
                    if (server.isReady() && url.startsWith(server.baseUrl()) && (url.contains("/sign-in") || url.contains("/sign-up"))) {
                        view.loadUrl(server.sessionUrl("/app"));
                    }
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    currentUrl = url;
                    if (!appLoaded) sendStatus();
                    // Forget the start-up page and sign-in redirect, so Back never returns to them.
                    if (clearHistoryOnLoad && url.startsWith(server.baseUrl() + "/app")) {
                        clearHistoryOnLoad = false;
                        view.clearHistory();
                    }
                }
            }
        );

        web.setDownloadListener((url, userAgent, disposition, mime, length) -> download(url, disposition, mime));

        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        WebView w = bridge.getWebView();
                        if (appLoaded && w.canGoBack()) w.goBack();
                        else moveTaskToBack(true); // keep the library open in the background
                    }
                }
            );

        handleShare(getIntent());
        server.start(this);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleShare(intent);
    }

    /** Wi-Fi drivers drop broadcast packets unless an app asks for them: needed to find paired devices. */
    @Override
    public void onResume() {
        super.onResume();
        try {
            if (discovery == null) {
                WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
                discovery = wifi.createMulticastLock("jobiza-sync");
                discovery.setReferenceCounted(false);
            }
            discovery.acquire();
        } catch (Exception e) {
            Log.w(TAG, "Device discovery unavailable", e);
        }
        if (server.isReady()) updater.maybeCheck();
    }

    @Override
    public void onPause() {
        if (discovery != null && discovery.isHeld()) discovery.release();
        super.onPause();
    }

    @Override
    public void onStop() {
        super.onStop();
        server.flush();
    }

    @Override
    public void onDestroy() {
        if (isFinishing()) server.stop();
        super.onDestroy();
    }

    /* ───────────── Server events ───────────── */

    @Override
    public void onStatus(String text) {
        lastStatus = text;
        sendStatus();
    }

    @Override
    public void onReady(String sessionUrl) {
        updater.maybeCheck();
        appLoaded = true;
        clearHistoryOnLoad = true;
        String next = openLibraryWhenReady ? "/app/library" : "/app";
        openLibraryWhenReady = false;
        bridge.getWebView().loadUrl(server.sessionUrl(next));
    }

    @Override
    public void onFailed(String message, String details) {
        String js = "window.jobizaFailed && jobizaFailed(" + JSONObject.quote(message) + "," + JSONObject.quote(details) + ")";
        bridge.getWebView().evaluateJavascript(js, null);
    }

    private void sendStatus() {
        bridge.getWebView().evaluateJavascript("window.jobizaStatus && jobizaStatus(" + JSONObject.quote(lastStatus) + ")", null);
    }

    /* ───────────── Updates ───────────── */

    /** window.JobizaAndroid for Settings → Updates. Calls arrive on a background thread. */
    private class UpdateBridge {

        private boolean allowed() {
            return server.isReady() && currentUrl.startsWith(server.baseUrl() + "/");
        }

        @JavascriptInterface
        public String getUpdateState() {
            return allowed() ? updater.state().toString() : "null";
        }

        @JavascriptInterface
        public void setAutoUpdate(boolean on) {
            if (allowed()) updater.setAuto(on);
        }

        @JavascriptInterface
        public void checkForUpdate() {
            if (allowed()) updater.check(false);
        }

        @JavascriptInterface
        public void downloadUpdate() {
            if (allowed()) updater.download();
        }

        @JavascriptInterface
        public void installUpdate() {
            if (allowed()) runOnUiThread(() -> updater.install(MainActivity.this, server::flush));
        }
    }

    /* ───────────── Share to Jobiza ───────────── */

    /** PDFs and links shared from other apps go to the server's inbox folder. */
    private void handleShare(Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        List<Uri> files = new ArrayList<>();
        String text = null;
        if (Intent.ACTION_SEND.equals(action)) {
            Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (stream != null) files.add(stream);
            else text = intent.getStringExtra(Intent.EXTRA_TEXT);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) files.addAll(many);
        } else if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            files.add(intent.getData());
        } else {
            return;
        }
        intent.setAction(null); // handle once, even if the activity is recreated
        String link = text == null ? null : firstLink(text);
        if (files.isEmpty() && link == null) {
            Toast.makeText(this, "Share a PDF, a link or a DOI to add it to Jobiza.", Toast.LENGTH_LONG).show();
            return;
        }
        final String finalLink = link;
        new Thread(
            () -> {
                int added = 0;
                File inbox = server.inboxDir();
                inbox.mkdirs();
                for (Uri uri : files) if (copyToInbox(uri, inbox)) added++;
                if (finalLink != null && writeInbox(inbox, System.currentTimeMillis() + ".link", finalLink.getBytes(StandardCharsets.UTF_8))) added++;
                int n = added;
                runOnUiThread(() -> {
                    Toast.makeText(this, n > 0 ? "Adding to your library…" : "Couldn't read what was shared.", Toast.LENGTH_SHORT).show();
                    if (n == 0) return;
                    if (server.isReady()) bridge.getWebView().loadUrl(server.baseUrl() + "/app/library");
                    else openLibraryWhenReady = true;
                });
            },
            "jobiza-share"
        ).start();
    }

    private static String firstLink(String text) {
        Matcher m = LINK.matcher(text);
        return m.find() ? m.group(1).replaceAll("[).,;]+$", "") : null;
    }

    private boolean copyToInbox(Uri uri, File inbox) {
        ContentResolver cr = getContentResolver();
        String name = displayName(uri);
        String mime = cr.getType(uri);
        if (!name.toLowerCase().endsWith(".pdf")) {
            if (mime != null && !mime.equals("application/pdf")) return false;
            name = name + ".pdf";
        }
        try (InputStream in = cr.openInputStream(uri)) {
            if (in == null) return false;
            return writeInbox(inbox, name, in);
        } catch (IOException | SecurityException e) {
            Log.w(TAG, "Couldn't read shared file", e);
            return false;
        }
    }

    private String displayName(Uri uri) {
        String name = null;
        try (Cursor c = getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Exception ignored) {
            // fall back below
        }
        if (name == null) name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "shared";
        return name.replaceAll("[^\\w .()-]", "_");
    }

    /** Written under a dot-name first, so the server never reads a half-written file. */
    private static boolean writeInbox(File inbox, String name, InputStream in) throws IOException {
        File tmp = new File(inbox, "." + System.nanoTime());
        try (OutputStream out = new FileOutputStream(tmp)) {
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        File dest = new File(inbox, System.currentTimeMillis() + "-" + name);
        return tmp.renameTo(dest);
    }

    private static boolean writeInbox(File inbox, String name, byte[] data) {
        try {
            return writeInbox(inbox, name, new java.io.ByteArrayInputStream(data));
        } catch (IOException e) {
            return false;
        }
    }

    /* ───────────── Exports ───────────── */

    /** WebViews don't download on their own: fetch the export with the session cookie and save it to Downloads/Jobiza. */
    private void download(String url, String disposition, String mime) {
        String name = URLUtil.guessFileName(url, disposition, mime);
        Toast.makeText(this, "Exporting " + name + "…", Toast.LENGTH_SHORT).show();
        String cookie = CookieManager.getInstance().getCookie(url);
        new Thread(
            () -> {
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    if (cookie != null) c.setRequestProperty("Cookie", cookie);
                    if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
                    String type = c.getContentType() != null ? c.getContentType().split(";")[0] : mime;
                    Uri saved;
                    try (InputStream in = c.getInputStream()) {
                        saved = saveDownload(name, type, in);
                    }
                    runOnUiThread(() -> {
                        Toast.makeText(this, "Saved to Downloads/Jobiza", Toast.LENGTH_SHORT).show();
                        Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(saved, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        try {
                            startActivity(Intent.createChooser(view, "Open " + name));
                        } catch (Exception ignored) {
                            // no app can open it; it's still in Downloads
                        }
                    });
                } catch (IOException e) {
                    Log.w(TAG, "Export failed", e);
                    runOnUiThread(() -> Toast.makeText(this, "Couldn't save the export.", Toast.LENGTH_LONG).show());
                }
            },
            "jobiza-download"
        ).start();
    }

    private Uri saveDownload(String name, String type, InputStream in) throws IOException {
        byte[] buf = new byte[1 << 16];
        int n;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, type);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Jobiza");
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IOException("No Downloads folder");
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException("Can't write to Downloads");
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            return uri;
        }
        // Android 8 and 9: the app's own Downloads folder needs no permission.
        File dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Jobiza");
        dir.mkdirs();
        File file = new File(dir, name);
        try (OutputStream out = new FileOutputStream(file)) {
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        return FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", file);
    }
}
