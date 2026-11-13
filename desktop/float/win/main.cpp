/**
 * 古法编程 · Windows 桌面悬浮层 helper（C++17 + Win32 + WebView2）
 *
 * 独立小窗口进程：加载 DSH Web GUI 的「古法编程」，做成无边框、永远置顶、
 * 可拖拽/可缩放的悬浮窗。由 host/dev.js 的 float.* 用
 *   spawn(gufa-float-win.exe, [payloadJson])
 * 启动；与 Host 只通过 argv 里的一个 JSON + controlPath 控制文件通信。
 * 协议见 desktop/float/PLATFORM-PROTOCOL.md。
 *
 * 本文件刻意写成单文件（少量小文件），方便在无法本地编译的机器上逐行核对；
 * WebView2 SDK 头/静态库由 CMake 的 WEBVIEW2_SDK_DIR 提供。
 *
 * 窗口托管两种模式：
 *   - composition（默认）：DirectComposition + WebView2 CompositionController +
 *     WS_EX_NOREDIRECTIONBITMAP 视觉托管，窗口背景透明、可透出下层 App；鼠标输入
 *     由本程序转发给 WebView2（SendMouseInput），顶部 22 DIP 命中 HTCAPTION 拖动。
 *   - windowed（回退/payload.opaque=true）：ICoreWebView2Controller 窗口托管，
 *     不透明但功能完整；初始化/运行期任一步失败都会自动回退到该模式并写日志
 *     transparent-mode=fallback reason=... / transparent-mode=windowed。
 */

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <windows.h>
#include <windowsx.h>
#include <dcomp.h>
#include <dwmapi.h>
#include <objbase.h>
#include <shellapi.h>
#include <tlhelp32.h>
#include <wrl.h>
#include <wrl/client.h>

#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <cwctype>
#include <exception>
#include <string>
#include <utility>
#include <vector>

#include "json.h"

#include "WebView2.h"
#include "WebView2EnvironmentOptions.h"

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace {

/* ────────────────────────────── 常量 ────────────────────────────── */

constexpr wchar_t kMainWindowClass[] = L"GufaFloatWinMain";
constexpr wchar_t kStripWindowClass[] = L"GufaFloatWinStrip";
constexpr wchar_t kWindowTitle[] = L"古法编程悬浮层";
constexpr wchar_t kLogFileName[] = L"gufa-float-debug.log";

constexpr UINT kMsgExitGraceful = WM_APP + 1;
constexpr UINT kMsgStripMenu = WM_APP + 2;

constexpr UINT_PTR kTimerFollow = 1;
constexpr UINT_PTR kTimerControl = 2;
constexpr UINT_PTR kTimerHideDsh = 3;
constexpr UINT_PTR kTimerProbeTimeout = 4;
constexpr UINT_PTR kTimerProbeWatchdog = 5;
constexpr UINT_PTR kTimerSelftest = 6;
constexpr UINT_PTR kTimerPageProbe = 7;
constexpr UINT_PTR kTimerRetry = 8;
constexpr UINT_PTR kTimerControllerWatchdog = 9;

constexpr int kMenuExit = 1;
constexpr int kMenuResetFrame = 2;
constexpr int kMenuToggleClickThrough = 3;
constexpr int kMenuStopFollow = 4;
constexpr UINT kHotkeyClickThrough = 0x4755;  // 全局热键 id：Ctrl+Alt+Shift+G 切换鼠标穿透

constexpr int kResizeBorderDip = 8;  // 左右/底部可缩放边缘宽度（DIP）
constexpr int kDragStripDip = 22;    // 顶部拖动条高度（DIP，与网页 CSS 的 22px 对齐）
constexpr int kProbeTimeoutMs = 8000;
constexpr int kProbeWatchdogMs = 20000;
constexpr int kFollowIntervalMs = 250;
constexpr int kControlIntervalMs = 300;
constexpr int kControllerWatchdogMs = 12000;

/* 深色背景（与网页 --gufa-solid-bg 的底色一致） */
const COLORREF kBackgroundColor = RGB(13, 15, 19);

HINSTANCE g_instance = nullptr;
std::wstring g_logPath;
/* 崩溃兜底：记录被隐藏的 DSH 窗口，异常退出前尽量恢复（全局变量便于崩溃过滤器访问） */
std::vector<HWND> g_crashRestoreWindows;

/* ────────────────────────────── 基础工具 ────────────────────────────── */

std::string WideToUtf8(const std::wstring& text) {
  if (text.empty()) return std::string();
  const int length = WideCharToMultiByte(CP_UTF8, 0, text.c_str(),
                                         static_cast<int>(text.size()),
                                         nullptr, 0, nullptr, nullptr);
  if (length <= 0) return std::string();
  std::string result(static_cast<std::size_t>(length), '\0');
  WideCharToMultiByte(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()),
                      result.data(), length, nullptr, nullptr);
  return result;
}

std::wstring Utf8ToWide(const std::string& text) {
  if (text.empty()) return std::wstring();
  const int length = MultiByteToWideChar(CP_UTF8, 0, text.c_str(),
                                         static_cast<int>(text.size()), nullptr, 0);
  if (length <= 0) return std::wstring();
  std::wstring result(static_cast<std::size_t>(length), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()),
                      &result[0], length);
  return result;
}

void LogFmt(const wchar_t* format, ...);  // 定义在后面；WriteFileUtf8 诊断用

void WriteStdout(const std::wstring& text) {
  const std::string utf8 = WideToUtf8(text);
  HANDLE handle = GetStdHandle(STD_OUTPUT_HANDLE);
  if (handle == nullptr || handle == INVALID_HANDLE_VALUE) return;
  DWORD written = 0;
  WriteFile(handle, utf8.data(), static_cast<DWORD>(utf8.size()), &written, nullptr);
}

/* 把文本以 UTF-8 覆盖写入文件（ciProbe 结果文件用）。写失败返回 false，不影响主流程。 */
bool WriteFileUtf8(const std::wstring& path, const std::wstring& text) {
  if (path.empty()) {
    LogFmt(L"write-file-utf8 skipped: empty path");
    return false;
  }
  const std::string utf8 = WideToUtf8(text);
  HANDLE handle = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                              FILE_ATTRIBUTE_NORMAL, nullptr);
  if (handle == INVALID_HANDLE_VALUE) {
    LogFmt(L"write-file-utf8 open-failed path=%s err=%lu", path.c_str(),
           static_cast<unsigned long>(GetLastError()));
    return false;
  }
  DWORD written = 0;
  const BOOL ok = WriteFile(handle, utf8.data(), static_cast<DWORD>(utf8.size()), &written,
                            nullptr);
  const DWORD writeError = ok != FALSE ? 0 : GetLastError();
  CloseHandle(handle);
  if (ok == FALSE || written != static_cast<DWORD>(utf8.size())) {
    LogFmt(L"write-file-utf8 write-failed path=%s err=%lu written=%lu", path.c_str(),
           static_cast<unsigned long>(writeError), static_cast<unsigned long>(written));
    return false;
  }
  return true;
}

/* HRESULT -> 8 位大写十六进制（ASCII，可直接放进 JSON reason 字段）。 */
std::wstring HexHresult(HRESULT value) {
  wchar_t buffer[16];
  buffer[0] = L'\0';
  _snwprintf_s(buffer, _countof(buffer), _TRUNCATE, L"%08lX",
               static_cast<unsigned long>(value));
  return std::wstring(buffer);
}

/* ciProbe 结束时输出的单行 JSON（stdout 与 ciProbeOut 文件内容一致）。
 * reason 仅用于失败诊断，先过滤成 JSON 安全字符。 */
std::wstring BuildCiProbeLine(bool ok, bool urlLoaded, const std::wstring& reason) {
  std::wstring sanitized;
  for (const wchar_t c : reason) {
    const bool safe = c >= 0x20 && c <= 0x7E && c != L'"' && c != L'\\';
    sanitized.push_back(safe ? c : L'_');
  }
  std::wstring line = L"{\"ok\":";
  line += ok ? L"true" : L"false";
  line += L",\"platform\":\"win32\",\"urlLoaded\":";
  line += urlLoaded ? L"true" : L"false";
  if (!sanitized.empty()) {
    line += L",\"reason\":\"";
    line += sanitized;
    line += L"\"";
  }
  line += L"}";
  return line;
}

/* 读取环境变量 GUFA_FLOAT_PAYLOAD（优先 Unicode 环境块；失败再按 UTF-8 读 ANSI 版）。
 * CI 可用 Start-Process + 环境变量传 payload，绕开 PowerShell 对含引号参数的拼接问题。 */
std::wstring ReadEnvironmentPayload() {
  const wchar_t* kName = L"GUFA_FLOAT_PAYLOAD";
  wchar_t wideBuffer[32768];
  wideBuffer[0] = L'\0';
  const DWORD wideLength =
      GetEnvironmentVariableW(kName, wideBuffer, static_cast<DWORD>(_countof(wideBuffer)));
  if (wideLength > 0 && wideLength < _countof(wideBuffer)) {
    return std::wstring(wideBuffer, wideLength);
  }
  char narrowBuffer[32768];
  narrowBuffer[0] = '\0';
  const DWORD narrowLength =
      GetEnvironmentVariableA("GUFA_FLOAT_PAYLOAD", narrowBuffer, static_cast<DWORD>(_countof(narrowBuffer)));
  if (narrowLength > 0 && narrowLength < _countof(narrowBuffer)) {
    return Utf8ToWide(std::string(narrowBuffer, narrowLength));
  }
  return std::wstring();
}

std::wstring ToLowerCopy(const std::wstring& text) {
  std::wstring result = text;
  for (wchar_t& c : result) c = static_cast<wchar_t>(std::towlower(c));
  return result;
}

bool IsAsciiWhitespace(wchar_t c) {
  return c == L' ' || c == L'\t' || c == L'\r' || c == L'\n';
}

bool HexValue(wchar_t c, unsigned int* value) {
  if (value == nullptr) return false;
  if (c >= L'0' && c <= L'9') {
    *value = static_cast<unsigned int>(c - L'0');
    return true;
  }
  if (c >= L'a' && c <= L'f') {
    *value = static_cast<unsigned int>(c - L'a' + 10);
    return true;
  }
  if (c >= L'A' && c <= L'F') {
    *value = static_cast<unsigned int>(c - L'A' + 10);
    return true;
  }
  return false;
}

/* 从可能被 shell 拼坏（引号被吃掉）的 JSON 文本里宽松提取一个字符串字段。
 * 只用于 ciProbeOut 兜底：合法 JSON 走正常解析，这里只是保证失败时也能留下探针文件。 */
std::wstring ExtractStringFieldLoose(const std::wstring& text, const std::wstring& key) {
  if (text.empty() || key.empty()) return std::wstring();
  const std::size_t found = ToLowerCopy(text).find(ToLowerCopy(key));
  if (found == std::wstring::npos) return std::wstring();
  std::size_t position = found + key.size();
  while (position < text.size() && IsAsciiWhitespace(text[position])) ++position;
  if (position < text.size() && text[position] == L'"') ++position;  // 合法 JSON 里键的收尾引号
  while (position < text.size() && IsAsciiWhitespace(text[position])) ++position;
  if (position < text.size() && (text[position] == L':' || text[position] == L'=')) ++position;
  while (position < text.size() && IsAsciiWhitespace(text[position])) ++position;
  if (position < text.size() && text[position] == L'"') {
    ++position;
    std::wstring result;
    while (position < text.size()) {
      const wchar_t c = text[position++];
      if (c == L'"') return result;
      if (c != L'\\' || position >= text.size()) {
        result.push_back(c);
        continue;
      }
      const wchar_t escape = text[position++];
      switch (escape) {
        case L'\\':
          result.push_back(L'\\');
          break;
        case L'"':
          result.push_back(L'"');
          break;
        case L'/':
          result.push_back(L'/');
          break;
        case L'b':
          result.push_back(L'\b');
          break;
        case L'f':
          result.push_back(L'\f');
          break;
        case L'n':
          result.push_back(L'\n');
          break;
        case L'r':
          result.push_back(L'\r');
          break;
        case L't':
          result.push_back(L'\t');
          break;
        case L'u': {
          unsigned int code = 0;
          bool ok = position + 4 <= text.size();
          for (int i = 0; ok && i < 4; ++i) {
            unsigned int digit = 0;
            ok = HexValue(text[position + static_cast<std::size_t>(i)], &digit);
            code = (code << 4) | digit;
          }
          if (ok) {
            position += 4;
            result.push_back(static_cast<wchar_t>(code));
          } else {
            result.push_back(L'u');
          }
          break;
        }
        default:
          result.push_back(escape);
          break;
      }
    }
    return result;
  }
  // 引号已被 shell 吃掉：读到 JSON 分隔符为止；若原文是 JSON 转义（\\）则还原。
  const std::size_t start = position;
  while (position < text.size()) {
    const wchar_t c = text[position];
    if (c == L',' || c == L'}' || c == L']' || IsAsciiWhitespace(c)) break;
    ++position;
  }
  const std::wstring raw = text.substr(start, position - start);
  if (raw.find(L"\\\\") == std::wstring::npos) return raw;
  std::wstring unescaped;
  for (std::size_t i = 0; i < raw.size(); ++i) {
    if (raw[i] == L'\\' && i + 1 < raw.size()) {
      unescaped.push_back(raw[i + 1]);
      ++i;
    } else {
      unescaped.push_back(raw[i]);
    }
  }
  return unescaped;
}

std::wstring GetTempDirectory() {
  wchar_t buffer[32768];
  buffer[0] = L'\0';
  const DWORD length = GetTempPathW(static_cast<DWORD>(_countof(buffer)), buffer);
  if (length > 0 && length < _countof(buffer)) return std::wstring(buffer, length);
  return std::wstring(L"C:\\Windows\\Temp\\");
}

std::wstring GetBaseDataDirectory() {
  wchar_t buffer[32768];
  buffer[0] = L'\0';
  const DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", buffer,
                                               static_cast<DWORD>(_countof(buffer)));
  if (length > 0 && length < _countof(buffer)) {
    return std::wstring(buffer, length) + L"\\gufa-float";
  }
  std::wstring temp = GetTempDirectory();
  if (!temp.empty() && temp.back() != L'\\' && temp.back() != L'/') temp.push_back(L'\\');
  return temp + L"gufa-float";
}

void EnsureDirectoryExists(const std::wstring& directory) {
  if (directory.empty()) return;
  std::wstring current;
  current.reserve(directory.size());
  for (std::size_t i = 0; i < directory.size(); ++i) {
    const wchar_t c = directory[i];
    current.push_back(c);
    if (c != L'\\' && c != L'/') continue;
    if (current.size() == 1) continue;                                // "\"
    if (current.size() == 3 && current[1] == L':') continue;          // "C:\"
    CreateDirectoryW(current.c_str(), nullptr);
  }
  CreateDirectoryW(directory.c_str(), nullptr);
}

