/**
 * 古法编程 · Linux 悬浮层 helper（X11 + GTK3 + WebKit2GTK）
 *
 * 由 DSH Host 通过 `spawn(gufa-float-linux, [payloadJson])` 启动；
 * 协议见 desktop/float/PLATFORM-PROTOCOL.md，行为参考 desktop/float/GufaFloat.m（macOS）。
 *
 * 能力：
 *   - 无边框 / 置顶 / 可缩放窗口 + WebKit2GTK 内嵌 DSH Web GUI；
 *   - RGBA visual 透明（有合成器时）；
 *   - cookie 或 authUrl 两条鉴权路径；
 *   - document-start 注入 localStorage（gufa-code:float / float-state / project / ui:v1）；
 *   - 顶部 22px 拖动条（gtk_window_begin_move_drag）、右下角缩放手柄；
 *   - follow：250ms 轮询 X11 目标窗口（_NET_WM_PID），移动/缩放自己的窗口；
 *   - 启动 0.45s 后隐藏 DSH 主窗口（XUnmapWindow），退出时 XMapWindow + _NET_ACTIVE_WINDOW 恢复；
 *   - controlPath 300ms 轮询退出（退出前恢复 DSH 主窗口）；
 *   - ciProbe 冒烟模式（stdout 打 JSON 后退出 0）；
 *   - Wayland 会话明确降级：仅自由悬浮，不跟随、不隐藏主窗口。
 */
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <glib-unix.h>
#include <glib.h>
#include <glib/gstdio.h>
#include <gtk/gtk.h>

#include <gdk/gdk.h>
#ifdef GDK_WINDOWING_X11
#include <gdk/gdkx.h>
#define GUFA_HAVE_GDK_X11 1
#else
#define GUFA_HAVE_GDK_X11 0
#endif

#include <jsc/jsc.h>
#include <libsoup/soup.h>
#include <webkit2/webkit2.h>

#include "json.h"
#include "log.h"
#include "x11.h"

#define GUFA_FLOAT_VERSION "1.0.0"
#define GUFA_DRAG_STRIP_HEIGHT 22
#define GUFA_DEFAULT_WIDTH 1180
#define GUFA_DEFAULT_HEIGHT 820
#define GUFA_MIN_WIDTH 320
#define GUFA_MIN_HEIGHT 240
#define GUFA_DSH_TITLE_HINT "DeepSeek Harness"
#define GUFA_MAX_HIDDEN_DSH_WINDOWS 16

typedef enum {
    GUFA_STAGE_NONE = 0,
    GUFA_STAGE_COOKIE,
    GUFA_STAGE_AUTH,
    GUFA_STAGE_APP
} GufaStage;

typedef struct _GufaApp GufaApp;

typedef struct {
    GufaApp *app;
    char *label;
} GufaJsRequest;

struct _GufaApp {
    /* ── payload ── */
    GufaJson *payload;
    char *app_url;
    char *auth_url;
    char *cookie;
    char *control_path;
    char *build;
    char *selftest;
    char *follow_title;
    char *bootstrap_js;
    long follow_pid;
    long owner_pid;
    int alpha;
    gboolean ci_probe;
    char *ci_probe_out;

    /* ── GTK / WebKit ── */
    GtkWidget *window;
    GtkWidget *webview;
    GtkWidget *overlay;
    GtkWidget *menu;
    WebKitUserContentManager *content_manager;
    gboolean composited;
    gboolean transparent;
    gboolean gdk_is_x11;

    /* ── X11 ── */
    GufaX11 x11;
    gboolean x11_ok;
    Window own_xid;
    Window follow_win;
    GufaX11WindowList hidden_dsh;
    gboolean follow_found_logged;
    gboolean follow_missing_logged;
    gboolean follow_minimized_logged;
    int follow_apply_logs;

    /* ── 状态 ── */
    gboolean wayland_session;
    pid_t host_pid;
    gboolean watch_host;
    GufaStage stage;
    gboolean loaded;
    gboolean loading_failed;
    gboolean probe_done;
    gboolean quitting;
    int exit_code;
    int applied_x;
    int applied_y;
    int applied_width;
    int applied_height;
    gboolean have_applied;

    /* ── 定时器 ── */
    guint control_timer;
    guint follow_timer;
    guint hide_timer;
    guint probe_guard;
    guint page_probe_timer;
    guint selftest_timer;
    guint selftest_snapshot_timer;
};

static guint32 gufa_server_time(GufaApp *app);
static void gufa_start_load(GufaApp *app);
static void gufa_load_app_url(GufaApp *app);
static void gufa_hide_dsh(GufaApp *app);
static void gufa_restore_dsh(GufaApp *app);
static void gufa_request_quit(GufaApp *app, const char *reason);
static void gufa_apply_follow_rect(GufaApp *app, const GufaX11Rect *target);
static void gufa_save_frame(GufaApp *app);

/* ── 通用小工具 ─────────────────────────────────────────────────────── */

static char *gufa_append_query(const char *url, const char *query) {
    if (url == NULL) return NULL;
    if (query == NULL || *query == '\0') return g_strdup(url);
    return g_strdup_printf("%s%s%s", url, strchr(url, '?') != NULL ? "&" : "?", query);
}

/** 从 URL 里取 host（给 cookie 用），失败返回 NULL。 */
static char *gufa_url_host(const char *url) {
    if (url == NULL) return NULL;
    const char *start = strstr(url, "://");
    start = start != NULL ? start + 3 : url;
    const char *end = strpbrk(start, ":/?#");
    size_t length = end != NULL ? (size_t)(end - start) : strlen(start);
    if (length == 0) return NULL;
    return g_strndup(start, length);
}

static guint32 gufa_server_time(GufaApp *app) {
#if GUFA_HAVE_GDK_X11
    if (app != NULL && app->gdk_is_x11 && app->window != NULL) {
        GdkWindow *gdk_window = gtk_widget_get_window(app->window);
        if (gdk_window != NULL) {
            return (guint32)gdk_x11_get_server_time(gdk_window);
        }
    }
#else
    (void)app;
#endif
    return 0;
}

static Window gufa_own_xid_from_widget(GufaApp *app) {
#if GUFA_HAVE_GDK_X11
    if (app != NULL && app->gdk_is_x11 && app->window != NULL) {
        GdkWindow *gdk_window = gtk_widget_get_window(app->window);
        if (gdk_window != NULL) return (Window)GDK_WINDOW_XID(gdk_window);
    }
#else
    (void)app;
#endif
    return 0;
}

static void gufa_remove_timer(guint *timer) {
    if (timer != NULL && *timer != 0) {
        g_source_remove(*timer);
        *timer = 0;
    }
}

/* ── payload / 注入脚本 ─────────────────────────────────────────────── */

static char *gufa_build_bootstrap_js(const GufaJson *payload) {
    GString *js = g_string_new("try{localStorage.setItem('gufa-code:float','1');");
    GufaJson *state = gufa_json_object_get(payload, "state");
    if (state != NULL && gufa_json_get_type(state) == GUFA_JSON_OBJECT) {
        char *state_json = gufa_json_serialize(state);
        if (state_json != NULL) {
            /* 把 state 作为 JS 对象字面量内联（JSON 是 JS 语法的子集），再 JSON.stringify 成字符串写进 localStorage */
            g_string_append(js, "var s=");
            g_string_append(js, state_json);
            g_string_append(js,
                            ";localStorage.setItem('gufa-code:float-state',JSON.stringify(s));"
                            "if(s&&typeof s.projectRoot==='string'&&s.projectRoot){localStorage.setItem('gufa-code:project',JSON.stringify(s.projectRoot));}"
                            "if(s&&s.ui&&typeof s.ui==='object'){localStorage.setItem('gufa-code:ui:v1',JSON.stringify(s.ui));}");
            g_free(state_json);
        }
    }
    g_string_append(js, "}catch(e){}");
    return g_string_free(js, FALSE);
}

