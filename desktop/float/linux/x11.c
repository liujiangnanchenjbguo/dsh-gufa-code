/**
 * X11 能力实现（见 x11.h）。
 */
#include "x11.h"

#include <X11/Xatom.h>
#include <X11/Xutil.h>

#include <stdio.h>
#include <string.h>
#include <unistd.h>

#include "log.h"

typedef struct {
    Window win;
    long pid;
    int x;
    int y;
    int width;
    int height;
    gboolean viewable;
} GufaX11WindowInfo;

/* ── Xlib 错误处理：查询窗口时窗口可能刚好消失，BadWindow 属于预期情况 ── */
static int (*gufa_previous_error_handler)(Display *, XErrorEvent *) = NULL;
static gboolean gufa_error_handler_installed = FALSE;

static int gufa_x11_error_handler(Display *display, XErrorEvent *event) {
    if (event != NULL &&
        (event->error_code == BadWindow || event->error_code == BadDrawable ||
         event->error_code == BadMatch || event->error_code == BadValue ||
         event->error_code == BadAccess)) {
        return 0;
    }
    if (gufa_previous_error_handler != NULL) {
        return gufa_previous_error_handler(display, event);
    }
    return 0;
}

static void gufa_x11_install_error_handler(void) {
    if (gufa_error_handler_installed) return;
    gufa_error_handler_installed = TRUE;
    XErrorHandler previous = XSetErrorHandler(gufa_x11_error_handler);
    gufa_previous_error_handler = (int (*)(Display *, XErrorEvent *))previous;
}

/* ── 属性读取工具 ───────────────────────────────────────────────────── */

static gboolean gufa_x11_get_property(GufaX11 *x11, Window window, Atom atom, Atom requested_type,
                                      unsigned char **data, Atom *actual_type, int *actual_format,
                                      unsigned long *nitems) {
    unsigned long bytes_after = 0;
    *data = NULL;
    *actual_type = None;
    *actual_format = 0;
    *nitems = 0;
    if (x11 == NULL || !x11->ok || x11->dpy == NULL || window == 0) return FALSE;
    int status = XGetWindowProperty(x11->dpy, window, atom, 0, 4096, False, requested_type,
                                    actual_type, actual_format, nitems, &bytes_after, data);
    if (status != Success || *data == NULL) {
        if (*data != NULL) {
            XFree(*data);
            *data = NULL;
        }
        return FALSE;
    }
    return TRUE;
}

/** 读任意类型、format 8 的属性原始字节。
 *  标题属性（_NET_WM_NAME / WM_NAME）的 type 可能是 UTF8_STRING / STRING / COMPOUND_TEXT，
 *  对 ASCII 标题这些编码的字节兼容，直接按字节返回，避免 XFetchName 只认 STRING 的局限。 */
static char *gufa_x11_get_property_text(GufaX11 *x11, Window window, Atom atom) {
    unsigned char *data = NULL;
    Atom type = None;
    int format = 0;
    unsigned long nitems = 0;
    if (!gufa_x11_get_property(x11, window, atom, AnyPropertyType, &data, &type, &format, &nitems)) {
        return NULL;
    }
    char *text = NULL;
    if (format == 8 && nitems > 0 && data != NULL) {
        text = g_strndup((const char *)data, (gsize)nitems);
    }
    XFree(data);
    return text;
}

/** 窗口是否被 WM 管理（有 WM_STATE 属性）。reparenting WM 的 frame/decor 窗口没有该属性，
 *  client 窗口有；用于在 _NET_WM_PID 缺失时仍然识别真正的应用窗口。 */
static gboolean gufa_x11_window_has_wm_state(GufaX11 *x11, Window window) {
    unsigned char *data = NULL;
    Atom type = None;
    int format = 0;
    unsigned long nitems = 0;
    if (!gufa_x11_get_property(x11, window, x11->atom_wm_state, AnyPropertyType,
                               &data, &type, &format, &nitems)) {
        return FALSE;
    }
    XFree(data);
    return TRUE;
}

/** 把日志里的窗口标题 sanitize 成单行。 */
static char *gufa_x11_log_text(const char *text) {
    if (text == NULL) return g_strdup("(null)");
    char *copy = g_strdup(text);
    for (char *p = copy; *p != '\0'; p++) {
        if ((unsigned char)*p < 0x20) *p = '?';
    }
    return copy;
}

long gufa_x11_window_pid(GufaX11 *x11, Window window) {
    unsigned char *data = NULL;
    Atom type = None;
    int format = 0;
    unsigned long nitems = 0;
    long pid = 0;
    if (!gufa_x11_get_property(x11, window, x11->atom_net_wm_pid, XA_CARDINAL, &data, &type, &format, &nitems)) {
        return 0;
    }
    if (format == 32 && nitems >= 1 && data != NULL) {
        pid = (long)((unsigned long *)(void *)data)[0];
    }
    XFree(data);
    return pid;
}

