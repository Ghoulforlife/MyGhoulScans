package com.myghoulscans.app;

import android.app.Activity;
import android.content.Intent;
import android.os.AsyncTask;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONObject;

public class HomeActivity extends AppCompatActivity {
    private JSONArray latest, popular, picks, recent, ongoing, romance, continueReading;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ApiClient.init(this);
        setContentView(R.layout.activity_home);
        Nav.attach(this, 0);
        ((Button) findViewById(R.id.homeSearch)).setOnClickListener(v ->
                startActivity(new Intent(this, SearchActivity.class)));
        new LoadTask().execute();
    }

    private class LoadTask extends AsyncTask<Void, Void, Void> {
        @Override protected Void doInBackground(Void... unused) {
            try { latest = new JSONObject(ApiClient.get("/comick/latest?source=mangaread&enrich=1")).optJSONArray("data"); }
            catch (Exception ignored) {}
            try {
                JSONObject home = new JSONObject(ApiClient.get("/comix/home"));
                JSONObject d = home.optJSONObject("data");
                if (d != null) popular = d.optJSONArray("trending");
            } catch (Exception ignored) {}
            try { picks = new JSONObject(ApiClient.get("/comick/genre?source=mangaread&genre=action&page=1&enrich=1")).optJSONArray("data"); }
            catch (Exception ignored) {}
            try { recent = new JSONObject(ApiClient.get("/comick/latest?source=flamecomics&enrich=1")).optJSONArray("data"); }
            catch (Exception ignored) {}
            try { ongoing = new JSONObject(ApiClient.get("/comick/genre?source=mangaread&genre=fantasy&page=1&enrich=1")).optJSONArray("data"); }
            catch (Exception ignored) {}
            try { romance = new JSONObject(ApiClient.get("/comick/genre?source=mangaread&genre=romance&page=1&enrich=1")).optJSONArray("data"); }
            catch (Exception ignored) {}
            if (ApiClient.isSignedIn()) {
                continueReading = new JSONArray();
                try {
                    JSONArray ids = new JSONObject(ApiClient.get("/history")).optJSONArray("data");
                    if (ids != null) {
                        for (int i = 0; i < Math.min(6, ids.length()); i++) {
                            String id = ids.optString(i, "");
                            if (id.isEmpty()) continue;
                            try {
                                JSONObject t = new JSONObject(ApiClient.get("/comick/title?id=" + ApiClient.q(id))).optJSONObject("data");
                                if (t != null) {
                                    JSONObject c = new JSONObject();
                                    c.put("id", id);
                                    c.put("title", t.optString("title", "Untitled"));
                                    c.put("cover", t.optString("cover", ""));
                                    continueReading.put(c);
                                }
                            } catch (Exception ignored) {}
                        }
                    }
                } catch (Exception ignored) {}
            }
            return null;
        }

        @Override protected void onPostExecute(Void v) {
            fill(R.id.continueRow, continueReading);
            fill(R.id.latestRow, latest);
            fill(R.id.popularRow, popular);
            fill(R.id.picksRow, picks);
            fill(R.id.recentRow, recent);
            fill(R.id.ongoingRow, ongoing);
            fill(R.id.romanceRow, romance);
            if (continueReading == null || continueReading.length() == 0)
                findViewById(R.id.continueHead).setVisibility(android.view.View.GONE);
        }
    }

    private void fill(int id, JSONArray arr) {
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
                row.addView(Views.card(this, mid, title, cover, sub, v -> open(fid, ft, fc)));
            } catch (Exception ignored) {}
        }
    }

    private void open(String id, String title, String cover) {
        Intent i = new Intent(this, ComicDetailActivity.class);
        i.putExtra("id", id);
        i.putExtra("title", title);
        i.putExtra("cover", cover);
        startActivity(i);
    }
}
