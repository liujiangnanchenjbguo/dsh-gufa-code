#!/usr/bin/env bash
# 构建 macOS 悬浮层 helper（P0）：Objective-C + AppKit + WebKit，避免本机 Swift/SDK 版本不匹配问题。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p desktop/float/bin
ARCH="$(uname -m)"
OUT="desktop/float/bin/gufa-float-macos-${ARCH}"
clang -fobjc-arc -O2 -framework AppKit -framework WebKit -o "$OUT" desktop/float/GufaFloat.m
chmod +x "$OUT"
codesign --force --sign - "$OUT" >/dev/null 2>&1 || true
echo "built: $OUT"
