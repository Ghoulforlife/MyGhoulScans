package com.myghoulscans.app;

import android.app.Activity;
import android.content.Intent;
import android.os.AsyncTask;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

public class LoginActivity extends Activity {
    private boolean signup = false;
    private EditText email, password, username;
    private Button submit, tabLogin, tabSignup;
    private TextView errorView, subtitle;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ApiClient.init(this);
        setContentView(R.layout.activity_login);
        email = findViewById(R.id.loginEmail);
        password = findViewById(R.id.loginPassword);
        username = findViewById(R.id.loginUsername);
        submit = findViewById(R.id.loginSubmit);
        tabLogin = findViewById(R.id.tabLogin);
        tabSignup = findViewById(R.id.tabSignup);
        errorView = findViewById(R.id.loginError);
        subtitle = findViewById(R.id.loginSubtitle);

        findViewById(R.id.loginBack).setOnClickListener(v -> Nav.home(this));
        tabLogin.setOnClickListener(v -> setMode(false));
        tabSignup.setOnClickListener(v -> setMode(true));
        submit.setOnClickListener(v -> submit());
    }

    private void setMode(boolean isSignup) {
        signup = isSignup;
        username.setVisibility(isSignup ? View.VISIBLE : View.GONE);
        submit.setText(isSignup ? "Create account" : "Log in");
        subtitle.setText(isSignup ? "Create an account to sync your library" : "Log in to sync your library and progress");
        tabLogin.setTextColor(getResources().getColor(isSignup ? R.color.mgs_muted : R.color.white));
        tabSignup.setTextColor(getResources().getColor(isSignup ? R.color.white : R.color.mgs_muted));
        tabLogin.setBackgroundResource(isSignup ? android.R.color.transparent : R.drawable.mgs_accent_button);
        tabSignup.setBackgroundResource(isSignup ? R.drawable.mgs_accent_button : android.R.color.transparent);
        errorView.setVisibility(View.GONE);
    }

    private void submit() {
        final String em = email.getText().toString().trim();
        final String pw = password.getText().toString();
        final String name = username.getText().toString().trim();
        if (em.isEmpty() || !em.contains("@")) { showError("Enter a valid email"); return; }
        if (pw.length() < 6) { showError("Password must be at least 6 characters"); return; }
        errorView.setVisibility(View.GONE);
        submit.setEnabled(false);
        submit.setText("Please wait…");
        new AsyncTask<Void, Void, String>() {
            @Override protected String doInBackground(Void... unused) {
                try {
                    JSONObject body = new JSONObject();
                    body.put("email", em);
                    body.put("password", pw);
                    if (signup && !name.isEmpty()) body.put("displayName", name);
                    String path = signup ? "/auth/signup" : "/auth/login";
                    JSONObject res = new JSONObject(ApiClient.post(path, body.toString()));
                    String token = res.optString("token", "");
                    if (token.isEmpty()) return res.optString("error", "No token returned");
                    ApiClient.setToken(token);
                    ApiClient.refreshMe();
                    return null;
                } catch (Exception e) {
                    String msg = e.getMessage();
                    try {
                        if (msg != null && msg.contains("{")) {
                            JSONObject er = new JSONObject(msg.substring(msg.indexOf('{')));
                            msg = er.optString("error", msg);
                        }
                    } catch (Exception ignored) {}
                    return msg == null ? "Sign-in failed" : msg;
                }
            }
            @Override protected void onPostExecute(String err) {
                submit.setEnabled(true);
                submit.setText(signup ? "Create account" : "Log in");
                if (err != null) { showError(err); return; }
                Toast.makeText(LoginActivity.this, signup ? "Account created" : "Signed in", Toast.LENGTH_SHORT).show();
                Intent i = new Intent(LoginActivity.this, HomeActivity.class);
                i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
                startActivity(i);
                finish();
            }
        }.execute();
    }

    private void showError(String msg) {
        errorView.setText(msg);
        errorView.setVisibility(View.VISIBLE);
    }
}
