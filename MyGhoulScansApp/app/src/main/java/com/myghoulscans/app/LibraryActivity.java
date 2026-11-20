package com.myghoulscans.app;

import android.content.Intent;
import android.os.AsyncTask;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.bumptech.glide.Glide;

import org.json.JSONArray;
import org.json.JSONObject;

public class LibraryActivity extends AppCompatActivity {
    private LinearLayout list;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ApiClient.init(this);
        setContentView(R.layout.activity_library);
        Nav.attach(this, 2);
        list = findViewById(R.id.libraryList);
        if (!ApiClient.isSignedIn()) {
            Button signIn = new Button(this);
            signIn.setText("Sign in to see your library");
            signIn.setOnClickListener(v -> {
                Intent i = new Intent(this, MainActivity.class);
                i.putExtra("url", "https://ghoulforlife.github.io/MyGhoulScans/#/account");
                startActivity(i);
            });
            list.addView(signIn);
            return;
        }
        new LoadTask().execute();
    }

    @Override protected void onResume() { super.onResume(); }

    private class LoadTask extends AsyncTask<Void, Void, JSONArray> {
        @Override protected JSONArray doInBackground(Void... unused) {
            JSONArray ids = null;
            try { ids = new JSONObject(ApiClient.get("/library")).optJSONArray("mangaIds"); }
            catch (Exception ignored) {}
            JSONArray out = new JSONArray();
            if (ids == null) return out;
            for (int i = 0; i < ids.length(); i++) {
                String id = ids.optString(i, "");
                if (id.isEmpty()) continue;
                try {
                    JSONObject t = new JSONObject(ApiClient.get("/comick/title?id=" + ApiClient.q(id))).optJSONObject("data");
                    if (t != null) {
                        JSONObject c = new JSONObject();
                        c.put("id", id);
                        c.put("title", t.optString("title", "Untitled"));
                        c.put("cover", t.optString("cover", ""));
                        out.put(c);
                    }
                } catch (Exception ignored) {}
            }
            return out;
        }
        @Override protected void onPostExecute(JSONArray arr) {
            list.removeAllViews();
            if (arr == null || arr.length() == 0) {
                TextView t = new TextView(LibraryActivity.this);
                t.setText("Your library is empty. Bookmark comics on the website.");
                t.setTextColor(0xFF979BA8);
                list.addView(t);
                return;
            }
            for (int i = 0; i < arr.length(); i++) {
                try { list.addView(row(arr.getJSONObject(i))); } catch (Exception ignored) {}
            }
        }
    }

    private LinearLayout row(JSONObject o) {
        final String id = o.optString("id", ""), title = o.optString("title", "Untitled"), cover = o.optString("cover", "");
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setPadding(8, 10, 8, 10);
        r.setBackgroundColor(0xFF1C1C24);
        ImageView img = new ImageView(this);
        img.setScaleType(ImageView.ScaleType.CENTER_CROP);
        Glide.with(this).load(cover).placeholder(R.mipmap.ic_launcher).into(img);
        img.setLayoutParams(new LinearLayout.LayoutParams(Views.dp(this, 60), Views.dp(this, 80)));
        r.addView(img);
        TextView t = new TextView(this);
        t.setText(title);
        t.setTextColor(0xFFFFFFFF);
        t.setTextSize(14);
        t.setPadding(12, 0, 0, 0);
        t.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        r.addView(t);
        r.setOnClickListener(v -> {
            Intent i = new Intent(this, ComicDetailActivity.class);
            i.putExtra("id", id); i.putExtra("title", title); i.putExtra("cover", cover);
            startActivity(i);
        });
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rp.bottomMargin = 8;
        r.setLayoutParams(rp);
        return r;
    }
}
