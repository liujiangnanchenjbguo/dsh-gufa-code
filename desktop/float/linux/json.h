/**
 * 极简 JSON 解析/序列化（悬浮层 helper 自用，不引入第三方依赖）
 *
 * 只需要处理 Host 用 JSON.stringify 生成的对象；仍然覆盖完整 JSON 语法，
 * 以便容错 Host 版本差异（null / 数字 / 布尔 / 数组 / 嵌套对象）。
 */
#ifndef GUFA_JSON_H
#define GUFA_JSON_H

#include <glib.h>

typedef enum {
    GUFA_JSON_NULL = 0,
    GUFA_JSON_BOOL,
    GUFA_JSON_NUMBER,
    GUFA_JSON_STRING,
    GUFA_JSON_ARRAY,
    GUFA_JSON_OBJECT
} GufaJsonType;

typedef struct _GufaJson GufaJson;

/** 解析一段 JSON 文本；失败返回 NULL 并设置 error。 */
GufaJson *gufa_json_parse(const char *text, GError **error);

/** 释放整棵 JSON 树（value 可以为 NULL）。 */
void gufa_json_free(GufaJson *value);

GufaJsonType gufa_json_get_type(const GufaJson *value);

/** 读取对象字段：不存在或对象类型不对时返回 NULL。 */
GufaJson *gufa_json_object_get(const GufaJson *object, const char *key);

/** 字符串字段（借用指针，生命周期同 JSON 树）。 */
const char *gufa_json_get_string(const GufaJson *value);

/** 字符串字段副本（调用方 g_free）。 */
char *gufa_json_dup_string(const GufaJson *value);

gboolean gufa_json_get_bool(const GufaJson *value, gboolean fallback);

double gufa_json_get_number(const GufaJson *value, double fallback);

long gufa_json_get_int64(const GufaJson *value, long fallback);

int gufa_json_array_size(const GufaJson *value);

GufaJson *gufa_json_array_get(const GufaJson *value, int index);

/** 紧凑序列化（用于把 payload.state 原样注入 localStorage）；失败返回 NULL。 */
char *gufa_json_serialize(const GufaJson *value);

/** 把字符串转成合法的 JSON 字符串字面量（含引号），调用方 g_free。 */
char *gufa_json_quote(const char *text);

#endif /* GUFA_JSON_H */
