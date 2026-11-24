// AVPlayer and ExoPlayer cannot play a length-less `audio/mpeg` stream.

import { concat, readFrame } from "./mp3.js";
import { estimateTtsUsage, openTtsAudio, type TtsProvider, type TtsUsage } from "./tts.js";
import { ttsObjectKey } from "./ticket.js";

const TARGET_SEGMENT_SEC = 2.0;
const FIRST_SEGMENT_SEC = 0.6;
const MAX_SEGMENTS = 600;
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const SYNTHESIS_TIMEOUT_MS = 9 * 60_000;
export const HLS_TARGET_DURATION = 3;

export type HlsManifest = {
  segments: number[];
  done: boolean;
  error: boolean;
};

export const HLS_MANIFEST_FILE = "index.json";
export const hlsSegmentFile = (n: number): string => `seg-${n}.mp3`;

export const buildHlsPlaylist = (manifest: HlsManifest): string => {
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-PLAYLIST-TYPE:EVENT",
    `#EXT-X-TARGETDURATION:${HLS_TARGET_DURATION}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
  ];
  manifest.segments.forEach((duration, n) => {
    lines.push(`#EXTINF:${(Number.isFinite(duration) ? duration : 0).toFixed(3)},`);
    lines.push(hlsSegmentFile(n));
  });
  if (manifest.done) lines.push("#EXT-X-ENDLIST");
  return `${lines.join("\n")}\n`;
};

const syncsafe4 = (n: number) => [(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f];

/**
 * The ID3v2.4 PRIV tag with the 90 kHz timestamp of a segment's first
 * sample. Every HLS packed-audio segment must begin with one.
 */
const id3Timestamp = (startSec: number): Uint8Array => {
  const owner = new TextEncoder().encode("com.apple.streaming.transportStreamTimestamp");
  const body = new Uint8Array(owner.length + 1 + 8);
  body.set(owner, 0);
  const ts = BigInt(Math.max(0, Math.round(startSec * 90000)));
  const view = new DataView(body.buffer, owner.length + 1, 8);
  view.setUint32(0, Number((ts >> 32n) & 0xffffffffn));
  view.setUint32(4, Number(ts & 0xffffffffn));
  const frameHeader = new Uint8Array(10);
  frameHeader.set(new TextEncoder().encode("PRIV"), 0);
  frameHeader.set(syncsafe4(body.length), 4);
  const tagHeader = new Uint8Array(10);
  tagHeader.set(new TextEncoder().encode("ID3"), 0);
  tagHeader[3] = 0x04;
  tagHeader.set(syncsafe4(frameHeader.length + body.length), 6);
  return concat([tagHeader, frameHeader, body]);
};

export type HlsSynthesisResult = {
  status: "done" | "error" | "canceled";
  segments: number;
  usage: TtsUsage | null;
  sentChars: number;
  audioSeconds: number;
  firstSegmentMs: number | null;
};

export const synthesizeHls = async (input: {
  bucket: R2Bucket;
  env: object;
  ticket: string;
  text: string;
  voice: string;
  canceled: () => boolean;
}): Promise<HlsSynthesisResult> => {
  const manifest: HlsManifest = { segments: [], done: false, error: false };
  const writeManifest = () =>
    input.bucket.put(ttsObjectKey(input.ticket, HLS_MANIFEST_FILE), JSON.stringify(manifest), {
      httpMetadata: { contentType: "application/json" },
    });
  let provider: TtsProvider | null = null;
  let sentChars = () => 0;
  let frames: Uint8Array[] = [];
  let duration = 0;
  let startSec = 0;
  let audioBytes = 0;
  let capped = false;
  const startedAt = Date.now();
  let firstSegmentMs: number | null = null;
  const finish = async (status: HlsSynthesisResult["status"]): Promise<HlsSynthesisResult> => {
    manifest.done = true;
    manifest.error = status === "error" && manifest.segments.length === 0;
    await writeManifest().catch(() => undefined);
    const audioSeconds = startSec + duration;
    return {
      status,
      segments: manifest.segments.length,
      usage: provider ? estimateTtsUsage(sentChars(), audioSeconds) : null,
      sentChars: sentChars(),
      audioSeconds,
      firstSegmentMs,
    };
  };

  const signal = AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS);
  let source: ReadableStream<Uint8Array>;
  try {
    const opened = await openTtsAudio(input.env, { text: input.text, voice: input.voice, signal });
    provider = opened.provider;
    source = opened.mp3;
    sentChars = opened.sentChars;
  } catch (error) {
    console.error(JSON.stringify({
      event: "tts_hls_provider_failed",
      message: error instanceof Error ? error.message : String(error),
    }));
    return await finish("error");
  }

  const cut: { bytes: Uint8Array; duration: number }[] = [];
  const cutSegment = () => {
    if (frames.length === 0) return;
    cut.push({ bytes: concat([id3Timestamp(startSec), ...frames]), duration });
    startSec += duration;
    frames = [];
    duration = 0;
  };
  const publish = async () => {
    if (cut.length === 0) return;
    const batch = cut.splice(0);
    const first = manifest.segments.length;
    await Promise.all(
      batch.map((segment, index) =>
        input.bucket.put(ttsObjectKey(input.ticket, hlsSegmentFile(first + index)), segment.bytes, {
          httpMetadata: { contentType: "audio/mpeg" },
        }),
      ),
    );
    manifest.segments.push(...batch.map((segment) => segment.duration));
    await writeManifest();
    firstSegmentMs ??= Date.now() - startedAt;
  };

  const ingest = async (mp3: Uint8Array) => {
    let cursor = 0;
    while (cursor < mp3.length) {
      if (manifest.segments.length + cut.length >= MAX_SEGMENTS || audioBytes >= MAX_AUDIO_BYTES) {
        capped = true;
        break;
      }
      const frame = readFrame(mp3, cursor);
      if (!frame) break;
      frames.push(mp3.slice(cursor, cursor + frame.frameLen));
      audioBytes += frame.frameLen;
      duration += frame.durationSec;
      cursor += frame.frameLen;
      const target = manifest.segments.length + cut.length === 0 ? FIRST_SEGMENT_SEC : TARGET_SEGMENT_SEC;
      if (duration >= target) cutSegment();
    }
    await publish();
  };

  const reader = source.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) await ingest(value);
      if (input.canceled() || capped) {
        await reader.cancel().catch(() => undefined);
        return await finish(capped ? "done" : "canceled");
      }
    }
    if (!capped) {
      cutSegment();
      await publish();
    }
    return await finish(manifest.segments.length > 0 ? "done" : "error");
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    console.error(JSON.stringify({
      event: "tts_hls_failed",
      message: error instanceof Error ? error.message : String(error),
    }));
    return await finish("error");
  }
};
