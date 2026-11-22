package com.myghoulscans.app;

import android.content.Context;
import android.content.Intent;
import android.os.AsyncTask;
import android.os.Bundle;
import android.view.Gravity;
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

import java.util.ArrayList;
import java.util.List;

/** Library: Webtoon-style table (Title / Continue / Status / Last Read / Updated / Added). */
public class LibraryActivity extends AppCompatActivity {
    private LinearLayout list;
    private List<JSONObject> items = new ArrayList<>();
    private String typeFilter = "All types";
    private String statusFilter = "All status";
    private String loadError;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ApiClient.init(this);
        setContentView(R.layout.activity_library);
        Nav.attach(this, 2);
        list = findViewById(R.id.libraryList);

        findViewById(R.id.libType).setOnClickListener(v -> choose("All types",
                new String[]{"All types", "Manhua", "Manga", "Manhwa", "Oneshot"}, picked -> {
            typeFilter = picked; paint();
        }));
        findViewById(R.id.libStatus).setOnClickListener(v -> choose("All status",
                new String[]{"All status", "OnGoing", "Completed", "On Hiatus"}, picked -> {
            statusFilter = picked; paint();
        }));
        findViewById(R.id.libClear).setOnClickListener(v ->
                new android.app.AlertDialog.Builder(this)
                        .setTitle("Clear library")
                        .setMessage("Remove every comic from your library?")
                        .setPositiveButton("Clear all", (d, w) -> {
                            new AsyncTask<Void, Void, Void>() {
                                @Override protected Void doInBackground(Void... u) {
                                    try { ApiClient.del("/library"); } catch (Exception ignored) {}
                                    return null;
                                }
                                @Override protected void onPostExecute(Void x) { items.clear(); paint(); }
                            }.execute();
                        })
                        .setNegativeButton("Cancel", null)
                        .show());

