# Grabs the launcher window from the screen, not through WebView2: a webview
# that renders but never presents (CapturePreview still works) shows blank.
# Exits 1 when the window never appears or its client area is one flat color.
param([string]$Out, [int]$TimeoutSeconds = 180)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class LauncherWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
}
"@
New-Item -ItemType Directory -Force $Out | Out-Null
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$hwnd = [IntPtr]::Zero
while ((Get-Date) -lt $deadline) {
  $hwnd = [LauncherWindow]::FindWindow("StellaLauncherWindow", [NullString]::Value)
  if ($hwnd -ne [IntPtr]::Zero -and [LauncherWindow]::IsWindowVisible($hwnd)) { break }
  Start-Sleep -Milliseconds 250
}
if ($hwnd -eq [IntPtr]::Zero -or -not [LauncherWindow]::IsWindowVisible($hwnd)) {
  Write-Host "launcher window check: the window never showed"
  exit 1
}
Start-Sleep -Seconds 3
[LauncherWindow]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 500
$rc = New-Object LauncherWindow+RECT
[LauncherWindow]::GetClientRect($hwnd, [ref]$rc) | Out-Null
$origin = New-Object LauncherWindow+POINT
[LauncherWindow]::ClientToScreen($hwnd, [ref]$origin) | Out-Null
$w = $rc.R - $rc.L; $h = $rc.B - $rc.T
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($origin.X, $origin.Y, 0, 0, $bmp.Size)
$bmp.Save((Join-Path $Out "window-on-screen.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$colors = @{}
for ($y = 0; $y -lt $h; $y += 3) { for ($x = 0; $x -lt $w; $x += 3) { $colors[$bmp.GetPixel($x, $y).ToArgb()] = 1 } }
$g.Dispose(); $bmp.Dispose()
Write-Host "launcher window check: ${w}x${h}, $($colors.Count) distinct colors"
if ($colors.Count -lt 8) { Write-Host "launcher window check: the window is blank"; exit 1 }
