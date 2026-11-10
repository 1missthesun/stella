import type { ShowStellaTranscript } from "@stella/contracts/desktop/show-stella";
import {
  resolveDictationRoute,
  transcribeDictation,
} from "@/features/dictation/services/dictation-transcriber";
import { transcribeOnDevice } from "@/features/dictation/services/on-device-dictation";

/**
 * A capture's words, with times on the capture's clock, from whichever
 * dictation engine the user is on. Apple's on-device recognizer measures each
 * word. The cloud engines return text only, so the sound is cut at its pauses
 * and each stretch of speech is transcribed on its own: every stretch then
 * starts and ends where the speech did, and its words are spread over the
 * speech inside it (`estimated`).
 */

const SAMPLE_RATE = 16_000;
const HEADER_BYTES = 44;
const FRAME_MS = 20;
const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;
/** Silence this long ends a stretch of speech. */
const PAUSE_MS = 550;
/** A pause this long inside a stretch doesn't hold words. */
const INNER_PAUSE_MS = 240;
const MIN_SPEECH_MS = 220;
const PAD_MS = 160;
/** Stretches longer than this are cut at their quietest moment. */
const MAX_CLIP_MS = 20_000;
const MIN_CLIP_MS = 6_000;
/** Speech is this far above the quietest stretch of the recording, and at least -50 dBFS. */
const NOISE_PERCENTILE = 0.15;
const NOISE_FACTOR = 3;
const MIN_LEVEL = 100;
const CONCURRENCY = 3;
const SEGMENT_PAUSE_MS = 700;

type Run = { start: number; end: number };
type Clip = { start: number; end: number; speech: Run[] };

const readPcm = (wav: ArrayBuffer): Int16Array =>
  new Int16Array(wav, HEADER_BYTES, Math.floor((wav.byteLength - HEADER_BYTES) / 2));

const wavOf = (pcm: Int16Array): ArrayBuffer => {
  const dataBytes = pcm.length * 2;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataBytes, true);
  new Int16Array(buffer, HEADER_BYTES).set(pcm);
  return buffer;
};

const frameLevels = (pcm: Int16Array): Float32Array => {
  const frames = Math.floor(pcm.length / FRAME_SAMPLES);
  const levels = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    const offset = f * FRAME_SAMPLES;
    for (let i = 0; i < FRAME_SAMPLES; i += 1) {
      const v = pcm[offset + i]!;
      sum += v * v;
    }
    levels[f] = Math.sqrt(sum / FRAME_SAMPLES);
  }
  return levels;
};

/** Stretches of speech, in ms, with the speech runs inside each. */
export const speechClips = (pcm: Int16Array): Clip[] => {
  const levels = frameLevels(pcm);
  if (levels.length === 0) return [];
  const sorted = Float32Array.from(levels).sort();
  const noise = sorted[Math.floor(sorted.length * NOISE_PERCENTILE)] ?? 0;
  const threshold = Math.max(MIN_LEVEL, noise * NOISE_FACTOR);
  const runs: Run[] = [];
  let open: number | null = null;
  for (let f = 0; f < levels.length; f += 1) {
    const loud = levels[f]! >= threshold;
    if (loud && open === null) open = f;
    if (!loud && open !== null) {
      runs.push({ start: open * FRAME_MS, end: f * FRAME_MS });
      open = null;
    }
  }
  if (open !== null) runs.push({ start: open * FRAME_MS, end: levels.length * FRAME_MS });

  // Close gaps between runs that are shorter than a breath.
  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && run.start - last.end < INNER_PAUSE_MS) last.end = run.end;
    else merged.push({ ...run });
  }

  const clips: Clip[] = [];
  for (const run of merged) {
    const last = clips[clips.length - 1];
    if (last && run.start - last.speech[last.speech.length - 1]!.end < PAUSE_MS) {
      last.speech.push(run);
    } else {
      clips.push({ start: run.start, end: run.end, speech: [run] });
    }
  }
  const total = levels.length * FRAME_MS;
  const kept = clips
    .map((clip) => ({
      ...clip,
      start: clip.speech[0]!.start,
      end: clip.speech[clip.speech.length - 1]!.end,
    }))
    .filter((clip) => clip.speech.reduce((sum, r) => sum + (r.end - r.start), 0) >= MIN_SPEECH_MS);

  const out: Clip[] = [];
  for (const clip of kept) out.push(...splitLong(clip, levels));
  return out.map((clip) => ({
    ...clip,
    start: Math.max(0, clip.start - PAD_MS),
    end: Math.min(total, clip.end + PAD_MS),
  }));
};