static gboolean gufa_payload_fill(GufaApp *app, GufaJson *payload) {
    app->payload = payload;
    app->app_url = gufa_json_dup_string(gufa_json_object_get(payload, "appUrl"));
    app->auth_url = gufa_json_dup_string(gufa_json_object_get(payload, "authUrl"));
    app->cookie = gufa_json_dup_string(gufa_json_object_get(payload, "cookie"));
    app->control_path = gufa_json_dup_string(gufa_json_object_get(payload, "controlPath"));
    app->build = gufa_json_dup_string(gufa_json_object_get(payload, "build"));
    app->selftest = gufa_json_dup_string(gufa_json_object_get(payload, "selftest"));
    app->alpha = (int)gufa_json_get_int64(gufa_json_object_get(payload, "alpha"), 55);
    app->ci_probe = gufa_json_get_bool(gufa_json_object_get(payload, "ciProbe"), FALSE);
    app->ci_probe_out = gufa_json_dup_string(gufa_json_object_get(payload, "ciProbeOut"));
    app->owner_pid = gufa_json_get_int64(gufa_json_object_get(payload, "ownerPid"), 0);
    GufaJson *follow = gufa_json_object_get(payload, "follow");
    if (follow != NULL && gufa_json_get_type(follow) == GUFA_JSON_OBJECT) {
        app->follow_pid = gufa_json_get_int64(gufa_json_object_get(follow, "pid"), 0);
        app->follow_title = gufa_json_dup_string(gufa_json_object_get(follow, "title"));
    }
    app->bootstrap_js = gufa_build_bootstrap_js(payload);
    if (app->app_url == NULL || *app->app_url == '\0') {
        return FALSE;
    }
    if (app->auth_url == NULL || *app->auth_url == '\0') {
        app->auth_url = g_strdup(app->app_url);
    }
    return TRUE;
}

/* ── 环境 / 后端 ────────────────────────────────────────────────────── */

static gboolean gufa_configure_backend(GufaApp *app) {
    const char *wayland_display = g_getenv("WAYLAND_DISPLAY");
    const char *x11_display = g_getenv("DISPLAY");
    gboolean has_wayland = wayland_display != NULL && *wayland_display != '\0';
    gboolean has_x11 = x11_display != NULL && *x11_display != '\0';
    if (!has_wayland && !has_x11) {
        g_printerr("gufa-float-linux: 没有可用的图形显示（DISPLAY / WAYLAND_DISPLAY 均为空）。"
                   "Linux 版悬浮层需要 X11 桌面（或 XWayland）。\n");
        return FALSE;
    }
    if (has_wayland) {
        app->wayland_session = TRUE;
        gufa_log("wayland: 检测到 WAYLAND_DISPLAY=%s；Linux helper 仅支持 X11，"
                 "Wayland 原生窗口无法被读取位置/隐藏", wayland_display);
        if (has_x11) {
            const char *backend = g_getenv("GDK_BACKEND");
            if (backend == NULL || *backend == '\0') {
                g_setenv("GDK_BACKEND", "x11", TRUE);
                gufa_log("wayland: 已优先切到 X11/XWayland 后端（GDK_BACKEND=x11），"
                         "可跟随/隐藏 X11 应用窗口；Wayland 原生应用仍不可见");
            } else if (g_ascii_strcasecmp(backend, "wayland") == 0) {
                gufa_log("wayland: 用户显式指定 GDK_BACKEND=wayland：follow 与隐藏主窗口降级为自由悬浮");
            }
        }
    }
    return TRUE;
}

static void gufa_prepare_probe_env(GufaApp *app) {
    if (!app->ci_probe) return;
    /* CI (xvfb-run) 没有 GPU/合成器，给 WebKit 明确的软件渲染兜底；这些变量只在 ciProbe 模式自动设置，
       真机不受影响（真机若遇白屏可用同样变量手动启动）。 */
    if (g_getenv("WEBKIT_DISABLE_COMPOSITING_MODE") == NULL) g_setenv("WEBKIT_DISABLE_COMPOSITING_MODE", "1", TRUE);
    if (g_getenv("WEBKIT_DISABLE_DMABUF_RENDERER") == NULL) g_setenv("WEBKIT_DISABLE_DMABUF_RENDERER", "1", TRUE);
    if (g_getenv("LIBGL_ALWAYS_SOFTWARE") == NULL) g_setenv("LIBGL_ALWAYS_SOFTWARE", "1", TRUE);
    if (g_getenv("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS") == NULL) {
        g_setenv("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1", TRUE);
    }
}

/* ── CSS / 绘制 ─────────────────────────────────────────────────────── */

