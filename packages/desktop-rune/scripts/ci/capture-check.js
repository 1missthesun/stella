// Body for `session.ts eval`: lists capture sources, records the primary screen for three seconds
// through the engine's capture API (Show Stella's recorder path), and runs the global input hook
// while PowerShell moves the pointer and taps a key. Reports the MP4, frames and hook events.
const { mkdtempSync, readdirSync, statSync } = await import("node:fs");
const { spawnSync } = await import("node:child_process");
const os = await import("node:os");
const path = await import("node:path");
const e = stella.engine;
const result = {};

const sources = await e.capture.sources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 } });
result.sources = sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail ? s.thumbnail.length : 0 }));
const screen = sources.find((s) => s.id.startsWith("screen:"));
if (screen) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "stella-capture-"));
  const file = path.join(dir, "recording.mp4");
  const framesDir = path.join(dir, "frames");
  const started = await e.capture.start({
    id: "ci", sourceId: screen.id, width: 1280, height: 720, fps: 30, file, framesDir,
    frameIntervalMs: 500, frameEdge: 1280, jpegQuality: 0.8, microphone: false,
  });
  await new Promise((r) => setTimeout(r, 3000));
  const stopped = await e.capture.stop("ci");
  const frames = readdirSync(framesDir).filter((f) => f.endsWith(".jpg")).sort();
  result.capture = {
    started, stopped, dir,
    bytes: stopped.file ? statSync(stopped.file).size : 0,
    frames: frames.length,
    firstFrame: frames[0] ? path.join(framesDir, frames[0]) : null,
  };
}

const events = [];
const off = stella.on("inputhook", (ev) => events.push({ type: ev.type, rawcode: ev.rawcode, x: ev.x, y: ev.y }));
try {
  result.hookStart = await e.inputHook.start();
  await new Promise((r) => setTimeout(r, 300));
  const ps = `Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class U {
  [StructLayout(LayoutKind.Sequential)] public struct MI { public int dx, dy; public uint data, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KI { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct IN { [FieldOffset(0)] public uint type; [FieldOffset(8)] public MI mi; [FieldOffset(8)] public KI ki; }
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, IN[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static string Mouse(uint flags, int dx, uint data) { var i = new IN[1]; i[0].type = 0; i[0].mi.dx = dx; i[0].mi.flags = flags; i[0].mi.data = data; var n = SendInput(1, i, Marshal.SizeOf(typeof(IN))); return n + "/" + Marshal.GetLastWin32Error(); }
  public static string Key(ushort vk, uint flags) { var i = new IN[1]; i[0].type = 1; i[0].ki.vk = vk; i[0].ki.flags = flags; var n = SendInput(1, i, Marshal.SizeOf(typeof(IN))); return n + "/" + Marshal.GetLastWin32Error(); }
  public delegate IntPtr HookProc(int code, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr w, l; public uint time; public int x, y; }
  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SetWindowsHookExW(int id, HookProc proc, IntPtr mod, uint thread);
  [DllImport("user32.dll")] public static extern bool UnhookWindowsHookEx(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PeekMessageW(out MSG m, IntPtr h, uint a, uint b, uint remove);
  [DllImport("kernel32.dll")] public static extern IntPtr GetModuleHandleW(string name);
  static HookProc keep; static int seen;
  public static string OwnHookProbe() {
    keep = (c, w, l) => { if (c >= 0) seen++; return CallNextHookEx(IntPtr.Zero, c, w, l); };
    var h = SetWindowsHookExW(13, keep, GetModuleHandleW(null), 0);
    if (h == IntPtr.Zero) return "hook failed " + Marshal.GetLastWin32Error();
    Key(0x43, 0); Key(0x43, 2);
    var until = DateTime.Now.AddMilliseconds(400); MSG m;
    while (DateTime.Now < until) { PeekMessageW(out m, IntPtr.Zero, 0, 0, 1); System.Threading.Thread.Sleep(5); }
    UnhookWindowsHookEx(h);
    return "own keyboard hook saw " + seen;
  }
  public static string Foreground() { var h = GetForegroundWindow(); var s = new StringBuilder(256); GetWindowText(h, s, 256); return h + " " + s; }
}
'@
    [U]::SetCursorPos(200, 300) | Out-Null; foreach ($i in 1..10) { [U]::Mouse(1, 5, 0) | Out-Null; Start-Sleep -Milliseconds 20 }
    "size " + [System.Runtime.InteropServices.Marshal]::SizeOf([type][U+IN])
    "foreground " + [U]::Foreground()
    "keydown " + [U]::Key(0x41, 0); Start-Sleep -Milliseconds 30; "keyup " + [U]::Key(0x41, 2)
    "wheel " + [U]::Mouse(0x0800, 0, 120)
    [U]::OwnHookProbe()`;
  const run = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", timeout: 90_000, stdio: ["ignore", "pipe", "pipe"] });
  result.synth = { status: run.status, signal: run.signal, stdout: (run.stdout ?? "").trim().split(/\r?\n/), stderr: (run.stderr ?? "").slice(0, 500) };
  await new Promise((r) => setTimeout(r, 500));
  result.hookStop = await e.inputHook.stop();
} catch (error) {
  result.hookError = String(error?.message ?? error);
} finally {
  off();
}
const counts = {};
for (const ev of events) counts[ev.type] = (counts[ev.type] ?? 0) + 1;
result.hookEvents = counts;
result.hookSample = events.filter((ev) => ev.type !== "mousemove").slice(0, 12).concat(events.filter((ev) => ev.type === "mousemove").slice(0, 3));
return result;
