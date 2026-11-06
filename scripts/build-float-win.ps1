# 在 Windows 本机构建摸鱼悬浮层 helper（Win32 + WebView2），并放到 host 期望的位置。
# 依赖：Visual Studio 2022（Desktop development with C++）+ Windows 10/11 SDK。
# 用法（仓库根目录，PowerShell）：
#   pwsh -File scripts/build-float-win.ps1
#   # 或指定已解压的 WebView2 SDK：
#   pwsh -File scripts/build-float-win.ps1 -WebView2SdkDir C:\wv2
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

param(
  [string]$WebView2SdkDir = $env:WEBVIEW2_SDK_DIR,
  [string]$WebView2Version = '1.0.2903.40'
)
if (-not $WebView2SdkDir) {
  $tmp = Join-Path $env:TEMP 'gufa-webview2'
  $zip = Join-Path $env:TEMP 'gufa-webview2.zip'
  if (-not (Test-Path (Join-Path $tmp 'build/native/include/WebView2.h'))) {
    Write-Host "下载 Microsoft.Web.WebView2 $WebView2Version ..."
    Invoke-WebRequest "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$WebView2Version" -OutFile $zip
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive $zip -DestinationPath $tmp -Force
  }
  $WebView2SdkDir = $tmp
}

cmake -S desktop/float/win -B build-win -A x64 -DWEBVIEW2_SDK_DIR="$WebView2SdkDir"
cmake --build build-win --config Release
New-Item -ItemType Directory -Force desktop/float/bin/win-x64 | Out-Null
$exe = Get-ChildItem -Path build-win -Recurse -Filter *.exe | Where-Object { $_.Name -notlike 'vc_redist*' } | Select-Object -First 1
if (-not $exe) { throw '没有找到构建出的 exe' }
Copy-Item $exe.FullName desktop/float/bin/win-x64/gufa-float-win.exe -Force
Write-Host "built: desktop/float/bin/win-x64/gufa-float-win.exe"