void AppendLogLine(const std::wstring& message) {
  if (g_logPath.empty()) return;
  SYSTEMTIME now;
  GetLocalTime(&now);
  wchar_t stamp[80];
  _snwprintf_s(stamp, _countof(stamp), _TRUNCATE,
               L"[%04u-%02u-%02u %02u:%02u:%02u] ",
               static_cast<unsigned>(now.wYear), static_cast<unsigned>(now.wMonth),
               static_cast<unsigned>(now.wDay), static_cast<unsigned>(now.wHour),
               static_cast<unsigned>(now.wMinute), static_cast<unsigned>(now.wSecond));
  const std::wstring line = std::wstring(stamp) + message + L"\r\n";
  const std::string utf8 = WideToUtf8(line);
  HANDLE handle = CreateFileW(g_logPath.c_str(), FILE_APPEND_DATA,
                              FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                              nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (handle == INVALID_HANDLE_VALUE) return;
  DWORD written = 0;
  WriteFile(handle, utf8.data(), static_cast<DWORD>(utf8.size()), &written, nullptr);
  CloseHandle(handle);
}

void LogFmt(const wchar_t* format, ...) {
  wchar_t buffer[4096];
  buffer[0] = L'\0';
  va_list arguments;
  va_start(arguments, format);
  _vsnwprintf_s(buffer, _countof(buffer), _TRUNCATE, format, arguments);
  va_end(arguments);
  buffer[_countof(buffer) - 1] = L'\0';
  AppendLogLine(buffer);
}

void Log(const std::wstring& message) { AppendLogLine(message); }

void Log(const wchar_t* message) { AppendLogLine(std::wstring(message)); }

void InitLogging() {
  std::wstring directory = GetTempDirectory();
  if (!directory.empty() && directory.back() != L'\\' && directory.back() != L'/') {
    directory.push_back(L'\\');
  }
  g_logPath = directory + kLogFileName;
  HANDLE handle = CreateFileW(g_logPath.c_str(), GENERIC_READ,
                              FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                              nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (handle != INVALID_HANDLE_VALUE) {
    LARGE_INTEGER size;
    size.QuadPart = 0;
    if (GetFileSizeEx(handle, &size) && size.QuadPart > (4LL * 1024 * 1024)) {
      CloseHandle(handle);
      DeleteFileW(g_logPath.c_str());
    } else {
      CloseHandle(handle);
    }
  }
  LogFmt(L"==== gufa-float-win start pid=%lu build=win32 log=%s ====",
         static_cast<unsigned long>(GetCurrentProcessId()), g_logPath.c_str());
}

/* 崩溃 / terminate 兜底：至少把被隐藏的 DSH 主窗口恢复出来，避免「主窗口消失」。 */
void CrashRestoreWindows() {
  for (HWND hwnd : g_crashRestoreWindows) {
    if (hwnd != nullptr && IsWindow(hwnd)) ShowWindowAsync(hwnd, SW_SHOW);
  }
  g_crashRestoreWindows.clear();
}

LONG WINAPI CrashExceptionFilter(EXCEPTION_POINTERS* exceptionInfo) {
  (void)exceptionInfo;
  CrashRestoreWindows();
  return EXCEPTION_CONTINUE_SEARCH;
}

void CrashTerminateHandler() {
  CrashRestoreWindows();
  std::abort();
}

void InstallCrashHandlers() {
  SetUnhandledExceptionFilter(CrashExceptionFilter);
  std::set_terminate(CrashTerminateHandler);
}

#ifndef DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
#define DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 ((DPI_AWARENESS_CONTEXT)-4)
#endif

void EnableDpiAwareness() {
  HMODULE user32 = GetModuleHandleW(L"user32.dll");
  if (user32 != nullptr) {
    using SetProcessDpiAwarenessContextFn = BOOL (WINAPI *)(DPI_AWARENESS_CONTEXT);
    FARPROC address = GetProcAddress(user32, "SetProcessDpiAwarenessContext");
    if (address != nullptr) {
      SetProcessDpiAwarenessContextFn setContext =
          reinterpret_cast<SetProcessDpiAwarenessContextFn>(address);
      if (setContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) return;
    }
  }
  SetProcessDPIAware();
}

UINT WindowDpi(HWND hwnd) {
  UINT dpi = 0;
  if (hwnd != nullptr) dpi = GetDpiForWindow(hwnd);
  if (dpi == 0) dpi = GetDpiForSystem();
  if (dpi == 0) dpi = 96;
  return dpi;
}

int DpiScale(HWND hwnd, int value) {
  return MulDiv(value, static_cast<int>(WindowDpi(hwnd)), 96);
}

std::wstring GetWindowTitleText(HWND hwnd) {
  const int length = GetWindowTextLengthW(hwnd);
  if (length <= 0) return std::wstring();
  std::wstring text(static_cast<std::size_t>(length) + 1, L'\0');
  const int copied = GetWindowTextW(hwnd, &text[0], static_cast<int>(text.size()));
  if (copied <= 0) return std::wstring();
  text.resize(static_cast<std::size_t>(copied));
  return text;
}

bool ContainsNoCase(const std::wstring& haystack, const std::wstring& needle) {
  if (needle.empty()) return true;
  if (haystack.size() < needle.size()) return false;
  for (std::size_t i = 0; i + needle.size() <= haystack.size(); ++i) {
    bool match = true;
    for (std::size_t j = 0; j < needle.size(); ++j) {
      if (std::towlower(haystack[i + j]) != std::towlower(needle[j])) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

DWORD ParentProcessId(DWORD processId) {
  DWORD parent = 0;
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) return 0;
  PROCESSENTRY32W entry;
  entry.dwSize = sizeof(PROCESSENTRY32W);
  BOOL more = Process32FirstW(snapshot, &entry);
  while (more) {
    if (entry.th32ProcessID == processId) {
      parent = entry.th32ParentProcessID;
      break;
    }
    entry.dwSize = sizeof(PROCESSENTRY32W);
    more = Process32NextW(snapshot, &entry);
  }
  CloseHandle(snapshot);
  return parent;
}

std::wstring ProcessImagePath(DWORD processId) {
  if (processId == 0) return std::wstring();
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
  if (process == nullptr) return std::wstring();
  wchar_t buffer[32768];
  DWORD length = static_cast<DWORD>(_countof(buffer));
  const BOOL ok = QueryFullProcessImageNameW(process, 0, buffer, &length);
  CloseHandle(process);
  if (!ok || length == 0) return std::wstring();
  return std::wstring(buffer, length);
}

std::wstring FileNameOf(const std::wstring& path) {
  const std::size_t slash = path.find_last_of(L"\\/");
  return slash == std::wstring::npos ? path : path.substr(slash + 1);
}

void ForceForeground(HWND hwnd) {
  if (hwnd == nullptr || !IsWindow(hwnd)) return;
  if (IsIconic(hwnd)) {
    ShowWindowAsync(hwnd, SW_RESTORE);
  } else {
    ShowWindowAsync(hwnd, SW_SHOW);
  }
  DWORD foregroundThread = 0;
  HWND foreground = GetForegroundWindow();
  if (foreground != nullptr) foregroundThread = GetWindowThreadProcessId(foreground, nullptr);
  const DWORD currentThread = GetCurrentThreadId();
  bool attached = false;
  if (foregroundThread != 0 && foregroundThread != currentThread) {
    attached = AttachThreadInput(currentThread, foregroundThread, TRUE) != FALSE;
  }
  SetForegroundWindow(hwnd);
  BringWindowToTop(hwnd);
  if (attached) AttachThreadInput(currentThread, foregroundThread, FALSE);
}

/* 目标窗口的「可见」外框：Win10+ 的 GetWindowRect 含 DWM 阴影边距，优先用扩展框。 */
bool GetVisibleWindowRect(HWND hwnd, RECT* rect) {
  if (hwnd == nullptr || rect == nullptr) return false;
  RECT extended = {};
  const HRESULT hr = DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &extended,
                                           static_cast<DWORD>(sizeof(extended)));
  if (SUCCEEDED(hr) && extended.right > extended.left && extended.bottom > extended.top) {
    *rect = extended;
    return true;
  }
  RECT basic = {};
  if (!GetWindowRect(hwnd, &basic)) return false;
  if (basic.right <= basic.left || basic.bottom <= basic.top) return false;
  *rect = basic;
  return true;
}

bool RectsEqual(const RECT& left, const RECT& right) {
  return left.left == right.left && left.top == right.top &&
         left.right == right.right && left.bottom == right.bottom;
}

void ClampRectToVirtualScreen(RECT* rect) {
  if (rect == nullptr) return;
  const int virtualX = GetSystemMetrics(SM_XVIRTUALSCREEN);
  const int virtualY = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const int virtualWidth = GetSystemMetrics(SM_CXVIRTUALSCREEN);
  const int virtualHeight = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if (virtualWidth <= 0 || virtualHeight <= 0) return;
  int width = rect->right - rect->left;
  int height = rect->bottom - rect->top;
  if (width <= 0) width = 800;
  if (height <= 0) height = 600;
  if (rect->right <= virtualX) {
    rect->left = virtualX + 40;
    rect->right = rect->left + width;
  } else if (rect->left >= virtualX + virtualWidth) {
    rect->left = virtualX + virtualWidth - width - 40;
    rect->right = rect->left + width;
  }
  if (rect->bottom <= virtualY) {
    rect->top = virtualY + 40;
    rect->bottom = rect->top + height;
  } else if (rect->top >= virtualY + virtualHeight) {
    rect->top = virtualY + virtualHeight - height - 40;
    rect->bottom = rect->top + height;
  }
}

std::wstring AppendFloatQuery(const std::wstring& url) {
  if (url.empty()) return url;
  std::wstring result = url;
  result += (result.find(L'?') == std::wstring::npos) ? L"?gufa-float=1" : L"&gufa-float=1";
  return result;
}

std::wstring ExtractUrlHost(const std::wstring& url) {
  const std::size_t scheme = url.find(L"://");
  const std::size_t start = (scheme == std::wstring::npos) ? 0 : scheme + 3;
  std::size_t end = start;
  while (end < url.size()) {
    const wchar_t c = url[end];
    if (c == L'/' || c == L'?' || c == L'#' || c == L':') break;
    ++end;
  }
  if (end <= start) return std::wstring();
  return url.substr(start, end - start);
}

/* ────────────────────────────── payload ────────────────────────────── */

struct FloatPayload {
  std::wstring appUrl;
  std::wstring authUrl;
  std::wstring cookie;
  std::wstring controlPath;
  std::wstring build;
  std::wstring selftest;
  std::wstring followTitle;
  std::wstring ciProbeOut;
  bool hasFollow = false;
  DWORD followPid = 0;
  bool hasState = false;
  gufa::JsonValue state;
  int alpha = 0;
  DWORD ownerPid = 0;
  bool ciProbe = false;
  bool opaque = false;  // true = 强制 windowed（不透明）模式，调试用
};

DWORD ReadJsonPid(const gufa::JsonValue* value) {
  if (value == nullptr || !value->IsNumber()) return 0;
  const unsigned long long parsed = wcstoull(value->number.c_str(), nullptr, 10);
  if (parsed == 0 || parsed > 0xFFFFFFFFull) return 0;
  return static_cast<DWORD>(parsed);
}

bool ParsePayloadJson(const std::wstring& text, FloatPayload* payload, std::wstring* error) {
  gufa::JsonValue root;
  std::wstring parseError;
  if (!gufa::ParseJson(text, root, &parseError)) {
    *error = L"JSON 解析失败: " + parseError;
    return false;
  }
  if (!root.IsObject()) {
    *error = L"payload 根节点不是 JSON 对象";
    return false;
  }
  auto readString = [&root](const wchar_t* key, std::wstring* out) {
    const gufa::JsonValue* value = root.Find(key);
    if (value != nullptr && value->IsString()) *out = value->text;
  };
  readString(L"appUrl", &payload->appUrl);
  readString(L"authUrl", &payload->authUrl);
  readString(L"cookie", &payload->cookie);
  readString(L"controlPath", &payload->controlPath);
  readString(L"build", &payload->build);
  readString(L"selftest", &payload->selftest);
  readString(L"ciProbeOut", &payload->ciProbeOut);

  const gufa::JsonValue* follow = root.Find(L"follow");
  if (follow != nullptr && follow->IsObject()) {
    const DWORD pid = ReadJsonPid(follow->Find(L"pid"));
    if (pid != 0) {
      payload->hasFollow = true;
      payload->followPid = pid;
    }
    const gufa::JsonValue* title = follow->Find(L"title");
    if (title != nullptr && title->IsString()) payload->followTitle = title->text;
  }

  const gufa::JsonValue* state = root.Find(L"state");
  if (state != nullptr && state->IsObject()) {
    payload->hasState = true;
    payload->state = *state;
  }

  const gufa::JsonValue* alpha = root.Find(L"alpha");
  if (alpha != nullptr && alpha->IsNumber()) {
    const double raw = wcstod(alpha->number.c_str(), nullptr);
    if (raw >= 20.0 && raw <= 100.0) payload->alpha = static_cast<int>(raw);
  }

  payload->ownerPid = ReadJsonPid(root.Find(L"ownerPid"));

  const gufa::JsonValue* ciProbe = root.Find(L"ciProbe");
  if (ciProbe != nullptr && ciProbe->IsBool()) payload->ciProbe = ciProbe->boolean;

  const gufa::JsonValue* opaque = root.Find(L"opaque");
  if (opaque != nullptr && opaque->IsBool()) payload->opaque = opaque->boolean;

  return true;
}

bool ValidatePayload(const FloatPayload& payload, std::wstring* error) {
  if (payload.ciProbe) return true;
  if (payload.appUrl.empty()) {
    *error = L"payload 缺少 appUrl";
    return false;
  }
  if (payload.cookie.empty() && payload.authUrl.empty()) {
    *error = L"payload 既没有 cookie 也没有 authUrl";
    return false;
  }
  return true;
}

/* document-start 注入脚本：悬浮标记 + 主窗口状态（项目/UI/标签页/会话）。 */
std::wstring BuildBootstrapScript(const FloatPayload& payload) {
  std::wstring script = L"try{localStorage.setItem('gufa-code:float','1');";
  if (payload.hasState) {
    const std::wstring stateJson = gufa::SerializeJson(payload.state);
    if (!stateJson.empty()) {
      script += L"localStorage.setItem('gufa-code:float-state','";
      script += gufa::EscapeJsSingleQuoted(stateJson);
      script += L"');";
      const gufa::JsonValue* projectRoot = payload.state.Find(L"projectRoot");
      if (projectRoot != nullptr && projectRoot->IsString() && !projectRoot->text.empty()) {
        script += L"localStorage.setItem('gufa-code:project',JSON.stringify('";
        script += gufa::EscapeJsSingleQuoted(projectRoot->text);
        script += L"'));";
      }
      const gufa::JsonValue* ui = payload.state.Find(L"ui");
      if (ui != nullptr && ui->IsObject()) {
        script += L"localStorage.setItem('gufa-code:ui:v1','";
        script += gufa::EscapeJsSingleQuoted(gufa::SerializeJson(*ui));
        script += L"');";
      }
    }
  }
  script += L"}catch(e){}";
  return script;
}

/* ───────────────────────── DSH 主窗口查找/隐藏/恢复 ─────────────────────────
 *
 * 注意：payload.ownerPid 由 Host 传的是 process.ppid，可能是 explorer.exe 等
 * 启动器进程。绝不能「无脑隐藏 ownerPid 的所有窗口」（会把任务栏/桌面藏掉）。
 * 因此这里只按以下可信信号识别 DSH 主窗口：
 *   1. 窗口标题包含 "DeepSeek Harness"（协议首选）；
 *   2. 进程可执行文件名包含 "deepseek"（Electron 主进程的窗口）；
 *   3. 前两者都没找到时，退化为「本 helper 的直接父进程」（即 spawn 它的
 *      Host 进程）的可见顶层窗口——仅当父进程不是常见 shell/终端时。
 */

struct DshSearch {
  std::vector<HWND> found;
  std::vector<std::pair<DWORD, std::wstring>> processNameCache;
  bool collectByPid = false;
  DWORD pidFilter = 0;
};

std::wstring CachedProcessImageName(DshSearch* search, DWORD processId) {
  for (const auto& item : search->processNameCache) {
    if (item.first == processId) return item.second;
  }
  const std::wstring name = FileNameOf(ProcessImagePath(processId));
  search->processNameCache.emplace_back(processId, name);
  return name;
}

void AppendUniqueWindow(std::vector<HWND>* windows, HWND hwnd) {
  for (HWND existing : *windows) {
    if (existing == hwnd) return;
  }
  windows->push_back(hwnd);
}

bool IsShellLikeProcess(const std::wstring& imageName) {
  static const wchar_t* const kBlocked[] = {
      L"explorer.exe",  L"cmd.exe",      L"powershell.exe", L"pwsh.exe",
      L"conhost.exe",   L"node.exe",     L"wsl.exe",        L"bash.exe",
      L"mintty.exe",    L"windowsterminal.exe", L"wt.exe",  L"python.exe",
      L"python3.exe",   L"Code.exe",     L"devenv.exe",
  };
  for (const wchar_t* blocked : kBlocked) {
    if (ContainsNoCase(imageName, blocked)) return true;
  }
  return false;
}

BOOL CALLBACK DshEnumProc(HWND hwnd, LPARAM lParam) {
  DshSearch* search = reinterpret_cast<DshSearch*>(lParam);
  if (!IsWindowVisible(hwnd)) return TRUE;
  if (GetWindow(hwnd, GW_OWNER) != nullptr) return TRUE;
  const LONG_PTR extendedStyle = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
  if ((extendedStyle & WS_EX_TOOLWINDOW) != 0) return TRUE;
  DWORD processId = 0;
  GetWindowThreadProcessId(hwnd, &processId);
  if (processId == 0 || processId == GetCurrentProcessId()) return TRUE;
  const std::wstring title = GetWindowTitleText(hwnd);
  if (title.empty()) return TRUE;
  if (search->collectByPid) {
    if (processId == search->pidFilter) AppendUniqueWindow(&search->found, hwnd);
    return TRUE;
  }
  if (ContainsNoCase(title, L"deepseek harness")) {
    AppendUniqueWindow(&search->found, hwnd);
    return TRUE;
  }
  const std::wstring processName = CachedProcessImageName(search, processId);
  if (ContainsNoCase(processName, L"deepseek")) AppendUniqueWindow(&search->found, hwnd);
  return TRUE;
}

std::vector<HWND> FindDshWindows(DWORD ownerPid) {
  (void)ownerPid;  // ownerPid 仅作 Host 侧信息；见上方注释，不无脑用于隐藏。
  DshSearch search;
  EnumWindows(DshEnumProc, reinterpret_cast<LPARAM>(&search));
  if (search.found.empty()) {
    const DWORD directParent = ParentProcessId(GetCurrentProcessId());
    const std::wstring parentName = FileNameOf(ProcessImagePath(directParent));
    if (directParent != 0 && !IsShellLikeProcess(parentName)) {
      search.collectByPid = true;
      search.pidFilter = directParent;
      EnumWindows(DshEnumProc, reinterpret_cast<LPARAM>(&search));
    }
  }
  return search.found;
}

/* ────────────────────────────── 跟随目标窗口 ────────────────────────────── */

struct FollowSearch {
  DWORD processId = 0;
  std::wstring title;
  bool hasTitle = false;
  std::vector<HWND> candidates;
};

BOOL CALLBACK FollowEnumProc(HWND hwnd, LPARAM lParam) {
  FollowSearch* search = reinterpret_cast<FollowSearch*>(lParam);
  if (!IsWindowVisible(hwnd)) return TRUE;
  if (IsIconic(hwnd)) return TRUE;
  if (GetWindow(hwnd, GW_OWNER) != nullptr) return TRUE;
  DWORD processId = 0;
  GetWindowThreadProcessId(hwnd, &processId);
  if (processId != search->processId) return TRUE;
  const LONG_PTR extendedStyle = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
  if ((extendedStyle & WS_EX_TOOLWINDOW) != 0) return TRUE;
  const std::wstring title = GetWindowTitleText(hwnd);
  if (search->hasTitle && !ContainsNoCase(title, search->title)) return TRUE;
  RECT rect = {};
  if (!GetVisibleWindowRect(hwnd, &rect)) return TRUE;
  if (rect.right - rect.left < 120 || rect.bottom - rect.top < 80) return TRUE;
  search->candidates.push_back(hwnd);
  return TRUE;
}

HWND FindFollowWindowForProcess(DWORD processId, const std::wstring& title) {
  if (processId == 0) return nullptr;
  FollowSearch search;
  search.processId = processId;
  search.title = title;
  search.hasTitle = !title.empty();
  HWND foreground = GetForegroundWindow();
  if (foreground != nullptr) {
    DWORD foregroundProcess = 0;
    GetWindowThreadProcessId(foreground, &foregroundProcess);
    if (foregroundProcess == processId && IsWindowVisible(foreground) && !IsIconic(foreground) &&
        GetWindow(foreground, GW_OWNER) == nullptr) {
      RECT foregroundRect = {};
      if (GetVisibleWindowRect(foreground, &foregroundRect) &&
          foregroundRect.right - foregroundRect.left >= 120 &&
          foregroundRect.bottom - foregroundRect.top >= 80 &&
          (!search.hasTitle || ContainsNoCase(GetWindowTitleText(foreground), title))) {
        return foreground;
      }
    }
  }
  EnumWindows(FollowEnumProc, reinterpret_cast<LPARAM>(&search));
  if (search.candidates.empty()) return nullptr;
  HWND best = search.candidates.front();
  long long bestArea = -1;
  for (HWND candidate : search.candidates) {
    RECT rect = {};
    if (!GetVisibleWindowRect(candidate, &rect)) continue;
    const long long area = static_cast<long long>(rect.right - rect.left) *
                           static_cast<long long>(rect.bottom - rect.top);
    if (area > bestArea) {
      bestArea = area;
      best = candidate;
    }
  }
  return best;
}

/* 悬浮层右键菜单：windowed 模式由拖动条子窗口触发；composition 模式由主窗口
 * 顶部 22px 拖动区的 WM_NCRBUTTONUP 触发。命令统一 PostMessage 给主窗口处理。
 * 实现在 FloatApp 类之后（需要读取穿透/跟随状态）。 */
class FloatApp;
static void ShowFloatContextMenu(HWND owner, FloatApp* app);

/* ────────────────────────────── 悬浮层窗口 ────────────────────────────── */

class FloatApp {
 public:
  FloatApp() = default;
  ~FloatApp();
  FloatApp(const FloatApp&) = delete;
  FloatApp& operator=(const FloatApp&) = delete;

  bool ParseCommandLine(const std::wstring& jsonText);
  bool CreateMainWindow();
  void Start();
  int RunMessageLoop();
  void RequestExit(int exitCode);
  bool IsCiProbe() const { return payload_.ciProbe; }
  std::wstring CiProbeOutputPath() const { return payload_.ciProbeOut; }
  bool clickThroughEnabled() const { return clickThrough_; }
  bool followActive() const { return followActivated_ && followWindow_ != nullptr; }
  void ToggleClickThrough();
  void StopFollowing();
  /* 兜底：ciProbe 进程即将结束但还没写结果时，补写一个 ok:false 的探针文件。 */
  void EnsureCiProbeResultWritten(const std::wstring& reason);

  static LRESULT CALLBACK MainWndProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam);
  static LRESULT CALLBACK StripWndProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam);

 private:
  enum class Phase { Idle, Auth, App, Done };
  enum class HostingMode { Windowed, Composition };

  static FloatApp* FromWindow(HWND hwnd);
  static FloatApp* FromStripWindow(HWND stripWindow);
  static bool RegisterWindowClasses();

  LRESULT OnMainMessage(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam);
  LRESULT HandleNcHitTest(HWND hwnd, LPARAM lparam);
  void HandleMinMaxInfo(MINMAXINFO* info);

  bool CreateHostWindow(const RECT& rect, bool composition);
  bool CreateStripChildWindow();
  bool InitializeDCompDevice(std::wstring* error, HRESULT* errorCode);
  bool CreateDCompVisualTree(std::wstring* error, HRESULT* errorCode);
  void CleanupDCompVisualTree();
  bool FallbackToWindowed(const std::wstring& reason, HRESULT errorCode);
  void ArmRuntimeTimers();
  bool IsDragStripPoint(POINT clientPoint);
  bool OnCompositionMouseMessage(UINT message, WPARAM wparam, LPARAM lparam);

  void LayoutChildren();
  void RaiseStrip();
  void ResetWindowFrame();
  bool LoadSavedFrame(RECT* frame);
  void SaveFrameIfNeeded();
  std::wstring FrameFilePath();
  void ClampInitialRect(RECT* rect);

  void OnFollowTimer();
  void ApplyFollowFrame();
  void ApplyClickThrough();
  void OnHideDshTimer();
  void HideDshWindows();
  void RestoreDshWindows();

  void OnControlTimer();
  void DeleteControlFile();
  void OnTimer(UINT_PTR timerId);
  void KillAllTimers();

  void CreateWebViewEnvironment();
  void OnEnvironmentCreated(HRESULT errorCode, ICoreWebView2Environment* environment);
  void CreateWindowedController();
  void OnWindowedControllerCreated(HRESULT errorCode, ICoreWebView2Controller* controller);
  void OnCompositionControllerCreated(HRESULT errorCode,
                                      ICoreWebView2CompositionController* controller);
  void FinishControllerSetup();
  void ConfigureWebView();
  void StartScriptInjection();
  void OnScriptRegistered(HRESULT errorCode, LPCWSTR scriptId);
  void BeginNavigation();
  void InjectCookieThenNavigate(const std::wstring& targetUrl);
  void OnNavigationCompleted(bool success);
  void OnNewWindowRequested(ICoreWebView2NewWindowRequestedEventArgs* args);
  void OnProcessFailed(ICoreWebView2ProcessFailedEventArgs* args);
  void OnPageProbeTimer();
  void OnSelftestTimer();
  void HandleWebViewEnvironmentFailure(HRESULT errorCode);
  void WriteCiProbeOutput(bool ok, bool urlLoaded, const std::wstring& reason);
  void FinishProbe(bool loaded);
  void FinishProbeFailure(const std::wstring& reason);

  void DoGracefulExit();
  void OnWindowDestroyed();
  void CleanupWebView();

  HWND hwnd_ = nullptr;
  HWND strip_ = nullptr;
  FloatPayload payload_;
  HostingMode hostingMode_ = HostingMode::Windowed;
  ComPtr<IDCompositionDevice> dcompDevice_;
  ComPtr<IDCompositionTarget> dcompTarget_;
  ComPtr<IDCompositionVisual> dcompRootVisual_;
  ComPtr<IDCompositionVisual> dcompWebViewVisual_;
  ComPtr<ICoreWebView2CompositionController> compositionController_;
  HCURSOR webViewCursor_ = nullptr;
  bool started_ = false;
  bool exiting_ = false;
  bool controllerReady_ = false;
  bool ciProbeFinished_ = false;
  bool appLoaded_ = false;
  bool followActivated_ = false;
  int appNavAttempt_ = 0;
  int envAttempt_ = 0;
  int exitCode_ = 0;
  int followMissCount_ = 0;
  Phase phase_ = Phase::Idle;
  std::wstring userDataFolder_;
  std::wstring floatUrl_;
  ComPtr<ICoreWebView2Environment> environment_;
  ComPtr<ICoreWebView2Controller> controller_;
  ComPtr<ICoreWebView2> webView_;
  std::vector<HWND> hiddenDshWindows_;
  HWND followWindow_ = nullptr;
  RECT lastFollowRect_ = {};
  bool hasLastFollowRect_ = false;
  HANDLE hostProcess_ = nullptr;
  bool mouseLeaveTracked_ = false;
  bool mouseCaptured_ = false;
  bool suppressWindowDestroy_ = false;
  bool hideDshDone_ = false;
  bool clickThrough_ = false;
  bool clickThroughLayered_ = false;
  bool clickThroughHotkey_ = false;
};

namespace {
BOOL CALLBACK SetChildClickThrough(HWND child, LPARAM lparam) {
  const bool enable = lparam != 0;
  LONG_PTR exStyle = GetWindowLongPtrW(child, GWL_EXSTYLE);
  LONG_PTR next = enable ? (exStyle | WS_EX_TRANSPARENT)
                         : (exStyle & ~static_cast<LONG_PTR>(WS_EX_TRANSPARENT));
  if (next != exStyle) SetWindowLongPtrW(child, GWL_EXSTYLE, next);
  return TRUE;
}
}  // namespace

static void ShowFloatContextMenu(HWND owner, FloatApp* app) {
  if (owner == nullptr) return;
  HMENU menu = CreatePopupMenu();
  if (menu == nullptr) return;
  if (app != nullptr && app->followActive()) {
    AppendMenuW(menu, MF_STRING, kMenuStopFollow, L"停止跟随 App 窗口");
    AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
  }
  AppendMenuW(menu, static_cast<UINT>(MF_STRING) | ((app != nullptr && app->clickThroughEnabled()) ? static_cast<UINT>(MF_CHECKED) : 0U),
              kMenuToggleClickThrough, L"切换鼠标穿透（Ctrl+Alt+Shift+G）");
  AppendMenuW(menu, MF_STRING, kMenuResetFrame, L"重置窗口位置和大小");
  AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
  AppendMenuW(menu, MF_STRING, kMenuExit, L"退出摸鱼（恢复主窗口）");
  POINT cursor;
  GetCursorPos(&cursor);
  const int command = static_cast<int>(TrackPopupMenu(
      menu, TPM_RETURNCMD | TPM_RIGHTBUTTON, cursor.x, cursor.y, 0, owner, nullptr));
  DestroyMenu(menu);
  if (command != 0) {
    PostMessageW(owner, kMsgStripMenu, static_cast<WPARAM>(command), 0);
  }
}

FloatApp::~FloatApp() {
  if (hostProcess_ != nullptr) {
    CloseHandle(hostProcess_);
    hostProcess_ = nullptr;
  }
  CleanupWebView();
}

FloatApp* FloatApp::FromWindow(HWND hwnd) {
  if (hwnd == nullptr) return nullptr;
  return reinterpret_cast<FloatApp*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
}

FloatApp* FloatApp::FromStripWindow(HWND stripWindow) {
  if (stripWindow == nullptr) return nullptr;
  return FromWindow(GetParent(stripWindow));
}

LRESULT CALLBACK FloatApp::MainWndProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  if (message == WM_NCCREATE) {
    CREATESTRUCTW* createStruct = reinterpret_cast<CREATESTRUCTW*>(lparam);
    if (createStruct != nullptr) {
      SetWindowLongPtrW(hwnd, GWLP_USERDATA,
                        reinterpret_cast<LONG_PTR>(createStruct->lpCreateParams));
    }
  }
  FloatApp* app = FromWindow(hwnd);
  if (app == nullptr) return DefWindowProcW(hwnd, message, wparam, lparam);
  return app->OnMainMessage(hwnd, message, wparam, lparam);
}

