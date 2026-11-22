package com.myghoulscans.app;

import android.content.Intent;
import android.graphics.Typeface;
import android.os.AsyncTask;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONObject;

public class HomeActivity extends AppCompatActivity {
    private static final String[] GENRES = {
            "action", "fantasy", "romance", "adventure", "comedy", "drama", "mystery",
            "supernatural", "historical", "sci-fi", "slice-of-life", "shounen", "seinen",
            "mecha", "psychological", "sports", "tragedy", "harem", "martial-arts", "isekai"
    };
    private JSONArray latest, popular, picks, recent, ongoing, romance, continueReading;
    private LinearLayout infiniteGrid;
    private TextView loadingMore;
    private static final int MAX_ROWS = 30;
    private int page = 1;
    private boolean loading;
    private long lastLoadAt = 0;
    private int gridCols = 2;
    private final java.util.HashSet<String> seen = new java.util.HashSet<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ApiClient.init(this);
        setContentView(R.layout.activity_home);
        Nav.attach(this, 0);
        gridCols = Math.max(2, getResources().getConfiguration().screenWidthDp / 110);
        ((Button) findViewById(R.id.homeSearch)).setOnClickListener(v ->
                startActivity(new Intent(this, SearchActivity.class)));
        infiniteGrid = findViewById(R.id.infiniteGrid);
        loadingMore = findViewById(R.id.loadingMore);
        ((EndlessScrollView) findViewById(R.id.homeScroll)).setBottomListener(() -> loadMore());
        new LoadTask().execute();
    }

    private class LoadTask extends AsyncTask<Void, Void, Void> {
        @Override protected Void doInBackground(Void... unused) {
            // Cached GETs: first launch fetches, later launches are instant.
            String raw = ApiClient.getCached("/comick/latest?source=mangaread&enrich=1", 10 * 60 * 1000);
            if (raw != null) try { latest = new JSONObject(raw).optJSONArray("data"); } catch (Exception ignored) {}
            raw = ApiClient.getCached("/comix/home", 10 * 60 * 1000);
            if (raw != null) {
                try {
                    JSONObject d = new JSONObject(raw).optJSONObject("data");
                    if (d != null) popular = d.optJSONArray("trending");
                } catch (Exception ignored) {}
            }
            raw = ApiClient.getCached("/comick/genre?source=mangaread&genre=action&page=1&enrich=1", 10 * 60 * 1000);
            if (raw != null) try { picks = new JSONObject(raw).optJSONArray("data"); } catch (Exception ignored) {}
            raw = ApiClient.getCached("/comick/latest?source=flamecomics&enrich=1", 10 * 60 * 1000);
            if (raw != null) try { recent = new JSONObject(raw).optJSONArray("data"); } catch (Exception ignored) {}
            raw = ApiClient.getCached("/comick/genre?source=mangaread&genre=fantasy&page=1&enrich=1", 10 * 60 * 1000);
            if (raw != null) try { ongoing = new JSONObject(raw).optJSONArray("data"); } catch (Exception ignored) {}
            raw = ApiClient.getCached("/comick/genre?source=mangaread&genre=romance&page=1&enrich=1", 10 * 60 * 1000);
            if (raw != null) try { romance = new JSONObject(raw).optJSONArray("data"); } catch (Exception ignored) {}

            if (ApiClient.isSignedIn()) {
                JSONArray pr = ApiClient.progress();
                continueReading = new JSONArray();
                if (pr != null) {
                    for (int i = 0; i < Math.min(3, pr.length()); i++) {
                        try {
                            JSONObject p = pr.getJSONObject(i);
                            String id = p.optString("manga_id", "");
                            if (id.isEmpty()) continue;
                            String tRaw = ApiClient.getCached("/comick/title?id=" + ApiClient.q(id), 10 * 60 * 1000);
                            JSONObject t = tRaw == null ? null : new JSONObject(tRaw).optJSONObject("data");
                            JSONObject c = new JSONObject();
                            c.put("id", id);
                            c.put("title", t == null ? id : t.optString("title", "Untitled"));
                            c.put("cover", t == null ? "" : t.optString("cover", ""));
                            c.put("chapterLabel", p.optString("chapter_label", "Ch. ?"));
                            c.put("page", p.optInt("page", 0));
                            continueReading.put(c);
                        } catch (Exception ignored) {}
                    }
                }
            }
            return null;
        }

        @Override protected void onPostExecute(Void v) {
            fill(R.id.continueRow, continueReading, true);
            fill(R.id.latestRow, latest, false);
            fill(R.id.popularRow, popular, false);
            fill(R.id.picksRow, picks, false);
            fill(R.id.recentRow, recent, false);
            fill(R.id.ongoingRow, ongoing, false);
            fill(R.id.romanceRow, romance, false);
            if (continueReading == null || continueReading.length() == 0)
                findViewById(R.id.continueHead).setVisibility(View.GONE);
            loadMore();
        }
    }

    // Infinite feed: each page pulls 10 titles from the next genre in rotation.
    private void loadMore() {
        long now = System.currentTimeMillis();
        if (loading || infiniteGrid == null || infiniteGrid.getChildCount() >= MAX_ROWS
                || now - lastLoadAt < 1800) return;
        lastLoadAt = now;
        loading = true;
        if (loadingMore != null) loadingMore.setVisibility(View.VISIBLE);
        final int myPage = page++;
        final String genre = GENRES[(myPage - 1) % GENRES.length];
        new AsyncTask<Void, Void, JSONArray>() {
            @Override protected JSONArray doInBackground(Void... unused) {
                String raw = ApiClient.getCached("/comick/genre?source=mangaread&genre=" + genre
                        + "&page=" + myPage + "&enrich=1", 10 * 60 * 1000);
                if (raw == null) return null;
                try { return new JSONObject(raw).optJSONArray("data"); } catch (Exception e) { return null; }
            }
            @Override protected void onPostExecute(JSONArray arr) {
                loading = false;
                if (loadingMore != null) loadingMore.setVisibility(View.GONE);
                if (arr == null) return;
                LinearLayout row = Views.row(HomeActivity.this);
                int placed = 0;
                for (int i = 0; i < Math.min(10, arr.length()) && infiniteGrid.getChildCount() < MAX_ROWS; i++) {
                    try {
                        JSONObject o = arr.getJSONObject(i);
                        String mid = o.optString("id", "");
                        if (mid.isEmpty() || !seen.add(mid)) continue;
                        String title = o.optString("title", "Untitled");
                        String cover = o.optString("cover", "");
                        Object ch = o.opt("latestChapter");
                        String sub = o.optString("latestChapterLabel", ch == null ? "" : "Ch. " + ch);
                        final String fid = mid, ft = title, fc = cover;
                        row.addView(Views.card(HomeActivity.this, mid, title, cover, sub,
                                v -> open(fid, ft, fc)));
                        placed++;
                        if (placed == gridCols) { infiniteGrid.addView(row); row = Views.row(HomeActivity.this); placed = 0; }
                    } catch (Exception ignored) {}
                }
                if (placed > 0) infiniteGrid.addView(row);
                if (infiniteGrid.getChildCount() >= MAX_ROWS && loadingMore != null)
                    loadingMore.setText("You're all caught up — that's all the comics!");
            }
        }.execute();
    }

    private void fill(int id, JSONArray arr, boolean withProgress) {
        LinearLayout row = findViewById(id);
        if (row == null || arr == null) return;
        row.removeAllViews();
        for (int i = 0; i < Math.min(12, arr.length()); i++) {
            try {
                JSONObject o = arr.getJSONObject(i);
                String mid = o.optString("id", "");
                String title = o.optString("title", "Untitled");
                String cover = o.optString("cover", "");
                String sub = o.optString("latestChapterLabel", "");
                if (sub.isEmpty()) {
                    Object ch = o.opt("latestChapter");
                    sub = ch == null ? "" : "Ch. " + ch;
                }
                final String fid = mid, ft = title, fc = cover;
                View card = Views.card(this, mid, title, cover, sub, v -> open(fid, ft, fc));
                if (withProgress) addProgress(card, o);
                row.addView(card);
            } catch (Exception ignored) {}
        }
    }

    private void addProgress(View card, JSONObject o) {
        String label = o.optString("chapterLabel", "");
        if (label.isEmpty()) return;
        TextView t = new TextView(this);
        t.setText(label + " · " + o.optInt("page", 0) + " pages read");
        t.setTextColor(0xFF2ECC71);
        t.setTextSize(10);
        t.setPadding(4, 0, 4, 2);
        ((ViewGroup) card).addView(t);
        ProgressBar bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setProgress(Math.min(90, 10 + o.optInt("page", 0)));
        bar.setProgressTintList(android.content.res.ColorStateList.valueOf(0xFFE11D2E));
        bar.setLayoutParams(new LinearLayout.LayoutParams(Views.dp(this, 100), Views.dp(this, 3)));
        ((ViewGroup) card).addView(bar);
    }

    private void open(String id, String title, String cover) {
        Intent i = new Intent(this, ComicDetailActivity.class);
        i.putExtra("id", id);
        i.putExtra("title", title);
        i.putExtra("cover", cover);
        startActivity(i);
    }

    @Override
    public void onBackPressed() { Nav.home(this); }
}