static void gufa_install_css(void) {
    const char *css =
        "window.gufa-float-window { background-color: rgba(0,0,0,0); }\n"
        ".gufa-strip { background-color: rgba(0,0,0,0.30); }\n"
        ".gufa-strip label { color: rgba(255,255,255,0.72); font-size: 10px; }\n";
    GtkCssProvider *provider = gtk_css_provider_new();
    GError *error = NULL;
    if (!gtk_css_provider_load_from_data(provider, css, -1, &error)) {
        gufa_log("css: 加载失败 %s", error != NULL ? error->message : "?");
        g_clear_error(&error);
    }
    GdkScreen *screen = gdk_screen_get_default();
    if (screen != NULL) {
        gtk_style_context_add_provider_for_screen(screen, GTK_STYLE_PROVIDER(provider),
                                                  GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
    }
    g_object_unref(provider);
}

static gboolean gufa_on_window_draw(GtkWidget *widget, cairo_t *cr, gpointer user_data) {
    GufaApp *app = (GufaApp *)user_data;
    if (app == NULL || !app->transparent) return FALSE;
    GtkAllocation allocation;
    gtk_widget_get_allocation(widget, &allocation);
    cairo_save(cr);
    cairo_set_operator(cr, CAIRO_OPERATOR_SOURCE);
    cairo_set_source_rgba(cr, 0, 0, 0, 0);
    cairo_paint(cr);
    cairo_restore(cr);
    return FALSE;
}

static gboolean gufa_on_grip_draw(GtkWidget *widget, cairo_t *cr, gpointer user_data) {
    (void)user_data;
    GtkAllocation allocation;
    gtk_widget_get_allocation(widget, &allocation);
    double width = allocation.width;
    double height = allocation.height;
    cairo_save(cr);
    cairo_set_source_rgba(cr, 1, 1, 1, 0.55);
    cairo_set_line_width(cr, 1.5);
    cairo_move_to(cr, width - 3, height - 7);
    cairo_line_to(cr, width - 7, height - 3);
    cairo_move_to(cr, width - 3, height - 12);
    cairo_line_to(cr, width - 12, height - 3);
    cairo_stroke(cr);
    cairo_restore(cr);
    return FALSE;
}

/* ── 窗口拖动 / 缩放 / 菜单 ─────────────────────────────────────────── */

static gboolean gufa_on_strip_button_press(GtkWidget *widget, GdkEventButton *event, gpointer user_data) {
    (void)widget;
    GufaApp *app = (GufaApp *)user_data;
    if (app == NULL || event == NULL) return FALSE;
    if (event->type != GDK_BUTTON_PRESS) return FALSE;
    if (event->button == 1) {
        gtk_window_begin_move_drag(GTK_WINDOW(app->window), (gint)event->button,
                                   (gint)event->x_root, (gint)event->y_root, (guint32)event->time);
        return TRUE;
    }
    if (event->button == 3) {
        if (app->menu != NULL) {
            gtk_menu_popup_at_pointer(GTK_MENU(app->menu), (GdkEvent *)event);
            return TRUE;
        }
    }
    return FALSE;
}

static gboolean gufa_on_grip_button_press(GtkWidget *widget, GdkEventButton *event, gpointer user_data) {
    (void)widget;
    GufaApp *app = (GufaApp *)user_data;
    if (app == NULL || event == NULL) return FALSE;
    if (event->type != GDK_BUTTON_PRESS || event->button != 1) return FALSE;
    gtk_window_begin_resize_drag(GTK_WINDOW(app->window), GDK_WINDOW_EDGE_SOUTH_EAST,
                                 (gint)event->button, (gint)event->x_root, (gint)event->y_root,
                                 (guint32)event->time);
    return TRUE;
}

static void gufa_on_strip_realize(GtkWidget *widget, gpointer user_data) {
    (void)user_data;
    GdkWindow *gdk_window = gtk_widget_get_window(widget);
    if (gdk_window == NULL) return;
    GdkCursor *cursor = gdk_cursor_new_from_name(gdk_display_get_default(), "grab");
    if (cursor != NULL) {
        gdk_window_set_cursor(gdk_window, cursor);
        g_object_unref(cursor);
    }
}

static void gufa_on_grip_realize(GtkWidget *widget, gpointer user_data) {
    (void)user_data;
    GdkWindow *gdk_window = gtk_widget_get_window(widget);
    if (gdk_window == NULL) return;
    GdkCursor *cursor = gdk_cursor_new_from_name(gdk_display_get_default(), "se-resize");
    if (cursor != NULL) {
        gdk_window_set_cursor(gdk_window, cursor);
        g_object_unref(cursor);
    }
}

static void gufa_center_window(GufaApp *app, int *out_x, int *out_y, int *out_width, int *out_height) {
    GdkRectangle geometry = {0, 0, GUFA_DEFAULT_WIDTH, GUFA_DEFAULT_HEIGHT};
    GdkScreen *screen = app->window != NULL ? gtk_widget_get_screen(app->window) : gdk_screen_get_default();
    if (screen != NULL) {
        gint monitor = gdk_screen_get_primary_monitor(screen);
        if (monitor < 0) monitor = 0;
        if (monitor < gdk_screen_get_n_monitors(screen)) {
            gdk_screen_get_monitor_geometry(screen, monitor, &geometry);
        }
    }
    int width = MIN(GUFA_DEFAULT_WIDTH, (int)(geometry.width * 0.86));
    int height = MIN(GUFA_DEFAULT_HEIGHT, (int)(geometry.height * 0.86));
    if (width < GUFA_MIN_WIDTH) width = MIN(geometry.width, GUFA_MIN_WIDTH);
    if (height < GUFA_MIN_HEIGHT) height = MIN(geometry.height, GUFA_MIN_HEIGHT);
    if (out_x != NULL) *out_x = geometry.x + (geometry.width - width) / 2;
    if (out_y != NULL) *out_y = geometry.y + (geometry.height - height) / 2;
    if (out_width != NULL) *out_width = width;
    if (out_height != NULL) *out_height = height;
}

static gboolean gufa_reset_frame_cb(gpointer user_data) {
    GufaApp *app = (GufaApp *)user_data;
    if (app == NULL || app->window == NULL) return G_SOURCE_REMOVE;
    int x = 0, y = 0, width = 0, height = 0;
    gufa_center_window(app, &x, &y, &width, &height);
    gtk_window_move(GTK_WINDOW(app->window), x, y);
    gtk_window_resize(GTK_WINDOW(app->window), width, height);
    gufa_log("window: 重置位置和大小 %d,%d %dx%d", x, y, width, height);
    return G_SOURCE_REMOVE;
}

static void gufa_on_menu_quit(GtkMenuItem *item, gpointer user_data) {
    (void)item;
    gufa_request_quit((GufaApp *)user_data, "menu");
}

static void gufa_on_menu_reset(GtkMenuItem *item, gpointer user_data) {
    (void)item;
    gufa_reset_frame_cb(user_data);
}

static void gufa_build_menu(GufaApp *app) {
    GtkWidget *menu = gtk_menu_new();
    GtkWidget *exit_item = gtk_menu_item_new_with_label("退出摸鱼（恢复主窗口）");
    g_signal_connect(exit_item, "activate", G_CALLBACK(gufa_on_menu_quit), app);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), exit_item);
    GtkWidget *reset_item = gtk_menu_item_new_with_label("重置窗口位置和大小");
    g_signal_connect(reset_item, "activate", G_CALLBACK(gufa_on_menu_reset), app);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), reset_item);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), gtk_separator_menu_item_new());
    char *mode_text = app->follow_pid > 0 ? g_strdup_printf("吸附模式：跟随 pid=%ld", app->follow_pid)
                                          : g_strdup("自由悬浮模式");
    GtkWidget *mode_item = gtk_menu_item_new_with_label(mode_text);
    gtk_widget_set_sensitive(mode_item, FALSE);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), mode_item);
    g_free(mode_text);
    gtk_widget_show_all(menu);
    app->menu = menu;
}

/* ── 窗口位置保存/恢复 ──────────────────────────────────────────────── */

static char *gufa_frame_file_path(void) {
    char *directory = g_build_filename(g_get_user_config_dir(), "gufa-float", NULL);
    char *path = g_build_filename(directory, "linux-frame.txt", NULL);
    g_free(directory);
    return path;
}

static gboolean gufa_load_saved_frame(int *x, int *y, int *width, int *height) {
    char *path = gufa_frame_file_path();
    char *contents = NULL;
    gboolean ok = FALSE;
    if (g_file_get_contents(path, &contents, NULL, NULL) && contents != NULL) {
        int fx = 0, fy = 0, fw = 0, fh = 0;
        if (sscanf(contents, "%d %d %d %d", &fx, &fy, &fw, &fh) == 4 && fw >= 400 && fh >= 300 &&
            fx > -20000 && fy > -20000 && fx < 20000 && fy < 20000) {
            *x = fx;
            *y = fy;
            *width = fw;
            *height = fh;
            ok = TRUE;
        }
    }
    g_free(contents);
    g_free(path);
    return ok;
}

static void gufa_save_frame(GufaApp *app) {
    if (app == NULL || app->window == NULL || app->ci_probe) return;
    int x = 0, y = 0, width = 0, height = 0;
    gtk_window_get_position(GTK_WINDOW(app->window), &x, &y);
    gtk_window_get_size(GTK_WINDOW(app->window), &width, &height);
    if (width < 200 || height < 200) return;
    char *directory = g_build_filename(g_get_user_config_dir(), "gufa-float", NULL);
    g_mkdir_with_parents(directory, 0700);
    char *path = gufa_frame_file_path();
    char *text = g_strdup_printf("%d %d %d %d\n", x, y, width, height);
    GError *error = NULL;
    if (!g_file_set_contents(path, text, -1, &error)) {
        gufa_log("window: 保存位置失败 %s", error != NULL ? error->message : "?");
        g_clear_error(&error);
    }
    g_free(text);
    g_free(path);
    g_free(directory);
}

