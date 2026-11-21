package com.myghoulscans.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Offline reader: webtoon / page mode, auto-scroll, brightness, next/prev chapter. */
public class ReaderActivity extends Activity {
    private WebView web;
    private String curManga, mangaId, chapterUrl;
    private final Handler autoHandler = new Handler();
    private boolean auto, pageMode;
    private int brightness = 100, page = 0, pageCount = 0;
    private int autoSpeed = 1;
    private boolean eyeCare = false;
    private String prevChapter, nextChapter;
    private final Runnable autoScroll = new Runnable() {
        @Override public void run() {
            if (!auto) return;
            web.evaluateJavascript("window.scrollBy(0," + (4 * autoSpeed) + ")", null);
            syncProgress(page);
            if (pageMode && page >= pageCount - 1) { auto = false; stopAuto(); goNext(); return; }
            autoHandler.postDelayed(this, Math.max(10, 40 / autoSpeed));
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_reader);
        if (getIntent().getStringExtra("mangaId") == null) { Nav.home(this); return; }
        web = findViewById(R.id.readerWeb);
        WebSettings s = web.getSettings();
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setJavaScriptEnabled(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        web.setOnTouchListener((v, e) -> { if (auto && e.getAction() == MotionEvent.ACTION_DOWN) stopAuto(); return false; });

        loadChapter(getIntent().getStringExtra("mangaId"), getIntent().getStringExtra("chapterUrl"));

        ((Button) findViewById(R.id.readerMode)).setOnClickListener(v -> {
            pageMode = !pageMode;
            ((Button) v).setText(pageMode ? "Pages" : "Webtoon");
            web.evaluateJavascript("document.body.className='" + (pageMode ? "pages" : "") + "';"
                    + (pageMode ? "setPage(" + page + ")" : ""), null);
            if (pageMode) syncProgress(page);
        });
        findViewById(R.id.readerAuto).setOnClickListener(v -> {
            Button b = (Button) v;
            if (auto) stopAuto();
            else { auto = true; b.setText("Stop " + autoSpeed + "x"); autoHandler.post(autoScroll); }
        });
        findViewById(R.id.readerAuto).setOnLongClickListener(v -> {
            autoSpeed = (autoSpeed % 3) + 1;
            Button b = (Button) v;
            b.setText(auto ? "Stop " + autoSpeed + "x" : "Auto " + autoSpeed + "x");
            return true;
        });
        findViewById(R.id.readerBright).setOnClickListener(v -> {
            brightness = brightness == 100 ? 75 : brightness == 75 ? 50 : 100;
            ((Button) v).setText("☀ " + brightness);
            View overlay = getWindow().getDecorView();
            overlay.setAlpha(brightness / 100f);
        });
        findViewById(R.id.readerBright).setOnLongClickListener(v -> {
            eyeCare = !eyeCare;
            View ov = findViewById(R.id.eyeOverlay);
            if (ov != null) ov.setVisibility(eyeCare ? View.VISIBLE : View.GONE);
            return true;
        });
        findViewById(R.id.readerPreload).setOnClickListener(v -> preloadNext());
        findViewById(R.id.readerBack).setOnClickListener(v -> {
            Intent i = new Intent(this, DownloadsActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(i);
            finish();
        });
        findViewById(R.id.readerPrev).setOnClickListener(v -> goPrev());
        findViewById(R.id.readerNext).setOnClickListener(v -> goNext());
    }

    private void loadChapter(String manga, String chapter) {
        curManga = manga; mangaId = manga; chapterUrl = chapter;
        DownloadStore.markRead(this, manga, chapter);
        File dir = DownloadStore.chapterDir(this, manga, chapter);
        List<File> imgs = new ArrayList<>();
        File[] kids = dir.listFiles();
        if (kids != null) for (File f : kids) if (f.isFile() && f.getName().endsWith(".jpg")) imgs.add(f);
        if (imgs.isEmpty()) { Toast.makeText(this, "No saved pages", Toast.LENGTH_SHORT).show(); Nav.home(this); return; }
        Collections.sort(imgs);
        pageCount = imgs.size();
        page = 0;
        StringBuilder html = new StringBuilder("<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">")
                .append("<style>html,body{margin:0;background:#000}img{display:block;width:100%;height:auto;margin:0 auto}"
                        + "body.pages img{display:none;height:100vh;object-fit:contain}"
                        + "body.pages img.on{display:block}</style></head><body>");
        int idx = 0;
        for (File f : imgs) {
            html.append("<img data-page=\"").append(idx++).append("\" src=\"").append(Uri.fromFile(f).toString()).append("\">");
        }
        html.append("<script>function setPage(n){var a=document.querySelectorAll('img');if(!a.length)return;"
                + "page=Math.max(0,Math.min(a.length-1,n));for(var i=0;i<a.length;i++)a[i].className=(i===page?'on':'');"
                + "a[page].scrollIntoView();}var page=0;"
                + "if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){for(var i=0;i<es.length;i++){var e=es[i];if(!e.isIntersecting)continue;var n=parseInt(e.target.getAttribute('data-page'),10);if(isNaN(n))continue;setPage(n);}},"
                + "{root:null,rootMargin:'0px 0px -85% 0px'});document.querySelectorAll('img').forEach(function(im){io.observe(im);});}}"
                + "if('scroll' in window){var st=function(){var a=document.querySelectorAll('img');var cur=0;for(var i=0;i<a.length;i++){var r=a[i].getBoundingClientRect();if(r.top<window.innerHeight*0.7)cur=i;}if(cur!==page)setPage(cur);};addEventListener('scroll',function(){clearTimeout(st._t);st._t=setTimeout(st,120);},false);st();}</script></body></html>");
        File pageFile = new File(dir, "reader.html");
        try { DownloadStore.write(pageFile, html.toString()); }
        catch (Exception e) { Toast.makeText(this, "Cannot open chapter", Toast.LENGTH_SHORT).show(); Nav.home(this); return; }
        web.loadUrl(Uri.fromFile(pageFile).toString());

        prevChapter = null; nextChapter = null;
        computeNav();

        if (ApiClient.isSignedIn()) syncProgress(0);
    }

    private void computeNav() {
        nextChapter = null; prevChapter = null;
        try {
            JSONArray titles = DownloadStore.listTitles(this);
            for (int i = 0; i < titles.length(); i++) {
                try {
                    JSONObject t = titles.getJSONObject(i);
                    if (!curManga.equals(t.optString("mangaId", ""))) continue;
                    JSONArray cs = t.optJSONArray("chapters");
                    if (cs == null) continue;
                    double curN = number(chapterUrl);
                    for (int j = 0; j < cs.length(); j++) {
                        JSONObject c = cs.getJSONObject(j);
                        double n = number(c.optString("label", ""));
                        if (prevChapter == null && n < curN) prevChapter = c.optString("chapterUrl", "");
                        if (nextChapter == null && n > curN) nextChapter = c.optString("chapterUrl", "");
                    }
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
    }

    private void goPrev() {
        if (prevChapter == null || prevChapter.isEmpty()) { Toast.makeText(this, "No previous chapter", Toast.LENGTH_SHORT).show(); return; }
        loadChapter(curManga, prevChapter);
    }

    private void goNext() {
        if (nextChapter == null || nextChapter.isEmpty()) { Toast.makeText(this, "No next chapter", Toast.LENGTH_SHORT).show(); return; }
        loadChapter(curManga, nextChapter);
    }

    private void stopAuto() {
        auto = false;
        autoHandler.removeCallbacks(autoScroll);
        Button b = findViewById(R.id.readerAuto);
        if (b != null) b.setText("Auto " + autoSpeed + "x");
    }

    /** Push reading progress + read-count to the website so the cloud stays in sync. */
    private void syncProgress(final int pg) {
        if (!ApiClient.isSignedIn()) return;
        final String manga = mangaId, chapter = chapterUrl;
        final long now = System.currentTimeMillis();
        if (now - lastSyncAt < 4000) return;
        lastSyncAt = now;
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("chapterId", chapter);
                body.put("page", Math.max(0, pg));
                body.put("chapterLabel", "Ch. " + number(chapter));
                ApiClient.post("/progress/" + ApiClient.q(manga), body.toString());
            } catch (Exception ignored) {}
            try {
                JSONObject r = new JSONObject();
                r.put("mangaId", manga);
                r.put("chapterId", chapter);
                ApiClient.post("/reads", r.toString());
            } catch (Exception ignored) {}
        }).start();
    }

    private long lastSyncAt = 0;

    private void preloadNext() {
        if (nextChapter == null || nextChapter.isEmpty()) { Toast.makeText(this, "No next chapter to preload", Toast.LENGTH_SHORT).show(); return; }
        if (DownloadStore.chapterMeta(this, mangaId, nextChapter).exists()) {
            Toast.makeText(this, "Next chapter already downloaded", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            JSONObject p = new JSONObject();
            p.put("mangaId", mangaId);
            p.put("title", "Preload");
            p.put("coverUrl", "");
            p.put("token", ApiClient.token());
            JSONArray list = new JSONArray();
            JSONObject c = new JSONObject();
            c.put("url", nextChapter); c.put("num", ""); c.put("label", "Ch. " + number(nextChapter));
            list.put(c);
            p.put("chapters", list);
            Intent i = new Intent(this, DownloadService.class);
            i.putExtra("payload", p.toString());
            startService(i);
            Toast.makeText(this, "Preloading next chapter", Toast.LENGTH_SHORT).show();
        } catch (Exception e) { Toast.makeText(this, "Could not preload", Toast.LENGTH_SHORT).show(); }
    }

    private static double chapterNumber(String s) { return number(s); }

    private static double number(String s) {
        if (s == null) return 0;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(\\d+(?:\\.\\d+)?)").matcher(s);
        return m.find() ? Double.parseDouble(m.group(1)) : 0;
    }

    @Override protected void onDestroy() { stopAuto(); super.onDestroy(); }
    @Override public void onBackPressed() {
        Intent i = new Intent(this, DownloadsActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(i);
        finish();
    }
}
