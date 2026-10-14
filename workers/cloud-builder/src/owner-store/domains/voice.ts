import { isPaidBillingPlan, PLAN_CATALOG } from "@stella/contracts/billing-plans";
import {
  DICTATION_TARIFF,
  MAPS_TARIFF,
  REALTIME_VOICE_TARIFF,
  TARIFF_VERSION,
  TTS_TARIFF,
  usdToMicroCents,
  type CostEntry,
  type CostOutcome,
} from "@stella/contracts/billing-tariffs";
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
import { estimateTtsUsage, resolveGeminiTtsVoice, TTS_MODEL, ttsProvider } from "../../voice/tts.js";
import { HLS_MANIFEST_FILE, synthesizeHls, type HlsManifest } from "../../voice/hls.js";
import { mintTtsTicket, ttsObjectKey, ttsOwnerPrefix } from "../../voice/ticket.js";
import { array, empty, literal, number, object, optional, string, type Parser } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDomain, OwnerPurgeMode } from "../registry.js";
import { billingAccess, billingPlan, releaseSpend, reserveSpend, settleSpend } from "./billing.js";
import { cancelSpendExpiry, expireSpendAt, spendExpiryJobs } from "./spend-expiry.js";

const VOICE_SESSION_RATE = { count: 10, windowMs: 60_000 };
const LEASE_TTL_MS = 10_000;
const SESSION_MAX_MS = 5 * 60_000;
const IDLE_REAP_MS = 2 * 60_000;
const CLOSED_LEASE_RETENTION_MS = 24 * 60 * 60_000;
/**
 * GPT-Live charges per second of session duration, not rounded up. Charged
 * for a session's open time until the provider session is actually closed,
 * never above one full session. Creating a WebRTC session bills 15 seconds
 * up front, credited once it runs.
 */
const ENVELOPE_MICRO_CENTS_PER_SECOND = Math.round(usdToMicroCents(REALTIME_VOICE_TARIFF.gptLiveUsdPerMinute) / 60);
const SESSION_CHARGE_CAP = (SESSION_MAX_MS / 1_000) * ENVELOPE_MICRO_CENTS_PER_SECOND;
const MIN_BILLED_SECONDS = REALTIME_VOICE_TARIFF.minimumBilledSeconds;
const VOICE_RESERVATION_MS = SESSION_MAX_MS + 2 * IDLE_REAP_MS + 30 * 60_000;
const voiceSpendId = (leaseId: string) => `voice:${leaseId}`;

const OPENAI_LIVE_SESSIONS_URL = "https://api.openai.com/v1/live/sessions";
const liveAttachUrl = (sessionId: string): string =>
  `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(sessionId)}/attach`;

const TTS_RATE = { count: 20, windowMs: 60_000 };
const TTS_MAX_INPUT_CHARS = 8_000;

const TTS_TICKET_TTL_MS = 15 * 60_000;

const MUSE_DICTATION_MODEL = "muse-voice-transcribe-1.0";
const DICTATION_RATE = { count: 30, windowMs: 60_000 };
const MUSE_STT_USD_PER_SECOND = DICTATION_TARIFF.museUsdPerHour / 3_600;
const MUSE_MAX_SESSION_SECONDS = 60 * 60;
// Streaming dictation holds budget a few minutes of audio at a time and
// extends the hold as the session runs.
const MUSE_HOLD_SECONDS = 3 * 60;
const MUSE_RESERVATION_MS = (MUSE_MAX_SESSION_SECONDS + 15 * 60) * 1_000;
const PCM_BYTES_PER_SECOND = 16_000 * 2;
const DICTATION_SESSION_ID = /^muse_[0-9a-f-]{36}$/u;

export const VOICE_REAP_JOB = "voice.reap";
export const TTS_SYNTHESIZE_JOB = "tts.synthesize";
const ttsJobId = (id: string) => `tts:${id}`;

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

