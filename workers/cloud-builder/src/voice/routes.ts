import { Effect } from "effect";
import {
  rpcErrorStatus,
  type BackendError,
} from "@stella/contracts/backend/protocol";
import {
  VOICE_LEASE_HEADER,
  VOICE_LIVE_SDP_PATH,
  VOICE_TTS_HLS_PREFIX,
  VOICE_TTS_PATH,
  VOICE_TTS_STREAM_CANCEL_PATH,
  VOICE_TTS_STREAM_PATH,
} from "@stella/contracts/backend/voice";
import { log } from "../build-session/shared/keys.js";
import { sha256Hex } from "../hash.js";
import { DictationUsageError, type MuseControl, type PreparedSession } from "../muse-transcribe-socket.js";
import { RpcError, toBackendError, unwrapRpc } from "../owner-store/errors.js";
import { readBodyText, readJsonObject } from "../http/body.js";
import { requireCaller } from "../http/caller.js";
import type { OwnerCaller } from "../owner-store/registry.js";
import { ttsText } from "../owner-store/domains/voice.js";
import { createPcmMp3Encoder, estimateTtsUsage, openTtsPcm, pcmToWav, resolveGeminiTtsVoice, ttsProvider } from "./tts.js";
import { buildHlsPlaylist, HLS_MANIFEST_FILE, type HlsManifest } from "./hls.js";
import { readTtsTicket, ttsObjectKey } from "./ticket.js";
import { ownerGateStub } from "../rpc-release.js";

type VoiceEnv = Cloudflare.Env;

const MAX_JSON_BYTES = 256 * 1024;
const MAX_SDP_BYTES = 1_000_000;
/** AVPlayer can fail for good on an empty EVENT playlist: hold the first read. */
const PLAYLIST_WAIT_MS = 5_000;
const PLAYLIST_POLL_MS = 250;
const PROVIDER_TIMEOUT_MS = 60_000;

const secret = (env: VoiceEnv, name: string): string | null => {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const errorResponse = (error: unknown): Response => {
  const body: BackendError = toBackendError(error);
  if (!(error instanceof RpcError)) {
    log("error", "voice_route_failed", { message: error instanceof Error ? error.message : String(error) });
  }
  return Response.json(
    { error: body },
    {
      status: rpcErrorStatus(body.code),
      headers: {
        "cache-control": "no-store",
        ...(body.retryAfterMs !== undefined
          ? { "retry-after": String(Math.max(1, Math.ceil(body.retryAfterMs / 1_000))) }
          : {}),
      },
    },
  );
};

export const ownerGeneration = async (env: Pick<VoiceEnv, "OWNER_GATES">, ownerId: string): Promise<string> => {
  try {
    return (await ownerGateStub(env.OWNER_GATES, ownerId).snapshot()).ownerGeneration;
  } catch {
    throw new RpcError("UNAVAILABLE", "Account state is unavailable. Try again.");
  }
};

export const voiceInternal = async <T>(
  env: Pick<VoiceEnv, "OWNER_GATES">,
  ownerId: string,
  generation: string,
  name: string,
  args: unknown,
): Promise<T> =>
  unwrapRpc(
    await ownerGateStub(env.OWNER_GATES, ownerId).ownerInternal({ name, args, ownerGeneration: generation }),
  ) as T;

export const ownerDictationControl = (env: Pick<VoiceEnv, "OWNER_GATES">, ownerId: string): MuseControl => {
  let generation: Promise<string> | null = null;
  const current = () => (generation ??= ownerGeneration(env, ownerId));
  return {
    async prepare(sessionId) {
      try {
        return await voiceInternal<PreparedSession>(env, ownerId, await current(), "dictation.prepare", { sessionId });
      } catch (error) {
        if (error instanceof RpcError && (error.code === "FORBIDDEN" || error.code === "RATE_LIMITED")) {
          throw new DictationUsageError(error.message);
        }
        throw error;
      }
    },
    async extend({ sessionId, audioBytes }) {
      const { maxAudioBytes } = await voiceInternal<{ maxAudioBytes: number }>(
        env,
        ownerId,
        await current(),
        "dictation.extend",
        { sessionId, audioBytes },
      );
      return maxAudioBytes;
    },
    async settle({ sessionId, audioBytes, success }) {
      await voiceInternal(env, ownerId, await current(), "dictation.settle", { sessionId, audioBytes, success });
    },
  };
};

const callOwner = async <T>(env: VoiceEnv, ownerId: string, name: string, args: unknown): Promise<T> =>
  await voiceInternal<T>(env, ownerId, await ownerGeneration(env, ownerId), name, args);

const authenticate = async (request: Request, env: VoiceEnv): Promise<OwnerCaller> => {
  const verified = await requireCaller(request, env);
  if (!verified.ok) throw verified.error;
  return verified.caller;
};

const readJson = async (request: Request): Promise<Record<string, unknown>> => {
  const body = await readJsonObject(request, MAX_JSON_BYTES);
  if (body.ok) return body.value;
  throw new RpcError(
    "BAD_REQUEST",
    body.status === 413 ? "Request body is too large." : "Request body must be a JSON object.",
  );
};

type TtsVendor = "fal" | "openrouter" | "openai";

type AdmittedText = {
  text: string;
  settle: (usage: { chars: number; pcmBytes: number; outcome: "succeeded" | "failed" | "aborted" }) => Promise<void>;
};

const admitText = async (env: VoiceEnv, caller: OwnerCaller, raw: unknown, vendor: TtsVendor): Promise<AdmittedText> => {
  const text = typeof raw === "string" ? ttsText(raw) : "";
  if (!text) throw new RpcError("BAD_REQUEST", "text is required.");
  const generation = await ownerGeneration(env, caller.ownerId);
  const { id } = await voiceInternal<{ id: string }>(env, caller.ownerId, generation, "tts.admit", {
    chars: text.length,
    vendor,
  });
  let settled = false;
  return {
    text,
    settle: async (usage) => {
      if (settled) return;
      settled = true;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await voiceInternal(env, caller.ownerId, generation, "tts.settle", { id, vendor, ...usage });
          return;
        } catch (error) {
          log("error", "tts_settle_failed", { attempt, message: error instanceof Error ? error.message : String(error) });
        }
      }
    },
  };
};