char *gufa_x11_window_title(GufaX11 *x11, Window window) {
    /* EWMH 标题优先（规范要求 UTF-8，但类型可能被写成 STRING，按原始字节读更稳） */
    char *title = gufa_x11_get_property_text(x11, window, x11->atom_net_wm_name);
    if (title != NULL && *title != '\0') return title;
    g_free(title);
    /* ICCCM WM_NAME：type 可能是 STRING / COMPOUND_TEXT / UTF8_STRING，按原始字节读 */
    title = gufa_x11_get_property_text(x11, window, x11->atom_wm_name);
    if (title != NULL && *title != '\0') return title;
    g_free(title);
    /* 最后的 encoding 感知回退（STRING） */
    char *wm_name = NULL;
    if (x11->dpy != NULL && XFetchName(x11->dpy, window, &wm_name) != 0 && wm_name != NULL) {
        char *copy = g_strdup(wm_name);
        XFree(wm_name);
        return copy;
    }
    return NULL;
}

char *gufa_x11_window_class(GufaX11 *x11, Window window) {
    if (x11 == NULL || !x11->ok || window == 0) return NULL;
    XClassHint hint;
    memset(&hint, 0, sizeof(hint));
    if (XGetClassHint(x11->dpy, window, &hint) == 0) return NULL;
    char *result = NULL;
    if (hint.res_class != NULL && *hint.res_class != '\0') {
        result = g_strdup(hint.res_class);
    } else if (hint.res_name != NULL && *hint.res_name != '\0') {
        result = g_strdup(hint.res_name);
    }
    if (hint.res_name != NULL) XFree(hint.res_name);
    if (hint.res_class != NULL) XFree(hint.res_class);
    return result;
}

Window gufa_x11_active_window(GufaX11 *x11) {
    unsigned char *data = NULL;
    Atom type = None;
    int format = 0;
    unsigned long nitems = 0;
    Window window = 0;
    if (!gufa_x11_get_property(x11, x11->root, x11->atom_net_active_window, XA_WINDOW,
                               &data, &type, &format, &nitems)) {
        return 0;
    }
    if (format == 32 && nitems >= 1 && data != NULL) {
        window = (Window)((unsigned long *)(void *)data)[0];
    }
    XFree(data);
    return window;
}

/* ── 窗口枚举 ───────────────────────────────────────────────────────── */

static gboolean gufa_x11_window_type_followable(GufaX11 *x11, Window window) {
    unsigned char *data = NULL;
    Atom type = None;
    int format = 0;
    unsigned long nitems = 0;
    if (!gufa_x11_get_property(x11, window, x11->atom_net_wm_window_type, XA_ATOM, &data, &type, &format, &nitems)) {
        return TRUE; /* 没有声明类型：当作普通窗口 */
    }
    gboolean followable = FALSE;
    if (format == 32 && data != NULL) {
        long *atoms = (long *)(void *)data;
        for (unsigned long i = 0; i < nitems; i++) {
            Atom value = (Atom)atoms[i];
            if (value == x11->atom_net_wm_window_type_normal || value == x11->atom_net_wm_window_type_dialog) {
                followable = TRUE;
                break;
            }
        }
    }
    XFree(data);
    return followable;
}

/** 隐藏场景的类型过滤：只排除明确不是普通应用窗口的类型；未知/空类型/NORMAL/DIALOG/UTILITY 都允许，
 *  避免 xterm 之类不声明类型的窗口被误杀。 */
static gboolean gufa_x11_window_type_hideable(GufaX11 *x11, Window window) {
    unsigned char *data = NULL;
    Atom type = None;
    int format = 0;
    unsigned long nitems = 0;
    if (!gufa_x11_get_property(x11, window, x11->atom_net_wm_window_type, XA_ATOM,
                               &data, &type, &format, &nitems)) {
        return TRUE;
    }
    gboolean hideable = TRUE;
    if (format == 32 && data != NULL) {
        long *atoms = (long *)(void *)data;
        for (unsigned long i = 0; i < nitems; i++) {
            Atom value = (Atom)atoms[i];
            if (value == x11->atom_net_wm_window_type_desktop ||
                value == x11->atom_net_wm_window_type_dock ||
                value == x11->atom_net_wm_window_type_toolbar ||
                value == x11->atom_net_wm_window_type_menu ||
                value == x11->atom_net_wm_window_type_dropdown ||
                value == x11->atom_net_wm_window_type_tooltip ||
                value == x11->atom_net_wm_window_type_splash) {
                hideable = FALSE;
                break;
            }
        }
    }
    XFree(data);
    return hideable;
}

