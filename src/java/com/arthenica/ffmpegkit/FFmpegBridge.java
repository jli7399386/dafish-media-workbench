package com.arthenica.ffmpegkit;

import com.dafish.media.MainActivity;

/** 库回调 → 我们的业务层 */
public class FFmpegBridge {
    public static MainActivity host;

    public static void onLog(byte[] data, String sessionId) {
        try {
            String line = new String(data, "UTF-8");
            if (host != null) host.ffLog(line);
        } catch (Throwable ignored) {}
    }

    public static void onStatistics(long sessionId, int timeMs, double speed) {
        if (host != null) host.ffStats(timeMs, speed);
    }

    public static boolean load() {
        try {
            System.loadLibrary("c++_shared");
            System.loadLibrary("avutil");
            System.loadLibrary("swresample");
            System.loadLibrary("swscale");
            System.loadLibrary("avcodec");
            System.loadLibrary("avformat");
            System.loadLibrary("avfilter");
            System.loadLibrary("avdevice");
            System.loadLibrary("ffmpegkit");
            return true;
        } catch (Throwable t) {
            loadErr = String.valueOf(t);
            return false;
        }
    }

    public static String loadErr = "";
}
