# 大肥鱼影音媒体工作台 / dafish-media-workbench

音频 / 视频播放 + FFmpeg 格式工作台。**无账号、不联网、不上传文件。**

> 本项目为个人作品，**保留所有权利**（FFmpeg 相关部分见下方「许可」一节）。源码公开仅供查看与学习。

## 它是什么

- 完全离线的 Android 媒体工具（WebView 界面 + 原生桥）
- 播放：音频 / 视频，支持后台播放、倍速、进度记忆
- 格式工作台：探码 → 选容器 → 转码 / 裁剪 / 抽取音轨 / 抽帧 / 拼接等，走本地 FFmpeg JNI

## 结构

```
src/
├── AndroidManifest.xml
├── assets/         index.html / app.js / style.css / images（全部界面）
├── java/
│   ├── com/dafish/media/          MainActivity、PlayService（前台播放服务）
│   └── com/arthenica/ffmpegkit/   自己写的 JNI 桥（调用 ffmpeg-kit 的 native 接口）
└── res/            启动图标
```

## 构建

需要 `aapt` / `apksigner` / `zipalign` / `d8` / `javac`，以及一个 `android.jar`。

```sh
cd src && sh build.sh
```

`android.jar` 默认取 `$HOME/android.jar`，可用环境变量覆盖。

**签名**：仓库不含签名密钥。没有密钥也能构建，产出未签名包（装不上，仅用于验证编译）。要打正式包：

```sh
KS=/path/to/your.keystore DAFISH_KS_PASS=你的密码 sh build.sh
```

## ⚠️ 仓库里为什么不包含 jni/

`src/jni/arm64-v8a/` 下是 **ffmpeg-kit 的 FFmpeg 原生库**（`libavcodec.so` 等 9 个文件，约 39MB），
从第三方应用里提取出来的 arm64-v8a 构建。

没放进来，有两个原因：

1. **许可冲突**。这套库是带 `--enable-gpl` 编译的（`libavcodec license: GPL version 3 or later`）。
   GPLv3 有传染性：把它和本应用一起再分发，整个作品就要按 GPLv3 处理，
   与本项目「保留所有权利」的声明直接冲突。
2. **来历**。这些 `.so` 并非来自官方发布渠道，不适合再次公开分发。

想自己构建带完整 FFmpeg 功能的版本，请自行准备 arm64-v8a 的 ffmpeg-kit 库，
放到 `src/jni/arm64-v8a/` 下，构建脚本检测到就会自动打包（见脚本 `[3b/6]` 那一段）。

## 许可

- 本仓库中由作者编写的代码：保留所有权利。
- FFmpeg / ffmpeg-kit：GPL v3（本仓库**不包含**其二进制；若你自行加入并以 GPL 条款分发，
  你需要自行遵守 GPL v3 的相应义务）。