/* ── 鉴权 / 加载 ────────────────────────────────────────────────────── */

static void gufa_emit_probe_result(GufaApp *app, gboolean ok, gboolean url_loaded, const char *reason);
static void gufa_probe_fail_early(GufaApp *app, const char *reason);

static void gufa_on_cookie_added(GObject *source_object, GAsyncResult *result, gpointer user_data) {
    GufaApp *app = (GufaApp *)user_data;
    GError *error = NULL;
    gboolean ok = webkit_cookie_manager_add_cookie_finish(WEBKIT_COOKIE_MANAGER(source_object), result, &error);
    if (!ok) {
        gufa_log("auth: 注入 cookie 失败（%s），回退到 authUrl 登录", error != NULL ? error->message : "?");
        g_clear_error(&error);
        app->stage = GUFA_STAGE_AUTH;
        webkit_web_view_load_uri(WEBKIT_WEB_VIEW(app->webview), app->auth_url);
        return;
    }
    gufa_log("auth: cookie 注入成功");
    gufa_load_app_url(app);
}

static gboolean gufa_add_cookie_async(GufaApp *app) {
    const char *cookie = app->cookie;
    if (cookie == NULL || *cookie == '\0') return FALSE;
    const char *equals = strchr(cookie, '=');
    if (equals == NULL || equals == cookie) {
        gufa_log("auth: cookie 格式不合法（缺少 '='），回退到 authUrl");
        return FALSE;
    }
    char *name = g_strndup(cookie, (gsize)(equals - cookie));
    const char *value = equals + 1;
    char *host = gufa_url_host(app->app_url);
    if (host == NULL) host = g_strdup("127.0.0.1");
    SoupCookie *soup_cookie = soup_cookie_new(name, value, host, "/", 86400);
    gufa_log("auth: 注入 cookie name=%s domain=%s", name, host);
    g_free(name);
    g_free(host);
    if (soup_cookie == NULL) return FALSE;
    WebKitWebContext *context = webkit_web_context_get_default();
    WebKitWebsiteDataManager *data_manager = webkit_web_context_get_website_data_manager(context);
    WebKitCookieManager *cookie_manager = webkit_website_data_manager_get_cookie_manager(data_manager);
    webkit_cookie_manager_add_cookie(cookie_manager, soup_cookie, NULL, gufa_on_cookie_added, app);
    soup_cookie_free(soup_cookie);
    return TRUE;
}

static void gufa_load_app_url(GufaApp *app) {
    char *url = gufa_append_query(app->app_url, "gufa-float=1");
    app->stage = GUFA_STAGE_APP;
    gufa_log("load: appUrl %s", url);
    webkit_web_view_load_uri(WEBKIT_WEB_VIEW(app->webview), url);
    g_free(url);
}

static void gufa_start_load(GufaApp *app) {
    if (app->cookie != NULL && *app->cookie != '\0') {
        app->stage = GUFA_STAGE_COOKIE;
        gufa_log("auth: 使用 Host 传入的 cookie 鉴权");
        if (gufa_add_cookie_async(app)) return;
        gufa_log("auth: cookie 注入不可用，回退到 authUrl 登录");
    }
    app->stage = GUFA_STAGE_AUTH;
    gufa_log("load: authUrl %s", app->auth_url != NULL ? app->auth_url : "(none)");
    webkit_web_view_load_uri(WEBKIT_WEB_VIEW(app->webview), app->auth_url);
}

/* ── 控制文件 / 信号 / 退出 ─────────────────────────────────────────── */

static void gufa_restore_dsh(GufaApp *app) {
    if (app == NULL) return;
    if (!app->x11_ok) {
        g_free(app->hidden_dsh.wins);
        app->hidden_dsh.wins = NULL;
        app->hidden_dsh.n = 0;
        return;
    }
    if (app->hidden_dsh.n == 0) return;
    gufa_x11_restore_windows(&app->x11, &app->hidden_dsh, gufa_server_time(app));
}

static void gufa_hide_dsh(GufaApp *app) {
    if (app == NULL || !app->x11_ok) {
        gufa_log("dsh-hide: X11 不可用（Wayland 会话或没有 X 连接），跳过隐藏 DSH 主窗口");
        return;
    }
    gufa_x11_hide_windows_like_dsh(&app->x11, app->owner_pid, GUFA_DSH_TITLE_HINT, &app->hidden_dsh);
}

static void gufa_request_quit(GufaApp *app, const char *reason) {
    if (app == NULL || app->quitting) return;
    app->quitting = TRUE;
    gufa_log("quit: reason=%s", reason != NULL ? reason : "?");
    gufa_restore_dsh(app);
    if (app->control_path != NULL && *app->control_path != '\0') {
        g_unlink(app->control_path);
    }
    gufa_save_frame(app);
    gtk_main_quit();
}

static gboolean gufa_on_control_tick(gpointer user_data) {
    GufaApp *app = (GufaApp *)user_data;
    if (app == NULL) return G_SOURCE_REMOVE;
    if (app->quitting) {
        app->control_timer = 0;
        return G_SOURCE_REMOVE;
    }
    if (app->control_path != NULL && *app->control_path != '\0' &&
        g_file_test(app->control_path, G_FILE_TEST_EXISTS)) {
        gufa_log("control: 检测到退出控制文件 %s", app->control_path);
        gufa_request_quit(app, "control-file");
        app->control_timer = 0;
        return G_SOURCE_REMOVE;
    }
    /* Host 挂了（helper 是 detached spawn，会被 init/reaper 收养）：自行恢复 DSH 并退出，避免残留 */
    if (app->watch_host && app->host_pid > 1 && getppid() != app->host_pid) {
        gufa_log("control: Host 进程已退出（ppid %ld -> %ld），helper 自行退出并恢复主窗口",
                 (long)app->host_pid, (long)getppid());
        gufa_request_quit(app, "host-exit");
        app->control_timer = 0;
        return G_SOURCE_REMOVE;
    }
    return G_SOURCE_CONTINUE;
}

static gboolean gufa_on_unix_signal(gpointer user_data) {
    GufaApp *app = (GufaApp *)user_data;
    gufa_request_quit(app, "signal");
    return G_SOURCE_REMOVE;
}

static gboolean gufa_on_delete_event(GtkWidget *widget, GdkEvent *event, gpointer user_data) {
    (void)widget;
    (void)event;
    gufa_request_quit((GufaApp *)user_data, "delete-event");
    return TRUE;
}

/* ── 跟随吸附 ───────────────────────────────────────────────────────── */

static void gufa_apply_follow_rect(GufaApp *app, const GufaX11Rect *target) {
    if (app == NULL || app->window == NULL || target == NULL) return;
    int scale = app->window != NULL ? gtk_widget_get_scale_factor(app->window) : 1;
    if (scale < 1) scale = 1;
    int x = target->x / scale;
    int y = target->y / scale;
    int width = target->width / scale;
    int height = target->height / scale;
    if (width < GUFA_MIN_WIDTH) width = GUFA_MIN_WIDTH;
    if (height < GUFA_MIN_HEIGHT) height = GUFA_MIN_HEIGHT;
    if (app->have_applied && x == app->applied_x && y == app->applied_y && width == app->applied_width &&
        height == app->applied_height) {
        return;
    }
    app->applied_x = x;
    app->applied_y = y;
    app->applied_width = width;
    app->applied_height = height;
    app->have_applied = TRUE;
    gtk_window_move(GTK_WINDOW(app->window), x, y);
    gtk_window_resize(GTK_WINDOW(app->window), width, height);
    if (app->follow_apply_logs < 6) {
        app->follow_apply_logs++;
        gufa_log("follow: 应用目标矩形 physical=%d,%d %dx%d -> window=%d,%d %dx%d scale=%d",
                 target->x, target->y, target->width, target->height, x, y, width, height, scale);
    }
}

