#!/usr/bin/env bash
# 构建 macOS 悬浮层 helper（P0/P1）：Objective-C + AppKit + WebKit。
# 产物 1：可直接启动的二进制（Host spawn 用）
# 产物 2：.app bundle（方便用户在「屏幕录制」隐私列表里手动添加）
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p desktop/float/bin
ARCH="$(uname -m)"
OUT="desktop/float/bin/gufa-float-macos-${ARCH}"
clang -fobjc-arc -O2 -framework AppKit -framework WebKit -framework Carbon -o "$OUT" desktop/float/GufaFloat.m
chmod +x "$OUT"
# 带稳定的 code identifier 签名（TCC 按它识别，避免每次构建都换身份字符串）
codesign --force --sign - -i com.gufa.float "$OUT" >/dev/null 2>&1 || true

APP="desktop/float/古法编程悬浮层.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$OUT" "$APP/Contents/MacOS/gufa-float"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.gufa.float</string>
  <key>CFBundleName</key><string>古法编程悬浮层</string>
  <key>CFBundleDisplayName</key><string>古法编程悬浮层</string>
  <key>CFBundleExecutable</key><string>gufa-float</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.3.1</string>
  <key>CFBundleVersion</key><string>1.3.1</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
echo "built: $OUT"
echo "built: $APP"