LRESULT CALLBACK FloatApp::StripWndProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  FloatApp* app = FromStripWindow(hwnd);
  switch (message) {
    case WM_ERASEBKGND:
      return 1;
    case WM_PAINT: {
      PAINTSTRUCT paint = {};
      HDC dc = BeginPaint(hwnd, &paint);
      if (dc != nullptr) {
        RECT client = {};
        GetClientRect(hwnd, &client);
        HBRUSH background = CreateSolidBrush(kBackgroundColor);
        if (background != nullptr) {
          FillRect(dc, &client, background);
          DeleteObject(background);
        }
        RECT line = {client.left, client.bottom - 1, client.right, client.bottom};
        HBRUSH lineBrush = CreateSolidBrush(RGB(46, 50, 58));
        if (lineBrush != nullptr) {
          FillRect(dc, &line, lineBrush);
          DeleteObject(lineBrush);
        }
        const UINT dpi = WindowDpi(hwnd);
        HFONT font = CreateFontW(-MulDiv(12, static_cast<int>(dpi), 96), 0, 0, 0, FW_NORMAL,
                                 FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS,
                                 CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                                 DEFAULT_PITCH | FF_DONTCARE, L"Microsoft YaHei UI");
        HGDIOBJ oldFont = nullptr;
        if (font != nullptr) oldFont = SelectObject(dc, font);
        SetBkMode(dc, TRANSPARENT);
        SetTextColor(dc, RGB(205, 208, 214));
        const int closeWidth = MulDiv(48, static_cast<int>(dpi), 96);
        RECT textRect = client;
        textRect.left += MulDiv(10, static_cast<int>(dpi), 96);
        textRect.right -= closeWidth;
        DrawTextW(dc, L"古法编程 · 摸鱼中（拖动移动 · 右键菜单）", -1, &textRect,
                  DT_SINGLELINE | DT_VCENTER | DT_LEFT | DT_NOPREFIX | DT_END_ELLIPSIS);
        RECT closeRect = {client.right - closeWidth, client.top, client.right, client.bottom};
        SetTextColor(dc, RGB(150, 155, 165));
        DrawTextW(dc, L"✕", -1, &closeRect, DT_SINGLELINE | DT_VCENTER | DT_CENTER | DT_NOPREFIX);
        if (font != nullptr) {
          SelectObject(dc, oldFont);
          DeleteObject(font);
        }
        EndPaint(hwnd, &paint);
      }
      return 0;
    }
    case WM_LBUTTONDOWN: {
      const int x = GET_X_LPARAM(lparam);
      RECT client = {};
      GetClientRect(hwnd, &client);
      const int closeWidth = MulDiv(48, static_cast<int>(WindowDpi(hwnd)), 96);
      if (x >= client.right - closeWidth) {
        if (app != nullptr) app->RequestExit(0);
      } else {
        ReleaseCapture();
        SendMessageW(GetParent(hwnd), WM_NCLBUTTONDOWN, HTCAPTION, 0);
      }
      return 0;
    }
    case WM_RBUTTONUP:
      ShowFloatContextMenu(GetParent(hwnd), app);
      return 0;
    case WM_SETCURSOR:
      SetCursor(LoadCursorW(nullptr, IDC_ARROW));
      return TRUE;
    default:
      return DefWindowProcW(hwnd, message, wparam, lparam);
  }
}

