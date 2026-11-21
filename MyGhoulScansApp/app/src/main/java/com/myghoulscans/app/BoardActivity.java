package com.myghoulscans.app;

import android.app.Activity;
import android.content.Intent;
import android.os.AsyncTask;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.bumptech.glide.Glide;

import org.json.JSONArray;
import org.json.JSONObject;

public class BoardActivity extends Activity {
    private String mode;
    private LinearLayout list;
    private JSONObject data;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ApiClient.init(this);
        setContentView(R.layout.activity_board);
        mode = getIntent().getStringExtra("mode");
        if (mode == null) mode = "leaderboard";
        list = findViewById(R.id.boardList);
        TextView title = findViewById(R.id.boardTitle);
        String label = mode.equals("shop") ? "RP Shop" : mode.equals("discover") ? "Discover"
                : mode.equals("popular") ? "Popular comics" : mode.equals("originals") ? "Originals" : "Leaderboard";
        title.setText(label);
        findViewById(R.id.boardBack).setOnClickListener(v -> Nav.back(this, HomeActivity.class));
        new AsyncTask<Void, Void, JSONObject>() {
            @Override protected JSONObject doInBackground(Void... unused) {
                try {
                    String path;
                    if (mode.equals("leaderboard")) path = "/leaderboard?by=rp";
                    else if (mode.equals("shop")) path = "/shop";
                    else if (mode.equals("discover")) path = "/comick/genre?source=mangaread&genre=action&page=1&enrich=1";
                    else if (mode.equals("popular")) path = "/comix/home";
                    else path = "/originals";
                    return new JSONObject(ApiClient.get(path));
                } catch (Exception e) { return null; }
            }
            @Override protected void onPostExecute(JSONObject d) { data = d; render(); }
        }.execute();
    }

    private void render() {
        list.removeAllViews();
        TextView info = findViewById(R.id.boardInfo);
        if (data == null) { info.setText("Could not load. Check your connection."); return; }
        if (mode.equals("leaderboard")) {
            info.setText("Top readers by RP");
            JSONArray arr = data.optJSONArray("data");
            if (arr == null) return;
            for (int i = 0; i < arr.length(); i++) {
                try {
                    JSONObject u = arr.getJSONObject(i);
                    String name = (i + 1) + ".  " + u.optString("display_name", "Reader");
                    card(name, u.optInt("value", 0) + " RP", null, null, null, null);
                } catch (Exception ignored) {}
            }
        } else if (mode.equals("shop")) {
            int bal = data.optInt("balance", 0);
            info.setText("Balance: " + bal + " RP");
            JSONArray cat = data.optJSONArray("catalog");
            if (cat == null) return;
            for (int i = 0; i < Math.min(60, cat.length()); i++) {
                try {
                    final JSONObject item = cat.getJSONObject(i);
                    boolean owned = item.optBoolean("owned", false);
                    card(item.optString("name", "Item"), item.optInt("price", 0) + " RP · " + item.optString("slot", ""),
                            null, null, owned ? "Owned" : "Buy", v -> {
                                if (owned) { Toast.makeText(this, "Already owned", Toast.LENGTH_SHORT).show(); return; }
                                buy(item.optString("id", ""));
                            });
                } catch (Exception ignored) {}
            }
        } else if (mode.equals("discover") || mode.equals("popular")) {
            JSONObject inner = data.optJSONObject("data");
            JSONArray arr = mode.equals("popular") ? (inner == null ? null : inner.optJSONArray("trending")) : data.optJSONArray("data");
            if (arr == null) { info.setText("Nothing here yet"); return; }
            info.setText("");
            for (int i = 0; i < Math.min(30, arr.length()); i++) {
                try {
                    JSONObject o = arr.getJSONObject(i);
                    final String id = o.optString("id", ""), t = o.optString("title", "Untitled"), c = o.optString("cover", "");
                    card(t, "Ch. " + o.optString("latestChapterLabel", "" + o.opt("latestChapter")), c, null, "Open", v -> {
                        Intent intent = new Intent(this, ComicDetailActivity.class);
                        intent.putExtra("id", id); intent.putExtra("title", t); intent.putExtra("cover", c);
                        startActivity(intent);
                    });
                } catch (Exception ignored) {}
            }
        } else {
            info.setText("Originals aren't available in the app build.");
        }
    }

    private void card(String title, String sub, String cover, Void unused, String action, View.OnClickListener click) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(android.view.Gravity.CENTER_VERTICAL);
        row.setBackgroundResource(R.drawable.mgs_card);
        row.setPadding(10, 10, 10, 10);
        if (cover != null && !cover.isEmpty()) {
            ImageView img = new ImageView(this);
            img.setScaleType(ImageView.ScaleType.CENTER_CROP);
            Glide.with(this).load(cover).override(140, 180).placeholder(R.mipmap.ic_launcher).into(img);
            img.setLayoutParams(new LinearLayout.LayoutParams(Views.dp(this, 54), Views.dp(this, 72)));
            row.addView(img);
        }
        LinearLayout txt = new LinearLayout(this);
        txt.setOrientation(LinearLayout.VERTICAL);
        txt.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView t = new TextView(this);
        t.setText(title); t.setTextColor(0xFFFFFFFF); t.setTextSize(14);
        t.setMaxLines(2); t.setEllipsize(android.text.TextUtils.TruncateAt.END);
        txt.addView(t);
        TextView s = new TextView(this);
        s.setText(sub); s.setTextColor(0xFF979BA8); s.setTextSize(12);
        txt.addView(s);
        row.addView(txt);
        if (action != null) {
            Button b = new Button(this);
            b.setText(action); b.setTextSize(12);
            b.setOnClickListener(click);
            row.addView(b);
        } else {
            row.setClickable(true);
            row.setOnClickListener(click);
        }
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = 8;
        row.setLayoutParams(lp);
        list.addView(row);
    }

    private void buy(final String id) {
        new AsyncTask<Void, Void, String>() {
            @Override protected String doInBackground(Void... unused) {
                try {
                    JSONObject body = new JSONObject(); body.put("id", id);
                    JSONObject r = new JSONObject(ApiClient.post("/shop/buy", body.toString()));
                    return null;
                } catch (Exception e) { return e.getMessage(); }
            }
            @Override protected void onPostExecute(String err) {
                Toast.makeText(BoardActivity.this, err == null ? "Purchased" : err, Toast.LENGTH_SHORT).show();
                recreate();
            }
        }.execute();
    }
}
