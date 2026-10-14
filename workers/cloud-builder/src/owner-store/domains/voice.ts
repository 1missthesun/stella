import { Deferred, Effect } from "effect";
import {
  GPT_LIVE_MODEL,
  VOICE_HISTORY_MAX_CHARS,
  VOICE_HISTORY_MAX_MESSAGES,
  VOICE_INSTRUCTIONS_MAX_CHARS,
  voiceTtsPlaylistPath,
  type VoiceHistoryMessage,
  type VoiceLease,
  type VoiceSession,
} from "@stella/contracts/backend/voice";
import { DEFAULT_GPT_LIVE_VOICE } from "@stella/contracts/realtime-voice-catalog";
import { log } from "../../build-session/shared/keys.js";
import { resolveGeminiTtsVoice, ttsProvider } from "../../voice/tts.js";
import { HLS_MANIFEST_FILE, synthesizeHls, type HlsManifest } from "../../voice/hls.js";
import { mintTtsTicket, ttsObjectKey, ttsOwnerPrefix } from "../../voice/ticket.js";
import { array, empty, literal, number, object, optional, string, type Parser } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDomain, OwnerPurgeMode } from "../registry.js";
import {
  billingAccess,
  billingPlan,
  recordUsage,
  releaseReservation,
  reserveUsage,
  settleReservation,
} from "./billing.js";

const VOICE_SESSION_RATE = { count: 10, windowMs: 60_000 };
const LEASE_TTL_MS = 10_000;
const SESSION_MAX_MS = 5 * 60_000;
const IDLE_REAP_MS = 2 * 60_000;
const CLOSED_LEASE_RETENTION_MS = 24 * 60 * 60_000;
/**
 * GPT-Live charges $0.05 a minute of session duration, per second and not
 * rounded up. Charged for a session's open time, never above one full
 * session.
 */
const ENVELOPE_MICRO_CENTS_PER_SECOND = 83_333;
const SESSION_CHARGE_CAP = (SESSION_MAX_MS / 1_000) * ENVELOPE_MICRO_CENTS_PER_SECOND;
/** Creating a WebRTC session bills 15 seconds up front, credited once it runs. */
const MIN_BILLED_SECONDS = 15;

const OPENAI_LIVE_SESSIONS_URL = "https://api.openai.com/v1/live/sessions";
const liveAttachUrl = (sessionId: string): string =>
  `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(sessionId)}/attach`;

const TTS_RATE = { count: 20, windowMs: 60_000 };
const TTS_MAX_INPUT_CHARS = 8_000;
const TTS_DAILY_CHARS = { free: 60_000, go: 300_000, pro: 1_000_000 } as const;
const TTS_TICKET_TTL_MS = 15 * 60_000;

const MUSE_DICTATION_MODEL = "muse-voice-transcribe-1.0";
const DICTATION_RATE = { count: 30, windowMs: 60_000 };
const MUSE_STT_USD_PER_SECOND = 0.18 / 3_600;
const MUSE_MAX_SESSION_SECONDS = 60 * 60;
const PCM_BYTES_PER_SECOND = 16_000 * 2;
const DICTATION_SESSION_ID = /^muse_[0-9a-f-]{36}$/u;

export const VOICE_REAP_JOB = "voice.reap";
export const TTS_SYNTHESIZE_JOB = "tts.synthesize";
const ttsJobId = (id: string) => `tts:${id}`;

const usdToMicroCents = (usd: number): number => Math.round(usd * 100_000_000);