bool FloatApp::RegisterWindowClasses() {
  static bool registered = false;
  if (registered) return true;

  WNDCLASSEXW mainClass = {};
  mainClass.cbSize = sizeof(mainClass);
  mainClass.style = CS_HREDRAW | CS_VREDRAW | CS_DBLCLKS;
  mainClass.lpfnWndProc = &FloatApp::MainWndProc;
  mainClass.hInstance = g_instance;
  mainClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  mainClass.hbrBackground = CreateSolidBrush(kBackgroundColor);
  mainClass.lpszClassName = kMainWindowClass;
  if (RegisterClassExW(&mainClass) == 0) {
    LogFmt(L"register-main-class-failed err=%lu", static_cast<unsigned long>(GetLastError()));
    return false;
  }

  WNDCLASSEXW stripClass = {};
  stripClass.cbSize = sizeof(stripClass);
  stripClass.style = CS_HREDRAW | CS_VREDRAW;
  stripClass.lpfnWndProc = &FloatApp::StripWndProc;
  stripClass.hInstance = g_instance;
  stripClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  stripClass.lpszClassName = kStripWindowClass;
  if (RegisterClassExW(&stripClass) == 0) {
    LogFmt(L"register-strip-class-failed err=%lu", static_cast<unsigned long>(GetLastError()));
    return false;
  }
  registered = true;
  return true;
}

bool FloatApp::ParseCommandLine(const std::wstring& jsonText) {
  std::wstring error;
  if (!ParsePayloadJson(jsonText, &payload_, &error)) {
    LogFmt(L"payload-parse-failed %s", error.c_str());
    return false;
  }
  if (!ValidatePayload(payload_, &error)) {
    LogFmt(L"payload-invalid %s", error.c_str());
    return false;
  }
  LogFmt(L"payload-ok ciProbe=%d opaque=%d follow=%d followPid=%lu ownerPid=%lu cookie=%s "
         L"authUrl=%s controlPath=%s build=%s alpha=%d hasState=%d",
         payload_.ciProbe ? 1 : 0, payload_.opaque ? 1 : 0, payload_.hasFollow ? 1 : 0,
         static_cast<unsigned long>(payload_.followPid),
         static_cast<unsigned long>(payload_.ownerPid),
         payload_.cookie.empty() ? L"no" : L"yes",
         payload_.authUrl.empty() ? L"no" : L"yes",
         payload_.controlPath.c_str(), payload_.build.c_str(), payload_.alpha,
         payload_.hasState ? 1 : 0);
  return true;
}

void FloatApp::ClampInitialRect(RECT* rect) {
  if (rect == nullptr) return;
  const int width = rect->right - rect->left;
  const int height = rect->bottom - rect->top;
  const int minimumWidth = DpiScale(nullptr, 320);
  const int minimumHeight = DpiScale(nullptr, 240);
  if (width < minimumWidth) rect->right = rect->left + minimumWidth;
  if (height < minimumHeight) rect->bottom = rect->top + minimumHeight;
  ClampRectToVirtualScreen(rect);
}

bool FloatApp::CreateMainWindow() {
  if (!RegisterWindowClasses()) return false;

  RECT initial = {};
  bool hasInitial = false;
  if (payload_.ciProbe) {
    initial = {0, 0, 800, 600};
    hasInitial = true;
  } else {
    if (payload_.hasFollow) {
      followWindow_ = FindFollowWindowForProcess(payload_.followPid, payload_.followTitle);
      if (followWindow_ != nullptr) {
        RECT targetRect = {};
        if (GetVisibleWindowRect(followWindow_, &targetRect)) {
          initial = targetRect;
          hasInitial = true;
        }
      }
    }
    if (!hasInitial && !payload_.hasFollow) {
      RECT saved = {};
      if (LoadSavedFrame(&saved)) {
        initial = saved;
        hasInitial = true;
      }
    }
    if (!hasInitial) {
      RECT workArea = {};
      if (!SystemParametersInfoW(SPI_GETWORKAREA, 0, &workArea, 0)) {
        workArea.left = 0;
        workArea.top = 0;
        workArea.right = GetSystemMetrics(SM_CXSCREEN);
        workArea.bottom = GetSystemMetrics(SM_CYSCREEN);
      }
      const UINT dpi = WindowDpi(nullptr);
      int width = MulDiv(1180, static_cast<int>(dpi), 96);
      int height = MulDiv(820, static_cast<int>(dpi), 96);
      const int workWidth = workArea.right - workArea.left;
      const int workHeight = workArea.bottom - workArea.top;
      if (workWidth > 0 && width > workWidth * 9 / 10) width = workWidth * 9 / 10;
      if (workHeight > 0 && height > workHeight * 9 / 10) height = workHeight * 9 / 10;
      initial.left = workArea.left + (workWidth - width) / 2;
      initial.top = workArea.top + (workHeight - height) / 2;
      initial.right = initial.left + width;
      initial.bottom = initial.top + height;
      hasInitial = true;
    }
    ClampInitialRect(&initial);
  }

  // 模式选择：默认尝试 DirectComposition 透明视觉托管；payload.opaque 可强制 windowed。
  bool useComposition = !payload_.opaque;
  if (payload_.opaque) {
    Log(L"transparent-mode=windowed reason=payload-opaque");
  } else {
    std::wstring error;
    HRESULT errorCode = E_FAIL;
    if (!InitializeDCompDevice(&error, &errorCode)) {
      LogFmt(L"transparent-mode=fallback reason=%s hr=0x%08lX", error.c_str(),
             static_cast<unsigned long>(errorCode));
      Log(L"transparent-mode=windowed");
      useComposition = false;
    }
  }

  if (!CreateHostWindow(initial, useComposition)) {
    if (!useComposition) return false;
    Log(L"transparent-mode=fallback reason=create-composition-window-failed");
    useComposition = false;
    Log(L"transparent-mode=windowed");
    if (!CreateHostWindow(initial, false)) return false;
  }

  if (useComposition) {
    std::wstring error;
    HRESULT errorCode = E_FAIL;
    if (!CreateDCompVisualTree(&error, &errorCode)) {
      // 窗口已按 composition 样式创建：重建为不透明 windowed 窗口继续。
      if (!FallbackToWindowed(error, errorCode)) return false;
    } else {
      Log(L"transparent-mode=composition");
    }
  }

  LayoutChildren();

  if (payload_.ciProbe) {
    ShowWindow(hwnd_, SW_HIDE);
  } else {
    ShowWindow(hwnd_, SW_SHOWNOACTIVATE);
    UpdateWindow(hwnd_);
  }

  LogFmt(L"main-window-ready rect=(%ld,%ld)-(%ld,%ld) dpi=%u ciProbe=%d composition=%d",
         static_cast<long>(initial.left), static_cast<long>(initial.top),
         static_cast<long>(initial.right), static_cast<long>(initial.bottom),
         WindowDpi(hwnd_), payload_.ciProbe ? 1 : 0,
         hostingMode_ == HostingMode::Composition ? 1 : 0);
  return true;
}

bool FloatApp::CreateHostWindow(const RECT& rect, bool composition) {
  hostingMode_ = composition ? HostingMode::Composition : HostingMode::Windowed;
  DWORD extendedStyle = WS_EX_TOPMOST | WS_EX_TOOLWINDOW;
  if (composition) extendedStyle |= WS_EX_NOREDIRECTIONBITMAP;
  const DWORD style = WS_POPUP | WS_THICKFRAME | WS_CLIPCHILDREN;
  hwnd_ = CreateWindowExW(extendedStyle, kMainWindowClass, kWindowTitle, style, rect.left,
                          rect.top, rect.right - rect.left, rect.bottom - rect.top, nullptr,
                          nullptr, g_instance, this);
  if (hwnd_ == nullptr) {
    LogFmt(L"create-main-window-failed composition=%d err=%lu", composition ? 1 : 0,
           static_cast<unsigned long>(GetLastError()));
    return false;
  }
  LogFmt(L"main-window-created composition=%d rect=(%ld,%ld)-(%ld,%ld) dpi=%u",
         composition ? 1 : 0, static_cast<long>(rect.left), static_cast<long>(rect.top),
         static_cast<long>(rect.right), static_cast<long>(rect.bottom), WindowDpi(hwnd_));
  if (RegisterHotKey(hwnd_, kHotkeyClickThrough, MOD_CONTROL | MOD_ALT | MOD_SHIFT, 'G')) {
    clickThroughHotkey_ = true;
    Log(L"click-through-hotkey=registered Ctrl+Alt+Shift+G");
  } else {
    LogFmt(L"click-through-hotkey=register-failed err=%lu", static_cast<unsigned long>(GetLastError()));
  }
  if (composition) return true;
  return CreateStripChildWindow();
}

bool FloatApp::CreateStripChildWindow() {
  if (hwnd_ == nullptr) return false;
  RECT client = {};
  GetClientRect(hwnd_, &client);
  const int stripHeight = DpiScale(hwnd_, kDragStripDip);
  strip_ = CreateWindowExW(0, kStripWindowClass, L"", WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS, 0,
                           0, client.right - client.left, stripHeight, hwnd_, nullptr, g_instance,
                           nullptr);
  if (strip_ == nullptr) {
    LogFmt(L"create-strip-window-failed err=%lu", static_cast<unsigned long>(GetLastError()));
    return false;
  }
  return true;
}

bool FloatApp::InitializeDCompDevice(std::wstring* error, HRESULT* errorCode) {
  dcompDevice_.Reset();
  const HRESULT hr = DCompositionCreateDevice2(
      nullptr, IID_PPV_ARGS(dcompDevice_.ReleaseAndGetAddressOf()));
  if (FAILED(hr) || dcompDevice_.Get() == nullptr) {
    if (error != nullptr) *error = L"dcomp-device hr=0x" + HexHresult(hr);
    if (errorCode != nullptr) *errorCode = hr;
    dcompDevice_.Reset();
    return false;
  }
  Log(L"dcomp-device-ready");
  return true;
}

bool FloatApp::CreateDCompVisualTree(std::wstring* error, HRESULT* errorCode) {
  auto fail = [error, errorCode](const wchar_t* step, HRESULT hr) {
    if (error != nullptr) *error = std::wstring(step) + L" hr=0x" + HexHresult(hr);
    if (errorCode != nullptr) *errorCode = hr;
    return false;
  };
  if (dcompDevice_.Get() == nullptr) return fail(L"dcomp-device-missing", E_FAIL);
  HRESULT hr = dcompDevice_->CreateTargetForHwnd(hwnd_, TRUE,
                                                 dcompTarget_.ReleaseAndGetAddressOf());
  if (FAILED(hr) || dcompTarget_.Get() == nullptr) return fail(L"dcomp-target", hr);
  hr = dcompDevice_->CreateVisual(dcompRootVisual_.ReleaseAndGetAddressOf());
  if (FAILED(hr) || dcompRootVisual_.Get() == nullptr) return fail(L"dcomp-root-visual", hr);
  hr = dcompTarget_->SetRoot(dcompRootVisual_.Get());
  if (FAILED(hr)) return fail(L"dcomp-set-root", hr);
  hr = dcompDevice_->CreateVisual(dcompWebViewVisual_.ReleaseAndGetAddressOf());
  if (FAILED(hr) || dcompWebViewVisual_.Get() == nullptr) return fail(L"dcomp-webview-visual", hr);
  hr = dcompRootVisual_->AddVisual(dcompWebViewVisual_.Get(), TRUE, nullptr);
  if (FAILED(hr)) return fail(L"dcomp-add-visual", hr);
  hr = dcompDevice_->Commit();
  if (FAILED(hr)) return fail(L"dcomp-commit", hr);
  Log(L"dcomp-visual-tree-ready");
  return true;
}