static void gufa_x11_collect_children(GufaX11 *x11, Window parent, int depth, Window skip,
                                     gboolean include_unmapped, GArray *out) {
    Window root_return = 0;
    Window parent_return = 0;
    Window *children = NULL;
    unsigned int child_count = 0;
    if (depth > 3) return;
    if (XQueryTree(x11->dpy, parent, &root_return, &parent_return, &children, &child_count) == 0) return;
    for (unsigned int i = 0; i < child_count; i++) {
        Window window = children[i];
        if (window == skip) continue;
        XWindowAttributes attributes;
        memset(&attributes, 0, sizeof(attributes));
        if (XGetWindowAttributes(x11->dpy, window, &attributes) == 0) continue;
        if (attributes.override_redirect) continue;
        if (attributes.class != InputOutput) continue;
        long pid = gufa_x11_window_pid(x11, window);
        gboolean usable = attributes.width >= 40 && attributes.height >= 40 &&
                          (include_unmapped || attributes.map_state == IsViewable);
        gboolean is_managed = FALSE;
        if (pid <= 0 && usable) {
            /* _NET_WM_PID 缺失时，用 WM_STATE 识别真正的 client 窗口（reparenting WM 的 frame 没有） */
            is_managed = gufa_x11_window_has_wm_state(x11, window);
        }
        if (pid > 0 || is_managed) {
            if (!usable) continue;
            int root_x = 0;
            int root_y = 0;
            Window child_return = 0;
            if (XTranslateCoordinates(x11->dpy, window, x11->root, 0, 0, &root_x, &root_y, &child_return) == 0) {
                root_x = 0;
                root_y = 0;
            }
            GufaX11WindowInfo info;
            info.win = window;
            info.pid = pid;
            info.x = root_x;
            info.y = root_y;
            info.width = attributes.width;
            info.height = attributes.height;
            info.viewable = attributes.map_state == IsViewable;
            g_array_append_val(out, info);
        }
        if (pid <= 0 && depth < 4) {
            /* 有 WM 时 root 的子窗口是 frame/decor，真正的 client 在更深层；深度放宽到 4 层 */
            gufa_x11_collect_children(x11, window, depth + 1, skip, include_unmapped, out);
        }
    }
    if (children != NULL) XFree(children);
}

/** 用 EWMH 的 _NET_CLIENT_LIST / _NET_CLIENT_LIST_STACKING 补齐候选：比窗口树更权威，
 *  即使树层级/深度/pid 有任何意外也能拿到 WM 管理的 client 窗口。 */
static void gufa_x11_collect_client_list(GufaX11 *x11, Window skip, gboolean include_unmapped,
                                         GArray *out) {
    Atom atoms[2];
    atoms[0] = x11->atom_net_client_list;
    atoms[1] = x11->atom_net_client_list_stacking;
    GHashTable *seen = g_hash_table_new(g_direct_hash, g_direct_equal);
    for (guint i = 0; i < out->len; i++) {
        GufaX11WindowInfo *info = &g_array_index(out, GufaX11WindowInfo, i);
        g_hash_table_add(seen, (gpointer)(guintptr)info->win);
    }
    for (int a = 0; a < 2; a++) {
        unsigned char *data = NULL;
        Atom type = None;
        int format = 0;
        unsigned long nitems = 0;
        if (!gufa_x11_get_property(x11, x11->root, atoms[a], AnyPropertyType,
                                   &data, &type, &format, &nitems)) {
            continue;
        }
        if (format != 32 || data == NULL) {
            XFree(data);
            continue;
        }
        Window *windows = (Window *)(void *)data;
        if (nitems > 512) nitems = 512;
        for (unsigned long i = 0; i < nitems; i++) {
            Window window = windows[i];
            if (window == 0 || window == skip) continue;
            if (g_hash_table_contains(seen, (gpointer)(guintptr)window)) continue;
            XWindowAttributes attributes;
            memset(&attributes, 0, sizeof(attributes));
            if (XGetWindowAttributes(x11->dpy, window, &attributes) == 0) continue;
            if (attributes.override_redirect) continue;
            if (attributes.width < 40 || attributes.height < 40) continue;
            if (!include_unmapped && attributes.map_state != IsViewable) continue;
            int root_x = 0;
            int root_y = 0;
            Window child_return = 0;
            if (XTranslateCoordinates(x11->dpy, window, x11->root, 0, 0, &root_x, &root_y, &child_return) == 0) {
                root_x = 0;
                root_y = 0;
            }
            GufaX11WindowInfo info;
            info.win = window;
            info.pid = gufa_x11_window_pid(x11, window);
            info.x = root_x;
            info.y = root_y;
            info.width = attributes.width;
            info.height = attributes.height;
            info.viewable = attributes.map_state == IsViewable;
            g_array_append_val(out, info);
            g_hash_table_add(seen, (gpointer)(guintptr)window);
        }
        XFree(data);
    }
    g_hash_table_destroy(seen);
}

/** 枚举「WM 管理的顶层 client 窗口」：窗口树递归 + EWMH client list 并集；
 *  include_unmapped 时也收其它工作区/最小化的窗口。 */
static GArray *gufa_x11_enumerate(GufaX11 *x11, Window skip, gboolean include_unmapped) {
    GArray *out = g_array_new(FALSE, FALSE, sizeof(GufaX11WindowInfo));
    if (x11 == NULL || !x11->ok) return out;
    gufa_x11_collect_children(x11, x11->root, 0, skip, include_unmapped, out);
    gufa_x11_collect_client_list(x11, skip, include_unmapped, out);
    return out;
}

