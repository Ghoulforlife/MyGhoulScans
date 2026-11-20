package com.myghoulscans.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;

/** Downloads home: one card per comic (cover + name + chapter count). */
public class DownloadsActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle("Downloads");
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = 20;
        root.setPadding(pad, pad, pad, pad);
        scroll.addView(root, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(scroll);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(56, 56);
        lp.bottomMargin = 8;
        logo.setLayoutParams(lp);
        root.addView(logo);

        TextView head = new TextView(this);
        head.setText("Downloads");
        head.setTextSize(26);
        head.setTextColor(0xFFFFFFFF);
        head.setPadding(0, 0, 0, 4);
        root.addView(head);

        TextView info = new TextView(this);
        long used = DownloadStore.size(DownloadStore.root(this));
        info.setText("Saved: " + DownloadStore.readable(used) + " · Read offline anytime");
        info.setTextColor(0xFF979BA8);
        info.setTextSize(13);
        info.setPadding(0, 0, 0, 18);
        root.addView(info);

        LinearLayout cards = new LinearLayout(this);
        cards.setId(0x7f010001);
        cards.setOrientation(LinearLayout.VERTICAL);
        root.addView(cards);

        Button back = new Button(this);
        back.setText("← Back to website");
        back.setTextSize(15);
        back.setOnClickListener(v -> finish());
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        bp.topMargin = 24;
        back.setLayoutParams(bp);
        root.addView(back);
    }

    @Override
    protected void onResume() {
        super.onResume();
        LinearLayout cards = findViewById(0x7f010001);
        if (cards == null) return;
        cards.removeAllViews();
        JSONArray titles = DownloadStore.listTitles(this);
        if (titles.length() == 0) {
            TextView empty = new TextView(this);
            empty.setText("No downloads yet.\n\nOpen a comic, sign in, then tap “Download all chapters”.");
            empty.setTextColor(0xFFBBBBBB);
            empty.setTextSize(15);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(0, 60, 0, 60);
            cards.addView(empty);
            return;
        }
        for (int i = 0; i < titles.length(); i++) {
            try {
                JSONObject t = titles.getJSONObject(i);
                String mangaId = t.optString("mangaId", "");
                String title = t.optString("title", "Untitled");
                int count = t.optJSONArray("chapters") == null ? 0 : t.optJSONArray("chapters").length();

                LinearLayout card = new LinearLayout(this);
                card.setOrientation(LinearLayout.HORIZONTAL);
                card.setPadding(14, 14, 14, 14);
                card.setBackgroundColor(0xFF1C1C24);
                card.setClickable(true);
                card.setFocusable(true);

                ImageView cover = new ImageView(this);
                File cf = new File(DownloadStore.titleDir(this, mangaId), "cover.jpg");
                if (cf.exists()) {
                    cover.setImageBitmap(BitmapFactory.decodeFile(cf.getAbsolutePath()));
                } else {
                    cover.setImageResource(R.mipmap.ic_launcher);
                }
                cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
                LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(84, 116);
                ip.rightMargin = 16;
                cover.setLayoutParams(ip);
                card.addView(cover);

                TextView txt = new TextView(this);
                txt.setText(title + "\n\n" + count + " chapter" + (count == 1 ? "" : "s")
                        + " · " + DownloadStore.readable(t.optLong("bytes", 0)));
                txt.setTextColor(0xFFFFFFFF);
                txt.setTextSize(16);
                LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(0,
                        ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
                txt.setLayoutParams(tp);
                card.addView(txt);

                final String mid = mangaId, name = title;
                card.setOnClickListener(v -> {
                    Intent intent = new Intent(this, ChapterListActivity.class);
                    intent.putExtra("mangaId", mid);
                    intent.putExtra("title", name);
                    startActivity(intent);
                });

                LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                cp.bottomMargin = 12;
                cards.addView(card, cp);
            } catch (Exception ignored) {}
        }
    }
}
