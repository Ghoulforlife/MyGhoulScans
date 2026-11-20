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
        TextView name = new TextView(this);
        name.setText(ApiClient.isSignedIn() ? "MyGhoulScans Reader" : "Guest");
        name.setTextColor(0xFFFFFFFF);
        name.setTextSize(18);
        name.setStyle(android.graphics.Typeface.BOLD);
        txt.addView(name);
        TextView sub = new TextView(this);
        sub.setText(ApiClient.isSignedIn() ? "Your account is connected" : "Sign in to sync library & progress");
        sub.setTextColor(0xFF979BA8);
        sub.setTextSize(12);
        txt.addView(sub);
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
        auth.setOnClickListener(v -> web("#/account"));
        card.addView(auth);
        list.addView(card, margins(0, 0, 0, 20));

        section("ACCOUNT");
        row("👤", "Account settings", () -> web("#/account"));
        row("☆", "My Library", () -> go(LibraryActivity.class));
        row("↓", "Downloads", () -> go(DownloadsActivity.class));

        section("DISCOVER");
        row("🏆", "Leaderboard", () -> web("#/leaderboard"));
        row("🛒", "RP Shop", () -> web("#/shop"));
        row("✨", "Discover", () -> web("#/discover"));
        row("🔥", "Popular comics", () -> web("#/popular"));
        row("📖", "Originals", () -> web("#/originals"));

        section("APP");
        row("⚙", "Settings / Theme", () -> web("#/account"));
        row("💬", "Join Discord", () -> {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://discord.gg/7UcfZmYTX"))); }
            catch (Exception ignored) {}
        });
        row("ℹ", "About MyGhoulScans", () ->
                Toast.makeText(this, "MyGhoulScans v3.0 — free, ad-free reader", Toast.LENGTH_SHORT).show());

        TextView footer = new TextView(this);
        footer.setText("MyGhoulScans · v3.0");
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

    private void web(String route) {
        Intent i = new Intent(this, MainActivity.class);
        i.putExtra("url", SITE + route);
        startActivity(i);
    }

    private void go(Class<?> cls) {
        startActivity(new Intent(this, cls));
        finish();
    }
}