static gboolean gufa_on_follow_tick(gpointer user_data) {
    GufaApp *app = (GufaApp *)user_data;
    if (app == NULL || app->quitting) {
        if (app != NULL) app->follow_timer = 0;
        return G_SOURCE_REMOVE;
    }
    if (!app->x11_ok || app->follow_pid <= 0) {
        app->follow_timer = 0;
        return G_SOURCE_REMOVE;
    }
    if (app->follow_win == 0 || !gufa_x11_window_exists(&app->x11, app->follow_win)) {
        Window found = gufa_x11_find_window(&app->x11, app->follow_pid,
                                            app->follow_title != NULL ? app->follow_title : "",
                                            app->own_xid);
        if (found == 0) {
            if (!app->follow_missing_logged) {
                app->follow_missing_logged = TRUE;
                gufa_log("follow: 暂未找到 pid=%ld 的目标窗口（继续每 250ms 重试）", app->follow_pid);
            }
            return G_SOURCE_CONTINUE;
        }
        app->follow_win = found;
        app->follow_missing_logged = FALSE;
        if (!app->follow_found_logged) {
            app->follow_found_logged = TRUE;
            gufa_log("follow: 找到目标窗口 0x%lx（pid=%ld），前置该 App", (unsigned long)found, app->follow_pid);
            gufa_x11_activate_window(&app->x11, found, gufa_server_time(app));
            if (app->own_xid != 0) gufa_x11_copy_desktop(&app->x11, found, app->own_xid);
        }
    }
    GufaX11Rect rect;
    memset(&rect, 0, sizeof(rect));
    if (!gufa_x11_window_rect(&app->x11, app->follow_win, &rect) || !rect.valid) {
        gufa_log("follow: 目标窗口矩形读取失败，保留当前位置（下一轮重新查找）");
        app->follow_win = 0;
        return G_SOURCE_CONTINUE;
    }
    if (!rect.viewable) {
        if (!app->follow_minimized_logged) {
            app->follow_minimized_logged = TRUE;
            gufa_log("follow: 目标窗口不可见（最小化/切走），保持最后位置");
        }
        return G_SOURCE_CONTINUE;
    }
    app->follow_minimized_logged = FALSE;
    gufa_apply_follow_rect(app, &rect);
    return G_SOURCE_CONTINUE;
}

/* ── ciProbe / selftest / 页面诊断 ──────────────────────────────────── */

static void gufa_on_js_finished(GObject *source_object, GAsyncResult *result, gpointer user_data) {
    GufaJsRequest *request = (GufaJsRequest *)user_data;
    GError *error = NULL;
    WebKitJavascriptResult *js_result =
        webkit_web_view_run_javascript_finish(WEBKIT_WEB_VIEW(source_object), result, &error);
    if (js_result == NULL) {
        gufa_log("%s: js-error %s", request->label, error != NULL ? error->message : "?");
        g_clear_error(&error);
    } else {
        JSCValue *value = webkit_javascript_result_get_js_value(js_result);
        char *text = value != NULL ? jsc_value_to_string(value) : NULL;
        gufa_log("%s: %s", request->label, text != NULL ? text : "(no result)");
        g_free(text);
        webkit_javascript_result_unref(js_result);
    }
    g_free(request->label);
    g_free(request);
}

static void gufa_run_js(GufaApp *app, const char *label, const char *script) {
    if (app == NULL || app->webview == NULL || script == NULL) return;
    GufaJsRequest *request = g_new0(GufaJsRequest, 1);
    request->app = app;
    request->label = g_strdup(label != NULL ? label : "js");
    webkit_web_view_run_javascript(WEBKIT_WEB_VIEW(app->webview), script, NULL, gufa_on_js_finished, request);
}

/** 把文本写到 path（覆盖写，UTF-8；父目录不存在时自动创建）。 */
static gboolean gufa_write_text_file(const char *path, const char *text) {
    if (path == NULL || *path == '\0' || text == NULL) return FALSE;
    GError *error = NULL;
    if (g_file_set_contents(path, text, -1, &error)) return TRUE;
    g_clear_error(&error);
    char *directory = g_path_get_dirname(path);
    gboolean ok = FALSE;
    if (directory != NULL && *directory != '\0' && strcmp(directory, ".") != 0) {
        g_mkdir_with_parents(directory, 0755);
        ok = g_file_set_contents(path, text, -1, &error);
        if (!ok) g_clear_error(&error);
    }
    g_free(directory);
    return ok;
}

/** 生成 ciProbe 结果行（不含换行）。 */
static char *gufa_probe_line(gboolean ok, gboolean url_loaded, const char *reason) {
    if (ok) {
        return g_strdup("{\"ok\":true,\"platform\":\"linux\",\"urlLoaded\":true}");
    }
    if (reason != NULL && *reason != '\0') {
        return g_strdup_printf(
            "{\"ok\":false,\"platform\":\"linux\",\"urlLoaded\":%s,\"reason\":\"%s\"}",
            url_loaded ? "true" : "false", reason);
    }
    return g_strdup_printf("{\"ok\":false,\"platform\":\"linux\",\"urlLoaded\":%s}",
                           url_loaded ? "true" : "false");
}

/** 输出 ciProbe 结果：stdout 一行 + 覆盖写入 ciProbeOut（可选）。 */
static void gufa_probe_emit(GufaApp *app, gboolean ok, gboolean url_loaded, const char *reason) {
    char *line = gufa_probe_line(ok, url_loaded, reason);
    g_print("%s\n", line);
    fflush(stdout);
    if (app != NULL && app->ci_probe_out != NULL && *app->ci_probe_out != '\0') {
        char *with_newline = g_strdup_printf("%s\n", line);
        if (gufa_write_text_file(app->ci_probe_out, with_newline)) {
            gufa_log("ciProbe: 结果已写入 %s", app->ci_probe_out);
        } else {
            gufa_log("ciProbe: 写入 %s 失败", app->ci_probe_out);
        }
        g_free(with_newline);
    }
    g_free(line);
}

/** ciProbe 完成（加载成功/失败/超时都算完成；按协议退出码 0，成败看 JSON 的 ok）。 */
static void gufa_emit_probe_result(GufaApp *app, gboolean ok, gboolean url_loaded, const char *reason) {
    if (app == NULL || app->probe_done) return;
    app->probe_done = TRUE;
    gufa_remove_timer(&app->probe_guard);
    const char *uri = app->webview != NULL ? webkit_web_view_get_uri(WEBKIT_WEB_VIEW(app->webview)) : NULL;
    gufa_log("ciProbe: ok=%s urlLoaded=%s reason=%s uri=%s", ok ? "true" : "false",
             url_loaded ? "true" : "false", reason != NULL ? reason : "(none)",
             uri != NULL ? uri : "(none)");
    gufa_probe_emit(app, ok, url_loaded, reason);
    app->exit_code = 0;
    gufa_request_quit(app, "ciProbe");
}

/** ciProbe 在显示/窗口初始化阶段就失败：写好 ok:false，由 main 返回非 0。 */
static void gufa_probe_fail_early(GufaApp *app, const char *reason) {
    if (app == NULL || !app->ci_probe || app->probe_done) return;
    app->probe_done = TRUE;
    gufa_log("ciProbe: 初始化失败 reason=%s", reason != NULL ? reason : "?");
    gufa_probe_emit(app, FALSE, FALSE, reason != NULL ? reason : "init-failed");
}

