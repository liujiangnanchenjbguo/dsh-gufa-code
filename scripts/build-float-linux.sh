#!/usr/bin/env bash
# 在 Linux 本机构建摸鱼悬浮层 helper（X11 + GTK3 + WebKit2GTK），并放到 host 期望的位置。
# 依赖：sudo apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$(uname -s)" != "Linux" ]; then
  echo "build-float-linux.sh 只能在 Linux 上运行；macOS/Windows 请用 GitHub Actions（.github/workflows/build-float.yml）构建。" >&2
  exit 1
fi
make -C desktop/float/linux -j"$(nproc)"
mkdir -p desktop/float/bin/linux-x64
cp desktop/float/linux/gufa-float-linux desktop/float/bin/linux-x64/gufa-float-linux
chmod +x desktop/float/bin/linux-x64/gufa-float-linux
echo "built: desktop/float/bin/linux-x64/gufa-float-linux"
echo "提示：列窗口需要 wmctrl（sudo apt install wmctrl），或直接用 helper 自带 --list-windows。"
