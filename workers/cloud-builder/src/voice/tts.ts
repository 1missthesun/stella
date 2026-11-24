import { ownerModeEnabled } from "../selfhost/owner-mode.js";
import { TTS_TARIFF } from "@stella/contracts/billing-tariffs";
import { STELLA_MEDIA_MODELS } from "@stella/contracts/media-models";
import { DEFAULT_STELLA_TTS_VOICE, isStellaTtsVoice } from "@stella/contracts/realtime-voice-catalog";
import { Effect, Fiber } from "effect";
import { concat, createMp3Framer } from "./mp3.js";

export const TTS_MODEL = STELLA_MEDIA_MODELS.speech;
const OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";
const CHUNK_CHARS = 1_000;
const CHUNKS_IN_FLIGHT = 2;

export type TtsProvider = "openrouter";

const read = (env: object, name: string): string | null => {
  const value = (env as Record<string, unknown>)[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

export const ttsProvider = (env: object): { provider: TtsProvider; apiKey: string } | null => {
  const apiKey = read(env, "OPENROUTER_API_KEY");
  return apiKey ? { provider: "openrouter", apiKey } : null;
};

export const resolveTtsVoice = (voice: unknown): string =>
  typeof voice === "string" && isStellaTtsVoice(voice.trim()) ? voice.trim() : DEFAULT_STELLA_TTS_VOICE;

// Simba reads text in the voice's own language unless told otherwise, so an
// English voice turns Japanese, Russian or Arabic into gibberish. Languages
// written in their own script are recognised here, and Vietnamese by its
// letters; Simba tells the other Latin-script languages apart itself. Codes
// outside Simba's list (Bulgarian, Macedonian, Mongolian) are taken too and
// read far better than a neighbouring language's.
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
      /[әғқңұһӘҒҚҢҰҺ]/u.test(text)
        ? "kk"
        : /[өүӨҮ]/u.test(text)
          ? "mn"
          : /[ўЎ]/u.test(text)
            ? "be"
            : /[ѓќѕЃЌЅ]/u.test(text)
              ? "mk"
              : /[ђјљњћџЂЈЉЊЋЏ]/u.test(text)
                ? "sr"
                : /[іїєґІЇЄҐ]/u.test(text)
                  ? "uk"
                  : /[ъЪ]/u.test(text) && !/[ыэёЫЭЁ]/u.test(text)
                    ? "bg"
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
export const estimateTtsUsage = (chars: number, audioSeconds: number): TtsUsage => ({
  provider: "openrouter",
  chars,
  audioSeconds: Number(audioSeconds.toFixed(2)),
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
      response_format: "mp3",
      // OpenRouter forwards per-provider options; a top-level `language` is ignored.
      ...(input.language ? { provider: { options: { speechify: { language: input.language } } } } : {}),
    }),
    signal,
  });
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenRouter TTS returned ${response.status}: ${detail.slice(0, 300)}`);
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

type ChunkAudio = {
  parts: Uint8Array[];
  done: boolean;
  error: { cause: unknown } | null;
  wake: (() => void) | null;
};

const chunkedAudio = (
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

export const openTtsAudio = async (
  env: object,
  args: { text: string; voice: string; signal: AbortSignal },
): Promise<{
  provider: TtsProvider;
  mp3: ReadableStream<Uint8Array>;
  sentChars: () => number;
  audioSeconds: () => number;
}> => {
  const picked = ttsProvider(env);
  if (!picked) throw new Error("Read-aloud is not configured.");
  args.signal.throwIfAborted();
  const attribution = !ownerModeEnabled(env);
  // OpenRouter does not bill failed generations.
  const synthesize = (text: string, audio: ChunkAudio) =>
    Effect.tryPromise({
      try: async (interrupted) => {
        const signal = AbortSignal.any([args.signal, interrupted]);
        const input = { text, voice: args.voice, language: ttsLanguage(text, args.text) };
        let counted = 0;
        for (let attempt = 0; ; attempt += 1) {
          try {
            const reader = (await openRouterSpeech(picked.apiKey, input, signal, attribution)).getReader();
            const framer = createMp3Framer();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) return;
              const frames = framer.push(value);
              if (frames.length === 0) continue;
              seconds += framer.seconds - counted;
              counted = framer.seconds;
              audio.parts.push(frames);
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
  let seconds = 0;
  const reader = chunkedAudio(splitTtsText(args.text), synthesize, (chars) => {
    sent += chars;
  }).getReader();
  const first = await reader.read().catch(async (error: unknown) => {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  });
  return {
    provider: picked.provider,
    sentChars: () => sent,
    audioSeconds: () => seconds,
    mp3: new ReadableStream<Uint8Array>({
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