void FloatApp::CleanupDCompVisualTree() {
  if (compositionController_.Get() != nullptr) {
    compositionController_->put_RootVisualTarget(nullptr);
  }
  if (dcompWebViewVisual_.Get() != nullptr) dcompWebViewVisual_->RemoveAllVisuals();
  if (dcompRootVisual_.Get() != nullptr) dcompRootVisual_->RemoveAllVisuals();
  if (dcompTarget_.Get() != nullptr) dcompTarget_->SetRoot(nullptr);
  if (dcompDevice_.Get() != nullptr) dcompDevice_->Commit();
  dcompWebViewVisual_.Reset();
  dcompRootVisual_.Reset();
  dcompTarget_.Reset();
  dcompDevice_.Reset();
}

bool FloatApp::FallbackToWindowed(const std::wstring& reason, HRESULT errorCode) {
  LogFmt(L"transparent-mode=fallback reason=%s hr=0x%08lX", reason.c_str(),
         static_cast<unsigned long>(errorCode));
  if (exiting_) return false;
  if (hostingMode_ == HostingMode::Windowed && hwnd_ != nullptr) return true;

  CleanupDCompVisualTree();
  compositionController_.Reset();
  if (controller_.Get() != nullptr) {
    controller_->Close();
    controller_.Reset();
  }
  webView_.Reset();
  webViewCursor_ = nullptr;

  RECT rect = {};
  if (hwnd_ != nullptr && !GetWindowRect(hwnd_, &rect)) {
    rect = {0, 0, 800, 600};
  }
  const bool wasVisible = hwnd_ != nullptr && IsWindowVisible(hwnd_) != FALSE;
  if (hwnd_ != nullptr) {
    HWND oldWindow = hwnd_;
    hwnd_ = nullptr;
    strip_ = nullptr;
    suppressWindowDestroy_ = true;
    DestroyWindow(oldWindow);
  }
  if (!CreateHostWindow(rect, false)) {
    Log(L"fallback-create-windowed-failed");
    return false;
  }
  LayoutChildren();
  ArmRuntimeTimers();
  if (wasVisible && !payload_.ciProbe) {
    ShowWindow(hwnd_, SW_SHOWNOACTIVATE);
    UpdateWindow(hwnd_);
  }
  Log(L"transparent-mode=windowed");
  return true;
}

void FloatApp::ArmRuntimeTimers() {
  if (hwnd_ == nullptr || !started_) return;
  if (payload_.ciProbe) {
    SetTimer(hwnd_, kTimerProbeWatchdog, kProbeWatchdogMs, nullptr);
    if (!controllerReady_) {
      SetTimer(hwnd_, kTimerControllerWatchdog, kControllerWatchdogMs, nullptr);
    }
    return;
  }
  if (!controllerReady_) {
    SetTimer(hwnd_, kTimerControllerWatchdog, kControllerWatchdogMs, nullptr);
  }
  if (payload_.hasFollow) SetTimer(hwnd_, kTimerFollow, kFollowIntervalMs, nullptr);
  if (!hideDshDone_) SetTimer(hwnd_, kTimerHideDsh, 450, nullptr);
  SetTimer(hwnd_, kTimerControl, kControlIntervalMs, nullptr);
}

void FloatApp::Start() {
  if (started_) return;
  started_ = true;
  if (!payload_.ciProbe) {
    const DWORD directParent = ParentProcessId(GetCurrentProcessId());
    hostProcess_ = OpenProcess(SYNCHRONIZE, FALSE, directParent);
    if (hostProcess_ == nullptr) Log(L"host-process-handle-unavailable");
    if (payload_.hasFollow) {
      if (followWindow_ == nullptr) {
        followWindow_ = FindFollowWindowForProcess(payload_.followPid, payload_.followTitle);
      }
      if (followWindow_ != nullptr) ForceForeground(followWindow_);
    }
  }
  ArmRuntimeTimers();
  CreateWebViewEnvironment();
}