const liveSdp = async (request: Request, env: VoiceEnv): Promise<Response> => {
  const caller = await authenticate(request, env);
  const leaseId = request.headers.get(VOICE_LEASE_HEADER)?.trim() ?? "";
  if (!leaseId) throw new RpcError("BAD_REQUEST", `${VOICE_LEASE_HEADER} is required.`);
  const body = await readBodyText(request, MAX_SDP_BYTES);
  const sdp = body.ok ? body.value : "";
  if (sdp.length < 10) throw new RpcError("BAD_REQUEST", "Missing or invalid SDP offer.");
  const answer = await callOwner<{ sdp: string }>(env, caller.ownerId, "voice.sdp", { leaseId, sdp });
  return new Response(answer.sdp, {
    headers: { "content-type": "application/sdp", "cache-control": "no-store" },
  });
};

const logTtsUsage = (fields: Record<string, unknown>) => log("info", "tts_usage", fields);

const notConfigured = () => new RpcError("UNAVAILABLE", "Stella read-aloud is not configured yet.", { retryable: false });

const providerSignal = (request: Request): AbortSignal =>
  AbortSignal.any([request.signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]);

const openPcm = async (env: VoiceEnv, text: string, voice: string, transport: string, signal: AbortSignal) => {
  try {
    return await openTtsPcm(env, { text, voice, signal });
  } catch (error) {
    log("error", "tts_provider_failed", { transport, message: error instanceof Error ? error.message : String(error) });
    throw new RpcError("UNAVAILABLE", "Speech generation failed.");
  }
};

const ttsStream = async (request: Request, env: VoiceEnv): Promise<Response> => {
  const caller = await authenticate(request, env);
  const body = await readJson(request);
  const configured = ttsProvider(env);
  if (!configured) throw notConfigured();
  const { text, settle } = await admitText(env, caller, body.text, configured.provider);
  const voice = resolveGeminiTtsVoice(body.voice);
  const startedAt = Date.now();
  const opened = await openPcm(env, text, voice, "stream", providerSignal(request)).catch(async (error: unknown) => {
    await settle({ chars: 0, pcmBytes: 0, outcome: "failed" });
    throw error;
  });
  const { provider, pcm } = opened;
  const reader = pcm.getReader();
  const encoder = createPcmMp3Encoder();
  let audioBytes = 0;
  let firstAudioMs: number | null = null;
  const report = async (status: string) => {
    logTtsUsage({
      transport: "stream",
      status,
      requestChars: text.length,
      audioBytes,
      firstAudioMs,
      ...estimateTtsUsage(provider, opened.sentChars(), encoder.pcmBytes),
      durationMs: Date.now() - startedAt,
    });
    await settle({
      chars: opened.sentChars(),
      pcmBytes: encoder.pcmBytes,
      outcome: status === "completed" ? "succeeded" : status === "failed" ? "failed" : "aborted",
    });
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            const tail = encoder.finish();
            if (tail.length > 0) controller.enqueue(tail);
            audioBytes += tail.length;
            await report(audioBytes > 0 ? "completed" : "failed");
            controller.close();
            return;
          }
          const chunk = value ? encoder.push(value) : new Uint8Array(0);
          if (chunk.length > 0) {
            firstAudioMs ??= Date.now() - startedAt;
            audioBytes += chunk.length;
            controller.enqueue(chunk);
            return;
          }
        }
      } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        await report("interrupted");
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      await report("interrupted");
    },
  });
  return new Response(stream, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
};

