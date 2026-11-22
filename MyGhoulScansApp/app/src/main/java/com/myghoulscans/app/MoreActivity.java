package com.myghoulscans.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

public class MoreActivity extends Activity {
    private static final String SITE = "https://ghoulforlife.github.io/MyGhoulScans/";
    private LinearLayout list;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ApiClient.init(this);
        setContentView(R.layout.activity_more);
        Nav.attach(this, 4);
        list = findViewById(R.id.moreList);
        list.removeAllViews();

        // Header card
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackgroundResource(R.drawable.mgs_card);
        card.setPadding(20, 20, 20, 20);
        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(android.view.Gravity.CENTER_VERTICAL);
        ImageView avatar = new ImageView(this);
        avatar.setImageResource(R.mipmap.ic_launcher);
        avatar.setLayoutParams(new LinearLayout.LayoutParams(Views.dp(this, 52), Views.dp(this, 52)));
        top.addView(avatar);
        LinearLayout txt = new LinearLayout(this);
        txt.setOrientation(LinearLayout.VERTICAL);
        txt.setPadding(14, 0, 0, 0);
        JSONObject me = ApiClient.user();
        TextView name = new TextView(this);
        name.setText(ApiClient.isSignedIn() ? me.optString("display_name", "Reader") : "Guest");
        name.setTextColor(0xFFFFFFFF);
        name.setTextSize(18);
        name.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        txt.addView(name);
        TextView sub = new TextView(this);
        int streak = getSharedPreferences("mgs_read", MODE_PRIVATE).getInt("streak", 0);
        sub.setText(ApiClient.isSignedIn()
                ? "★ " + me.optInt("rp", 0) + " RP · " + streak + " day streak · connected"
                : "Sign in to sync library & progress");
        sub.setTextColor(ApiClient.isSignedIn() ? 0xFFF1C40F : 0xFF979BA8);
        sub.setTextSize(12);
        txt.addView(sub);
        if (ApiClient.isSignedIn()) {
            String av = ApiClient.avatarUrl(me);
            com.bumptech.glide.Glide.with(this).load(av).placeholder(R.mipmap.ic_launcher)
                    .error(R.mipmap.ic_launcher).into(avatar);
        }
        top.addView(txt, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        card.addView(top);

        Button auth = new Button(this);
        auth.setText(ApiClient.isSignedIn() ? "Account settings" : "Sign up / Log in");
        auth.setTextColor(0xFFFFFFFF);
        auth.setTextSize(14);
        auth.setAllCaps(false);
        auth.setBackgroundResource(R.drawable.mgs_accent_button);
        LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        ap.topMargin = 18;
        auth.setLayoutParams(ap);
        auth.setOnClickListener(v -> {
            if (ApiClient.isSignedIn()) go(ProfileActivity.class);
            else startActivity(new Intent(this, LoginActivity.class));
        });
        card.addView(auth);
        list.addView(card, margins(0, 0, 0, 20));

        section("ACCOUNT");
        row("👤", "Profile & account", () -> go(ProfileActivity.class));
        row("☆", "My Library", () -> go(LibraryActivity.class));
        row("↓", "Downloads", () -> go(DownloadsActivity.class));
        if (ApiClient.isSignedIn()) {
            row("↪", "Log out", () -> {
                ApiClient.setToken("");
                Toast.makeText(this, "Signed out", Toast.LENGTH_SHORT).show();
                recreate();
            });
        }

        section("DISCOVER");
        row("🏆", "Leaderboard", () -> board("leaderboard"));
        row("🛒", "RP Shop", () -> board("shop"));
        row("✨", "Discover", () -> board("discover"));
        row("🔥", "Popular comics", () -> board("popular"));
        row("📖", "Originals", () -> board("originals"));

        section("APP");
        row("⚙", "Settings / Theme", () -> go(ProfileActivity.class));
        row("💬", "Join Discord", () -> {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://discord.gg/7UcfZmYTX"))); }
            catch (Exception ignored) {}
        });
        row("ℹ", "About MyGhoulScans", () ->
                Toast.makeText(this, "MyGhoulScans v4.0 — free, ad-free reader", Toast.LENGTH_SHORT).show());

        TextView footer = new TextView(this);
        footer.setText("MyGhoulScans · v4.0");
        footer.setTextColor(0xFF666672);
        footer.setTextSize(11);
        footer.setGravity(android.view.Gravity.CENTER);
        footer.setPadding(0, 20, 0, 10);
        list.addView(footer);
    }

    private LinearLayout.LayoutParams margins(int l, int t, int r, int b) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(l, t, r, b);
        return lp;
    }

    private void section(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextColor(0xFF979BA8);
        t.setTextSize(11);
        t.setAllCaps(true);
        t.setPadding(4, 16, 4, 8);
        list.addView(t);
    }

    private void row(String icon, String label, Runnable click) {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(android.view.Gravity.CENTER_VERTICAL);
        r.setBackgroundResource(R.drawable.mgs_card);
        r.setPadding(14, 12, 14, 12);
        r.setClickable(true);
        r.setFocusable(true);

        TextView ic = new TextView(this);
        ic.setText(icon);
        ic.setTextSize(17);
        ic.setPadding(0, 0, 12, 0);
        r.addView(ic);

        TextView t = new TextView(this);
        t.setText(label);
        t.setTextColor(0xFFFFFFFF);
        t.setTextSize(14);
        t.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        r.addView(t);

        TextView arrow = new TextView(this);
        arrow.setText("›");
        arrow.setTextColor(0xFF666672);
        arrow.setTextSize(20);
        r.addView(arrow);

        r.setOnClickListener(v -> click.run());
        list.addView(r, margins(0, 0, 0, 8));
    }

    private void board(String mode) {
        Intent i = new Intent(this, BoardActivity.class);
        i.putExtra("mode", mode);
        startActivity(i);
    }

    private void web(String route) {
        Intent i = new Intent(this, MainActivity.class);
        i.putExtra("url", SITE + route);
        startActivity(i);
    }

    private void go(Class<?> cls) {
        startActivity(new Intent(this, cls));
        finish();
    }

    @Override
    public void onBackPressed() { Nav.home(this); }
}