static void gufa_x11_window_list_clear(GufaX11WindowList *hidden) {
    if (hidden == NULL) return;
    g_free(hidden->wins);
    hidden->wins = NULL;
    hidden->n = 0;
}

static void gufa_x11_window_list_add(GufaX11WindowList *hidden, Window window) {
    if (hidden == NULL || window == 0) return;
    hidden->wins = g_renew(Window, hidden->wins, hidden->n + 1);
    hidden->wins[hidden->n] = window;
    hidden->n++;
}

static gboolean gufa_text_contains_ci(const char *haystack, const char *needle) {
    if (haystack == NULL || needle == NULL || *needle == '\0') return FALSE;
    char *haystack_lower = g_ascii_strdown(haystack, -1);
    char *needle_lower = g_ascii_strdown(needle, -1);
    gboolean found = strstr(haystack_lower, needle_lower) != NULL;
    g_free(haystack_lower);
    g_free(needle_lower);
    return found;
}

static char *gufa_x11_process_comm(long pid);
static char *gufa_x11_process_cmdline(long pid);
static char *gufa_x11_window_original_title(GufaX11 *x11, Window window);

/* ── 对外接口 ───────────────────────────────────────────────────────── */

gboolean gufa_x11_open(GufaX11 *x11) {
    if (x11 == NULL) return FALSE;
    memset(x11, 0, sizeof(*x11));
    x11->self_pid = (long)getpid();
    gufa_x11_install_error_handler();
    x11->dpy = XOpenDisplay(NULL);
    if (x11->dpy == NULL) {
        gufa_log("x11: XOpenDisplay 失败（DISPLAY=%s），follow/隐藏主窗口不可用",
                 g_getenv("DISPLAY") != NULL ? g_getenv("DISPLAY") : "(unset)");
        return FALSE;
    }
    x11->root = DefaultRootWindow(x11->dpy);
    if (x11->root == 0) {
        XCloseDisplay(x11->dpy);
        x11->dpy = NULL;
        return FALSE;
    }
#define GUFA_ATOM(field, name) (x11->field = XInternAtom(x11->dpy, (name), False))
    GUFA_ATOM(atom_net_wm_pid, "_NET_WM_PID");
    GUFA_ATOM(atom_net_wm_name, "_NET_WM_NAME");
    GUFA_ATOM(atom_wm_name, "WM_NAME");
    GUFA_ATOM(atom_wm_state, "WM_STATE");
    GUFA_ATOM(atom_ob_app_title, "_OB_APP_TITLE");
    GUFA_ATOM(atom_utf8_string, "UTF8_STRING");
    GUFA_ATOM(atom_net_active_window, "_NET_ACTIVE_WINDOW");
    GUFA_ATOM(atom_net_client_list, "_NET_CLIENT_LIST");
    GUFA_ATOM(atom_net_client_list_stacking, "_NET_CLIENT_LIST_STACKING");
    GUFA_ATOM(atom_net_wm_window_type, "_NET_WM_WINDOW_TYPE");
    GUFA_ATOM(atom_net_wm_window_type_normal, "_NET_WM_WINDOW_TYPE_NORMAL");
    GUFA_ATOM(atom_net_wm_window_type_dialog, "_NET_WM_WINDOW_TYPE_DIALOG");
    GUFA_ATOM(atom_net_wm_window_type_desktop, "_NET_WM_WINDOW_TYPE_DESKTOP");
    GUFA_ATOM(atom_net_wm_window_type_dock, "_NET_WM_WINDOW_TYPE_DOCK");
    GUFA_ATOM(atom_net_wm_window_type_toolbar, "_NET_WM_WINDOW_TYPE_TOOLBAR");
    GUFA_ATOM(atom_net_wm_window_type_menu, "_NET_WM_WINDOW_TYPE_MENU");
    GUFA_ATOM(atom_net_wm_window_type_utility, "_NET_WM_WINDOW_TYPE_UTILITY");
    GUFA_ATOM(atom_net_wm_window_type_splash, "_NET_WM_WINDOW_TYPE_SPLASH");
    GUFA_ATOM(atom_net_wm_window_type_dropdown, "_NET_WM_WINDOW_TYPE_DROPDOWN_MENU");
    GUFA_ATOM(atom_net_wm_window_type_tooltip, "_NET_WM_WINDOW_TYPE_TOOLTIP");
    GUFA_ATOM(atom_net_wm_desktop, "_NET_WM_DESKTOP");
#undef GUFA_ATOM
    x11->ok = TRUE;
    gufa_log("x11: 已连接 X server %s（root=0x%lx self_pid=%ld）",
             DisplayString(x11->dpy), (unsigned long)x11->root, x11->self_pid);
    return TRUE;
}

void gufa_x11_close(GufaX11 *x11) {
    if (x11 == NULL) return;
    if (x11->dpy != NULL) {
        XSync(x11->dpy, False);
        XCloseDisplay(x11->dpy);
        x11->dpy = NULL;
    }
    x11->ok = FALSE;
}