const ttsOneShot = async (request: Request, env: VoiceEnv): Promise<Response> => {
  const caller = await authenticate(request, env);
  const body = await readJson(request);
  const provider = body.voiceProvider === "gemini" ? "gemini" : "openai";
  const gemini = ttsProvider(env);
  const apiKey = provider === "gemini" ? (gemini?.apiKey ?? null) : secret(env, "OPENAI_API_KEY");
  if (!apiKey) throw notConfigured();
  const { text, settle } = await admitText(
    env,
    caller,
    body.text,
    provider === "gemini" ? (gemini?.provider ?? "fal") : "openai",
  );
  const startedAt = Date.now();
  const signal = providerSignal(request);

  if (provider === "gemini") {
    const voice = resolveGeminiTtsVoice(body.voice);
    const opened = await openPcm(env, text, voice, "oneshot_gemini", signal).catch(async (error: unknown) => {
      await settle({ chars: 0, pcmBytes: 0, outcome: "failed" });
      throw error;
    });
    const pcm = new Uint8Array(await new Response(opened.pcm).arrayBuffer().catch(() => new ArrayBuffer(0)));
    await settle({
      chars: opened.sentChars(),
      pcmBytes: pcm.byteLength,
      outcome: pcm.byteLength > 0 ? "succeeded" : "failed",
    });
    if (pcm.byteLength === 0) {
      log("error", "tts_provider_failed", { transport: "oneshot_gemini", provider: opened.provider });
      throw new RpcError("UNAVAILABLE", "Speech generation failed.");
    }
    const audio = pcmToWav(pcm);
    logTtsUsage({
      transport: "oneshot_gemini",
      requestChars: text.length,
      audioBytes: audio.byteLength,
      ...estimateTtsUsage(opened.provider, text.length, pcm.byteLength),
      durationMs: Date.now() - startedAt,
    });
    return new Response(audio, { headers: { "content-type": "audio/wav", "cache-control": "no-store" } });
  }

  const voice = typeof body.voice === "string" && body.voice.trim() ? body.voice.trim().slice(0, 100) : "marin";
  const speed =
    typeof body.speed === "number" && Number.isFinite(body.speed) && body.speed >= 0.25 && body.speed <= 4
      ? body.speed
      : undefined;
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,
      response_format: "mp3",
      ...(speed !== undefined ? { speed } : {}),
    }),
    signal,
  }).catch(() => null);
  const audio = response?.ok ? await response.arrayBuffer().catch(() => null) : null;
  await settle({
    chars: response?.ok || signal.aborted ? text.length : 0,
    pcmBytes: 0,
    outcome: audio ? "succeeded" : response?.ok || signal.aborted ? "aborted" : "failed",
  });
  if (!audio) {
    await response?.body?.cancel().catch(() => undefined);
    log("error", "tts_provider_failed", { transport: "oneshot_openai", status: response?.status ?? 0 });
    throw new RpcError("UNAVAILABLE", "OpenAI TTS failed.");
  }
  logTtsUsage({ transport: "oneshot_openai", requestChars: text.length, audioBytes: audio.byteLength, durationMs: Date.now() - startedAt });
  return new Response(audio, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
};

const ttsCancel = async (request: Request, env: VoiceEnv): Promise<Response> => {
  const caller = await authenticate(request, env);
  const body = await readJson(request);
  const ticket = typeof body.ticket === "string" ? readTtsTicket(body.ticket.trim(), Date.now()) : null;
  if (ticket && ticket.ownerHash === (await sha256Hex(caller.ownerId))) {
    await callOwner(env, caller.ownerId, "tts.cancel", { id: ticket.id });
  }
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
};

