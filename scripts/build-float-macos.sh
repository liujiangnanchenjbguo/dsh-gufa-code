#!/usr/bin/env bash
# 构建 macOS 悬浮层 helper：Objective-C + AppKit + WebKit。
# 产物：
#   desktop/float/bin/gufa-float-macos-arm64       (Apple Silicon)
#   desktop/float/bin/gufa-float-macos-x64         (Intel)
#   desktop/float/bin/gufa-float-macos-universal   (通用二进制，两个架构都能跑)
#   desktop/float/古法编程悬浮层.app                (通用二进制 + ad-hoc 签名)
# 在 Apple Silicon 上也能交叉编译 x86_64（Xcode CLT 自带两套架构 SDK），
# 所以 npm 包可以只带 universal 一份、Intel/Apple Silicon 开箱即用。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p desktop/float/bin

VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo 0.0.0)"
SRC=desktop/float/GufaFloat.m
TMP_ARM="$(mktemp /tmp/gufa-float-arm64.XXXXXX)"
TMP_X64="$(mktemp /tmp/gufa-float-x64.XXXXXX)"
trap 'rm -f "$TMP_ARM" "$TMP_X64"' EXIT

compile_arch() {
  local arch="$1" out="$2"
  clang -fobjc-arc -O2 -arch "$arch" \
    -DGUFA_FLOAT_VERSION="\"${VERSION}\"" \
    -framework AppKit -framework WebKit -framework Carbon \
    -o "$out" "$SRC"
}

echo "building arm64 slice..."
compile_arch arm64 "$TMP_ARM"
echo "building x86_64 slice..."
compile_arch x86_64 "$TMP_X64"

cp "$TMP_ARM" desktop/float/bin/gufa-float-macos-arm64
cp "$TMP_X64" desktop/float/bin/gufa-float-macos-x64
lipo -create "$TMP_ARM" "$TMP_X64" -output desktop/float/bin/gufa-float-macos-universal
chmod +x desktop/float/bin/gufa-float-macos-*.??? 2>/dev/null || true
chmod +x desktop/float/bin/gufa-float-macos-arm64 desktop/float/bin/gufa-float-macos-x64 desktop/float/bin/gufa-float-macos-universal

# 稳定的 code identifier（TCC 按它识别，避免每次构建换身份字符串）
codesign --force --sign - -i com.gufa.float desktop/float/bin/gufa-float-macos-arm64 >/dev/null 2>&1 || true
codesign --force --sign - -i com.gufa.float desktop/float/bin/gufa-float-macos-x64 >/dev/null 2>&1 || true
codesign --force --sign - -i com.gufa.float desktop/float/bin/gufa-float-macos-universal >/dev/null 2>&1 || true

APP="desktop/float/古法编程悬浮层.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp desktop/float/bin/gufa-float-macos-universal "$APP/Contents/MacOS/gufa-float"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.gufa.float</string>
  <key>CFBundleName</key><string>古法编程悬浮层</string>
  <key>CFBundleDisplayName</key><string>古法编程悬浮层</string>
  <key>CFBundleExecutable</key><string>gufa-float</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

echo "built: desktop/float/bin/gufa-float-macos-universal ($(lipo -archs desktop/float/bin/gufa-float-macos-universal))"
echo "built: $APP"
