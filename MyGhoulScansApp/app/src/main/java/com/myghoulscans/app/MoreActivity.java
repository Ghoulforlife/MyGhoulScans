package com.myghoulscans.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MoreActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ApiClient.init(this);
        setContentView(R.layout.activity_more);
        Nav.attach(this, 4);
        LinearLayout list = findViewById(R.id.moreList);

        TextView user = new TextView(this);
        user.setText(ApiClient.isSignedIn() ? "Signed in" : "Not signed in");
        user.setTextColor(ApiClient.isSignedIn() ? 0xFF2ECC71 : 0xFF979BA8);
        user.setTextSize(13);
        user.setPadding(4, 4, 4, 14);
        list.addView(user);

        add(list, ApiClient.isSignedIn() ? "Account settings" : "Sign up / Log in", "#/account");
        add(list, "Leaderboard", "#/leaderboard");
        add(list, "RP Shop", "#/shop");
        add(list, "Discover", "#/discover");
        add(list, "Originals", "#/originals");
        add(list, "Popular comics", "#/popular");
        add(list, "Settings / Theme", "#/account");
    }

    private void add(LinearLayout list, String label, String route) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextSize(15);
        b.setAllCaps(false);
        b.setOnClickListener(v -> {
            Intent i = new Intent(this, MainActivity.class);
            i.putExtra("url", "https://ghoulforlife.github.io/MyGhoulScans/" + route);
            startActivity(i);
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = 8;
        b.setLayoutParams(lp);
        list.addView(b);
    }
}