const readManifest = async (bucket: R2Bucket, ticket: string): Promise<HlsManifest | null> => {
  const object = await bucket.get(ttsObjectKey(ticket, HLS_MANIFEST_FILE));
  return object ? ((await object.json()) as HlsManifest) : null;
};

const AUDIO_RANGE = /^bytes=(\d*)-(\d*)$/u;

const audioResponse = (bytes: Uint8Array, range: string | null): Response => {
  const total = bytes.byteLength;
  const headers = { "content-type": "audio/mpeg", "accept-ranges": "bytes", "cache-control": "no-store" };
  const match = range ? AUDIO_RANGE.exec(range.trim()) : null;
  if (!match) return new Response(bytes, { headers: { ...headers, "content-length": String(total) } });
  let start = match[1] ? Number.parseInt(match[1], 10) : 0;
  let end = match[2] ? Number.parseInt(match[2], 10) : total - 1;
  if (!Number.isFinite(start) || start < 0) start = 0;
  if (!Number.isFinite(end) || end >= total) end = total - 1;
  if (start > end || start >= total) {
    return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${total}` } });
  }
  const slice = bytes.slice(start, end + 1);
  return new Response(slice, {
    status: 206,
    headers: { ...headers, "content-range": `bytes ${start}-${end}/${total}`, "content-length": String(slice.byteLength) },
  });
};

const ttsHls = async (request: Request, env: VoiceEnv, path: string): Promise<Response> => {
  const rest = path.slice(VOICE_TTS_HLS_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || !env.MEDIA) throw new RpcError("NOT_FOUND", "Not found.");
  let raw: string;
  try {
    raw = decodeURIComponent(rest.slice(0, slash));
  } catch {
    throw new RpcError("NOT_FOUND", "Not found.");
  }
  const ticket = readTtsTicket(raw, Date.now());
  if (!ticket) throw new RpcError("NOT_FOUND", "Stream is invalid or expired.");
  const file = rest.slice(slash + 1);

  if (file === "index.m3u8") {
    const deadline = Date.now() + PLAYLIST_WAIT_MS;
    let manifest = await readManifest(env.MEDIA, ticket.ticket);
    if (!manifest) throw new RpcError("NOT_FOUND", "Stream is invalid or expired.");
    while ((!manifest || (manifest.segments.length === 0 && !manifest.done)) && Date.now() < deadline) {
      await Effect.runPromise(Effect.sleep(PLAYLIST_POLL_MS));
      manifest = await readManifest(env.MEDIA, ticket.ticket);
    }
    if (manifest && (manifest.error || (manifest.done && manifest.segments.length === 0))) {
      throw new RpcError("UNAVAILABLE", "Speech generation failed.", { retryable: false });
    }
    if (!manifest || manifest.segments.length === 0) {
      throw new RpcError("UNAVAILABLE", "Speech is still being generated.", { retryAfterMs: 1_000 });
    }
    return new Response(buildHlsPlaylist(manifest), {
      headers: { "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-store" },
    });
  }

  if (/^seg-\d{1,4}\.mp3$/u.test(file)) {
    const object = await env.MEDIA.get(ttsObjectKey(ticket.ticket, file));
    if (!object) throw new RpcError("NOT_FOUND", "Segment not found.");
    return audioResponse(new Uint8Array(await object.arrayBuffer()), request.headers.get("range"));
  }
  throw new RpcError("NOT_FOUND", "Not found.");
};

export const handleVoiceRoute = async (request: Request, env: VoiceEnv): Promise<Response | null> => {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/voice/")) return null;
  try {
    if (path.startsWith(VOICE_TTS_HLS_PREFIX)) {
      if (request.method !== "GET" && request.method !== "HEAD") throw new RpcError("BAD_REQUEST", "Method not allowed.");
      return await ttsHls(request, env, path);
    }
    if (request.method !== "POST") throw new RpcError("BAD_REQUEST", "Method not allowed.");
    switch (path) {
      case VOICE_LIVE_SDP_PATH:
        return await liveSdp(request, env);
      case VOICE_TTS_PATH:
        return await ttsOneShot(request, env);
      case VOICE_TTS_STREAM_PATH:
        return await ttsStream(request, env);
      case VOICE_TTS_STREAM_CANCEL_PATH:
        return await ttsCancel(request, env);
      default:
        throw new RpcError("NOT_FOUND", "Not found.");
    }
  } catch (error) {
    return errorResponse(error);
  }
};