Window gufa_x11_find_window(GufaX11 *x11, long pid, const char *title_hint, Window skip) {
    if (x11 == NULL || !x11->ok) return 0;
    GArray *windows = gufa_x11_enumerate(x11, skip, TRUE);
    /* 优先「当前可见」的候选（title 命中 > 面积最大）；都没有时退回其它工作区/最小化的候选，
       找到后上层会发 _NET_ACTIVE_WINDOW 让 WM 切到目标窗口所在工作区。 */
    Window visible_largest = 0;
    long visible_largest_area = 0;
    Window visible_title = 0;
    long visible_title_area = 0;
    Window hidden_largest = 0;
    long hidden_largest_area = 0;
    Window hidden_title = 0;
    long hidden_title_area = 0;
    gboolean want_title = title_hint != NULL && *title_hint != '\0';
    GHashTable *seen = g_hash_table_new(g_direct_hash, g_direct_equal);
    for (guint i = 0; i < windows->len; i++) {
        GufaX11WindowInfo *info = &g_array_index(windows, GufaX11WindowInfo, i);
        if (info->win == skip || info->pid == x11->self_pid) continue;
        if (pid > 0 && info->pid != pid) continue;
        if (!gufa_x11_window_type_followable(x11, info->win)) continue;
        if (g_hash_table_contains(seen, (gpointer)(guintptr)info->win)) continue;
        g_hash_table_add(seen, (gpointer)(guintptr)info->win);
        long area = (long)info->width * (long)info->height;
        if (area <= 0) continue;
        if (want_title) {
            char *title = gufa_x11_window_title(x11, info->win);
            gboolean matches = gufa_text_contains_ci(title, title_hint);
            g_free(title);
            if (matches) {
                if (info->viewable) {
                    if (area > visible_title_area) {
                        visible_title = info->win;
                        visible_title_area = area;
                    }
                } else if (area > hidden_title_area) {
                    hidden_title = info->win;
                    hidden_title_area = area;
                }
                continue;
            }
        }
        if (info->viewable) {
            if (area > visible_largest_area) {
                visible_largest = info->win;
                visible_largest_area = area;
            }
        } else if (area > hidden_largest_area) {
            hidden_largest = info->win;
            hidden_largest_area = area;
        }
    }
    g_hash_table_destroy(seen);
    g_array_free(windows, TRUE);
    if (visible_title != 0) return visible_title;
    if (visible_largest != 0) return visible_largest;
    if (hidden_title != 0) return hidden_title;
    return hidden_largest;
}

gboolean gufa_x11_window_rect(GufaX11 *x11, Window window, GufaX11Rect *out) {
    if (out != NULL) memset(out, 0, sizeof(*out));
    if (x11 == NULL || !x11->ok || window == 0 || out == NULL) return FALSE;
    XWindowAttributes attributes;
    memset(&attributes, 0, sizeof(attributes));
    if (XGetWindowAttributes(x11->dpy, window, &attributes) == 0) return FALSE;
    int root_x = 0;
    int root_y = 0;
    Window child_return = 0;
    if (XTranslateCoordinates(x11->dpy, window, x11->root, 0, 0, &root_x, &root_y, &child_return) == 0) {
        return FALSE;
    }
    out->x = root_x;
    out->y = root_y;
    out->width = attributes.width;
    out->height = attributes.height;
    out->viewable = attributes.map_state == IsViewable;
    out->valid = attributes.width > 0 && attributes.height > 0;
    return TRUE;
}

gboolean gufa_x11_window_exists(GufaX11 *x11, Window window) {
    if (x11 == NULL || !x11->ok || window == 0) return FALSE;
    XWindowAttributes attributes;
    memset(&attributes, 0, sizeof(attributes));
    return XGetWindowAttributes(x11->dpy, window, &attributes) != 0;
}

void gufa_x11_activate_window(GufaX11 *x11, Window window, guint32 timestamp) {
    if (x11 == NULL || !x11->ok || window == 0) return;
    XEvent event;
    memset(&event, 0, sizeof(event));
    event.xclient.type = ClientMessage;
    event.xclient.serial = 0;
    event.xclient.send_event = True;
    event.xclient.display = x11->dpy;
    event.xclient.window = window;
    event.xclient.message_type = x11->atom_net_active_window;
    event.xclient.format = 32;
    event.xclient.data.l[0] = 2; /* source indication: pager，避免部分 WM 的焦点抢占限制 */
    event.xclient.data.l[1] = (long)timestamp;
    event.xclient.data.l[2] = 0;
    event.xclient.data.l[3] = 0;
    event.xclient.data.l[4] = 0;
    XSendEvent(x11->dpy, x11->root, False, SubstructureRedirectMask | SubstructureNotifyMask, &event);
    XRaiseWindow(x11->dpy, window);
    XFlush(x11->dpy);
}

void gufa_x11_map_window(GufaX11 *x11, Window window, gboolean do_raise) {
    if (x11 == NULL || !x11->ok || window == 0) return;
    XMapWindow(x11->dpy, window);
    if (do_raise) XRaiseWindow(x11->dpy, window);
    XFlush(x11->dpy);
}

