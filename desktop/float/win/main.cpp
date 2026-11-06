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
 * 首版说明：窗口为「不透明」窗口（WebView2 windowed hosting 不支持真正的
 * 逐像素透明；透明需要 DirectComposition + CompositionController +
 * WS_EX_NOREDIRECTIONBITMAP 的 visual hosting，见 README-WIN.md 的 TODO）。
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX

#include <windows.h>
#include <windowsx.h>
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

constexpr int kMenuExit = 1;
constexpr int kMenuResetFrame = 2;

constexpr int kResizeBorderDip = 8;  // 左右/底部可缩放边缘宽度（DIP）
constexpr int kDragStripDip = 22;    // 顶部拖动条高度（DIP，与网页 CSS 的 22px 对齐）
constexpr int kProbeTimeoutMs = 8000;
constexpr int kProbeWatchdogMs = 20000;
constexpr int kFollowIntervalMs = 250;
constexpr int kControlIntervalMs = 300;

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

void WriteStdout(const std::wstring& text) {
  const std::string utf8 = WideToUtf8(text);
  HANDLE handle = GetStdHandle(STD_OUTPUT_HANDLE);
  if (handle == nullptr || handle == INVALID_HANDLE_VALUE) return;
  DWORD written = 0;
  WriteFile(handle, utf8.data(), static_cast<DWORD>(utf8.size()), &written, nullptr);
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
  bool hasFollow = false;
  DWORD followPid = 0;
  bool hasState = false;
  gufa::JsonValue state;
  int alpha = 0;
  DWORD ownerPid = 0;
  bool ciProbe = false;
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

/* 回调里拿到的 COM 指针是「借」的：先 AddRef，再交给 ComPtr 接管。 */
template <typename T>
void AttachOwned(ComPtr<T>* target, T* raw) {
  if (target == nullptr) return;
  target->Reset();
  if (raw != nullptr) {
    raw->AddRef();
    target->Attach(raw);
  }
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

  static LRESULT CALLBACK MainWndProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam);
  static LRESULT CALLBACK StripWndProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam);

 private:
  enum class Phase { Idle, Auth, App, Done };

  static FloatApp* FromWindow(HWND hwnd);
  static FloatApp* FromStripWindow(HWND stripWindow);
  static bool RegisterWindowClasses();

  LRESULT OnMainMessage(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam);
  LRESULT HandleNcHitTest(HWND hwnd, LPARAM lparam);
  void HandleMinMaxInfo(MINMAXINFO* info);

  void LayoutChildren();
  void RaiseStrip();
  void ResetWindowFrame();
  bool LoadSavedFrame(RECT* frame);
  void SaveFrameIfNeeded();
  std::wstring FrameFilePath();
  void ClampInitialRect(RECT* rect);

  void OnFollowTimer();
  void ApplyFollowFrame();
  void OnHideDshTimer();
  void HideDshWindows();
  void RestoreDshWindows();

  void OnControlTimer();
  void DeleteControlFile();
  void OnTimer(UINT_PTR timerId);
  void KillAllTimers();

  void CreateWebViewEnvironment();
  void OnEnvironmentCreated(HRESULT errorCode, ICoreWebView2Environment* environment);
  void OnControllerCreated(HRESULT errorCode, ICoreWebView2Controller* controller);
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
  void FinishProbe(bool loaded);
  void FinishProbeFailure();

  void DoGracefulExit();
  void OnWindowDestroyed();
  void CleanupWebView();

  HWND hwnd_ = nullptr;
  HWND strip_ = nullptr;
  FloatPayload payload_;
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
};

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
    case WM_RBUTTONUP: {
      HMENU menu = CreatePopupMenu();
      if (menu == nullptr) return 0;
      AppendMenuW(menu, MF_STRING, kMenuExit, L"退出摸鱼（恢复主窗口）");
      AppendMenuW(menu, MF_STRING, kMenuResetFrame, L"重置窗口位置和大小");
      POINT cursor;
      GetCursorPos(&cursor);
      HWND parent = GetParent(hwnd);
      const int command = static_cast<int>(TrackPopupMenu(
          menu, TPM_RETURNCMD | TPM_RIGHTBUTTON, cursor.x, cursor.y, 0, parent, nullptr));
      DestroyMenu(menu);
      if (command != 0 && parent != nullptr) {
        PostMessageW(parent, kMsgStripMenu, static_cast<WPARAM>(command), 0);
      }
      return 0;
    }
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
  LogFmt(L"payload-ok ciProbe=%d follow=%d followPid=%lu ownerPid=%lu cookie=%s authUrl=%s "
         L"controlPath=%s build=%s alpha=%d hasState=%d",
         payload_.ciProbe ? 1 : 0, payload_.hasFollow ? 1 : 0,
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

  const DWORD extendedStyle = WS_EX_TOPMOST | WS_EX_TOOLWINDOW;
  const DWORD style = WS_POPUP | WS_THICKFRAME | WS_CLIPCHILDREN;
  hwnd_ = CreateWindowExW(extendedStyle, kMainWindowClass, kWindowTitle, style, initial.left,
                          initial.top, initial.right - initial.left,
                          initial.bottom - initial.top, nullptr, nullptr, g_instance, this);
  if (hwnd_ == nullptr) {
    LogFmt(L"create-main-window-failed err=%lu", static_cast<unsigned long>(GetLastError()));
    return false;
  }

  RECT client = {};
  GetClientRect(hwnd_, &client);
  const int stripHeight = DpiScale(hwnd_, kDragStripDip);
  strip_ = CreateWindowExW(0, kStripWindowClass, L"", WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS, 0,
                           0, client.right - client.left, stripHeight, hwnd_, nullptr, g_instance,
                           nullptr);
  if (strip_ == nullptr) {
    LogFmt(L"create-strip-window-failed err=%lu", static_cast<unsigned long>(GetLastError()));
  }
  LayoutChildren();

  if (payload_.ciProbe) {
    ShowWindow(hwnd_, SW_HIDE);
  } else {
    ShowWindow(hwnd_, SW_SHOWNOACTIVATE);
    UpdateWindow(hwnd_);
  }

  LogFmt(L"main-window-created rect=(%ld,%ld)-(%ld,%ld) dpi=%u ciProbe=%d",
         static_cast<long>(initial.left), static_cast<long>(initial.top),
         static_cast<long>(initial.right), static_cast<long>(initial.bottom),
         WindowDpi(hwnd_), payload_.ciProbe ? 1 : 0);
  return true;
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
      SetTimer(hwnd_, kTimerFollow, kFollowIntervalMs, nullptr);
    }
    SetTimer(hwnd_, kTimerHideDsh, 450, nullptr);
    SetTimer(hwnd_, kTimerControl, kControlIntervalMs, nullptr);
  } else {
    SetTimer(hwnd_, kTimerProbeWatchdog, kProbeWatchdogMs, nullptr);
  }
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
  if (exiting_) return;
  exiting_ = true;
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

