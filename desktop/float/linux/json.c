/**
 * 极简 JSON 解析/序列化实现（见 json.h）。
 */
#include "json.h"

#include <math.h>
#include <string.h>

#define GUFA_JSON_MAX_DEPTH 64

struct _GufaJson {
    GufaJsonType type;
    gboolean boolean;
    double number;
    char *string;
    /* array: items；object: keys 与 items 一一对应 */
    GPtrArray *keys;
    GPtrArray *items;
};

typedef struct {
    const char *cur;
    const char *end;
    int depth;
} GufaJsonParser;

static GQuark gufa_json_error_quark(void) {
    return g_quark_from_static_string("gufa-json-error");
}

static void json_destroy(gpointer data) {
    gufa_json_free((GufaJson *)data);
}

static GufaJson *json_new(GufaJsonType type) {
    GufaJson *value = g_new0(GufaJson, 1);
    value->type = type;
    return value;
}

void gufa_json_free(GufaJson *value) {
    if (value == NULL) return;
    g_free(value->string);
    if (value->keys != NULL) g_ptr_array_unref(value->keys);
    if (value->items != NULL) g_ptr_array_unref(value->items);
    g_free(value);
}

GufaJsonType gufa_json_get_type(const GufaJson *value) {
    return value == NULL ? GUFA_JSON_NULL : value->type;
}

static gboolean json_error(GufaJsonParser *parser, GError **error, const char *message) {
    (void)parser;
    if (error != NULL && *error == NULL) {
        g_set_error_literal(error, gufa_json_error_quark(), 1, message);
    }
    return FALSE;
}

static void skip_whitespace(GufaJsonParser *parser) {
    while (parser->cur < parser->end) {
        char c = *parser->cur;
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
            parser->cur++;
        } else {
            break;
        }
    }
}

static gboolean parse_value(GufaJsonParser *parser, GufaJson **out, GError **error);

static void append_utf8_codepoint(GString *out, gunichar codepoint) {
    char buffer[6];
    int length = g_unichar_to_utf8(codepoint, buffer);
    if (length > 0) {
        g_string_append_len(out, buffer, length);
    }
}

static gboolean parse_hex4(const char *p, const char *end, guint *out) {
    guint value = 0;
    if (p + 4 > end) return FALSE;
    for (int i = 0; i < 4; i++) {
        char c = p[i];
        value <<= 4;
        if (c >= '0' && c <= '9') {
            value |= (guint)(c - '0');
        } else if (c >= 'a' && c <= 'f') {
            value |= (guint)(c - 'a' + 10);
        } else if (c >= 'A' && c <= 'F') {
            value |= (guint)(c - 'A' + 10);
        } else {
            return FALSE;
        }
    }
    *out = value;
    return TRUE;
}

static char *parse_string_raw(GufaJsonParser *parser, GError **error) {
    if (parser->cur >= parser->end || *parser->cur != '"') {
        json_error(parser, error, "expected string");
        return NULL;
    }
    parser->cur++;
    GString *out = g_string_new(NULL);
    gboolean closed = FALSE;
    while (parser->cur < parser->end) {
        unsigned char c = (unsigned char)*parser->cur++;
        if (c == '"') {
            closed = TRUE;
            break;
        }
        if (c == '\\') {
            if (parser->cur >= parser->end) break;
            unsigned char escape = (unsigned char)*parser->cur++;
            switch (escape) {
                case '"': g_string_append_c(out, '"'); break;
                case '\\': g_string_append_c(out, '\\'); break;
                case '/': g_string_append_c(out, '/'); break;
                case 'b': g_string_append_c(out, '\b'); break;
                case 'f': g_string_append_c(out, '\f'); break;
                case 'n': g_string_append_c(out, '\n'); break;
                case 'r': g_string_append_c(out, '\r'); break;
                case 't': g_string_append_c(out, '\t'); break;
                case 'u': {
                    guint code = 0;
                    if (!parse_hex4(parser->cur, parser->end, &code)) {
                        json_error(parser, error, "bad \\u escape");
                        g_string_free(out, TRUE);
                        return NULL;
                    }
                    parser->cur += 4;
                    if (code >= 0xD800 && code <= 0xDBFF && parser->cur + 6 <= parser->end &&
                        parser->cur[0] == '\\' && parser->cur[1] == 'u') {
                        guint low = 0;
                        if (parse_hex4(parser->cur + 2, parser->end, &low) && low >= 0xDC00 && low <= 0xDFFF) {
                            parser->cur += 6;
                            code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                        }
                    }
                    if (code >= 0xD800 && code <= 0xDFFF) code = 0xFFFD; /* 非法代理对 */
                    append_utf8_codepoint(out, (gunichar)code);
                    break;
                }
                default:
                    json_error(parser, error, "bad escape");
                    g_string_free(out, TRUE);
                    return NULL;
            }
            continue;
        }
        if (c < 0x20) {
            json_error(parser, error, "control character in string");
            g_string_free(out, TRUE);
            return NULL;
        }
        g_string_append_c(out, (char)c);
    }
    if (!closed) {
        json_error(parser, error, "unterminated string");
        g_string_free(out, TRUE);
        return NULL;
    }
    return g_string_free(out, FALSE);
}

