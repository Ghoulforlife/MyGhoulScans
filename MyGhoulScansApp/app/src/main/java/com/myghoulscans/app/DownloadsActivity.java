package com.myghoulscans.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

/** Native Downloads screen: list, open and delete saved chapters. */
public class DownloadsActivity extends Activity {
    private LinearLayout list;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle("Downloads");

        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = 24;
        root.setPadding(pad, pad, pad, pad);
        scroll.addView(root, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(scroll);

        TextView head = new TextView(this);
        head.setText("Downloads");
        head.setTextSize(24);
        head.setTextColor(0xFFFFFFFF);
        head.setPadding(0, 0, 0, 8);
        root.addView(head);

        TextView info = new TextView(this);
        info.setText("Saved: " + DownloadStore.readable(DownloadStore.size(DownloadStore.root(this)))
                + " · Saved chapters stay readable offline.");
        info.setTextColor(0xFFAAAAAA);
        info.setTextSize(13);
        info.setPadding(0, 0, 0, 16);
        root.addView(info);

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        root.addView(list, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button back = new Button(this);
        back.setText("Back to website");
        back.setOnClickListener(v -> finish());
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        bp.topMargin = 24;
        back.setLayoutParams(bp);
        root.addView(back);
    }

    @Override
    protected void onResume() { super.onResume(); render(); }

    private void render() {
        list.removeAllViews();
        JSONArray titles = DownloadStore.listTitles(this);
        if (titles.length() == 0) {
            TextView empty = new TextView(this);
            empty.setText("No downloads yet.\nOpen a comic in the app and tap Download while signed in.");
            empty.setTextColor(0xFFBBBBBB);
            empty.setTextSize(15);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(0, 60, 0, 60);
            list.addView(empty);
            return;
        }
        for (int i = 0; i < titles.length(); i++) {
            try {
                JSONObject t = titles.getJSONObject(i);
                String mangaId = t.optString("mangaId", "");
                String title = t.optString("title", "Untitled");

                TextView h = new TextView(this);
                h.setText(title);
                h.setTextColor(0xFFCCCCCC);
                h.setTextSize(12);
                h.setPadding(0, 18, 0, 4);
                list.addView(h);

                JSONArray chapters = t.optJSONArray("chapters");
                if (chapters == null) continue;
                for (int j = 0; j < chapters.length(); j++) {
                    JSONObject c = chapters.getJSONObject(j);
                    String curl = c.optString("chapterUrl", "");
                    String label = c.optString("label", "Chapter");

                    LinearLayout row = new LinearLayout(this);
                    row.setOrientation(LinearLayout.HORIZONTAL);
                    row.setPadding(12, 12, 12, 12);
                    row.setBackgroundColor(0xFF1C1C24);

                    TextView txt = new TextView(this);
                    txt.setText(label + "\n" + c.optInt("pages", 0) + " pages · "
                            + DownloadStore.readable(c.optLong("bytes", 0)));
                    txt.setTextColor(0xFFFFFFFF);
                    txt.setTextSize(15);
                    LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
                    txt.setLayoutParams(tp);
                    final String mid = mangaId, cu = curl;
                    txt.setOnClickListener(v -> {
                        Intent intent = new Intent(this, ReaderActivity.class);
                        intent.putExtra("mangaId", mid);
                        intent.putExtra("chapterUrl", cu);
                        startActivity(intent);
                    });
                    row.addView(txt);

                    Button del = new Button(this);
                    del.setText("Delete");
                    del.setTextSize(12);
                    del.setOnClickListener(v -> {
                        DownloadStore.deleteChapter(this, mid, cu);
                        Toast.makeText(this, "Deleted", Toast.LENGTH_SHORT).show();
                        render();
                    });
                    row.addView(del);

                    LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                    rp.bottomMargin = 6;
                    list.addView(row, rp);
                }

                Button delTitle = new Button(this);
                delTitle.setText("Delete all chapters of this comic");
                delTitle.setTextSize(12);
                final String mid2 = mangaId;
                delTitle.setOnClickListener(v -> {
                    DownloadStore.deleteTitle(this, mid2);
                    Toast.makeText(this, "Deleted", Toast.LENGTH_SHORT).show();
                    render();
                });
                list.addView(delTitle);
            } catch (Exception ignored) {}
        }
    }
}