export const VOICE_MIGRATION = {
  id: "voice.1-init",
  statements: [
    `CREATE TABLE voice_leases (
       lease_id TEXT PRIMARY KEY,
       model TEXT NOT NULL,
       voice TEXT NOT NULL,
       session_config TEXT NOT NULL,
       status TEXT NOT NULL,
       call_id TEXT,
       call_started_at INTEGER,
       charged INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL,
       last_seen_at INTEGER NOT NULL,
       closed_at INTEGER,
       close_reason TEXT,
       hangup_pending INTEGER NOT NULL DEFAULT 0
     )`,
    `CREATE INDEX voice_leases_status ON voice_leases (status, last_seen_at)`,
    `CREATE TABLE tts_streams (
       id TEXT PRIMARY KEY,
       status TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    `CREATE TABLE tts_daily (
       day TEXT PRIMARY KEY,
       chars INTEGER NOT NULL
     )`,
  ],
};

type LeaseRow = {
  lease_id: string;
  model: string;
  voice: string;
  session_config: string;
  status: string;
  call_id: string | null;
  call_started_at: number | null;
  charged: number;
  created_at: number;
  last_seen_at: number;
  closed_at: number | null;
  close_reason: string | null;
  hangup_pending: number;
};

const secret = (env: Cloudflare.Env, name: string): string | null => {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const readLease = (ctx: OwnerContext, leaseId: string): LeaseRow | null =>
  ctx.db.one<LeaseRow>("SELECT * FROM voice_leases WHERE lease_id = ?", leaseId);

/**
 * Startup history for the live session. GPT-Live takes one text part per
 * message, `input_text` for developer and user and `output_text` for the
 * assistant, and caps the list at 128 messages and 8,192 combined tokens.
 * The newest messages matter most, so the list is trimmed from the front.
 */
const buildSessionInput = (history: VoiceHistoryMessage[]): unknown[] => {
  const kept: VoiceHistoryMessage[] = [];
  let chars = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]!;
    const text = entry.text.trim();
    if (!text) continue;
    if (kept.length >= VOICE_HISTORY_MAX_MESSAGES || chars + text.length > VOICE_HISTORY_MAX_CHARS) break;
    chars += text.length;
    kept.push({ role: entry.role, text });
  }
  kept.reverse();
  return kept.map((entry) => ({
    type: "message",
    role: entry.role,
    content: [{ type: entry.role === "assistant" ? "output_text" : "input_text", text: entry.text }],
  }));
};

const closeLiveSession = async (env: Cloudflare.Env, sessionId: string): Promise<boolean> => {
  const apiKey = secret(env, "OPENAI_API_KEY");
  if (!apiKey) return false;
  let socket: WebSocket | null = null;
  try {
    const response = await fetch(liveAttachUrl(sessionId), {
      headers: { authorization: `Bearer ${apiKey}`, upgrade: "websocket" },
    });
    socket = response.webSocket;
    if (!socket) {
      await response.body?.cancel().catch(() => undefined);
      return response.status === 404;
    }
    socket.accept();
    const outcome = Deferred.makeUnsafe<boolean>();
    const settle = (value: boolean) => {
      Deferred.doneUnsafe(outcome, Effect.succeed(value));
    };
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        if ((JSON.parse(event.data) as { type?: unknown }).type === "session.closed") settle(true);
      } catch {
        // Not a frame we care about.
      }
    });
    socket.addEventListener("close", () => settle(true));
    socket.addEventListener("error", () => settle(false));
    const closed = Effect.runPromise(
      Deferred.await(outcome).pipe(
        Effect.timeoutOrElse({ duration: 10_000, orElse: () => Effect.succeed(false) }),
      ),
    );
    socket.send(JSON.stringify({ type: "session.close", event_id: `close_${sessionId}` }));
    return await closed;
  } catch {
    return false;
  } finally {
    try {
      socket?.close();
    } catch {
      // Already closed.
    }
  }
};

const scheduleReap = (ctx: OwnerContext, at: number): void => {
  ctx.jobs.schedule(VOICE_REAP_JOB, at, null, { id: VOICE_REAP_JOB });
};

const closeLease = async (ctx: OwnerContext, leaseId: string, reason: string, closedAt: number): Promise<void> => {
  const lease = readLease(ctx, leaseId);
  if (lease?.status !== "open") return;
  const now = Date.now();
  ctx.db.run(
    "UPDATE voice_leases SET status = 'closed', closed_at = ?, close_reason = ?, hangup_pending = ? WHERE lease_id = ? AND status = 'open'",
    now,
    reason,
    lease.call_id ? 1 : 0,
    lease.lease_id,
  );
  let residual = 0;
  if (lease.call_started_at !== null) {
    const seconds = Math.max(MIN_BILLED_SECONDS, Math.ceil(Math.max(0, closedAt - lease.call_started_at) / 1_000));
    const envelope = Math.min(SESSION_CHARGE_CAP, seconds * ENVELOPE_MICRO_CENTS_PER_SECOND);
    residual = Math.max(0, envelope - lease.charged);
    if (residual > 0) {
      const { recorded } = recordUsage(ctx, [{ id: `voice:${lease.lease_id}:final`, costMicroCents: residual }]);
      if (recorded > 0) {
        ctx.db.run("UPDATE voice_leases SET charged = charged + ? WHERE lease_id = ?", residual, lease.lease_id);
      }
    }
  }
  log("info", "voice_lease_closed", {
    leaseId: lease.lease_id,
    reason,
    chargedMicroCents: lease.charged + residual,
    hadCall: lease.call_id !== null,
  });
  if (lease.call_id && (await closeLiveSession(ctx.env, lease.call_id))) {
    ctx.db.run("UPDATE voice_leases SET hangup_pending = 0 WHERE lease_id = ?", lease.lease_id);
  } else if (lease.call_id) {
    scheduleReap(ctx, now + 30_000);
  }
};

const closedLease = (reason: string | null): VoiceLease => ({ directive: "closed", leaseExpiresAt: null, reason });

const openSession = async (
  ctx: OwnerContext,
  args: {
    instructions: string;
    history?: VoiceHistoryMessage[];
    voice?: string;
    model?: string;
  },
): Promise<VoiceSession> => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "voice.session", VOICE_SESSION_RATE, "Too many voice sessions. Try again in a minute.");
  const access = billingAccess(ctx);
  if (access.plan !== "pro") {
    throw new RpcError("FORBIDDEN", "Realtime voice is part of Stella Pro.", { reason: "capability_required" });
  }
  if (!access.allowed || (access.remainingMicroCents !== null && access.remainingMicroCents < SESSION_CHARGE_CAP)) {
    throw new RpcError("FORBIDDEN", access.message || "Realtime voice needs more usage allowance than you have left.", {
      reason: "usage_limit_reached",
      ...(access.retryAfterMs > 0 ? { retryAfterMs: access.retryAfterMs } : {}),
    });
  }
  if (!secret(ctx.env, "OPENAI_API_KEY")) {
    throw new RpcError("UNAVAILABLE", "Voice sessions are not configured yet.", { retryable: false });
  }
  const instructions = args.instructions.trim();
  if (!instructions) throw new RpcError("BAD_REQUEST", "instructions is required.");
  const model = args.model?.trim() || GPT_LIVE_MODEL;
  const voice = args.voice?.trim() || DEFAULT_GPT_LIVE_VOICE;
  const sessionConfig = JSON.stringify({
    model,
    instructions,
    delegation: { type: "client" },
    input: buildSessionInput(args.history ?? []),
    audio: { output: { voice } },
    store: false,
  });

  for (const lease of ctx.db.all<LeaseRow>("SELECT * FROM voice_leases WHERE status = 'open'")) {
    await closeLease(ctx, lease.lease_id, "superseded", Date.now());
  }
  const now = Date.now();
  const leaseId = `voice_${crypto.randomUUID()}`;
  ctx.db.run(
    `INSERT INTO voice_leases (lease_id, model, voice, session_config, status, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, 'open', ?, ?)`,
    leaseId,
    model,
    voice,
    sessionConfig,
    now,
    now,
  );
  scheduleReap(ctx, now + IDLE_REAP_MS + 1_000);
  log("info", "voice_session_opened", { leaseId, model });
  return { leaseId, model, voice, leaseExpiresAt: now + LEASE_TTL_MS };
};

const leaseEvent = async (
  ctx: OwnerContext,
  args: { leaseId: string; event: "heartbeat" | "ended" | "expired" | "lost" },
): Promise<VoiceLease> => {
  const lease = readLease(ctx, args.leaseId);
  if (!lease) return closedLease("unknown_session");
  if (lease.status !== "open") return closedLease(lease.close_reason);
  const deadline = lease.created_at + SESSION_MAX_MS;
  if (args.event !== "heartbeat") {
    await closeLease(ctx, lease.lease_id, args.event, Math.min(ctx.now, deadline));
    return closedLease(args.event);
  }
  const renewable = lease.last_seen_at + LEASE_TTL_MS;
  if (ctx.now >= deadline || ctx.now > renewable) {
    const reason = ctx.now >= deadline ? "session_expired" : "lease_expired";
    await closeLease(ctx, lease.lease_id, reason, Math.min(deadline, renewable));
    return closedLease(reason);
  }
  ctx.db.run("UPDATE voice_leases SET last_seen_at = ? WHERE lease_id = ?", ctx.now, lease.lease_id);
  return { directive: "continue", leaseExpiresAt: Math.min(ctx.now + LEASE_TTL_MS, deadline), reason: null };
};

const createCall = async (ctx: OwnerContext, raw: unknown): Promise<{ sdp: string }> => {
  const args = object({ leaseId: string({ min: 1, max: 200 }), sdp: string({ min: 10, max: 1_000_000 }) })(raw);
  const lease = readLease(ctx, args.leaseId);
  if (!lease || lease.status !== "open" || lease.call_started_at !== null) {
    throw new RpcError("CONFLICT", "The realtime voice session is no longer available.");
  }
  const apiKey = secret(ctx.env, "OPENAI_API_KEY");
  if (!apiKey) throw new RpcError("UNAVAILABLE", "Voice sessions are not configured yet.", { retryable: false });
  const startedAt = Date.now();
  ctx.db.run(
    "UPDATE voice_leases SET call_started_at = ?, last_seen_at = ? WHERE lease_id = ?",
    startedAt,
    startedAt,
    lease.lease_id,
  );
  let response: Response;
  try {
    response = await fetch(OPENAI_LIVE_SESSIONS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "x-client-request-id": lease.lease_id,
      },
      body: JSON.stringify({
        session: JSON.parse(lease.session_config) as unknown,
        transport: { type: "webrtc", sdp: args.sdp },
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // The session may exist without its id; charge the initialization and move on.
    await closeLease(ctx, lease.lease_id, "openai_session_unreachable", Date.now());
    throw new RpcError("UNAVAILABLE", "Failed to create the live voice session.");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    log("error", "voice_session_create_failed", { leaseId: lease.lease_id, status: response.status, detail: detail.slice(0, 500) });
    ctx.db.run("UPDATE voice_leases SET call_started_at = NULL WHERE lease_id = ?", lease.lease_id);
    await closeLease(ctx, lease.lease_id, `openai_session_${response.status}`, Date.now());
    throw new RpcError("UNAVAILABLE", "Failed to create the live voice session.", { retryable: response.status >= 500 });
  }
  const created = await readLiveSession(response);
  const current = readLease(ctx, lease.lease_id);
  if (!created || current?.status !== "open") {
    if (created) await closeLiveSession(ctx.env, created.sessionId);
    await closeLease(ctx, lease.lease_id, "openai_session_unbound", Date.now());
    throw new RpcError("CONFLICT", "The live voice session is no longer available.");
  }
  ctx.db.run("UPDATE voice_leases SET call_id = ? WHERE lease_id = ?", created.sessionId, lease.lease_id);
  log("info", "voice_session_created", { leaseId: lease.lease_id });
  return { sdp: created.sdp };
};

const readLiveSession = async (response: Response): Promise<{ sessionId: string; sdp: string } | null> => {
  const body = (await response.json().catch(() => null)) as {
    session?: { id?: unknown };
    transport?: { sdp?: unknown };
  } | null;
  const sessionId = typeof body?.session?.id === "string" ? body.session.id.trim() : "";
  const sdp = typeof body?.transport?.sdp === "string" ? body.transport.sdp : "";
  if (!sessionId || !sdp || !/^[A-Za-z0-9._:-]{1,200}$/u.test(sessionId)) return null;
  return { sessionId, sdp };
};

const reap = async (ctx: OwnerContext): Promise<void> => {
  const now = Date.now();
  for (const lease of ctx.db.all<LeaseRow>("SELECT * FROM voice_leases WHERE status = 'open'")) {
    const deadline = lease.created_at + SESSION_MAX_MS;
    if (now - lease.last_seen_at > IDLE_REAP_MS) {
      await closeLease(ctx, lease.lease_id, "idle", Math.min(lease.last_seen_at + LEASE_TTL_MS, deadline));
    } else if (now >= deadline + IDLE_REAP_MS) {
      await closeLease(ctx, lease.lease_id, "session_expired", deadline);
    }
  }
  for (const lease of ctx.db.all<LeaseRow>("SELECT * FROM voice_leases WHERE hangup_pending = 1 AND call_id IS NOT NULL")) {
    if (await closeLiveSession(ctx.env, lease.call_id!)) {
      ctx.db.run("UPDATE voice_leases SET hangup_pending = 0 WHERE lease_id = ?", lease.lease_id);
    }
  }
  ctx.db.run(
    "DELETE FROM voice_leases WHERE status = 'closed' AND hangup_pending = 0 AND closed_at < ?",
    now - CLOSED_LEASE_RETENTION_MS,
  );
  const oldestOpen = ctx.db.one<{ at: number | null }>(
    "SELECT MIN(last_seen_at) AS at FROM voice_leases WHERE status = 'open'",
  )?.at;
  const pendingHangup = ctx.db.one<{ n: number }>("SELECT COUNT(*) AS n FROM voice_leases WHERE hangup_pending = 1")?.n ?? 0;
  if (typeof oldestOpen === "number") scheduleReap(ctx, Math.max(now + 1_000, oldestOpen + IDLE_REAP_MS + 1_000));
  else if (pendingHangup > 0) scheduleReap(ctx, now + 60_000);
};

const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);

const admitTts = (ctx: OwnerContext, chars: number): void => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "tts", TTS_RATE, "Too many read-aloud requests. Try again in a minute.");
  const day = utcDay(ctx.now);
  const limit = TTS_DAILY_CHARS[billingPlan(ctx).plan];
  const used = ctx.db.one<{ chars: number }>("SELECT chars FROM tts_daily WHERE day = ?", day)?.chars ?? 0;
  if (used + chars > limit) {
    const midnight = Date.parse(`${day}T00:00:00Z`) + 24 * 60 * 60_000;
    throw new RpcError("RATE_LIMITED", "You've reached today's read-aloud limit.", {
      reason: "tts_quota",
      retryAfterMs: Math.max(1_000, midnight - ctx.now),
    });
  }
  ctx.db.run(
    `INSERT INTO tts_daily (day, chars) VALUES (?, ?)
     ON CONFLICT (day) DO UPDATE SET chars = chars + excluded.chars`,
    day,
    chars,
  );
  ctx.db.run("DELETE FROM tts_daily WHERE day < ?", day);
};

export const ttsText = (text: string): string => text.trim().slice(0, TTS_MAX_INPUT_CHARS);

const prepareTts = async (
  ctx: OwnerContext,
  args: { text: string; voice?: string },
): Promise<{ ticket: string; playlistPath: string; expiresAt: number }> => {
  const text = ttsText(args.text);
  if (!text) throw new RpcError("BAD_REQUEST", "text is required.");
  if (!ctx.env.MEDIA || !ttsProvider(ctx.env)) {
    throw new RpcError("UNAVAILABLE", "Stella read-aloud is not configured yet.", { retryable: false });
  }
  admitTts(ctx, text.length);
  const ticket = await mintTtsTicket(ctx.ownerId, ctx.now + TTS_TICKET_TTL_MS);
  await ctx.env.MEDIA.put(
    ttsObjectKey(ticket.ticket, HLS_MANIFEST_FILE),
    JSON.stringify({ segments: [], done: false, error: false } satisfies HlsManifest),
    { httpMetadata: { contentType: "application/json" } },
  );
  ctx.db.run("DELETE FROM tts_streams WHERE created_at < ?", ctx.now - TTS_TICKET_TTL_MS);
  ctx.db.run("INSERT INTO tts_streams (id, status, created_at) VALUES (?, 'synthesizing', ?)", ticket.id, ctx.now);
  ctx.jobs.schedule(
    TTS_SYNTHESIZE_JOB,
    ctx.now,
    { id: ticket.id, ticket: ticket.ticket, text, voice: resolveGeminiTtsVoice(args.voice) },
    { id: ttsJobId(ticket.id) },
  );
  return { ticket: ticket.ticket, playlistPath: voiceTtsPlaylistPath(ticket.ticket), expiresAt: ticket.expiresAt };
};

const streamStatus = (ctx: OwnerContext, id: string): string | null =>
  ctx.db.one<{ status: string }>("SELECT status FROM tts_streams WHERE id = ?", id)?.status ?? null;

const synthesize = async (ctx: OwnerContext, payload: unknown): Promise<void> => {
  const job = payload as { id: string; ticket: string; text: string; voice: string };
  if (streamStatus(ctx, job.id) !== "synthesizing") return;
  if (!ttsProvider(ctx.env) || !ctx.env.MEDIA) {
    ctx.db.run("UPDATE tts_streams SET status = 'error' WHERE id = ?", job.id);
    return;
  }
  const startedAt = Date.now();
  const result = await synthesizeHls({
    bucket: ctx.env.MEDIA,
    env: ctx.env,
    ticket: job.ticket,
    text: job.text,
    voice: job.voice,
    canceled: () => streamStatus(ctx, job.id) !== "synthesizing",
  });
  ctx.db.run("UPDATE tts_streams SET status = ? WHERE id = ? AND status = 'synthesizing'", result.status, job.id);
  log("info", "tts_usage", {
    transport: "hls",
    status: result.status,
    segments: result.segments,
    requestChars: job.text.length,
    ...result.usage,
    durationMs: Date.now() - startedAt,
  });
};

const prepareDictation = (ctx: OwnerContext, raw: unknown) => {
  const { sessionId } = object({ sessionId: string({ pattern: DICTATION_SESSION_ID }) })(raw);
  enforceOwnerRateLimit(ctx.db, ctx.now, "dictation", DICTATION_RATE, "Too many dictation sessions. Try again in a minute.");
  const access = billingAccess(ctx);
  const perSecond = usdToMicroCents(MUSE_STT_USD_PER_SECOND);
  const maxSeconds =
    access.remainingMicroCents === null
      ? MUSE_MAX_SESSION_SECONDS
      : Math.min(MUSE_MAX_SESSION_SECONDS, Math.floor(access.remainingMicroCents / perSecond));
  if (!access.allowed || maxSeconds < 1) {
    throw new RpcError("FORBIDDEN", access.message || "Your Stella usage allowance is too low to start dictation.", {
      reason: "usage_limit_reached",
    });
  }
  return {
    sessionId,
    providerDeadlineAt: ctx.now + maxSeconds * 1_000,
    maxAudioBytes: maxSeconds * PCM_BYTES_PER_SECOND,
  };
};

const DICTATION_CLIP_MAX_BYTES = 15 * 60 * PCM_BYTES_PER_SECOND;
const DICTATION_RESERVATION_MS = 10 * 60_000;
const clipReservationId = (sessionId: string) => `dictation:${sessionId}`;

const reserveDictationClip = (ctx: OwnerContext, raw: unknown) => {
  const { sessionId, audioBytes } = object({
    sessionId: string({ pattern: DICTATION_SESSION_ID }),
    audioBytes: number({ int: true, min: 1, max: DICTATION_CLIP_MAX_BYTES }),
  })(raw);
  enforceOwnerRateLimit(ctx.db, ctx.now, "dictation", DICTATION_RATE, "Too many dictation sessions. Try again in a minute.");
  const access = reserveUsage(ctx, {
    id: clipReservationId(sessionId),
    budgetMicroCents: usdToMicroCents((audioBytes / PCM_BYTES_PER_SECOND) * MUSE_STT_USD_PER_SECOND),
    expiresAt: ctx.now + DICTATION_RESERVATION_MS,
  });
  if (!access.reserved) {
    throw new RpcError("FORBIDDEN", access.message || "Your Stella usage allowance is too low for this recording.", {
      reason: "usage_limit_reached",
    });
  }
  return { sessionId };
};

const settleDictationSegment = (ctx: OwnerContext, raw: unknown) => {
  const { sessionId, segment, audioBytes, costUsd } = object({
    sessionId: string({ pattern: DICTATION_SESSION_ID }),
    segment: number({ int: true, min: 0, max: 100 }),
    audioBytes: number({ int: true, min: 0, max: DICTATION_CLIP_MAX_BYTES }),
    costUsd: optional(number({ min: 0, max: 100 })),
  })(raw);
  const costMicroCents = usdToMicroCents(
    costUsd ?? (audioBytes / PCM_BYTES_PER_SECOND) * MUSE_STT_USD_PER_SECOND,
  );
  recordUsage(ctx, [{ id: `${clipReservationId(sessionId)}:${segment}`, costMicroCents }]);
  settleReservation(ctx, clipReservationId(sessionId), costMicroCents);
  return { costMicroCents };
};

const MAPS_RATE = { count: 20, windowMs: 60_000 };
const MAPS_PLACE_USD = 0.032;
const MAPS_ROUTE_USD = 0.01;

const admitMaps = (ctx: OwnerContext, raw: unknown) => {
  const { requestId, places, route } = object({
    requestId: string({ min: 8, max: 64 }),
    places: number({ int: true, min: 0, max: 8 }),
    route: literal(true, false),
  })(raw);
  enforceOwnerRateLimit(ctx.db, ctx.now, "maps", MAPS_RATE, "Too many map lookups. Try again in a minute.");
  const access = billingAccess(ctx);
  if (!access.allowed) {
    throw new RpcError("FORBIDDEN", access.message || "Your Stella usage limit is reached.", {
      reason: "usage_limit_reached",
    });
  }
  const costMicroCents = usdToMicroCents(places * MAPS_PLACE_USD + (route ? MAPS_ROUTE_USD : 0));
  recordUsage(ctx, [{ id: `maps:${requestId}`, costMicroCents }]);
  return { costMicroCents };
};

const releaseDictationClip = (ctx: OwnerContext, raw: unknown) => {
  const { sessionId } = object({ sessionId: string({ pattern: DICTATION_SESSION_ID }) })(raw);
  releaseReservation(ctx, clipReservationId(sessionId));
  return { ok: true };
};

const settleDictation = (ctx: OwnerContext, raw: unknown) => {
  const { sessionId, audioBytes } = object({
    sessionId: string({ pattern: DICTATION_SESSION_ID }),
    audioBytes: number({ int: true, min: 0, max: MUSE_MAX_SESSION_SECONDS * PCM_BYTES_PER_SECOND }),
  })(raw);
  const costMicroCents = usdToMicroCents((audioBytes / PCM_BYTES_PER_SECOND) * MUSE_STT_USD_PER_SECOND);
  recordUsage(ctx, [{ id: `dictation:${sessionId}`, costMicroCents }]);
  return { costMicroCents };
};

const purgeVoice = async (ctx: OwnerContext, mode: OwnerPurgeMode): Promise<{ pending: boolean }> => {
  const calls = ctx.db.all<{ call_id: string }>(
    "SELECT call_id FROM voice_leases WHERE call_id IS NOT NULL AND (status = 'open' OR hangup_pending = 1)",
  );
  ctx.db.run("DELETE FROM voice_leases");
  for (const { id } of ctx.db.all<{ id: string }>("SELECT id FROM tts_streams")) ctx.jobs.cancel(ttsJobId(id));
  ctx.db.run("DELETE FROM tts_streams");
  if (mode === "delete") ctx.db.run("DELETE FROM tts_daily");
  ctx.jobs.cancel(VOICE_REAP_JOB);
  await Promise.all(calls.map(({ call_id }) => closeLiveSession(ctx.env, call_id)));
  const bucket = ctx.env.MEDIA;
  if (!bucket) return { pending: false };
  const listed = await bucket.list({ prefix: await ttsOwnerPrefix(ctx.ownerId), limit: 1_000 });
  if (listed.objects.length > 0) await bucket.delete(listed.objects.map((object) => object.key));
  return { pending: listed.truncated };
};

const historyArg: Parser<VoiceHistoryMessage> = object({
  role: literal("developer", "user", "assistant"),
  text: string({ min: 1, max: VOICE_HISTORY_MAX_CHARS }),
});

export const voiceDomain = {
  name: "voice",
  migrations: [VOICE_MIGRATION],
  calls: {
    "voice.session": {
      scope: "owner",
      parse: object({
        instructions: string({ min: 1, max: VOICE_INSTRUCTIONS_MAX_CHARS }),
        history: optional(array(historyArg, { max: VOICE_HISTORY_MAX_MESSAGES })),
        voice: optional(string({ max: 100 })),
        model: optional(string({ max: 100 })),
      }),
      handler: openSession,
    },
    "voice.lease": {
      scope: "owner",
      parse: object({
        leaseId: string({ min: 1, max: 200 }),
        event: literal("heartbeat", "ended", "expired", "lost"),
      }),
      handler: leaseEvent,
    },
    "tts.prepare": {
      scope: "owner",
      parse: object({ text: string({ min: 1, max: 100_000 }), voice: optional(string({ max: 100 })) }),
      handler: prepareTts,
    },
    "dictation.realtimeConfig": {
      scope: "global",
      parse: empty(),
      handler: (ctx) => {
        const relayOrigin = ctx.env.CLOUD_BUILDER_PUBLIC_URL?.trim().replace(/\/+$/u, "");
        if (!relayOrigin) throw new RpcError("UNAVAILABLE", "Muse dictation is not configured.", { retryable: false });
        return { relayOrigin, modelId: MUSE_DICTATION_MODEL };
      },
    },
  },
  internal: {
    "voice.sdp": createCall,
    "tts.admit": (ctx, raw) => {
      const { chars } = object({ chars: number({ int: true, min: 1, max: TTS_MAX_INPUT_CHARS }) })(raw);
      admitTts(ctx, chars);
      return { ok: true };
    },
    "tts.cancel": (ctx, raw) => {
      const { id } = object({ id: string({ min: 1, max: 64 }) })(raw);
      ctx.db.run("UPDATE tts_streams SET status = 'canceled' WHERE id = ? AND status = 'synthesizing'", id);
      return { ok: true };
    },
    "dictation.prepare": prepareDictation,
    "dictation.settle": settleDictation,
    "dictation.reserveClip": reserveDictationClip,
    "dictation.settleSegment": settleDictationSegment,
    "dictation.releaseClip": releaseDictationClip,
    "maps.admit": admitMaps,
  },
  jobs: {
    [VOICE_REAP_JOB]: { run: (ctx: OwnerContext) => reap(ctx) },
    [TTS_SYNTHESIZE_JOB]: { run: synthesize, maxAttempts: 1 },
  },
  purge: purgeVoice,
} satisfies OwnerDomain;
