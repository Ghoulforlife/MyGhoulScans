package com.myghoulscans.app;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Local storage helpers for downloaded chapters. All state lives under filesDir/downloads. */
final class DownloadStore {
    static final String WORKER = "https://myghoulscans-api.kev2op2021.workers.dev";

    private DownloadStore() {}

    static String key(String s) {
        String safe = s == null ? "" : s;
        StringBuilder out = new StringBuilder();
        for (byte b : safe.getBytes(StandardCharsets.UTF_8)) out.append(String.format("%02x", b & 0xff));
        return out.toString();
    }

    static File root(Context c) {
        File f = new File(c.getFilesDir(), "downloads");
        if (!f.exists()) f.mkdirs();
        return f;
    }

    static File titleDir(Context c, String mangaId) {
        File d = new File(root(c), key(mangaId));
        if (!d.exists()) d.mkdirs();
        return d;
    }

    static File chapterDir(Context c, String mangaId, String chapterUrl) {
        File d = new File(titleDir(c, mangaId), key(chapterUrl));
        if (!d.exists()) d.mkdirs();
        return d;
    }

    static File titleMeta(Context c, String mangaId) { return new File(titleDir(c, mangaId), "title.json"); }
    static File chapterMeta(Context c, String mangaId, String chapterUrl) { return new File(chapterDir(c, mangaId, chapterUrl), "chapter.json"); }

    static void write(File f, String s) throws IOException {
        FileOutputStream o = new FileOutputStream(f);
        try { o.write(s.getBytes(StandardCharsets.UTF_8)); } finally { o.close(); }
    }

    static String read(File f) {
        if (f == null || !f.exists()) return null;
        try {
            FileInputStream in = new FileInputStream(f);
            BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            r.close();
            return sb.toString();
        } catch (Exception e) { return null; }
    }

    static long size(File f) {
        if (f == null || !f.exists()) return 0;
        if (f.isFile()) return f.length();
        long n = 0;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) n += size(k);
        return n;
    }

    static String readable(long bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024) + " KB";
        return String.format("%.1f MB", bytes / (1024f * 1024f));
    }

    /** [ { mangaId, title, coverUrl, chapters:[{mangaId,chapterUrl,label,pages,bytes,time}] } ] */
    static JSONArray listTitles(Context c) {
        JSONArray out = new JSONArray();
        File[] dirs = root(c).listFiles();
        if (dirs == null) return out;
        for (File dir : dirs) {
            if (!dir.isDirectory()) continue;
            String meta = read(new File(dir, "title.json"));
            if (meta == null) continue;
            try {
                JSONObject t = new JSONObject(meta);
                JSONArray chapters = new JSONArray();
                File[] cds = dir.listFiles();
                if (cds != null) {
                    for (File cd : cds) {
                        if (!cd.isDirectory()) continue;
                        String cm = read(new File(cd, "chapter.json"));
                        if (cm == null) continue;
                        JSONObject ch = new JSONObject(cm);
                        ch.put("bytes", size(cd));
                        chapters.put(ch);
                    }
                }
                t.put("chapters", chapters);
                t.put("bytes", size(dir));
                out.put(t);
            } catch (Exception ignored) {}
        }
        return out;
    }

    static boolean deleteChapter(Context c, String mangaId, String chapterUrl) {
        File d = chapterDir(c, mangaId, chapterUrl);
        return deleteRecursive(d);
    }

    static boolean deleteTitle(Context c, String mangaId) {
        return deleteRecursive(titleDir(c, mangaId));
    }

    private static boolean deleteRecursive(File f) {
        if (f == null || !f.exists()) return true;
        if (f.isFile()) return f.delete();
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRecursive(k);
        return f.delete();
    }
}
