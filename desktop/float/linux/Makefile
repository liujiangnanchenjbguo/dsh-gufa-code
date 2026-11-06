# 古法编程 · Linux 悬浮层 helper（X11 + GTK3 + WebKit2GTK）
#
# 依赖（Ubuntu / Debian）：
#   sudo apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev
#   （老发行版只有 webkit2gtk-4.0 时：libwebkit2gtk-4.0-dev，Makefile 会自动探测）
#
# 构建：
#   make -j"$(nproc)"
# 产物：
#   ./gufa-float-linux
#
# 说明：WebKit2GTK 的 4.1（libsoup3）与 4.0（libsoup2）两套 pkg-config 包都支持，
# 优先 4.1；cookie 注入所需的 libsoup 由 WebKit 的 pkg-config Requires 带进来，
# 这里再显式探测一次，兼容只装了其中一套的环境。

CC ?= cc
PKG_CONFIG ?= pkg-config

# ── WebKit2GTK：4.1 优先，退回 4.0 ─────────────────────────────────────
WEBKIT_PKG := $(shell $(PKG_CONFIG) --exists webkit2gtk-4.1 2>/dev/null && echo webkit2gtk-4.1)
ifeq ($(strip $(WEBKIT_PKG)),)
WEBKIT_PKG := $(shell $(PKG_CONFIG) --exists webkit2gtk-4.0 2>/dev/null && echo webkit2gtk-4.0)
endif
ifeq ($(strip $(WEBKIT_PKG)),)
# 允许在没有依赖的机器上执行 make clean；真正构建时再报错
ifneq ($(filter clean,$(MAKECMDGOALS)),clean)
$(error 找不到 WebKit2GTK 开发包：请安装 libwebkit2gtk-4.1-dev（或 libwebkit2gtk-4.0-dev），即 pkg-config 能识别 webkit2gtk-4.1 / webkit2gtk-4.0)
endif
endif

# ── libsoup：必须和 WebKit ABI 匹配——4.1 用 libsoup-3.0，4.0 用 libsoup-2.4 ──
ifeq ($(WEBKIT_PKG),webkit2gtk-4.1)
SOUP_PKG := $(shell $(PKG_CONFIG) --exists libsoup-3.0 2>/dev/null && echo libsoup-3.0)
else
SOUP_PKG := $(shell $(PKG_CONFIG) --exists libsoup-2.4 2>/dev/null && echo libsoup-2.4)
endif
ifeq ($(strip $(SOUP_PKG)),)
SOUP_PKG := $(shell $(PKG_CONFIG) --exists libsoup-3.0 2>/dev/null && echo libsoup-3.0)
endif
ifeq ($(strip $(SOUP_PKG)),)
SOUP_PKG := $(shell $(PKG_CONFIG) --exists libsoup-2.4 2>/dev/null && echo libsoup-2.4)
endif
ifeq ($(strip $(SOUP_PKG)),)
ifneq ($(filter clean,$(MAKECMDGOALS)),clean)
$(error 找不到 libsoup 开发包：WebKit2GTK 的 cookie 接口需要 libsoup-3.0-dev（4.1）或 libsoup-2.4-dev（4.0）)
endif
endif

# ── X11（gdkx.h / Xlib 直接用） ────────────────────────────────────────
X11_CFLAGS := $(shell $(PKG_CONFIG) --cflags x11 2>/dev/null)
X11_LIBS := $(shell $(PKG_CONFIG) --libs x11 2>/dev/null)
ifeq ($(strip $(X11_LIBS)),)
X11_CFLAGS :=
X11_LIBS := -lX11
endif

PKGS := gtk+-3.0 $(WEBKIT_PKG) $(SOUP_PKG)

TARGET := gufa-float-linux
SRCS := main.c json.c x11.c log.c
OBJS := $(SRCS:.c=.o)

BASE_CFLAGS := -std=c11 -Wall -Wextra -Wno-unused-parameter -Wno-deprecated-declarations
CFLAGS ?= -O2 -g
ALL_CFLAGS := $(BASE_CFLAGS) $(CFLAGS) $(X11_CFLAGS) $(shell $(PKG_CONFIG) --cflags $(PKGS) 2>/dev/null)
ALL_LDLIBS := $(shell $(PKG_CONFIG) --libs $(PKGS) 2>/dev/null) $(X11_LIBS) -lm

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $(LDFLAGS) -o $@ $(OBJS) $(ALL_LDLIBS)
	@echo "已生成 $(TARGET)（WebKit2GTK: $(WEBKIT_PKG)，libsoup: $(SOUP_PKG)）"

%.o: %.c json.h log.h x11.h
	$(CC) $(ALL_CFLAGS) $(CPPFLAGS) -c $< -o $@

# 无桌面环境下也能跑的冒烟测试（需要 xvfb-run；加载 127.0.0.1:1 会失败，ciProbe 仍应输出 JSON 并退出 0）
smoke: $(TARGET)
	@command -v xvfb-run >/dev/null 2>&1 || { echo "需要 xvfb-run（apt install xvfb）"; exit 1; }
	timeout 40 xvfb-run -a ./$(TARGET) '{"appUrl":"http://127.0.0.1:1/","authUrl":"http://127.0.0.1:1/","ciProbe":true}'

clean:
	rm -f $(TARGET) $(OBJS)

.PHONY: all clean smoke