int FloatApp::RunMessageLoop() {
  MSG message;
  for (;;) {
    const int result = GetMessageW(&message, nullptr, 0, 0);
    if (result == 0) return static_cast<int>(message.wParam);
    if (result == -1) {
      LogFmt(L"getmessage-failed err=%lu", static_cast<unsigned long>(GetLastError()));
      return 0;
    }
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
}

void FloatApp::RequestExit(int exitCode) {
  exitCode_ = exitCode;
  if (exiting_) {
    LogFmt(L"request-exit-ignored code=%d", exitCode);
    return;
  }
  exiting_ = true;
  LogFmt(L"request-exit code=%d", exitCode);
  if (hwnd_ != nullptr) {
    PostMessageW(hwnd_, kMsgExitGraceful, 0, 0);
  } else {
    PostQuitMessage(exitCode);
  }
}

void FloatApp::LayoutChildren() {
  if (hwnd_ == nullptr) return;
  RECT client = {};
  if (!GetClientRect(hwnd_, &client)) return;
  const int width = client.right - client.left;
  const int height = client.bottom - client.top;
  if (hostingMode_ == HostingMode::Composition) {
    // visual hosting：没有子窗口拖动条（拖动条由主窗口顶部 22px 命中 HTCAPTION 实现，
    // 视觉上由网页 CSS 的 .gufa-overlay-root::before 画半透明条），WebView 铺满客户区。
    if (strip_ != nullptr) {
      DestroyWindow(strip_);
      strip_ = nullptr;
    }
    if (controller_.Get() != nullptr) {
      RECT bounds = {0, 0, width, height};
      controller_->put_Bounds(bounds);
    }
    return;
  }
  const int border = DpiScale(hwnd_, kResizeBorderDip);
  const int stripHeight = DpiScale(hwnd_, kDragStripDip);
  if (strip_ != nullptr) {
    SetWindowPos(strip_, HWND_TOP, 0, 0, width, stripHeight,
                 SWP_NOACTIVATE | SWP_SHOWWINDOW);
  }
  if (controller_.Get() != nullptr) {
    RECT bounds = {};
    bounds.left = border;
    bounds.top = 0;
    bounds.right = width - border;
    bounds.bottom = height - border;
    if (bounds.right - bounds.left < 100) bounds.right = bounds.left + 100;
    if (bounds.bottom - bounds.top < 100) bounds.bottom = bounds.top + 100;
    controller_->put_Bounds(bounds);
  }
}

void FloatApp::RaiseStrip() {
  if (strip_ == nullptr) return;
  SetWindowPos(strip_, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

bool FloatApp::IsDragStripPoint(POINT clientPoint) {
  if (hwnd_ == nullptr) return false;
  RECT client = {};
  if (!GetClientRect(hwnd_, &client)) return false;
  const int stripHeight = DpiScale(hwnd_, kDragStripDip);
  return clientPoint.y >= 0 && clientPoint.y < stripHeight;
}

/* visual hosting 没有子 HWND：把主窗口收到的鼠标消息转发给 WebView2。 */
bool FloatApp::OnCompositionMouseMessage(UINT message, WPARAM wparam, LPARAM lparam) {
  if (hostingMode_ != HostingMode::Composition || compositionController_.Get() == nullptr) {
    return false;
  }
  POINT point = {};
  bool hasPoint = true;
  switch (message) {
    case WM_MOUSEWHEEL:
    case WM_MOUSEHWHEEL:
      point.x = GET_X_LPARAM(lparam);
      point.y = GET_Y_LPARAM(lparam);
      ScreenToClient(hwnd_, &point);
      break;
    case WM_MOUSELEAVE:
      hasPoint = false;
      break;
    default:
      point.x = GET_X_LPARAM(lparam);
      point.y = GET_Y_LPARAM(lparam);
      break;
  }
  if (hasPoint && !mouseCaptured_) {
    RECT client = {};
    if (!GetClientRect(hwnd_, &client)) return false;
    if (!PtInRect(&client, point)) return false;
    if (IsDragStripPoint(point)) return false;  // 顶部拖动条不转发给网页
  }
  if (message == WM_MOUSEMOVE) {
    if (!mouseLeaveTracked_) {
      TRACKMOUSEEVENT track = {};
      track.cbSize = sizeof(track);
      track.dwFlags = TME_LEAVE;
      track.hwndTrack = hwnd_;
      if (TrackMouseEvent(&track) != FALSE) mouseLeaveTracked_ = true;
    }
  } else if (message == WM_MOUSELEAVE) {
    mouseLeaveTracked_ = false;
  }

  UINT32 mouseData = 0;
  switch (message) {
    case WM_MOUSEWHEEL:
    case WM_MOUSEHWHEEL:
      mouseData = static_cast<UINT32>(GET_WHEEL_DELTA_WPARAM(wparam));
      break;
    case WM_XBUTTONDOWN:
    case WM_XBUTTONUP:
    case WM_XBUTTONDBLCLK:
      mouseData = static_cast<UINT32>(GET_XBUTTON_WPARAM(wparam));
      break;
    default:
      break;
  }

  if (message == WM_LBUTTONDOWN || message == WM_MBUTTONDOWN || message == WM_RBUTTONDOWN ||
      message == WM_XBUTTONDOWN) {
    if (!mouseCaptured_) {
      mouseCaptured_ = true;
      SetCapture(hwnd_);
    }
  } else if (message == WM_LBUTTONUP || message == WM_MBUTTONUP || message == WM_RBUTTONUP ||
             message == WM_XBUTTONUP) {
    if (mouseCaptured_) {
      mouseCaptured_ = false;
      ReleaseCapture();
    }
  }

  const COREWEBVIEW2_MOUSE_EVENT_KIND kind =
      static_cast<COREWEBVIEW2_MOUSE_EVENT_KIND>(message);
  const COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS keys =
      static_cast<COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS>(GET_KEYSTATE_WPARAM(wparam));
  const HRESULT hr = compositionController_->SendMouseInput(kind, keys, mouseData, point);
  if (FAILED(hr)) {
    LogFmt(L"send-mouse-input-failed msg=0x%04X hr=0x%08lX", message,
           static_cast<unsigned long>(hr));
    return false;
  }
  return true;
}

LRESULT FloatApp::HandleNcHitTest(HWND hwnd, LPARAM lparam) {
  /* 鼠标穿透：双击/拖动都不要再命中本窗口，让点击落到下层 App。
     WS_EX_TRANSPARENT 在部分 WebView2/Composition 窗口上不生效，这里加 HTTRANSPARENT 兜底。 */
  if (clickThrough_) return HTTRANSPARENT;
  POINT point;
  point.x = GET_X_LPARAM(lparam);
  point.y = GET_Y_LPARAM(lparam);
  RECT windowRect = {};
  if (!GetWindowRect(hwnd, &windowRect)) return HTCLIENT;
  if (hostingMode_ == HostingMode::Composition) {
    POINT clientPoint = point;
    ScreenToClient(hwnd, &clientPoint);
    const int stripHeight = DpiScale(hwnd, kDragStripDip);
    if (clientPoint.y >= 0 && clientPoint.y < stripHeight) {
      // composition 模式没有子窗口拖动条：顶部 22 DIP 直接作为系统拖动区。
      return HTCAPTION;
    }
  }
  const int border = DpiScale(hwnd, kResizeBorderDip);
  const bool left = point.x < windowRect.left + border;
  const bool right = point.x >= windowRect.right - border;
  const bool top = point.y < windowRect.top + border;
  const bool bottom = point.y >= windowRect.bottom - border;
  if (left && top) return HTTOPLEFT;
  if (right && top) return HTTOPRIGHT;
  if (left && bottom) return HTBOTTOMLEFT;
  if (right && bottom) return HTBOTTOMRIGHT;
  if (left) return HTLEFT;
  if (right) return HTRIGHT;
  if (top) return HTTOP;
  if (bottom) return HTBOTTOM;
  return HTCLIENT;
}

void FloatApp::HandleMinMaxInfo(MINMAXINFO* info) {
  if (info == nullptr) return;
  const UINT dpi = WindowDpi(hwnd_);
  info->ptMinTrackSize.x = MulDiv(520, static_cast<int>(dpi), 96);
  info->ptMinTrackSize.y = MulDiv(360, static_cast<int>(dpi), 96);
}

std::wstring FloatApp::FrameFilePath() {
  const std::wstring base = GetBaseDataDirectory();
  if (base.empty()) return std::wstring();
  EnsureDirectoryExists(base);
  return base + L"\\frame.ini";
}

bool FloatApp::LoadSavedFrame(RECT* frame) {
  if (frame == nullptr) return false;
  const std::wstring path = FrameFilePath();
  if (path.empty()) return false;
  HANDLE handle = CreateFileW(path.c_str(), GENERIC_READ,
                              FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                              OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (handle == INVALID_HANDLE_VALUE) return false;
  char buffer[256] = {};
  DWORD read = 0;
  const BOOL ok = ReadFile(handle, buffer, static_cast<DWORD>(sizeof(buffer) - 1), &read, nullptr);
  CloseHandle(handle);
  if (!ok || read == 0) return false;
  long values[4] = {0, 0, 0, 0};
  if (sscanf_s(buffer, "%ld %ld %ld %ld", &values[0], &values[1], &values[2], &values[3]) != 4) {
    return false;
  }
  if (values[2] - values[0] < 200 || values[3] - values[1] < 150) return false;
  frame->left = values[0];
  frame->top = values[1];
  frame->right = values[2];
  frame->bottom = values[3];
  ClampRectToVirtualScreen(frame);
  return true;
}

void FloatApp::SaveFrameIfNeeded() {
  if (payload_.hasFollow || payload_.ciProbe || hwnd_ == nullptr) return;
  RECT rect = {};
  if (!GetWindowRect(hwnd_, &rect)) return;
  const std::wstring path = FrameFilePath();
  if (path.empty()) return;
  char buffer[256];
  const int length = sprintf_s(buffer, sizeof(buffer), "%ld %ld %ld %ld\n",
                               static_cast<long>(rect.left), static_cast<long>(rect.top),
                               static_cast<long>(rect.right), static_cast<long>(rect.bottom));
  if (length <= 0) return;
  HANDLE handle = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                              FILE_ATTRIBUTE_NORMAL, nullptr);
  if (handle == INVALID_HANDLE_VALUE) return;
  DWORD written = 0;
  WriteFile(handle, buffer, static_cast<DWORD>(length), &written, nullptr);
  CloseHandle(handle);
}

void FloatApp::ResetWindowFrame() {
  if (hwnd_ == nullptr) return;
  RECT workArea = {};
  if (!SystemParametersInfoW(SPI_GETWORKAREA, 0, &workArea, 0)) return;
  const UINT dpi = WindowDpi(hwnd_);
  int width = MulDiv(1180, static_cast<int>(dpi), 96);
  int height = MulDiv(820, static_cast<int>(dpi), 96);
  const int workWidth = workArea.right - workArea.left;
  const int workHeight = workArea.bottom - workArea.top;
  if (workWidth > 0 && width > workWidth * 9 / 10) width = workWidth * 9 / 10;
  if (workHeight > 0 && height > workHeight * 9 / 10) height = workHeight * 9 / 10;
  const int left = workArea.left + (workWidth - width) / 2;
  const int top = workArea.top + (workHeight - height) / 2;
  SetWindowPos(hwnd_, nullptr, left, top, width, height, SWP_NOZORDER | SWP_NOACTIVATE);
  LayoutChildren();
  Log(L"window-frame-reset");
}

void FloatApp::OnTimer(UINT_PTR timerId) {
  switch (timerId) {
    case kTimerFollow:
      OnFollowTimer();
      break;
    case kTimerControl:
      OnControlTimer();
      break;
    case kTimerHideDsh:
      KillTimer(hwnd_, kTimerHideDsh);
      hideDshDone_ = true;
      OnHideDshTimer();
      break;
    case kTimerControllerWatchdog:
      KillTimer(hwnd_, kTimerControllerWatchdog);
      if (!exiting_ && !controllerReady_) {
        Log(L"controller-watchdog-timeout");
        if (hostingMode_ == HostingMode::Composition) {
          if (FallbackToWindowed(L"composition-controller-timeout",
                                 HRESULT_FROM_WIN32(ERROR_TIMEOUT))) {
            CreateWindowedController();
          }
        }
      }
      break;
    case kTimerProbeTimeout:
      KillTimer(hwnd_, kTimerProbeTimeout);
      Log(L"ciprobe-timeout");
      FinishProbe(false);
      break;
    case kTimerProbeWatchdog:
      KillTimer(hwnd_, kTimerProbeWatchdog);
      Log(L"ciprobe-watchdog-timeout");
      FinishProbeFailure(L"ci-probe-watchdog-timeout");
      break;
    case kTimerPageProbe:
      KillTimer(hwnd_, kTimerPageProbe);
      OnPageProbeTimer();
      break;
    case kTimerSelftest:
      KillTimer(hwnd_, kTimerSelftest);
      OnSelftestTimer();
      break;
    case kTimerRetry:
      KillTimer(hwnd_, kTimerRetry);
      if (!exiting_ && webView_.Get() != nullptr && phase_ == Phase::App && !appLoaded_ &&
          !floatUrl_.empty()) {
        webView_->Navigate(floatUrl_.c_str());
      }
      break;
    default:
      break;
  }
}

void FloatApp::KillAllTimers() {
  if (hwnd_ == nullptr) return;
  KillTimer(hwnd_, kTimerFollow);
  KillTimer(hwnd_, kTimerControl);
  KillTimer(hwnd_, kTimerHideDsh);
  KillTimer(hwnd_, kTimerProbeTimeout);
  KillTimer(hwnd_, kTimerProbeWatchdog);
  KillTimer(hwnd_, kTimerSelftest);
  KillTimer(hwnd_, kTimerPageProbe);
  KillTimer(hwnd_, kTimerRetry);
  KillTimer(hwnd_, kTimerControllerWatchdog);
}

void FloatApp::OnFollowTimer() {
  if (exiting_) return;
  ApplyFollowFrame();
}

void FloatApp::ApplyFollowFrame() {
  if (exiting_ || !payload_.hasFollow) return;
  HWND target = FindFollowWindowForProcess(payload_.followPid, payload_.followTitle);
  if (target == nullptr) {
    followMissCount_ += 1;
    if (followMissCount_ == 1) Log(L"follow-target-missing keep-last-frame");
    if (followMissCount_ > 1200) {  // 约 5 分钟都找不到目标 → 降级为自由悬浮
      KillTimer(hwnd_, kTimerFollow);
      Log(L"follow-stopped-target-gone");
    }
    return;
  }
  followMissCount_ = 0;
  RECT targetRect = {};
  if (!GetVisibleWindowRect(target, &targetRect)) return;
  const int width = targetRect.right - targetRect.left;
  const int height = targetRect.bottom - targetRect.top;
  if (width < 80 || height < 60 || width > 20000 || height > 20000) return;
  if (!hasLastFollowRect_ || !RectsEqual(lastFollowRect_, targetRect)) {
    lastFollowRect_ = targetRect;
    hasLastFollowRect_ = true;
    SetWindowPos(hwnd_, HWND_TOPMOST, targetRect.left, targetRect.top, width, height,
                 SWP_NOACTIVATE | SWP_SHOWWINDOW);
    if (controller_.Get() != nullptr) controller_->NotifyParentWindowPositionChanged();
    RaiseStrip();
    LogFmt(L"follow-apply rect=(%ld,%ld)-(%ld,%ld)",
           static_cast<long>(targetRect.left), static_cast<long>(targetRect.top),
           static_cast<long>(targetRect.right), static_cast<long>(targetRect.bottom));
  }
  if (!followActivated_ || target != followWindow_) {
    followWindow_ = target;
    followActivated_ = true;
    ForceForeground(target);
    Log(L"follow-activated");
  }
}

void FloatApp::OnHideDshTimer() {
  HideDshWindows();
}

void FloatApp::HideDshWindows() {
  if (exiting_ || payload_.ciProbe) return;
  const std::vector<HWND> windows = FindDshWindows(payload_.ownerPid);
  std::size_t hiddenCount = 0;
  for (HWND hwnd : windows) {
    if (hwnd == nullptr || !IsWindow(hwnd) || !IsWindowVisible(hwnd)) continue;
    if (IsIconic(hwnd)) continue;  // 已经最小化：保持用户原状态，不改成 SW_HIDE
    ShowWindowAsync(hwnd, SW_HIDE);
    AppendUniqueWindow(&hiddenDshWindows_, hwnd);
    hiddenCount += 1;
  }
  g_crashRestoreWindows = hiddenDshWindows_;
  LogFmt(L"dsh-hidden hidden=%zu candidates=%zu", hiddenCount, windows.size());
  if (followWindow_ != nullptr && IsWindow(followWindow_)) ForceForeground(followWindow_);
}

void FloatApp::RestoreDshWindows() {
  if (!hiddenDshWindows_.empty()) {
    LogFmt(L"dsh-restore count=%zu", hiddenDshWindows_.size());
    for (HWND hwnd : hiddenDshWindows_) {
      if (hwnd != nullptr && IsWindow(hwnd)) ShowWindowAsync(hwnd, SW_SHOW);
    }
    hiddenDshWindows_.clear();
  }
  g_crashRestoreWindows.clear();
  const std::vector<HWND> windows = FindDshWindows(payload_.ownerPid);
  if (!windows.empty() && windows.front() != nullptr && IsWindow(windows.front())) {
    HWND target = windows.front();
    if (IsIconic(target)) ShowWindowAsync(target, SW_RESTORE);
    ShowWindowAsync(target, SW_SHOW);
    ForceForeground(target);
    LogFmt(L"dsh-restored focus=%p", reinterpret_cast<void*>(target));
  }
}

void FloatApp::DeleteControlFile() {
  if (payload_.controlPath.empty()) return;
  DeleteFileW(payload_.controlPath.c_str());
}

void FloatApp::OnControlTimer() {
  if (exiting_) return;
  RaiseStrip();
  if (!payload_.controlPath.empty()) {
    const DWORD attributes = GetFileAttributesW(payload_.controlPath.c_str());
    if (attributes != INVALID_FILE_ATTRIBUTES) {
      Log(L"control-file-detected");
      DeleteControlFile();
      RequestExit(0);
      return;
    }
  }
  if (hostProcess_ != nullptr && WaitForSingleObject(hostProcess_, 0) == WAIT_OBJECT_0) {
    Log(L"host-process-exited");
    RequestExit(0);
  }
}

/* ────────────────────────────── WebView2 ────────────────────────────── */

void FloatApp::CreateWebViewEnvironment() {
  if (exiting_) return;
  const std::wstring baseDirectory = GetBaseDataDirectory();
  EnsureDirectoryExists(baseDirectory);
  std::wstring profileName = L"webview2-";
  if (!payload_.build.empty()) {
    for (const wchar_t c : payload_.build) {
      if (std::iswalnum(c) || c == L'.' || c == L'-' || c == L'_') profileName.push_back(c);
    }
  }
  if (profileName.size() <= 10) profileName += L"default";
  if (envAttempt_ > 0) {
    profileName = L"webview2-retry-" + std::to_wstring(GetCurrentProcessId()) + L"-" +
                  std::to_wstring(GetTickCount64());
  }
  userDataFolder_ = baseDirectory.empty() ? std::wstring() : baseDirectory + L"\\" + profileName;
  if (!userDataFolder_.empty()) EnsureDirectoryExists(userDataFolder_);

  LogFmt(L"webview2-env-create attempt=%d folder=%s", envAttempt_, userDataFolder_.c_str());
  ComPtr<CoreWebView2EnvironmentOptions> options =
      Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
  if (options.Get() != nullptr) {
    // 显式把「要求的 Runtime 最低版本」降到 WebView2 GA 版本 86.0.616.0：
    // 本 helper 只用到 86~94 时代的 API，并且对 CookieManager / Controller2 做了
    // QueryInterface 降级；这样用户机器上的 Evergreen Runtime 稍旧也能启动，
    // 而不是直接创建失败（默认值等于 SDK 版本 129.x）。
    options->put_TargetCompatibleBrowserVersion(L"86.0.616.0");
    if (payload_.ciProbe && payload_.opaque) {
      // 仅 windowed 调试冒烟强制软件渲染；composition 路径保留默认，
      // WebView2 在无 GPU 的 runner 上会自行回退 WARP/SwiftShader。
      options->put_AdditionalBrowserArguments(L"--disable-gpu");
    }
  }
  const HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
      nullptr, userDataFolder_.empty() ? nullptr : userDataFolder_.c_str(),
      options.Get(),
      Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
          [this](HRESULT errorCode, ICoreWebView2Environment* environment) -> HRESULT {
            OnEnvironmentCreated(errorCode, environment);
            return S_OK;
          })
          .Get());
  if (FAILED(hr)) {
    LogFmt(L"webview2-env-call-failed hr=%08lX", static_cast<unsigned long>(hr));
    HandleWebViewEnvironmentFailure(hr);
  }
}

void FloatApp::OnEnvironmentCreated(HRESULT errorCode, ICoreWebView2Environment* environment) {
  if (exiting_) return;
  if (FAILED(errorCode) || environment == nullptr) {
    LogFmt(L"webview2-env-failed hr=%08lX", static_cast<unsigned long>(errorCode));
    if (envAttempt_ == 0) {
      envAttempt_ = 1;
      CreateWebViewEnvironment();
      return;
    }
    HandleWebViewEnvironmentFailure(errorCode);
    return;
  }
  // 回调传进来的是「借」的 COM 指针：显式 AddRef 后再由 ComPtr 接管，
  // 避免依赖 ComPtr 的隐式转换/模板推导（MSVC 下 &ComPtr 是 ComPtrRef）。
  environment_.Reset();
  if (environment != nullptr) {
    environment->AddRef();
    environment_.Attach(environment);
  }
  Log(L"webview2-env-ready");
  if (hostingMode_ == HostingMode::Composition) {
    ComPtr<ICoreWebView2Environment3> environment3;
    const HRESULT queryResult = environment_->QueryInterface(
        IID_PPV_ARGS(environment3.ReleaseAndGetAddressOf()));
    if (FAILED(queryResult) || environment3.Get() == nullptr) {
      LogFmt(L"composition-unavailable hr=0x%08lX", static_cast<unsigned long>(queryResult));
      if (FallbackToWindowed(L"environment3-unavailable", queryResult)) {
        CreateWindowedController();
      }
      return;
    }
    const HRESULT createResult = environment3->CreateCoreWebView2CompositionController(
        hwnd_,
        Callback<ICoreWebView2CreateCoreWebView2CompositionControllerCompletedHandler>(
            [this](HRESULT result,
                   ICoreWebView2CompositionController* compositionController) -> HRESULT {
              OnCompositionControllerCreated(result, compositionController);
              return S_OK;
            })
            .Get());
    if (FAILED(createResult)) {
      LogFmt(L"create-composition-controller-call-failed hr=0x%08lX",
             static_cast<unsigned long>(createResult));
      if (FallbackToWindowed(L"composition-controller-call", createResult)) {
        CreateWindowedController();
      }
    }
    return;
  }
  CreateWindowedController();
}

void FloatApp::CreateWindowedController() {
  if (exiting_ || hwnd_ == nullptr || environment_.Get() == nullptr) return;
  const HRESULT hr = environment_->CreateCoreWebView2Controller(
      hwnd_,
      Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
          [this](HRESULT controllerError, ICoreWebView2Controller* controller) -> HRESULT {
            OnWindowedControllerCreated(controllerError, controller);
            return S_OK;
          })
          .Get());
  if (FAILED(hr)) {
    LogFmt(L"create-controller-call-failed hr=%08lX", static_cast<unsigned long>(hr));
    HandleWebViewEnvironmentFailure(hr);
  }
}

void FloatApp::OnWindowedControllerCreated(HRESULT errorCode,
                                           ICoreWebView2Controller* controller) {
  if (exiting_) return;
  if (hostingMode_ != HostingMode::Windowed) {
    Log(L"windowed-controller-late-ignored");
    return;
  }
  if (FAILED(errorCode) || controller == nullptr) {
    LogFmt(L"webview2-controller-failed hr=%08lX", static_cast<unsigned long>(errorCode));
    HandleWebViewEnvironmentFailure(errorCode);
    return;
  }
  controller_.Reset();
  if (controller != nullptr) {
    controller->AddRef();
    controller_.Attach(controller);
  }
  FinishControllerSetup();
}

void FloatApp::OnCompositionControllerCreated(
    HRESULT errorCode, ICoreWebView2CompositionController* compositionController) {
  if (exiting_) return;
  if (hostingMode_ != HostingMode::Composition) {
    // 例如 controller 看门狗已回退到 windowed 后，这个迟到的异步回调必须忽略。
    Log(L"composition-controller-late-ignored");
    return;
  }
  if (FAILED(errorCode) || compositionController == nullptr) {
    LogFmt(L"webview2-composition-controller-failed hr=0x%08lX",
           static_cast<unsigned long>(errorCode));
    if (FallbackToWindowed(L"composition-controller", errorCode)) {
      CreateWindowedController();
    }
    return;
  }
  compositionController_.Reset();
  compositionController->AddRef();
  compositionController_.Attach(compositionController);

  ComPtr<ICoreWebView2Controller> coreController;
  const HRESULT queryResult = compositionController_->QueryInterface(
      IID_PPV_ARGS(coreController.ReleaseAndGetAddressOf()));
  if (FAILED(queryResult) || coreController.Get() == nullptr) {
    LogFmt(L"composition-controller-query-failed hr=0x%08lX",
           static_cast<unsigned long>(queryResult));
    if (FallbackToWindowed(L"composition-controller-query", queryResult)) {
      CreateWindowedController();
    }
    return;
  }
  controller_.Reset();
  coreController->AddRef();
  controller_.Attach(coreController.Get());

  if (dcompWebViewVisual_.Get() == nullptr) {
    Log(L"root-visual-target-missing-visual");
    if (FallbackToWindowed(L"root-visual-target-missing-visual", E_POINTER)) {
      CreateWindowedController();
    }
    return;
  }
  const HRESULT visualResult =
      compositionController_->put_RootVisualTarget(dcompWebViewVisual_.Get());
  if (FAILED(visualResult)) {
    LogFmt(L"root-visual-target-failed hr=0x%08lX", static_cast<unsigned long>(visualResult));
    if (FallbackToWindowed(L"root-visual-target", visualResult)) {
      CreateWindowedController();
    }
    return;
  }
  if (dcompDevice_.Get() != nullptr) dcompDevice_->Commit();
  Log(L"transparent-mode=composition");
  FinishControllerSetup();
}