void gufa_x11_copy_desktop(GufaX11 *x11, Window target, Window own) {
    if (x11 == NULL || !x11->ok || target == 0 || own == 0) return;
    unsigned char *data = NULL;
    Atom type = None;
    int format = 0;
    unsigned long nitems = 0;
    if (!gufa_x11_get_property(x11, target, x11->atom_net_wm_desktop, XA_CARDINAL, &data, &type, &format, &nitems)) {
        return;
    }
    unsigned long desktop = 0xFFFFFFFFUL;
    if (format == 32 && nitems >= 1 && data != NULL) {
        desktop = ((unsigned long *)(void *)data)[0];
    }
    XFree(data);
    if (desktop == 0xFFFFFFFFUL) return; /* 目标在所有工作区（sticky），不用动 */
    /* 1) 初始属性（未被 WM 映射时有效） */
    XChangeProperty(x11->dpy, own, x11->atom_net_wm_desktop, XA_CARDINAL, 32, PropModeReplace,
                    (const unsigned char *)&desktop, 1);
    /* 2) EWMH ClientMessage：窗口已映射后要移动工作区必须发消息给 WM */
    XEvent event;
    memset(&event, 0, sizeof(event));
    event.xclient.type = ClientMessage;
    event.xclient.send_event = True;
    event.xclient.display = x11->dpy;
    event.xclient.window = own;
    event.xclient.message_type = x11->atom_net_wm_desktop;
    event.xclient.format = 32;
    event.xclient.data.l[0] = (long)desktop;
    event.xclient.data.l[1] = 1; /* source indication: application */
    XSendEvent(x11->dpy, x11->root, False, SubstructureRedirectMask | SubstructureNotifyMask, &event);
    XFlush(x11->dpy);
    gufa_log("x11: 同步工作区 desktop=%lu target=0x%lx own=0x%lx", desktop,
             (unsigned long)target, (unsigned long)own);
}

/** 无匹配时把窗口树（含 frame/decor）打进日志，便于 CI/真机一次定位。 */
static void gufa_x11_debug_dump_tree(GufaX11 *x11, Window window, int depth, int *budget) {
    if (window == 0 || depth > 3 || *budget <= 0) return;
    XWindowAttributes attributes;
    memset(&attributes, 0, sizeof(attributes));
    if (XGetWindowAttributes(x11->dpy, window, &attributes) == 0) return;
    if (!attributes.override_redirect) {
        (*budget)--;
        char *title = gufa_x11_window_title(x11, window);
        char *wm_class = gufa_x11_window_class(x11, window);
        char *title_text = gufa_x11_log_text(title);
        char *class_text = gufa_x11_log_text(wm_class);
        gufa_log("x11: tree depth=%d win=0x%lx class=%d map=%d size=%dx%d pid=%ld wm_state=%d "
                 "title=\"%s\" wm_class=\"%s\"",
                 depth, (unsigned long)window, attributes.class, attributes.map_state,
                 attributes.width, attributes.height, gufa_x11_window_pid(x11, window),
                 gufa_x11_window_has_wm_state(x11, window) ? 1 : 0, title_text, class_text);
        g_free(title_text);
        g_free(class_text);
        g_free(title);
        g_free(wm_class);
    }
    if (depth < 3) {
        Window root_return = 0;
        Window parent_return = 0;
        Window *children = NULL;
        unsigned int child_count = 0;
        if (XQueryTree(x11->dpy, window, &root_return, &parent_return, &children, &child_count) == 0) {
            return;
        }
        for (unsigned int i = 0; i < child_count && *budget > 0; i++) {
            gufa_x11_debug_dump_tree(x11, children[i], depth + 1, budget);
        }
        if (children != NULL) XFree(children);
    }
}

