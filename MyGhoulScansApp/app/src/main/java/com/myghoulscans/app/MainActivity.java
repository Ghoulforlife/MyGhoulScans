package com.myghoulscans.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;

/** WebView used for online reading and account pages, launched from native screens. */
public class MainActivity extends AppCompatActivity {
    private static final String BASE = "https://ghoulforlife.github.io/MyGhoulScans/";
    private static final String APP_CSS =
        "(function(){var o=document.getElementById('mgs-app-style');if(o)o.remove();"
        + "var s=document.createElement('style');s.id='mgs-app-style';"
        + "s.textContent='#nav,#mobileMenu,#menuBtn,.discord-banner{display:none!important}'"
        + "+'header{padding:10px 12px!important}'"
        + "+'#searchbox input{border-radius:16px!important}'"
        + "+'.btn{border-radius:12px!important;min-height:40px!important}';"
        + "document.head.appendChild(s);})()";

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7);
        }
        ApiClient.init(this);
        setContentView(R.layout.activity_main);
        webView = findViewById(R.id.webView);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setDatabaseEnabled(true);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, String url) {
                if (url.startsWith(BASE) || url.startsWith("https://ghoulforlife.github.io/")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) {}
                return true;
            }
            @Override public void onPageFinished(WebView v, String url) { webView.evaluateJavascript(APP_CSS, null); }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new MgsBridge(this), "MGSAndroid");
        String url = getIntent().getStringExtra("url");
        webView.loadUrl(url == null ? BASE : url);
    }

    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
