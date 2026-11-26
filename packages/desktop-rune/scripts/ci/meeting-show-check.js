// Body for `session.ts eval`: meeting capture (start, record two segments, stop) and a Show Stella
// recording (toggle on, four seconds, toggle off) through the same renderer API Electron exposes.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = (p) => Promise.resolve(p).then((value) => value, (error) => ({ error: String(error?.message ?? error) }));
const result = {};

result.meetingStatus = await settle(api.meetings.status());
result.meetingStart = await settle(api.meetings.start({ segmentSeconds: 5 }));
if (result.meetingStart?.ok) {
  await sleep(7000);
  result.meetingStop = await settle(api.meetings.stop());
}

result.showStatus = await settle(api.showStella.status());
if (result.showStatus?.available) {
  const recorded = new Promise((resolve) => {
    const off = api.showStella.onRecorded((payload) => { off?.(); resolve(payload); });
    setTimeout(() => resolve(null), 20000);
  });
  result.showStart = await settle(api.showStella.toggle());
  await sleep(4000);
  result.showDuring = await settle(api.showStella.status());
  result.showStop = await settle(api.showStella.toggle());
  const payload = await recorded;
  result.showRecorded = payload ? JSON.parse(JSON.stringify(payload, (k, v) => (typeof v === "string" && v.length > 300 ? `${v.slice(0, 300)}…` : v))) : null;
}
return result;