static gboolean parse_number_raw(GufaJsonParser *parser, double *out) {
    const char *start = parser->cur;
    while (parser->cur < parser->end) {
        char c = *parser->cur;
        if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E') {
            parser->cur++;
        } else {
            break;
        }
    }
    if (parser->cur == start) return FALSE;
    char *endptr = NULL;
    double value = g_ascii_strtod(start, &endptr);
    if (endptr != parser->cur) {
        parser->cur = start;
        return FALSE;
    }
    *out = value;
    return TRUE;
}

static gboolean parse_object_raw(GufaJsonParser *parser, GufaJson **out, GError **error) {
    /* parser->cur 指向 '{' */
    parser->cur++;
    GufaJson *object = json_new(GUFA_JSON_OBJECT);
    object->keys = g_ptr_array_new_with_free_func(g_free);
    object->items = g_ptr_array_new_with_free_func(json_destroy);
    skip_whitespace(parser);
    if (parser->cur < parser->end && *parser->cur == '}') {
        parser->cur++;
        *out = object;
        return TRUE;
    }
    for (;;) {
        skip_whitespace(parser);
        char *key = parse_string_raw(parser, error);
        if (key == NULL) {
            gufa_json_free(object);
            return FALSE;
        }
        skip_whitespace(parser);
        if (parser->cur >= parser->end || *parser->cur != ':') {
            g_free(key);
            json_error(parser, error, "expected ':' in object");
            gufa_json_free(object);
            return FALSE;
        }
        parser->cur++;
        GufaJson *value = NULL;
        if (!parse_value(parser, &value, error)) {
            g_free(key);
            gufa_json_free(object);
            return FALSE;
        }
        g_ptr_array_add(object->keys, key);
        g_ptr_array_add(object->items, value);
        skip_whitespace(parser);
        if (parser->cur >= parser->end) {
            json_error(parser, error, "unterminated object");
            gufa_json_free(object);
            return FALSE;
        }
        char c = *parser->cur++;
        if (c == '}') break;
        if (c != ',') {
            json_error(parser, error, "expected ',' or '}' in object");
            gufa_json_free(object);
            return FALSE;
        }
    }
    *out = object;
    return TRUE;
}

static gboolean parse_array_raw(GufaJsonParser *parser, GufaJson **out, GError **error) {
    parser->cur++;
    GufaJson *array = json_new(GUFA_JSON_ARRAY);
    array->items = g_ptr_array_new_with_free_func(json_destroy);
    skip_whitespace(parser);
    if (parser->cur < parser->end && *parser->cur == ']') {
        parser->cur++;
        *out = array;
        return TRUE;
    }
    for (;;) {
        GufaJson *value = NULL;
        if (!parse_value(parser, &value, error)) {
            gufa_json_free(array);
            return FALSE;
        }
        g_ptr_array_add(array->items, value);
        skip_whitespace(parser);
        if (parser->cur >= parser->end) {
            json_error(parser, error, "unterminated array");
            gufa_json_free(array);
            return FALSE;
        }
        char c = *parser->cur++;
        if (c == ']') break;
        if (c != ',') {
            json_error(parser, error, "expected ',' or ']' in array");
            gufa_json_free(array);
            return FALSE;
        }
    }
    *out = array;
    return TRUE;
}

