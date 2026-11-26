// Body for `session.ts eval`: starts the voice media page, connects a loopback RTCPeerConnection
// pair carrying the default microphone, and reports ICE, received audio, Chromium's audio output,
// start time and memory.
const { execSync } = await import("node:child_process");
const { readFileSync } = await import("node:fs");
const voice = stella.host.voice;
const t0 = performance.now();
const release = await voice.use();
const readyMs = performance.now() - t0;
try {
  const host = voice.chromiumHost;
  const loop = host ? await host.evaluate(`(async () => {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    const track = mic.getAudioTracks()[0];
    const a = new RTCPeerConnection(), b = new RTCPeerConnection();
    const candidates = { a: [], b: [] };
    a.onicecandidate = (e) => { if (e.candidate) { candidates.a.push(e.candidate.type); b.addIceCandidate(e.candidate); } };
    b.onicecandidate = (e) => { if (e.candidate) { candidates.b.push(e.candidate.type); a.addIceCandidate(e.candidate); } };
    a.addTrack(track, mic);
    const remote = new Promise((resolve) => (b.ontrack = (e) => resolve(e.streams[0] ?? new MediaStream([e.track]))));
    await a.setLocalDescription(); await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(); await a.setRemoteDescription(b.localDescription);
    const stream = await remote;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const el = new Audio(); el.srcObject = stream; await el.play().catch(() => {});
    const tone = ctx.createOscillator(); const gain = ctx.createGain(); gain.gain.value = 0.2; tone.connect(gain).connect(ctx.destination); tone.start();
    await new Promise((r) => setTimeout(r, 3000));
    const buf = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(buf);
    const remoteRms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
    let inbound = null, outbound = null;
    (await b.getStats()).forEach((s) => { if (s.type === "inbound-rtp" && s.kind === "audio") inbound = { bytes: s.bytesReceived, packets: s.packetsReceived, audioLevel: s.audioLevel, energy: s.totalAudioEnergy }; });
    (await a.getStats()).forEach((s) => { if (s.type === "outbound-rtp" && s.kind === "audio") outbound = { bytes: s.bytesSent, packets: s.packetsSent }; });
    const state = { a: a.connectionState, b: b.connectionState, ice: a.iceConnectionState };
    globalThis.__voiceCheckStop = () => { tone.stop(); el.pause(); a.close(); b.close(); track.stop(); ctx.close(); };
    return { micLabel: track.label, micSettings: track.getSettings().deviceId ? "device" : "none", candidates, state, inbound, outbound, remoteRms };
  })()`) : null;
  let sinkInputs = null;
  try { sinkInputs = execSync("pactl list sink-inputs | grep -E 'application.name|media.name'", { encoding: "utf8" }).trim(); } catch {}
  if (host) await host.evaluate("globalThis.__voiceCheckStop?.()");
  const stats = host?.stats() ?? null;
  let memory = null;
  if (stats?.pid) {
    const rows = execSync("ps -A -o pid=,ppid=,rss=", { encoding: "utf8" }).trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
    const tree = new Set([stats.pid]);
    for (let grew = true; grew;) { grew = false; for (const [pid, ppid] of rows) if (tree.has(ppid) && !tree.has(pid)) { tree.add(pid); grew = true; } }
    const pssKiB = (pid) => { try { return Number(readFileSync(`/proc/${pid}/smaps_rollup`, "utf8").match(/^Pss:\s+(\d+)/m)?.[1] ?? 0); } catch { return 0; } };
    memory = {
      processes: tree.size,
      rssMiB: Math.round(rows.filter(([pid]) => tree.has(pid)).reduce((s, [, , rss]) => s + rss, 0) / 1024),
      pssMiB: process.platform === "linux" ? Math.round([...tree].reduce((s, pid) => s + pssKiB(pid), 0) / 1024) : null,
    };
  }
  return { host: voice.host, readyMs, caps: voice.caps, stats, memory, loop, sinkInputs };
} finally {
  release();
}