LRESULT FloatApp::HandleNcHitTest(HWND hwnd, LPARAM lparam) {
  POINT point;
  point.x = GET_X_LPARAM(lparam);
  point.y = GET_Y_LPARAM(lparam);
  RECT windowRect = {};
  if (!GetWindowRect(hwnd, &windowRect)) return HTCLIENT;
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
      OnHideDshTimer();
      break;
    case kTimerProbeTimeout:
      KillTimer(hwnd_, kTimerProbeTimeout);
      Log(L"ciprobe-timeout");
      FinishProbe(false);
      break;
    case kTimerProbeWatchdog:
      KillTimer(hwnd_, kTimerProbeWatchdog);
      Log(L"ciprobe-watchdog-timeout");
      FinishProbeFailure();
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
    if (payload_.ciProbe) {
      // CI 的 runner 可能没有可用 GPU：强制软件渲染，避免 ciProbe 卡住。
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
  AttachOwned(&environment_, environment);
  Log(L"webview2-env-ready");
  const HRESULT hr = environment_->CreateCoreWebView2Controller(
      hwnd_,
      Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
          [this](HRESULT controllerError, ICoreWebView2Controller* controller) -> HRESULT {
            OnControllerCreated(controllerError, controller);
            return S_OK;
          })
          .Get());
  if (FAILED(hr)) {
    LogFmt(L"create-controller-call-failed hr=%08lX", static_cast<unsigned long>(hr));
    HandleWebViewEnvironmentFailure(hr);
  }
}

