# openKuroneko Outer Brain launcher (Windows PowerShell)
# Usage: .\start.ps1
# Loads .env from script directory. Set FEISHU=1, DINGTALK=1 etc. in .env

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = Get-Location.Path }

$tsxCmd = Join-Path $ScriptDir "node_modules\.bin\tsx.cmd"
if (-not (Test-Path $tsxCmd)) {
  Write-Host "Run: npm install" -ForegroundColor Yellow
  exit 1
}

$INNER_DIR = if ($env:INNER_DIR) { $env:INNER_DIR } else { Join-Path $ScriptDir "chat-agent" }
$OB_DIR    = if ($env:OB_DIR)    { $env:OB_DIR }    else { Join-Path $ScriptDir "ob-agent" }

$INNER_CMD = if ($env:INNER_CMD) { $env:INNER_CMD } else {
  "npx tsx `"$ScriptDir\src\cli\index.ts`" --dir `"$INNER_DIR`" --loop fast"
}

$WEBCHAT_PORT = if ($env:WEBCHAT_PORT) { $env:WEBCHAT_PORT } else { "8091" }
$AGENT_NAME   = if ($env:AGENT_NAME)   { $env:AGENT_NAME }   else { "Kuroneko" }
$FEISHU       = $env:FEISHU
$FEISHU_APP_ID = $env:FEISHU_APP_ID
$FEISHU_APP_SECRET = $env:FEISHU_APP_SECRET
$FEISHU_MODE  = if ($env:FEISHU_MODE)  { $env:FEISHU_MODE }  else { "websocket" }
$FEISHU_VERIFY_TOKEN = $env:FEISHU_VERIFY_TOKEN
$FEISHU_ENCRYPT_KEY  = $env:FEISHU_ENCRYPT_KEY
$FEISHU_PORT   = if ($env:FEISHU_PORT)   { $env:FEISHU_PORT }   else { "8090" }
$FEISHU_AGENT_OPEN_ID = $env:FEISHU_AGENT_OPEN_ID
$DINGTALK   = $env:DINGTALK
$DINGTALK_CLIENT_ID = $env:DINGTALK_CLIENT_ID
$DINGTALK_CLIENT_SECRET = $env:DINGTALK_CLIENT_SECRET
$FAST_MODEL = $env:FAST_MODEL
$ESCALATION_WAIT_MS = if ($env:ESCALATION_WAIT_MS) { $env:ESCALATION_WAIT_MS } else { "1800000" }

$envPath = Join-Path $ScriptDir ".env"
if (Test-Path $envPath) {
  Get-Content $envPath -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#")) {
      $idx = $line.IndexOf("=")
      if ($idx -gt 0) {
        $key = $line.Substring(0, $idx).Trim()
        $val = $line.Substring($idx + 1).Trim()
        if ($val.StartsWith('"') -and $val.EndsWith('"')) { $val = $val.Substring(1, $val.Length - 2) }
        if ($val.StartsWith("'") -and $val.EndsWith("'")) { $val = $val.Substring(1, $val.Length - 2) }
        Set-Item -Path "Env:$key" -Value $val
      }
    }
  }
  $FEISHU       = $env:FEISHU
  $FEISHU_APP_ID = $env:FEISHU_APP_ID
  $FEISHU_APP_SECRET = $env:FEISHU_APP_SECRET
  $FEISHU_MODE  = $env:FEISHU_MODE
  $DINGTALK     = $env:DINGTALK
  $DINGTALK_CLIENT_ID = $env:DINGTALK_CLIENT_ID
  $DINGTALK_CLIENT_SECRET = $env:DINGTALK_CLIENT_SECRET
  $FAST_MODEL   = $env:FAST_MODEL
}

$OB_ARGS = @(
  "--dir", $OB_DIR,
  "--inner-dir", $INNER_DIR,
  "--inner-cmd", $INNER_CMD,
  "--agent-name", $AGENT_NAME,
  "--escalation-wait-ms", $ESCALATION_WAIT_MS
)
if ($FAST_MODEL) { $OB_ARGS += "--fast-model"; $OB_ARGS += $FAST_MODEL }
if ($WEBCHAT_PORT) { $OB_ARGS += "--webchat-port"; $OB_ARGS += $WEBCHAT_PORT }
if ($FEISHU -and $FEISHU_APP_ID) {
  $OB_ARGS += "--feishu-app-id", $FEISHU_APP_ID, "--feishu-app-secret", $FEISHU_APP_SECRET, "--feishu-mode", $FEISHU_MODE
  if ($FEISHU_MODE -eq "webhook") {
    if ($FEISHU_VERIFY_TOKEN) { $OB_ARGS += "--feishu-verify-token", $FEISHU_VERIFY_TOKEN }
    if ($FEISHU_ENCRYPT_KEY)  { $OB_ARGS += "--feishu-encrypt-key", $FEISHU_ENCRYPT_KEY }
    $OB_ARGS += "--feishu-port", $FEISHU_PORT
  }
  if ($FEISHU_AGENT_OPEN_ID) { $OB_ARGS += "--feishu-agent-open-id", $FEISHU_AGENT_OPEN_ID }
}
if ($DINGTALK -and $DINGTALK_CLIENT_ID) {
  $OB_ARGS += "--dingtalk-client-id", $DINGTALK_CLIENT_ID, "--dingtalk-client-secret", $DINGTALK_CLIENT_SECRET
}

Write-Host "------------------------------------------------------------------------"
Write-Host " openKuroneko Outer Brain"
Write-Host "------------------------------------------------------------------------"
Write-Host " OB_DIR   : $OB_DIR"
Write-Host " INNER_DIR: $INNER_DIR"
Write-Host " INNER_CMD: $INNER_CMD"
if ($WEBCHAT_PORT) { Write-Host " WebChat  : http://localhost:$WEBCHAT_PORT" }
if ($FEISHU)       { Write-Host " Feishu  : $FEISHU_MODE" }
if ($DINGTALK)      { Write-Host " DingTalk: Stream (App: $DINGTALK_CLIENT_ID)" }
Write-Host "------------------------------------------------------------------------"
Write-Host " Inner brain starts on first set_goal, idle when no task."
Write-Host "------------------------------------------------------------------------"
Write-Host ""

& $tsxCmd "$ScriptDir\src\cli\outer-brain.ts" @OB_ARGS
