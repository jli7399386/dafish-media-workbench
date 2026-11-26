package com.dafish.media;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

/** 后台播放保活 + 通知栏控制 */
public class PlayService extends Service {

    public static final String CH = "dafish_media_play";
    public static final int ID = 5101;
    public static final String ACT = "com.dafish.media.PLAY_ACTION";

    public static void start(Context c, String title, String sub, boolean playing) {
        try {
            Intent i = new Intent(c, PlayService.class);
            i.putExtra("title", title == null ? "" : title);
            i.putExtra("sub", sub == null ? "" : sub);
            i.putExtra("playing", playing);
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else c.startService(i);
        } catch (Exception ignored) {}
    }

    public static void stop(Context c) {
        try { c.stopService(new Intent(c, PlayService.class)); } catch (Exception ignored) {}
    }

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(CH, "播放控制", NotificationManager.IMPORTANCE_LOW);
                ch.setShowBadge(false);
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                if (nm != null) nm.createNotificationChannel(ch);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent == null ? "" : intent.getStringExtra("title");
        String sub = intent == null ? "" : intent.getStringExtra("sub");
        boolean playing = intent != null && intent.getBooleanExtra("playing", true);
        try {
            Notification.Builder b = (Build.VERSION.SDK_INT >= 26)
                    ? new Notification.Builder(this, CH) : new Notification.Builder(this);
            b.setContentTitle(title == null || title.isEmpty() ? "正在播放" : title)
             .setContentText(sub == null ? "" : sub)
             .setSmallIcon(android.R.drawable.ic_media_play)
             .setOngoing(true)
             .setContentIntent(action("open"))
             .addAction(new Notification.Action.Builder(null, "上一首", action("prev")).build())
             .addAction(new Notification.Action.Builder(null, playing ? "暂停" : "播放", action("toggle")).build())
             .addAction(new Notification.Action.Builder(null, "下一首", action("next")).build())
             .addAction(new Notification.Action.Builder(null, "停止", action("stop")).build());
            startForeground(ID, b.build());
        } catch (Exception ignored) {}
        return START_STICKY;
    }

    private PendingIntent action(String what) {
        Intent i = new Intent(ACT);
        i.setPackage(getPackageName());
        i.putExtra("what", what);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(this, what.hashCode(), i, flags);
    }

    @Override
    public void onDestroy() {
        try { stopForeground(true); } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
