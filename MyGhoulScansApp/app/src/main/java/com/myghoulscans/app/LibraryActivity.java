package com.myghoulscans.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.os.AsyncTask;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.bumptech.glide.Glide;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Library: 3-column cover grid, filter pills, search and progress badges. */
public class LibraryActivity extends AppCompatActivity {
    private static final String[] FILTERS = {"All", "Reading", "Unread", "Completed"};
    private LinearLayout grid, filters;
    private EditText search;
    private String filter = "All";
    private List<JSONObject> items = new ArrayList<>();
    private Set<String> readingIds = new HashSet<>();
    private String loadError;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ApiClient.init(this);
        setContentView(R.layout.activity_library);
        Nav.attach(this, 2);
        grid = findViewById(R.id.libraryGrid);
        filters = findViewById(R.id.libFilters);
        search = findViewById(R.id.libSearch);

        for (String f : FILTERS) {
            Button b = new Button(this);
            b.setText(f);
            b.setTextSize(12);
            b.setAllCaps(false);
            b.setTag(f);
            b.setOnClickListener(v -> { filter = f; paintFilters(); paint(); });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.rightMargin = 6;
            b.setLayoutParams(lp);
            filters.addView(b);
        }
        paintFilters();

        search.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            public void onTextChanged(CharSequence s, int a, int b, int c) {}
            public void afterTextChanged(Editable s) { paint(); }
        });

        if (!ApiClient.isSignedIn()) {
            Button signIn = new Button(this);
            signIn.setText("Sign in to see your library");
            signIn.setBackgroundResource(R.drawable.mgs_accent_button);
            signIn.setTextColor(0xFFFFFFFF);
            signIn.setOnClickListener(v -> startActivity(new Intent(this, LoginActivity.class)));
            grid.addView(signIn);
            return;
        }
        new LoadTask().execute();
    }

    private void paintFilters() {
        for (int i = 0; i < filters.getChildCount(); i++) {
            Button b = (Button) filters.getChildAt(i);
            boolean on = filter.equals(b.getTag());
            b.setBackgroundResource(on ? R.drawable.mgs_accent_button : R.drawable.mgs_card);
            b.setTextColor(0xFFFFFFFF);
        }
    }

    private class LoadTask extends AsyncTask<Void, Void, List<JSONObject>> {
        @Override protected List<JSONObject> doInBackground(Void... unused) {
            List<JSONObject> out = new ArrayList<>();
            String lib = ApiClient.getCached("/library", 30000);
            if (lib == null) { loadError = "Could not load library"; return out; }
            JSONArray ids;
            try { ids = new JSONObject(lib).optJSONArray("mangaIds"); }
            catch (Exception e) { loadError = e.getMessage(); return out; }
            if (ids == null) return out;

            JSONArray pr = ApiClient.progress();
            if (pr != null) {
                for (int i = 0; i < pr.length(); i++) {
                    try { readingIds.add(pr.getJSONObject(i).optString("manga_id", "")); }
                    catch (Exception ignored) {}
                }
            }
            for (int i = 0; i < ids.length(); i++) {
                String id = ids.optString(i, "");
                if (id.isEmpty()) continue;
                JSONObject c = new JSONObject();
                try {
                    String raw = ApiClient.getCached("/comick/title?id=" + ApiClient.q(id), 10 * 60 * 1000);
                    JSONObject t = raw == null ? null : new JSONObject(raw).optJSONObject("data");
                    c.put("id", id);
                    c.put("title", t == null ? id : t.optString("title", "Untitled"));
                    c.put("cover", t == null ? "" : t.optString("cover", ""));
                    c.put("status", t == null ? "" : t.optString("status", ""));
                    c.put("reading", pr != null && readingIds.contains(id));
                    // find progress label
                    String pl = "";
                    if (pr != null) {
                        for (int j = 0; j < pr.length(); j++) {
                            JSONObject p = pr.getJSONObject(j);
                            if (id.equals(p.optString("manga_id", ""))) {
                                pl = p.optString("chapter_label", "");
                                break;
                            }
                        }
                    }
                    c.put("progressLabel", pl);
                } catch (Exception e) {
                    try { c.put("id", id); c.put("title", id); c.put("cover", ""); c.put("status", ""); }
                    catch (Exception ignored) {}
                }
                out.add(c);
            }
            return out;
        }
        @Override protected void onPostExecute(List<JSONObject> result) {
            items = result;
            if (loadError != null) {
                TextView t = new TextView(LibraryActivity.this);
                t.setText("Could not load: " + loadError);
                t.setTextColor(0xFFE11D2E);
                grid.addView(t);
            }
            paint();
        }
    }

    private void paint() {
        if (!ApiClient.isSignedIn()) return;
        grid.removeAllViews();
        String q = search.getText().toString().trim().toLowerCase();
        List<JSONObject> shown = new ArrayList<>();
        for (JSONObject o : items) {
            try {
                String title = o.optString("title", "").toLowerCase();
                if (!q.isEmpty() && !title.contains(q)) continue;
                String status = o.optString("status", "");
                boolean read = o.optBoolean("reading", false);
                if ("Reading".equals(filter) && !read) continue;
                if ("Unread".equals(filter) && read) continue;
                if ("Completed".equals(filter) && !status.toLowerCase().contains("complete")) continue;
                shown.add(o);
            } catch (Exception ignored) {}
        }
        if (shown.isEmpty()) {
            TextView t = new TextView(this);
            t.setText(items.isEmpty() ? "Your library is empty — bookmark comics to see them here."
                    : "No comics match this filter.");
            t.setTextColor(0xFF979BA8);
            t.setGravity(Gravity.CENTER);
            t.setPadding(0, 50, 0, 0);
            grid.addView(t);
            return;
        }
        LinearLayout row = null;
        for (int i = 0; i < shown.size(); i++) {
            if (i % 3 == 0) { row = new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL); }
            final JSONObject o = shown.get(i);
            row.addView(card(o), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            if (i % 3 == 2 || i == shown.size() - 1) {
                grid.addView(row);
                row = null;
            }
        }
    }

    private LinearLayout card(JSONObject o) {
        final String id = o.optString("id", ""), title = o.optString("title", "Untitled"), cover = o.optString("cover", "");
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setBackgroundResource(R.drawable.mgs_card);
        c.setPadding(4, 4, 4, 8);
        c.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        ImageView img = new ImageView(this);
        img.setScaleType(ImageView.ScaleType.CENTER_CROP);
        Glide.with(this).load(cover).override(180, 250).placeholder(R.mipmap.ic_launcher).error(R.mipmap.ic_launcher).into(img);
        img.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Views.dp(this, 120)));
        c.addView(img);

        TextView t = new TextView(this);
        t.setText(title);
        t.setTextColor(0xFFFFFFFF);
        t.setTextSize(11);
        t.setMaxLines(2);
        t.setEllipsize(android.text.TextUtils.TruncateAt.END);
        t.setPadding(3, 4, 3, 0);
        c.addView(t);

        TextView p = new TextView(this);
        String pl = o.optString("progressLabel", "");
        p.setText(pl.isEmpty() ? (o.optBoolean("reading", false) ? "Reading" : "Unread") : pl);
        p.setTextColor(o.optBoolean("reading", false) ? 0xFF2ECC71 : 0xFF979BA8);
        p.setTextSize(10);
        p.setSingleLine(true);
        p.setEllipsize(android.text.TextUtils.TruncateAt.END);
        p.setPadding(3, 1, 3, 0);
        c.addView(p);

        final String ct = title, cc = cover;
        c.setOnClickListener(v -> {
            Intent i = new Intent(this, ComicDetailActivity.class);
            i.putExtra("id", id); i.putExtra("title", ct); i.putExtra("cover", cc);
            startActivity(i);
        });
        c.setOnLongClickListener(v -> {
            ApiClient.bookmark(id, false);
            items.remove(o);
            paint();
            Toast.makeText(this, "Removed from Library", Toast.LENGTH_SHORT).show();
            return true;
        });
        return c;
    }

    @Override
    public void onBackPressed() { Nav.home(this); }
}
