package com.myghoulscans.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/** Downloads chapter images from the site's worker API into local storage. */
public class DownloadService extends Service {
    private static final int NOTIF_ID = 1001;
    private static final String CHANNEL = "mgs_downloads";

    /** Live state for the Downloads screen monitor. */
    public static volatile String curTitle = "", curChapter = "";
    public static volatile int curProgress = -1;
    public static volatile long curSpeed = 0;

    @Override
    public void onCreate() { super.onCreate(); makeChannel(); }

    private void makeChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Comic download progress");
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification notification(String title, String text, int progress) {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) b = new Notification.Builder(this, CHANNEL);
        else b = new Notification.Builder(this);
        b.setContentTitle(title).setContentText(text).setSmallIcon(android.R.drawable.stat_sys_download)
         .setOngoing(progress < 100).setProgress(100, Math.max(0, Math.min(100, progress)), progress >= 100);
        return b.build();
    }

    private void show(String title, String text, int progress) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, notification(title, text, progress));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String payload = intent != null ? intent.getStringExtra("payload") : null;
        Notification start = notification("Downloading", "Preparing…", 0);
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIF_ID, start, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(NOTIF_ID, start);
        if (payload == null) { stopSelf(); return START_NOT_STICKY; }
        final String data = payload;
        new Thread(() -> {
            try { run(data); }
            catch (Exception e) { show("Download failed", String.valueOf(e.getMessage()), 0); }
            finally { stopSelf(); }
        }, "mgs-download").start();
        return START_NOT_STICKY;
    }

    private static String get(String url, String token) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(30000);
        c.setRequestProperty("User-Agent", "Mozilla/5.0 MyGhoulScans/1.0 (Android)");
        c.setRequestProperty("Accept", "application/json,text/html,*/*");
        c.setRequestProperty("Referer", "https://ghoulforlife.github.io/");
        if (token != null && !token.isEmpty()) c.setRequestProperty("Authorization", "Bearer " + token);
        int code = c.getResponseCode();
        if (code < 200 || code >= 300) { c.disconnect(); throw new Exception("HTTP " + code); }
        InputStream in = c.getInputStream();
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192]; int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        in.close(); c.disconnect();
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private long saveImage(String url, File dest) throws Exception {
        if (url.startsWith("/")) {
            String u = url.startsWith("/api/") ? url.substring(4) : url;
            url = DownloadStore.WORKER + u;
        }
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", "Mozilla/5.0 MyGhoulScans/1.0 (Android)");
        c.setRequestProperty("Referer", "https://ghoulforlife.github.io/");
        int code = c.getResponseCode();
        if (code < 200 || code >= 300) { c.disconnect(); throw new Exception("Image HTTP " + code); }
        InputStream in = c.getInputStream();
        FileOutputStream out = new FileOutputStream(dest);
        byte[] buf = new byte[8192]; int n; long total = 0;
        while ((n = in.read(buf)) != -1) { out.write(buf, 0, n); total += n; }
        out.close(); in.close(); c.disconnect();
        return total;
    }

    /** Parallel page fetch (4 workers) — returns bytes downloaded; retries a failed chapter once. */
    private long downloadPages(JSONArray pages, File dir) throws Exception {
        for (int attempt = 0; attempt < 2; attempt++) {
            java.util.concurrent.atomic.AtomicLong bytes = new java.util.concurrent.atomic.AtomicLong();
            java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(4);
            List<java.util.concurrent.Future<?>> fs = new ArrayList<>();
            final int count = pages.length();
            for (int j = 0; j < count; j++) {
                final int idx = j;
                final Object item = pages.get(j);
                fs.add(pool.submit(() -> {
                    String u = item instanceof String ? (String) item : ((JSONObject) item).optString("url", "");
                    if (u.isEmpty()) return 0L;
                    try { return saveImage(u, new File(dir, String.format("%04d.jpg", idx + 1))); }
                    catch (Exception e) { return 0L; }
                }));
            }
            pool.shutdown();
            int saved = 0;
            for (java.util.concurrent.Future<?> f : fs) {
                try {
                    Long b = (Long) f.get();
                    long v = b == null ? 0L : b;
                    if (v > 0) { saved++; bytes.addAndGet(v); }
                } catch (Exception ignored) {}
            }
            if (saved >= count) return bytes.get();
            // incomplete — wipe and retry once (corrupt-file recovery)
            File[] kids = dir.listFiles();
            if (kids != null) for (File k : kids) k.delete();
        }
        return 0L;
    }

    private static double chapterNum(JSONObject c) {
        try { return Double.parseDouble(c.optString("num", "")); }
        catch (Exception e) { return 0; }
    }

    private void run(String payload) throws Exception {
        JSONObject p = new JSONObject(payload);
        String mangaId = p.optString("mangaId", "");
        String title = p.optString("title", "Untitled");
        String token = p.optString("token", "");
        if (mangaId.isEmpty()) throw new Exception("Missing title id");

        // Server-side sign-in check — guests cannot download.
        try {
            JSONObject me = new JSONObject(get(DownloadStore.WORKER + "/auth/me", token));
            if (!me.has("user")) throw new Exception("Sign in to download");
        } catch (Exception e) {
            show("Sign in required", "Log in on the website to download comics.", 0);
            throw new Exception("Sign in required");
        }

        // Wi-Fi-only rule (opt-in setting).
        if (getSharedPreferences("mgs", MODE_PRIVATE).getBoolean("wifi_only", false)) {
            android.net.ConnectivityManager cm = (android.net.ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            boolean wifi = cm != null && cm.getActiveNetworkInfo() != null
                    && cm.getActiveNetworkInfo().getType() == android.net.ConnectivityManager.TYPE_WIFI;
            if (!wifi) {
                show("Wi-Fi only", "Connect to Wi-Fi to download (or turn off Wi-Fi only in More).", 0);
                curProgress = -1;
                curChapter = "";
                return;
            }
        }

        JSONObject titleMeta = new JSONObject();
        titleMeta.put("mangaId", mangaId);
        titleMeta.put("title", title);
        titleMeta.put("coverUrl", p.optString("coverUrl", ""));
        DownloadStore.write(DownloadStore.titleMeta(this, mangaId), titleMeta.toString());
        String cover = p.optString("coverUrl", "");
        if (!cover.isEmpty()) {
            try { saveImage(cover, new File(DownloadStore.titleDir(this, mangaId), "cover.jpg")); }
            catch (Exception ignored) {}
        }

        JSONArray chaptersIn = p.optJSONArray("chapters");
        if (chaptersIn == null || chaptersIn.length() == 0) throw new Exception("No chapters selected");
        List<JSONObject> chapters = new ArrayList<>();
        for (int i = 0; i < chaptersIn.length(); i++) chapters.add(chaptersIn.getJSONObject(i));
        Collections.sort(chapters, (a, b) -> Double.compare(chapterNum(a), chapterNum(b)));
        int total = chapters.size();
        curTitle = title;
        curProgress = 0;
        for (int i = 0; i < total; i++) {
            JSONObject ch = chapters.get(i);
            String curl = ch.optString("url", "");
            if (curl.isEmpty()) continue;
            String label = ch.optString("label", "Ch. " + ch.optString("num", "?"));
            curChapter = label;
            curProgress = (i * 100) / total;
            show("Downloading " + title, label + " (" + (i + 1) + "/" + total + ")", curProgress);

            String pagesJson = get(DownloadStore.WORKER + "/comick/pages?url=" + URLEncoder.encode(curl, "UTF-8"), null);
            JSONArray pages = new JSONObject(pagesJson).optJSONArray("data");
            if (pages == null || pages.length() == 0) continue;

            File dir = DownloadStore.chapterDir(this, mangaId, curl);
            long t0 = System.currentTimeMillis();
            long bytes = downloadPages(pages, dir);
            long dt = Math.max(1, System.currentTimeMillis() - t0);
            curSpeed = bytes * 1000 / dt;

            JSONObject cm = new JSONObject();
            cm.put("mangaId", mangaId);
            cm.put("chapterUrl", curl);
            cm.put("label", label);
            cm.put("pages", pages.length());
            cm.put("bytes", bytes);
            cm.put("time", System.currentTimeMillis());
            DownloadStore.write(DownloadStore.chapterMeta(this, mangaId, curl), cm.toString());
        }
        curProgress = 100;
        curSpeed = 0;
        show("Downloads complete", title + " · " + total + " chapter(s)", 100);
        curProgress = -1;
        curChapter = "";
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
