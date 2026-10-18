import type { Capability } from "./capabilities.js";
import { TTS_TARIFF } from "./billing-tariffs.js";

export type MediaModelKind = "image" | "video" | "music" | "speech" | "transcription" | "3d";

export type MediaModel = {
  id: string;
  name: string;
  kind: MediaModelKind;
  does: string;
  docsUrl: string;
  plan: Capability | null;
  price: (input: Record<string, unknown>, output?: unknown) => number | null;
};

const falDocs = (id: string) => `https://fal.ai/models/${id}/api`;

const num = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const maxNumber = (value: unknown, field: string, depth = 0): number | null => {
  if (depth > 8 || value === null || typeof value !== "object") return null;
  let max = Array.isArray(value) ? null : num((value as Record<string, unknown>)[field]);
  for (const entry of Object.values(value as Record<string, unknown>)) {
    const found = maxNumber(entry, field, depth + 1);
    if (found !== null) max = max === null ? found : Math.max(max, found);
  }
  return max;
};

const GPT_IMAGE_PER_IMAGE: Record<string, [number, number]> = {
  low: [0.00588, 0.01113],
  medium: [0.01317, 0.02595],
  high: [0.05268, 0.10008],
  xhigh: [0.09366, 0.1779],
  max: [0.21072, 0.40026],
};
const GPT_IMAGE_SIZES: Record<string, number> = {
  square_hd: 1024 * 1024,
  square: 512 * 512,
  portrait_4_3: 768 * 1024,
  portrait_16_9: 576 * 1024,
  landscape_4_3: 1024 * 768,
  landscape_16_9: 1024 * 576,
};

const gptImagePrice = (input: Record<string, unknown>): number => {
  const quality = String(input.quality ?? "high").toLowerCase();
  const row = GPT_IMAGE_PER_IMAGE[quality] ?? GPT_IMAGE_PER_IMAGE.high!;
  const size = input.image_size;
  const pixels = isRecord(size)
    ? (num(size.width) ?? 0) * (num(size.height) ?? 0)
    : typeof size === "string" && GPT_IMAGE_SIZES[size] !== undefined
      ? GPT_IMAGE_SIZES[size]!
      :
        Number.POSITIVE_INFINITY;
  const perImage = pixels <= 2_100_000 ? row[0] : row[1];
  const images = Math.max(1, Math.round(num(input.num_images) ?? 1));
  const prompt = typeof input.prompt === "string" ? (input.prompt.length / 4) * 5e-6 : 0;
  const references = list(input.image_urls).length * 1_500 * 8e-6;
  return images * perImage + prompt + references;
};

// fal's H3 Max list rates per second of output. Text and image-to-video run
// 35% off until fal's promotion ends on October 31; from that day (UTC) the
// list rate applies. Audio is always generated and costs nothing extra.
const H3_MAX_PER_SECOND: Record<string, number> = { "480p": 0.05, "768p": 0.08, "1080p": 0.16, "2k": 0.32 };
const H3_MAX_PROMO_ENDS_AT = Date.UTC(2026, 9, 31);
const H3_MAX_PROMO_FACTOR = 0.65;
const H3_MAX_DEFAULT_SECONDS = 5;
const H3_MAX_MAX_SECONDS = 15;
// Reference inputs above a 4,096-token allowance per request cost $0.02 per
// 1,000 tokens. The files aren't inspected, so this assumes the largest counts:
// 2,560 tokens per image (its most elongated shape), reference videos and
// audio filling the output length up to their combined 15 s, and about 6,900
// video tokens per second (2,700 at 480p) and 80 audio tokens per second.
const H3_MAX_FREE_REFERENCE_TOKENS = 4_096;
const H3_MAX_USD_PER_REFERENCE_TOKEN = 0.02 / 1_000;
const H3_MAX_IMAGE_TOKENS = 2_560;
const H3_MAX_AUDIO_TOKENS_PER_SECOND = 80;

const h3MaxResolution = (input: Record<string, unknown>, highest: string): string => {
  const resolution = String(input.resolution ?? "768p").toLowerCase();
  return H3_MAX_PER_SECOND[resolution] === undefined ? highest : resolution;
};

const h3MaxSeconds = (input: Record<string, unknown>): number =>
  Math.min(H3_MAX_MAX_SECONDS, Math.max(0, num(input.duration) ?? H3_MAX_DEFAULT_SECONDS));

