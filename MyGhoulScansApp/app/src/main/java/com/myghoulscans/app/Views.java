package com.myghoulscans.app;

import android.app.Activity;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.bumptech.glide.Glide;

/** Small view factories shared by the native screens. */
final class Views {
    private Views() {}

    static View card(Activity a, String id, String title, String coverUrl, String subtitle,
                     java.util.Set<String> bookmarked, View.OnClickListener click) {
        final String mid = id == null ? "" : id;
        LinearLayout card = new LinearLayout(a);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackgroundColor(0xFF1C1C24);
        card.setPadding(6, 6, 6, 10);
        card.setClickable(true);
        card.setFocusable(true);

        ImageView img = new ImageView(a);
        img.setScaleType(ImageView.ScaleType.CENTER_CROP);
        Glide.with(a.getApplicationContext()).load(ApiClient.imgUrl(coverUrl)).override(260, 340)
                .placeholder(R.mipmap.ic_launcher).error(R.mipmap.ic_launcher).into(img);

        // Quick bookmark star on every card, top-right of the cover.
        FrameLayout cover = new FrameLayout(a);
        cover.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(a, 168)));
        cover.addView(img, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        final Button star = new Button(a);
        boolean on = bookmarked != null && bookmarked.contains(mid);
        star.setText(on ? "★" : "☆");
        star.setTextSize(17);
        star.setAllCaps(false);
        star.setTextColor(on ? 0xFFE11D2E : 0xFFFFFFFF);
        star.setBackgroundColor(0x66000000);
        star.setPadding(dp(a, 4), 0, dp(a, 4), 0);
        star.setMinimumWidth(0);
        star.setMinimumHeight(0);
        FrameLayout.LayoutParams sp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.END);
        sp.setMargins(4, 4, 4, 4);
        star.setLayoutParams(sp);
        star.setOnClickListener(v -> {
            if (!ApiClient.isSignedIn()) {
                Toast.makeText(a, "Sign in to bookmark", Toast.LENGTH_SHORT).show();
                return;
            }
            boolean now = bookmarked == null || !bookmarked.contains(mid);
            final boolean save = now;
            new Thread(() -> ApiClient.bookmark(mid, save)).start(); // network off the UI thread
            if (bookmarked != null) { if (now) bookmarked.add(mid); else bookmarked.remove(mid); }
            star.setText(now ? "★" : "☆");
            star.setTextColor(now ? 0xFFE11D2E : 0xFFFFFFFF);
        });
        cover.addView(star);
        card.addView(cover);

        TextView t = new TextView(a);
        t.setText(title == null ? "Untitled" : title);
        t.setTextColor(0xFFFFFFFF);
        t.setTextSize(12);
        t.setMaxLines(2);
        t.setEllipsize(android.text.TextUtils.TruncateAt.END);
        t.setPadding(4, 8, 4, 2);
        card.addView(t);

        TextView s = new TextView(a);
        s.setText(subtitle == null ? "" : subtitle);
        s.setTextColor(0xFF979BA8);
        s.setTextSize(11);
        s.setPadding(4, 0, 4, 0);
        card.addView(s);

        card.setTag(mid);
        card.setOnClickListener(click);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(a, 124), ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.rightMargin = dp(a, 10);
        card.setLayoutParams(lp);
        return card;
    }

    static LinearLayout row(Activity a) {
        LinearLayout r = new LinearLayout(a);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setPadding(dp(a, 16), 2, dp(a, 16), 2);
        return r;
    }

    static TextView section(Activity a, String text) {
        TextView t = new TextView(a);
        t.setText(text);
        t.setTextColor(0xFFFFFFFF);
        t.setTextSize(18);
        t.setPadding(dp(a, 16), dp(a, 14), dp(a, 16), dp(a, 6));
        return t;
    }

    static int dp(Activity a, int v) {
        return Math.round(v * a.getResources().getDisplayMetrics().density);
    }
}
