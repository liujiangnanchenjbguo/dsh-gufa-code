/**
 * 古法编程 · Windows 悬浮层 helper —— 极简 JSON 解析/序列化（header-only）
 *
 * 只依赖 C++17 标准库。数字保留原始文本（raw），保证 payload.state 这类
 * 「主机原样塞进来的 JSON」在解析 → 重新序列化后不丢精度、不改变写法。
 *
 * 用法：
 *   gufa::JsonValue root;
 *   std::wstring error;
 *   if (!gufa::ParseJson(text, root, &error)) { ... }
 *   const gufa::JsonValue* field = root.Find(L"appUrl");
 */
#pragma once

#include <cstddef>
#include <string>
#include <utility>
#include <vector>

namespace gufa {

struct JsonValue {
  enum class Type { Null, Bool, Number, String, Array, Object };

  Type type = Type::Null;
  bool boolean = false;
  std::wstring number;  // 原始 JSON 数字文本（如 "55"、"1.25e3"）
  std::wstring text;    // String 的值
  std::vector<JsonValue> items;
  std::vector<std::pair<std::wstring, JsonValue>> members;

  bool IsNull() const { return type == Type::Null; }
  bool IsBool() const { return type == Type::Bool; }
  bool IsNumber() const { return type == Type::Number; }
  bool IsString() const { return type == Type::String; }
  bool IsArray() const { return type == Type::Array; }
  bool IsObject() const { return type == Type::Object; }

  const JsonValue* Find(const std::wstring& key) const {
    if (type != Type::Object) return nullptr;
    for (const auto& member : members) {
      if (member.first == key) return &member.second;
    }
    return nullptr;
  }

  const JsonValue* At(std::size_t index) const {
    if (type != Type::Array || index >= items.size()) return nullptr;
    return &items[index];
  }
};

namespace json_detail {

constexpr int kMaxDepth = 128;

class Parser {
 public:
  explicit Parser(const std::wstring& text) : text_(text) {}

  bool Parse(JsonValue& out) {
    SkipWhitespace();
    if (!ParseValue(out, 0)) return false;
    SkipWhitespace();
    if (pos_ != text_.size()) {
      error_ = L"trailing characters after JSON value";
      return false;
    }
    return true;
  }

  const std::wstring& error() const { return error_; }

 private:
  static bool IsDigit(wchar_t c) { return c >= L'0' && c <= L'9'; }

  void SkipWhitespace() {
    while (pos_ < text_.size()) {
      const wchar_t c = text_[pos_];
      if (c == L' ' || c == L'\t' || c == L'\n' || c == L'\r') {
        ++pos_;
      } else {
        break;
      }
    }
  }

  bool ConsumeKeyword(const wchar_t* keyword, std::size_t length) {
    if (pos_ + length > text_.size()) return false;
    if (text_.compare(pos_, length, keyword) != 0) return false;
    pos_ += length;
    return true;
  }

  bool ParseValue(JsonValue& out, int depth) {
    if (depth > kMaxDepth) {
      error_ = L"JSON nesting too deep";
      return false;
    }
    if (pos_ >= text_.size()) {
      error_ = L"unexpected end of JSON";
      return false;
    }
    const wchar_t c = text_[pos_];
    switch (c) {
      case L'{':
        return ParseObject(out, depth);
      case L'[':
        return ParseArray(out, depth);
      case L'"':
        out.type = JsonValue::Type::String;
        return ParseString(&out.text);
      case L't':
        if (!ConsumeKeyword(L"true", 4)) {
          error_ = L"invalid literal (expected true)";
          return false;
        }
        out.type = JsonValue::Type::Bool;
        out.boolean = true;
        return true;
      case L'f':
        if (!ConsumeKeyword(L"false", 5)) {
          error_ = L"invalid literal (expected false)";
          return false;
        }
        out.type = JsonValue::Type::Bool;
        out.boolean = false;
        return true;
      case L'n':
        if (!ConsumeKeyword(L"null", 4)) {
          error_ = L"invalid literal (expected null)";
          return false;
        }
        out.type = JsonValue::Type::Null;
        return true;
      default:
        break;
    }
    if (c == L'-' || IsDigit(c)) return ParseNumber(out);
    error_ = L"unexpected character in JSON";
    return false;
  }

  bool ParseObject(JsonValue& out, int depth) {
    ++pos_;  // '{'
    out.type = JsonValue::Type::Object;
    out.members.clear();
    SkipWhitespace();
    if (pos_ < text_.size() && text_[pos_] == L'}') {
      ++pos_;
      return true;
    }
    for (;;) {
      SkipWhitespace();
      if (pos_ >= text_.size() || text_[pos_] != L'"') {
        error_ = L"object key must be a string";
        return false;
      }
      std::wstring key;
      if (!ParseString(&key)) return false;
      SkipWhitespace();
      if (pos_ >= text_.size() || text_[pos_] != L':') {
        error_ = L"missing ':' in object";
        return false;
      }
      ++pos_;
      SkipWhitespace();
      JsonValue value;
      if (!ParseValue(value, depth + 1)) return false;
      out.members.emplace_back(std::move(key), std::move(value));
      SkipWhitespace();
      if (pos_ >= text_.size()) {
        error_ = L"unterminated object";
        return false;
      }
      if (text_[pos_] == L',') {
        ++pos_;
        continue;
      }
      if (text_[pos_] == L'}') {
        ++pos_;
        return true;
      }
      error_ = L"expected ',' or '}' in object";
      return false;
    }
  }

