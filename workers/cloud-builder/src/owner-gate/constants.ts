import {
  DISPATCH_ACCEPTED_LEASE_MS,
  type AgentMessageDeviceOutcome,
  type AgentStopDeviceOutcome,
} from "@stella/contracts/turn-plane/placement";

export const HEADER_PRESENCE_DEVICE_ID = "x-stella-device-id";

export const HEADER_DEVICE_REQUEST_MOBILE_ID =
  "x-stella-device-request-mobile-id";
export const HEADER_DEVICE_REQUEST_ID = "x-stella-device-request-id";
export const HEADER_DEVICE_REQUEST_METHOD = "x-stella-device-request-method";

export const OWNER_GATE_RUNNING_GRACE_MS = 60_000;
export const OWNER_AGENT_CONTAINER_LIMIT = 6;
export const DISPATCH_CLOUD_RETRY_DELAY_MS = 1_000;
export const DISPATCH_CLOUD_MAX_ATTEMPTS = 2;
export const DEFAULT_TURN_TIMEOUT_MS = 900_000;
export const OWNER_MODEL_GRANT_FREEZE_TIMEOUT_MS = 5_000;
export const CLOUD_CHAT_READER_PREPARE_TIMEOUT_MS = 1_000;

export const CLOUD_CHAT_READER_PREPARE_CACHE_MAX = 128;
export const SNAPSHOT_TTL_MS = 30_000;

export const STEER_ACK_TIMEOUT_MS = 10_000;
export const LOCAL_AGENT_MESSAGE_ACK_TIMEOUT_MS = 8_000;
export const AGENT_STOP_OUTCOMES: ReadonlySet<string> =
  new Set<AgentStopDeviceOutcome>([
    "stopped",
    "paused",
    "not_running",
    "not_found",
    "refused",
  ]);
export const AGENT_MESSAGE_OUTCOMES: ReadonlySet<string> =
  new Set<AgentMessageDeviceOutcome>([
    "steered",
    "queued",
    "resumed",
    "not_found",
    "refused",
  ]);

/**
 * The floor under every re-arm. A deadline that is already past due would
 * otherwise schedule a wake a quarter-second out, which turns any deadline the
 * object cannot clear into a hot alarm loop.
 */
export const ALARM_MIN_DELAY_MS = 1_000;
export const ALARM_HOT_REARM_MS = 2_000;
export const ALARM_HOT_STREAK_KEY = "alarmHotStreak";
/**
 * Alarm runs in a row that may each re-arm within `ALARM_HOT_REARM_MS` before
 * the re-arm backs off. Enough for legitimate catch-up (a batch of expired
 * leases or due jobs drained one pass at a time), never a standing loop.
 */
export const ALARM_HOT_STREAK_LIMIT = 10;
export const ALARM_MAX_BACKOFF_MS = 60_000;
export const DISPATCH_RENEW_WRITE_BELOW_MS = (DISPATCH_ACCEPTED_LEASE_MS * 3) / 4;