void gufa_x11_hide_windows_like_dsh(GufaX11 *x11, long owner_pid, const char *title_hint,
                                    GufaX11WindowList *hidden) {
    gufa_x11_window_list_clear(hidden);
    if (x11 == NULL || !x11->ok || hidden == NULL) return;
    GArray *windows = gufa_x11_enumerate(x11, 0, FALSE);
    gufa_log("x11: 隐藏 DSH 前枚举到 %u 个候选窗口（ownerPid=%ld，窗口树 + _NET_CLIENT_LIST）",
             windows->len, owner_pid);

    /* 逐候选诊断日志：定位“为什么没匹配” */
    int logged = 0;
    for (guint i = 0; i < windows->len; i++) {
        GufaX11WindowInfo *info = &g_array_index(windows, GufaX11WindowInfo, i);
        if (logged >= 64) {
            gufa_log("x11: 候选过多，其余 %u 个不再逐条打印", windows->len - (guint)logged);
            break;
        }
        logged++;
        char *title = gufa_x11_window_title(x11, info->win);
        char *wm_class = gufa_x11_window_class(x11, info->win);
        char *comm = info->pid > 0 ? gufa_x11_process_comm(info->pid) : NULL;
        char *title_text = gufa_x11_log_text(title);
        char *class_text = gufa_x11_log_text(wm_class);
        char *comm_text = gufa_x11_log_text(comm);
        gufa_log("x11: 候选 win=0x%lx pid=%ld title=\"%s\" wm_class=\"%s\" comm=\"%s\" "
                 "size=%dx%d viewable=%d type_ok=%d wm_state=%d",
                 (unsigned long)info->win, info->pid, title_text, class_text, comm_text,
                 info->width, info->height, info->viewable ? 1 : 0,
                 gufa_x11_window_type_hideable(x11, info->win) ? 1 : 0,
                 gufa_x11_window_has_wm_state(x11, info->win) ? 1 : 0);
        g_free(title);
        g_free(wm_class);
        g_free(comm);
        g_free(title_text);
        g_free(class_text);
        g_free(comm_text);
    }

    GArray *matched = g_array_new(FALSE, FALSE, sizeof(Window));

    /* 第一轮：ownerPid 精确匹配（优先级最高，行为保持不变） */
    if (owner_pid > 0) {
        for (guint i = 0; i < windows->len; i++) {
            GufaX11WindowInfo *info = &g_array_index(windows, GufaX11WindowInfo, i);
            if (info->pid != owner_pid) continue;
            if (info->pid == x11->self_pid) continue;
            if (info->width < 50 || info->height < 50) continue;
            if (!gufa_x11_window_type_hideable(x11, info->win)) continue;
            gufa_log("x11: ownerPid 精确命中 win=0x%lx pid=%ld size=%dx%d",
                     (unsigned long)info->win, info->pid, info->width, info->height);
            Window window = info->win;
            g_array_append_val(matched, window);
        }
        gufa_log("x11: ownerPid 精确匹配到 %u 个窗口", matched->len);
    }

    /* 第二轮：标题 / WM_CLASS / 进程名启发式（ownerPid 对不上时兜底；Electron DSH 与 CI xterm 都覆盖） */
    if (matched->len == 0) {
        const char *needles[] = {"deepseek harness", "deepseek-harness", "deepseek"};
        for (guint i = 0; i < windows->len; i++) {
            GufaX11WindowInfo *info = &g_array_index(windows, GufaX11WindowInfo, i);
            if (info->pid == x11->self_pid) continue;
            if (info->width < 16 || info->height < 16) continue;
            if (!gufa_x11_window_type_hideable(x11, info->win)) continue;
            char *title = gufa_x11_window_title(x11, info->win);
            char *wm_class = gufa_x11_window_class(x11, info->win);
            char *comm = info->pid > 0 ? gufa_x11_process_comm(info->pid) : NULL;
            gboolean matched_title = FALSE;
            const char *why = NULL;
            if (title_hint != NULL && *title_hint != '\0' && gufa_text_contains_ci(title, title_hint)) {
                matched_title = TRUE;
                why = "title_hint";
            }
            for (gsize n = 0; n < G_N_ELEMENTS(needles) && !matched_title; n++) {
                if (gufa_text_contains_ci(title, needles[n])) {
                    matched_title = TRUE;
                    why = "title";
                } else if (gufa_text_contains_ci(wm_class, needles[n])) {
                    matched_title = TRUE;
                    why = "wm_class";
                } else if (gufa_text_contains_ci(comm, needles[n])) {
                    matched_title = TRUE;
                    why = "process";
                }
            }
            if (matched_title) {
                if (matched->len >= 16) {
                    gufa_log("x11: 启发式命中窗口超过 16 个，已截断");
                    g_free(title);
                    g_free(wm_class);
                    g_free(comm);
                    break;
                }
                char *title_text = gufa_x11_log_text(title);
                gufa_log("x11: 标题启发式命中 win=0x%lx pid=%ld by=%s title=\"%s\" size=%dx%d",
                         (unsigned long)info->win, info->pid, why != NULL ? why : "?",
                         title_text, info->width, info->height);
                g_free(title_text);
                Window window = info->win;
                g_array_append_val(matched, window);
            }
            g_free(title);
            g_free(wm_class);
            g_free(comm);
        }
        gufa_log("x11: 标题启发式匹配到 %u 个窗口", matched->len);
    }

    if (matched->len == 0) {
        gufa_log("x11: 没找到 DSH 主窗口（ownerPid=%ld），跳过隐藏；dump 窗口树如下", owner_pid);
        int budget = 120;
        gufa_x11_debug_dump_tree(x11, x11->root, 0, &budget);
    } else {
        for (guint i = 0; i < matched->len; i++) {
            Window window = g_array_index(matched, Window, i);
            XUnmapWindow(x11->dpy, window);
            gufa_x11_window_list_add(hidden, window);
            gufa_log("x11: 隐藏 DSH 主窗口 0x%lx", (unsigned long)window);
        }
        gufa_log("x11: 已隐藏 DSH 主窗口 %u 个", hidden->n);
    }
    XSync(x11->dpy, False);
    g_array_free(windows, TRUE);
    g_array_free(matched, TRUE);
}

