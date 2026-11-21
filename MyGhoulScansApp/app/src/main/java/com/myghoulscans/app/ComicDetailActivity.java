package com.myghoulscans.app;

import android.content.Intent;
import android.os.AsyncTask;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.View;
import android.view.Window;
import android.widget.Button;
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

public class ComicDetailActivity extends AppCompatActivity {
    private String mangaId, title, cover;
    private JSONArray chapters;
    private LinearLayout chapterList;
    private boolean sheetOpen;
    private final java.util.Set<String> selected = new java.util.HashSet<>();
    private int rangeAnchor = -1;
    private int resumeIdx = -1;
    private Dialog sheet;
    private TextView sheetCount, sheetSize;
    private Button batchBtn;
    private boolean bookmarked;
    private JSONArray genres;
    private boolean descExpanded;
    private String resumeUrl = "";
    private int resumePage = 0;
    private boolean newestFirst = false;
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
    }

    @Override protected void onResume() { super.onResume(); new BookmarkTask().execute(); }

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
        b.setText(on ? "★ In Library" : "☆ Bookmark");
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
                        final String desc = d.optString("description", "");
                        final JSONArray gs = d.optJSONArray("genres");
                        genres = gs;
                        runOnUiThread(() -> {
                            title = t; cover = c;
                            ((TextView) findViewById(R.id.detailTitle)).setText(t);
                            ((TextView) findViewById(R.id.detailTopTitle)).setText(t);
                            String src = s;
                            if (!st.isEmpty()) src = (src.isEmpty() ? "" : src + " · ") + prettyStatus(st);
                            ((TextView) findViewById(R.id.detailSource)).setText(src);
                            final TextView dsc = (TextView) findViewById(R.id.detailDesc);
                            dsc.setText(desc);
                            dsc.setMaxLines(3);
                            Button more = findViewById(R.id.detailMore);
                            more.setText("More ⌄");
                            more.setOnClickListener(v -> {
                                descExpanded = !descExpanded;
                                dsc.setMaxLines(descExpanded ? Integer.MAX_VALUE : 3);
                                more.setText(descExpanded ? "Less ⌃" : "More ⌄");
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
                                Glide.with(ComicDetailActivity.this).load(c).placeholder(R.mipmap.ic_launcher)
                                        .into((ImageView) findViewById(R.id.detailCover));
                        });
                    }
                } catch (Exception ignored) {}
            }
            String chRaw = ApiClient.getCached("/comick/chapters?id=" + q(mangaId), 60 * 1000);
            if (chRaw != null) {
                try { chapters = new JSONObject(chRaw).optJSONArray("data"); } catch (Exception ignored) {}
            }
            return null;
        }
        @Override protected void onPostExecute(Void v) {
            if (chapters == null) chapters = new JSONArray();
            ((TextView) findViewById(R.id.detailCount)).setText(chapters.length() + " chapters");
            if (ApiClient.isSignedIn()) {
                JSONArray pr = ApiClient.progress();
                if (pr != null) {
                    for (int i = 0; i < pr.length(); i++) {
                        try {
                            JSONObject p = pr.getJSONObject(i);
                            if (mangaId.equals(p.optString("manga_id", ""))) {
                                resumeUrl = p.optString("chapter_id", "");
                                resumePage = p.optInt("page", 0);
                                for (int j = 0; j < chapters.length(); j++) {
                                    try {
                                        if (chapters.getJSONObject(j).optString("url", "").equals(resumeUrl)) { resumeIdx = j; break; }
                                    } catch (Exception ignored) {}
                                }
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
            sort.setText(newestFirst ? "Oldest ↑" : "Newest ↓");
            sort.setOnClickListener(x -> { newestFirst = !newestFirst; sort.setText(newestFirst ? "Oldest ↑" : "Newest ↓"); renderChapters(); });
            Button showAll = findViewById(R.id.chapterShowAll);
            showAll.setOnClickListener(x -> { showAllChapters = !showAllChapters; renderChapters(); });
            renderChapters();
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

    private void showProgress() {
        if (!ApiClient.isSignedIn() || chapters == null || chapters.length() == 0) return;
        JSONArray pr = ApiClient.progress();
        if (pr == null) return;
        for (int i = 0; i < pr.length(); i++) {
            try {
                JSONObject p = pr.getJSONObject(i);
                if (mangaId.equals(p.optString("manga_id", ""))) {
                    String label = p.optString("chapter_label", "Ch. ?");
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

    private void renderChapters() {
        if (chapterList == null || chapters == null) return;
        chapterList.removeAllViews();
        int n = chapters.length();
        int limit = showAllChapters ? n : Math.min(5, n);
        for (int k = 0; k < limit; k++) {
            int i = newestFirst ? (n - 1 - k) : k;
            try { chapterList.addView(chapterRow(chapters.getJSONObject(i))); } catch (Exception ignored) {}
        }
        Button sa = findViewById(R.id.chapterShowAll);
        if (sa == null) return;
        if (n > 5) {
            sa.setVisibility(View.VISIBLE);
            sa.setText(showAllChapters ? "Show Less ⌃" : "Show All " + n + " Chapters ⌄");
        } else {
            sa.setVisibility(View.GONE);
        }
    }

    private LinearLayout chapterRow(JSONObject c) {
        final String url = c.optString("url", "");
        String label = "Ch. " + (c.opt("number") == null ? "?" : c.opt("number"));
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(10, 10, 10, 10);
        row.setBackgroundColor(0xFF1C1C24);
        TextView t = new TextView(this);
        t.setText(label + "  " + c.optString("title", ""));
        t.setTextColor(0xFFFFFFFF);
        t.setTextSize(14);
        t.setMaxLines(1);
        t.setEllipsize(android.text.TextUtils.TruncateAt.END);
        t.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        row.addView(t);

        TextView st = new TextView(this);
        boolean isDl = downloaded.contains(url);
        st.setText(isDl ? "✓" : "↓");
        st.setTextColor(isDl ? 0xFF2ECC71 : 0xFF979BA8);
        st.setTextSize(13);
        st.setPadding(6, 0, 6, 0);
        row.addView(st);

        Button read = new Button(this);
        read.setText("Read");
        read.setTextSize(12);
        read.setOnClickListener(v -> openOnline(url));
        row.addView(read);

        Button dl = new Button(this);
        dl.setText("↓");
        dl.setTextSize(14);
        dl.setOnClickListener(v -> {
            if (!ApiClient.isSignedIn()) { Toast.makeText(this, "Sign in to download", Toast.LENGTH_SHORT).show(); return; }
            JSONArray one = new JSONArray();
            one.put(chapterPayload(c));
            startDownload(one);
        });
        row.addView(dl);

        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rp.bottomMargin = 8;
        row.setLayoutParams(rp);
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
        root.addView(pills, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

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
        try {
            String url = "https://ghoulforlife.github.io/MyGhoulScans/#/reader/" + mangaId
                    + "/" + java.net.URLEncoder.encode(chapterUrl, "UTF-8") + "/0";
            Intent i = new Intent(this, MainActivity.class);
            i.putExtra("url", url);
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
