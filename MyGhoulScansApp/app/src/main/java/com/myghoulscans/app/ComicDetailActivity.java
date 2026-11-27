package com.myghoulscans.app;

import android.content.Intent;
import android.os.AsyncTask;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.View;
import android.view.Window;
import android.widget.Button;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import android.app.Dialog;

import androidx.appcompat.app.AppCompatActivity;

import com.bumptech.glide.Glide;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;

public class ComicDetailActivity extends AppCompatActivity {
    private String mangaId, title, cover;
    private String source = "";
    private JSONArray chapters;
    private JSONArray related;
    private JSONArray genres;
    private LinearLayout chapterList;
    private boolean sheetOpen;
    private final java.util.Set<String> selected = new java.util.HashSet<>();
    private int rangeAnchor = -1;
    private final java.util.List<LinearLayout> sheetRows = new java.util.ArrayList<>();
    private final java.util.List<TextView> sheetChecks = new java.util.ArrayList<>();
    private final java.util.List<String> sheetUrls = new java.util.ArrayList<>();
    private int resumeIdx = -1;
    private Dialog sheet;
    private TextView sheetCount, sheetSize;
    private Button batchBtn;
    private boolean bookmarked;
    private boolean descExpanded;
    private String resumeUrl = "";
    private String resumeLabel = "";
    private int resumePage = 0;
    private JSONArray cloudProgress; // fetched off the main thread with the detail data
    private long cloudProgressAt = 0;
    private final java.util.Set<String> bookmarkedRecs = new java.util.HashSet<>();
    private final java.util.Map<String, String> recCounts = new java.util.HashMap<>();
    private boolean newestFirst = false;
    private boolean uploadedAsc = false;
    private boolean groupAsc = false;
    private String chapterFilter = "";
    private boolean showAllChapters = false;
    private final java.util.Set<String> downloaded = new java.util.HashSet<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ApiClient.init(this);
        setContentView(R.layout.activity_comic_detail);
        mangaId = getIntent().getStringExtra("id");
        title = getIntent().getStringExtra("title");
        cover = getIntent().getStringExtra("cover");
        if (mangaId == null) { Nav.home(this); return; }
        chapterList = findViewById(R.id.chapterList);
        ((TextView) findViewById(R.id.detailTitle)).setText(title);
        ((TextView) findViewById(R.id.detailTopTitle)).setText(title);
        if (cover != null && !cover.isEmpty())
            Glide.with(this).load(cover).placeholder(R.mipmap.ic_launcher).into((ImageView) findViewById(R.id.detailCover));
        findViewById(R.id.detailBack).setOnClickListener(v -> Nav.back(this, HomeActivity.class));
        new LoadTask().execute();
        new BookmarkTask().execute();
        loadRecBookmarks();
    }

    @Override protected void onResume() {
        super.onResume();
        new BookmarkTask().execute();
        loadRecBookmarks();
        // Returning from the reader reuses this screen (SINGLE_TOP), so refresh
        // the resume chapter and CTA from the cloud instead of showing stale data.
        if (chapters != null && chapters.length() > 0) new LoadTask().execute();
    }

    /** Load the signed-in user's library once so every recommendation star
     *  starts in the correct (filled or empty) state. */
    private void loadRecBookmarks() {
        if (!ApiClient.isSignedIn()) return;
        new AsyncTask<Void, Void, JSONArray>() {
            @Override protected JSONArray doInBackground(Void... unused) {
                try { return new JSONObject(ApiClient.get("/library")).optJSONArray("mangaIds"); }
                catch (Exception e) { return null; }
            }
            @Override protected void onPostExecute(JSONArray ids) {
                if (ids == null || isFinishing() || isDestroyed()) return;
                for (int i = 0; i < ids.length(); i++) {
                    String s = ids.optString(i, "");
                    if (!s.isEmpty()) bookmarkedRecs.add(s);
                }
                buildRecs();
            }
        }.execute();
    }

    private class BookmarkTask extends AsyncTask<Void, Void, Boolean> {
        @Override protected Boolean doInBackground(Void... unused) {
            return ApiClient.isSignedIn() && ApiClient.isBookmarked(mangaId);
        }
        @Override protected void onPostExecute(Boolean b) { paintBookmark(b); }
    }

    private void paintBookmark(boolean on) {
        bookmarked = on;
        Button b = findViewById(R.id.detailBookmark);
        if (b == null) return;
        b.setText(on ? "✓ In Library" : "Bookmark");
        b.setTextColor(on ? 0xFFFFFFFF : 0xFFFFFFFF);
    }

    private class LoadTask extends AsyncTask<Void, Void, Void> {
        @Override protected Void doInBackground(Void... unused) {
            String path = "/comick/title?id=" + q(mangaId);
            String raw = ApiClient.getCached(path, 10 * 60 * 1000);
            if (raw != null) {
                try {
                    JSONObject d = new JSONObject(raw).optJSONObject("data");
                    if (d != null) {
                        final String t = d.optString("title", title);
                        final String c = d.optString("cover", cover);
                        final String s = d.optString("source", "");
                        final String st = d.optString("status", "");
                        source = s;
                        final String desc = d.optString("description", "");
                        final JSONArray gs = d.optJSONArray("genres");
                        genres = gs;
                        runOnUiThread(() -> {
                            if (isFinishing() || isDestroyed()) return;
                            title = t; cover = c;
                            ((TextView) findViewById(R.id.detailTitle)).setText(t);
                            ((TextView) findViewById(R.id.detailTopTitle)).setText(t);
                            String src = s;
                            if (!st.isEmpty()) src = (src.isEmpty() ? "" : src + " · ") + prettyStatus(st);
                            ((TextView) findViewById(R.id.detailSource)).setText(src);
                            final TextView dsc = (TextView) findViewById(R.id.detailDesc);
                            dsc.setText(desc);
                            dsc.setMaxLines(3);
                            dsc.setEllipsize(android.text.TextUtils.TruncateAt.END);
                            Button more = findViewById(R.id.detailMore);
                            more.setVisibility(desc.isEmpty() ? View.GONE : View.VISIBLE);
                            more.setText("More v");
                            more.setOnClickListener(v -> {
                                descExpanded = !descExpanded;
                                dsc.setMaxLines(descExpanded ? Integer.MAX_VALUE : 3);
                                dsc.setEllipsize(descExpanded ? null : android.text.TextUtils.TruncateAt.END);
                                more.setText(descExpanded ? "Less ^" : "More v");
                            });
                            LinearLayout pills = findViewById(R.id.detailGenres);
                            pills.removeAllViews();
                            if (gs != null) {
                                for (int i = 0; i < gs.length(); i++) {
                                    final String g = gs.optString(i, "");
                                    if (g.isEmpty()) continue;
                                    Button b = new Button(ComicDetailActivity.this);
                                    b.setText(g);
                                    b.setTextSize(11);
                                    b.setAllCaps(false);
                                    b.setTextColor(0xFFBBBBBB);
                                    b.setBackgroundResource(R.drawable.mgs_card);
                                    b.setPadding(Views.dp(ComicDetailActivity.this, 8), Views.dp(ComicDetailActivity.this, 4),
                                            Views.dp(ComicDetailActivity.this, 8), Views.dp(ComicDetailActivity.this, 4));
                                    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                                            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                                    lp.rightMargin = Views.dp(ComicDetailActivity.this, 6);
                                    b.setLayoutParams(lp);
                                    b.setOnClickListener(v -> Toast.makeText(ComicDetailActivity.this, g, Toast.LENGTH_SHORT).show());
                                    pills.addView(b);
                                }
                            }
                            if (c != null && !c.isEmpty())
                                Glide.with(getApplicationContext()).load(ApiClient.imgUrl(c)).placeholder(R.mipmap.ic_launcher)
                                        .into((ImageView) findViewById(R.id.detailCover));
                        });
                    }
                } catch (Exception ignored) {}
            }
            String chRaw = ApiClient.getCached("/comick/chapters?id=" + q(mangaId), 60 * 1000);
            if (chRaw != null) {
                try { chapters = new JSONObject(chRaw).optJSONArray("data"); } catch (Exception ignored) {}
            }
            // Cloud progress must be read off the UI thread (real network call).
            if (ApiClient.isSignedIn()) cloudProgress = ApiClient.progress();
            // related (More like this) — try every genre slugified
            // ("Martial Arts" → martial-arts), source by source, so the row
            // is never empty.
            try {
                java.util.List<String> slugs = new java.util.ArrayList<>();
                if (genres != null) {
                    for (int i = 0; i < genres.length(); i++) {
                        String g = genres.optString(i, "");
                        String slug = g.trim().toLowerCase().replaceAll("\\s+", "-").replaceAll("[^a-z0-9-]", "");
                        if (!slug.isEmpty() && !slugs.contains(slug)) slugs.add(slug);
                    }
                }
                if (slugs.isEmpty()) slugs.add("action");
                String[] srcs = new String[] { source, "mangaread" };
                outer:
                for (String src : srcs) {
                    if (src == null || src.isEmpty()) continue;
                    for (String slug : slugs) {
                        String rRaw = ApiClient.getCached("/comick/genre?source=" + src + "&genre=" + slug + "&page=1&enrich=1", 30 * 60 * 1000);
                        if (rRaw == null) continue;
                        try {
                            JSONArray d = new JSONObject(rRaw).optJSONArray("data");
                            if (d != null && d.length() > 0) { related = d; break outer; }
                        } catch (Exception ignored) {}
                    }
                }
                // Last resort: the always-populated action list.
                if (related == null || related.length() == 0) {
                    String rRaw = ApiClient.getCached("/comick/genre?source=mangaread&genre=action&page=1&enrich=1", 30 * 60 * 1000);
                    if (rRaw != null) {
                        try { related = new JSONObject(rRaw).optJSONArray("data"); } catch (Exception ignored) {}
                    }
                }
            } catch (Exception ignored) {}
            return null;
        }
        @Override protected void onPostExecute(Void v) {
            if (isFinishing() || isDestroyed()) return;
            if (chapters == null) chapters = new JSONArray();
            ((TextView) findViewById(R.id.detailCount)).setText(chapters.length() + " chapters");
            if (cloudProgress != null) {
                JSONArray pr = cloudProgress;
                if (pr != null) {
                    for (int i = 0; i < pr.length(); i++) {
                        try {
                            JSONObject p = pr.getJSONObject(i);
                            if (mangaId.equals(p.optString("manga_id", ""))) {
                                resumeUrl = p.optString("chapter_id", "");
                                resumePage = p.optInt("page", 0);
                                resumeLabel = p.optString("chapter_label", "");
                                try {
                                    java.text.SimpleDateFormat f = new java.text.SimpleDateFormat(
                                            "yyyy-MM-dd HH:mm:ss", java.util.Locale.US);
                                    f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                                    cloudProgressAt = f.parse(p.optString("updated_at", "")).getTime();
                                } catch (Exception ignored) {}
                                for (int j = 0; j < chapters.length(); j++) {
                                    try {
                                        if (chapters.getJSONObject(j).optString("url", "").equals(resumeUrl)) { resumeIdx = j; break; }
                                    } catch (Exception ignored) {}
                                }
                                // URLs can differ slightly between feeds — fall back to
                                // matching the saved chapter number.
                                if (resumeIdx < 0) {
                                    double want = firstNum(resumeLabel);
                                    if (want <= 0) want = firstNum(resumeUrl);
                                    for (int j = 0; j < chapters.length() && want > 0; j++) {
                                        try {
                                            JSONObject cj = chapters.getJSONObject(j);
                                            double got = firstNum(String.valueOf(cj.opt("number")));
                                            if (got <= 0) got = firstNum(cj.optString("url", ""));
                                            if (got == want) { resumeUrl = cj.optString("url", ""); resumeIdx = j; break; }
                                        } catch (Exception ignored) {}
                                    }
                                }
                                break;
                            }
                        } catch (Exception ignored) {}
                    }
                }
            }
            // The reader writes its chapter locally on every sync. If that is
            // newer than the cloud row (e.g. the save was still in flight when
            // the user left), use it — otherwise a fast chapter change can look
            // like it reverted several chapters.
            android.content.SharedPreferences lr = getSharedPreferences("mgs_reader", MODE_PRIVATE);
            String localUrl = lr.getString("chapterUrl", "");
            long localAt = lr.getLong("at", 0);
            boolean preferLocal = mangaId.equals(lr.getString("mangaId", ""))
                    && !localUrl.isEmpty() && localAt > cloudProgressAt;
            if (preferLocal || resumeIdx < 0) {
                if (mangaId.equals(lr.getString("mangaId", ""))) {
                    for (int j = 0; j < chapters.length(); j++) {
                        try {
                            if (chapters.getJSONObject(j).optString("url", "").equals(localUrl)) {
                                resumeUrl = localUrl; resumeIdx = j;
                                resumePage = lr.getInt("page", 0);
                                Object ln = chapters.getJSONObject(j).opt("number");
                                resumeLabel = "Ch. " + (ln == null ? "?" : ln);
                                break;
                            }
                        } catch (Exception ignored) {}
                    }
                }
            }
            showProgress();
            downloaded.clear();
            try {
                JSONArray titles = DownloadStore.listTitles(ComicDetailActivity.this);
                for (int i = 0; i < titles.length(); i++) {
                    JSONObject t = titles.optJSONObject(i);
                    if (t == null || !mangaId.equals(t.optString("mangaId", ""))) continue;
                    JSONArray cs = t.optJSONArray("chapters");
                    if (cs == null) continue;
                    for (int j = 0; j < cs.length(); j++) {
                        JSONObject c = cs.optJSONObject(j);
                        if (c != null) downloaded.add(c.optString("chapterUrl", c.optString("url", "")));
                    }
                }
            } catch (Exception ignored) {}
            Button sort = findViewById(R.id.chapterSort);
            sort.setOnClickListener(x -> { newestFirst = !newestFirst; renderChapters(); });
            ((Button) findViewById(R.id.chapterUploadedSort)).setOnClickListener(x -> {
                uploadedAsc = !uploadedAsc; renderChapters();
            });
            ((Button) findViewById(R.id.chapterGroup)).setOnClickListener(x -> {
                groupAsc = !groupAsc; renderChapters();
            });
            ((android.widget.EditText) findViewById(R.id.chapterGoto)).addTextChangedListener(
                    new android.text.TextWatcher() {
                        public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
                        public void onTextChanged(CharSequence s, int a, int b, int c) {}
                        public void afterTextChanged(android.text.Editable s) {
                            chapterFilter = s == null ? "" : s.toString().trim();
                            renderChapters();
                        }
                    });
            Button showAll = findViewById(R.id.chapterShowAll);
            showAll.setOnClickListener(x -> { showAllChapters = !showAllChapters; renderChapters(); });
            renderChapters();
            buildRecs();
            Button readBtn = (Button) findViewById(R.id.detailRead);
            if (resumeIdx >= 0 && resumeUrl != null && !resumeUrl.isEmpty()) {
                String num = "?";
                try { Object n = chapters.getJSONObject(resumeIdx).opt("number"); num = n == null ? "?" : String.valueOf(n); } catch (Exception ignored) {}
                readBtn.setText("Continue Ch. " + num);
            } else {
                readBtn.setText("Read First");
            }
            readBtn.setOnClickListener(click -> {
                if (chapters.length() == 0) { Toast.makeText(ComicDetailActivity.this, "No chapters", Toast.LENGTH_SHORT).show(); return; }
                String url = (resumeIdx >= 0 && resumeUrl != null && !resumeUrl.isEmpty())
                        ? resumeUrl
                        : chapters.optJSONObject(0).optString("url", "");
                openOnline(url);
            });
            findViewById(R.id.detailBookmark).setOnClickListener(click -> toggleBookmark());
            findViewById(R.id.detailDownloadAll).setOnClickListener(click -> openSheet());
        }
    }

    /** First number in a label/URL — used only as a resume-matching fallback. */
    private static double firstNum(String s) {
        if (s == null) return 0;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(\\d+(?:\\.\\d+)?)").matcher(s);
        if (!m.find()) return 0;
        try { return Double.parseDouble(m.group(1)); } catch (Exception e) { return 0; }
    }

    private void showProgress() {
        if (cloudProgress == null || chapters == null || chapters.length() == 0) return;
        JSONArray pr = cloudProgress;
        for (int i = 0; i < pr.length(); i++) {
            try {
                JSONObject p = pr.getJSONObject(i);
                if (mangaId.equals(p.optString("manga_id", ""))) {
                    String label = resumeLabel.isEmpty() ? p.optString("chapter_label", "Ch. ?") : resumeLabel;
                    ((TextView) findViewById(R.id.detailProgress)).setText("Resume " + label);
                    return;
                }
            } catch (Exception ignored) {}
        }
    }

    private void toggleBookmark() {
        if (!ApiClient.isSignedIn()) { Toast.makeText(this, "Sign in to bookmark", Toast.LENGTH_SHORT).show(); return; }
        final boolean target = !bookmarked;
        new AsyncTask<Void, Void, Boolean>() {
            @Override protected Boolean doInBackground(Void... unused) {
                ApiClient.bookmark(mangaId, target);
                return target;
            }
            @Override protected void onPostExecute(Boolean b) {
                paintBookmark(b);
                Toast.makeText(ComicDetailActivity.this, b ? "Added to Library" : "Removed from Library", Toast.LENGTH_SHORT).show();
            }
        }.execute();
    }

    private void buildRecs() {
        LinearLayout row = findViewById(R.id.detailRecs);
        if (row == null) return;
        row.removeAllViews();
        if (related == null) return;
        int max = Math.min(20, related.length());
        for (int i = 0; i < max; i++) {
            try {
                JSONObject r = related.getJSONObject(i);
                final String rid = r.optString("id", "");
                if (rid.isEmpty() || rid.equals(mangaId)) continue;
                final String rtitle = r.optString("title", "Untitled");
                final String rcover = r.optString("cover", "");
                LinearLayout card = new LinearLayout(this);
                card.setOrientation(LinearLayout.VERTICAL);
                card.setPadding(6, 6, 6, 6);
                card.setClickable(true);
                card.setFocusable(true);
                card.setBackgroundResource(R.drawable.mgs_card);
                ImageView img = new ImageView(this);
                img.setScaleType(ImageView.ScaleType.CENTER_CROP);
                Glide.with(getApplicationContext()).load(ApiClient.imgUrl(rcover)).override(120, 160).placeholder(R.mipmap.ic_launcher).error(R.mipmap.ic_launcher).into(img);
                img.setLayoutParams(new LinearLayout.LayoutParams(Views.dp(this, 124), Views.dp(this, 168)));
                card.addView(img);
                TextView t = new TextView(this);
                t.setText(rtitle);
                t.setTextColor(0xFFFFFFFF);
                t.setTextSize(11);
                t.setMaxLines(2);
                t.setEllipsize(android.text.TextUtils.TruncateAt.END);
                t.setLayoutParams(new LinearLayout.LayoutParams(Views.dp(this, 124), ViewGroup.LayoutParams.WRAP_CONTENT));
                card.addView(t);
                LinearLayout meta = new LinearLayout(this);
                meta.setOrientation(LinearLayout.HORIZONTAL);
                meta.setGravity(android.view.Gravity.CENTER_VERTICAL);
                meta.setLayoutParams(new LinearLayout.LayoutParams(Views.dp(this, 124), ViewGroup.LayoutParams.WRAP_CONTENT));
                TextView rt = new TextView(this);
                String chapterCount = recCounts.containsKey(rid) ? recCounts.get(rid) : recCountOf(r);
                rt.setText(chapterCount.isEmpty() ? "Ch. …" : "Ch. " + chapterCount);
                rt.setTextColor(0xFF979BA8);
                rt.setTextSize(9);
                rt.setSingleLine(true);
                rt.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
                meta.addView(rt);
                if (chapterCount.isEmpty()) fetchRecCount(rid, rt);

                final Button bm = new Button(this);
                paintRecStar(bm, rid);
                bm.setTextSize(16);
                bm.setAllCaps(false);
                bm.setBackgroundResource(android.R.color.transparent);
                bm.setPadding(0, 0, 0, 0);
                bm.setContentDescription("Bookmark " + rtitle);
                bm.setOnClickListener(v -> {
                    if (!ApiClient.isSignedIn()) { Toast.makeText(ComicDetailActivity.this, "Sign in to bookmark", Toast.LENGTH_SHORT).show(); return; }
                    boolean now = !bookmarkedRecs.contains(rid);
                    final boolean save = now;
                    new Thread(() -> ApiClient.bookmark(rid, save)).start(); // never on the UI thread
                    if (now) bookmarkedRecs.add(rid); else bookmarkedRecs.remove(rid);
                    paintRecStar(bm, rid);
                    Toast.makeText(ComicDetailActivity.this, now ? "Added to library" : "Removed from library", Toast.LENGTH_SHORT).show();
                });
                meta.addView(bm);
                card.addView(meta);
                card.setOnClickListener(v -> openDetail(rid, rtitle, rcover));
                LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                clp.rightMargin = Views.dp(this, 8);
                card.setLayoutParams(clp);
                row.addView(card);
            } catch (Exception ignored) {}
        }
    }

    /** Chapter count supplied by the feed (empty when the source omits it). */
    private static String recCountOf(JSONObject r) {
        String s = r.optString("latestChapterLabel", "");
        if (s.isEmpty()) {
            Object ch = r.opt("latestChapter");
            if (ch != null) {
                try { int n = Integer.parseInt(String.valueOf(ch)); if (n > 0) s = String.valueOf(n); }
                catch (Exception ignored) {}
            }
        }
        return s.replaceAll("[^0-9]", "");
    }

    /** Some sources return no chapter count at all — ask the chapters endpoint. */
    private void fetchRecCount(final String rid, final TextView label) {
        new Thread(() -> {
            String count = "";
            try {
                String raw = ApiClient.getCached("/comick/chapters?id=" + q(rid), 10 * 60 * 1000);
                JSONArray arr = raw == null ? null : new JSONObject(raw).optJSONArray("data");
                if (arr != null && arr.length() > 0) count = String.valueOf(arr.length());
            } catch (Exception ignored) {}
            final String found = count;
            if (!found.isEmpty()) recCounts.put(rid, found);
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed() || label == null) return;
                label.setText(found.isEmpty() ? "Ch. ?" : "Ch. " + found);
            });
        }).start();
    }

    private void paintRecStar(Button star, String rid) {
        boolean on = bookmarkedRecs.contains(rid);
        star.setText(on ? "★" : "☆");
        star.setTextColor(on ? 0xFFE11D2E : 0xFF979BA8);
    }

    private static void upText(JSONObject c, TextView v) {
        Object u = c.opt("uploads");
        int n = u == null ? 2 : (int) (u instanceof Number ? ((Number) u).longValue() : firstNum(String.valueOf(u)));
        v.setText(n + "↑");
    }

    private static String timeAgoApp(long ts) {
        long s = Math.max(0, (System.currentTimeMillis() - ts) / 1000);
        if (s < 60) return "just now";
        long m = s / 60; if (m < 60) return m + " mins";
        long h = m / 60; if (h < 24) return h + " hours";
        long d = h / 24; if (d < 30) return d + " days";
        long mo = d / 30; if (mo < 12) return mo + " months";
        return (mo / 12) + " years";
    }

    private void openDetail(String id, String title, String cover) {
        Intent i = new Intent(this, ComicDetailActivity.class);
        i.putExtra("id", id); i.putExtra("title", title); i.putExtra("cover", cover);
        startActivity(i);
    }

    private void renderChapters() {
        if (chapterList == null || chapters == null) return;
        chapterList.removeAllViews();
        int n = chapters.length();
        java.util.List<JSONObject> list = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            try {
                JSONObject c = chapters.getJSONObject(i);
                String num = String.valueOf(c.opt("number"));
                if (!chapterFilter.isEmpty() && !num.contains(chapterFilter)) continue;
                list.add(c);
            } catch (Exception ignored) {}
        }
        java.util.Collections.sort(list, (a, b) -> {
            if (uploadedAsc) return Long.compare(a.optLong("date", 0), b.optLong("date", 0));
            double an = firstNum(String.valueOf(a.opt("number"))), bn = firstNum(String.valueOf(b.opt("number")));
            return newestFirst ? Double.compare(an, bn) : Double.compare(bn, an);
        });
        int limit = showAllChapters ? list.size() : Math.min(6, list.size());
        for (int k = 0; k < limit; k++) {
            try { chapterList.addView(chapterRow(list.get(k))); } catch (Exception ignored) {}
        }
        TextView foot = findViewById(R.id.chapterFooter);
        if (foot != null) foot.setText("Showing 1 to " + limit + " of " + list.size() + " items");
        Button sa = findViewById(R.id.chapterShowAll);
        if (sa == null) return;
        if (list.size() > 6) {
            sa.setVisibility(View.VISIBLE);
            sa.setText(showAllChapters ? "Show less" : "See all (" + list.size() + ")");
        } else {
            sa.setVisibility(View.GONE);
        }
        if (!downloaded.isEmpty()) {
            Button delAll = findViewById(R.id.chapterDeleteAll);
            if (delAll == null) {
                delAll = new Button(this);
                delAll.setId(R.id.chapterDeleteAll);
                delAll.setText("Delete all downloaded");
                delAll.setTextSize(12);
                delAll.setAllCaps(false);
                delAll.setTextColor(0xFFE11D2E);
                delAll.setBackgroundResource(R.drawable.mgs_card);
                delAll.setOnClickListener(v ->
                        new android.app.AlertDialog.Builder(this)
                                .setTitle("Delete downloads")
                                .setMessage("Delete all downloaded chapters of this comic?")
                                .setPositiveButton("Delete", (d, w) -> {
                                    for (String u : new ArrayList<>(downloaded)) DownloadStore.deleteChapter(this, mangaId, u);
                                    downloaded.clear();
                                    renderChapters();
                                    Toast.makeText(this, "Downloads deleted", Toast.LENGTH_SHORT).show();
                                })
                                .setNegativeButton("Cancel", null)
                                .show());
                ((ViewGroup) chapterList.getParent()).addView(delAll);
            }
            delAll.setVisibility(View.VISIBLE);
        }
    }

    private LinearLayout chapterRow(JSONObject c) {
        final String url = c.optString("url", "");
        String label = "Ch. " + (c.opt("number") == null ? "?" : c.opt("number"));
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(android.view.Gravity.CENTER_VERTICAL);
        row.setPadding(Views.dp(this, 12), Views.dp(this, 10), Views.dp(this, 8), Views.dp(this, 10));
        row.setBackgroundResource(R.drawable.mgs_card);
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rp.bottomMargin = Views.dp(this, 4);
        row.setLayoutParams(rp);

        TextView flag = new TextView(this);
        flag.setText("🇬🇧");
        flag.setTextSize(12);
        flag.setPadding(0, 0, Views.dp(this, 4), 0);
        row.addView(flag);

        TextView t = new TextView(this);
        t.setText(label);
        t.setTextColor(0xFFFFFFFF);
        t.setTextSize(12);
        t.setSingleLine(true);
        t.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.3f));
        row.addView(t);

        TextView up = new TextView(this);
        upText(c, up);
        up.setTextColor(0xFF979BA8);
        up.setTextSize(10);
        up.setPadding(Views.dp(this, 2), 0, Views.dp(this, 2), 0);
        row.addView(up);

        TextView date = new TextView(this);
        long ts = c.optLong("date", 0);
        date.setText(ts > 0 ? timeAgoApp(ts) : "");
        date.setTextColor(0xFF979BA8);
        date.setTextSize(10);
        date.setPadding(Views.dp(this, 2), 0, Views.dp(this, 2), 0);
        row.addView(date);

        TextView grp = new TextView(this);
        grp.setText(source == null || source.isEmpty() ? "Mangakakalot" : source);
        grp.setTextColor(0xFF5B8DEF);
        grp.setTextSize(10);
        grp.setSingleLine(true);
        grp.setMaxLines(1);
        grp.setEllipsize(android.text.TextUtils.TruncateAt.END);
        grp.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        row.addView(grp);

        boolean isDl = downloaded.contains(url);
        TextView st = new TextView(this);
        st.setText(isDl ? "✓" : "↓");
        st.setTextColor(isDl ? 0xFF2ECC71 : 0xFF979BA8);
        st.setTextSize(12);
        st.setPadding(Views.dp(this, 6), 0, Views.dp(this, 6), 0);
        row.addView(st);

        if (isDl) {
            Button del = new Button(this);
            del.setText("x");
            del.setTextSize(12);
            del.setTextColor(0xFFE11D2E);
            del.setBackgroundResource(android.R.color.transparent);
            del.setPadding(Views.dp(this, 4), 0, Views.dp(this, 4), 0);
            del.setOnClickListener(v -> {
                DownloadStore.deleteChapter(this, mangaId, url);
                downloaded.remove(url);
                renderChapters();
                Toast.makeText(this, "Deleted download", Toast.LENGTH_SHORT).show();
            });
            row.addView(del);
        }

        row.setOnClickListener(v -> openOnline(url));
        row.setOnLongClickListener(v -> {
            if (!ApiClient.isSignedIn()) { Toast.makeText(this, "Sign in to download", Toast.LENGTH_SHORT).show(); return true; }
            JSONArray one = new JSONArray();
            one.put(chapterPayload(c));
            startDownload(one);
            return true;
        });
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

    // ---------- Batch download sheet ----------
    private void openSheet() {
        if (chapters == null || chapters.length() == 0) { Toast.makeText(this, "No chapters", Toast.LENGTH_SHORT).show(); return; }
        selected.clear();
        rangeAnchor = -1;
        sheetRows.clear();
        sheetChecks.clear();
        sheetUrls.clear();
        Dialog d = new Dialog(this);
        d.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF121218);
        LinearLayout pills = new LinearLayout(this);
        pills.setOrientation(LinearLayout.HORIZONTAL);
        pills.setPadding(12, 12, 12, 8);
        Button pAll = new Button(this); pAll.setText("Select All (" + chapters.length() + ")"); pAll.setTextSize(12); pAll.setAllCaps(false);
        pAll.setOnClickListener(v -> selectAll());
        Button p10 = new Button(this); p10.setText("Next 10"); p10.setTextSize(12); p10.setAllCaps(false);
        p10.setOnClickListener(v -> selectN(10));
        Button p25 = new Button(this); p25.setText("Next 25"); p25.setTextSize(12); p25.setAllCaps(false);
        p25.setOnClickListener(v -> selectN(25));
        Button punread = new Button(this); punread.setText("Unread"); punread.setTextSize(12); punread.setAllCaps(false);
        punread.setOnClickListener(v -> selectUnread());
        Button pclear = new Button(this); pclear.setText("Clear"); pclear.setTextSize(12); pclear.setAllCaps(false);
        pclear.setOnClickListener(v -> { selected.clear(); refreshSheet(d); });
        pills.addView(pAll); pills.addView(p10); pills.addView(p25); pills.addView(punread); pills.addView(pclear);
        HorizontalScrollView pillScroll = new HorizontalScrollView(this);
        pillScroll.setPadding(0, 0, 0, 0);
        pillScroll.addView(pills, new HorizontalScrollView.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(pillScroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        ScrollView sv = new ScrollView(this);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        for (int i = 0; i < chapters.length(); i++) {
            try {
                final JSONObject c = chapters.getJSONObject(i);
                final int idx = i;
                final String url = c.optString("url", "");
                final String label = "Ch. " + (c.opt("number") == null ? "?" : c.opt("number"));
                LinearLayout row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setGravity(android.view.Gravity.CENTER_VERTICAL);
                row.setPadding(14, 12, 14, 12);
                row.setBackgroundColor(0xFF1C1C24);
                TextView check = new TextView(this);
                check.setText(selected.contains(url) ? "✓" : "○");
                check.setTextSize(18);
                check.setTextColor(selected.contains(url) ? 0xFFE11D2E : 0xFF979BA8);
                check.setOnClickListener(v -> toggleSel(idx));
                sheetRows.add(row);
                sheetChecks.add(check);
                sheetUrls.add(url);
                TextView lbl = new TextView(this);
                lbl.setText(label);
                lbl.setTextColor(0xFFFFFFFF);
                lbl.setTextSize(14);
                lbl.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
                row.addView(check);
                row.addView(lbl);
                TextView size = new TextView(this);
                size.setText(chapterSizeLabel(i));
                size.setTextColor(0xFF979BA8);
                size.setTextSize(12);
                row.addView(size);
                row.setOnClickListener(v -> selectOrToggle(idx));
                row.setOnLongClickListener(v -> { rangeAnchor = idx; return true; });
                list.addView(row, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            } catch (Exception ignored) {}
        }
        sv.addView(list, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(sv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        LinearLayout footer = new LinearLayout(this);
        footer.setOrientation(LinearLayout.HORIZONTAL);
        footer.setPadding(14, 14, 14, 16);
        sheetCount = new TextView(this);
        sheetCount.setText("0 chapters selected");
        sheetCount.setTextColor(0xFF979BA8);
        sheetCount.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        sheetSize = new TextView(this);
        sheetSize.setText("");
        sheetSize.setTextColor(0xFF2ECC71);
        sheetSize.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button dlBtn = batchBtn = new Button(this);
        dlBtn.setText("Download");
        dlBtn.setTextSize(14);
        dlBtn.setAllCaps(false);
        dlBtn.setTextColor(0xFFFFFFFF);
        dlBtn.setBackgroundResource(R.drawable.mgs_accent_button);
        dlBtn.setOnClickListener(v -> confirmSheet());
        footer.addView(sheetCount);
        footer.addView(sheetSize);
        footer.addView(dlBtn);
        root.addView(footer, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        d.setContentView(root);
        d.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        sheet = d;
        d.show();
        refreshSheet(d);
    }

    private void toggleSel(int i) {
        try { String url = chapters.getJSONObject(i).optString("url", ""); if (selected.contains(url)) selected.remove(url); else selected.add(url); }
        catch (Exception ignored) {}
        refreshSheet(sheet);
    }

    private void selectOrToggle(int i) {
        if (rangeAnchor >= 0) {
            int a = Math.min(rangeAnchor, i), b = Math.max(rangeAnchor, i);
            selected.clear();
            for (int j = a; j <= b; j++) { try { selected.add(chapters.getJSONObject(j).optString("url", "")); } catch (Exception ignored) {} }
            rangeAnchor = -1;
        } else {
            toggleSel(i);
        }
        if (sheet != null) refreshSheet(sheet);
    }

    private void selectN(int n) {
        selected.clear();
        int start = resumeIdx + 1;
        if (start < 0) start = 0;
        int end = Math.min(chapters.length(), start + n);
        for (int i = start; i < end; i++) { try { selected.add(chapters.getJSONObject(i).optString("url", "")); } catch (Exception ignored) {} }
        if (sheet != null) refreshSheet(sheet);
    }

    private void selectAll() {
        selected.clear();
        for (int i = 0; i < chapters.length(); i++) { try { selected.add(chapters.getJSONObject(i).optString("url", "")); } catch (Exception ignored) {} }
        if (sheet != null) refreshSheet(sheet);
    }

    private void selectUnread() {
        selected.clear();
        for (int i = 0; i < chapters.length(); i++) {
            try {
                String url = chapters.getJSONObject(i).optString("url", "");
                if (!DownloadStore.isRead(this, mangaId, url)) selected.add(url);
            } catch (Exception ignored) {}
        }
        if (sheet != null) refreshSheet(sheet);
    }

    private void refreshSheet(Dialog d) {
        // Repaint every row so taps/pills visibly highlight the selection.
        for (int i = 0; i < sheetRows.size(); i++) {
            boolean on = i < sheetUrls.size() && selected.contains(sheetUrls.get(i));
            sheetRows.get(i).setBackgroundColor(on ? 0xFF3A141B : 0xFF1C1C24);
            sheetChecks.get(i).setText(on ? "✓" : "○");
            sheetChecks.get(i).setTextColor(on ? 0xFFE11D2E : 0xFF979BA8);
        }
        int n = selected.size();
        sheetCount.setText(n + " chapter" + (n == 1 ? "" : "s") + " selected");
        long bytes = 0;
        int known = 0;
        for (int i = 0; i < chapters.length(); i++) {
            try {
                JSONObject c = chapters.getJSONObject(i);
                String url = c.optString("url", "");
                if (!selected.contains(url)) continue;
                File meta = DownloadStore.chapterMeta(this, mangaId, url);
                if (meta.exists()) {
                    JSONObject m = new JSONObject(DownloadStore.read(meta));
                    long b = m.optLong("bytes", 0);
                    if (b > 0) { bytes += b; known++; }
                }
            } catch (Exception ignored) {}
        }
        long est = (long) (Math.max(0, n - known) * 5.4 * 1024 * 1024);
        sheetSize.setText("Est. " + DownloadStore.readable(bytes + est) + " · " + freeStorage() + " Free");
        Button dlBtn = batchBtn;
        if (dlBtn != null) { dlBtn.setEnabled(n > 0); dlBtn.setText("Confirm Download"); }
    }

    private String chapterSizeLabel(int i) {
        try {
            JSONObject c = chapters.getJSONObject(i);
            String url = c.optString("url", "");
            File meta = DownloadStore.chapterMeta(this, mangaId, url);
            if (meta.exists()) {
                JSONObject m = new JSONObject(DownloadStore.read(meta));
                long b = m.optLong("bytes", 0);
                if (b > 0) return DownloadStore.readable(b);
            }
            Object n = c.opt("number");
            double num = n == null ? (i + 1) : Double.parseDouble(String.valueOf(n));
            double estMb = 4.0 + ((num * 7) % 25) / 10.0;
            return String.format("~%.1f MB", estMb);
        } catch (Exception e) { return ""; }
    }

    private String freeStorage() {
        try {
            android.os.StatFs s = new android.os.StatFs(android.os.Environment.getDataDirectory().getPath());
            return DownloadStore.readable(s.getAvailableBytes());
        } catch (Exception e) { return "?"; }
    }

    private void confirmSheet() {
        if (selected.isEmpty()) { Toast.makeText(this, "Select chapters first", Toast.LENGTH_SHORT).show(); return; }
        JSONArray list = new JSONArray();
        for (int i = 0; i < chapters.length(); i++) {
            try {
                JSONObject c = chapters.getJSONObject(i);
                String u = c.optString("url", "");
                if (!selected.contains(u)) continue;
                JSONObject p = new JSONObject();
                p.put("url", u);
                p.put("num", c.opt("number") == null ? "" : String.valueOf(c.opt("number")));
                p.put("label", "Ch. " + (c.opt("number") == null ? "?" : c.opt("number")));
                list.put(p);
            } catch (Exception ignored) {}
        }
        if (list.length() == 0) { Toast.makeText(this, "No chapters selected", Toast.LENGTH_SHORT).show(); return; }
        if (sheet != null) sheet.dismiss();
        sheetOpen = false;
        startDownload(list);
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
        // Always use the native reader (offline copy if downloaded, network otherwise)
        // — never bounce the user out to the website WebView.
        try {
            Intent i = new Intent(this, ReaderActivity.class);
            i.putExtra("mangaId", mangaId);
            i.putExtra("chapterUrl", chapterUrl);
            i.putExtra("returnTitle", title);
            i.putExtra("returnCover", cover);
            startActivity(i);
        } catch (Exception ignored) {}
    }

    private static String q(String s) {
        try { return ApiClient.q(s); } catch (Exception e) { return ""; }
    }

    private static String prettyStatus(String s) {
        if (s == null || s.isEmpty()) return "";
        String t = s.replace('_', ' ').replace('-', ' ').trim();
        StringBuilder out = new StringBuilder();
        for (String w : t.split("\\s+")) {
            if (w.isEmpty()) continue;
            if (out.length() > 0) out.append(' ');
            out.append(Character.toUpperCase(w.charAt(0))).append(w.substring(1).toLowerCase());
        }
        return out.toString();
    }
}