static gboolean gufa_on_probe_guard(gpointer user_data) {
    GufaApp *app = (GufaApp *)user_data;
    if (app == NULL) return G_SOURCE_REMOVE;
    app->probe_guard = 0;
    if (app->probe_done) return G_SOURCE_REMOVE;
    gufa_log("ciProbe: 8s 内页面未加载完成，按超时输出结果");
    gufa_emit_probe_result(app, FALSE, FALSE, "load-timeout");
    return G_SOURCE_REMOVE;
}

static gboolean gufa_on_page_probe_timer(gpointer user_data) {
    GufaApp *app = (GufaApp *)user_data;
    if (app == NULL) return G_SOURCE_REMOVE;
    app->page_probe_timer = 0;
    if (app->quitting) return G_SOURCE_REMOVE;
    gufa_run_js(app, "page-probe",
                "JSON.stringify({href:location.href,title:document.title,"
                "float:localStorage.getItem('gufa-code:float'),"
                "state:(localStorage.getItem('gufa-code:float-state')||'').slice(0,120),"
                "body:((document.body&&document.body.innerText)||'').slice(0,160)})");
    return G_SOURCE_REMOVE;
}

static gboolean gufa_on_selftest_snapshot(gpointer user_data) {
    GufaApp *app = (GufaApp *)user_data;
    if (app == NULL) return G_SOURCE_REMOVE;
    app->selftest_snapshot_timer = 0;
    if (app->quitting) return G_SOURCE_REMOVE;
    gufa_run_js(app, "selftest-snapshot", "JSON.stringify(window.__gufaSelftest||{step:'none'})");
    return G_SOURCE_REMOVE;
}

static gboolean gufa_on_selftest_timer(gpointer user_data) {
    GufaApp *app = (GufaApp *)user_data;
    if (app == NULL) return G_SOURCE_REMOVE;
    app->selftest_timer = 0;
    if (app->quitting) return G_SOURCE_REMOVE;
    if (app->selftest != NULL && *app->selftest != '\0') {
        gufa_run_js(app, "selftest", app->selftest);
        app->selftest_snapshot_timer = g_timeout_add(6000, gufa_on_selftest_snapshot, app);
    }
    return G_SOURCE_REMOVE;
}

static gboolean gufa_on_hide_dsh_timer(gpointer user_data) {
    GufaApp *app = (GufaApp *)user_data;
    if (app == NULL) return G_SOURCE_REMOVE;
    app->hide_timer = 0;
    if (app->quitting) return G_SOURCE_REMOVE;
    gufa_hide_dsh(app);
    return G_SOURCE_REMOVE;
}

/* ── WebKit 信号 ────────────────────────────────────────────────────── */

static void gufa_on_load_changed(WebKitWebView *web_view, WebKitLoadEvent load_event, gpointer user_data) {
    GufaApp *app = (GufaApp *)user_data;
    if (app == NULL || app->quitting) return;
    switch (load_event) {
        case WEBKIT_LOAD_COMMITTED: {
            const char *uri = webkit_web_view_get_uri(web_view);
            gufa_log("load: committed %s", uri != NULL ? uri : "(none)");
            break;
        }
        case WEBKIT_LOAD_FINISHED: {
            const char *uri = webkit_web_view_get_uri(web_view);
            const char *title = webkit_web_view_get_title(web_view);
            gufa_log("load: finished stage=%d uri=%s title=%s", (int)app->stage,
                     uri != NULL ? uri : "(none)", title != NULL ? title : "(none)");
            if (app->stage == GUFA_STAGE_AUTH) {
                /* authUrl（token 登录）加载完成 -> 再导航到干净的 appUrl?gufa-float=1 */
                gufa_load_app_url(app);
                return;
            }
            if (app->stage == GUFA_STAGE_APP && !app->loaded) {
                app->loaded = TRUE;
                gufa_remove_timer(&app->probe_guard);
                if (app->ci_probe) {
                    if (app->loading_failed || uri == NULL) {
                        gufa_emit_probe_result(app, FALSE, FALSE, "load-finished-without-page");
                    } else {
                        gufa_emit_probe_result(app, TRUE, TRUE, NULL);
                    }
                    return;
                }
                app->page_probe_timer = g_timeout_add(6000, gufa_on_page_probe_timer, app);
                if (app->selftest != NULL && *app->selftest != '\0') {
                    app->selftest_timer = g_timeout_add(5000, gufa_on_selftest_timer, app);
                }
            }
            break;
        }
        default:
            break;
    }
}

static gboolean gufa_on_load_failed(WebKitWebView *web_view, WebKitLoadEvent load_event, const gchar *failing_uri,
                                    GError *error, gpointer user_data) {
    (void)web_view;
    GufaApp *app = (GufaApp *)user_data;
    if (app == NULL || app->quitting) return FALSE;
    gufa_log("load: failed stage=%d event=%d uri=%s error=%s", (int)app->stage, (int)load_event,
             failing_uri != NULL ? failing_uri : "(none)", error != NULL ? error->message : "?");
    app->loading_failed = TRUE;
    if (app->ci_probe) {
        gufa_emit_probe_result(app, FALSE, FALSE, "load-failed");
        return FALSE;
    }
    if (app->stage == GUFA_STAGE_AUTH) {
        /* token URL 失败时兜底直连 appUrl（cookie 可能已经有效，或 Host 提供了 cookie） */
        gufa_log("load: authUrl 失败，尝试直接加载 appUrl");
        gufa_load_app_url(app);
    }
    return FALSE;
}

static void gufa_on_web_process_terminated(WebKitWebView *web_view, WebKitWebProcessTerminationReason reason,
                                           gpointer user_data) {
    (void)web_view;
    GufaApp *app = (GufaApp *)user_data;
    gufa_log("web: web process 终止 reason=%d", (int)reason);
    if (app != NULL && app->ci_probe) {
        gufa_emit_probe_result(app, FALSE, FALSE, "web-process-terminated");
    }
}

/* ── 窗口构建 ───────────────────────────────────────────────────────── */

