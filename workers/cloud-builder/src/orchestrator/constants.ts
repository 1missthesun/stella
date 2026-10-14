import type { TurnEventEvent } from "@stella/contracts/turn-plane/owner-events";
import { APPEND_WINDOW_MAX_BYTES } from "../conversation-types.js";

export const CONNECT_CARD_WAIT_MS = 5 * 60_000;
export const CONNECT_CARD_POLL_MS = 2_000;
export const BROWSER_HANDOFF_POLL_MS = 2_000;
export const BROWSER_HANDOFF_GRACE_MS = 60_000;
export const WAKE_REPORT_INLINE_MAX_BYTES = 512 * 1024;

export const CHAT_WATCHDOG_MS = 5 * 60_000;
export const AGENT_RUNTIME_KEY = "agentRuntime";

export const PI_DEVICE_AGENT_PREFIX = "pi:device-agent:";

export const piThreadKey = (threadId: string): string =>
  `pi:thread:${threadId}`;

export const PI_JOURNAL_IMPORT_BATCH = 200;
export const PI_MIRRORED_KEY = "piMirroredEntry";
export const PI_LIVE_KEY = "piLive";
export const PI_BRAIN_KEY = "piBrain";
export const JOURNAL_CHECKPOINT_KEY = "journalCheckpoint";
export const CHECKPOINT_TURN_SCAN = 64;
export const BRAIN_HANDOFF_KEY = "brainHandoff";

export const AGENT_RECONCILE_INTERVAL_MS = 60_000;
export const AGENTS_VIEW_KEY = "runningAgentsView";

/**
 * Durable key: when this conversation first settled the running agents no
 * owner keeps a record of (`reconcileRunningAgents`).
 */
export const AGENTS_UNOWNED_SETTLED_KEY = "agentsUnownedSettledAt";
/**
 * An agent started this recently may not have reached its owner's records
 * yet (a computer's start is queued like its turn), so that first pass
 * leaves it alone.
 */
export const AGENT_OWNER_RECORD_LAG_MS = 10 * 60_000;
export const PI_HEARTBEAT_MS = 30_000;
/**
 * While a chat turn runs, its alarm fires at least this often. The alarm is
 * what wakes a replaced object (a deploy, an eviction) so the wake can resume
 * the turn; without the beat a lost turn sat until its watchdog.
 */
export const CHAT_TURN_HEARTBEAT_MS = 15_000;
export const CHAT_RESUME_MAX = 2;
export const CHAT_RESUME_MAX_AGE_MS = 15 * 60_000;
export const CHAT_RESUME_DEADLINE_MARGIN_MS = 30_000;
export const CHAT_TURN_RESUME_KEY = "turnResume";
export const CHAT_TURN_STARTED_AT_KEY = "turnStartedAt";
export const CHAT_TURN_MODEL_CAPABILITY_KEY = "turnModelCapability";

export const OWNER_PURGE_STALE_LEASE_GRACE_MS = 35_000;
export const LOCAL_TURN_LEASE_MS = 2 * 60_000;
export const LOCAL_TURN_CANCEL_GRACE_MS = 45_000;
// `userMessageJson` is nested inside the outer JSON request, so the Worker
// temporarily retains the request bytes, decoded outer text, parsed nested
// string, and parsed message. Keep this aligned with the outer ingress ceiling;
// larger messages need a streaming/direct-body protocol instead.
export const LOCAL_TURN_BEGIN_MAX_BYTES = 8 * 1024 * 1024;
export const LOCAL_TURN_FINISH_MAX_ROWS = 1_024;
export const LOCAL_TURN_FINISH_MAX_BYTES = APPEND_WINDOW_MAX_BYTES;
export const LOCAL_TURN_LEASE_KEY = "localTurnLease";
const LOCAL_TURN_RECEIPT_PREFIX = "localTurnReceipt:";
const LOCAL_CLIENT_MESSAGE_PREFIX = "localClientMessage:";
const CHAT_TURN_ADMISSION_PREFIX = "chatTurnAdmission:";
export const ORCHESTRATOR_FENCE_LEASE_RECEIPT_PREFIX =
  "orchestratorFenceLeaseReceipt:";
export const OWNER_FENCE_RUN_SLOT_PREFIX = "ownerFenceRunSlot:";
export const OWNER_FENCE_ID_HEADER = "x-stella-owner-fence-id";
export const localTurnReceiptKey = (turnId: string): string =>
  `${LOCAL_TURN_RECEIPT_PREFIX}${turnId}`;
export const localClientMessageKey = (clientMsgId: string): string =>
  `${LOCAL_CLIENT_MESSAGE_PREFIX}${clientMsgId}`;
export const chatTurnAdmissionKey = (clientMsgId: string): string =>
  `${CHAT_TURN_ADMISSION_PREFIX}${clientMsgId}`;
const TURN_EVENT_SEQ_PREFIX = "turnEventSeq:";
export const turnEventSeqKey = (turnId: string): string =>
  `${TURN_EVENT_SEQ_PREFIX}${turnId}`;
export const CONVERSATION_PROJECTED_KEY = "conversationProjected";
export const CONVERSATION_EXECUTION_KEY = "conversationExecution";
export const OWNER_EVENT_BATCH_PREFIX = "ownerEventBatch:";
export const OWNER_EVENT_DEBT_RETRY_MS = 30_000;

export const ownerPurgeImportedLeaseKey = (leaseId: string): string =>
  `ownerPurgeImportedLease:${leaseId}`;
export const orchestratorFenceLeaseReceiptKey = (leaseId: string): string =>
  `${ORCHESTRATOR_FENCE_LEASE_RECEIPT_PREFIX}${leaseId}`;

export const TERMINAL_STATUS: Record<
  string,
  NonNullable<TurnEventEvent["terminalStatus"]>
> = {
  completed: "completed",
  failed: "failed",
  canceled: "canceled",
  timeout: "failed",
};

export const LIVE_TOOL_LIMIT = 24;

export const TERMINAL_NOTICE = {
  timeout: "This took longer than expected, so Stella stopped. Try again.",
  canceled: "Stopped.",
  failed: "Stella hit a problem answering this. Try again.",
} as const;

export const CLOUD_CONTEXT_NOTICE =
  "Stella couldn't load the required cloud context safely. Try again.";
