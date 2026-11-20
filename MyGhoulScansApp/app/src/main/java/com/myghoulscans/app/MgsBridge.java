package com.myghoulscans.app;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

/** JavaScript bridge exposed to the website as window.MGSAndroid. */
public class MgsBridge {
    private final Context ctx;

    public MgsBridge(Context ctx) { this.ctx = ctx.getApplicationContext(); }

    @JavascriptInterface public String ping() { return "1"; }
    @JavascriptInterface public boolean isApp() { return true; }

    private void start(JSONObject payload) {
        Intent i = new Intent(ctx, DownloadService.class);
        i.putExtra("payload", payload.toString());
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    /** {mangaId,title,coverUrl,token,chapters:[{url,num,label}]} */
    @JavascriptInterface
    public void downloadMany(String json) {
        try { start(new JSONObject(json)); } catch (Exception ignored) {}
    }

    /** {mangaId,title,coverUrl,token,chapters:[{url,num,label}]} with one chapter. */
    @JavascriptInterface
    public void downloadChapter(String json) {
        try { start(new JSONObject(json)); } catch (Exception ignored) {}
    }

    @JavascriptInterface
    public String listDownloads() { return DownloadStore.listTitles(ctx).toString(); }

    @JavascriptInterface
    public boolean deleteChapter(String mangaId, String chapterUrl) {
        return DownloadStore.deleteChapter(ctx, mangaId, chapterUrl);
    }

    @JavascriptInterface
    public boolean deleteTitle(String mangaId) { return DownloadStore.deleteTitle(ctx, mangaId); }

    @JavascriptInterface
    public void openDownloads() {
        Intent i = new Intent(ctx, DownloadsActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
    }

    @JavascriptInterface
    public void openChapter(String mangaId, String chapterUrl) {
        Intent i = new Intent(ctx, ReaderActivity.class);
        i.putExtra("mangaId", mangaId);
        i.putExtra("chapterUrl", chapterUrl);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
    }

    @JavascriptInterface
    public String storageInfo() {
        long used = DownloadStore.size(DownloadStore.root(ctx));
        JSONObject o = new JSONObject();
        try { o.put("bytes", used); o.put("readable", DownloadStore.readable(used)); } catch (Exception ignored) {}
        return o.toString();
    }
}
