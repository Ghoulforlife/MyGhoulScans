package com.myghoulscans.app;

import android.content.Intent;
import android.os.AsyncTask;
import android.os.Bundle;
import android.view.View;
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

public class SearchActivity extends AppCompatActivity {
    private EditText input;
    private LinearLayout results;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ApiClient.init(this);
        setContentView(R.layout.activity_search);
        Nav.attach(this, 1);
        input = findViewById(R.id.searchText);
        results = findViewById(R.id.searchResults);
        findViewById(R.id.searchBack).setOnClickListener(v -> finish());
        findViewById(R.id.searchGo).setOnClickListener(v -> search());
        input.setOnEditorActionListener((v, actionId, event) -> { search(); return true; });
    }

    private void search() {
        final String q = input.getText().toString().trim();
        if (q.isEmpty()) { Toast.makeText(this, "Type a title", Toast.LENGTH_SHORT).show(); return; }
        new AsyncTask<Void, Void, JSONArray>() {
            @Override protected JSONArray doInBackground(Void... unused) {
                try { return new JSONObject(ApiClient.get("/comick/search?q=" + ApiClient.q(q))).optJSONArray("data"); }
                catch (Exception e) { return null; }
            }
            @Override protected void onPostExecute(JSONArray arr) {
                results.removeAllViews();
                if (arr == null || arr.length() == 0) {
                    TextView t = new TextView(SearchActivity.this);
                    t.setText("No results for “" + q + "”");
                    t.setTextColor(0xFF979BA8);
                    t.setPadding(8, 30, 8, 8);
                    results.addView(t);
                    return;
                }
                for (int i = 0; i < arr.length(); i++) {
                    try { results.addView(resultRow(arr.getJSONObject(i))); } catch (Exception ignored) {}
                }
            }
        }.execute();
    }

    private View resultRow(JSONObject o) {
        String id = o.optString("id", "");
        String title = o.optString("title", "Untitled");
        String cover = o.optString("cover", "");
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(8, 10, 8, 10);
        row.setBackgroundColor(0xFF1C1C24);

        ImageView img = new ImageView(this);
        img.setScaleType(ImageView.ScaleType.CENTER_CROP);
        Glide.with(this).load(cover).override(160, 220)
                .placeholder(R.mipmap.ic_launcher).error(R.mipmap.ic_launcher).into(img);
        LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(Views.dp(this, 66), Views.dp(this, 88));
        img.setLayoutParams(ip);
        row.addView(img);

        LinearLayout txt = new LinearLayout(this);
        txt.setOrientation(LinearLayout.VERTICAL);
        txt.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        txt.setPadding(12, 0, 0, 0);
        TextView t = new TextView(this);
        t.setText(title);
        t.setTextColor(0xFFFFFFFF);
        t.setTextSize(14);
        t.setMaxLines(2);
        t.setEllipsize(android.text.TextUtils.TruncateAt.END);
        txt.addView(t);
        TextView s = new TextView(this);
        Object ch = o.opt("latestChapter");
        s.setText(o.optString("source", "") + (ch == null ? "" : " · Ch. " + ch));
        s.setTextColor(0xFF979BA8);
        s.setTextSize(12);
        txt.addView(s);
        row.addView(txt);

        final String fid = id, ft = title, fc = cover;
        row.setOnClickListener(v -> {
            Intent i = new Intent(this, ComicDetailActivity.class);
            i.putExtra("id", fid);
            i.putExtra("title", ft);
            i.putExtra("cover", fc);
            startActivity(i);
        });
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rp.bottomMargin = 8;
        row.setLayoutParams(rp);
        return row;
    }
}