export const DICTATION_SESSIONS_MIGRATION = {
  id: "voice.2-dictation-sessions",
  statements: [
    `CREATE TABLE dictation_sessions (
       session_id TEXT PRIMARY KEY,
       allowed_bytes INTEGER NOT NULL,
       created_at INTEGER NOT NULL
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

const voiceEnvelope = (lease: LeaseRow, until: number): number => {
  if (lease.call_started_at === null) return 0;
  const seconds = Math.max(MIN_BILLED_SECONDS, Math.ceil(Math.max(0, until - lease.call_started_at) / 1_000));
  return Math.min(SESSION_CHARGE_CAP, seconds * ENVELOPE_MICRO_CENTS_PER_SECOND);
};

// Charge a lease up to `until` (what OpenAI bills for its open time), write
// its cost row, and drop the hold once nothing more can accrue.
const chargeLease = (
  ctx: OwnerContext,
  lease: LeaseRow,
  input: { until: number; receipt: "final" | "hangup"; outcome: CostOutcome; release: boolean },
): number => {
  const residual = Math.max(0, voiceEnvelope(lease, input.until) - lease.charged);
  const id = `${voiceSpendId(lease.lease_id)}:${input.receipt}`;
  const { charged } = settleSpend(
    { ...ctx, now: Date.now() },
    {
      receiptId: id,
      chargeMicroCents: residual,
      reservationId: voiceSpendId(lease.lease_id),
      release: input.release,
      ...(lease.call_started_at !== null
        ? {
            cost: {
              id,
              category: "voice",
              provider: "openai",
              sku: lease.model,
              quantity: { seconds: Math.max(0, Math.ceil((input.until - lease.call_started_at) / 1_000)) },
              providerCostMicroCents: residual,
              basis: "estimated",
              outcome: input.outcome,
              requestId: lease.lease_id,
              tariffVersion: TARIFF_VERSION,
            } satisfies CostEntry,
          }
        : {}),
    },
  );
  if (charged && residual > 0) {
    ctx.db.run("UPDATE voice_leases SET charged = charged + ? WHERE lease_id = ?", residual, lease.lease_id);
  }
  return charged ? residual : 0;
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
  const outcome: CostOutcome = reason.startsWith("openai_") ? "failed" : reason === "ended" ? "succeeded" : "aborted";
  const residual = chargeLease(ctx, lease, { until: closedAt, receipt: "final", outcome, release: !lease.call_id });
  log("info", "voice_lease_closed", {
    leaseId: lease.lease_id,
    reason,
    chargedMicroCents: lease.charged + residual,
    hadCall: lease.call_id !== null,
  });
  if (lease.call_id && (await closeLiveSession(ctx.env, lease.call_id))) {
    ctx.db.run("UPDATE voice_leases SET hangup_pending = 0 WHERE lease_id = ?", lease.lease_id);
    releaseSpend(ctx, voiceSpendId(lease.lease_id));
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
  if (!isPaidBillingPlan(access.plan)) {
    throw new RpcError("FORBIDDEN", "Realtime voice needs a paid plan.", { reason: "capability_required" });
  }
  const outOfBudget = (message: string) =>
    new RpcError("FORBIDDEN", access.message || message, {
      reason: "usage_limit_reached",
      ...(access.retryAfterMs > 0 ? { retryAfterMs: access.retryAfterMs } : {}),
    });
  if (!access.allowed) throw outOfBudget("Your Stella usage limit is reached.");
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
  const hold = reserveSpend(
    { ...ctx, now },
    { id: voiceSpendId(leaseId), microCents: SESSION_CHARGE_CAP, expiresAt: now + VOICE_RESERVATION_MS, category: "voice" },
  );
  if (!hold.reserved) throw outOfBudget("Realtime voice needs more usage allowance than you have left.");
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
      chargeLease(ctx, lease, { until: Date.now(), receipt: "hangup", outcome: "aborted", release: true });
    } else if (now - (lease.closed_at ?? now) > VOICE_RESERVATION_MS) {
      chargeLease(ctx, lease, { until: Date.now(), receipt: "hangup", outcome: "aborted", release: true });
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

type TtsVendor = "fal" | "openrouter" | "openai";

const TTS_RESERVATION_MS = 15 * 60_000;
const ttsSpendId = (id: string) => `tts:${id}`;

const ttsHoldMicroCents = (vendor: TtsVendor, chars: number): number =>
  usdToMicroCents(
    (chars / 1_000) *
      (vendor === "openai" ? TTS_TARIFF.openAiMiniUsdPerThousandChars : TTS_TARIFF.falGeminiUsdPerThousandChars),
  );

// What one synthesis cost us: fal and OpenAI mini by input characters sent,
// OpenRouter Gemini by text and audio tokens.
const ttsCostMicroCents = (vendor: TtsVendor, chars: number, pcmBytes: number): number =>
  vendor === "openai"
    ? usdToMicroCents((chars / 1_000) * TTS_TARIFF.openAiMiniUsdPerThousandChars)
    : usdToMicroCents(estimateTtsUsage(vendor, chars, pcmBytes).estimatedUsd);

// Read-aloud spends the pooled budget. The per-plan daily character cap stays
// as a safety limit on top.
const admitTts = (ctx: OwnerContext, input: { id: string; chars: number; vendor: TtsVendor }): void => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "tts", TTS_RATE, "Too many read-aloud requests. Try again in a minute.");
  const day = utcDay(ctx.now);
  const limit = PLAN_CATALOG[billingPlan(ctx).plan].limits.readAloudCharsPerDay;
  const used = ctx.db.one<{ chars: number }>("SELECT chars FROM tts_daily WHERE day = ?", day)?.chars ?? 0;
  if (used + input.chars > limit) {
    const midnight = Date.parse(`${day}T00:00:00Z`) + 24 * 60 * 60_000;
    throw new RpcError("RATE_LIMITED", "You've reached today's read-aloud limit.", {
      reason: "tts_quota",
      retryAfterMs: Math.max(1_000, midnight - ctx.now),
    });
  }
  const hold = reserveSpend(ctx, {
    id: ttsSpendId(input.id),
    microCents: ttsHoldMicroCents(input.vendor, input.chars),
    expiresAt: ctx.now + TTS_RESERVATION_MS,
    category: "tts",
  });
  if (!hold.reserved) {
    throw new RpcError("RATE_LIMITED", hold.message || "Your Stella budget is too low to read this aloud.", {
      reason: "usage_limit",
      ...(hold.retryAfterMs > 0 ? { retryAfterMs: hold.retryAfterMs } : {}),
    });
  }
  expireSpendAt(ctx, { id: ttsSpendId(input.id), category: "tts", provider: input.vendor, sku: ttsSku(input.vendor) }, ctx.now + TTS_RESERVATION_MS);
  ctx.db.run(
    `INSERT INTO tts_daily (day, chars) VALUES (?, ?)
     ON CONFLICT (day) DO UPDATE SET chars = chars + excluded.chars`,
    day,
    input.chars,
  );
  ctx.db.run("DELETE FROM tts_daily WHERE day < ?", day);
};

const ttsSku = (vendor: TtsVendor): string => (vendor === "openai" ? "gpt-4o-mini-tts" : TTS_MODEL);

const settleTts = (
  ctx: OwnerContext,
  input: { id: string; vendor: TtsVendor; chars: number; pcmBytes: number; outcome: CostOutcome },
): number => {
  const charge = input.chars > 0 ? ttsCostMicroCents(input.vendor, input.chars, input.pcmBytes) : 0;
  settleSpend(
    { ...ctx, now: Date.now() },
    {
      receiptId: ttsSpendId(input.id),
      chargeMicroCents: charge,
      reservationId: ttsSpendId(input.id),
      release: true,
      ...(input.chars > 0
        ? {
            cost: {
              id: ttsSpendId(input.id),
              category: "tts",
              provider: input.vendor,
              sku: ttsSku(input.vendor),
              quantity: { chars: input.chars, audioSeconds: Math.round(input.pcmBytes / 48_000) },
              providerCostMicroCents: charge,
              basis: "estimated",
              outcome: input.outcome,
              tariffVersion: TARIFF_VERSION,
            } satisfies CostEntry,
          }
        : {}),
    },
  );
  cancelSpendExpiry(ctx, ttsSpendId(input.id));
  return charge;
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
  const vendor = ttsProvider(ctx.env)!.provider;
  const ticket = await mintTtsTicket(ctx.ownerId, ctx.now + TTS_TICKET_TTL_MS);
  admitTts(ctx, { id: ticket.id, chars: text.length, vendor });
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
    { id: ticket.id, ticket: ticket.ticket, text, voice: resolveGeminiTtsVoice(args.voice), vendor },
    { id: ttsJobId(ticket.id) },
  );
  return { ticket: ticket.ticket, playlistPath: voiceTtsPlaylistPath(ticket.ticket), expiresAt: ticket.expiresAt };
};

const streamStatus = (ctx: OwnerContext, id: string): string | null =>
  ctx.db.one<{ status: string }>("SELECT status FROM tts_streams WHERE id = ?", id)?.status ?? null;

const synthesize = async (ctx: OwnerContext, payload: unknown): Promise<void> => {
  const job = payload as { id: string; ticket: string; text: string; voice: string; vendor?: TtsVendor };
  const vendor = job.vendor ?? ttsProvider(ctx.env)?.provider ?? "fal";
  if (streamStatus(ctx, job.id) !== "synthesizing" || !ttsProvider(ctx.env) || !ctx.env.MEDIA) {
    ctx.db.run("UPDATE tts_streams SET status = 'error' WHERE id = ? AND status = 'synthesizing'", job.id);
    settleTts(ctx, { id: job.id, vendor, chars: 0, pcmBytes: 0, outcome: "cancelled" });
    return;
  }
  const startedAt = Date.now();
  let usage: { sentChars: number; pcmBytes: number } = { sentChars: 0, pcmBytes: 0 };
  let status = "error";
  try {
    const result = await synthesizeHls({
      bucket: ctx.env.MEDIA,
      env: ctx.env,
      ticket: job.ticket,
      text: job.text,
      voice: job.voice,
      canceled: () => streamStatus(ctx, job.id) !== "synthesizing",
    });
    status = result.status;
    usage = { sentChars: result.sentChars, pcmBytes: result.pcmBytes };
    log("info", "tts_usage", {
      transport: "hls",
      status: result.status,
      segments: result.segments,
      requestChars: job.text.length,
      ...result.usage,
      durationMs: Date.now() - startedAt,
    });
  } finally {
    ctx.db.run("UPDATE tts_streams SET status = ? WHERE id = ? AND status = 'synthesizing'", status, job.id);
    settleTts(ctx, {
      id: job.id,
      vendor,
      chars: usage.sentChars,
      pcmBytes: usage.pcmBytes,
      outcome: status === "done" ? "succeeded" : status === "canceled" ? "cancelled" : "failed",
    });
  }
};

const museCost = (audioBytes: number): number =>
  usdToMicroCents((audioBytes / PCM_BYTES_PER_SECOND) * MUSE_STT_USD_PER_SECOND);
const museBytesFor = (microCents: number): number =>
  Math.min(
    MUSE_MAX_SESSION_SECONDS * PCM_BYTES_PER_SECOND,
    Math.floor((microCents / usdToMicroCents(MUSE_STT_USD_PER_SECOND)) * PCM_BYTES_PER_SECOND),
  );
const dictationSpendId = (sessionId: string) => `dictation:${sessionId}`;

const museExpiry = (sessionId: string) => ({
  id: dictationSpendId(sessionId),
  category: "dictation" as const,
  provider: "meta",
  sku: MUSE_DICTATION_MODEL,
});

// Streaming dictation holds a few minutes of audio up front; the relay extends
// the hold as it goes and ends the session when it can't.
const holdMuse = (ctx: OwnerContext, sessionId: string, audioBytes: number) => {
  const maxBytes = MUSE_MAX_SESSION_SECONDS * PCM_BYTES_PER_SECOND;
  const target = Math.min(maxBytes, audioBytes + MUSE_HOLD_SECONDS * PCM_BYTES_PER_SECOND);
  const floor = Math.min(maxBytes, audioBytes + PCM_BYTES_PER_SECOND);
  const created = ctx.db.one<{ created_at: number }>(
    "SELECT created_at FROM dictation_sessions WHERE session_id = ?",
    sessionId,
  )?.created_at ?? ctx.now;
  return reserveSpend(ctx, {
    id: dictationSpendId(sessionId),
    microCents: museCost(target),
    minimumMicroCents: museCost(floor),
    expiresAt: created + MUSE_RESERVATION_MS,
    category: "dictation",
  });
};

const prepareDictation = (ctx: OwnerContext, raw: unknown) => {
  const { sessionId } = object({ sessionId: string({ pattern: DICTATION_SESSION_ID }) })(raw);
  enforceOwnerRateLimit(ctx.db, ctx.now, "dictation", DICTATION_RATE, "Too many dictation sessions. Try again in a minute.");
  const hold = holdMuse(ctx, sessionId, 0);
  if (!hold.reserved) {
    throw new RpcError("FORBIDDEN", hold.message || "Your Stella usage allowance is too low to start dictation.", {
      reason: "usage_limit_reached",
    });
  }
  const allowed = hold.unlimited ? MUSE_MAX_SESSION_SECONDS * PCM_BYTES_PER_SECOND : museBytesFor(hold.reservedMicroCents);
  ctx.db.run(
    "INSERT OR REPLACE INTO dictation_sessions (session_id, allowed_bytes, created_at) VALUES (?, ?, ?)",
    sessionId,
    allowed,
    ctx.now,
  );
  expireSpendAt(ctx, museExpiry(sessionId), ctx.now + MUSE_RESERVATION_MS);
  return {
    sessionId,
    providerDeadlineAt: ctx.now + MUSE_MAX_SESSION_SECONDS * 1_000,
    maxAudioBytes: allowed,
  };
};

const extendDictation = (ctx: OwnerContext, raw: unknown) => {
  const { sessionId, audioBytes } = object({
    sessionId: string({ pattern: DICTATION_SESSION_ID }),
    audioBytes: number({ int: true, min: 0, max: MUSE_MAX_SESSION_SECONDS * PCM_BYTES_PER_SECOND }),
  })(raw);
  const session = ctx.db.one<{ allowed_bytes: number }>(
    "SELECT allowed_bytes FROM dictation_sessions WHERE session_id = ?",
    sessionId,
  );
  if (!session) return { maxAudioBytes: 0 };
  const hold = holdMuse(ctx, sessionId, audioBytes);
  if (!hold.reserved) return { maxAudioBytes: session.allowed_bytes };
  const allowed = hold.unlimited
    ? MUSE_MAX_SESSION_SECONDS * PCM_BYTES_PER_SECOND
    : Math.max(session.allowed_bytes, museBytesFor(hold.reservedMicroCents));
  ctx.db.run("UPDATE dictation_sessions SET allowed_bytes = ? WHERE session_id = ?", allowed, sessionId);
  return { maxAudioBytes: allowed };
};

const settleDictation = (ctx: OwnerContext, raw: unknown) => {
  const { sessionId, audioBytes, success } = object({
    sessionId: string({ pattern: DICTATION_SESSION_ID }),
    audioBytes: number({ int: true, min: 0, max: MUSE_MAX_SESSION_SECONDS * PCM_BYTES_PER_SECOND }),
    success: optional(literal(true, false)),
  })(raw);
  const costMicroCents = museCost(audioBytes);
  const id = dictationSpendId(sessionId);
  settleSpend(ctx, {
    receiptId: id,
    chargeMicroCents: costMicroCents,
    reservationId: id,
    release: true,
    ...(audioBytes > 0
      ? {
          cost: {
            id,
            category: "dictation",
            provider: "meta",
            sku: MUSE_DICTATION_MODEL,
            quantity: { audioSeconds: Math.round(audioBytes / PCM_BYTES_PER_SECOND) },
            providerCostMicroCents: costMicroCents,
            basis: "estimated",
            outcome: success === false ? "failed" : "succeeded",
            requestId: sessionId,
            tariffVersion: TARIFF_VERSION,
          } satisfies CostEntry,
        }
      : {}),
  });
  ctx.db.run("DELETE FROM dictation_sessions WHERE session_id = ?", sessionId);
  cancelSpendExpiry(ctx, id);
  return { costMicroCents };
};

const DICTATION_CLIP_MAX_BYTES = 15 * 60 * PCM_BYTES_PER_SECOND;
const DICTATION_RESERVATION_MS = 10 * 60_000;
// The clip route settles at OpenRouter's reported cost, else the fallback
// rate; hold above that so a clip can never settle past its reservation.
const CLIP_RESERVE_MARGIN = 1.25;
const clipFallbackCost = (audioBytes: number): number =>
  usdToMicroCents((audioBytes / PCM_BYTES_PER_SECOND) * DICTATION_TARIFF.openRouterFallbackUsdPerSecond);

const clipExpiry = (sessionId: string) => ({
  id: dictationSpendId(sessionId),
  category: "dictation" as const,
  provider: "openrouter",
  sku: "transcription",
});

const reserveDictationClip = (ctx: OwnerContext, raw: unknown) => {
  const { sessionId, audioBytes } = object({
    sessionId: string({ pattern: DICTATION_SESSION_ID }),
    audioBytes: number({ int: true, min: 1, max: DICTATION_CLIP_MAX_BYTES }),
  })(raw);
  enforceOwnerRateLimit(ctx.db, ctx.now, "dictation", DICTATION_RATE, "Too many dictation sessions. Try again in a minute.");
  const hold = reserveSpend(ctx, {
    id: dictationSpendId(sessionId),
    microCents: Math.ceil(clipFallbackCost(audioBytes) * CLIP_RESERVE_MARGIN),
    expiresAt: ctx.now + DICTATION_RESERVATION_MS,
    category: "dictation",
  });
  if (!hold.reserved) {
    throw new RpcError("FORBIDDEN", hold.message || "Your Stella usage allowance is too low for this recording.", {
      reason: "usage_limit_reached",
    });
  }
  expireSpendAt(ctx, clipExpiry(sessionId), ctx.now + DICTATION_RESERVATION_MS);
  return { sessionId };
};

const segmentArg = object({
  segment: number({ int: true, min: 0, max: 100 }),
  audioBytes: number({ int: true, min: 0, max: DICTATION_CLIP_MAX_BYTES }),
  costUsd: optional(number({ min: 0, max: 100 })),
  model: optional(string({ max: 200 })),
  outcome: optional(literal("succeeded", "failed", "aborted")),
});

type ClipSegment = ReturnType<typeof segmentArg>;

const chargeClipSegment = (ctx: OwnerContext, sessionId: string, input: ClipSegment): number => {
  const costMicroCents =
    input.costUsd !== undefined ? usdToMicroCents(input.costUsd) : clipFallbackCost(input.audioBytes);
  const id = `${dictationSpendId(sessionId)}:${input.segment}`;
  settleSpend(ctx, {
    receiptId: id,
    chargeMicroCents: costMicroCents,
    reservationId: dictationSpendId(sessionId),
    cost: {
      id,
      category: "dictation",
      provider: "openrouter",
      sku: input.model ?? "transcription",
      quantity: { audioSeconds: Math.round(input.audioBytes / PCM_BYTES_PER_SECOND) },
      providerCostMicroCents: costMicroCents,
      basis: input.costUsd !== undefined ? "actual" : "estimated",
      outcome: input.outcome ?? "succeeded",
      attempt: 1,
      requestId: sessionId,
      tariffVersion: TARIFF_VERSION,
    },
  });
  return costMicroCents;
};

const settleDictationSegment = (ctx: OwnerContext, raw: unknown) => {
  const { sessionId, ...segment } = object({
    sessionId: string({ pattern: DICTATION_SESSION_ID }),
    segment: number({ int: true, min: 0, max: 100 }),
    audioBytes: number({ int: true, min: 0, max: DICTATION_CLIP_MAX_BYTES }),
    costUsd: optional(number({ min: 0, max: 100 })),
    model: optional(string({ max: 200 })),
    outcome: optional(literal("succeeded", "failed", "aborted")),
  })(raw);
  return { costMicroCents: chargeClipSegment(ctx, sessionId, segment) };
};

// Ends a clip: charges any segment whose settlement did not get through
// (idempotent per segment), then drops what is left of the hold.
const finishDictationClip = (ctx: OwnerContext, raw: unknown) => {
  const { sessionId, unsettled } = object({
    sessionId: string({ pattern: DICTATION_SESSION_ID }),
    unsettled: optional(array(segmentArg, { max: 100 })),
  })(raw);
  for (const segment of unsettled ?? []) chargeClipSegment(ctx, sessionId, segment);
  releaseSpend(ctx, dictationSpendId(sessionId));
  cancelSpendExpiry(ctx, dictationSpendId(sessionId));
  return { ok: true };
};

const MAPS_RATE = { count: 20, windowMs: 60_000 };
const MAPS_RESERVATION_MS = 5 * 60_000;
const mapsSpendId = (requestId: string) => `maps:${requestId}`;
const mapsCost = (places: number, routes: number): number =>
  usdToMicroCents(places * MAPS_TARIFF.placeTextSearchUsd + routes * MAPS_TARIFF.routeUsd);

const admitMaps = (ctx: OwnerContext, raw: unknown) => {
  const { requestId, places, route } = object({
    requestId: string({ min: 8, max: 64 }),
    places: number({ int: true, min: 0, max: MAPS_TARIFF.maxPlacesPerRequest }),
    route: literal(true, false),
  })(raw);
  enforceOwnerRateLimit(ctx.db, ctx.now, "maps", MAPS_RATE, "Too many map lookups. Try again in a minute.");
  const maxCost = mapsCost(places, route ? 1 : 0);
  const hold = reserveSpend(ctx, {
    id: mapsSpendId(requestId),
    microCents: maxCost,
    expiresAt: ctx.now + MAPS_RESERVATION_MS,
    category: "maps",
  });
  if (!hold.reserved) {
    throw new RpcError("FORBIDDEN", hold.message || "Your Stella budget is too low for this map.", {
      reason: "usage_limit_reached",
    });
  }
  expireSpendAt(
    ctx,
    { id: mapsSpendId(requestId), category: "maps", provider: "google", sku: "resolve" },
    ctx.now + MAPS_RESERVATION_MS,
  );
  return { reservedMicroCents: maxCost };
};

// Charges each Google SKU the resolver actually called, not what was asked for.
const settleMaps = (ctx: OwnerContext, raw: unknown) => {
  const { requestId, placeCalls, routeCalls, outcome } = object({
    requestId: string({ min: 8, max: 64 }),
    placeCalls: number({ int: true, min: 0, max: MAPS_TARIFF.maxPlacesPerRequest }),
    routeCalls: number({ int: true, min: 0, max: 1 }),
    outcome: literal("succeeded", "failed", "aborted"),
  })(raw);
  const id = mapsSpendId(requestId);
  const lines = [
    { sku: "places_text_search", calls: placeCalls, cost: mapsCost(placeCalls, 0) },
    { sku: "directions", calls: routeCalls, cost: mapsCost(0, routeCalls) },
  ].filter((line) => line.calls > 0);
  for (const line of lines) {
    settleSpend(ctx, {
      receiptId: `${id}:${line.sku}`,
      chargeMicroCents: line.cost,
      reservationId: id,
      cost: {
        id: `${id}:${line.sku}`,
        category: "maps",
        provider: "google",
        sku: line.sku,
        quantity: { requests: line.calls },
        providerCostMicroCents: line.cost,
        basis: "estimated",
        outcome,
        requestId,
        tariffVersion: TARIFF_VERSION,
      },
    });
  }
  releaseSpend(ctx, id);
  cancelSpendExpiry(ctx, id);
  return { costMicroCents: mapsCost(placeCalls, routeCalls) };
};

const purgeVoice = async (ctx: OwnerContext, mode: OwnerPurgeMode): Promise<{ pending: boolean }> => {
  const calls = ctx.db.all<{ call_id: string }>(
    "SELECT call_id FROM voice_leases WHERE call_id IS NOT NULL AND (status = 'open' OR hangup_pending = 1)",
  );
  ctx.db.run("DELETE FROM voice_leases");
  for (const { id } of ctx.db.all<{ id: string }>("SELECT id FROM tts_streams")) ctx.jobs.cancel(ttsJobId(id));
  ctx.db.run("DELETE FROM tts_streams");
  if (mode === "delete") ctx.db.run("DELETE FROM tts_daily");
  ctx.db.run("DELETE FROM dictation_sessions");
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
  migrations: [VOICE_MIGRATION, DICTATION_SESSIONS_MIGRATION],
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
      const { chars, vendor } = object({
        chars: number({ int: true, min: 1, max: TTS_MAX_INPUT_CHARS }),
        vendor: optional(literal("fal", "openrouter", "openai")),
      })(raw);
      const id = crypto.randomUUID();
      admitTts(ctx, { id, chars, vendor: vendor ?? ttsProvider(ctx.env)?.provider ?? "fal" });
      return { ok: true, id };
    },
    "tts.settle": (ctx, raw) => {
      const input = object({
        id: string({ min: 1, max: 64 }),
        vendor: literal("fal", "openrouter", "openai"),
        chars: number({ int: true, min: 0, max: TTS_MAX_INPUT_CHARS }),
        pcmBytes: number({ int: true, min: 0, max: 1_000_000_000 }),
        outcome: literal("succeeded", "failed", "aborted"),
      })(raw);
      return { chargedMicroCents: settleTts(ctx, input) };
    },
    "tts.cancel": (ctx, raw) => {
      const { id } = object({ id: string({ min: 1, max: 64 }) })(raw);
      ctx.db.run("UPDATE tts_streams SET status = 'canceled' WHERE id = ? AND status = 'synthesizing'", id);
      return { ok: true };
    },
    "dictation.prepare": prepareDictation,
    "dictation.extend": extendDictation,
    "dictation.settle": settleDictation,
    "dictation.reserveClip": reserveDictationClip,
    "dictation.settleSegment": settleDictationSegment,
    "dictation.releaseClip": finishDictationClip,
    "maps.admit": admitMaps,
    "maps.settle": settleMaps,
  },
  jobs: {
    [VOICE_REAP_JOB]: { run: (ctx: OwnerContext) => reap(ctx) },
    [TTS_SYNTHESIZE_JOB]: { run: synthesize, maxAttempts: 1 },
    ...spendExpiryJobs,
  },
  purge: purgeVoice,
} satisfies OwnerDomain;
