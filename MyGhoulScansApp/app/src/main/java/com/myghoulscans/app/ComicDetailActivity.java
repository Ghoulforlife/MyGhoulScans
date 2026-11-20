package com.myghoulscans.app;

import android.content.Intent;
import android.os.AsyncTask;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.bumptech.glide.Glide;

import org.json.JSONArray;
import org.json.JSONObject;

public class ComicDetailActivity extends AppCompatActivity {
    private String mangaId, title, cover;
    private JSONArray chapters;
    private LinearLayout chapterList;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ApiClient.init(this);
        setContentView(R.layout.activity_comic_detail);
        mangaId = getIntent().getStringExtra("id");
        title = getIntent().getStringExtra("title");
        cover = getIntent().getStringExtra("cover");
        if (mangaId == null) { finish(); return; }
        chapterList = findViewById(R.id.chapterList);
        ((TextView) findViewById(R.id.detailTitle)).setText(title);
        ((TextView) findViewById(R.id.detailTopTitle)).setText(title);
        if (cover != null && !cover.isEmpty())
            Glide.with(this).load(cover).placeholder(R.mipmap.ic_launcher).into((ImageView) findViewById(R.id.detailCover));
        findViewById(R.id.detailBack).setOnClickListener(v -> finish());
        new LoadTask().execute();
    }

    private class LoadTask extends AsyncTask<Void, Void, Void> {
        @Override protected Void doInBackground(Void... unused) {
            try {
                JSONObject d = new JSONObject(ApiClient.get("/comick/title?id=" + ApiClient.q(mangaId))).optJSONObject("data");
                if (d != null) {
                    final String t = d.optString("title", title);
                    final String c = d.optString("cover", cover);
                    final String s = d.optString("source", "");
                    final String desc = d.optString("description", "");
                    runOnUiThread(() -> {
                        title = t; cover = c;
                        ((TextView) findViewById(R.id.detailTitle)).setText(t);
                        ((TextView) findViewById(R.id.detailTopTitle)).setText(t);
                        ((TextView) findViewById(R.id.detailSource)).setText(s);
                        ((TextView) findViewById(R.id.detailDesc)).setText(desc);
                        if (c != null && !c.isEmpty())
                            Glide.with(ComicDetailActivity.this).load(c).placeholder(R.mipmap.ic_launcher)
                                    .into((ImageView) findViewById(R.id.detailCover));
                    });
                }
            } catch (Exception ignored) {}
            try { chapters = new JSONObject(ApiClient.get("/comick/chapters?id=" + ApiClient.q(mangaId))).optJSONArray("data"); }
            catch (Exception ignored) {}
            return null;
        }
        @Override protected void onPostExecute(Void v) {
            if (chapters == null) chapters = new JSONArray();
            ((TextView) findViewById(R.id.detailCount)).setText(chapters.length() + " chapters");
            chapterList.removeAllViews();
            for (int i = 0; i < chapters.length(); i++) {
                try { chapterList.addView(chapterRow(chapters.getJSONObject(i))); } catch (Exception ignored) {}
            }
            findViewById(R.id.detailRead).setOnClickListener(click -> {
                if (chapters.length() == 0) { Toast.makeText(ComicDetailActivity.this, "No chapters", Toast.LENGTH_SHORT).show(); return; }
                try { openOnline(chapters.getJSONObject(0).optString("url", "")); } catch (Exception ignored) {}
            });
            findViewById(R.id.detailDownloadAll).setOnClickListener(click -> downloadAll());
        }
    }

    private LinearLayout chapterRow(JSONObject c) {
        final String url = c.optString("url", "");
        String label = "Ch. " + (c.opt("number") == null ? "?" : c.opt("number"));
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(10, 10, 10, 10);
        row.setBackgroundColor(0xFF1C1C24);
        TextView t = new TextView(this);
        t.setText(label + "  " + c.optString("title", ""));
        t.setTextColor(0xFFFFFFFF);
        t.setTextSize(14);
        t.setMaxLines(1);
        t.setEllipsize(android.text.TextUtils.TruncateAt.END);
        t.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        row.addView(t);

        Button read = new Button(this);
        read.setText("Read");
        read.setTextSize(12);
        read.setOnClickListener(v -> openOnline(url));
        row.addView(read);

        Button dl = new Button(this);
        dl.setText("↓");
        dl.setTextSize(14);
        dl.setOnClickListener(v -> {
            if (!ApiClient.isSignedIn()) { Toast.makeText(this, "Sign in to download", Toast.LENGTH_SHORT).show(); return; }
            JSONArray one = new JSONArray();
            one.put(chapterPayload(c));
            startDownload(one);
        });
        row.addView(dl);

        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rp.bottomMargin = 8;
        row.setLayoutParams(rp);
        return row;
    }

    private JSONObject chapterPayload(JSONObject c) {
        JSONObject o = new JSONObject();
        try {
            o.put("url", c.optString("url", ""));
            Object n = c.opt("number");
            o.put("num", n == null ? "" : String.valueOf(n));
            o.put("label", "Ch. " + (n == null ? "?" : n));
        } catch (Exception ignored) {}
        return o;
    }

    private void downloadAll() {
        if (!ApiClient.isSignedIn()) { Toast.makeText(this, "Sign in to download", Toast.LENGTH_SHORT).show(); return; }
        if (chapters == null || chapters.length() == 0) { Toast.makeText(this, "No chapters", Toast.LENGTH_SHORT).show(); return; }
        JSONArray list = new JSONArray();
        for (int i = 0; i < chapters.length(); i++) {
            try { list.put(chapterPayload(chapters.getJSONObject(i))); } catch (Exception ignored) {}
        }
        startDownload(list);
    }

    private void startDownload(JSONArray list) {
        try {
            JSONObject p = new JSONObject();
            p.put("mangaId", mangaId);
            p.put("title", title);
            p.put("coverUrl", cover == null ? "" : cover);
            p.put("token", ApiClient.token());
            p.put("chapters", list);
            Intent i = new Intent(this, DownloadService.class);
            i.putExtra("payload", p.toString());
            startService(i);
            Toast.makeText(this, "Download started", Toast.LENGTH_SHORT).show();
        } catch (Exception e) { Toast.makeText(this, "Could not start download", Toast.LENGTH_SHORT).show(); }
    }

    private void openOnline(String chapterUrl) {
        if (chapterUrl == null || chapterUrl.isEmpty()) return;
        try {
            String url = "https://ghoulforlife.github.io/MyGhoulScans/#/reader/" + mangaId
                    + "/" + java.net.URLEncoder.encode(chapterUrl, "UTF-8") + "/0";
            Intent i = new Intent(this, MainActivity.class);
            i.putExtra("url", url);
            startActivity(i);
        } catch (Exception ignored) {}
    }
}