void gufa_x11_restore_windows(GufaX11 *x11, GufaX11WindowList *hidden, guint32 timestamp) {
    if (hidden == NULL || hidden->n == 0) return;
    if (x11 == NULL || !x11->ok) {
        gufa_x11_window_list_clear(hidden);
        return;
    }
    for (guint i = 0; i < hidden->n; i++) {
        Window window = hidden->wins[i];
        if (!gufa_x11_window_exists(x11, window)) continue;
        XMapWindow(x11->dpy, window);
        XRaiseWindow(x11->dpy, window);
    }
    /* 映射请求先入队，再发 _NET_ACTIVE_WINDOW；X 请求按客户端顺序处理 */
    gufa_x11_activate_window(x11, hidden->wins[0], timestamp);
    XSync(x11->dpy, False);
    gufa_log("x11: 已恢复 DSH 主窗口 %u 个", hidden->n);
    gufa_x11_window_list_clear(hidden);
}

/* ── --list-windows 模式 ────────────────────────────────────────────── */

static char *gufa_x11_process_comm(long pid) {
    char path[64];
    snprintf(path, sizeof(path), "/proc/%ld/comm", pid);
    char *contents = NULL;
    gsize length = 0;
    if (!g_file_get_contents(path, &contents, &length, NULL) || contents == NULL) return NULL;
    g_strchomp(contents);
    return contents;
}

/** 读 /proc/<pid>/cmdline（NUL 分隔转空格）。CI 的 xterm 标题会被 shell prompt 覆盖，
 *  但进程命令行里仍保留 `-T "DeepSeek Harness"`，可作为窗口身份匹配的兜底信号。 */
static char *gufa_x11_process_cmdline(long pid) {
    if (pid <= 0) return NULL;
    char path[64];
    snprintf(path, sizeof(path), "/proc/%ld/cmdline", pid);
    char *contents = NULL;
    gsize length = 0;
    if (!g_file_get_contents(path, &contents, &length, NULL) || contents == NULL) return NULL;
    for (gsize i = 0; i < length; i++) {
        if (contents[i] == '\0') contents[i] = ' ';
    }
    g_strchomp(contents);
    return contents;
}

/** 部分 WM（Openbox）会把“窗口映射时的原始标题”存到 client 的 _OB_APP_TITLE，
 * 应用后来改标题也能读回，作为标题匹配的补充来源。 */
static char *gufa_x11_window_original_title(GufaX11 *x11, Window window) {
    char *title = gufa_x11_get_property_text(x11, window, x11->atom_ob_app_title);
    if (title != NULL && *title != '\0') return title;
    g_free(title);
    return NULL;
}

static void gufa_x11_app_destroy(gpointer data) {
    GufaX11App *app = (GufaX11App *)data;
    if (app == NULL) return;
    g_free(app->title);
    g_free(app->owner);
    g_free(app->wm_class);
    g_free(app);
}

static gint gufa_x11_app_compare(gconstpointer a, gconstpointer b) {
    const GufaX11App *left = *(const GufaX11App *const *)a;
    const GufaX11App *right = *(const GufaX11App *const *)b;
    if (left->frontmost != right->frontmost) return left->frontmost ? -1 : 1;
    return g_utf8_collate(left->title != NULL ? left->title : "", right->title != NULL ? right->title : "");
}

GPtrArray *gufa_x11_list_apps(GufaX11 *x11) {
    GPtrArray *apps = g_ptr_array_new_with_free_func(gufa_x11_app_destroy);
    if (x11 == NULL || !x11->ok) return apps;
    GArray *windows = gufa_x11_enumerate(x11, 0, TRUE);
    Window active = gufa_x11_active_window(x11);
    long active_pid = active != 0 ? gufa_x11_window_pid(x11, active) : 0;
    GHashTable *seen = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, NULL);
    for (guint i = 0; i < windows->len; i++) {
        GufaX11WindowInfo *info = &g_array_index(windows, GufaX11WindowInfo, i);
        if (info->pid == x11->self_pid) continue;
        if (info->width < 200 || info->height < 140) continue;
        char *title = gufa_x11_window_title(x11, info->win);
        if (title == NULL || *title == '\0') {
            g_free(title);
            continue;
        }
        char *key = g_strdup_printf("%ld:%s", info->pid, title);
        if (g_hash_table_contains(seen, key)) {
            g_free(key);
            g_free(title);
            continue;
        }
        g_hash_table_add(seen, key);
        GufaX11App *app = g_new0(GufaX11App, 1);
        app->win = info->win;
        app->pid = info->pid;
        app->title = title;
        app->owner = gufa_x11_process_comm(info->pid);
        app->wm_class = gufa_x11_window_class(x11, info->win);
        app->frontmost = active != 0 && (info->win == active || (active_pid != 0 && info->pid == active_pid));
        g_ptr_array_add(apps, app);
    }
    g_hash_table_destroy(seen);
    g_array_free(windows, TRUE);
    g_ptr_array_sort(apps, gufa_x11_app_compare);
    return apps;
}

void gufa_x11_apps_free(GPtrArray *apps) {
    if (apps != NULL) g_ptr_array_unref(apps);
}
