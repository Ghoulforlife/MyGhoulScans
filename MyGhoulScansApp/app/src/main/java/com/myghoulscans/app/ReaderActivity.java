package com.myghoulscans.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.Toast;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/** Offline chapter reader — renders saved local images in a WebView. */
public class ReaderActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String mangaId = getIntent().getStringExtra("mangaId");
        String chapterUrl = getIntent().getStringExtra("chapterUrl");
        if (mangaId == null || chapterUrl == null) { finish(); return; }

        DownloadStore.markRead(this, mangaId, chapterUrl);
        File dir = DownloadStore.chapterDir(this, mangaId, chapterUrl);
        List<File> imgs = new ArrayList<>();
        File[] kids = dir.listFiles();
        if (kids != null) {
            for (File f : kids) if (f.isFile() && f.getName().endsWith(".jpg")) imgs.add(f);
        }
        if (imgs.isEmpty()) {
            Toast.makeText(this, "This chapter has no saved pages", Toast.LENGTH_SHORT).show();
            finish(); return;
        }
        Collections.sort(imgs);

        StringBuilder html = new StringBuilder("<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">")
                .append("<style>body{margin:0;background:#0e0e12}img{display:block;width:100%;height:auto;margin:0 auto}</style></head><body>");
        for (File f : imgs) {
            html.append("<img src=\"").append(Uri.fromFile(f).toString()).append("\">");
        }
        html.append("</body></html>");
        File page = new File(dir, "reader.html");
        try { DownloadStore.write(page, html.toString()); }
        catch (Exception e) { Toast.makeText(this, "Cannot open chapter", Toast.LENGTH_SHORT).show(); finish(); return; }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        WebView web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setJavaScriptEnabled(false);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        LinearLayout.LayoutParams wp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
        root.addView(web, wp);

        Button downloads = new Button(this);
        downloads.setText("← Downloads");
        downloads.setOnClickListener(v -> {
            Intent i = new Intent(this, DownloadsActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(i);
            finish();
        });
        root.addView(downloads, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        setContentView(root);
        web.loadUrl(Uri.fromFile(page).toString());
    }

    @Override public void onBackPressed() { finish(); }
}