  bool ParseArray(JsonValue& out, int depth) {
    ++pos_;  // '['
    out.type = JsonValue::Type::Array;
    out.items.clear();
    SkipWhitespace();
    if (pos_ < text_.size() && text_[pos_] == L']') {
      ++pos_;
      return true;
    }
    for (;;) {
      SkipWhitespace();
      JsonValue value;
      if (!ParseValue(value, depth + 1)) return false;
      out.items.push_back(std::move(value));
      SkipWhitespace();
      if (pos_ >= text_.size()) {
        error_ = L"unterminated array";
        return false;
      }
      if (text_[pos_] == L',') {
        ++pos_;
        continue;
      }
      if (text_[pos_] == L']') {
        ++pos_;
        return true;
      }
      error_ = L"expected ',' or ']' in array";
      return false;
    }
  }

  bool ParseHex4(unsigned int* out) {
    if (pos_ + 4 > text_.size()) {
      error_ = L"truncated \\u escape";
      return false;
    }
    unsigned int value = 0;
    for (int i = 0; i < 4; ++i) {
      const wchar_t c = text_[pos_++];
      value <<= 4;
      if (c >= L'0' && c <= L'9') {
        value |= static_cast<unsigned int>(c - L'0');
      } else if (c >= L'a' && c <= L'f') {
        value |= static_cast<unsigned int>(c - L'a' + 10);
      } else if (c >= L'A' && c <= L'F') {
        value |= static_cast<unsigned int>(c - L'A' + 10);
      } else {
        error_ = L"invalid hex digit in \\u escape";
        return false;
      }
    }
    *out = value;
    return true;
  }

  bool ParseString(std::wstring* out) {
    if (pos_ >= text_.size() || text_[pos_] != L'"') {
      error_ = L"expected string";
      return false;
    }
    ++pos_;
    out->clear();
    while (pos_ < text_.size()) {
      const wchar_t c = text_[pos_++];
      if (c == L'"') return true;
      if (c != L'\\') {
        out->push_back(c);
        continue;
      }
      if (pos_ >= text_.size()) {
        error_ = L"truncated escape sequence";
        return false;
      }
      const wchar_t escape = text_[pos_++];
      switch (escape) {
        case L'"':
          out->push_back(L'"');
          break;
        case L'\\':
          out->push_back(L'\\');
          break;
        case L'/':
          out->push_back(L'/');
          break;
        case L'b':
          out->push_back(L'\b');
          break;
        case L'f':
          out->push_back(L'\f');
          break;
        case L'n':
          out->push_back(L'\n');
          break;
        case L'r':
          out->push_back(L'\r');
          break;
        case L't':
          out->push_back(L'\t');
          break;
        case L'u': {
          unsigned int code = 0;
          if (!ParseHex4(&code)) return false;
          if (code >= 0xD800 && code <= 0xDBFF && pos_ + 5 < text_.size() &&
              text_[pos_] == L'\\' && text_[pos_ + 1] == L'u') {
            const std::size_t saved = pos_;
            pos_ += 2;
            unsigned int low = 0;
            if (!ParseHex4(&low)) {
              pos_ = saved;
              out->push_back(static_cast<wchar_t>(code));
              break;
            }
            if (low >= 0xDC00 && low <= 0xDFFF) {
              // 合并代理对，重新拆成 UTF-16 码元放回 wstring。
              out->push_back(static_cast<wchar_t>(code));
              out->push_back(static_cast<wchar_t>(low));
            } else {
              out->push_back(static_cast<wchar_t>(code));
              out->push_back(static_cast<wchar_t>(low));
            }
            break;
          }
          if (code >= 0xD800 && code <= 0xDFFF) {
            // 孤立代理项：WebView2 传来的 JSON 不应出现；原样保留。
            out->push_back(static_cast<wchar_t>(code));
          } else {
            out->push_back(static_cast<wchar_t>(code));
          }
          break;
        }
        default:
          error_ = L"invalid escape sequence";
          return false;
      }
    }
    error_ = L"unterminated string";
    return false;
  }