static gboolean parse_value(GufaJsonParser *parser, GufaJson **out, GError **error) {
    if (parser->depth >= GUFA_JSON_MAX_DEPTH) {
        return json_error(parser, error, "JSON nesting too deep");
    }
    skip_whitespace(parser);
    if (parser->cur >= parser->end) {
        return json_error(parser, error, "unexpected end of JSON");
    }
    char c = *parser->cur;
    if (c == '{') {
        parser->depth++;
        gboolean ok = parse_object_raw(parser, out, error);
        parser->depth--;
        return ok;
    }
    if (c == '[') {
        parser->depth++;
        gboolean ok = parse_array_raw(parser, out, error);
        parser->depth--;
        return ok;
    }
    if (c == '"') {
        char *string = parse_string_raw(parser, error);
        if (string == NULL) return FALSE;
        GufaJson *value = json_new(GUFA_JSON_STRING);
        value->string = string;
        *out = value;
        return TRUE;
    }
    if (c == 't' && parser->end - parser->cur >= 4 && strncmp(parser->cur, "true", 4) == 0) {
        parser->cur += 4;
        GufaJson *value = json_new(GUFA_JSON_BOOL);
        value->boolean = TRUE;
        *out = value;
        return TRUE;
    }
    if (c == 'f' && parser->end - parser->cur >= 5 && strncmp(parser->cur, "false", 5) == 0) {
        parser->cur += 5;
        GufaJson *value = json_new(GUFA_JSON_BOOL);
        value->boolean = FALSE;
        *out = value;
        return TRUE;
    }
    if (c == 'n' && parser->end - parser->cur >= 4 && strncmp(parser->cur, "null", 4) == 0) {
        parser->cur += 4;
        *out = json_new(GUFA_JSON_NULL);
        return TRUE;
    }
    double number = 0.0;
    if (parse_number_raw(parser, &number)) {
        GufaJson *value = json_new(GUFA_JSON_NUMBER);
        value->number = number;
        *out = value;
        return TRUE;
    }
    return json_error(parser, error, "unexpected character in JSON");
}

GufaJson *gufa_json_parse(const char *text, GError **error) {
    if (text == NULL) {
        g_set_error_literal(error, gufa_json_error_quark(), 1, "empty JSON text");
        return NULL;
    }
    GufaJsonParser parser;
    parser.cur = text;
    parser.end = text + strlen(text);
    parser.depth = 0;
    GufaJson *value = NULL;
    if (!parse_value(&parser, &value, error)) return NULL;
    skip_whitespace(&parser);
    if (parser.cur != parser.end) {
        gufa_json_free(value);
        g_set_error_literal(error, gufa_json_error_quark(), 1, "trailing data after JSON value");
        return NULL;
    }
    return value;
}

GufaJson *gufa_json_object_get(const GufaJson *object, const char *key) {
    if (object == NULL || object->type != GUFA_JSON_OBJECT || key == NULL) return NULL;
    for (guint i = 0; i < object->items->len; i++) {
        const char *candidate = g_ptr_array_index(object->keys, i);
        if (candidate != NULL && strcmp(candidate, key) == 0) {
            return g_ptr_array_index(object->items, i);
        }
    }
    return NULL;
}

const char *gufa_json_get_string(const GufaJson *value) {
    if (value == NULL || value->type != GUFA_JSON_STRING) return NULL;
    return value->string;
}

char *gufa_json_dup_string(const GufaJson *value) {
    const char *string = gufa_json_get_string(value);
    return string == NULL ? NULL : g_strdup(string);
}

gboolean gufa_json_get_bool(const GufaJson *value, gboolean fallback) {
    if (value == NULL || value->type != GUFA_JSON_BOOL) return fallback;
    return value->boolean;
}

double gufa_json_get_number(const GufaJson *value, double fallback) {
    if (value == NULL || value->type != GUFA_JSON_NUMBER) return fallback;
    return value->number;
}

