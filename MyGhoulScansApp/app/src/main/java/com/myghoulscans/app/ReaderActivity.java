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
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
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
    private String curManga, mangaId, chapterUrl, returnTitle, returnCover;
    private JSONArray allChapters;
    private int chapterTotal = 0, chapterPos = -1;
    private final Handler autoHandler = new Handler();
    private boolean auto, pageMode;
    private int brightness = 100, page = 0, pageCount = 0;
    private int autoSpeed = 1;
    private boolean eyeCare = false;
    private String prevChapter, nextChapter;
    private TextView chapterPill;
    private final Handler pillHandler = new Handler();
    private final Runnable hidePill = () -> { if (chapterPill != null) chapterPill.animate().alpha(0f).setDuration(300).start(); };
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
        // If Android recreated us after the app was backgrounded (e.g. while
        // the user read a notification), fall back to the last saved chapter.
        android.content.SharedPreferences last = getSharedPreferences("mgs_reader", MODE_PRIVATE);
        String mid = getIntent().getStringExtra("mangaId");
        String curl = getIntent().getStringExtra("chapterUrl");
        if (mid == null) { mid = last.getString("mangaId", null); curl = last.getString("chapterUrl", null); }
        if (mid == null) { Nav.home(this); return; }
        returnTitle = getIntent().getStringExtra("returnTitle");
        returnCover = getIntent().getStringExtra("returnCover");
        if (returnTitle == null || returnTitle.isEmpty()) returnTitle = last.getString("title", "");
        if (returnCover == null || returnCover.isEmpty()) returnCover = last.getString("cover", "");
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

        chapterPill = findViewById(R.id.readerChapter);
        // JS reports which page the reader is on (scroll + page mode) so the
        // chapter/page indicator and cloud sync stay accurate.
        web.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public void onPage(final int p) {
                runOnUiThread(() -> {
                    page = Math.max(0, p);
                    showChapter();
                    syncProgress(page, false);
                });
            }

            /** Page mode: tap past the last/first page flips chapters. */
            @android.webkit.JavascriptInterface
            public void edge(final int dir) {
                runOnUiThread(() -> { if (dir > 0) goNext(); else goPrev(); });
            }
        }, "MGS");

        loadChapter(mid, curl);

        ((Button) findViewById(R.id.readerMode)).setOnClickListener(v -> {
            pageMode = !pageMode;
            ((Button) v).setText(pageMode ? "Scroll" : "Page");
            web.evaluateJavascript("document.body.className='" + (pageMode ? "pages" : "") + "';"
                    + "var a=document.querySelectorAll('img');"
                    + (pageMode ? "setPage(" + page + ");"
                               : "if(a[" + page + "])a[" + page + "].scrollIntoView();"), null);
            showChapter();
            syncProgress(page, false);
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
        findViewById(R.id.readerChapters).setOnClickListener(v -> showChapterPicker());
        updateChapterButton();
        findViewById(R.id.readerBack).setOnClickListener(v -> backToComic());
        findViewById(R.id.readerPrev).setOnClickListener(v -> goPrev());
        findViewById(R.id.readerNext).setOnClickListener(v -> goNext());
    }

    /** Remember the exact chapter even if Android kills the app while it's backgrounded. */
    private void rememberReader(int pg) {
        try {
            getSharedPreferences("mgs_reader", MODE_PRIVATE).edit()
                    .putString("mangaId", mangaId == null ? "" : mangaId)
                    .putString("chapterUrl", chapterUrl == null ? "" : chapterUrl)
                    .putString("title", returnTitle == null ? "" : returnTitle)
                    .putString("cover", returnCover == null ? "" : returnCover)
                    .putInt("page", Math.max(0, pg)).apply();
        } catch (Exception ignored) {}
    }

    /** Back returns to the comic page this reader was opened from. */
    private void backToComic() {
        Intent i = new Intent(this, ComicDetailActivity.class);
        i.putExtra("id", mangaId);
        i.putExtra("title", returnTitle == null || returnTitle.isEmpty() ? "Comic" : returnTitle);
        i.putExtra("cover", returnCover == null ? "" : returnCover);
        i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(i);
        finish();
    }

    private void updateChapterButton() {
        Button b = findViewById(R.id.readerChapters);
        if (b == null) return;
        int cur = chapterPos >= 0 ? chapterPos + 1 : (int) Math.max(1, numberFromUrl(chapterUrl));
        b.setText("CHP " + cur + "/" + (chapterTotal > 0 ? String.valueOf(chapterTotal) : "?"));
    }

    /** Scrollable list of every chapter, opened from the CHP x/y nav button. */
    private void showChapterPicker() {
        if (allChapters == null || allChapters.length() == 0) {
            Toast.makeText(this, "Chapter list is still loading", Toast.LENGTH_SHORT).show();
            return;
        }
        android.app.AlertDialog.Builder builder = new android.app.AlertDialog.Builder(this);
        builder.setTitle("Chapters");
        ScrollView sv = new ScrollView(this);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = Views.dp(this, 12);
        box.setPadding(pad, pad, pad, pad);
        final android.app.AlertDialog[] dialog = new android.app.AlertDialog[1];
        for (int i = 0; i < allChapters.length(); i++) {
            final JSONObject c = allChapters.optJSONObject(i);
            if (c == null) continue;
            final String url = c.optString("url", "");
            if (url.isEmpty()) continue;
            Object num = c.opt("number");
            String number = num == null ? String.valueOf(i + 1) : String.valueOf(num);
            String label = "Ch. " + number;
            String title = c.optString("title", "").trim();
            // "Chapter 5" is redundant next to "Ch. 5" — show it only when
            // the source supplied a real chapter title.
            if (!title.isEmpty() && !title.equalsIgnoreCase("Chapter " + number)
                    && !title.equalsIgnoreCase(label)) label += " <" + title + ">";
            TextView row = new TextView(this);
            row.setText(label);
            row.setTextSize(14);
            row.setPadding(pad, Views.dp(this, 9), pad, Views.dp(this, 9));
            boolean here = url.equals(chapterUrl);
            row.setTextColor(here ? 0xFFE11D2E : 0xFFFFFFFF);
            row.setBackgroundColor(here ? 0xFF3A141B : 0xFF1C1C24);
            row.setOnClickListener(v -> {
                dialog[0].dismiss();
                loadChapter(mangaId, url);
            });
            box.addView(row);
        }
        sv.addView(box);
        builder.setView(sv);
        builder.setNegativeButton("Close", null);
        dialog[0] = builder.show();
    }

    /** Load downloaded pages when available, otherwise stream the chapter from the API. */
    private void loadChapter(String manga, String chapter) {
        curManga = manga; mangaId = manga; chapterUrl = chapter;
        rememberReader(0);
        DownloadStore.markRead(this, manga, chapter);
        prevChapter = null; nextChapter = null;
        chapterPos = -1;
        computeNav();                     // instant neighbours from downloaded chapters
        computeNavOnline(manga, chapter); // exact neighbours from the full chapter list

        List<String> urls = new ArrayList<>();
        File dir = DownloadStore.chapterDir(this, manga, chapter);
        File[] kids = dir.listFiles();
        if (kids != null) for (File f : kids) if (f.isFile() && f.getName().endsWith(".jpg")) urls.add(Uri.fromFile(f).toString());
        if (urls.isEmpty()) { loadOnlineChapter(manga, chapter); return; }
        Collections.sort(urls); // file:// URIs sort by filename
        renderPages(urls, dir);
    }

    /** Fetch pages for an online chapter — native reader, never a website bounce. */
    private void loadOnlineChapter(final String manga, final String chapter) {
        new Thread(() -> {
            List<String> pages = new ArrayList<>();
            try {
                String raw = ApiClient.get("/comick/pages?url=" + ApiClient.q(chapter));
                JSONArray d = new JSONObject(raw).optJSONArray("data");
                if (d != null) for (int i = 0; i < d.length(); i++) {
                    String u = d.optString(i, "");
                    if (u.startsWith("http")) pages.add(u);
                }
            } catch (Exception ignored) {}
            final List<String> found = pages;
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                if (!manga.equals(mangaId) || !chapter.equals(chapterUrl)) return; // user moved on
                if (found.isEmpty()) {
                    Toast.makeText(this, "Could not load this chapter", Toast.LENGTH_SHORT).show();
                    return; // stay in the reader — never kick back to Home
                }
                renderPages(found, null);
            });
        }).start();
    }

    /** Build the shared webtoon/page reader HTML from a list of page image URLs. */
    private void renderPages(List<String> urls, File dir) {
        pageCount = urls.size();
        page = 0;
        StringBuilder html = new StringBuilder("<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">")
                .append("<style>html,body{margin:0;background:#000}img{display:block;width:100%;height:auto;margin:0 auto}"
                        + "body.pages img{display:none;height:100vh;object-fit:contain}"
                        + "body.pages img.on{display:block}</style></head><body"
                        + (pageMode ? " class=\"pages\"" : "") + ">");
        int idx = 0;
        for (String u : urls) {
            html.append("<img data-page=\"").append(idx++).append("\" src=\"")
                    .append(u.replace("\"", "%22").replace("&", "&amp;")).append("\">");
        }
        html.append("<script>function setPage(n){var a=document.querySelectorAll('img');if(!a.length)return;"
                + "page=Math.max(0,Math.min(a.length-1,n));for(var i=0;i<a.length;i++)a[i].className=(i===page?'on':'');"
                + "if(document.body.className==='pages')a[page].scrollIntoView();"
                + "if(window.MGS)try{MGS.onPage(page)}catch(e){}}var page=0;"
                + "if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){for(var i=0;i<es.length;i++){var e=es[i];if(!e.isIntersecting)continue;var n=parseInt(e.target.getAttribute('data-page'),10);if(isNaN(n))continue;setPage(n);}},"
                + "{root:null,rootMargin:'0px 0px -85% 0px'});document.querySelectorAll('img').forEach(function(im){io.observe(im);});}"
                + "if('scroll' in window){var st=function(){var a=document.querySelectorAll('img');if(!a.length||!a[0].naturalHeight)return;"
                + "var y=(window.pageYOffset||document.documentElement.scrollTop||0)+window.innerHeight*0.4;var cur=0;"
                + "for(var i=0;i<a.length;i++){if(a[i].offsetTop<=y)cur=i;}if(cur!==page)setPage(cur);};"
                + "addEventListener('scroll',function(){clearTimeout(st._t);st._t=setTimeout(st,120);},false);"
                + "document.querySelectorAll('img').forEach(function(im){im.addEventListener('load',st);});st();}"
                + "if(document.body.className==='pages')setPage(0);"
                + "document.addEventListener('click',function(ev){if(document.body.className!=='pages')return;"
                + "var n=document.querySelectorAll('img').length;var right=ev.clientX>window.innerWidth/2;"
                + "if(right&&page>=n-1){if(window.MGS)try{MGS.edge(1)}catch(e){}return;}"
                + "if(!right&&page<=0){if(window.MGS)try{MGS.edge(-1)}catch(e){}return;}"
                + "setPage(right?page+1:page-1);},false);</script></body></html>");
        if (dir != null) {
            File pageFile = new File(dir, "reader.html");
            try { DownloadStore.write(pageFile, html.toString()); }
            catch (Exception e) { Toast.makeText(this, "Cannot open chapter", Toast.LENGTH_SHORT).show(); return; }
            web.loadUrl(Uri.fromFile(pageFile).toString());
        } else {
            web.loadDataWithBaseURL(ApiClient.BASE + "/", html.toString(), "text/html", "UTF-8", null);
        }
        Button modeBtn = findViewById(R.id.readerMode);
        if (modeBtn != null) modeBtn.setText(pageMode ? "Scroll" : "Page");
        showChapter();
        syncProgress(0, true);
    }

    /** Exact prev/next from the whole chapter list — works for online chapters too. */
    private void computeNavOnline(final String manga, final String chapter) {
        new Thread(() -> {
            try {
                String raw = ApiClient.getCached("/comick/chapters?id=" + ApiClient.q(manga), 30000);
                JSONArray arr = new JSONObject(raw).optJSONArray("data");
                if (arr == null) return;
                int at = -1;
                for (int i = 0; i < arr.length(); i++) {
                    try { if (chapter.equals(arr.getJSONObject(i).optString("url", ""))) { at = i; break; } }
                    catch (Exception ignored) {}
                }
                final int pos = at, total = arr.length();
                allChapters = arr;
                final String pv = at > 0 ? arr.getJSONObject(at - 1).optString("url", "") : "";
                final String nx = at < arr.length() - 1 ? arr.getJSONObject(at + 1).optString("url", "") : "";
                runOnUiThread(() -> {
                    if (!manga.equals(mangaId) || !chapter.equals(chapterUrl)) return;
                    chapterTotal = total;
                    chapterPos = pos;
                    updateChapterButton();
                    prevChapter = pv;
                    nextChapter = nx;
                });
            } catch (Exception ignored) {}
        }).start();
    }

    /** Neighbouring chapters by exact position in the number-sorted download list. */
    private void computeNav() {
        nextChapter = null; prevChapter = null;
        try {
            JSONArray titles = DownloadStore.listTitles(this);
            for (int i = 0; i < titles.length(); i++) {
                try {
                    JSONObject t = titles.getJSONObject(i);
                    if (!curManga.equals(t.optString("mangaId", ""))) continue;
                    JSONArray cs = t.optJSONArray("chapters");
                    if (cs == null || cs.length() == 0) continue;
                    List<JSONObject> list = new ArrayList<>();
                    for (int j = 0; j < cs.length(); j++) {
                        JSONObject c = cs.getJSONObject(j);
                        if (!c.optString("chapterUrl", "").isEmpty()) list.add(c);
                    }
                    // Sort by chapter number (stable — ties keep download order).
                    Collections.sort(list, (a, b) -> Double.compare(numOf(a), numOf(b)));
                    int at = -1;
                    for (int j = 0; j < list.size(); j++) {
                        if (chapterUrl.equals(list.get(j).optString("chapterUrl", ""))) { at = j; break; }
                    }
                    if (at >= 0) {
                        // Exact neighbours: never jump to chapter 1 or a random chapter.
                        if (at > 0) prevChapter = list.get(at - 1).optString("chapterUrl", "");
                        if (at < list.size() - 1) nextChapter = list.get(at + 1).optString("chapterUrl", "");
                        return;
                    }
                    // Current chapter isn't downloaded (online chapter): numeric neighbours.
                    double curN = numberFromUrl(chapterUrl);
                    double bestPrev = -1, bestNext = Double.MAX_VALUE;
                    for (JSONObject c : list) {
                        double n = numOf(c);
                        if (n <= 0) continue;
                        if (n < curN && n > bestPrev) { bestPrev = n; prevChapter = c.optString("chapterUrl", ""); }
                        if (n > curN && n < bestNext) { bestNext = n; nextChapter = c.optString("chapterUrl", ""); }
                    }
                    return;
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
    }

    /** Chapter number from the stored label ("Ch. 14.5"), falling back to the URL. */
    private static double numOf(JSONObject c) {
        double n = number(c.optString("label", ""));
        if (n <= 0) n = numberFromUrl(c.optString("chapterUrl", ""));
        return n;
    }

    /** Prefer "…/chapter-20/" — never the first digits in the URL (ids/slugs poison number()). */
    private static double numberFromUrl(String s) {
        if (s == null || s.isEmpty()) return 0;
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("chapter[-_/]?(\\d+(?:\\.\\d+)?)", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(s);
        if (m.find()) {
            try { return Double.parseDouble(m.group(1)); } catch (Exception ignored) {}
        }
        m = java.util.regex.Pattern.compile("(\\d+(?:\\.\\d+)?)").matcher(s);
        double last = 0;
        while (m.find()) {
            try { last = Double.parseDouble(m.group(1)); } catch (Exception ignored) {}
        }
        return last;
    }

    /** Shows the "Ch. 20 · 3/28" pill for a few seconds. */
    private void showChapter() {
        if (chapterPill == null) return;
        String txt = chapterLabel(mangaId, chapterUrl);
        if (pageCount > 0) txt += "  ·  " + (page + 1) + "/" + pageCount;
        chapterPill.setText(txt);
        chapterPill.setVisibility(View.VISIBLE);
        chapterPill.setAlpha(1f);
        pillHandler.removeCallbacks(hidePill);
        pillHandler.postDelayed(hidePill, 3500);
    }

    private String chapterLabel(String manga, String chapter) {
        try {
            File meta = DownloadStore.chapterMeta(this, manga, chapter);
            if (meta.exists()) {
                JSONObject m = new JSONObject(DownloadStore.read(meta));
                String l = m.optString("label", "");
                if (!l.isEmpty()) return l;
            }
        } catch (Exception ignored) {}
        double n = numberFromUrl(chapter);
        if (n <= 0) return "Reading";
        return "Ch. " + (n == Math.floor(n) ? String.valueOf((long) n) : String.valueOf(n));
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
    private void syncProgress(final int pg) { syncProgress(pg, false); }

    /** One background worker keeps saves in order and prevents a slow, older
     *  request from overwriting a newer page the reader has already reached. */
    private final java.util.concurrent.ExecutorService syncExec =
            java.util.concurrent.Executors.newSingleThreadExecutor();
    private final java.util.concurrent.atomic.AtomicInteger pendingPage =
            new java.util.concurrent.atomic.AtomicInteger(-1);
    private long lastSyncAt = 0;

    /** @param force bypass the 1s throttle — used on chapter changes and exit
     *  so quick next/prev (and auto-advance) still saves where the reader is. */
    private void syncProgress(final int pg, final boolean force) {
        rememberReader(pg);
        if (!ApiClient.isSignedIn()) return;
        final String manga = mangaId, chapter = chapterUrl;
        if (manga == null || chapter == null) return;
        pendingPage.set(Math.max(0, pg));
        final long now = System.currentTimeMillis();
        if (!force && now - lastSyncAt < 1000) return;
        lastSyncAt = now;
        syncExec.execute(() -> {
            final int pageToSave = pendingPage.get();
            if (manga == null || chapter == null) return;
            try {
                JSONObject body = new JSONObject();
                body.put("chapterId", chapter);
                body.put("page", Math.max(0, pageToSave));
                body.put("chapterLabel", chapterLabel(manga, chapter));
                ApiClient.post("/progress/" + ApiClient.q(manga), body.toString());
            } catch (Exception ignored) {}
            try {
                JSONObject r = new JSONObject();
                r.put("mangaId", manga);
                r.put("chapterId", chapter);
                ApiClient.post("/reads", r.toString());
            } catch (Exception ignored) {}
        });
    }

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
            c.put("url", nextChapter); c.put("num", ""); c.put("label", chapterLabel(mangaId, nextChapter));
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

    @Override protected void onPause() { syncProgress(page, true); super.onPause(); }
    @Override protected void onDestroy() { stopAuto(); pillHandler.removeCallbacks(hidePill); super.onDestroy(); }
    @Override public void onBackPressed() { backToComic(); }
}
