package com.myghoulscans.app;

import android.app.Activity;
import android.content.Intent;
import android.widget.Button;

import androidx.core.content.ContextCompat;

/** Shared bottom navigation for the native screens. */
final class Nav {
    private Nav() {}

    private static final int[] IDS = {
            R.id.navHome, R.id.navSearch, R.id.navLibrary, R.id.navDownloads
    };
    private static final Class<?>[] TARGETS = {
            HomeActivity.class, SearchActivity.class, LibraryActivity.class, DownloadsActivity.class
    };

    static void attach(final Activity a, int active) {
        for (int i = 0; i < IDS.length; i++) {
            Button b = a.findViewById(IDS[i]);
            if (b == null) continue;
            b.setTextColor(ContextCompat.getColor(a,
                    i == active ? R.color.mgs_accent : R.color.mgs_muted));
            final int idx = i;
            b.setOnClickListener(v -> {
                if (idx == active) return;
                a.startActivity(new Intent(a, TARGETS[idx]));
                a.finish();
            });
        }
    }
}
