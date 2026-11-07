/**
 * X11 相关能力（Linux helper 专有）：
 *   - 按 pid 找目标窗口（follow 吸附）、读取窗口在 root 坐标系里的矩形；
 *   - 读 _NET_WM_PID / _NET_WM_NAME / WM_CLASS，识别窗口类型；
 *   - 隐藏 / 恢复 DSH 主窗口（_NET_WM_PID 或标题匹配）；
 *   - 发送 _NET_ACTIVE_WINDOW 前置窗口、复制 _NET_WM_DESKTOP 工作区；
 *   - --list-windows 模式的窗口枚举。
 *
 * 所有查询走 helper 自己开的独立 X 连接，避免影响 GTK 的 GDK 连接与错误处理。
 * Wayland 下这里不可用（XOpenDisplay 拿不到目标窗口），上层负责降级。
 */
#ifndef GUFA_X11_H
#define GUFA_X11_H

#include <X11/Xlib.h>
#include <glib.h>

typedef struct {
    int x;
    int y;
    int width;
    int height;
    gboolean valid;
    gboolean viewable;
} GufaX11Rect;

typedef struct {
    Window *wins;
    guint n;
} GufaX11WindowList;

typedef struct {
    Window win;
    long pid;
    char *title;
    char *owner;
    char *wm_class;
    gboolean frontmost;
} GufaX11App;

typedef struct {
    Display *dpy;
    Window root;
    gboolean ok;
    long self_pid;
    Atom atom_net_wm_pid;
    Atom atom_net_wm_name;
    Atom atom_wm_name;
    Atom atom_wm_state;
    Atom atom_ob_app_title;
    Atom atom_utf8_string;
    Atom atom_net_active_window;
    Atom atom_net_client_list;
    Atom atom_net_client_list_stacking;
    Atom atom_net_wm_window_type;
    Atom atom_net_wm_window_type_normal;
    Atom atom_net_wm_window_type_dialog;
    Atom atom_net_wm_window_type_desktop;
    Atom atom_net_wm_window_type_dock;
    Atom atom_net_wm_window_type_toolbar;
    Atom atom_net_wm_window_type_menu;
    Atom atom_net_wm_window_type_utility;
    Atom atom_net_wm_window_type_splash;
    Atom atom_net_wm_window_type_dropdown;
    Atom atom_net_wm_window_type_tooltip;
    Atom atom_net_wm_desktop;
} GufaX11;

/** 打开 X 连接并缓存 atoms。失败返回 FALSE（上层降级为纯 GTK 自由悬浮）。 */
gboolean gufa_x11_open(GufaX11 *x11);

/** 关闭连接（可重复调用）。 */
void gufa_x11_close(GufaX11 *x11);

/** 读窗口标题（_NET_WM_NAME 优先，退回 WM_NAME）；调用方 g_free。 */
char *gufa_x11_window_title(GufaX11 *x11, Window window);

/** 读 _NET_WM_PID；没有返回 0。 */
long gufa_x11_window_pid(GufaX11 *x11, Window window);

/** 读 WM_CLASS 的 class 字段（退回 instance）；调用方 g_free。 */
char *gufa_x11_window_class(GufaX11 *x11, Window window);

/** 当前活动窗口（_NET_ACTIVE_WINDOW），没有返回 0。 */
Window gufa_x11_active_window(GufaX11 *x11);

/**
 * 按 pid（>0 时）找目标窗口，title_hint 非空时优先标题匹配；
 * 只考虑可跟随的普通窗口（_NET_WM_WINDOW_TYPE 为 NORMAL/DIALOG 或未声明）。
 */
Window gufa_x11_find_window(GufaX11 *x11, long pid, const char *title_hint, Window skip);

/** 读取窗口在 root 上的绝对矩形；窗口不存在返回 FALSE。 */
gboolean gufa_x11_window_rect(GufaX11 *x11, Window window, GufaX11Rect *out);

/** 窗口是否还存在（可能已最小化/未映射）。 */
gboolean gufa_x11_window_exists(GufaX11 *x11, Window window);

/** 发送 _NET_ACTIVE_WINDOW ClientMessage 并 raise。 */
void gufa_x11_activate_window(GufaX11 *x11, Window window, guint32 timestamp);

/** 映射窗口（恢复显示），可选 raise。 */
void gufa_x11_map_window(GufaX11 *x11, Window window, gboolean do_raise);

/** 把 own 窗口的 _NET_WM_DESKTOP 设置成 target 窗口所在工作区（best-effort）。 */
void gufa_x11_copy_desktop(GufaX11 *x11, Window target, Window own);

/**
 * 隐藏 DSH 主窗口：优先 owner_pid 匹配，找不到时按标题/类名启发式匹配；
 * 命中的窗口被 XUnmapWindow 并记录到 hidden（供退出时恢复）。
 */
void gufa_x11_hide_windows_like_dsh(GufaX11 *x11, long owner_pid, const char *title_hint, GufaX11WindowList *hidden);

/** 恢复 hidden 里的窗口（XMapWindow + raise + _NET_ACTIVE_WINDOW 前置）。 */
void gufa_x11_restore_windows(GufaX11 *x11, GufaX11WindowList *hidden, guint32 timestamp);

/** 枚举可吸附的 App 窗口（--list-windows 模式用，调用方用 gufa_x11_apps_free 释放）。 */
GPtrArray *gufa_x11_list_apps(GufaX11 *x11);

void gufa_x11_apps_free(GPtrArray *apps);

#endif /* GUFA_X11_H */
