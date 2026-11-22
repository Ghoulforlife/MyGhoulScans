package com.myghoulscans.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/** Tiny JSON client for the site's Cloudflare worker API, with disk caching. */
final class ApiClient {
    static final String BASE = DownloadStore.WORKER;
    private static SharedPreferences prefs, cache;

    private ApiClient() {}

    static void init(Context c) {
        if (prefs == null) prefs = c.getApplicationContext().getSharedPreferences("mgs", Context.MODE_PRIVATE);
        if (cache == null) cache = c.getApplicationContext().getSharedPreferences("mgs_cache", Context.MODE_PRIVATE);
    }

    static String token() { return prefs == null ? "" : prefs.getString("token", ""); }

    static void setToken(String t) {
        if (prefs == null) return;
        if (t == null || t.isEmpty()) prefs.edit().remove("token").apply();
        else prefs.edit().putString("token", t).apply();
    }

    static boolean isSignedIn() { return !token().isEmpty(); }

    static JSONObject user() {
        try { return new JSONObject(prefs == null ? "{}" : prefs.getString("user", "{}")); }
        catch (Exception e) { return new JSONObject(); }
    }

    static void setUser(JSONObject u) {
        if (prefs == null) return;
        prefs.edit().putString("user", u.toString()).apply();
    }

    static JSONObject refreshMe() {
        try {
            JSONObject r = new JSONObject(get("/auth/me"));
            JSONObject u = r.optJSONObject("user");
            if (u != null) setUser(u);
            return u == null ? user() : u;
        } catch (Exception e) { return user(); }
    }

    static String avatarUrl(JSONObject u) {
        String a = u == null ? "" : u.optString("avatar", "");
        String id = u == null ? "" : u.optString("id", "");
        if (a.startsWith("data:") || a.startsWith("http")) return a;
        if (!a.isEmpty()) return BASE + "/img?u=" + qOrEmpty("https://ghoulforlife.github.io/uploads/" + a);
        return BASE + "/auth/avatar/" + id + ".svg";
    }

    private static String qOrEmpty(String s) {
        try { return q(s); } catch (Exception e) { return ""; }
    }

    static String get(String path) throws Exception { return request("GET", path, null); }

    /** Cached GET — serves cached JSON instantly, refreshing in the background. */
    static String getCached(String path, long ttlMs) {
        String key = "g:" + path;
        if (cache != null) {
            String hit = cache.getString(key, null);
            long at = cache.getLong(key + ":t", 0);
            if (hit != null && System.currentTimeMillis() - at < ttlMs) return hit;
        }
        try {
            String text = get(path);
            if (cache != null) {
                cache.edit().putString(key, text).putLong(key + ":t", System.currentTimeMillis()).apply();
            }
            return text;
        } catch (Exception e) {
            if (cache != null) {
                String stale = cache.getString(key, null);
                if (stale != null) return stale;
            }
            return null;
        }
    }

    static String post(String path, String body) throws Exception { return request("POST", path, body); }
    static String del(String path) throws Exception { return request("DELETE", path, null); }

    static boolean isBookmarked(String id) {
        try { return new JSONObject(get("/library/" + qOrEmpty(id) + "/status")).optBoolean("followed", false); }
        catch (Exception e) { return false; }
    }

    static void bookmark(String id, boolean on) {
        try {
            if (on) post("/library/" + qOrEmpty(id), "{}");
            else del("/library/" + qOrEmpty(id));
        } catch (Exception ignored) {}
    }

    static JSONArray progress() {
        try {
            // Never cache reading progress — a stale cache makes "Continue"
            // show the wrong chapter right after reading.
            return new JSONObject(get("/progress")).optJSONArray("items");
        } catch (Exception e) { return null; }
    }

    static JSONObject stats() {
        try {
            return new JSONObject(getCached("/auth/stats", 60000)).optJSONObject("stats");
        } catch (Exception e) { return null; }
    }

    private static String request(String method, String path, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(BASE + path).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(15000);
        // Search fans out across several sources and can take 40s+; the old
        // 20s read timeout made every search silently fail with no results.
        c.setReadTimeout(90000);
        c.setRequestProperty("User-Agent", "MyGhoulScans/2.0 (Android)");
        c.setRequestProperty("Accept", "application/json");
        c.setRequestProperty("Referer", "https://ghoulforlife.github.io/");
        String t = token();
        if (!t.isEmpty()) c.setRequestProperty("Authorization", "Bearer " + t);
        if (body != null) {
            c.setRequestProperty("Content-Type", "application/json");
            c.setDoOutput(true);
            OutputStream os = c.getOutputStream();
            os.write(body.getBytes(StandardCharsets.UTF_8));
            os.close();
        }
        int code = c.getResponseCode();
        InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
        String text = "";
        if (in != null) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192]; int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            text = new String(out.toByteArray(), StandardCharsets.UTF_8);
            in.close();
        }
        c.disconnect();
        if (code < 200 || code >= 300) throw new Exception("HTTP " + code + " " + text.substring(0, Math.min(120, text.length())));
        return text;
    }

    static String imgUrl(String url) {
        if (url == null || url.isEmpty()) return url;
        if (url.startsWith("http")) {
            try { return BASE + "/img?u=" + q(url); } catch (Exception e) { return url; }
        }
        return url;
    }

    static String q(String s) throws Exception { return URLEncoder.encode(s, "UTF-8"); }
}