  bool ParseNumber(JsonValue& out) {
    const std::size_t start = pos_;
    if (pos_ < text_.size() && text_[pos_] == L'-') ++pos_;
    if (pos_ >= text_.size() || !IsDigit(text_[pos_])) {
      error_ = L"invalid number";
      return false;
    }
    if (text_[pos_] == L'0') {
      ++pos_;
    } else {
      while (pos_ < text_.size() && IsDigit(text_[pos_])) ++pos_;
    }
    if (pos_ < text_.size() && text_[pos_] == L'.') {
      ++pos_;
      if (pos_ >= text_.size() || !IsDigit(text_[pos_])) {
        error_ = L"invalid number fraction";
        return false;
      }
      while (pos_ < text_.size() && IsDigit(text_[pos_])) ++pos_;
    }
    if (pos_ < text_.size() && (text_[pos_] == L'e' || text_[pos_] == L'E')) {
      ++pos_;
      if (pos_ < text_.size() && (text_[pos_] == L'+' || text_[pos_] == L'-')) ++pos_;
      if (pos_ >= text_.size() || !IsDigit(text_[pos_])) {
        error_ = L"invalid number exponent";
        return false;
      }
      while (pos_ < text_.size() && IsDigit(text_[pos_])) ++pos_;
    }
    out.type = JsonValue::Type::Number;
    out.number = text_.substr(start, pos_ - start);
    return true;
  }

  const std::wstring& text_;
  std::size_t pos_ = 0;
  std::wstring error_;
};

inline void AppendHexEscape(wchar_t c, std::wstring* out) {
  static constexpr wchar_t kHexDigits[] = L"0123456789abcdef";
  const unsigned int code = static_cast<unsigned int>(c);
  out->push_back(L'\\');
  out->push_back(L'u');
  out->push_back(kHexDigits[(code >> 12) & 0xF]);
  out->push_back(kHexDigits[(code >> 8) & 0xF]);
  out->push_back(kHexDigits[(code >> 4) & 0xF]);
  out->push_back(kHexDigits[code & 0xF]);
}

inline void AppendEscapedString(const std::wstring& text, std::wstring* out) {
  out->push_back(L'"');
  for (const wchar_t c : text) {
    switch (c) {
      case L'"':
        *out += L"\\\"";
        break;
      case L'\\':
        *out += L"\\\\";
        break;
      case L'\b':
        *out += L"\\b";
        break;
      case L'\f':
        *out += L"\\f";
        break;
      case L'\n':
        *out += L"\\n";
        break;
      case L'\r':
        *out += L"\\r";
        break;
      case L'\t':
        *out += L"\\t";
        break;
      default:
        if (c < 0x20 || c == 0x2028 || c == 0x2029) {
          AppendHexEscape(c, out);
        } else {
          out->push_back(c);
        }
        break;
    }
  }
  out->push_back(L'"');
}

inline void SerializeValue(const JsonValue& value, std::wstring* out) {
  switch (value.type) {
    case JsonValue::Type::Null:
      *out += L"null";
      break;
    case JsonValue::Type::Bool:
      *out += value.boolean ? L"true" : L"false";
      break;
    case JsonValue::Type::Number:
      *out += value.number.empty() ? L"0" : value.number;
      break;
    case JsonValue::Type::String:
      AppendEscapedString(value.text, out);
      break;
    case JsonValue::Type::Array: {
      out->push_back(L'[');
      for (std::size_t i = 0; i < value.items.size(); ++i) {
        if (i != 0) out->push_back(L',');
        SerializeValue(value.items[i], out);
      }
      out->push_back(L']');
      break;
    }
    case JsonValue::Type::Object: {
      out->push_back(L'{');
      for (std::size_t i = 0; i < value.members.size(); ++i) {
        if (i != 0) out->push_back(L',');
        AppendEscapedString(value.members[i].first, out);
        out->push_back(L':');
        SerializeValue(value.members[i].second, out);
      }
      out->push_back(L'}');
      break;
    }
  }
}

}  // namespace json_detail

/** 解析一段 JSON 文本；失败时把原因写入 error（可选）。 */
inline bool ParseJson(const std::wstring& text, JsonValue& out, std::wstring* error) {
  json_detail::Parser parser(text);
  if (parser.Parse(out)) return true;
  if (error != nullptr) *error = parser.error();
  return false;
}

/** 紧凑序列化（保持数字原始文本）。 */
inline std::wstring SerializeJson(const JsonValue& value) {
  std::wstring out;
  json_detail::SerializeValue(value, &out);
  return out;
}

/** 转义成 JS 单引号字符串字面量的内容（不含首尾引号）。 */
inline std::wstring EscapeJsSingleQuoted(const std::wstring& text) {
  std::wstring out;
  out.reserve(text.size() + 16);
  for (const wchar_t c : text) {
    switch (c) {
      case L'\\':
        out += L"\\\\";
        break;
      case L'\'':
        out += L"\\'";
        break;
      case L'\n':
        out += L"\\n";
        break;
      case L'\r':
        out += L"\\r";
        break;
      case L'\t':
        out += L"\\t";
        break;
      case 0x2028:
        out += L"\\u2028";
        break;
      case 0x2029:
        out += L"\\u2029";
        break;
      default:
        out.push_back(c);
        break;
    }
  }
  return out;
}

}  // namespace gufa
