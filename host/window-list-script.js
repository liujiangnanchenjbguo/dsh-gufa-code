/**
 * Windows 窗口枚举 PowerShell 脚本。
 *
 * 单独成文件是为了让 CI 在没有 npm 依赖的环境里直接 import 做真机验证；
 * Host 侧 host/dev.js 复用同一个脚本。
 */
/** Windows 窗口枚举 PowerShell 脚本（同时供 CI 真机测试直接运行）。 */
export function windowsWindowListScript() {
    const typeDef = [
      'using System;',
      'using System.Text;',
      'using System.Runtime.InteropServices;',
      'public static class GufaWinEnum {',
      '  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);',
      '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);',
      '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);',
      '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);',
      '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);',
      '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);',
      '  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);',
      '  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);',
      '}',
    ].join('\n')
    const script = [
      '$ErrorActionPreference = "SilentlyContinue";',
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;',
      '$OutputEncoding = [System.Text.Encoding]::UTF8;',
      "Add-Type -TypeDefinition @'",
      typeDef,
      "'@",
      '$procs = @{};',
      'Get-Process | ForEach-Object { $procs[[uint32]$_.Id] = $_.ProcessName }',
      '$rows = New-Object System.Collections.ArrayList;',
      '$cb = [GufaWinEnum+EnumWindowsProc]{ param($hWnd, $lParam)',
      '  if (-not [GufaWinEnum]::IsWindowVisible($hWnd)) { return $true };',
      '  $len = [GufaWinEnum]::GetWindowTextLength($hWnd);',
      '  if ($len -le 0) { return $true };',
      '  $sb = New-Object System.Text.StringBuilder ($len + 1);',
      '  [void][GufaWinEnum]::GetWindowText($hWnd, $sb, $sb.Capacity);',
      '  $title = $sb.ToString();',
      '  if ([string]::IsNullOrWhiteSpace($title)) { return $true };',
      '  $ex = [GufaWinEnum]::GetWindowLong($hWnd, -20);',
      '  if (($ex -band 0x00000080) -ne 0) { return $true };',
      '  if ([GufaWinEnum]::GetWindow($hWnd, 4) -ne [IntPtr]::Zero) { return $true };',
      '  $ownerPid = [uint32]0;',
      '  [void][GufaWinEnum]::GetWindowThreadProcessId($hWnd, [ref]$ownerPid);',
      '  $ownerName = $procs[$ownerPid];',
      '  if (-not $ownerName) { $ownerName = "" };',
      '  [void]$rows.Add([pscustomobject]@{ pid = [int64]$ownerPid; owner = $ownerName; title = $title; bundleId = ""; windowNumber = [int64]$hWnd; frontmost = 0 });',
      '  return $true',
      '};',
      '[void][GufaWinEnum]::EnumWindows($cb, [IntPtr]::Zero);',
      'ConvertTo-Json -InputObject ([pscustomobject]@{ ok = $true; accessibility = $true; apps = @($rows) }) -Compress -Depth 5',
    ].join('\n')
  return script
}

