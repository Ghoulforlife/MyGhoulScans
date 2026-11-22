package com.myghoulscans.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.StatFs;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;

/** Downloads: Webtoon-style list of series with cover, chapter count, size, read/delete. */
public class DownloadsActivity extends Activity {
    private LinearLayout cards;
    private TextView storageText, storagePct;
    private ProgressBar storageBar;
    private LinearLayout activeCard;
    private TextView activeTitle, activeChapter, activeSpeed;
    private ProgressBar activeBar;
    private final Handler ticker = new Handler();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle("Downloads");

        LinearLayout outer = new LinearLayout(this);
        outer.setOrientation(LinearLayout.VERTICAL);
        outer.setBackgroundColor(0xFF0E0E12);
        int pad = Views.dp(this, 16);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(pad, Views.dp(this, 14), pad, 0);
        TextView title = new TextView(this);
        title.setText("Downloads");
        title.setTextColor(0xFFFFFFFF);
        title.setTextSize(26);
        title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        title.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        header.addView(title);
        outer.addView(header);

        LinearLayout store = new LinearLayout(this);
        store.setOrientation(LinearLayout.VERTICAL);
        store.setPadding(pad, Views.dp(this, 8), pad, Views.dp(this, 12));
        storageText = new TextView(this);
        storageText.setTextColor(0xFF979BA8);
        storageText.setTextSize(12);
        store.addView(storageText);
        storageBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        storageBar.setMax(100);
        storageBar.setProgressTintList(android.content.res.ColorStateList.valueOf(0xFFE11D2E));
        storageBar.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, Views.dp(this, 6)));
        store.addView(storageBar);
        storagePct = new TextView(this);
        storagePct.setTextColor(0xFF979BA8);
        storagePct.setTextSize(11);
        storagePct.setGravity(Gravity.END);
        store.addView(storagePct);
        outer.addView(store);

        activeCard = new LinearLayout(this);
        activeCard.setOrientation(LinearLayout.VERTICAL);
        activeCard.setBackgroundResource(R.drawable.mgs_card);
        activeCard.setPadding(pad, Views.dp(this, 12), pad, Views.dp(this, 12));
        activeCard.setVisibility(View.GONE);
        activeTitle = new TextView(this);
        activeTitle.setTextColor(0xFFFFFFFF);
        activeTitle.setTextSize(14);
        activeTitle.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        activeCard.addView(activeTitle);
        activeChapter = new TextView(this);
        activeChapter.setTextColor(0xFF979BA8);
        activeChapter.setTextSize(12);
        activeCard.addView(activeChapter);
        activeBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        activeBar.setMax(100);
        activeBar.setProgressTintList(android.content.res.ColorStateList.valueOf(0xFFE11D2E));
        activeBar.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Views.dp(this, 5)));
        activeCard.addView(activeBar);
        activeSpeed = new TextView(this);
        activeSpeed.setTextColor(0xFF2ECC71);
        activeSpeed.setTextSize(12);
        activeCard.addView(activeSpeed);
        outer.addView(activeCard, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        ScrollView scroll = new ScrollView(this);
        cards = new LinearLayout(this);
        cards.setOrientation(LinearLayout.VERTICAL);
        cards.setPadding(pad, 0, pad, Views.dp(this, 10));
        scroll.addView(cards, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        outer.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        outer.addView(getLayoutInflater().inflate(R.layout.bottom_nav, outer, false));
        setContentView(outer);
        Nav.attach(this, 3);
    }

    @Override protected void onResume() { super.onResume(); render(); ticker.post(tick); }
    @Override protected void onPause() { super.onPause(); ticker.removeCallbacks(tick); }

    private final Runnable tick = new Runnable() {
        @Override public void run() { renderActive(); ticker.postDelayed(this, 1000); }
    };

    private void renderActive() {
        if (activeCard == null) return;
        if (DownloadService.curProgress < 0) { activeCard.setVisibility(View.GONE); return; }
        activeCard.setVisibility(View.VISIBLE);
        activeTitle.setText("Downloading · " + (DownloadService.curTitle == null ? "" : DownloadService.curTitle));
        String ch = DownloadService.curChapter == null ? "" : DownloadService.curChapter;
        activeChapter.setText((ch.isEmpty() ? "Preparing…" : ch) + " · " + DownloadService.curProgress + "%");
        activeSpeed.setText(DownloadStore.readable(DownloadService.curSpeed) + "/s");
        activeBar.setProgress(DownloadService.curProgress);
    }

    private void render() {
        // Auto-delete read chapters older than 24h (opt-in).
        if (getSharedPreferences("mgs", MODE_PRIVATE).getBoolean("auto_delete", false)) {
            long now = System.currentTimeMillis();
            try {
                JSONArray titles = DownloadStore.listTitles(this);
                for (int i = 0; i < titles.length(); i++) {
                    JSONObject t = titles.optJSONObject(i);
                    if (t == null) continue;
                    String mid = t.optString("mangaId", "");
                    JSONArray cs = t.optJSONArray("chapters");
                    if (cs == null) continue;
                    for (int j = 0; j < cs.length(); j++) {
                        JSONObject c = cs.optJSONObject(j);
                        if (c == null) continue;
                        String url = c.optString("chapterUrl", "");
                        if (url.isEmpty() || !DownloadStore.isRead(this, mid, url)) continue;
                        File meta = DownloadStore.chapterMeta(this, mid, url);
                        if (!meta.exists()) continue;
                        try {
                            JSONObject m = new JSONObject(DownloadStore.read(meta));
                            long time = m.optLong("time", 0);
                            if (time > 0 && now - time > 24L * 60 * 60 * 1000) DownloadStore.deleteChapter(this, mid, url);
                        } catch (Exception ignored) {}
                    }
                }
            } catch (Exception ignored) {}
        }

        try {
            StatFs s = new StatFs(Environment.getDataDirectory().getPath());
            long total = s.getTotalBytes(), free = s.getAvailableBytes();
            long used = total - free;
            int pct = total > 0 ? (int) (used * 100 / total) : 0;
            storageText.setText(DownloadStore.readable(used) + " / " + DownloadStore.readable(total) + " used");
            storagePct.setText(pct + "% used");
            storageBar.setProgress(pct);
        } catch (Exception ignored) {}

        cards.removeAllViews();
        JSONArray titles = DownloadStore.listTitles(this);
        if (titles.length() == 0) {
            TextView empty = new TextView(this);
            empty.setText("No downloads yet.\n\nOpen a comic and tap Download while signed in.");
            empty.setTextColor(0xFFBBBBBB);
            empty.setTextSize(15);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(0, Views.dp(this, 60), 0, Views.dp(this, 60));
            cards.addView(empty);
            return;
        }
        for (int i = 0; i < titles.length(); i++) {
            try { cards.addView(row(titles.getJSONObject(i))); } catch (Exception ignored) {}
        }
    }

    private LinearLayout chapterRow(String mangaId, JSONObject c) {
        final String curl = c.optString("chapterUrl", "");
        String label = c.optString("label", "Chapter");
        long bytes = c.optLong("bytes", 0);
        long time = c.optLong("time", 0);

        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.setPadding(Views.dp(this, 8), Views.dp(this, 6), Views.dp(this, 8), Views.dp(this, 6));
        r.setBackgroundColor(0xFF1A1A22);
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rp.bottomMargin = Views.dp(this, 4);
        rp.leftMargin = Views.dp(this, 26);
        r.setLayoutParams(rp);

        TextView name = new TextView(this);
        name.setText(label);
        name.setTextColor(0xFFFFFFFF);
        name.setTextSize(12);
        name.setMaxLines(1);
        name.setEllipsize(android.text.TextUtils.TruncateAt.END);
        name.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.6f));
        r.addView(name);

        addCell(r, DownloadStore.readable(bytes), 0.8f, 0xFF979BA8);
        addCell(r, "Downloaded", 0.9f, 0xFF2ECC71);
        addCell(r, relTime(time), 0.9f, 0xFF979BA8);

        Button del = new Button(this);
        del.setText("x");
        del.setTextSize(12);
        del.setAllCaps(false);
        del.setTextColor(0xFFE11D2E);
        del.setBackgroundResource(android.R.color.transparent);
        del.setPadding(Views.dp(this, 6), 0, Views.dp(this, 6), 0);
        del.setOnClickListener(v -> {
            DownloadStore.deleteChapter(this, mangaId, curl);
            Toast.makeText(this, "Deleted", Toast.LENGTH_SHORT).show();
            render();
        });
        del.setLayoutParams(new LinearLayout.LayoutParams(Views.dp(this, 24), ViewGroup.LayoutParams.WRAP_CONTENT));
        r.addView(del);

        r.setOnClickListener(v -> {
            Intent in = new Intent(this, ReaderActivity.class);
            in.putExtra("mangaId", mangaId);
            in.putExtra("chapterUrl", curl);
            startActivity(in);
        });
        return r;
    }

    private void addCell(LinearLayout row, String text, float weight, int color) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextColor(color);
        tv.setTextSize(10);
        tv.setMaxLines(1);
        tv.setEllipsize(android.text.TextUtils.TruncateAt.END);
        tv.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, weight));
        row.addView(tv);
    }

    private static String relTime(long time) {
        if (time <= 0) return "";
        long days = (System.currentTimeMillis() - time) / 86400000L;
        if (days <= 0) return "today";
        if (days == 1) return "1 day ago";
        return days + " days ago";
    }

    private LinearLayout row(JSONObject t) {
        final String mangaId = t.optString("mangaId", "");
        String title = t.optString("title", "Untitled");
        JSONArray chapters = t.optJSONArray("chapters");
        int count = chapters == null ? 0 : chapters.length();
        long bytes = t.optLong("bytes", 0);

        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.setPadding(Views.dp(this, 8), Views.dp(this, 8), Views.dp(this, 8), Views.dp(this, 8));
        r.setBackgroundResource(R.drawable.mgs_card);
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rp.bottomMargin = Views.dp(this, 6);
        r.setLayoutParams(rp);

        ImageView cover = new ImageView(this);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        File cf = new File(DownloadStore.titleDir(this, mangaId), "cover.jpg");
        if (cf.exists()) cover.setImageBitmap(BitmapFactory.decodeFile(cf.getAbsolutePath()));
        else cover.setImageResource(R.mipmap.ic_launcher);
        cover.setLayoutParams(new LinearLayout.LayoutParams(Views.dp(this, 38), Views.dp(this, 54)));
        r.addView(cover);

        LinearLayout mid = new LinearLayout(this);
        mid.setOrientation(LinearLayout.VERTICAL);
        mid.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        mid.setPadding(Views.dp(this, 10), 0, 0, 0);
        TextView name = new TextView(this);
        name.setText(title);
        name.setTextColor(0xFFFFFFFF);
        name.setTextSize(13);
        name.setMaxLines(2);
        name.setEllipsize(android.text.TextUtils.TruncateAt.END);
        mid.addView(name);
        TextView sub = new TextView(this);
        sub.setText(count + " chapter" + (count == 1 ? "" : "s") + " · " + DownloadStore.readable(bytes));
        sub.setTextColor(0xFF979BA8);
        sub.setTextSize(11);
        mid.addView(sub);
        r.addView(mid);

        Button read = new Button(this);
        read.setText("Read Offline");
        read.setTextSize(11);
        read.setAllCaps(false);
        read.setTextColor(0xFF2ECC71);
        read.setBackgroundResource(android.R.color.transparent);
        read.setPadding(Views.dp(this, 4), 0, Views.dp(this, 4), 0);
        read.setOnClickListener(v -> openNextUnread(mangaId));
        r.addView(read);

        Button del = new Button(this);
        del.setText("x");
        del.setTextSize(12);
        del.setAllCaps(false);
        del.setTextColor(0xFFE11D2E);
        del.setBackgroundResource(android.R.color.transparent);
        del.setPadding(Views.dp(this, 6), 0, Views.dp(this, 6), 0);
        del.setOnClickListener(v ->
                new android.app.AlertDialog.Builder(this)
                        .setTitle("Delete downloads")
                        .setMessage("Delete all downloaded chapters of " + title + "?")
                        .setPositiveButton("Delete", (d, w) -> {
                            DownloadStore.deleteTitle(this, mangaId);
                            Toast.makeText(this, "Deleted", Toast.LENGTH_SHORT).show();
                            render();
                        })
                        .setNegativeButton("Cancel", null)
                        .show());
        r.addView(del);

        r.setOnClickListener(v -> openComic(mangaId, title));
        return r;
    }

    private void openComic(String mangaId, String title) {
        Intent i = new Intent(this, ComicDetailActivity.class);
        i.putExtra("id", mangaId);
        i.putExtra("title", title);
        i.putExtra("cover", "");
        startActivity(i);
    }

    private void openNextUnread(String mangaId) {
        try {
            JSONArray titles = DownloadStore.listTitles(this);
            for (int i = 0; i < titles.length(); i++) {
                JSONObject t = titles.optJSONObject(i);
                if (t == null || !mangaId.equals(t.optString("mangaId", ""))) continue;
                JSONArray cs = t.optJSONArray("chapters");
                if (cs == null || cs.length() == 0) { Toast.makeText(this, "No downloaded chapters", Toast.LENGTH_SHORT).show(); return; }
                String pick = null;
                for (int j = 0; j < cs.length(); j++) {
                    JSONObject c = cs.optJSONObject(j);
                    if (c == null) continue;
                    String url = c.optString("chapterUrl", "");
                    if (url.isEmpty()) continue;
                    if (!DownloadStore.isRead(this, mangaId, url)) { pick = url; break; }
                }
                if (pick == null) pick = cs.optJSONObject(0).optString("chapterUrl", "");
                if (pick == null || pick.isEmpty()) { Toast.makeText(this, "No downloaded chapters", Toast.LENGTH_SHORT).show(); return; }
                Intent in = new Intent(this, ReaderActivity.class);
                in.putExtra("mangaId", mangaId);
                in.putExtra("chapterUrl", pick);
                in.putExtra("returnTitle", t.optString("title", ""));
                in.putExtra("returnCover", t.optString("cover", ""));
                startActivity(in);
                return;
            }
            Toast.makeText(this, "Not downloaded", Toast.LENGTH_SHORT).show();
        } catch (Exception e) { Toast.makeText(this, "Could not open chapter", Toast.LENGTH_SHORT).show(); }
    }

    @Override
    public void onBackPressed() { Nav.home(this); }
}
