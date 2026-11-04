param([string]$Out, [string[]]$Variants = @("current"))
$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public static string Under(int x, int y) {
    POINT p; p.X = x; p.Y = y;
    IntPtr h = GetAncestor(WindowFromPoint(p), 2);
    var t = new StringBuilder(256); GetWindowText(h, t, 256);
    return String.Format("0x{0:X} '{1}'", h.ToInt64(), t);
  }
  public static string Ex(string title) {
    IntPtr h = FindWindow(null, title);
    if (h == IntPtr.Zero) return title + ": not found";
    return String.Format("{0}: exstyle=0x{1:X8}", title, GetWindowLong(h, -20));
  }
}
"@
[W]::SetProcessDPIAware() | Out-Null
function Shot([string]$name) {
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
  $bmp.Save("$Out\$name.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
function Note([string]$v, [string]$s) { "$(Get-Date -Format HH:mm:ss.fff) $s" | Tee-Object -Append "$Out\drive-$v.txt" }
function Styles([string]$v, [int]$x, [int]$y) {
  Note $v ("  " + [W]::Ex("pet-mark") + " | " + [W]::Ex("pet-panel") + " | under cursor: " + [W]::Under($x, $y))
}
function MoveTo([int]$x0, [int]$y0, [int]$x1, [int]$y1, [int]$steps = 15) {
  for ($i = 1; $i -le $steps; $i++) {
    [W]::SetCursorPos([int]($x0 + ($x1 - $x0) * $i / $steps), [int]($y0 + ($y1 - $y0) * $i / $steps)) | Out-Null
    [W]::mouse_event(1, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 25
  }
}
$results = @()
foreach ($v in $Variants) {
  $env:VARIANT = $v; $env:OUT = $Out
  $p = Start-Process -FilePath "$PSScriptRoot\node_modules\electron\dist\electron.exe" -ArgumentList "`"$PSScriptRoot`"" -PassThru
  Note $v "variant $v electron pid $($p.Id)"
  $state = $null
  for ($i = 0; $i -lt 60 -and -not $state; $i++) { Start-Sleep -Milliseconds 500; if (Test-Path "$Out\state-$v.json") { $state = Get-Content "$Out\state-$v.json" -Raw | ConvertFrom-Json } }
  if (-not $state) { Note $v "harness never came up"; Stop-Process -Id $p.Id -Force; continue }
  Start-Sleep -Seconds 2
  $s = [double]$state.scale
  $ax = [int]($state.anchor.x * $s); $ay = [int]($state.anchor.y * $s)
  $cx = $ax; $cy = [int](($state.anchor.y - 42) * $s)
  Note $v "anchor $($state.anchor.x),$($state.anchor.y) scale $s pet centre (px) $cx,$cy mark $($state.markBounds | ConvertTo-Json -Compress)"
  Shot "$v-0-shown"
  Styles $v $cx $cy
  MoveTo ($cx - 300) ($cy - 200) $cx $cy
  Start-Sleep -Milliseconds 900
  Note $v "hovering"; Styles $v $cx $cy
  Shot "$v-1-hover"
  [W]::mouse_event(2, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 90; [W]::mouse_event(4, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 900
  $after = Get-Content "$Out\state-$v.json" -Raw | ConvertFrom-Json
  Note $v "after click: clicks=$($after.clicks) expanded=$($after.expanded)"; Styles $v $cx $cy
  Shot "$v-2-after-click"
  [W]::mouse_event(2, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 90; [W]::mouse_event(4, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 900
  MoveTo $cx $cy ($cx - 40) ($cy - 30) 4
  MoveTo ($cx - 40) ($cy - 30) $cx $cy 4
  Start-Sleep -Milliseconds 900
  $before = Get-Content "$Out\state-$v.json" -Raw | ConvertFrom-Json
  Note $v "before drag: anchor $($before.anchor.x),$($before.anchor.y) clicks=$($before.clicks)"; Styles $v $cx $cy
  [W]::mouse_event(2, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 120
  MoveTo $cx $cy ($cx - 400) ($cy - 250) 30
  Start-Sleep -Milliseconds 200
  [W]::mouse_event(4, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 1200
  $end = Get-Content "$Out\state-$v.json" -Raw | ConvertFrom-Json
  $moved = ($end.anchor.x -ne $before.anchor.x) -or ($end.anchor.y -ne $before.anchor.y)
  Note $v "after drag: anchor $($end.anchor.x),$($end.anchor.y) dragStarts=$($end.dragStarts) dragEnds=$($end.dragEnds) moved=$moved"
  Styles $v ($cx - 400) ($cy - 250)
  Shot "$v-3-after-drag"
  $results += [pscustomobject]@{ variant = $v; clickOpened = ($after.clicks -ge 1 -and $after.expanded); clicks = $end.clicks; dragMoved = $moved; dragEnds = $end.dragEnds }
  Stop-Process -Id $p.Id -Force
  Start-Sleep -Seconds 2
  MoveTo ($cx - 400) ($cy - 250) 10 10 5
}
$results | Format-Table -AutoSize | Out-String | Tee-Object "$Out\summary.txt"
