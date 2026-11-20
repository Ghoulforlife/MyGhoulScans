package com.myghoulscans.app;

import android.app.Application;
import android.content.Intent;
import android.os.Process;

import java.io.File;
import java.io.FileWriter;
import java.io.PrintWriter;

/** Catches crashes, saves the stack trace and shows it on screen. */
public class MgsApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, e) -> {
            try {
                StringWriterLike sw = new StringWriterLike();
                PrintWriter pw = new PrintWriter(sw);
                e.printStackTrace(pw);
                pw.close();
                String text = sw.toString();
                File f = new File(getFilesDir(), "crash.txt");
                FileWriter fw = new FileWriter(f, false);
                fw.write(text);
                fw.close();
                Intent i = new Intent(this, CrashActivity.class);
                i.putExtra("error", text);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                startActivity(i);
            } catch (Exception ignored) {}
            if (previous != null) previous.uncaughtException(thread, e);
            else Process.killProcess(Process.myPid());
        });
    }

    private static class StringWriterLike extends java.io.StringWriter {}
}
