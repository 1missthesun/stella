// Body for `session.ts eval`: starts the media page in its system WebView and runs a loopback
// RTCPeerConnection pair there carrying a WebAudio tone (no microphone needed), then reports the
// page's capabilities, ICE and received audio. The page posts the result on its bridge.
const media = stella.host.media;
const t0 = performance.now();
const release = await media.use();
const readyMs = performance.now() - t0;
try {
  const e = stella.engine;
  let loop = null;
  const original = media.message;
  media.message = (data) => {
    const m = typeof data === "string" ? (() => { try { return JSON.parse(data); } catch { return null; } })() : data;
    if (m && m.t === "ciLoop") loop = m.result;
    else original.call(media, data);
  };
  await e.webview.eval(media.elementId, `(async () => {
    const a = new RTCPeerConnection(), b = new RTCPeerConnection();
    const candidates = { a: [], b: [] };
    a.onicecandidate = (ev) => { if (ev.candidate) { candidates.a.push(ev.candidate.type); b.addIceCandidate(ev.candidate); } };
    b.onicecandidate = (ev) => { if (ev.candidate) { candidates.b.push(ev.candidate.type); a.addIceCandidate(ev.candidate); } };
    const ctx = new AudioContext(); const tone = ctx.createOscillator(); const dest = ctx.createMediaStreamDestination(); tone.connect(dest); tone.start();
    a.addTrack(dest.stream.getAudioTracks()[0], dest.stream);
    const remote = new Promise((resolve) => (b.ontrack = (ev) => resolve(ev.track.kind)));
    await a.setLocalDescription(); await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(); await a.setRemoteDescription(b.localDescription);
    const kind = await remote; await new Promise((r) => setTimeout(r, 2500));
    let inbound = null; (await b.getStats()).forEach((s) => { if (s.type === "inbound-rtp" && s.kind === "audio") inbound = { bytes: s.bytesReceived, packets: s.packetsReceived }; });
    let devices = []; try { devices = (await navigator.mediaDevices.enumerateDevices()).map((d) => d.kind + ":" + d.label); } catch {}
    let mic = "unknown"; try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); mic = "granted"; } catch (err) { mic = String(err && err.name || err); }
    window.__stellaBridge.post({ t: "ciLoop", result: { kind, candidates, state: b.connectionState, inbound, devices, mic } });
    a.close(); b.close(); ctx.close();
  })().catch((err) => window.__stellaBridge.post({ t: "ciLoop", result: { error: String(err && err.message || err) } }));`);
  for (let i = 0; i < 60 && !loop; i++) await new Promise((r) => setTimeout(r, 250));
  media.message = original;
  return { host: media.host, readyMs, caps: media.caps, loop };
} finally {
  release();
}
