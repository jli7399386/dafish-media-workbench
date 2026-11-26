package com.dafish.media;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends Activity {

    private WebView web;
    private android.net.Uri pendingUri = null;
    private boolean ffloaded = false;
    private volatile String ffOutput = "";
    private volatile String probeBuf = "";
    private volatile String lastProbeOut = "";
    private volatile int ffReturn = -999;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            if (android.os.Build.VERSION.SDK_INT >= 30 && !Environment.isExternalStorageManager()) {
                Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                i.setData(Uri.parse("package:" + getPackageName()));
                startActivity(i);
            } else if (android.os.Build.VERSION.SDK_INT < 30) {
                requestPermissions(new String[]{"android.permission.READ_EXTERNAL_STORAGE"}, 1);
            }
        } catch (Exception ignored) {}

        try {
            android.content.IntentFilter f = new android.content.IntentFilter(PlayService.ACT);
            registerReceiver(new android.content.BroadcastReceiver() {
                public void onReceive(android.content.Context c, android.content.Intent i) {
                    final String what = i == null ? "" : i.getStringExtra("what");
                    if ("open".equals(what)) {
                        try { startActivity(new android.content.Intent(MainActivity.this, MainActivity.class)); } catch (Exception ignored) {}
                        return;
                    }
                    if (web != null) {
                        web.post(new Runnable() { public void run() {
                            web.evaluateJavascript("window.onPlayAction&&window.onPlayAction(" + org.json.JSONObject.quote(what == null ? "" : what) + ")", null);
                        }});
                    }
                }
            }, f);
        } catch (Exception ignored) {}

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        setContentView(web);
        com.arthenica.ffmpegkit.FFmpegBridge.host = MainActivity.this;
        ffloaded = com.arthenica.ffmpegkit.FFmpegBridge.load();

        try {
            if (getIntent() != null && getIntent().getData() != null) pendingUri = getIntent().getData();
        } catch (Exception ignored) {}
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (pendingUri != null) {
                    final android.net.Uri u = pendingUri;
                    pendingUri = null;
                    web.postDelayed(new Runnable() { public void run() { deliverUri(u); } }, 900);
                }
            }
        });
        web.loadUrl("file:///android_asset/index.html");
    }

    /* ---------- FFmpeg 回调（库内线程调用） ---------- */
    public void ffLog(String line) {
        if (line == null) return;
        if (ffOutput.length() < 200000) ffOutput += line;
        if (probeBuf.length() < 200000) probeBuf += line;
    }

    public long ffStatTime = 0;
    public double ffStatSpeed = 0;
    public void ffStats(final int timeMs, final double speed) {
        try {
            ffStatTime = timeMs;
            ffStatSpeed = speed;
            final int t = timeMs;
            web.post(new Runnable() { public void run() {
                web.evaluateJavascript("window.onFfStat&&window.onFfStat(" + t + "," + speed + ")", null);
            }});
        } catch (Throwable ignored) {}
    }

    public class Bridge {
        /* 扫描本地音频：返回 JSON 数组 */
        @JavascriptInterface
        public String listAudio() {
            JSONArray arr = new JSONArray();
            Cursor c = null;
            try {
                String[] proj = {
                        MediaStore.Audio.Media._ID,
                        MediaStore.Audio.Media.TITLE,
                        MediaStore.Audio.Media.ARTIST,
                        MediaStore.Audio.Media.ALBUM,
                        MediaStore.Audio.Media.DURATION,
                        MediaStore.Audio.Media.DATA,
                        MediaStore.Audio.Media.DISPLAY_NAME
                };
                c = getContentResolver().query(
                        MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, proj, null, null,
                        MediaStore.Audio.Media.TITLE + " ASC");
                if (c != null) {
                    while (c.moveToNext() && arr.length() < 5000) {
                        String path = c.getString(5);
                        if (path == null || !new java.io.File(path).isFile()) continue;
                        JSONObject o = new JSONObject();
                        o.put("id", c.getLong(0));
                        o.put("title", c.getString(1) == null ? c.getString(6) : c.getString(1));
                        o.put("artist", c.getString(2) == null ? "" : c.getString(2));
                        o.put("album", c.getString(3) == null ? "" : c.getString(3));
                        o.put("dur", c.getLong(4));
                        o.put("path", path);
                        arr.put(o);
                    }
                }
            } catch (Exception e) {
                try { arr.put(new JSONObject().put("error", String.valueOf(e))); } catch (Exception ignored) {}
            } finally {
                if (c != null) c.close();
            }
            return arr.toString();
        }

        /* 列目录（文件浏览用） */
        @JavascriptInterface
        public String listDir(String path) {
            JSONArray arr = new JSONArray();
            try {
                java.io.File dir = new java.io.File(path);
                java.io.File[] fs2 = dir.listFiles();
                if (fs2 == null) return arr.toString();
                java.util.Arrays.sort(fs2, new java.util.Comparator<java.io.File>() {
                    public int compare(java.io.File a, java.io.File b) {
                        if (a.isDirectory() != b.isDirectory()) return a.isDirectory() ? -1 : 1;
                        return a.getName().compareToIgnoreCase(b.getName());
                    }
                });
                for (java.io.File f : fs2) {
                    if (f.getName().startsWith(".")) continue;
                    JSONObject o = new JSONObject();
                    o.put("name", f.getName());
                    o.put("dir", f.isDirectory());
                    o.put("size", f.length());
                    o.put("path", f.getAbsolutePath());
                    arr.put(o);
                }
            } catch (Exception ignored) {}
            return arr.toString();
        }

        @JavascriptInterface
        public void writeFile(String path, String text) {
            try {
                java.io.File f = new java.io.File(path);
                java.io.File parent = f.getParentFile();
                if (parent != null && !parent.exists()) parent.mkdirs();
                java.io.FileOutputStream fo = new java.io.FileOutputStream(f);
                fo.write(text.getBytes("UTF-8"));
                fo.close();
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public String toolMkdir(String path) {
            try { java.io.File d = new java.io.File(path); if (!d.exists()) d.mkdirs(); return "ok"; }
            catch (Exception e) { return "err"; }
        }

        /* ---------- FFmpeg（库内调用，不执行二进制） ---------- */
        @JavascriptInterface
        public String ffStatus() {
            return (ffloaded ? "ok" : ("err " + com.arthenica.ffmpegkit.FFmpegBridge.loadErr));
        }

        private android.media.audiofx.LoudnessEnhancer boost = null;
        private int boostSession = -1;

        @JavascriptInterface
        public boolean setBoost(boolean on) {
            try {
                int[] sessions = { 0 };
                // WebView <video> 的 session 拿不到，退而用 AUDIO_SESSION_ID_GENERATE 的混合输出不可行
                // 这里用 AudioManager 把媒体音量打满 + 全局 LoudnessEnhancer（session 0 = 输出混音）
                android.media.AudioManager am = (android.media.AudioManager) getSystemService(AUDIO_SERVICE);
                if (on) {
                    if (boost != null) { boost.setEnabled(true); return true; }
                    boost = new android.media.audiofx.LoudnessEnhancer(0);
                    boost.setTargetGain(600);   // +6 dB 约等于 2 倍响度
                    boost.setEnabled(true);
                    boostSession = 0;
                    return true;
                } else {
                    if (boost != null) {
                        boost.setEnabled(false);
                        boost.release();
                        boost = null;
                    }
                    return true;
                }
            } catch (Throwable t) {
                return false;
            }
        }

        @JavascriptInterface
        public int getSysVol() {
            try {
                android.media.AudioManager am = (android.media.AudioManager) getSystemService(AUDIO_SERVICE);
                int cur = am.getStreamVolume(android.media.AudioManager.STREAM_MUSIC);
                int max = am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC);
                return max > 0 ? Math.round(cur * 100f / max) : 0;
            } catch (Exception e) { return 0; }
        }

        @JavascriptInterface
        public void startBgPlay(String title, String sub, boolean playing) {
            PlayService.start(MainActivity.this, title, sub, playing);
        }

        @JavascriptInterface
        public void updateBgPlay(String title, String sub, boolean playing) {
            PlayService.start(MainActivity.this, title, sub, playing);
        }

        @JavascriptInterface
        public void stopBgPlay() { PlayService.stop(MainActivity.this); }

        /* 原生全屏 + 强制横屏（WebView 网页全屏不可靠，走这里） */
        @JavascriptInterface
        public void goFullscreen(final boolean on, final boolean landscape) {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        videoFull = on;
                        if (on) {
                            setRequestedOrientation(landscape
                                ? android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                                : android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                            getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
                            // 隐藏 Activity 标题栏
                            try { getActionBar().hide(); } catch (Exception ignored) {}
                            if (android.os.Build.VERSION.SDK_INT >= 30) {
                                getWindow().getInsetsController().hide(android.view.WindowInsets.Type.systemBars());
                                getWindow().getInsetsController().setSystemBarsBehavior(
                                        android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                            } else {
                                getWindow().getDecorView().setSystemUiVisibility(
                                        android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                                      | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                      | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
                            }
                        } else {
                            setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                            getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
                            try { getActionBar().show(); } catch (Exception ignored) {}
                            if (android.os.Build.VERSION.SDK_INT >= 30) {
                                getWindow().getInsetsController().show(android.view.WindowInsets.Type.systemBars());
                            } else {
                                getWindow().getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_VISIBLE);
                            }
                        }
                    } catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public String renameFile(String from, String to) {
            try {
                java.io.File a = new java.io.File(from);
                java.io.File b = new java.io.File(to);
                if (!a.isFile()) return "源文件不存在";
                if (b.exists()) return "目标已存在：" + b.getName();
                return a.renameTo(b) ? "ok" : "重命名失败（可能没有权限）";
            } catch (Exception e) { return String.valueOf(e); }
        }

        /* 探测：执行 ffmpeg -i，把输出交给 window.onFfProbe */
        @JavascriptInterface
        public void ffProbe(final String argsJson, final String cbId) {
            new Thread(new Runnable() {
                public void run() {
                    String out;
                    try {
                        org.json.JSONArray arr = new org.json.JSONArray(argsJson);
                        String[] args = new String[arr.length()];
                        for (int i = 0; i < arr.length(); i++) args[i] = arr.getString(i);
                        probeBuf = "";
                        long id = System.currentTimeMillis() + 7919;
                        int rc = com.arthenica.ffmpegkit.FFmpegKitConfig.nativeFFmpegExecute(id, args);
                        out = probeBuf;
                        lastProbeOut = probeBuf;
                    } catch (Throwable t) { out = String.valueOf(t); }
                    final String r = out;
                    web.post(new Runnable() { public void run() {
                        web.evaluateJavascript("window.onFfProbe&&window.onFfProbe(" + org.json.JSONObject.quote(cbId) + "," + org.json.JSONObject.quote(r) + ")", null);
                    }});
                }
            }).start();
        }

        @JavascriptInterface
        public void ffExec(final String argsJson, final String cbId) {
            new Thread(new Runnable() {
                public void run() {
                    String result;
                    try {
                        org.json.JSONArray arr = new org.json.JSONArray(argsJson);
                        String[] args = new String[arr.length()];
                        for (int i = 0; i < arr.length(); i++) args[i] = arr.getString(i);
                        ffOutput = "";
                        long id = System.currentTimeMillis();
                        int rc = com.arthenica.ffmpegkit.FFmpegKitConfig.nativeFFmpegExecute(id, args);
                        String tail = ffOutput;
                        if (tail.length() > 3000) tail = tail.substring(tail.length() - 3000);
                        result = rc + "\n" + tail;
                    } catch (Throwable t) {
                        result = "1\n" + t;
                    }
                    final String r = result;
                    web.post(new Runnable() { public void run() {
                        web.evaluateJavascript("window.onFf&&window.onFf(" + org.json.JSONObject.quote(cbId) + "," + org.json.JSONObject.quote(r) + ")", null);
                    }});
                }
            }).start();
        }

        @JavascriptInterface
        public boolean fileExists(String path) {
            try { return new java.io.File(path).isFile(); } catch (Exception e) { return false; }
        }

        /* 读媒体时长（毫秒），失败返回 0 */
        /* 判断是音频还是视频：0=未知 1=音频 2=视频 */
        /* 清理 incoming 目录（传入当前列表里在用的路径，其余删除） */
        @JavascriptInterface
        public String readLog(int maxLines) {
            try {
                java.io.File f = new java.io.File(getFilesDir(), "log.txt");
                if (!f.exists()) return "";
                java.io.BufferedReader br = new java.io.BufferedReader(
                        new java.io.InputStreamReader(new java.io.FileInputStream(f), "UTF-8"));
                java.util.List<String> lines = new java.util.ArrayList<>();
                String l;
                while ((l = br.readLine()) != null) { lines.add(l); if (lines.size() > 5000) lines.remove(0); }
                br.close();
                int start = Math.max(0, lines.size() - Math.max(50, maxLines));
                StringBuilder sb = new StringBuilder();
                for (int i = start; i < lines.size(); i++) sb.append(lines.get(i)).append("\n");
                return sb.toString();
            } catch (Exception e) { return "读取失败: " + e; }
        }

        @JavascriptInterface
        public void clearLog() {
            try {
                java.io.File f = new java.io.File(getFilesDir(), "log.txt");
                if (f.exists()) f.delete();
            } catch (Exception ignored) {}
        }

        /* 输出目录设置：存在应用私有配置里 */
        private java.io.File outDirCfg() { return new java.io.File(getFilesDir(), "outdir.txt"); }

        @JavascriptInterface
        public String getOutDir() {
            try {
                java.io.File f = outDirCfg();
                if (!f.exists()) return "/storage/emulated/0/大肥鱼工作台";
                java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(
                        new java.io.FileInputStream(f), "UTF-8"));
                String s2 = br.readLine();
                br.close();
                return (s2 == null || s2.trim().isEmpty()) ? "/storage/emulated/0/大肥鱼工作台" : s2.trim();
            } catch (Exception e) { return "/storage/emulated/0/大肥鱼工作台"; }
        }

        @JavascriptInterface
        public String setOutDir(String path) {
            try {
                String p2 = (path == null || path.trim().isEmpty()) ? "/storage/emulated/0/大肥鱼工作台" : path.trim();
                java.io.File d = new java.io.File(p2);
                if (!d.exists()) d.mkdirs();
                if (!d.isDirectory()) return "不是文件夹";
                if (!d.canWrite()) return "这个文件夹没有写入权限";
                java.io.FileWriter w = new java.io.FileWriter(outDirCfg());
                w.write(p2);
                w.close();
                return "ok";
            } catch (Exception e) { return String.valueOf(e); }
        }

        @JavascriptInterface
        public String cleanIncoming(String usedPathsJson) {
            int kept = 0, removed = 0;
            try {
                java.util.Set<String> used = new java.util.HashSet<>();
                org.json.JSONArray arr = new org.json.JSONArray(usedPathsJson == null ? "[]" : usedPathsJson);
                for (int i = 0; i < arr.length(); i++) used.add(arr.getString(i));
                java.io.File dir = new java.io.File(getFilesDir(), "incoming");
                java.io.File[] fs2 = dir.listFiles();
                if (fs2 == null) return "ok 0 0";
                for (java.io.File f : fs2) {
                    if (!f.isFile()) continue;
                    if (used.contains(f.getAbsolutePath())) { kept++; continue; }
                    if (f.delete()) removed++;
                }
            } catch (Exception ignored) {}
            return "ok " + kept + " " + removed;
        }

        @JavascriptInterface
        public int mediaKind(String path) {
            android.media.MediaMetadataRetriever r = new android.media.MediaMetadataRetriever();
            try {
                r.setDataSource(path);
                String w = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
                String h = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
                String dur = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION);
                if (w != null && h != null && !"0".equals(w) && !"0".equals(h)) return 2;  // 有视频轨
                if (dur != null) return 1;    // 能读出时长 → 音频
                return 0;
            } catch (Exception e) { return 0; }
            finally { try { r.release(); } catch (Exception ignored) {} }
        }

        @JavascriptInterface
        public long mediaDurationMs(String path) {
            android.media.MediaMetadataRetriever r = new android.media.MediaMetadataRetriever();
            try {
                r.setDataSource(path);
                String d = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION);
                return d == null ? 0 : Long.parseLong(d);
            } catch (Exception e) { return 0; }
            finally { try { r.release(); } catch (Exception ignored) {} }
        }

        @JavascriptInterface
        public boolean isForeground() { return appForeground; }

        /* 直接停掉网页里的音频/视频 */
        @JavascriptInterface
        public void logError(String msg) {
            try {
                java.io.File dir = getFilesDir();
                if (!dir.exists()) dir.mkdirs();
                java.io.File f = new java.io.File(dir, "log.txt");
                if (f.length() > 300 * 1024) f.delete();
                java.io.FileOutputStream fo = new java.io.FileOutputStream(f, true);
                fo.write((new java.text.SimpleDateFormat("MM-dd HH:mm:ss").format(new java.util.Date()) + "  " + msg + "\n").getBytes("UTF-8"));
                fo.close();
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public boolean hasStoragePermission() {
            try {
                if (android.os.Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager();
                return checkSelfPermission("android.permission.READ_EXTERNAL_STORAGE") == PackageManager.PERMISSION_GRANTED;
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public void openAllFilesSettings() {
            try {
                Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                i.setData(Uri.parse("package:" + getPackageName()));
                startActivity(i);
            } catch (Exception ignored) {}
        }
    }

    private boolean videoFull = false;
    private volatile boolean appForeground = true;

    public void setVideoFull(boolean on) { videoFull = on; }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        try {
            if (intent != null && intent.getData() != null) deliverUri(intent.getData());
        } catch (Exception ignored) {}
    }

    private void deliverUri(final android.net.Uri uri) {
        new Thread(new Runnable() {
            public void run() {
                try {
                    String name = "外部文件";
                    String path = null;
                    try {
                        android.database.Cursor c = getContentResolver().query(uri, null, null, null, null);
                        if (c != null) {
                            try {
                                if (c.moveToFirst()) {
                                    int ni = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                                    if (ni >= 0) name = c.getString(ni);
                                    int di = c.getColumnIndex("_data");
                                    if (di >= 0) path = c.getString(di);
                                }
                            } finally { c.close(); }
                        }
                    } catch (Exception ignored) {}
                    if (path == null || !new java.io.File(path).isFile()) {
                        java.io.File dir = new java.io.File(getFilesDir(), "incoming");
                        if (!dir.exists()) dir.mkdirs();
                        // 用原始文件名，同名文件直接复用（不产生重复副本）
                        String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                        java.io.File f = new java.io.File(dir, safe);
                        java.io.InputStream is = getContentResolver().openInputStream(uri);
                        java.io.FileOutputStream fo = new java.io.FileOutputStream(f);
                        byte[] buf = new byte[65536];
                        int n;
                        while (is != null && (n = is.read(buf)) > 0) fo.write(buf, 0, n);
                        if (is != null) is.close();
                        fo.close();
                        path = f.getAbsolutePath();
                    }
                    org.json.JSONObject o = new org.json.JSONObject();
                    o.put("name", name);
                    o.put("path", path);
                    final String js = "window.onExternalMedia&&window.onExternalMedia(" + org.json.JSONObject.quote(o.toString()) + ")";
                    web.post(new Runnable() { public void run() { web.evaluateJavascript(js, null); } });
                } catch (Exception ignored) {}
            }
        }).start();
    }

    @Override
    public boolean onKeyDown(int keyCode, android.view.KeyEvent event) {
        if (videoFull && (keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP
                       || keyCode == android.view.KeyEvent.KEYCODE_VOLUME_DOWN)) {
            try {
                android.media.AudioManager am = (android.media.AudioManager) getSystemService(AUDIO_SERVICE);
                int dir = (keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP) ? 1 : -1;
                // 0 标志：不弹系统音量条，只由播放器自己显示
                am.adjustStreamVolume(android.media.AudioManager.STREAM_MUSIC, dir, 0);
                // 回传到网页：当前系统音量百分比
                int cur = am.getStreamVolume(android.media.AudioManager.STREAM_MUSIC);
                int max = am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC);
                int pct = max > 0 ? Math.round(cur * 100f / max) : 0;
                web.evaluateJavascript("window.onVolShow&&window.onVolShow(" + pct + ")", null);
            } catch (Exception ignored) {}
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onBackPressed() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript("(window.dshBack&&window.dshBack())?'1':'0'", new android.webkit.ValueCallback<String>() {
            public void onReceiveValue(String v) {
                if (!"\"1\"".equals(v) && !"1".equals(v)) finish();
            }
        });
    }

    /* ===== 前后台状态（用于"关闭后台播放时离开即停"） ===== */
    @Override
    protected void onResume() {
        super.onResume();
        appForeground = true;
    }

    @Override
    protected void onPause() {
        super.onPause();
        appForeground = false;
        try {
            web.evaluateJavascript("window.onAppBackground&&window.onAppBackground()", null);
        } catch (Exception ignored) {}
    }

    @Override
    protected void onStop() {
        super.onStop();
        appForeground = false;
        try {
            web.evaluateJavascript("window.onAppBackground&&window.onAppBackground()", null);
        } catch (Exception ignored) {}
    }
}
