/**
 * 悬浮层诊断日志实现（见 log.h）。
 */
#include "log.h"

#include <stdarg.h>
#include <stdio.h>

static char *gufa_log_file_path = NULL;

void gufa_log_init(void) {
    if (gufa_log_file_path != NULL) return;
    const char *override = g_getenv("GUFA_FLOAT_DEBUG_LOG");
    if (override != NULL && *override != '\0') {
        gufa_log_file_path = g_strdup(override);
    } else {
        gufa_log_file_path = g_strdup("/tmp/gufa-float-debug.log");
    }
}

const char *gufa_log_path(void) {
    if (gufa_log_file_path == NULL) gufa_log_init();
    return gufa_log_file_path;
}

static void gufa_log_write_file(const char *timestamp, const char *message) {
    const char *path = gufa_log_path();
    FILE *file = fopen(path, "a");
    if (file == NULL) return;
    fprintf(file, "[%s] %s\n", timestamp, message);
    fclose(file);
}

void gufa_log(const char *format, ...) {
    va_list args;
    char *message = NULL;
    GDateTime *now = g_date_time_new_now_local();
    char *timestamp = now != NULL ? g_date_time_format(now, "%Y-%m-%dT%H:%M:%S%z") : g_strdup("?");
    va_start(args, format);
    message = g_strdup_vprintf(format, args);
    va_end(args);
    if (message == NULL) message = g_strdup("");
    g_printerr("[gufa-float][%s] %s\n", timestamp, message);
    gufa_log_write_file(timestamp, message);
    g_free(message);
    g_free(timestamp);
    if (now != NULL) g_date_time_unref(now);
}
