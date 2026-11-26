package com.arthenica.ffmpegkit;

/**
 * JNI 桩：libffmpegkit.so 按 Java_com_arthenica_ffmpegkit_FFmpegKitConfig_* 查找方法，
 * 所以类名和包名必须完全一致。这里只声明 native，签名对齐库导出的符号。
 */
public class FFmpegKitConfig {

    /* 日志回调：([BLjava/lang/String;)V —— 由库调用 */
    public static void onFFmpegLog(byte[] data, String sessionId) {
        FFmpegBridge.onLog(data, sessionId);
    }

    /* 统计回调：(JIFFJIDD)V —— 由库调用 */
    public static void onFFmpegStatistics(long sessionId, int videoFrameNumber, float videoFps,
                                          float videoQuality, long size, int time,
                                          double bitrate, double speed) {
        FFmpegBridge.onStatistics(sessionId, time, speed);
    }

    public static native int nativeFFmpegExecute(long sessionId, String[] args);
    public static native int nativeFFmpegCancel(long sessionId);
    public static native int setNativeEnvironmentVariable(String name, String value);
    public static native String getNativeFFmpegVersion();
    public static native String getNativeVersion();
    public static native String getNativeBuildDate();
    public static native void setNativeLogLevel(int level);
    public static native int getNativeLogLevel();
    public static native void ignoreNativeSignal(int signal);
    public static native void enableNativeRedirection(long sessionId);
    public static native void disableNativeRedirection(long sessionId);
    public static native int registerNewNativeFFmpegPipe(String pipeName);
    public static native int messagesInTransmit(long sessionId);
}