void FloatApp::OnControllerCreated(HRESULT errorCode, ICoreWebView2Controller* controller) {
  if (exiting_) return;
  if (FAILED(errorCode) || controller == nullptr) {
    LogFmt(L"webview2-controller-failed hr=%08lX", static_cast<unsigned long>(errorCode));
    HandleWebViewEnvironmentFailure(errorCode);
    return;
  }
  AttachOwned(&controller_, controller);
  const HRESULT hr = controller_->get_CoreWebView2(webView_.GetAddressOf());
  if (FAILED(hr) || webView_.Get() == nullptr) {
    LogFmt(L"get-core-webview-failed hr=%08lX", static_cast<unsigned long>(hr));
    HandleWebViewEnvironmentFailure(hr);
    return;
  }
  controllerReady_ = true;
  Log(L"webview2-controller-ready");
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
    background.A = 255;
    background.R = 13;
    background.G = 15;
    background.B = 19;
    controller2->put_DefaultBackgroundColor(background);
  }
  controller_->put_IsVisible(TRUE);

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

void FloatApp::FinishProbe(bool loaded) {
  if (ciProbeFinished_) return;
  ciProbeFinished_ = true;
  WriteStdout(loaded ? L"{\"ok\":true,\"platform\":\"win32\",\"urlLoaded\":true}\n"
                     : L"{\"ok\":true,\"platform\":\"win32\",\"urlLoaded\":false}\n");
  LogFmt(L"ciprobe-finished loaded=%d", loaded ? 1 : 0);
  RequestExit(0);
}

void FloatApp::FinishProbeFailure() {
  if (ciProbeFinished_) return;
  ciProbeFinished_ = true;
  WriteStdout(L"{\"ok\":false,\"platform\":\"win32\",\"urlLoaded\":false}\n");
  Log(L"ciprobe-failed");
  RequestExit(1);
}

void FloatApp::HandleWebViewEnvironmentFailure(HRESULT errorCode) {
  if (payload_.ciProbe) {
    FinishProbeFailure();
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
  if (webView_.Get() != nullptr) webView_.Reset();
  if (controller_.Get() != nullptr) {
    controller_->put_IsVisible(FALSE);
    controller_->Close();
    controller_.Reset();
  }
  environment_.Reset();
}

void FloatApp::DoGracefulExit() {
  if (hwnd_ == nullptr) {
    PostQuitMessage(exitCode_);
    return;
  }
  Log(L"graceful-exit-start");
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
  KillAllTimers();
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
      }
      return 0;
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
  LPWSTR* arguments = CommandLineToArgvW(GetCommandLineW(), &argumentCount);
  if (arguments == nullptr) {
    Log(L"commandline-parse-failed");
    return 2;
  }
  const std::wstring firstArgument =
      argumentCount > 1 ? std::wstring(arguments[1]) : std::wstring();
  if (firstArgument == L"--version" || firstArgument == L"-v") {
    WriteStdout(L"gufa-float-win 1.0.0\n");
    LocalFree(arguments);
    return 0;
  }
  if (firstArgument == L"--help" || firstArgument == L"-h" || firstArgument == L"/?") {
    WriteStdout(L"gufa-float-win — Windows 悬浮层 helper（由 DSH Host 自动启动）\n"
                L"用法: gufa-float-win '<payload-json>'\n"
                L"      gufa-float-win --version\n");
    LocalFree(arguments);
    return 0;
  }
  if (firstArgument.empty()) {
    Log(L"missing-payload-argument");
    LocalFree(arguments);
    return 2;
  }

  // payload 是 argv[1] 的完整拷贝；CommandLineToArgvW 的内存可以提前释放。
  std::wstring payloadText = firstArgument;
  if (firstArgument == L"--ci-probe") payloadText = L"{\"ciProbe\":true}";
  LocalFree(arguments);
  arguments = nullptr;

  EnableDpiAwareness();

  const HRESULT comResult = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(comResult)) {
    LogFmt(L"com-init-failed hr=%08lX", static_cast<unsigned long>(comResult));
    return 1;
  }

  int exitCode = 1;
  {
    FloatApp app;
    if (!app.ParseCommandLine(payloadText)) {
      exitCode = 2;
    } else if (!app.CreateMainWindow()) {
      if (app.IsCiProbe()) {
        WriteStdout(L"{\"ok\":false,\"platform\":\"win32\",\"urlLoaded\":false}\n");
        exitCode = 1;
      } else {
        exitCode = 3;
      }
    } else {
      app.Start();
      exitCode = app.RunMessageLoop();
    }
  }

  CoUninitialize();
  LogFmt(L"exiting code=%d", exitCode);
  return exitCode;
}
