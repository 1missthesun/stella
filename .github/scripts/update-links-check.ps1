# Runs packages/desktop/scripts/check-update-links.mjs against a Stella the
# Windows launcher installed (STELLA_LAUNCHER_ROOT), with the app's own
# Electron (as Node), git and bun, the way Stella takes a change.
#
# The runner's account is an elevated administrator, which may create plain
# directory symlinks; a normal user can't (that is the bug this guards). So it
# runs under a Basic User token (runas /trustlevel) when the runner allows it,
# and says which it was: the check's first line reports whether this process
# could make a plain directory symlink ("plainDirectorySymlink").
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [Parameter(Mandatory = $true)][string]$Out
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Out | Out-Null

$app = Get-ChildItem -Path $Root -Directory -Recurse -Depth 3 -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq "app" -and (Test-Path (Join-Path $_.FullName "packages\desktop\scripts\check-update-links.mjs")) } |
  Select-Object -First 1
if (-not $app) { throw "No installed app with check-update-links.mjs under $Root" }
$app = $app.FullName
$electron = Join-Path $app "node_modules\electron\dist\electron.exe"
$git = Get-ChildItem -Path (Join-Path $Root "runtimes") -Filter git.exe -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match "\\cmd\\git\.exe$|\\bin\\git\.exe$" } | Select-Object -First 1
$bun = Get-ChildItem -Path (Join-Path $Root "runtimes") -Filter bun.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
Write-Host "app: $app"
Write-Host "electron: $electron"
Write-Host "git: $($git.FullName)"
Write-Host "bun: $($bun.FullName)"
if (-not (Test-Path $electron)) { throw "No Electron at $electron" }

$scratch = Join-Path $env:RUNNER_TEMP "stella-links-scratch"
$log = Join-Path $Out "check.jsonl"
$done = Join-Path $Out "exit-code.txt"
$cmd = Join-Path $Out "check.cmd"
$lines = @(
  "@echo off",
  "set ELECTRON_RUN_AS_NODE=1",
  "set `"TEMP=$env:RUNNER_TEMP\links-temp`"",
  "set `"TMP=$env:RUNNER_TEMP\links-temp`""
)
if ($git) { $lines += "set `"STELLA_GIT_BIN=$($git.FullName)`""; $lines += "set `"PATH=$(Split-Path $git.FullName);%PATH%`"" }
if ($bun) { $lines += "set `"STELLA_BUN_PATH=$($bun.FullName)`"" }
$lines += "`"$electron`" `"$app\packages\desktop\scripts\check-update-links.mjs`" --app `"$app`" --scratch `"$scratch`" --draft --apply > `"$log`" 2>&1"
$lines += "echo %ERRORLEVEL%> `"$done`""
New-Item -ItemType Directory -Force -Path "$env:RUNNER_TEMP\links-temp" | Out-Null
Set-Content -Path $cmd -Value $lines -Encoding ascii

# Let a Basic User token write where the check works.
foreach ($dir in @($Root, $Out, "$env:RUNNER_TEMP\links-temp")) {
  icacls $dir /grant "*S-1-5-32-545:(OI)(CI)M" /T /Q | Out-Null
}
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
icacls $scratch /grant "*S-1-5-32-545:(OI)(CI)M" /Q | Out-Null

$mode = "basic-user"
Remove-Item -Force -ErrorAction SilentlyContinue $done, $log
runas /trustlevel:0x20000 "cmd /c `"$cmd`""
$deadline = (Get-Date).AddMinutes(40)
while (-not (Test-Path $done) -and (Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 5
  if (-not (Test-Path $log) -and (Get-Date) -gt $deadline.AddMinutes(-39)) { break }
}
if (-not (Test-Path $done)) {
  Write-Host "Couldn't run as a Basic User here; running as the runner's account instead."
  $mode = "runner-account"
  Remove-Item -Force -ErrorAction SilentlyContinue $done, $log
  & cmd /c "`"$cmd`""
}
Write-Host "ran as: $mode"
if (Test-Path $log) { Get-Content $log | Where-Object { $_ -notmatch '^\{"log"' } }
$code = if (Test-Path $done) { (Get-Content $done -Raw).Trim() } else { "missing" }
Write-Host "check exit code: $code"
if ($code -ne "0") { exit 1 }
