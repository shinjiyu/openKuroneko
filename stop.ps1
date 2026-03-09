# ------------------------------------------------------------------------------
# openKuroneko 停止脚本（Windows PowerShell）
#
# 停止顺序：外脑 → 内脑（含 PID 文件）→ 清理残留锁文件
# ------------------------------------------------------------------------------

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = Get-Location.Path }
$OB_DIR   = if ($env:OB_DIR)   { $env:OB_DIR }   else { Join-Path $ScriptDir "ob-agent" }
$INNER_DIR= if ($env:INNER_DIR){ $env:INNER_DIR } else { Join-Path $ScriptDir "chat-agent" }
$LOCK_DIR = if ($env:OPENKURONEKO_TMP) { $env:OPENKURONEKO_TMP } else { Join-Path $env:TEMP "openkuroneko" }

function Stop-ProcessGracefully($Label, $Pid) {
  if (-not $Pid) { return }
  $p = Get-Process -Id $Pid -ErrorAction SilentlyContinue
  if (-not $p) { Write-Host "  · $Label (pid=$Pid) 已不在运行"; return }
  try {
    $p | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "  ✓ $Label (pid=$Pid) 已停止"
  } catch {
    Write-Host "  ! $Label (pid=$Pid) 停止失败: $_"
  }
}

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host " openKuroneko 停止"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. 外脑
Write-Host ""
Write-Host "[外脑]"
$obProcs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "outer-brain\.ts" -or $_.CommandLine -match "outer-brain\.js" }
foreach ($proc in $obProcs) {
  Stop-ProcessGracefully "外脑" $proc.ProcessId
}
if (-not $obProcs -or $obProcs.Count -eq 0) { Write-Host "  · 外脑未运行" }

# 2. 内脑（先按 PID 文件）
Write-Host ""
Write-Host "[内脑]"
$pidFile = Join-Path $OB_DIR "inner-brain.pid"
if (Test-Path $pidFile) {
  $innerPid = (Get-Content $pidFile -Raw).Trim()
  if ($innerPid) { Stop-ProcessGracefully "内脑" ([int]$innerPid) }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "  ✓ 已删除 inner-brain.pid"
}
$innerProcs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "cli[\\/]index\.ts" -or $_.CommandLine -match "cli[\\/]index\.js" }
foreach ($proc in $innerProcs) {
  Stop-ProcessGracefully "内脑(残留)" $proc.ProcessId
}
if ((-not $innerProcs -or $innerProcs.Count -eq 0) -and -not (Test-Path $pidFile)) { Write-Host "  · 内脑未运行" }

# 3. 锁文件
Write-Host ""
Write-Host "[锁文件]"
if (Test-Path $LOCK_DIR) {
  $cleaned = 0
  Get-ChildItem -Path $LOCK_DIR -Filter "*.lock" -ErrorAction SilentlyContinue | ForEach-Object {
    $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
    $lockPid = $content.Trim()
    $running = $false
    if ($lockPid -match '^\d+$') { $running = Get-Process -Id ([int]$lockPid) -ErrorAction SilentlyContinue }
    if (-not $running -and $lockPid) {
      Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
      Write-Host "  ✓ 已清理残留锁 $($_.Name) (pid=$lockPid)"
      $cleaned++
    }
  }
  if ($cleaned -eq 0) { Write-Host "  · 无残留锁文件" }
} else {
  Write-Host "  · 锁目录不存在：$LOCK_DIR"
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host " 全部停止完成"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
