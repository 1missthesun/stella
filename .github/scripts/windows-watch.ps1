param([string]$Exe, [string]$Out, [double]$Minutes = 12)
$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  public static string ClickStart() {
    IntPtr h = FindWindow("StellaLauncherWindow", null);
    if (h == IntPtr.Zero) return "no launcher window";
    SetForegroundWindow(h);
    RECT r; GetWindowRect(h, out r);
    int x = (r.L + r.R) / 2, y = r.B - 8 - 46 - 53;
    SetCursorPos(x, y); mouse_event(2, 0, 0, 0, IntPtr.Zero); mouse_event(4, 0, 0, 0, IntPtr.Zero);
    return String.Format("clicked {0},{1}", x, y);
  }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static List<string> List() {
    var o = new List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var t = new StringBuilder(512); GetWindowText(h, t, 512);
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      uint pid; GetWindowThreadProcessId(h, out pid);
      RECT r; GetWindowRect(h, out r);
      if (t.Length == 0 && (r.R - r.L) < 50) return true;
      o.Add(String.Format("pid={0} class={1} title='{2}' rect={3},{4},{5},{6}", pid, c, t, r.L, r.T, r.R, r.B));
      return true;
    }, IntPtr.Zero);
    return o;
  }
}
"@

function Shot([string]$name) {
  try {
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
    $bmp.Save("$Out\$name.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
  } catch { "screenshot failed: $_" | Add-Content "$Out\watch.txt" }
}

$start = Get-Date
"start $start exe=$Exe" | Set-Content "$Out\watch.txt"
$proc = Start-Process -FilePath $Exe -PassThru
"launcher pid $($proc.Id)" | Add-Content "$Out\watch.txt"
$i = 0
while (((Get-Date) - $start).TotalMinutes -lt $Minutes) {
  Start-Sleep -Seconds ($(if ($i -lt 6) { 10 } else { 30 }))
  $i++
  $tag = "{0:D3}-{1:D4}s" -f $i, [int]((Get-Date) - $start).TotalSeconds
  "=== $tag" | Add-Content "$Out\watch.txt"
  Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'Stella|electron|bun|git|msedgewebview2|node' } |
    ForEach-Object { "  proc $($_.ProcessId) parent=$($_.ParentProcessId) $($_.Name) $($_.CommandLine)".Substring(0, [Math]::Min(400, ("  proc $($_.ProcessId) parent=$($_.ParentProcessId) $($_.Name) $($_.CommandLine)").Length)) } |
    Add-Content "$Out\watch.txt"
  [Win]::List() | ForEach-Object { "  win $_" } | Add-Content "$Out\watch.txt"
  if ($i -eq 3) {
    "  clicking Start in the launcher page" | Add-Content "$Out\watch.txt"
    Shot "$tag-before-click"
    "  $([Win]::ClickStart())" | Add-Content "$Out\watch.txt"
    Start-Sleep -Seconds 2
  }
  Shot $tag
}
"done $(Get-Date)" | Add-Content "$Out\watch.txt"