void FloatApp::FinishControllerSetup() {
  if (exiting_ || controller_.Get() == nullptr) return;
  const HRESULT hr = controller_->get_CoreWebView2(webView_.GetAddressOf());
  if (FAILED(hr) || webView_.Get() == nullptr) {
    LogFmt(L"get-core-webview-failed hr=%08lX", static_cast<unsigned long>(hr));
    HandleWebViewEnvironmentFailure(hr);
    return;
  }
  controllerReady_ = true;
  Log(L"webview2-controller-ready");
  if (clickThrough_) {
    ApplyClickThrough();
  }
  ConfigureWebView();
  LayoutChildren();
  StartScriptInjection();
}

void FloatApp::ConfigureWebView() {
  if (webView_.Get() == nullptr) return;
  ComPtr<ICoreWebView2Settings> settings;
  if (SUCCEEDED(webView_->get_Settings(settings.GetAddressOf())) &&
      settings.Get() != nullptr) {
    settings->put_IsStatusBarEnabled(FALSE);
    settings->put_AreDevToolsEnabled(FALSE);
    settings->put_IsZoomControlEnabled(FALSE);
  }
  ComPtr<ICoreWebView2Controller2> controller2;
  if (SUCCEEDED(controller_->QueryInterface(IID_PPV_ARGS(controller2.GetAddressOf()))) &&
      controller2.Get() != nullptr) {
    COREWEBVIEW2_COLOR background;
    if (hostingMode_ == HostingMode::Composition) {
      // 视觉托管：WebView 背景全透明，才可能透出 DComp 目标后面的桌面/下层窗口。
      background.A = 0;
      background.R = 0;
      background.G = 0;
      background.B = 0;
    } else {
      // windowed hosting 不支持逐像素透明：用与网页一致的深色不透明底。
      background.A = 255;
      background.R = 13;
      background.G = 15;
      background.B = 19;
    }
    controller2->put_DefaultBackgroundColor(background);
  }
  controller_->put_IsVisible(TRUE);

  if (hostingMode_ == HostingMode::Composition) {
    if (webViewCursor_ == nullptr) webViewCursor_ = LoadCursorW(nullptr, IDC_ARROW);
    EventRegistrationToken cursorToken = {};
    if (compositionController_.Get() != nullptr) {
      compositionController_->add_CursorChanged(
          Callback<ICoreWebView2CursorChangedEventHandler>(
              [this](ICoreWebView2CompositionController* sender, IUnknown* args) -> HRESULT {
                (void)args;
                if (sender == nullptr || hwnd_ == nullptr) return S_OK;
                HCURSOR cursor = nullptr;
                if (SUCCEEDED(sender->get_Cursor(&cursor)) && cursor != nullptr) {
                  webViewCursor_ = cursor;
                  POINT point = {};
                  if (GetCursorPos(&point)) {
                    ScreenToClient(hwnd_, &point);
                    RECT client = {};
                    if (GetClientRect(hwnd_, &client) && PtInRect(&client, point) &&
                        !IsDragStripPoint(point)) {
                      SetCursor(cursor);
                    }
                  }
                }
                return S_OK;
              })
              .Get(),
          &cursorToken);
    }
  }

  EventRegistrationToken token = {};
  webView_->add_NavigationCompleted(
      Callback<ICoreWebView2NavigationCompletedEventHandler>(
          [this](ICoreWebView2* sender, ICoreWebView2NavigationCompletedEventArgs* args)
              -> HRESULT {
            (void)sender;
            BOOL success = FALSE;
            if (args != nullptr) args->get_IsSuccess(&success);
            OnNavigationCompleted(success != FALSE);
            return S_OK;
          })
          .Get(),
      &token);
  webView_->add_NewWindowRequested(
      Callback<ICoreWebView2NewWindowRequestedEventHandler>(
          [this](ICoreWebView2* sender, ICoreWebView2NewWindowRequestedEventArgs* args)
              -> HRESULT {
            (void)sender;
            OnNewWindowRequested(args);
            return S_OK;
          })
          .Get(),
      &token);
  webView_->add_ProcessFailed(
      Callback<ICoreWebView2ProcessFailedEventHandler>(
          [this](ICoreWebView2* sender, ICoreWebView2ProcessFailedEventArgs* args) -> HRESULT {
            (void)sender;
            OnProcessFailed(args);
            return S_OK;
          })
          .Get(),
      &token);
}

void FloatApp::StartScriptInjection() {
  if (webView_.Get() == nullptr) return;
  const std::wstring script = BuildBootstrapScript(payload_);
  LogFmt(L"inject-script length=%zu", script.size());
  const HRESULT hr = webView_->AddScriptToExecuteOnDocumentCreated(
      script.c_str(),
      Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
          [this](HRESULT errorCode, LPCWSTR scriptId) -> HRESULT {
            (void)scriptId;
            OnScriptRegistered(errorCode, scriptId);
            return S_OK;
          })
          .Get());
  if (FAILED(hr)) {
    LogFmt(L"inject-script-call-failed hr=%08lX", static_cast<unsigned long>(hr));
    OnScriptRegistered(hr, nullptr);
  }
}

void FloatApp::OnScriptRegistered(HRESULT errorCode, LPCWSTR scriptId) {
  (void)scriptId;
  if (exiting_) return;
  if (FAILED(errorCode)) {
    LogFmt(L"inject-script-failed hr=%08lX", static_cast<unsigned long>(errorCode));
  } else {
    Log(L"inject-script-ready");
  }
  BeginNavigation();
}

void FloatApp::BeginNavigation() {
  if (exiting_ || webView_.Get() == nullptr) return;
  floatUrl_ = AppendFloatQuery(payload_.appUrl);
  if (payload_.ciProbe) {
    Log(L"ciprobe-navigate");
    if (!payload_.appUrl.empty()) {
      webView_->Navigate(payload_.appUrl.c_str());
    } else {
      webView_->NavigateToString(
          L"<html><head><meta charset=\"utf-8\"><title>gufa-float-ci</title></head>"
          L"<body>gufa-float ciProbe</body></html>");
    }
    SetTimer(hwnd_, kTimerProbeTimeout, kProbeTimeoutMs, nullptr);
    return;
  }
  if (!payload_.cookie.empty()) {
    InjectCookieThenNavigate(floatUrl_);
    return;
  }
  if (!payload_.authUrl.empty()) {
    phase_ = Phase::Auth;
    Log(L"navigate-auth");
    webView_->Navigate(payload_.authUrl.c_str());
    return;
  }
  Log(L"no-url-configured");
  RequestExit(2);
}

void FloatApp::InjectCookieThenNavigate(const std::wstring& targetUrl) {
  bool injected = false;
  do {
    const std::size_t separator = payload_.cookie.find(L'=');
    if (separator == std::wstring::npos) break;
    const std::wstring name = payload_.cookie.substr(0, separator);
    const std::wstring value = payload_.cookie.substr(separator + 1);
    if (name.empty() || value.empty()) break;
    const std::wstring host = ExtractUrlHost(payload_.appUrl);
    if (host.empty()) break;
    ComPtr<ICoreWebView2_2> webView2;
    if (FAILED(webView_->QueryInterface(IID_PPV_ARGS(webView2.GetAddressOf()))) ||
        webView2.Get() == nullptr) {
      break;
    }
    ComPtr<ICoreWebView2CookieManager> cookieManager;
    if (FAILED(webView2->get_CookieManager(cookieManager.GetAddressOf())) ||
        cookieManager.Get() == nullptr) {
      break;
    }
    ComPtr<ICoreWebView2Cookie> cookie;
    if (FAILED(cookieManager->CreateCookie(name.c_str(), value.c_str(), host.c_str(), L"/",
                                           cookie.GetAddressOf())) ||
        cookie.Get() == nullptr) {
      break;
    }
    cookie->put_Expires(static_cast<double>(static_cast<long long>(std::time(nullptr)) + 86400));
    if (FAILED(cookieManager->AddOrUpdateCookie(cookie.Get()))) break;
    injected = true;
  } while (false);
  Log(injected ? L"cookie-injected" : L"cookie-injection-failed");
  phase_ = Phase::App;
  appNavAttempt_ = 1;
  webView_->Navigate(targetUrl.c_str());
}

void FloatApp::OnNavigationCompleted(bool success) {
  if (exiting_) return;
  LogFmt(L"navigation-completed success=%d phase=%d", success ? 1 : 0,
         static_cast<int>(phase_));
  if (payload_.ciProbe) {
    KillTimer(hwnd_, kTimerProbeTimeout);
    FinishProbe(success);
    return;
  }
  if (phase_ == Phase::Auth) {
    phase_ = Phase::App;
    appNavAttempt_ = 1;
    Log(L"navigate-app");
    webView_->Navigate(floatUrl_.c_str());
    return;
  }
  if (phase_ == Phase::App) {
    if (success) {
      phase_ = Phase::Done;
      appLoaded_ = true;
      Log(L"app-loaded");
      SetTimer(hwnd_, kTimerPageProbe, 6000, nullptr);
    } else if (appNavAttempt_ < 2) {
      appNavAttempt_ += 1;
      Log(L"app-load-failed retry");
      SetTimer(hwnd_, kTimerRetry, 1500, nullptr);
    } else {
      Log(L"app-load-failed giving-up");
    }
  }
}

void FloatApp::OnNewWindowRequested(ICoreWebView2NewWindowRequestedEventArgs* args) {
  if (args == nullptr) return;
  LPWSTR uri = nullptr;
  if (SUCCEEDED(args->get_Uri(&uri)) && uri != nullptr) {
    LogFmt(L"new-window-requested uri=%s", uri);
    ShellExecuteW(nullptr, L"open", uri, nullptr, nullptr, SW_SHOWNORMAL);
    CoTaskMemFree(uri);
  }
  args->put_Handled(TRUE);
}

void FloatApp::OnProcessFailed(ICoreWebView2ProcessFailedEventArgs* args) {
  if (args == nullptr) return;
  COREWEBVIEW2_PROCESS_FAILED_KIND kind = COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED;
  args->get_ProcessFailedKind(&kind);
  LogFmt(L"webview2-process-failed kind=%d", static_cast<int>(kind));
  if (kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED) RequestExit(4);
}

void FloatApp::OnPageProbeTimer() {
  if (webView_.Get() == nullptr) return;
  static const wchar_t kProbe[] =
      L"(function(){try{return JSON.stringify({href:location.href,title:document.title,"
      L"float:localStorage.getItem('gufa-code:float'),"
      L"root:!!document.querySelector('.gufa-overlay-root'),"
      L"body:(document.body?document.body.innerText:'').slice(0,160)});}"
      L"catch(e){return 'probe-error:'+e;}})()";
  webView_->ExecuteScript(
      kProbe,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [](HRESULT errorCode, LPCWSTR result) -> HRESULT {
            if (SUCCEEDED(errorCode) && result != nullptr) {
              LogFmt(L"page-probe %s", result);
            }
            return S_OK;
          })
          .Get());
  if (!payload_.selftest.empty()) SetTimer(hwnd_, kTimerSelftest, 3000, nullptr);
}

void FloatApp::OnSelftestTimer() {
  if (webView_.Get() == nullptr || payload_.selftest.empty()) return;
  webView_->ExecuteScript(
      payload_.selftest.c_str(),
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [](HRESULT errorCode, LPCWSTR result) -> HRESULT {
            if (FAILED(errorCode)) {
              LogFmt(L"selftest-error hr=%08lX", static_cast<unsigned long>(errorCode));
            } else {
              LogFmt(L"selftest-result %s", result != nullptr ? result : L"(null)");
            }
            return S_OK;
          })
          .Get());
}

void FloatApp::WriteCiProbeOutput(bool ok, bool urlLoaded, const std::wstring& reason) {
  const std::wstring line = BuildCiProbeLine(ok, urlLoaded, reason);
  WriteStdout(line + L"\n");
  LogFmt(L"ciprobe-result ok=%d urlLoaded=%d reason=%s", ok ? 1 : 0, urlLoaded ? 1 : 0,
         reason.c_str());
  if (payload_.ciProbeOut.empty()) {
    Log(L"ciprobe-out path-empty");
    return;
  }
  const bool wrote = WriteFileUtf8(payload_.ciProbeOut, line + L"\n");
  LogFmt(L"ciprobe-out file=%s wrote=%d", payload_.ciProbeOut.c_str(), wrote ? 1 : 0);
}

void FloatApp::EnsureCiProbeResultWritten(const std::wstring& reason) {
  if (!payload_.ciProbe || ciProbeFinished_) return;
  ciProbeFinished_ = true;
  LogFmt(L"ciprobe-result-missing reason=%s", reason.c_str());
  WriteCiProbeOutput(false, false, reason);
}

void FloatApp::FinishProbe(bool loaded) {
  if (ciProbeFinished_) return;
  ciProbeFinished_ = true;
  LogFmt(L"ciprobe-finished loaded=%d", loaded ? 1 : 0);
  WriteCiProbeOutput(true, loaded, std::wstring());
  RequestExit(0);
}

void FloatApp::FinishProbeFailure(const std::wstring& reason) {
  if (ciProbeFinished_) return;
  ciProbeFinished_ = true;
  LogFmt(L"ciprobe-failed reason=%s", reason.c_str());
  WriteCiProbeOutput(false, false, reason);
  RequestExit(1);
}

void FloatApp::HandleWebViewEnvironmentFailure(HRESULT errorCode) {
  if (payload_.ciProbe) {
    FinishProbeFailure(L"webview2-environment-failed hr=0x" + HexHresult(errorCode));
    return;
  }
  if (exiting_) return;
  LogFmt(L"webview2-unavailable hr=%08lX", static_cast<unsigned long>(errorCode));
  MessageBoxW(nullptr,
              L"无法启动 WebView2。\n\n"
              L"请确认已安装 Microsoft Edge WebView2 Runtime：\n"
              L"https://go.microsoft.com/fwlink/p/?LinkId=2124703\n\n"
              L"（Windows 10/11 通常已自带；安装后重试「摸鱼」。）",
              L"古法编程悬浮层", MB_ICONERROR | MB_OK);
  RequestExit(1);
}

void FloatApp::CleanupWebView() {
  CleanupDCompVisualTree();  // 内含 compositionController_->put_RootVisualTarget(nullptr)
  compositionController_.Reset();
  webViewCursor_ = nullptr;
  if (webView_.Get() != nullptr) webView_.Reset();
  if (controller_.Get() != nullptr) {
    controller_->put_IsVisible(FALSE);
    controller_->Close();
    controller_.Reset();
  }
  environment_.Reset();
}

void FloatApp::ToggleClickThrough() {
  clickThrough_ = !clickThrough_;
  ApplyClickThrough();
}

