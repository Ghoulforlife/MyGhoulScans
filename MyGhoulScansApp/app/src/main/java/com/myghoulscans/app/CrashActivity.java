package com.myghoulscans.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

public class CrashActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String error = getIntent().getStringExtra("error");
        if (error == null || error.isEmpty()) error = "Unknown crash";
        final String err = error;
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(16, 16, 16, 16);
        TextView title = new TextView(this);
        title.setText("MyGhoulScans crashed — here's why:");
        title.setTextColor(0xFFFFFFFF);
        title.setTextSize(17);
        title.setPadding(0, 0, 0, 10);
        root.addView(title);

        TextView text = new TextView(this);
        text.setText(error);
        text.setTextColor(0xFFCCCCCC);
        text.setTextSize(11);
        text.setTextIsSelectable(true);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(text, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        scroll.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(scroll);

        Button copy = new Button(this);
        copy.setText("Copy error");
        copy.setOnClickListener(v -> {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("crash", err));
            Toast.makeText(this, "Copied", Toast.LENGTH_SHORT).show();
        });
        root.addView(copy);

        Button restart = new Button(this);
        restart.setText("Restart app");
        restart.setOnClickListener(v -> {
            Intent i = new Intent(this, HomeActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            startActivity(i);
        });
        root.addView(restart);
        setContentView(root);
    }
}
