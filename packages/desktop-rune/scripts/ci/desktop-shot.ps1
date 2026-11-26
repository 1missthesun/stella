# Windows CI: lists visible top-level windows, minimizes the runner's own console, and saves the screen.
param([Parameter(Mandatory)][string]$Png, [Parameter(Mandatory)][string]$List)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  public static List<string> List(bool minimizeRunner) {
    var rows = new List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      if (t.Length == 0) return true;
      RECT r; GetWindowRect(h, out r); uint pid; GetWindowThreadProcessId(h, out pid);
      string name = ""; try { name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch {}
      rows.Add(String.Format("{0} pid {1} ({2}) [{3},{4} {5}x{6}]{7} {8}", h, pid, name, r.L, r.T, r.R - r.L, r.B - r.T, IsIconic(h) ? " minimized" : "", t));
      if (minimizeRunner && t.ToString().StartsWith(@"C:\ProgramData\GitHub")) ShowWindow(h, 6);
      return true;
    }, IntPtr.Zero);
    return rows;
  }
}
'@
[Win]::List($true) | Set-Content -Path $List
Start-Sleep -Milliseconds 800
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$i = New-Object System.Drawing.Bitmap $b.Width, $b.Height
[System.Drawing.Graphics]::FromImage($i).CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$i.Save($Png)