void FloatApp::ApplyClickThrough() {
  if (hwnd_ == nullptr) return;
  LONG_PTR exStyle = GetWindowLongPtrW(hwnd_, GWL_EXSTYLE);
  LONG_PTR next = clickThrough_ ? (exStyle | WS_EX_TRANSPARENT)
                                : (exStyle & ~static_cast<LONG_PTR>(WS_EX_TRANSPARENT));
  /* windowed 模式需要 layered 才能让点击稳定穿透到下层窗口；composition 模式
     使用 WS_EX_NOREDIRECTIONBITMAP，不能叠加 layered。 */
  if (hostingMode_ == HostingMode::Windowed) {
    if (clickThrough_) {
      if ((next & WS_EX_LAYERED) == 0) {
        next |= WS_EX_LAYERED;
        clickThroughLayered_ = true;
        SetLayeredWindowAttributes(hwnd_, 0, 255, LWA_ALPHA);
      }
    } else if (clickThroughLayered_) {
      next &= ~static_cast<LONG_PTR>(WS_EX_LAYERED);
      clickThroughLayered_ = false;
    }
  }
  if (next != exStyle) {
    SetWindowLongPtrW(hwnd_, GWL_EXSTYLE, next);
    SetWindowPos(hwnd_, nullptr, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
  }
  EnumChildWindows(hwnd_, SetChildClickThrough, clickThrough_ ? 1 : 0);
  LogFmt(L"click-through=%d", clickThrough_ ? 1 : 0);
}

void FloatApp::StopFollowing() {
  if (!followActivated_ && followWindow_ == nullptr && !payload_.hasFollow) return;
  payload_.hasFollow = false;
  followActivated_ = false;
  followWindow_ = nullptr;
  followMissCount_ = 0;
  if (hwnd_ != nullptr) KillTimer(hwnd_, kTimerFollow);
  Log(L"follow-stopped-by-menu");
}

void FloatApp::DoGracefulExit() {
  if (hwnd_ == nullptr) {
    PostQuitMessage(exitCode_);
    return;
  }
  Log(L"graceful-exit-start");
  if (clickThroughHotkey_ && hwnd_ != nullptr) {
    UnregisterHotKey(hwnd_, kHotkeyClickThrough);
    clickThroughHotkey_ = false;
  }
  KillAllTimers();
  RestoreDshWindows();
  DeleteControlFile();
  SaveFrameIfNeeded();
  CleanupWebView();
  HWND window = hwnd_;
  hwnd_ = nullptr;
  if (strip_ != nullptr) {
    DestroyWindow(strip_);
    strip_ = nullptr;
  }
  DestroyWindow(window);
  Log(L"graceful-exit-done");
}

void FloatApp::OnWindowDestroyed() {
  if (clickThroughHotkey_ && hwnd_ != nullptr) {
    UnregisterHotKey(hwnd_, kHotkeyClickThrough);
    clickThroughHotkey_ = false;
  }
  KillAllTimers();
  if (mouseCaptured_) {
    mouseCaptured_ = false;
    ReleaseCapture();
  }
  CleanupWebView();
  strip_ = nullptr;  // 子窗口随父窗口一起销毁
  hwnd_ = nullptr;
  PostQuitMessage(exitCode_);
}

LRESULT FloatApp::OnMainMessage(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  switch (message) {
    case WM_NCCALCSIZE:
      if (wparam == TRUE) return 0;  // 去掉系统边框：客户区 = 整个窗口
      return DefWindowProcW(hwnd, message, wparam, lparam);
    case WM_NCHITTEST:
      return HandleNcHitTest(hwnd, lparam);
    case WM_GETMINMAXINFO:
      HandleMinMaxInfo(reinterpret_cast<MINMAXINFO*>(lparam));
      return 0;
    case WM_ERASEBKGND:
      if (hostingMode_ == HostingMode::Composition) return 1;  // 不画背景，透出下层
      return DefWindowProcW(hwnd, message, wparam, lparam);
    case WM_PAINT:
      if (hostingMode_ == HostingMode::Composition) {
        PAINTSTRUCT paint = {};
        BeginPaint(hwnd, &paint);
        EndPaint(hwnd, &paint);
        return 0;
      }
      return DefWindowProcW(hwnd, message, wparam, lparam);
    case WM_NCRBUTTONUP:
      if (hostingMode_ == HostingMode::Composition) {
        ShowFloatContextMenu(hwnd, this);
        return 0;
      }
      return DefWindowProcW(hwnd, message, wparam, lparam);
    case WM_SETCURSOR:
      if (hostingMode_ == HostingMode::Composition && LOWORD(lparam) == HTCLIENT) {
        SetCursor(webViewCursor_ != nullptr ? webViewCursor_ : LoadCursorW(nullptr, IDC_ARROW));
        return TRUE;
      }
      return DefWindowProcW(hwnd, message, wparam, lparam);
    case WM_MOUSEACTIVATE:
      if (clickThrough_) return MA_NOACTIVATE;
      return DefWindowProcW(hwnd, message, wparam, lparam);
    case WM_ACTIVATE:
      if (hostingMode_ == HostingMode::Composition && LOWORD(wparam) != WA_INACTIVE &&
          controller_.Get() != nullptr) {
        controller_->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
      }
      return DefWindowProcW(hwnd, message, wparam, lparam);
    case WM_SETFOCUS:
      if (hostingMode_ == HostingMode::Composition && controller_.Get() != nullptr) {
        controller_->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
      }
      return DefWindowProcW(hwnd, message, wparam, lparam);
    case WM_CAPTURECHANGED:
      mouseCaptured_ = false;
      return DefWindowProcW(hwnd, message, wparam, lparam);
    case WM_MOUSEMOVE:
    case WM_LBUTTONDOWN:
    case WM_LBUTTONUP:
    case WM_LBUTTONDBLCLK:
    case WM_RBUTTONDOWN:
    case WM_RBUTTONUP:
    case WM_RBUTTONDBLCLK:
    case WM_MBUTTONDOWN:
    case WM_MBUTTONUP:
    case WM_MBUTTONDBLCLK:
    case WM_XBUTTONDOWN:
    case WM_XBUTTONUP:
    case WM_XBUTTONDBLCLK:
    case WM_MOUSEWHEEL:
    case WM_MOUSEHWHEEL:
    case WM_MOUSELEAVE:
      if (hostingMode_ == HostingMode::Composition) {
        if (OnCompositionMouseMessage(message, wparam, lparam)) return 0;
      }
      return DefWindowProcW(hwnd, message, wparam, lparam);
    case WM_SIZE:
      LayoutChildren();
      return 0;
    case WM_MOVE:
      if (controller_.Get() != nullptr) controller_->NotifyParentWindowPositionChanged();
      return 0;
    case WM_DPICHANGED: {
      RECT* suggested = reinterpret_cast<RECT*>(lparam);
      if (suggested != nullptr) {
        SetWindowPos(hwnd, nullptr, suggested->left, suggested->top,
                     suggested->right - suggested->left, suggested->bottom - suggested->top,
                     SWP_NOZORDER | SWP_NOACTIVATE);
      }
      LayoutChildren();
      if (strip_ != nullptr) InvalidateRect(strip_, nullptr, TRUE);
      return 0;
    }
    case WM_TIMER:
      OnTimer(static_cast<UINT_PTR>(wparam));
      return 0;
    case kMsgExitGraceful:
      DoGracefulExit();
      return 0;
    case kMsgStripMenu:
      if (wparam == static_cast<WPARAM>(kMenuExit)) {
        RequestExit(0);
      } else if (wparam == static_cast<WPARAM>(kMenuResetFrame)) {
        ResetWindowFrame();
      } else if (wparam == static_cast<WPARAM>(kMenuToggleClickThrough)) {
        ToggleClickThrough();
      } else if (wparam == static_cast<WPARAM>(kMenuStopFollow)) {
        StopFollowing();
      }
      return 0;
    case WM_HOTKEY:
      if (wparam == kHotkeyClickThrough) {
        ToggleClickThrough();
        return 0;
      }
      return DefWindowProcW(hwnd, message, wparam, lparam);
    case WM_SYSKEYDOWN:
      if (wparam == VK_F4) {
        RequestExit(0);
        return 0;
      }
      return DefWindowProcW(hwnd, message, wparam, lparam);
    case WM_CLOSE:
      RequestExit(0);
      return 0;
    case WM_QUERYENDSESSION:
      return TRUE;
    case WM_ENDSESSION:
      if (wparam != 0) RestoreDshWindows();
      return 0;
    case WM_DESTROY:
      if (suppressWindowDestroy_) {
        // 模式回退时重建窗口：旧窗口销毁不代表进程退出，不能 PostQuitMessage。
        suppressWindowDestroy_ = false;
        return 0;
      }
      OnWindowDestroyed();
      return 0;
    default:
      return DefWindowProcW(hwnd, message, wparam, lparam);
  }
}

}  // namespace

/* ────────────────────────────── 入口 ────────────────────────────── */

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previousInstance, PWSTR commandLine,
                    int showCommand) {
  (void)previousInstance;
  (void)commandLine;
  (void)showCommand;

  g_instance = instance;
  InitLogging();
  InstallCrashHandlers();

  int argumentCount = 0;
  LPWSTR* rawArguments = CommandLineToArgvW(GetCommandLineW(), &argumentCount);
  std::wstring firstArgument;
  if (rawArguments == nullptr) {
    Log(L"commandline-parse-failed (will try GUFA_FLOAT_PAYLOAD)");
  } else {
    if (argumentCount > 1) firstArgument = std::wstring(rawArguments[1]);
    LocalFree(rawArguments);
    rawArguments = nullptr;
  }

  if (firstArgument == L"--version" || firstArgument == L"-v") {
    const std::wstring version = L"gufa-float-win 1.0.0";
    WriteStdout(version + L"\n");
    LogFmt(L"--version %s", version.c_str());
    return 0;
  }
  if (firstArgument == L"--help" || firstArgument == L"-h" || firstArgument == L"/?") {
    WriteStdout(L"gufa-float-win — Windows 悬浮层 helper（由 DSH Host 自动启动）\n"
                L"用法: gufa-float-win '<payload-json>'\n"
                L"      gufa-float-win --version\n"
                L"环境变量: GUFA_FLOAT_PAYLOAD=<payload-json>（无参数时的 payload 兜底）\n");
    Log(L"--help");
    return 0;
  }

  // payload 来源：argv[1] 优先；没有或解析失败时回退环境变量 GUFA_FLOAT_PAYLOAD。
  // CI 用 Start-Process + 环境变量传 JSON，可绕开 PowerShell 对含引号参数的拼接问题。
  std::wstring argumentPayload = firstArgument;
  if (argumentPayload == L"--ci-probe") argumentPayload = L"{\"ciProbe\":true}";
  const std::wstring environmentPayload = ReadEnvironmentPayload();

  FloatPayload selectedPayload;
  std::wstring payloadText;
  std::wstring payloadSource;
  if (!argumentPayload.empty()) {
    FloatPayload candidate;
    std::wstring parseError;
    if (ParsePayloadJson(argumentPayload, &candidate, &parseError) &&
        ValidatePayload(candidate, &parseError)) {
      selectedPayload = candidate;
      payloadText = argumentPayload;
      payloadSource = L"argv";
    } else {
      LogFmt(L"payload-argv-invalid reason=%s", parseError.c_str());
    }
  }
  if (payloadText.empty() && !environmentPayload.empty()) {
    FloatPayload candidate;
    std::wstring parseError;
    if (ParsePayloadJson(environmentPayload, &candidate, &parseError) &&
        ValidatePayload(candidate, &parseError)) {
      selectedPayload = candidate;
      payloadText = environmentPayload;
      payloadSource = L"env:GUFA_FLOAT_PAYLOAD";
    } else {
      LogFmt(L"payload-env-invalid reason=%s", parseError.c_str());
    }
  }

  if (payloadText.empty()) {
    const bool nothingProvided = argumentPayload.empty() && environmentPayload.empty();
    const std::wstring reason = nothingProvided ? std::wstring(L"missing-payload")
                                                : std::wstring(L"invalid-payload");
    if (nothingProvided) Log(L"missing-payload-argument");
    LogFmt(L"payload-unusable reason=%s", reason.c_str());
    // 参数可能被 shell 拼坏：尽量从原始文本里救出 ciProbeOut，先落一个 ok:false 的探针文件。
    std::wstring probePath = ExtractStringFieldLoose(environmentPayload, L"ciProbeOut");
    if (probePath.empty()) probePath = ExtractStringFieldLoose(argumentPayload, L"ciProbeOut");
    if (!probePath.empty()) {
      const std::wstring line = BuildCiProbeLine(false, false, reason);
      WriteStdout(line + L"\n");
      const bool wrote = WriteFileUtf8(probePath, line + L"\n");
      LogFmt(L"ciprobe-out-early path=%s wrote=%d reason=%s", probePath.c_str(),
             wrote ? 1 : 0, reason.c_str());
    }
    return 2;
  }
  LogFmt(L"payload-source=%s length=%zu ciProbe=%d ciProbeOut=%s", payloadSource.c_str(),
         payloadText.size(), selectedPayload.ciProbe ? 1 : 0,
         selectedPayload.ciProbeOut.c_str());

  EnableDpiAwareness();

  const HRESULT comResult = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(comResult)) {
    LogFmt(L"com-init-failed hr=%08lX", static_cast<unsigned long>(comResult));
    if (selectedPayload.ciProbe && !selectedPayload.ciProbeOut.empty()) {
      const std::wstring line = BuildCiProbeLine(false, false, L"com-init-failed");
      WriteStdout(line + L"\n");
      const bool wrote = WriteFileUtf8(selectedPayload.ciProbeOut, line + L"\n");
      LogFmt(L"ciprobe-out-early path=%s wrote=%d reason=com-init-failed",
             selectedPayload.ciProbeOut.c_str(), wrote ? 1 : 0);
    }
    return 1;
  }

  int exitCode = 1;
  {
    FloatApp app;
    if (!app.ParseCommandLine(payloadText)) {
      Log(L"payload-parse-failed-after-preselect");
      if (selectedPayload.ciProbe && !selectedPayload.ciProbeOut.empty()) {
        const std::wstring line = BuildCiProbeLine(false, false, L"invalid-payload");
        WriteStdout(line + L"\n");
        const bool wrote = WriteFileUtf8(selectedPayload.ciProbeOut, line + L"\n");
        LogFmt(L"ciprobe-out-early path=%s wrote=%d reason=invalid-payload",
               selectedPayload.ciProbeOut.c_str(), wrote ? 1 : 0);
      }
      exitCode = 2;
    } else if (!app.CreateMainWindow()) {
      if (app.IsCiProbe()) {
        const std::wstring probePath = app.CiProbeOutputPath();
        const std::wstring line = BuildCiProbeLine(false, false, L"create-main-window-failed");
        WriteStdout(line + L"\n");
        const bool wrote = WriteFileUtf8(probePath, line + L"\n");
        LogFmt(L"ciprobe-out-early path=%s wrote=%d reason=create-main-window-failed",
               probePath.c_str(), wrote ? 1 : 0);
        exitCode = 1;
      } else {
        exitCode = 3;
      }
    } else {
      app.Start();
      exitCode = app.RunMessageLoop();
      // 兜底：ciProbe 进程结束了但没写结果（例如 WebView2 回调一直没来）也要留下探针文件。
      app.EnsureCiProbeResultWritten(L"exited-without-probe-result");
    }
  }

  CoUninitialize();
  LogFmt(L"exiting code=%d", exitCode);
  return exitCode;
}