const h3MaxReferenceUsd = (input: Record<string, unknown>, resolution: string, seconds: number): number => {
  const conditions = list(input.reference_conditions).filter(isRecord);
  const count = (field: string, type: string) =>
    list(input[field]).length + conditions.filter((condition) => condition.type === type).length;
  const filled = (clips: number) => Math.min(H3_MAX_MAX_SECONDS, clips * seconds);
  const tokens =
    count("reference_image_urls", "image") * H3_MAX_IMAGE_TOKENS +
    filled(count("reference_video_urls", "video")) * (resolution === "480p" ? 2_700 : 6_900) +
    filled(count("reference_audio_urls", "audio")) * H3_MAX_AUDIO_TOKENS_PER_SECOND;
  return Math.max(0, tokens - H3_MAX_FREE_REFERENCE_TOKENS) * H3_MAX_USD_PER_REFERENCE_TOKEN;
};

const h3MaxPrice = (input: Record<string, unknown>): number => {
  const promo = Date.now() < H3_MAX_PROMO_ENDS_AT ? H3_MAX_PROMO_FACTOR : 1;
  return H3_MAX_PER_SECOND[h3MaxResolution(input, "1080p")]! * promo * h3MaxSeconds(input);
};

const h3MaxReferencePrice = (input: Record<string, unknown>): number => {
  const resolution = h3MaxResolution(input, "1080p");
  const seconds = h3MaxSeconds(input);
  return H3_MAX_PER_SECOND[resolution]! * seconds + h3MaxReferenceUsd(input, resolution, seconds);
};

const h3MaxExtendPrice = (input: Record<string, unknown>): number => {
  const resolution = h3MaxResolution(input, "2k");
  const seconds = h3MaxSeconds(input);
  return H3_MAX_PER_SECOND[resolution]! * seconds + h3MaxReferenceUsd(input, resolution, seconds);
};

const tripoPrice = (input: Record<string, unknown>): number => {
  if (input.texture === false) return 1.0;
  const quality = String(input.texture_quality ?? "standard").toLowerCase();
  return quality === "extreme" ? 1.3 : quality === "detailed" ? 1.2 : 1.1;
};

const ttsText = (input: Record<string, unknown>): string =>
  typeof input.prompt === "string"
    ? input.prompt
    : list(input.turns)
        .map((turn) => (isRecord(turn) && typeof turn.text === "string" ? turn.text : ""))
        .join("");

export const MEDIA_MODELS: readonly MediaModel[] = [
  {
    id: "openai/gpt-image-2.5/flare/text-to-image",
    name: "GPT Image 2.5 Flare",
    kind: "image",
    does: "Generate images from a text prompt.",
    docsUrl: falDocs("openai/gpt-image-2.5/flare/text-to-image"),
    plan: "image_generation",
    price: gptImagePrice,
  },
  {
    id: "openai/gpt-image-2.5/flare/edit",
    name: "GPT Image 2.5 Flare Edit",
    kind: "image",
    does: "Edit or combine images (image_urls) following a text prompt; optional mask.",
    docsUrl: falDocs("openai/gpt-image-2.5/flare/edit"),
    plan: "image_generation",
    price: gptImagePrice,
  },
  {
    id: "minimax/h3-max/text-to-video",
    name: "MiniMax H3 Max",
    kind: "video",
    does: "Generate a video with sound from a text prompt.",
    docsUrl: falDocs("minimax/h3-max/text-to-video"),
    plan: "video_generation",
    price: h3MaxPrice,
  },
  {
    id: "minimax/h3-max/image-to-video",
    name: "MiniMax H3 Max Image to Video",
    kind: "video",
    does: "Animate an image (image_url, optional end_image_url) into a video with sound.",
    docsUrl: falDocs("minimax/h3-max/image-to-video"),
    plan: "video_generation",
    price: h3MaxPrice,
  },
  {
    id: "minimax/h3-max/reference-to-video",
    name: "MiniMax H3 Max Reference to Video",
    kind: "video",
    does: "Generate a video guided by reference images, videos and audio, optionally between start, middle and end frames.",
    docsUrl: falDocs("minimax/h3-max/reference-to-video"),
    plan: "video_generation",
    price: h3MaxReferencePrice,
  },
  {
    id: "minimax/h3-max/extend-video",
    name: "MiniMax H3 Max Extend Video",
    kind: "video",
    does: "Continue a video (video_url) with new footage described by a prompt.",
    docsUrl: falDocs("minimax/h3-max/extend-video"),
    plan: "video_generation",
    price: h3MaxExtendPrice,
  },
  {
    id: "google/lyria-3.5",
    name: "Lyria 3.5",
    kind: "music",
    does: "Generate a song or instrumental from a text prompt.",
    docsUrl: falDocs("google/lyria-3.5"),
    plan: "audio_generation",
    price: () => 0.1,
  },
  {
    id: "google/gemini-3.8-flash-tts",
    name: "Gemini 3.8 Flash TTS",
    kind: "speech",
    does: "Turn text into speech, one voice or a two-speaker dialogue.",
    docsUrl: falDocs("google/gemini-3.8-flash-tts"),
    plan: "audio_generation",
    price: (input) => (ttsText(input).length / 1_000) * TTS_TARIFF.falGeminiUsdPerThousandChars,
  },
  {
    id: "fal-ai/elevenlabs/speech-to-text/scribe-v2",
    name: "ElevenLabs Scribe v2",
    kind: "transcription",
    does: "Transcribe speech in audio (audio_url) to text, with word timings and speakers.",
    docsUrl: falDocs("fal-ai/elevenlabs/speech-to-text/scribe-v2"),
    plan: null,
    price: (input, output) => {
      if (output === undefined) return null;
      const seconds = maxNumber(output, "end");
      if (seconds === null) return null;
      return (seconds / 60) * 0.008 * (list(input.keyterms).length > 0 ? 1.3 : 1);
    },
  },
  {
    id: "tripo3d/p2/text-to-3d",
    name: "Tripo P2",
    kind: "3d",
    does: "Generate a textured 3D model from a text prompt.",
    docsUrl: falDocs("tripo3d/p2/text-to-3d"),
    plan: "three_d_generation",
    price: tripoPrice,
  },
  {
    id: "tripo3d/p2/image-to-3d",
    name: "Tripo P2 Image to 3D",
    kind: "3d",
    does: "Generate a textured 3D model from an image (image_url).",
    docsUrl: falDocs("tripo3d/p2/image-to-3d"),
    plan: "three_d_generation",
    price: tripoPrice,
  },
];

