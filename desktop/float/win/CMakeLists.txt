# 古法编程 · Windows 悬浮层 helper（Win32 + WebView2）
#
# 依赖：Visual Studio 2022（Desktop development with C++）+ Windows 10/11 SDK +
#       Microsoft.Web.WebView2 NuGet 包（只需解压，提供头文件和 WebView2LoaderStatic.lib）。
#
# 用法（在仓库根目录执行）：
#   cmake -S desktop/float/win -B build-win -A x64 -DWEBVIEW2_SDK_DIR=<解压后的 NuGet 包目录>
#   cmake --build build-win --config Release
#
# CI 会先用 NuGet 下载 Microsoft.Web.WebView2/1.0.2903.40 并解压，然后把解压目录
# 通过 -DWEBVIEW2_SDK_DIR=... 传进来（见 .github/workflows/build-float.yml）。
# 产物：build-win/bin/<Config>/gufa-float-win.exe（CI 会复制到
#       desktop/float/bin/win-x64/gufa-float-win.exe）。

cmake_minimum_required(VERSION 3.20)

project(gufa-float-win LANGUAGES CXX)

if(NOT WIN32)
  message(FATAL_ERROR
    "gufa-float-win 只能在 Windows 上构建（当前系统：${CMAKE_SYSTEM_NAME}）。"
    "macOS/Linux 上请用 CI（GitHub Actions windows-latest）构建。")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ---------------------------------------------------------------------------
# 定位 WebView2 SDK（NuGet 包解压目录）
# ---------------------------------------------------------------------------
if(NOT DEFINED WEBVIEW2_SDK_DIR OR WEBVIEW2_SDK_DIR STREQUAL "")
  if(DEFINED ENV{WEBVIEW2_SDK_DIR} AND NOT "$ENV{WEBVIEW2_SDK_DIR}" STREQUAL "")
    set(WEBVIEW2_SDK_DIR "$ENV{WEBVIEW2_SDK_DIR}")
  endif()
endif()
if(NOT DEFINED WEBVIEW2_SDK_DIR OR WEBVIEW2_SDK_DIR STREQUAL "")
  message(FATAL_ERROR
    "没有设置 WEBVIEW2_SDK_DIR。\n"
    "请先下载/解压 Microsoft.Web.WebView2 NuGet 包，然后用 -DWEBVIEW2_SDK_DIR=<目录> 传入。\n"
    "  例如：\n"
    "    Invoke-WebRequest 'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.2903.40' -OutFile wv2.zip\n"
    "    Expand-Archive wv2.zip -DestinationPath wv2\n"
    "    cmake -S . -B build-win -A x64 -DWEBVIEW2_SDK_DIR=\"$PWD/wv2\"")
endif()
get_filename_component(WEBVIEW2_SDK_DIR "${WEBVIEW2_SDK_DIR}" ABSOLUTE)

# WebView2.h（NuGet 包标准布局：build/native/include/WebView2.h；也允许任意子目录）
set(WEBVIEW2_HEADER "")
if(EXISTS "${WEBVIEW2_SDK_DIR}/build/native/include/WebView2.h")
  set(WEBVIEW2_HEADER "${WEBVIEW2_SDK_DIR}/build/native/include/WebView2.h")
else()
  file(GLOB_RECURSE _wv2_headers "${WEBVIEW2_SDK_DIR}/*WebView2.h")
  if(_wv2_headers)
    list(GET _wv2_headers 0 WEBVIEW2_HEADER)
  endif()
endif()
if(NOT WEBVIEW2_HEADER)
  message(FATAL_ERROR
    "在 ${WEBVIEW2_SDK_DIR} 下找不到 WebView2.h。\n"
    "WEBVIEW2_SDK_DIR 应为 Microsoft.Web.WebView2 NuGet 包的解压根目录"
    "（其中包含 build/native/include/WebView2.h）。")
endif()
get_filename_component(WEBVIEW2_INCLUDE_DIR "${WEBVIEW2_HEADER}" DIRECTORY)

if(NOT EXISTS "${WEBVIEW2_INCLUDE_DIR}/WebView2EnvironmentOptions.h")
  message(FATAL_ERROR
    "在 ${WEBVIEW2_INCLUDE_DIR} 下找不到 WebView2EnvironmentOptions.h；"
    "SDK 包不完整？请更换 Microsoft.Web.WebView2 的稳定版本（CI 用 1.0.2903.40）。")
