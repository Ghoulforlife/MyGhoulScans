package com.myghoulscans.app;

import android.app.Activity;
import android.content.Intent;
import android.os.AsyncTask;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.bumptech.glide.Glide;

import org.json.JSONObject;

public class ProfileActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ApiClient.init(this);
        setContentView(R.layout.activity_profile);
        findViewById(R.id.profileBack).setOnClickListener(v -> Nav.back(this, MoreActivity.class));

        LinearLayout grid = findViewById(R.id.profileGrid);
        gridRow(grid, "⚙", "Settings", "👤", "Account", MainActivity.class, "#/account", MainActivity.class, "#/account");
        gridRow(grid, "💬", "Discord", "🏆", "Leaderboard", null, "discord", BoardActivity.class, "leaderboard");
        gridRow(grid, "🛒", "RP Shop", "✨", "Discover", BoardActivity.class, "shop", BoardActivity.class, "discover");
        gridRow(grid, "☆", "Library", "↓", "Downloads", LibraryActivity.class, null, DownloadsActivity.class, null);
        Button logout = new Button(this);
        logout.setText("Log out");
        logout.setTextSize(14);
        logout.setBackgroundResource(R.drawable.mgs_card);
        logout.setTextColor(0xFFE11D2E);
        logout.setOnClickListener(v -> {
            ApiClient.setToken("");
            ApiClient.setUser(new JSONObject());
            Nav.home(this);
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = 12;
        logout.setLayoutParams(lp);
        grid.addView(logout);

        findViewById(R.id.shopCta).setOnClickListener(v -> {
            Intent i = new Intent(this, BoardActivity.class);
            i.putExtra("mode", "shop");
            startActivity(i);
        });

        paint(ApiClient.user());
        new StatsTask().execute();
    }

    private void gridRow(LinearLayout parent, String i1, String l1, String i2, String l2,
                         Class<?> c1, String e1, Class<?> c2, String e2) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.addView(action(i1 + "  " + l1, c1, e1));
        row.addView(action(i2 + "  " + l2, c2, e2));
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rp.bottomMargin = 8;
        row.setLayoutParams(rp);
        parent.addView(row);
    }

    private Button action(String label, final Class<?> cls, final String extra) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextSize(13);
        b.setAllCaps(false);
        b.setBackgroundResource(R.drawable.mgs_card);
        b.setTextColor(0xFFFFFFFF);
        b.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        b.setOnClickListener(v -> {
            if ("discord".equals(extra)) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://discord.gg/7UcfZmYTX"))); }
                catch (Exception ignored) {}
                return;
            }
            if (cls == null) return;
            Intent i = new Intent(this, cls);
            if (extra != null) {
                if (extra.startsWith("#")) i.putExtra("url", "https://ghoulforlife.github.io/MyGhoulScans/" + extra);
                else i.putExtra("mode", extra);
            }
            startActivity(i);
        });
        return b;
    }

    private class StatsTask extends AsyncTask<Void, Void, JSONObject> {
        @Override protected JSONObject doInBackground(Void... unused) { return ApiClient.stats(); }
        @Override protected void onPostExecute(JSONObject s) {
            if (s == null) return;
            ((TextView) findViewById(R.id.statChapters)).setText(String.valueOf(s.optInt("chapters", 0)));
            int streak = getSharedPreferences("mgs_read", MODE_PRIVATE).getInt("streak", 0);
            ((TextView) findViewById(R.id.statStreak)).setText(String.valueOf(streak));
        }
    }

    private void paint(JSONObject u) {
        if (u == null) return;
        ((TextView) findViewById(R.id.profileName)).setText(u.optString("display_name", "Reader"));
        ((TextView) findViewById(R.id.profileEmail)).setText(u.optString("email", ""));
        ((TextView) findViewById(R.id.profileRp)).setText(String.valueOf(u.optInt("rp", 0)));
        String av = ApiClient.avatarUrl(u);
        if (av != null && !av.isEmpty())
            Glide.with(this).load(av).placeholder(R.mipmap.ic_launcher).error(R.mipmap.ic_launcher)
                    .into((ImageView) findViewById(R.id.profileAvatar));
    }
}
