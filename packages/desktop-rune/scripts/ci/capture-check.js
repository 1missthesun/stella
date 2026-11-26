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
const off = stella.on("inputhook", (ev) => events.push(ev.type));
try {
  result.hookStart = await e.inputHook.start();
  await new Promise((r) => setTimeout(r, 300));
  const ps = `Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, System.UIntPtr e); [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, System.UIntPtr e);';
    foreach ($i in 1..10) { [W.U]::SetCursorPos(200 + $i * 20, 300); Start-Sleep -Milliseconds 20 }
    [W.U]::keybd_event(0x10, 0, 0, [System.UIntPtr]::Zero); [W.U]::keybd_event(0x10, 0, 2, [System.UIntPtr]::Zero);
    [W.U]::mouse_event(0x0800, 0, 0, 120, [System.UIntPtr]::Zero)`;
  const run = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
  result.synth = { status: run.status, stderr: run.stderr.slice(0, 500) };
  await new Promise((r) => setTimeout(r, 500));
  result.hookStop = await e.inputHook.stop();
} catch (error) {
  result.hookError = String(error?.message ?? error);
} finally {
  off();
}
const counts = {};
for (const t of events) counts[t] = (counts[t] ?? 0) + 1;
result.hookEvents = counts;
return result;
