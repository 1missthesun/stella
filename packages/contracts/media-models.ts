import type { Capability } from "./capabilities.js";

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

const SEEDANCE_PER_SECOND: Record<string, number> = { "480p": 0.2205, "720p": 0.473, "1080p": 1.164 };
const SEEDANCE_AUTO_SECONDS = 15;

const seedancePrice = (input: Record<string, unknown>): number => {
  const resolution = input.draft === true ? "480p" : String(input.resolution ?? "720p").toLowerCase();
  const perSecond = SEEDANCE_PER_SECOND[resolution] ?? SEEDANCE_PER_SECOND["1080p"]!;
  const seconds = num(input.duration) ?? SEEDANCE_AUTO_SECONDS;
  const videos = list(input.video_urls).length;
  return videos > 0 ? perSecond * 0.6 * (seconds + Math.min(30.2, videos * 10)) : perSecond * seconds;
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
    id: "bytedance/seedance-2.5/text-to-video",
    name: "Seedance 2.5",
    kind: "video",
    does: "Generate a video with sound from a text prompt.",
    docsUrl: falDocs("bytedance/seedance-2.5/text-to-video"),
    plan: "video_generation",
    price: seedancePrice,
  },
  {
    id: "bytedance/seedance-2.5/image-to-video",
    name: "Seedance 2.5 Image to Video",
    kind: "video",
    does: "Animate an image (image_url, optional end_image_url) into a video.",
    docsUrl: falDocs("bytedance/seedance-2.5/image-to-video"),
    plan: "video_generation",
    price: seedancePrice,
  },
  {
    id: "bytedance/seedance-2.5/reference-to-video",
    name: "Seedance 2.5 Reference to Video",
    kind: "video",
    does: "Generate, edit or extend a video guided by reference images, videos and audio.",
    docsUrl: falDocs("bytedance/seedance-2.5/reference-to-video"),
    plan: "video_generation",
    price: seedancePrice,
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
    id: "google/gemini-3.8-flash-lite-tts",
    name: "Gemini 3.8 Flash Lite TTS",
    kind: "speech",
    does: "Turn text into speech, one voice or a two-speaker dialogue.",
    docsUrl: falDocs("google/gemini-3.8-flash-lite-tts"),
    plan: "audio_generation",
    price: (input) => (ttsText(input).length / 1_000) * 0.03,
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
  video: "bytedance/seedance-2.5/text-to-video",
  imageToVideo: "bytedance/seedance-2.5/image-to-video",
  speech: "google/gemini-3.8-flash-lite-tts",
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
  generateAudio?: boolean | null;
  imageUrl?: string | null;
  endImageUrl?: string | null;
}): { model: string; input: Record<string, unknown> } => {
  const fromImage = Boolean(args.imageUrl);
  return {
    model: fromImage ? STELLA_MEDIA_MODELS.imageToVideo : STELLA_MEDIA_MODELS.video,
    input: {
      prompt: args.prompt,
      duration: String(args.durationSeconds),
      resolution: args.resolution || "720p",
      generate_audio: args.generateAudio ?? true,
      codec: "H264",
      ...(fromImage
        ? {
            image_url: args.imageUrl,
            ...(args.endImageUrl ? { end_image_url: args.endImageUrl } : {}),
          }
        : { aspect_ratio: args.aspectRatio || "16:9" }),
    },
  };
};
