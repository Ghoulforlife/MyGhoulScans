package com.myghoulscans.app;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import android.widget.ScrollView;

/** ScrollView that reports when the user nears the bottom (for infinite loading). */
public class EndlessScrollView extends ScrollView {
    public interface BottomListener { void onNearBottom(); }

    private BottomListener listener;

    public EndlessScrollView(Context c) { super(c); }
    public EndlessScrollView(Context c, AttributeSet a) { super(c, a); }

    public void setBottomListener(BottomListener l) { listener = l; }

    @Override
    protected void onScrollChanged(int x, int y, int oldX, int oldY) {
        super.onScrollChanged(x, y, oldX, oldY);
        if (listener == null) return;
        View child = getChildAt(0);
        if (child == null) return;
        int bottom = child.getHeight() - getHeight();
        if (bottom > 0 && y >= bottom - dp(400)) listener.onNearBottom();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