long gufa_json_get_int64(const GufaJson *value, long fallback) {
    if (value == NULL || value->type != GUFA_JSON_NUMBER) return fallback;
    if (!isfinite(value->number)) return fallback;
    return (long)value->number;
}

int gufa_json_array_size(const GufaJson *value) {
    if (value == NULL || value->type != GUFA_JSON_ARRAY) return 0;
    return (int)value->items->len;
}

GufaJson *gufa_json_array_get(const GufaJson *value, int index) {
    if (value == NULL || value->type != GUFA_JSON_ARRAY) return NULL;
    if (index < 0 || (guint)index >= value->items->len) return NULL;
    return g_ptr_array_index(value->items, (guint)index);
}

/* ── 序列化 ─────────────────────────────────────────────────────────── */

static void append_escaped_string(GString *out, const char *text) {
    g_string_append_c(out, '"');
    const unsigned char *p = (const unsigned char *)text;
    while (*p != '\0') {
        unsigned char c = *p;
        switch (c) {
            case '"': g_string_append(out, "\\\""); p++; continue;
            case '\\': g_string_append(out, "\\\\"); p++; continue;
            case '\b': g_string_append(out, "\\b"); p++; continue;
            case '\f': g_string_append(out, "\\f"); p++; continue;
            case '\n': g_string_append(out, "\\n"); p++; continue;
            case '\r': g_string_append(out, "\\r"); p++; continue;
            case '\t': g_string_append(out, "\\t"); p++; continue;
            default: break;
        }
        if (c < 0x20) {
            g_string_append_printf(out, "\\u%04x", (unsigned int)c);
            p++;
            continue;
        }
        /* U+2028 / U+2029 在 JS 源码字符串里是行终止符，转义掉最安全（UTF-8: E2 80 A8/A9） */
        if (c == 0xE2 && p[1] == 0x80 && (p[2] == 0xA8 || p[2] == 0xA9)) {
            g_string_append(out, p[2] == 0xA8 ? "\\u2028" : "\\u2029");
            p += 3;
            continue;
        }
        g_string_append_c(out, (char)c);
        p++;
    }
    g_string_append_c(out, '"');
}

static void serialize_value(GString *out, const GufaJson *value) {
    if (value == NULL) {
        g_string_append(out, "null");
        return;
    }
    switch (value->type) {
        case GUFA_JSON_NULL:
            g_string_append(out, "null");
            break;
        case GUFA_JSON_BOOL:
            g_string_append(out, value->boolean ? "true" : "false");
            break;
        case GUFA_JSON_NUMBER:
            if (!isfinite(value->number)) {
                g_string_append(out, "null");
            } else if (value->number == floor(value->number) && fabs(value->number) < 1e15) {
                g_string_append_printf(out, "%.0f", value->number);
            } else {
                g_string_append_printf(out, "%.17g", value->number);
            }
            break;
        case GUFA_JSON_STRING:
            append_escaped_string(out, value->string != NULL ? value->string : "");
            break;
        case GUFA_JSON_ARRAY:
            g_string_append_c(out, '[');
            for (guint i = 0; i < value->items->len; i++) {
                if (i > 0) g_string_append_c(out, ',');
                serialize_value(out, g_ptr_array_index(value->items, i));
            }
            g_string_append_c(out, ']');
            break;
        case GUFA_JSON_OBJECT:
            g_string_append_c(out, '{');
            for (guint i = 0; i < value->items->len; i++) {
                if (i > 0) g_string_append_c(out, ',');
                const char *key = g_ptr_array_index(value->keys, i);
                append_escaped_string(out, key != NULL ? key : "");
                g_string_append_c(out, ':');
                serialize_value(out, g_ptr_array_index(value->items, i));
            }
            g_string_append_c(out, '}');
            break;
        default:
            g_string_append(out, "null");
            break;
    }
}

char *gufa_json_serialize(const GufaJson *value) {
    GString *out = g_string_new(NULL);
    serialize_value(out, value);
    return g_string_free(out, FALSE);
}

char *gufa_json_quote(const char *text) {
    GString *out = g_string_new(NULL);
    append_escaped_string(out, text != NULL ? text : "");
    return g_string_free(out, FALSE);
}
