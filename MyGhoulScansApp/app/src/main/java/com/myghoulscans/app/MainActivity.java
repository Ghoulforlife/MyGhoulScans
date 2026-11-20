package com.myghoulscans.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

public class MainActivity extends AppCompatActivity {

    private static final String BASE = "https://ghoulforlife.github.io/MyGhoulScans/";
    // APK-only theme: hide the site's duplicate nav (the source of the nav bug)
    // and give the content a rounder, more app-like look. The native bottom bar
    // is the only navigation the user sees.
    private static final String APP_CSS =
        "(function(){var o=document.getElementById('mgs-app-style');if(o)o.remove();"
        + "var s=document.createElement('style');s.id='mgs-app-style';"
        + "s.textContent='#nav,#mobileMenu,#menuBtn,.discord-banner{display:none!important}'"
        + "+'header{padding:10px 12px!important}'"
        + "+'#searchbox input{border-radius:16px!important;font-size:15px!important}'"
        + "+'.title-hero,.page-title,.card,.hrow>*{border-radius:14px!important}'"
        + "+'.btn{border-radius:12px!important;min-height:40px!important}'"
        + "+'body{padding-bottom:6px!important}';"
        + "document.head.appendChild(s);})()";

    private WebView webView;
    private View bottomBar;
    private Button[] tabs;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7);
        }
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webView);
        bottomBar = findViewById(R.id.bottomBar);
        tabs = new Button[]{
                findViewById(R.id.navHome), findViewById(R.id.navSearch),
                findViewById(R.id.navLibrary), findViewById(R.id.navDownloads)
        };

        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);
        webSettings.setDatabaseEnabled(true);
        webSettings.setGeolocationEnabled(true);

        webView.setWebViewClient(new MyWebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new MgsBridge(this), "MGSAndroid");

        tabs[0].setOnClickListener(v -> { webView.loadUrl(BASE); selectTab(0); });
        tabs[1].setOnClickListener(v -> {
            webView.loadUrl(BASE + "#/search");
            selectTab(1);
            webView.evaluateJavascript("setTimeout(function(){var e=document.getElementById('searchInput');if(e)e.focus()},400)", null);
        });
        tabs[2].setOnClickListener(v -> { webView.loadUrl(BASE + "#/library"); selectTab(2); });
        tabs[3].setOnClickListener(v -> { openDownloads(); selectTab(3); });

        webView.loadUrl(BASE);
    }

    private void openDownloads() {
        startActivity(new Intent(this, DownloadsActivity.class));
    }

    private void selectTab(int active) {
        for (int i = 0; i < tabs.length; i++) {
            tabs[i].setTextColor(ContextCompat.getColor(this,
                    i == active ? R.color.mgs_accent : R.color.mgs_muted));
        }
    }

    private class MyWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            if (url.startsWith(BASE) || url.startsWith("https://ghoulforlife.github.io/")) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
            catch (Exception ignored) {}
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            webView.evaluateJavascript(APP_CSS, null);
            boolean reader = url.contains("/reader/") || url.contains("#/reader/");
            bottomBar.setVisibility(reader ? View.GONE : View.VISIBLE);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
