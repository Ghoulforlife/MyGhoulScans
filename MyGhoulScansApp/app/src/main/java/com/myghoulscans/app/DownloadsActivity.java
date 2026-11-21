package com.myghoulscans.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.os.Bundle;
import android.os.Environment;
import android.os.StatFs;
import android.view.Gravity;
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
import java.util.HashSet;
import java.util.Set;

/** Downloads page: storage bar, expandable comic cards and per-chapter rows. */
public class DownloadsActivity extends Activity {
    private LinearLayout cards;
    private final Set<String> expanded = new HashSet<>();
    private boolean manage;
    private Button manageBtn;
    private TextView storageText, storagePct;
    private ProgressBar storageBar;

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
        manageBtn = new Button(this);
        manageBtn.setText("Manage");
        manageBtn.setTextSize(13);
        manageBtn.setAllCaps(false);
        manageBtn.setTextColor(0xFFE11D2E);
        manageBtn.setBackgroundResource(android.R.color.transparent);
        manageBtn.setOnClickListener(v -> {
            manage = !manage;
            manageBtn.setText(manage ? "Done" : "Manage");
            render();
        });
        header.addView(manageBtn);
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

    @Override protected void onResume() { super.onResume(); render(); }

    private void render() {
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
            try { cards.addView(comicCard(titles.getJSONObject(i))); } catch (Exception ignored) {}
        }
    }

    private LinearLayout comicCard(JSONObject t) {
        final String mangaId = t.optString("mangaId", "");
        String title = t.optString("title", "Untitled");
        String source = mangaId.contains(":") ? mangaId.split(":")[1] : "source";
        JSONArray chapters = t.optJSONArray("chapters");
        int count = chapters == null ? 0 : chapters.length();

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackgroundResource(R.drawable.mgs_card);
        card.setPadding(Views.dp(this, 10), Views.dp(this, 10), Views.dp(this, 10), Views.dp(this, 10));

        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.HORIZONTAL);
        head.setGravity(Gravity.CENTER_VERTICAL);
        ImageView cover = new ImageView(this);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        File cf = new File(DownloadStore.titleDir(this, mangaId), "cover.jpg");
        if (cf.exists()) cover.setImageBitmap(BitmapFactory.decodeFile(cf.getAbsolutePath()));
        else cover.setImageResource(R.mipmap.ic_launcher);
        cover.setLayoutParams(new LinearLayout.LayoutParams(Views.dp(this, 46), Views.dp(this, 62)));
        head.addView(cover);

        LinearLayout texts = new LinearLayout(this);
        texts.setOrientation(LinearLayout.VERTICAL);
        texts.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        texts.setPadding(Views.dp(this, 10), 0, 0, 0);
        TextView name = new TextView(this);
        name.setText(title);
        name.setTextColor(0xFFFFFFFF);
        name.setTextSize(14);
        name.setMaxLines(2);
        name.setEllipsize(android.text.TextUtils.TruncateAt.END);
        texts.addView(name);
        TextView sub = new TextView(this);
        sub.setText(source + " · " + count + " chapter" + (count == 1 ? "" : "s") + " downloaded");
        sub.setTextColor(0xFF979BA8);
        sub.setTextSize(11);
        texts.addView(sub);
        head.addView(texts);

        LinearLayout right = new LinearLayout(this);
        right.setOrientation(LinearLayout.VERTICAL);
        right.setGravity(Gravity.END);
        TextView size = new TextView(this);
        size.setText(DownloadStore.readable(t.optLong("bytes", 0)));
        size.setTextColor(0xFFFFFFFF);
        size.setTextSize(13);
        right.addView(size);
        TextView check = new TextView(this);
        check.setText("✓");
        check.setTextColor(0xFF2ECC71);
        check.setTextSize(18);
        check.setGravity(Gravity.END);
        right.addView(check);
        head.addView(right);

        head.setClickable(true);
        head.setOnClickListener(v -> {
            if (!expanded.add(mangaId)) expanded.remove(mangaId);
            render();
        });
        card.addView(head);

        if (expanded.contains(mangaId) && chapters != null) {
            for (int i = 0; i < chapters.length(); i++) {
                try { card.addView(chapterRow(mangaId, chapters.getJSONObject(i), cf)); }
                catch (Exception ignored) {}
            }
        }
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = Views.dp(this, 10);
        card.setLayoutParams(lp);
        return card;
    }

    private LinearLayout chapterRow(final String mangaId, JSONObject c, File coverFile) {
        final String curl = c.optString("chapterUrl", "");
        String label = c.optString("label", "Chapter");
        int pages = c.optInt("pages", 0);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(Views.dp(this, 5), Views.dp(this, 6), Views.dp(this, 3), Views.dp(this, 6));
        row.setBackgroundColor(0xFF23232B);

        ImageView thumb = new ImageView(this);
        thumb.setScaleType(ImageView.ScaleType.CENTER_CROP);
        if (coverFile.exists()) thumb.setImageBitmap(BitmapFactory.decodeFile(coverFile.getAbsolutePath()));
        else thumb.setImageResource(R.mipmap.ic_launcher);
        thumb.setLayoutParams(new LinearLayout.LayoutParams(Views.dp(this, 24), Views.dp(this, 32)));
        row.addView(thumb);

        LinearLayout mid = new LinearLayout(this);
        mid.setOrientation(LinearLayout.VERTICAL);
        mid.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        mid.setPadding(Views.dp(this, 8), 0, 0, 0);
        TextView name = new TextView(this);
        name.setText(label);
        name.setTextColor(0xFFFFFFFF);
        name.setTextSize(13);
        name.setSingleLine(true);
        name.setEllipsize(android.text.TextUtils.TruncateAt.END);
        mid.addView(name);
        ProgressBar bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setProgress(pages > 0 ? 100 : 0);
        bar.setProgressTintList(android.content.res.ColorStateList.valueOf(0xFFE11D2E));
        bar.setLayoutParams(new LinearLayout.LayoutParams(Views.dp(this, 50), Views.dp(this, 4)));
        mid.addView(bar);
        TextView meta = new TextView(this);
        meta.setText((pages > 0 ? "100%" : "0%") + " · " + DownloadStore.readable(c.optLong("bytes", 0)));
        meta.setTextColor(0xFF979BA8);
        meta.setTextSize(10);
        meta.setSingleLine(true);
        mid.addView(meta);
        row.addView(mid);

        if (!manage) {
            TextView state = new TextView(this);
            boolean read = DownloadStore.isRead(this, mangaId, curl);
            state.setText(read ? "Read" : "Unread");
            state.setTextColor(read ? 0xFF2ECC71 : 0xFF979BA8);
            state.setTextSize(10);
            state.setSingleLine(true);
            row.addView(state);
        }

        Button open = new Button(this);
        open.setText("Read Offline");
        open.setTextSize(14);
        open.setAllCaps(false);
        open.setMinWidth(0);
        open.setMinimumWidth(0);
        open.setPadding(Views.dp(this, 8), Views.dp(this, 6), Views.dp(this, 8), Views.dp(this, 6));
        open.setTextColor(0xFF2ECC71);
        open.setBackgroundResource(android.R.color.transparent);
        open.setOnClickListener(v -> {
            Intent i = new Intent(this, ReaderActivity.class);
            i.putExtra("mangaId", mangaId);
            i.putExtra("chapterUrl", curl);
            startActivity(i);
        });
        row.addView(open);

        if (!manage) {
            row.setClickable(true);
            row.setOnClickListener(v -> {
                Intent i = new Intent(this, ReaderActivity.class);
                i.putExtra("mangaId", mangaId);
                i.putExtra("chapterUrl", curl);
                startActivity(i);
            });
        }

        if (manage) {
            Button del = new Button(this);
            del.setText("✕");
            del.setTextSize(11);
            del.setMinWidth(0);
            del.setMinimumWidth(0);
            del.setPadding(Views.dp(this, 3), 0, Views.dp(this, 3), 0);
            del.setBackgroundResource(android.R.color.transparent);
            del.setOnClickListener(v -> {
                DownloadStore.deleteChapter(this, mangaId, curl);
                Toast.makeText(this, "Deleted", Toast.LENGTH_SHORT).show();
                render();
            });
            row.addView(del);
        }

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = Views.dp(this, 4);
        row.setLayoutParams(lp);
        return row;
    }

    @Override
    public void onBackPressed() { Nav.home(this); }
}
