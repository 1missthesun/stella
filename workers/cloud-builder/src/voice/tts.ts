import { Mp3Encoder } from "@breezystack/lamejs";
import { ownerModeEnabled } from "../selfhost/owner-mode.js";
import { TTS_TARIFF } from "@stella/contracts/billing-tariffs";
import { STELLA_MEDIA_MODELS } from "@stella/contracts/media-models";
import { DEFAULT_STELLA_TTS_VOICE, isStellaTtsVoice } from "@stella/contracts/realtime-voice-catalog";
import { Effect, Fiber } from "effect";

export const TTS_MODEL = STELLA_MEDIA_MODELS.speech;
export const PCM_SAMPLE_RATE = 24_000;
const PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * 2;
const MP3_KBPS = 48;
const OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";
// Simba streams each request's audio as it is made (first bytes in ~0.5 s
// whatever the length), so text is split only for the per-request limit
// (about two minutes of PCM, ~2,000 characters) and to start the next part
// while the current one plays.
const CHUNK_CHARS = 1_000;
const CHUNKS_IN_FLIGHT = 2;

export type TtsProvider = "openrouter";

const read = (env: object, name: string): string | null => {
  const value = (env as Record<string, unknown>)[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

/** Stella's read-aloud voice runs on OpenRouter only; fal does not carry Simba. */
export const ttsProvider = (env: object): { provider: TtsProvider; apiKey: string } | null => {
  const apiKey = read(env, "OPENROUTER_API_KEY");
  return apiKey ? { provider: "openrouter", apiKey } : null;
};

/** A voice from Stella's read-aloud catalog, else the default (Beth). */
export const resolveTtsVoice = (voice: unknown): string =>
  typeof voice === "string" && isStellaTtsVoice(voice.trim()) ? voice.trim() : DEFAULT_STELLA_TTS_VOICE;

// Simba reads text in the voice's own language unless told otherwise, so an
// English voice turns Japanese, Russian or Arabic into gibberish. Languages
// written in their own script are recognised here, and Vietnamese by its
// letters; Simba tells the other Latin-script languages apart itself.
const SCRIPTS: readonly { language: string; pattern: RegExp; refine?: (text: string) => string }[] = [
  { language: "ja", pattern: /[\u3040-\u30ff\u31f0-\u31ff]/gu },
  { language: "ko", pattern: /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/gu },
  { language: "zh", pattern: /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu },
  {
    language: "ar",
    pattern: /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/gu,
    refine: (text) => (/[ٹڈڑںھے]/u.test(text) ? "ur" : /[پچژکگی]/u.test(text) ? "fa" : "ar"),
  },
  { language: "he", pattern: /[\u0590-\u05ff]/gu },
  { language: "th", pattern: /[\u0e00-\u0e7f]/gu },
  { language: "el", pattern: /[\u0370-\u03ff\u1f00-\u1fff]/gu },
  {
    language: "ru",
    pattern: /[\u0400-\u04ff]/gu,
    refine: (text) =>
      /[әғқңөұүһӘҒҚҢӨҰҮҺ]/u.test(text)
        ? "kk"
        : /[ўЎ]/u.test(text)
          ? "be"
          : /[ђјљњћџЂЈЉЊЋЏ]/u.test(text)
            ? "sr"
            : /[іїєґІЇЄҐ]/u.test(text)
              ? "uk"
              : "ru",
  },
  { language: "hi", pattern: /[\u0900-\u097f]/gu },
  { language: "bn", pattern: /[\u0980-\u09ff]/gu },
  { language: "gu", pattern: /[\u0a80-\u0aff]/gu },
  { language: "ta", pattern: /[\u0b80-\u0bff]/gu },
  { language: "te", pattern: /[\u0c00-\u0c7f]/gu },
  { language: "ka", pattern: /[\u10a0-\u10ff]/gu },
  { language: "my", pattern: /[\u1000-\u109f]/gu },
];
const LATIN = /[A-Za-z\u00c0-\u024f\u1e00-\u1eff]/gu;
const KANA = /[\u3040-\u30ff\u31f0-\u31ff]/u;
const VIETNAMESE = /[\u01a0\u01a1\u01af\u01b0\u1ea0-\u1ef9]/gu;

/**
 * The Simba language code for `chunk` when it is mostly in a non-Latin
 * script or is Vietnamese, else null. `whole` is the full text: Chinese characters in a
 * text that also has kana are Japanese.
 */
export const ttsLanguage = (chunk: string, whole = chunk): string | null => {
  let best: { language: string; count: number; refine?: (text: string) => string } | null = null;
  for (const script of SCRIPTS) {
    const count = chunk.match(script.pattern)?.length ?? 0;
    if (count > (best?.count ?? 0)) best = { language: script.language, count, refine: script.refine };
  }
  const latin = chunk.match(LATIN)?.length ?? 0;
  if (!best || best.count < latin) {
    const vietnamese = chunk.match(VIETNAMESE)?.length ?? 0;
    return vietnamese >= 3 && vietnamese >= latin * 0.05 ? "vi" : null;
  }
  if (best.language === "zh" && KANA.test(whole)) return "ja";
  return best.refine ? best.refine(chunk) : best.language;
};

export type TtsUsage = {
  provider: TtsProvider;
  chars: number;
  audioSeconds: number;
  estimatedUsd: number;
};

/** Simba bills per input character sent, so this is exact for what was sent. */
export const estimateTtsUsage = (chars: number, pcmBytes: number): TtsUsage => ({
  provider: "openrouter",
  chars,
  audioSeconds: Number((pcmBytes / PCM_BYTES_PER_SECOND).toFixed(2)),
  estimatedUsd: Number(((chars / 1_000) * TTS_TARIFF.speechifySimbaUsdPerThousandChars).toFixed(6)),
});

const openRouterSpeech = async (
  apiKey: string,
  input: { text: string; voice: string; language: string | null },
  signal: AbortSignal,
  attribution: boolean,
): Promise<ReadableStream<Uint8Array>> => {
  const response = await fetch(OPENROUTER_SPEECH_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(attribution ? { "HTTP-Referer": "https://stella.sh", "X-OpenRouter-Title": "Stella" } : {}),
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      input: input.text,
      voice: input.voice,
      response_format: "pcm",
      // OpenRouter forwards per-provider options; a top-level `language` is ignored.
      ...(input.language ? { provider: { options: { speechify: { language: input.language } } } } : {}),
    }),
    signal,
  });
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenRouter TTS returned ${response.status}: ${detail.slice(0, 300)}`);
  }
  const rate = /rate=(\d+)/u.exec(response.headers.get("content-type") ?? "")?.[1];
  if (rate && Number(rate) !== PCM_SAMPLE_RATE) {
    await response.body.cancel().catch(() => undefined);
    throw new Error(`OpenRouter TTS returned ${rate} Hz PCM; read-aloud expects ${PCM_SAMPLE_RATE} Hz.`);
  }
  return response.body;
};

export const splitTtsText = (text: string): string[] => {
  const sentences = text.match(/[^.!?。！？\n]+(?:[.!?。！？]+|\n+|$)/gu) ?? [text];
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > CHUNK_CHARS) flush();
    current += sentence;
    while (current.length > CHUNK_CHARS) {
      const cut = current.lastIndexOf(" ", CHUNK_CHARS);
      const at = cut > CHUNK_CHARS / 2 ? cut : CHUNK_CHARS;
      chunks.push(current.slice(0, at).trim());
      current = current.slice(at);
    }
  }
  flush();
  return chunks.filter((chunk) => chunk.length > 0);
};

/** One chunk's audio as it arrives, read ahead of the listener. */
type ChunkAudio = {
  parts: Uint8Array[];
  done: boolean;
  error: { cause: unknown } | null;
  wake: (() => void) | null;
};

const chunkedPcm = (
  chunks: string[],
  synthesize: (text: string, audio: ChunkAudio) => Effect.Effect<void, unknown>,
  onSend: (chars: number) => void,
): ReadableStream<Uint8Array> => {
  let next = 0;
  const queue: ChunkAudio[] = [];
  const running: Fiber.Fiber<void, unknown>[] = [];
  const wake = (audio: ChunkAudio) => {
    const resume = audio.wake;
    audio.wake = null;
    resume?.();
  };
  const stop = () => {
    next = chunks.length;
    queue.length = 0;
    const live = running.splice(0);
    if (live.length > 0) Effect.runFork(Fiber.interruptAll(live));
  };
  const fill = () => {
    while (queue.length < CHUNKS_IN_FLIGHT && next < chunks.length) {
      const chunk = chunks[next++]!;
      const audio: ChunkAudio = { parts: [], done: false, error: null, wake: null };
      queue.push(audio);
      onSend(chunk.length);
      const fiber = Effect.runFork(synthesize(chunk, audio));
      running.push(fiber);
      Effect.runPromise(Fiber.join(fiber)).then(
        () => {
          audio.done = true;
          wake(audio);
        },
        (cause: unknown) => {
          audio.error = { cause };
          wake(audio);
        },
      );
    }
  };
  return new ReadableStream<Uint8Array>({
    start() {
      fill();
    },
    async pull(controller) {
      for (;;) {
        const current = queue[0];
        if (!current) {
          controller.close();
          return;
        }
        if (current.parts.length > 0) {
          controller.enqueue(concat(current.parts.splice(0)));
          return;
        }
        if (current.error) {
          stop();
          throw current.error.cause;
        }
        if (current.done) {
          queue.shift();
          fill();
          continue;
        }
        await new Promise<void>((resolve) => {
          current.wake = resolve;
        });
      }
    },
    cancel() {
      stop();
    },
  });
};

/**
 * 24 kHz mono 16-bit PCM for `text`, streamed as Simba makes it, a chunk
 * of text per request with the next one read ahead. Throws when read-aloud
 * is not set up or the provider refuses the first chunk.
 */
export const openTtsPcm = async (
  env: object,
  args: { text: string; voice: string; signal: AbortSignal },
): Promise<{ provider: TtsProvider; pcm: ReadableStream<Uint8Array>; sentChars: () => number }> => {
  const picked = ttsProvider(env);
  if (!picked) throw new Error("Read-aloud is not configured.");
  args.signal.throwIfAborted();
  const attribution = !ownerModeEnabled(env);
  // A chunk that fails before any audio arrives is tried once more: OpenRouter
  // does not bill failed generations, and a dropped part would cut the reply.
  const synthesize = (text: string, audio: ChunkAudio) =>
    Effect.tryPromise({
      try: async (interrupted) => {
        const signal = AbortSignal.any([args.signal, interrupted]);
        const input = { text, voice: args.voice, language: ttsLanguage(text, args.text) };
        for (let attempt = 0; ; attempt += 1) {
          try {
            const reader = (await openRouterSpeech(picked.apiKey, input, signal, attribution)).getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) return;
              if (value.length === 0) continue;
              audio.parts.push(value);
              const resume = audio.wake;
              audio.wake = null;
              resume?.();
            }
          } catch (error) {
            if (attempt > 0 || audio.parts.length > 0 || signal.aborted) throw error;
          }
        }
      },
      catch: (error) => error,
    });
  let sent = 0;
  const reader = chunkedPcm(splitTtsText(args.text), synthesize, (chars) => {
    sent += chars;
  }).getReader();
  const first = await reader.read().catch(async (error: unknown) => {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  });
  return {
    provider: picked.provider,
    sentChars: () => sent,
    pcm: new ReadableStream<Uint8Array>({
      start(controller) {
        if (first.done) controller.close();
        else controller.enqueue(first.value);
      },
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      async cancel(reason) {
        await reader.cancel(reason).catch(() => undefined);
      },
    }),
  };
};

const concat = (parts: Uint8Array[]): Uint8Array => {
  if (parts.length === 1) return parts[0]!;
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

export const createPcmMp3Encoder = () => {
  const encoder = new Mp3Encoder(1, PCM_SAMPLE_RATE, MP3_KBPS);
  let oddByte: number | null = null;
  let pcmBytes = 0;
  return {
    push(bytes: Uint8Array): Uint8Array {
      pcmBytes += bytes.length;
      let input = bytes;
      if (oddByte !== null) {
        input = concat([Uint8Array.of(oddByte), bytes]);
        oddByte = null;
      }
      const sampleCount = input.length >> 1;
      if (input.length % 2 === 1) oddByte = input[input.length - 1]!;
      if (sampleCount === 0) return EMPTY;
      const samples = new Int16Array(sampleCount);
      const view = new DataView(input.buffer, input.byteOffset, sampleCount * 2);
      for (let i = 0; i < sampleCount; i += 1) samples[i] = view.getInt16(i * 2, true);
      return new Uint8Array(encoder.encodeBuffer(samples));
    },
    finish(): Uint8Array {
      return new Uint8Array(encoder.flush());
    },
    get pcmBytes() {
      return pcmBytes;
    },
  };
};

export const pcmToWav = (pcm: Uint8Array): Uint8Array => {
  const out = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) out[offset + index] = value.charCodeAt(index);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, PCM_SAMPLE_RATE, true);
  view.setUint32(28, PCM_BYTES_PER_SECOND, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  out.set(pcm, 44);
  return out;
};
