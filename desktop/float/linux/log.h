/**
 * 悬浮层诊断日志：同时写 stderr 与 /tmp/gufa-float-debug.log（可用 GUFA_FLOAT_DEBUG_LOG 覆盖）。
 * 真机验收时用户可直接把该文件发回来排查。
 */
#ifndef GUFA_LOG_H
#define GUFA_LOG_H

#include <glib.h>

/** 初始化（只需要在 main 开头调用一次）。 */
void gufa_log_init(void);

/** 记录一条日志（自动加时间戳）。 */
void gufa_log(const char *format, ...) G_GNUC_PRINTF(1, 2);

/** 当前日志文件路径。 */
const char *gufa_log_path(void);

#endif /* GUFA_LOG_H */