static gboolean gufa_build_window(GufaApp *app) {
    GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    app->window = window;
    gtk_window_set_title(GTK_WINDOW(window), "古法编程悬浮层");
    gtk_window_set_decorated(GTK_WINDOW(window), FALSE);
    gtk_window_set_resizable(GTK_WINDOW(window), TRUE);
    gtk_window_set_type_hint(GTK_WINDOW(window), GDK_WINDOW_TYPE_HINT_UTILITY);
    gtk_window_set_skip_taskbar_hint(GTK_WINDOW(window), TRUE);
    gtk_window_set_skip_pager_hint(GTK_WINDOW(window), TRUE);
    gtk_window_set_focus_on_map(GTK_WINDOW(window), FALSE);
    gtk_window_set_position(GTK_WINDOW(window), GTK_WIN_POS_NONE);
    gtk_window_set_accept_focus(GTK_WINDOW(window), TRUE);
    gtk_window_set_default_size(GTK_WINDOW(window), GUFA_DEFAULT_WIDTH, GUFA_DEFAULT_HEIGHT);
    gtk_style_context_add_class(gtk_widget_get_style_context(window), "gufa-float-window");

    GdkScreen *screen = gtk_widget_get_screen(window);
    GdkVisual *rgba_visual = screen != NULL ? gdk_screen_get_rgba_visual(screen) : NULL;
    app->composited = screen != NULL ? gdk_screen_is_composited(screen) : FALSE;
    app->transparent = app->composited && rgba_visual != NULL;
    if (app->transparent) {
        gtk_widget_set_visual(window, rgba_visual);
        gtk_widget_set_app_paintable(window, TRUE);
        g_signal_connect(window, "draw", G_CALLBACK(gufa_on_window_draw), app);
        gufa_log("window: 使用 RGBA visual，窗口背景透明（合成器可用）");
    } else {
        gufa_log("window: 当前桌面没有合成器 / 无 RGBA visual，窗口将不透明（页面仍可正常使用）");
    }
    g_signal_connect(window, "delete-event", G_CALLBACK(gufa_on_delete_event), app);

    GtkWidget *overlay = gtk_overlay_new();
    gtk_container_add(GTK_CONTAINER(window), overlay);
    app->overlay = overlay;

    /* document-start 注入脚本：悬浮模式标记 + 主窗口状态快照 */
    app->content_manager = webkit_user_content_manager_new();
    if (app->content_manager == NULL) {
        gufa_log("window: WebKitUserContentManager 创建失败（WebKit 环境不可用）");
        return FALSE;
    }
    if (app->bootstrap_js != NULL && *app->bootstrap_js != '\0') {
        WebKitUserScript *script = webkit_user_script_new(app->bootstrap_js,
                                                          WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
                                                          WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
                                                          NULL, NULL);
        if (script != NULL) {
            webkit_user_content_manager_add_script(app->content_manager, script);
            webkit_user_script_unref(script);
        }
    }
    GtkWidget *webview = webkit_web_view_new_with_user_content_manager(app->content_manager);
    if (webview == NULL) {
        gufa_log("window: WebKitWebView 创建失败（WebKit 环境不可用）");
        return FALSE;
    }
    app->webview = webview;
    gtk_widget_set_size_request(webview, GUFA_MIN_WIDTH, GUFA_MIN_HEIGHT);
    if (app->transparent) {
        GdkRGBA transparent;
        memset(&transparent, 0, sizeof(transparent));
        webkit_web_view_set_background_color(WEBKIT_WEB_VIEW(webview), &transparent);
    }
    g_signal_connect(webview, "load-changed", G_CALLBACK(gufa_on_load_changed), app);
    g_signal_connect(webview, "load-failed", G_CALLBACK(gufa_on_load_failed), app);
    g_signal_connect(webview, "web-process-terminated", G_CALLBACK(gufa_on_web_process_terminated), app);
    gtk_container_add(GTK_CONTAINER(overlay), webview);

    /* 顶部 22px 拖动条 */
    GtkWidget *strip = gtk_event_box_new();
    gtk_event_box_set_visible_window(GTK_EVENT_BOX(strip), TRUE);
    gtk_widget_set_size_request(strip, -1, GUFA_DRAG_STRIP_HEIGHT);
    gtk_widget_set_halign(strip, GTK_ALIGN_FILL);
    gtk_widget_set_valign(strip, GTK_ALIGN_START);
    gtk_widget_add_events(strip, GDK_BUTTON_PRESS_MASK);
    gtk_style_context_add_class(gtk_widget_get_style_context(strip), "gufa-strip");
    gtk_widget_set_tooltip_text(strip, "按住拖动窗口；右键打开菜单");
    GtkWidget *strip_label = gtk_label_new("古法编程 · 摸鱼中（拖动移动 · 右下角缩放 · 右键菜单）");
    gtk_label_set_ellipsize(GTK_LABEL(strip_label), PANGO_ELLIPSIZE_END);
    gtk_widget_set_halign(strip_label, GTK_ALIGN_CENTER);
    gtk_widget_set_valign(strip_label, GTK_ALIGN_CENTER);
    gtk_style_context_add_class(gtk_widget_get_style_context(strip_label), "gufa-strip-label");
    gtk_container_add(GTK_CONTAINER(strip), strip_label);
    g_signal_connect(strip, "button-press-event", G_CALLBACK(gufa_on_strip_button_press), app);
    g_signal_connect(strip, "realize", G_CALLBACK(gufa_on_strip_realize), app);
    gtk_overlay_add_overlay(GTK_OVERLAY(overlay), strip);

    /* 右下角缩放手柄（无边框窗口自己实现 resize） */
    GtkWidget *grip = gtk_drawing_area_new();
    gtk_widget_set_size_request(grip, 18, 18);
    gtk_widget_set_halign(grip, GTK_ALIGN_END);
    gtk_widget_set_valign(grip, GTK_ALIGN_END);
    gtk_widget_add_events(grip, GDK_BUTTON_PRESS_MASK);
    g_signal_connect(grip, "draw", G_CALLBACK(gufa_on_grip_draw), app);
    g_signal_connect(grip, "realize", G_CALLBACK(gufa_on_grip_realize), app);
    g_signal_connect(grip, "button-press-event", G_CALLBACK(gufa_on_grip_button_press), app);
    gtk_overlay_add_overlay(GTK_OVERLAY(overlay), grip);

    gufa_build_menu(app);

    int x = 0, y = 0, width = 0, height = 0;
    if (!gufa_load_saved_frame(&x, &y, &width, &height)) {
        gufa_center_window(app, &x, &y, &width, &height);
    }
    gtk_window_move(GTK_WINDOW(window), x, y);
    gtk_window_resize(GTK_WINDOW(window), width, height);
    gtk_widget_show_all(window);
    gtk_window_set_keep_above(GTK_WINDOW(window), TRUE);
    gtk_window_move(GTK_WINDOW(window), x, y);
    gtk_window_resize(GTK_WINDOW(window), width, height);
    app->own_xid = gufa_own_xid_from_widget(app);
    gufa_log("window: %d,%d %dx%d own_xid=0x%lx scale=%d", x, y, width, height,
             (unsigned long)app->own_xid, gtk_widget_get_scale_factor(window));
    return TRUE;
}

/* ── --list-windows 模式 ────────────────────────────────────────────── */

static int gufa_run_list_windows(const char *out_path) {
    GufaX11 x11;
    if (!gufa_x11_open(&x11)) {
        g_printerr("gufa-float-linux: 无法连接 X11（DISPLAY=%s），--list-windows 需要 X11\n",
                   g_getenv("DISPLAY") != NULL ? g_getenv("DISPLAY") : "(unset)");
        return 1;
    }
    GPtrArray *apps = gufa_x11_list_apps(&x11);
    GString *json = g_string_new("{\"ok\":true,\"accessibility\":true,\"apps\":[");
    for (guint i = 0; i < apps->len; i++) {
        const GufaX11App *app = g_ptr_array_index(apps, i);
        if (i > 0) g_string_append_c(json, ',');
        char *title = gufa_json_quote(app->title);
        char *owner = gufa_json_quote(app->owner != NULL ? app->owner : "");
        char *wm_class = gufa_json_quote(app->wm_class != NULL ? app->wm_class : "");
        g_string_append_printf(json,
                               "{\"pid\":%ld,\"owner\":%s,\"title\":%s,\"bundleId\":%s,"
                               "\"windowNumber\":%lu,\"frontmost\":%s}",
                               app->pid, owner, title, wm_class, (unsigned long)app->win,
                               app->frontmost ? "true" : "false");
        g_free(title);
        g_free(owner);
        g_free(wm_class);
    }
    g_string_append(json, "]}");
    int result = 0;
    if (out_path != NULL) {
        GError *error = NULL;
        if (!g_file_set_contents(out_path, json->str, (gssize)json->len, &error)) {
            g_printerr("gufa-float-linux: 写入 %s 失败：%s\n", out_path,
                       error != NULL ? error->message : "?");
            g_clear_error(&error);
            result = 1;
        }
    } else {
        g_print("%s\n", json->str);
    }
    g_string_free(json, TRUE);
    gufa_x11_apps_free(apps);
    gufa_x11_close(&x11);
    return result;
}

