package com.myghoulscans.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

/** Folder view: all downloaded chapters of one comic, oldest first. */
public class ChapterListActivity extends Activity {
    private String mangaId, title;
    private LinearLayout list;
    private TextView sub;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        mangaId = getIntent().getStringExtra("mangaId");
        title = getIntent().getStringExtra("title");
        if (mangaId == null) { finish(); return; }
        setTitle(title);

        LinearLayout outer = new LinearLayout(this);
        outer.setOrientation(LinearLayout.VERTICAL);
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = 20;
        root.setPadding(pad, pad, pad, pad);
        scroll.addView(root, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        outer.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        outer.addView(getLayoutInflater().inflate(R.layout.bottom_nav, outer, false));
        setContentView(outer);
        Nav.attach(this, 3);

        TextView head = new TextView(this);
        head.setText(title);
        head.setTextSize(22);
        head.setTextColor(0xFFFFFFFF);
        head.setPadding(0, 0, 0, 6);
        root.addView(head);

        sub = new TextView(this);
        sub.setTextColor(0xFF979BA8);
        sub.setTextSize(13);
        sub.setPadding(0, 0, 0, 16);
        root.addView(sub);

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        root.addView(list);

        Button delAll = new Button(this);
        delAll.setText("Delete all chapters of this comic");
        delAll.setTextSize(14);
        delAll.setOnClickListener(v -> {
            DownloadStore.deleteTitle(this, mangaId);
            Toast.makeText(this, "Deleted", Toast.LENGTH_SHORT).show();
            finish();
        });
        LinearLayout.LayoutParams dp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        dp.topMargin = 20;
        delAll.setLayoutParams(dp);
        root.addView(delAll);

        Button back = new Button(this);
        back.setText("← Downloads");
        back.setTextSize(15);
        back.setOnClickListener(v -> {
            Intent i = new Intent(this, DownloadsActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(i);
            finish();
        });
        root.addView(back, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    @Override
    protected void onResume() { super.onResume(); render(); }

    private void render() {
        list.removeAllViews();
        JSONArray titles = DownloadStore.listTitles(this);
        JSONArray chapters = null;
        for (int i = 0; i < titles.length(); i++) {
            try {
                JSONObject t = titles.getJSONObject(i);
                if (mangaId.equals(t.optString("mangaId", ""))) chapters = t.optJSONArray("chapters");
            } catch (Exception ignored) {}
        }
        if (sub == null) sub = new TextView(this);
        if (chapters == null) chapters = new JSONArray();
        if (sub != null) sub.setText(chapters.length() + " chapter" + (chapters.length() == 1 ? "" : "s") + " saved · tap to read");

        for (int i = 0; i < chapters.length(); i++) {
            try {
                JSONObject c = chapters.getJSONObject(i);
                final String curl = c.optString("chapterUrl", "");
                LinearLayout row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setPadding(16, 16, 16, 16);
                row.setBackgroundColor(0xFF1C1C24);

                TextView txt = new TextView(this);
                txt.setText(c.optString("label", "Chapter") + "\n"
                        + c.optInt("pages", 0) + " pages · "
                        + DownloadStore.readable(c.optLong("bytes", 0)));
                txt.setTextColor(0xFFFFFFFF);
                txt.setTextSize(15);
                txt.setLayoutParams(new LinearLayout.LayoutParams(0,
                        ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
                row.addView(txt);

                Button open = new Button(this);
                open.setText("Read");
                open.setTextSize(13);
                open.setOnClickListener(v -> {
                    Intent intent = new Intent(this, ReaderActivity.class);
                    intent.putExtra("mangaId", mangaId);
                    intent.putExtra("chapterUrl", curl);
                    intent.putExtra("returnTitle", title);
                    startActivity(intent);
                });
                row.addView(open);

                Button del = new Button(this);
                del.setText("✕");
                del.setTextSize(13);
                del.setOnClickListener(v -> {
                    DownloadStore.deleteChapter(this, mangaId, curl);
                    Toast.makeText(this, "Deleted", Toast.LENGTH_SHORT).show();
                    render();
                });
                row.addView(del);

                LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                rp.bottomMargin = 10;
                list.addView(row, rp);
            } catch (Exception ignored) {}
        }
    }
}