/** Cuts a stretch longer than MAX_CLIP_MS at its quietest gap, recursively. */
const splitLong = (clip: Clip, levels: Float32Array): Clip[] => {
  if (clip.end - clip.start <= MAX_CLIP_MS || clip.speech.length < 2) return [clip];
  let best = -1;
  let bestGap = -1;
  for (let i = 1; i < clip.speech.length; i += 1) {
    const cut = clip.speech[i]!.start;
    if (cut - clip.start < MIN_CLIP_MS || clip.end - cut < MIN_CLIP_MS / 2) continue;
    const gap = clip.speech[i]!.start - clip.speech[i - 1]!.end;
    if (gap > bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  if (best < 0) {
    // One unbroken run: cut at the quietest frame in its middle.
    const from = Math.floor((clip.start + MIN_CLIP_MS) / FRAME_MS);
    const to = Math.floor((clip.end - MIN_CLIP_MS / 2) / FRAME_MS);
    let quiet = from;
    for (let f = from; f < to; f += 1) if (levels[f]! < levels[quiet]!) quiet = f;
    const at = quiet * FRAME_MS;
    const left: Run[] = [];
    const right: Run[] = [];
    for (const run of clip.speech) {
      if (run.end <= at) left.push(run);
      else if (run.start >= at) right.push(run);
      else {
        left.push({ start: run.start, end: at });
        right.push({ start: at, end: run.end });
      }
    }
    if (!left.length || !right.length || to <= from) return [clip];
    return [
      ...splitLong({ start: clip.start, end: at, speech: left }, levels),
      ...splitLong({ start: at, end: clip.end, speech: right }, levels),
    ];
  }
  const left = clip.speech.slice(0, best);
  const right = clip.speech.slice(best);
  return [
    ...splitLong({ start: left[0]!.start, end: left[left.length - 1]!.end, speech: left }, levels),
    ...splitLong({ start: right[0]!.start, end: right[right.length - 1]!.end, speech: right }, levels),
  ];
};

/**
 * Spreads a stretch's words over the speech inside it, in proportion to their
 * length, skipping the pauses between runs.
 */
const spreadWords = (text: string, clip: Clip) => {
  const tokens = text.split(/\s+/).filter(Boolean);
  const weights = tokens.map((token) => token.length + 2);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const runs = clip.speech;
  const speech = runs.reduce((sum, r) => sum + (r.end - r.start), 0);
  const at = (offset: number) => {
    let left = offset;
    for (const run of runs) {
      const length = run.end - run.start;
      if (left <= length) return run.start + left;
      left -= length;
    }
    return runs[runs.length - 1]!.end;
  };
  let used = 0;
  return tokens.map((token, i) => {
    const t0 = at((used / totalWeight) * speech);
    used += weights[i]!;
    const t1 = at((used / totalWeight) * speech);
    return { text: token, t0: Math.round(t0), t1: Math.round(Math.max(t0 + 1, t1)) };
  });
};

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};

/** Sentences, or runs of words split at long pauses. */
const segmentsOf = (words: ShowStellaTranscript["words"]) => {
  const segments: ShowStellaTranscript["segments"] = [];
  let current: typeof words = [];
  const flush = () => {
    if (current.length === 0) return;
    segments.push({
      t0: current[0]!.t0,
      t1: current[current.length - 1]!.t1,
      text: current.map((w) => w.text).join(" "),
    });
    current = [];
  };
  for (const word of words) {
    const last = current[current.length - 1];
    if (last && word.t0 - last.t1 > SEGMENT_PAUSE_MS) flush();
    current.push(word);
    if (/[.!?…]["”’)]?$/.test(word.text) && current.length >= 3) flush();
  }
  flush();
  return segments;
};

const missing = (reason: string): ShowStellaTranscript => ({
  source: "none",
  text: "",
  segments: [],
  words: [],
  missing: { reason },
});

export const transcribeCapture = async (wav: ArrayBuffer | null): Promise<ShowStellaTranscript> => {
  if (!wav || wav.byteLength <= HEADER_BYTES) return missing("Nothing was recorded from the microphone.");
  const pcm = readPcm(wav);
  const clips = speechClips(pcm);
  if (clips.length === 0) {
    return { source: "none", text: "", segments: [], words: [] };
  }
  const route = await resolveDictationRoute().catch(() => "needs-key" as const);
  if (route === "needs-key") {
    return missing("Dictation isn't set up on this computer, so there are no words.");
  }
  if (route === "on-device") {
    const result = await transcribeOnDevice(wav);
    const words = result.words
      .filter((w) => w.w.trim())
      .map((w) => ({ text: w.w.trim(), t0: Math.round(w.s * 1000), t1: Math.round(w.e * 1000) }));
    if (words.length > 0) {
      return { source: "on-device", text: result.text, segments: segmentsOf(words), words };
    }
    if (!result.text.trim()) return { source: "on-device", text: "", segments: [], words: [] };
    // Text without times: spread it like the cloud engines' answers.
    const whole: Clip = { start: clips[0]!.start, end: clips[clips.length - 1]!.end, speech: clips.flatMap((c) => c.speech) };
    const spread = spreadWords(result.text, whole);
    return { source: "on-device", text: result.text, segments: segmentsOf(spread), words: spread, estimated: true };
  }
  const texts = await mapLimit(clips, CONCURRENCY, async (clip) => {
    const from = Math.floor((clip.start * SAMPLE_RATE) / 1000);
    const to = Math.min(pcm.length, Math.ceil((clip.end * SAMPLE_RATE) / 1000));
    try {
      return (await transcribeDictation(wavOf(pcm.subarray(from, to)))).trim();
    } catch (error) {
      console.warn("[show-stella] a stretch of speech wasn't transcribed:", (error as Error)?.message);
      return null;
    }
  });
  if (texts.every((text) => text === null)) {
    return missing("Dictation couldn't be reached, so there are no words.");
  }
  const words: ShowStellaTranscript["words"] = [];
  const segments: ShowStellaTranscript["segments"] = [];
  clips.forEach((clip, i) => {
    const text = texts[i];
    if (!text) return;
    const speechStart = clip.speech[0]!.start;
    const speechEnd = clip.speech[clip.speech.length - 1]!.end;
    segments.push({ t0: speechStart, t1: speechEnd, text });
    words.push(...spreadWords(text, clip));
  });
  return {
    source: route === "openrouter" ? "openrouter" : "managed",
    text: segments.map((s) => s.text).join(" "),
    segments,
    words,
    estimated: true,
  };
};
