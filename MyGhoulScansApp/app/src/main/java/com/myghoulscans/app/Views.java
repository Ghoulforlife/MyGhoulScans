package com.myghoulscans.app;

import android.app.Activity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.bumptech.glide.Glide;

/** Small view factories shared by the native screens. */
final class Views {
    private Views() {}

    static View card(Activity a, String id, String title, String coverUrl, String subtitle, View.OnClickListener click) {
        LinearLayout card = new LinearLayout(a);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackgroundColor(0xFF1C1C24);
        card.setPadding(6, 6, 6, 10);
        card.setClickable(true);
        card.setFocusable(true);

        ImageView img = new ImageView(a);
        img.setScaleType(ImageView.ScaleType.CENTER_CROP);
        img.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(a, 168)));
        Glide.with(a).load(ApiClient.imgUrl(coverUrl)).override(260, 340)
                .placeholder(R.mipmap.ic_launcher).error(R.mipmap.ic_launcher).into(img);
        card.addView(img);

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

        final String mid = id == null ? "" : id;
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