export const mediaModel = (id: string): MediaModel | null =>
  MEDIA_MODELS.find((model) => model.id === id) ?? null;

export const STELLA_MEDIA_MODELS = {
  image: "openai/gpt-image-2.5/flare/text-to-image",
  imageEdit: "openai/gpt-image-2.5/flare/edit",
  video: "minimax/h3-max/text-to-video",
  imageToVideo: "minimax/h3-max/image-to-video",
  speech: "google/gemini-3.8-flash-tts",
  dictation: "elevenlabs/scribe-v2",
} as const;

export const BYOK_IMAGE_MODELS = {
  openai: "gpt-image-2.5-flare",
  openrouter: "openai/gpt-image-2.5-flare",
  fal: { image: STELLA_MEDIA_MODELS.image, edit: STELLA_MEDIA_MODELS.imageEdit },
} as const;

const IMAGE_ASPECT_SIZES: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "4:3": { width: 1024, height: 768 },
  "3:4": { width: 768, height: 1024 },
  "3:2": { width: 1152, height: 768 },
  "2:3": { width: 768, height: 1152 },
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "21:9": { width: 1344, height: 576 },
};

export const stellaImageRequest = (args: {
  prompt: string;
  aspectRatio?: string | null;
  size?: { width: number; height: number } | null;
  quality?: string | null;
  numImages?: number | null;
  outputFormat?: string | null;
  imageUrls?: string[];
}): { model: string; input: Record<string, unknown> } => {
  const imageUrls = args.imageUrls ?? [];
  const size = args.size ?? (args.aspectRatio ? IMAGE_ASPECT_SIZES[args.aspectRatio.trim()] : undefined);
  return {
    model: imageUrls.length > 0 ? STELLA_MEDIA_MODELS.imageEdit : STELLA_MEDIA_MODELS.image,
    input: {
      prompt: args.prompt,
      quality: args.quality || "low",
      image_size: size ?? "auto",
      ...(args.numImages ? { num_images: args.numImages } : {}),
      ...(args.outputFormat ? { output_format: args.outputFormat } : {}),
      ...(imageUrls.length > 0 ? { image_urls: imageUrls } : {}),
    },
  };
};

export const stellaVideoRequest = (args: {
  prompt: string;
  durationSeconds: number;
  resolution?: string | null;
  aspectRatio?: string | null;
  imageUrl?: string | null;
  endImageUrl?: string | null;
}): { model: string; input: Record<string, unknown> } => {
  const fromImage = Boolean(args.imageUrl);
  return {
    model: fromImage ? STELLA_MEDIA_MODELS.imageToVideo : STELLA_MEDIA_MODELS.video,
    input: {
      prompt: args.prompt,
      duration: args.durationSeconds,
      resolution: (args.resolution || "768p").toUpperCase(),
      prompt_expansion_mode: "balanced",
      ...(fromImage
        ? {
            image_url: args.imageUrl,
            ...(args.endImageUrl ? { end_image_url: args.endImageUrl } : {}),
          }
        : { aspect_ratio: args.aspectRatio || "16:9" }),
    },
  };
};
