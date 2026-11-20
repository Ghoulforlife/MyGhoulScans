package com.myghoulscans.app;

import android.app.Activity;
import android.content.Intent;
import android.os.AsyncTask;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.bumptech.glide.Glide;

import org.json.JSONObject;

public class ProfileActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ApiClient.init(this);
        setContentView(R.layout.activity_profile);
        findViewById(R.id.profileBack).setOnClickListener(v -> finish());
        LinearLayout actions = findViewById(R.id.profileActions);
        action(actions, "☆  My Library", LibraryActivity.class);
        action(actions, "↓  Downloads", DownloadsActivity.class);
        action(actions, "🏆  Leaderboard", BoardActivity.class, "leaderboard");
        action(actions, "🛒  RP Shop", BoardActivity.class, "shop");
        action(actions, "⚙  Edit profile / settings (website)", MainActivity.class, "#/account");
        new AsyncTask<Void, Void, JSONObject>() {
            @Override protected JSONObject doInBackground(Void... unused) { return ApiClient.refreshMe(); }
            @Override protected void onPostExecute(JSONObject u) { paint(u); }
        }.execute();
        paint(ApiClient.user());
    }

    private void paint(JSONObject u) {
        if (u == null) return;
        ((TextView) findViewById(R.id.profileName)).setText(u.optString("display_name", "Reader"));
        ((TextView) findViewById(R.id.profileEmail)).setText(u.optString("email", ""));
        ((TextView) findViewById(R.id.profileRp)).setText(u.optInt("rp", 0) + " RP");
        String av = ApiClient.avatarUrl(u);
        if (av != null && !av.isEmpty())
            Glide.with(this).load(av).placeholder(R.mipmap.ic_launcher).error(R.mipmap.ic_launcher)
                    .into((ImageView) findViewById(R.id.profileAvatar));
    }

    private void action(LinearLayout parent, String label, Class<?> cls) { action(parent, label, cls, null); }

    private void action(LinearLayout parent, String label, Class<?> cls, String extra) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextSize(14);
        b.setAllCaps(false);
        b.setBackgroundResource(R.drawable.mgs_card);
        b.setOnClickListener(v -> {
            Intent i = new Intent(this, cls);
            if (extra != null) {
                if (extra.startsWith("#")) i.putExtra("url", "https://ghoulforlife.github.io/MyGhoulScans/" + extra);
                else i.putExtra("mode", extra);
            }
            startActivity(i);
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = 8;
        b.setLayoutParams(lp);
        parent.addView(b);
    }
}
