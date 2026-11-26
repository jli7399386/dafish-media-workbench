#!/system/bin/sh
# 大肥鱼影音媒体工作台 · 构建脚本
#
# 用法：
#   cd src && sh build.sh
#
# 签名密钥不随仓库分发。要打能覆盖升级的正式包，需要自己有那把 keystore：
#   KS=/path/to/your.keystore DAFISH_KS_PASS=你的密码 sh build.sh
# 密码也可以写进本目录的 .kspass（已在 .gitignore 里排除）。
# 没有密钥也能构建，产出未签名包，仅供检查编译。
#
# ⚠️ 关于 jni/：仓库里不含 FFmpeg 原生库。
#    本项目所需的 libffmpegkit / libavcodec 等是 ffmpeg-kit 的 **GPL v3** 构建产物，
#    体积约 39MB。FFmpeg 以 GPL 分发时有传染性，把它连同应用一起再分发，
#    整个作品就要按 GPL 处理，与本项目「保留所有权利」的声明冲突；
#    而且这些 .so 是从第三方应用里提取的，来历上也不适合再次分发。
#    想自己构建完整版，请自行准备 arm64-v8a 的 ffmpeg-kit 库放到 jni/arm64-v8a/，
#    构建脚本检测到该目录会自动打包（见 [3b/6]）。

set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
VERSION="0.85"
OUTNAME="dafish-media-workbench-v${VERSION}"
OUT="$SRC/build"
KEYDIR="$(dirname "$SRC")"
DIST="$(dirname "$KEYDIR")"

AAPT="$(command -v aapt)"
ZIPALIGN="$(command -v zipalign)"
APKSIGNER="$(command -v apksigner)"
D8="$(command -v d8)"
JAVAC="$(command -v javac)"
AJAR="${HOME:-/data/user/0/app.dsh.mobile/files/dsh-home}/android.jar"

[ -f "$AJAR" ] || { echo "找不到 android.jar: $AJAR"; exit 1; }

rm -rf "$OUT"; mkdir -p "$OUT/classes" "$OUT/dex"

echo "[1/6] javac"
"$JAVAC" -source 8 -target 8 -bootclasspath "$AJAR" -classpath "$AJAR" \
  -d "$OUT/classes" $(find "$SRC/java" -name "*.java") 2>&1 | grep -v "bootstrap class path" || true

echo "[2/6] d8"
"$D8" --release --min-api 23 --lib "$AJAR" --output "$OUT/dex" \
  $(find "$OUT/classes" -name "*.class")

echo "[3/6] aapt package"
"$AAPT" package -f -M "$SRC/AndroidManifest.xml" -S "$SRC/res" -A "$SRC/assets" \
  -I /system/framework/framework-res.apk -F "$OUT/app-unsigned.apk"

# 原生库（ffmpeg-kit）
if [ -d "$SRC/jni/arm64-v8a" ]; then
  echo "[3b/6] 打包原生库"
  rm -rf "$OUT/jl"; mkdir -p "$OUT/jl/lib"
  cp -r "$SRC/jni/arm64-v8a" "$OUT/jl/lib/"
  ( cd "$OUT/jl" && zip -q -r "$OUT/app-unsigned.apk" lib -x '.*' )
else
  echo "[3b/6] 跳过原生库（jni/arm64-v8a 不存在 —— 这样打出来的包没有 FFmpeg，格式转换功能不可用）"
fi

echo "[4/6] classes.dex"
( cd "$OUT/dex" && zip -q -j "$OUT/app-unsigned.apk" classes.dex )

echo "[5/6] zipalign"
"$ZIPALIGN" -f 4 "$OUT/app-unsigned.apk" "$OUT/app-aligned.apk"

echo "[6/6] 签名"
[ -n "$KS" ] && [ -f "$KS" ] || {
  for c in "$SRC"/*.keystore "$SRC"/../*.keystore; do
    [ -f "$c" ] && { KS="$c"; break; }
  done
}
[ -n "$DAFISH_KS_PASS" ] || {
  for f in "$SRC/.kspass" "$SRC/../.kspass"; do
    [ -f "$f" ] && { DAFISH_KS_PASS="$(cat "$f")"; break; }
  done
}

if [ -z "$KS" ] || [ ! -f "$KS" ] || [ -z "$DAFISH_KS_PASS" ]; then
  cp -f "$OUT/app-aligned.apk" "$DIST/$OUTNAME-unsigned.apk"
  echo "没有签名密钥或密码，只产出未签名包：$DIST/$OUTNAME-unsigned.apk"
  echo "（打正式包：KS=/path/your.keystore DAFISH_KS_PASS=密码 sh build.sh）"
  exit 0
fi

"$APKSIGNER" sign --ks "$KS" --ks-pass "pass:$DAFISH_KS_PASS" --key-pass "pass:$DAFISH_KS_PASS" \
  --out "$OUT/$OUTNAME.apk" "$OUT/app-aligned.apk"

cp -f "$OUT/$OUTNAME.apk" "$DIST/$OUTNAME.apk"
echo "完成: $DIST/$OUTNAME.apk  $(stat -c %s "$DIST/$OUTNAME.apk") bytes"