endif()

# 目标架构（CI 显式 -A x64；也兼容 ARM64/x86）
set(_wv2_arch "x64")
if(CMAKE_GENERATOR_PLATFORM)
  string(TOLOWER "${CMAKE_GENERATOR_PLATFORM}" _wv2_platform)
  if(_wv2_platform MATCHES "arm64")
    set(_wv2_arch "arm64")
  elseif(_wv2_platform MATCHES "win32" OR _wv2_platform MATCHES "^x86$")
    set(_wv2_arch "x86")
  endif()
elseif(CMAKE_SIZEOF_VOID_P EQUAL 4)
  set(_wv2_arch "x86")
endif()

# WebView2LoaderStatic.lib（静态加载器：产物是单 exe，不需要额外的 WebView2Loader.dll）
set(WEBVIEW2_LOADER_LIB "")
set(_wv2_direct "${WEBVIEW2_SDK_DIR}/build/native/${_wv2_arch}/WebView2LoaderStatic.lib")
if(EXISTS "${_wv2_direct}")
  set(WEBVIEW2_LOADER_LIB "${_wv2_direct}")
else()
  file(GLOB_RECURSE _wv2_loader_candidates "${WEBVIEW2_SDK_DIR}/*WebView2LoaderStatic.lib")
  foreach(_candidate IN LISTS _wv2_loader_candidates)
    if(_candidate MATCHES "[/\\\\]${_wv2_arch}[/\\\\]")
      set(WEBVIEW2_LOADER_LIB "${_candidate}")
      break()
    endif()
  endforeach()
  if(NOT WEBVIEW2_LOADER_LIB AND _wv2_loader_candidates)
    list(GET _wv2_loader_candidates 0 WEBVIEW2_LOADER_LIB)
  endif()
endif()
if(NOT WEBVIEW2_LOADER_LIB)
  message(FATAL_ERROR
    "找不到 ${_wv2_arch} 架构的 WebView2LoaderStatic.lib（应在 build/native/${_wv2_arch}/ 下）。")
endif()

message(STATUS "WebView2 include dir: ${WEBVIEW2_INCLUDE_DIR}")
message(STATUS "WebView2 loader lib : ${WEBVIEW2_LOADER_LIB}")

# ---------------------------------------------------------------------------
# 目标
# ---------------------------------------------------------------------------
add_executable(gufa-float-win WIN32
  main.cpp
  json.h
)

target_include_directories(gufa-float-win PRIVATE "${WEBVIEW2_INCLUDE_DIR}")

target_compile_definitions(gufa-float-win PRIVATE
  UNICODE
  _UNICODE
  WIN32_LEAN_AND_MEAN
  NOMINMAX
  _WIN32_WINNT=0x0A00
  WINVER=0x0A00
  _CRT_SECURE_NO_WARNINGS
)

# WebView2LoaderStatic.lib 需要 version.lib（见 NuGet 包内 Common.targets）。
target_link_libraries(gufa-float-win PRIVATE
  "${WEBVIEW2_LOADER_LIB}"
  version
  ole32
  oleaut32
  uuid
  user32
  gdi32
  shell32
  advapi32
  dwmapi
)

if(MSVC)
  # /utf-8：源码是 UTF-8，界面里的中文（拖动条文字等）需要按 UTF-8 解析；
  # /ENTRY：显式指定 Unicode 入口，避免个别工具链找不到 wWinMain。
  target_compile_options(gufa-float-win PRIVATE /W3 /utf-8 /EHsc)
  target_link_options(gufa-float-win PRIVATE "/ENTRY:wWinMainCRTStartup")
endif()

set_target_properties(gufa-float-win PROPERTIES
  OUTPUT_NAME "gufa-float-win"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)
# 多配置生成器（VS）下为每个配置生成独立 exe 路径（build-win/bin/<Config>/...）
foreach(_config DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)
  set_target_properties(gufa-float-win PROPERTIES
    "RUNTIME_OUTPUT_DIRECTORY_${_config}" "${CMAKE_BINARY_DIR}/bin/${_config}")
endforeach()
