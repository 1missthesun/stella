import { STELLA_MEDIA_MODELS } from "@stella/contracts/media-models";
import { ownerModeEnabled } from "../selfhost/owner-mode.js";
import { readBodyBytes } from "../http/body.js";
import { requireCaller } from "../http/caller.js";
import { fail, failRpcError, json } from "../http/response.js";
import { RpcError } from "../owner-store/errors.js";
import { ownerGeneration, voiceInternal } from "../voice/routes.js";

export const DICTATION_TRANSCRIBE_PATH = "/api/dictation/transcribe";

const DEFAULT_MODEL = STELLA_MEDIA_MODELS.dictation;
const TRANSCRIPTIONS_URL = "https://openrouter.ai/api/v1/audio/transcriptions";
const SAMPLE_RATE = 16_000;
const PCM_BYTES_PER_SECOND = SAMPLE_RATE * 2;
const MAX_SECONDS = 15 * 60;
const MAX_PCM_BYTES = MAX_SECONDS * PCM_BYTES_PER_SECOND;
const MAX_BODY_BYTES = MAX_PCM_BYTES + 4096;
const SEGMENT_BYTES = 3 * 60 * PCM_BYTES_PER_SECOND;
const SEGMENT_TIMEOUT_MS = 60_000;

type DictationEnv = Cloudflare.Env & {
  OPENROUTER_API_KEY?: string;
  META_MODEL_API_KEY?: string;
  STELLA_DICTATION_MODEL?: string;
};

const apiKey = (env: DictationEnv): string | undefined => env.OPENROUTER_API_KEY?.trim() || undefined;

const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

const readPcm16Wav = (bytes: Uint8Array): Uint8Array | string => {
  if (bytes.byteLength < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    return "Dictation audio must be a WAV file.";
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let formatOk = false;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > bytes.byteLength) return "Dictation audio has a broken format chunk.";
      formatOk =
        view.getUint16(body, true) === 1 &&
        view.getUint16(body + 2, true) === 1 &&
        view.getUint32(body + 4, true) === SAMPLE_RATE &&
        view.getUint16(body + 14, true) === 16;
      if (!formatOk) return "Dictation audio must be 16 kHz mono 16-bit PCM.";
    } else if (id === "data") {
      if (!formatOk) return "Dictation audio is missing its format.";
      const end = Math.min(bytes.byteLength, body + size);
      return bytes.subarray(body, end - ((end - body) % 2));
    }
    offset = body + size + (size % 2);
  }
  return "Dictation audio has no data.";
};

const wavFromPcm = (pcm: Uint8Array): Uint8Array => {
  const out = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(out.buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) out[offset + i] = text.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, PCM_BYTES_PER_SECOND, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  out.set(pcm, 44);
  return out;
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

// Thrown when the provider had the audio and may have billed for it (a
// timeout or unreadable answer), as opposed to refusing the request.
class BilledSegmentError extends Error {}

const transcribeSegment = async (
  key: string,
  model: string,
  pcm: Uint8Array,
  signal: AbortSignal,
  attribution: boolean,
): Promise<{ text: string; costUsd: number | undefined }> => {
  const sent = fetch(TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(attribution ? { "HTTP-Referer": "https://stella.sh", "X-OpenRouter-Title": "Stella" } : {}),
    },
    body: JSON.stringify({ model, input_audio: { data: toBase64(wavFromPcm(pcm)), format: "wav" } }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(SEGMENT_TIMEOUT_MS)]),
  });
  let response: Response;
  let text: string;
  try {
    response = await sent;
    text = await response.text();
  } catch (error) {
    throw new BilledSegmentError(`Transcription did not finish: ${(error as Error).message}`);
  }
  if (!response.ok) throw new Error(`Transcription failed (${response.status}): ${text.slice(0, 300)}`);
  let body: { text?: unknown; usage?: { cost?: unknown } };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    throw new BilledSegmentError("Transcription response was not JSON.");
  }
  if (typeof body.text !== "string") throw new BilledSegmentError("Transcription response was missing text.");
  const cost = body.usage?.cost;
  return { text: body.text.trim(), costUsd: typeof cost === "number" && cost >= 0 ? cost : undefined };
};

export const handleDictationTranscribeRoute = async (
  request: Request,
  env: DictationEnv,
): Promise<Response | null> => {
  if (new URL(request.url).pathname !== DICTATION_TRANSCRIBE_PATH) return null;
  if (request.method === "GET") {
    return json({ available: Boolean(apiKey(env)), streaming: Boolean(env.META_MODEL_API_KEY?.trim()) });
  }
  if (request.method !== "POST") return fail(405, "Method not allowed.");

  const verified = await requireCaller(request, env);
  if (!verified.ok) return failRpcError(verified.error);
  const key = apiKey(env);
  if (!key) return fail(503, "Dictation isn't set up on this Stella.", { code: "dictation_unavailable" });

  const body = await readBodyBytes(request, MAX_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.status === 413 ? "That recording is longer than 15 minutes." : body.error);
  const pcm = readPcm16Wav(body.value);
  if (typeof pcm === "string") return fail(400, pcm);
  if (pcm.byteLength > MAX_PCM_BYTES) return fail(413, "That recording is longer than 15 minutes.");
  if (pcm.byteLength < PCM_BYTES_PER_SECOND / 10) return json({ text: "", seconds: 0 });

  const ownerId = verified.caller.ownerId;
  const generation = await ownerGeneration(env, ownerId);
  const call = <T>(name: string, args: unknown) => voiceInternal<T>(env, ownerId, generation, name, args);
  const sessionId = `muse_${crypto.randomUUID()}`;
  try {
    await call("dictation.reserveClip", { sessionId, audioBytes: pcm.byteLength });
  } catch (error) {
    if (error instanceof RpcError && (error.code === "FORBIDDEN" || error.code === "RATE_LIMITED")) {
      return fail(error.code === "RATE_LIMITED" ? 429 : 403, error.message, { code: "usage_limit_reached" });
    }
    throw error;
  }

  const model = env.STELLA_DICTATION_MODEL?.trim() || DEFAULT_MODEL;
  const parts: string[] = [];
  const unsettled: Array<Record<string, unknown>> = [];
  const settle = async (charge: Record<string, unknown>) => {
    try {
      await call("dictation.settleSegment", { sessionId, ...charge });
    } catch {
      unsettled.push(charge);
    }
  };
  try {
    for (let offset = 0, segment = 0; offset < pcm.byteLength; offset += SEGMENT_BYTES, segment += 1) {
      const slice = pcm.subarray(offset, offset + SEGMENT_BYTES);
      let result: { text: string; costUsd: number | undefined };
      try {
        result = await transcribeSegment(key, model, slice, request.signal, !ownerModeEnabled(env));
      } catch (error) {
        if (error instanceof BilledSegmentError) {
          await settle({ segment, audioBytes: slice.byteLength, model, outcome: "failed" });
        }
        throw error;
      }
      await settle({
        segment,
        audioBytes: slice.byteLength,
        model,
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
      });
      if (result.text) parts.push(result.text);
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "dictation_transcribe_failed", message: (error as Error).message.slice(0, 300) }));
    return fail(502, "Stella couldn't transcribe that recording. Try again.");
  } finally {
    await call("dictation.releaseClip", { sessionId, unsettled }).catch((error: unknown) =>
      console.error(JSON.stringify({ event: "dictation_finish_failed", message: String(error).slice(0, 300) })),
    );
  }
  return json({ text: parts.join(" "), seconds: pcm.byteLength / PCM_BYTES_PER_SECOND });
};