/* ── main ──────────────────────────────────────────────────────────── */

static void gufa_print_usage(void) {
    g_printerr("用法：gufa-float-linux '<payloadJson>'\n"
               "      gufa-float-linux --list-windows [--out path]\n"
               "      gufa-float-linux --version\n");
}

int main(int argc, char **argv) {
    gufa_log_init();
    if (argc < 2) {
        gufa_print_usage();
        return 2;
    }
    if (strcmp(argv[1], "--list-windows") == 0) {
        const char *out_path = NULL;
        for (int i = 2; i + 1 < argc; i++) {
            if (strcmp(argv[i], "--out") == 0) out_path = argv[i + 1];
        }
        return gufa_run_list_windows(out_path);
    }
    if (strcmp(argv[1], "--version") == 0 || strcmp(argv[1], "-v") == 0) {
        g_print("gufa-float-linux %s (GTK3 + WebKit2GTK)\n", GUFA_FLOAT_VERSION);
        return 0;
    }
    if (strcmp(argv[1], "--help") == 0 || strcmp(argv[1], "-h") == 0) {
        gufa_print_usage();
        return 0;
    }
    if (argv[1][0] != '{') {
        g_printerr("gufa-float-linux: argv[1] 不是 JSON payload\n");
        gufa_print_usage();
        return 2;
    }

    GError *json_error = NULL;
    GufaJson *payload = gufa_json_parse(argv[1], &json_error);
    if (payload == NULL || gufa_json_get_type(payload) != GUFA_JSON_OBJECT) {
        g_printerr("gufa-float-linux: argv[1] JSON 解析失败：%s\n",
                   json_error != NULL ? json_error->message : "根节点不是 object");
        g_clear_error(&json_error);
        gufa_json_free(payload);
        return 2;
    }

    GufaApp app;
    memset(&app, 0, sizeof(app));
    app.exit_code = 0;
    if (!gufa_payload_fill(&app, payload)) {
        g_printerr("gufa-float-linux: payload 缺少 appUrl，退出\n");
        gufa_probe_fail_early(&app, "missing-appUrl");
        gufa_json_free(payload);
        g_free(app.app_url);
        return 2;
    }
    gufa_log("start: version=%s build=%s appUrl=%s follow_pid=%ld ownerPid=%ld controlPath=%s ciProbe=%d alpha=%d ciProbeOut=%s",
             GUFA_FLOAT_VERSION, app.build != NULL ? app.build : "?", app.app_url, app.follow_pid,
             app.owner_pid, app.control_path != NULL ? app.control_path : "(none)", app.ci_probe ? 1 : 0,
             app.alpha, app.ci_probe_out != NULL ? app.ci_probe_out : "(none)");

    if (!gufa_configure_backend(&app)) {
        gufa_probe_fail_early(&app, "display-unavailable");
        return 3;
    }
    gufa_prepare_probe_env(&app);

    int gtk_argc = argc;
    char **gtk_argv = argv;
    if (!gtk_init_check(&gtk_argc, &gtk_argv)) {
        g_printerr("gufa-float-linux: GTK 初始化失败（图形显示不可用）。Linux 版需要 X11 桌面或 XWayland。\n");
        gufa_probe_fail_early(&app, "gtk-init-failed");
        gufa_json_free(payload);
        return 3;
    }
#if GUFA_HAVE_GDK_X11
    {
        GdkDisplay *display = gdk_display_get_default();
        app.gdk_is_x11 = display != NULL && GDK_IS_X11_DISPLAY(display);
        gufa_log("display: type=%s", app.gdk_is_x11 ? "x11" : (display != NULL ? G_OBJECT_TYPE_NAME(display) : "none"));
    }
#else
    app.gdk_is_x11 = FALSE;
#endif
    if (app.gdk_is_x11) {
        app.x11_ok = gufa_x11_open(&app.x11);
    } else {
        gufa_log("display: 当前不是 X11 后端（Wayland？），follow 与隐藏 DSH 主窗口降级为不可用，仅自由悬浮");
    }

    gufa_install_css();
    if (!gufa_build_window(&app)) {
        gufa_probe_fail_early(&app, "window-init-failed");
        gufa_json_free(payload);
        return 3;
    }

    if (!app.ci_probe) {
        if (app.x11_ok) {
            app.hide_timer = g_timeout_add(450, gufa_on_hide_dsh_timer, &app);
        } else {
            gufa_log("dsh-hide: 非 X11 会话，跳过隐藏 DSH 主窗口");
        }
        if (app.follow_pid > 0) {
            if (app.x11_ok) {
                app.follow_timer = g_timeout_add(250, gufa_on_follow_tick, &app);
                gufa_log("follow: 启动 250ms 跟随定时器 pid=%ld title=%s", app.follow_pid,
                         app.follow_title != NULL ? app.follow_title : "");
            } else {
                gufa_log("follow: X11 不可用，降级为自由悬浮（不跟随）");
            }
        } else {
            gufa_log("follow: 自由悬浮模式（不跟随）");
        }
    }

    if (app.control_path != NULL && *app.control_path != '\0') {
        app.host_pid = getppid();
        app.watch_host = app.host_pid > 1;
        app.control_timer = g_timeout_add(300, gufa_on_control_tick, &app);
        gufa_log("control: 每 300ms 轮询 %s（host pid=%ld）", app.control_path, (long)app.host_pid);
    }
    g_unix_signal_add(SIGTERM, gufa_on_unix_signal, &app);
    g_unix_signal_add(SIGINT, gufa_on_unix_signal, &app);

    if (app.ci_probe) {
        app.probe_guard = g_timeout_add(8000, gufa_on_probe_guard, &app);
    }
    gufa_start_load(&app);

    gtk_main();

    /* 兜底：任何未走 request_quit 的退出路径也要恢复 DSH 主窗口 */
    gufa_restore_dsh(&app);
    gufa_remove_timer(&app.control_timer);
    gufa_remove_timer(&app.follow_timer);
    gufa_remove_timer(&app.hide_timer);
    gufa_remove_timer(&app.probe_guard);
    gufa_remove_timer(&app.page_probe_timer);
    gufa_remove_timer(&app.selftest_timer);
    gufa_remove_timer(&app.selftest_snapshot_timer);
    gufa_save_frame(&app);

    if (app.menu != NULL) {
        gtk_widget_destroy(app.menu);
        app.menu = NULL;
    }
    if (app.window != NULL) {
        gtk_widget_destroy(app.window);
        app.window = NULL;
    }
    if (app.content_manager != NULL) {
        g_object_unref(app.content_manager);
        app.content_manager = NULL;
    }
    gufa_x11_close(&app.x11);
    g_free(app.app_url);
    g_free(app.auth_url);
    g_free(app.cookie);
    g_free(app.control_path);
    g_free(app.build);
    g_free(app.selftest);
    g_free(app.follow_title);
    g_free(app.bootstrap_js);
    g_free(app.ci_probe_out);
    g_free(app.hidden_dsh.wins);
    gufa_json_free(app.payload);
    return app.exit_code;
}
