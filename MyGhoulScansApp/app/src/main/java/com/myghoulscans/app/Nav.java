package com.myghoulscans.app;

import android.app.Activity;
import android.content.Intent;
import android.widget.Button;

import androidx.core.content.ContextCompat;

/** Shared bottom navigation for the native screens. */
final class Nav {
    private Nav() {}

    private static final int[] IDS = {
            R.id.navHome, R.id.navSearch, R.id.navLibrary, R.id.navDownloads, R.id.navMore
    };
    private static final Class<?>[] TARGETS = {
            HomeActivity.class, SearchActivity.class, LibraryActivity.class, DownloadsActivity.class,
            MoreActivity.class
    };

    static void attach(final Activity a, int active) {
        for (int i = 0; i < IDS.length; i++) {
            Button b = a.findViewById(IDS[i]);
            if (b == null) continue;
            b.setTextColor(ContextCompat.getColor(a,
                    i == active ? R.color.mgs_accent : R.color.mgs_muted));
            final int idx = i;
            b.setOnClickListener(v -> go(a, TARGETS[idx]));
        }
    }

    static void go(Activity a, Class<?> target) {
        // Tapping the tab you're already on must not finish the app.
        if (a.getClass().equals(target)) return;
        Intent i = new Intent(a, target);
        i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        a.startActivity(i);
        a.finish();
    }

    static void home(Activity a) { go(a, HomeActivity.class); }

    /** Back arrow used on detail screens: always land on a real app screen, never exit. */
    static void back(Activity a, Class<?> fallback) {
        if (a.isTaskRoot() || a.getIntent() == null || a.getIntent().getExtras() == null) {
            go(a, fallback == null ? HomeActivity.class : fallback);
        } else {
            a.finish();
        }
    }
}
