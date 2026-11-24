const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG2_L3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES: Record<"1" | "2" | "2.5", number[]> = {
  "1": [44100, 48000, 32000, 0],
  "2": [22050, 24000, 16000, 0],
  "2.5": [11025, 12000, 8000, 0],
};

export const readFrame = (buf: Uint8Array, i: number): { frameLen: number; durationSec: number } | null => {
  if (i + 4 > buf.length) return null;
  if (buf[i] !== 0xff || (buf[i + 1]! & 0xe0) !== 0xe0) return null;
  const versionBits = (buf[i + 1]! >> 3) & 0x03;
  const layerBits = (buf[i + 1]! >> 1) & 0x03;
  if (versionBits === 1 || layerBits !== 1) return null;
  const version = versionBits === 3 ? "1" : versionBits === 2 ? "2" : "2.5";
  const bitrateIndex = (buf[i + 2]! >> 4) & 0x0f;
  const srIndex = (buf[i + 2]! >> 2) & 0x03;
  const padding = (buf[i + 2]! >> 1) & 0x01;
  if (bitrateIndex === 0 || bitrateIndex === 15 || srIndex === 3) return null;
  const bitrateKbps = (version === "1" ? MPEG1_L3_BITRATES : MPEG2_L3_BITRATES)[bitrateIndex]!;
  const sampleRate = SAMPLE_RATES[version][srIndex]!;
  if (!bitrateKbps || !sampleRate) return null;
  const samplesPerFrame = version === "1" ? 1152 : 576;
  const frameLen = Math.floor(((samplesPerFrame / 8) * bitrateKbps * 1000) / sampleRate) + padding;
  if (frameLen < 4) return null;
  return { frameLen, durationSec: samplesPerFrame / sampleRate };
};

export const concat = (parts: Uint8Array[]): Uint8Array => {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const EMPTY = new Uint8Array(0);

const id3Length = (buf: Uint8Array): number | null => {
  if (buf.length < 3 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return 0;
  if (buf.length < 10) return null;
  const size = ((buf[6]! & 0x7f) << 21) | ((buf[7]! & 0x7f) << 14) | ((buf[8]! & 0x7f) << 7) | (buf[9]! & 0x7f);
  return 10 + size + (buf[5]! & 0x10 ? 10 : 0);
};

export const createMp3Framer = () => {
  let pending: Uint8Array = EMPTY;
  let tagSkipped = false;
  let seconds = 0;
  return {
    push(bytes: Uint8Array): Uint8Array {
      pending = pending.length === 0 ? bytes : concat([pending, bytes]);
      if (!tagSkipped) {
        const tag = id3Length(pending);
        if (tag === null || tag > pending.length) return EMPTY;
        pending = pending.subarray(tag);
        tagSkipped = true;
      }
      const frames: Uint8Array[] = [];
      let cursor = 0;
      while (cursor + 4 <= pending.length) {
        const frame = readFrame(pending, cursor);
        if (!frame) {
          cursor += 1;
          continue;
        }
        if (cursor + frame.frameLen > pending.length) break;
        frames.push(pending.subarray(cursor, cursor + frame.frameLen));
        seconds += frame.durationSec;
        cursor += frame.frameLen;
      }
      pending = pending.slice(cursor);
      return frames.length === 0 ? EMPTY : concat(frames);
    },
    get seconds() {
      return seconds;
    },
  };
};