        if (!ApiClient.isSignedIn()) {
            TextView t = new TextView(this);
            t.setText("Sign in to see your library");
            t.setTextColor(0xFF979BA8);
            t.setGravity(Gravity.CENTER);
            t.setPadding(0, 60, 0, 0);
            list.addView(t);
            return;
        }
        new LoadTask().execute();
    }

    private interface Pick { void onPick(String value); }

    private void choose(String title, String[] opts, final Pick cb) {
        new android.app.AlertDialog.Builder(this)
                .setTitle(title)
                .setItems(opts, (d, which) -> cb.onPick(opts[which]))
                .show();
    }

    private class LoadTask extends AsyncTask<Void, Void, List<JSONObject>> {
        @Override protected List<JSONObject> doInBackground(Void... unused) {
            List<JSONObject> out = new ArrayList<>();
            String lib = ApiClient.getCached("/library", 30000);
            if (lib == null) { loadError = "Could not load library"; return out; }
            JSONArray ids;
            JSONObject added = new JSONObject();
            try {
                JSONObject l = new JSONObject(lib);
                ids = l.optJSONArray("mangaIds");
                added = l.optJSONObject("added");
            } catch (Exception e) { loadError = e.getMessage(); return out; }
            if (ids == null) return out;

            JSONObject progress = new JSONObject();
            try {
                JSONArray pr = ApiClient.progress();
                if (pr != null) for (int i = 0; i < pr.length(); i++) {
                    JSONObject p = pr.getJSONObject(i);
                    progress.put(p.optString("manga_id", ""), p);
                }
            } catch (Exception ignored) {}

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
                    c.put("type", t == null ? "" : t.optString("type", ""));
                    String st = t == null ? "" : t.optString("status", "");
                    c.put("status", prettyStatus(st));
                    c.put("rawStatus", st);
                    c.put("updated", t == null ? "" : t.optString("latestChapter", ""));
                    JSONObject p = progress.optJSONObject(id);
                    if (p != null) {
                        c.put("continueLabel", p.optString("chapter_label", "Ch. 1"));
                        c.put("lastRead", relTime(p.optString("updated_at", "")));
                    } else {
                        c.put("continueLabel", "Start Ch. 1");
                        c.put("lastRead", "—");
                    }
                    c.put("added", relTime(added != null && added.has(id) ? added.optString(id, "") : ""));
                } catch (Exception e) {
                    try {
                        c.put("id", id); c.put("title", id); c.put("cover", "");
                        c.put("type", ""); c.put("status", "—"); c.put("rawStatus", "");
                        c.put("updated", ""); c.put("continueLabel", "Start Ch. 1");
                        c.put("lastRead", "—"); c.put("added", "");
                    } catch (Exception ignored) {}
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
                list.addView(t);
            }
            paint();
        }
    }

    private void paint() {
        list.removeAllViews();
        if (!ApiClient.isSignedIn()) return;
        int shown = 0;
        for (JSONObject o : items) {
            try {
                String type = o.optString("type", "");
                String rawStatus = o.optString("rawStatus", "");
                if (!"All types".equals(typeFilter) && !typeFilter.equalsIgnoreCase(type)) continue;
                if (!"All status".equals(statusFilter)) {
                    String want = "OnGoing".equals(statusFilter) ? "ongoing" : statusFilter.toLowerCase().replace(" ", "");
                    String have = rawStatus.toLowerCase().replace("_", "").replace("-", "");
                    if (!have.contains(want.replace(" ", ""))) continue;
                }
                list.addView(row(o));
                shown++;
            } catch (Exception ignored) {}
        }
        if (shown == 0) {
            TextView t = new TextView(this);
            t.setText(items.isEmpty() ? "Your library is empty — bookmark comics to see them here."
                    : "No comics match these filters.");
            t.setTextColor(0xFF979BA8);
            t.setGravity(Gravity.CENTER);
            t.setPadding(0, 50, 0, 0);
            list.addView(t);
        }
    }

    private LinearLayout row(JSONObject o) {
        final String id = o.optString("id", "");
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.setPadding(Views.dp(this, 6), Views.dp(this, 8), Views.dp(this, 4), Views.dp(this, 8));
        r.setBackgroundResource(R.drawable.mgs_card);
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rp.bottomMargin = Views.dp(this, 4);
        r.setLayoutParams(rp);

        ImageView cover = new ImageView(this);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        Glide.with(this).load(ApiClient.imgUrl(o.optString("cover", ""))).override(80, 112)
                .placeholder(R.mipmap.ic_launcher).error(R.mipmap.ic_launcher).into(cover);
        cover.setLayoutParams(new LinearLayout.LayoutParams(Views.dp(this, 38), Views.dp(this, 54)));
        r.addView(cover);

        TextView title = new TextView(this);
        String t = o.optString("title", "Untitled");
        String ty = o.optString("type", "");
        title.setText(ty.isEmpty() ? t : t + "  ·  " + ty);
        title.setTextColor(0xFFFFFFFF);
        title.setTextSize(11);
        title.setMaxLines(2);
        title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        title.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 2.6f));
        r.addView(title);

        TextView cont = new TextView(this);
        cont.setText(o.optString("continueLabel", "Start Ch. 1"));
        cont.setTextColor(0xFF2ECC71);
        cont.setTextSize(10);
        cont.setMaxLines(1);
        cont.setEllipsize(android.text.TextUtils.TruncateAt.END);
        cont.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.2f));
        r.addView(cont);

        addCell(r, o.optString("status", "—"), 0.8f, 0xFFBBBBBB);
        addCell(r, o.optString("lastRead", "—"), 0.9f, 0xFF979BA8);
        addCell(r, o.optString("updated", ""), 0.8f, 0xFF979BA8);
        addCell(r, o.optString("added", ""), 0.9f, 0xFF979BA8);

        Button del = new Button(this);
        del.setText("x");
        del.setTextSize(12);
        del.setAllCaps(false);
        del.setTextColor(0xFF979BA8);
        del.setBackgroundResource(android.R.color.transparent);
        del.setPadding(Views.dp(this, 6), 0, Views.dp(this, 6), 0);
        del.setOnClickListener(v -> {
            ApiClient.bookmark(id, false);
            items.remove(o);
            paint();
            Toast.makeText(this, "Removed", Toast.LENGTH_SHORT).show();
        });
        del.setLayoutParams(new LinearLayout.LayoutParams(Views.dp(this, 24), ViewGroup.LayoutParams.WRAP_CONTENT));
        r.addView(del);

        r.setOnClickListener(v -> {
            Intent i = new Intent(this, ComicDetailActivity.class);
            i.putExtra("id", id);
            i.putExtra("title", o.optString("title", ""));
            i.putExtra("cover", o.optString("cover", ""));
            startActivity(i);
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

    private static String prettyStatus(String s) {
        if (s == null || s.isEmpty()) return "—";
        String t = s.replace('_', ' ').replace('-', ' ').trim().toLowerCase();
        if (t.contains("ongo")) return "OnGoing";
        if (t.contains("complete") || t.contains("finish")) return "Completed";
        if (t.contains("hiatus") || t.contains("pause")) return "On Hiatus";
        if (t.isEmpty()) return "—";
        return Character.toUpperCase(t.charAt(0)) + t.substring(1);
    }

    private static String relTime(String iso) {
        if (iso == null || iso.isEmpty()) return "";
        try {
            java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.US);
            java.util.Date d = f.parse(iso.replace('T', ' ').substring(0, Math.min(19, iso.length())));
            long diff = System.currentTimeMillis() - d.getTime();
            long days = diff / 86400000L;
            if (days <= 0) return "today";
            if (days == 1) return "1 day ago";
            return days + " days ago";
        } catch (Exception e) { return ""; }
    }

    @Override
    public void onBackPressed() { Nav.home(this); }
}
