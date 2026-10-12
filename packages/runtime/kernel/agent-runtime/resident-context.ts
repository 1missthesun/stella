/**
 * ResidentBlock registry — the single owner of the "resident early-context
 * blocks never mutate mid-thread" pattern.
 *
 * A resident block is a piece of context that must sit at a byte-stable
 * position in the provider request for the lifetime of a thread so that
 * provider prompt caches keep hitting: the pinned startup docs (personality,
 * main memory) and the skill catalog.
 * Every block registers here once and gets exactly two mutation paths. The
 * registry does no I/O: each host (the desktop runtime, the cloud
 * orchestrator) reads its own files and hands the raw text in, so both shape
 * and place every block the same way.
 *
 *   1. Mid-thread delta (`buildResidentContextMessages`): each turn the
 *      block re-renders from current state and is compared byte-for-byte
 *      against the copies already persisted in the thread. Unchanged →
 *      nothing is emitted and the prompt prefix stays byte-identical.
 *      Changed → the full updated block is APPENDED as a hidden message
 *      before the next user message; the canonical copy already in history
 *      is never touched.
 *
 *   2. Compaction fold-in (`buildResidentFold` + the overlay support in
 *      `storage/session-store.js`): compaction is the one moment the cache
 *      is legitimately dead, so the fold re-renders every block from
 *      current state, pins exactly one fresh copy of each at the head of
 *      the rebuilt window, and sweeps all older copies plus accumulated
 *      `runtime.context_delta.*` notices.
 *
 * The window-gated `before_user_message` reminder hooks (connector
 * availability and stale-user) are deliberately NOT folded into
 * this registry: they are advisory, recurring notices rather than resident
 * state, and their once-per-context-window dedup
 * (`runner/reminder-window-gate.ts`) already resets on compaction. They
 * compose cleanly alongside this mechanism and stay hooks.
 */
import { shapeResidentMemoryDoc } from "../memory/resident-doc-shape.js";
import {
  MAIN_MEMORY_DISPLAY_PATH,
  MAIN_MEMORY_INJECTED_MAX_CHARS,
  MAIN_MEMORY_RELATIVE_PATH,
} from "../memory/memory-layout.js";
import {
  renderExecutionDevices,
  renderExecutionDestination,
  renderMediaAccess,
} from "@stella/contracts/execution-context";
import { wrapSystemReminder } from "@stella/contracts/system-reminders";
import { AGENT_ROSTER_DOC_PATH } from "@stella/contracts/agent-directory";
import type { ExecutionContextSnapshot } from "@stella/contracts/execution-context";

type CustomMessage = {
  customType: string;
  content: string | Array<{ type: string; text?: string }>;
};
type HistoryEntry = { role: string; customMessage?: CustomMessage };
export type ResidentContext = {
  personality?: string;
  mainMemory?: string;
  skillsCatalog?: string;
  executionContext?: ExecutionContextSnapshot;
  /** The orchestrator's agent list (`renderAgentRoster`); boundary-only. */
  agentRoster?: string;
  threadHistory?: HistoryEntry[];
};
type ResidentBlock = {
  id: string;
  customType: string;
  docPath?: string;
  diskFile?: string;
  memoryDoc?: boolean;
  boundaryOnly?: boolean;
  resolve: (context: ResidentContext) => string | undefined;
  renderDiskBody?: (raw: string) => string | undefined;
  changeReminder?: (context: ResidentContext) => string;
};

export const BOOTSTRAP_STARTUP_DOC_CUSTOM_TYPE = "bootstrap.startup_doc";
export const BOOTSTRAP_SKILLS_CUSTOM_TYPE = "bootstrap.skills_catalog";
/**
 * Custom-type namespace for mid-thread resident-context change notices
 * (e.g. the frozen-tools delta note). Older threads keep the ones their
 * agent loop persisted, so store rebuilds reproduce what the model saw; the
 * compaction fold-in sweeps them wholesale once the canonical blocks have
 * been re-rendered.
 */
export const CONTEXT_DELTA_CUSTOM_TYPE_PREFIX = "runtime.context_delta.";

export const LIFE_PERSONALITY_DISPLAY_PATH = "~/.stella/PERSONALITY.md";
export const RETIRED_MEMORY_DISPLAY_PATHS = [
  "~/.stella/core-memory.md",
  "~/.stella/memories/profile.md",
  "~/.stella/memories/index.md",
  "~/.stella/memories/MEMORY.md",
  "~/.stella/memories/memory_map.md",
  "~/.stella/memories/memory_summary.md",
  "~/.stella/memories/memory_index.md",
  "~/.stella/memories/memory_shadow.md",
  "~/.stella/memories/raw_memories.md",
];

const buildStartupDocText = (displayPath: string, content: string) =>
  [`<startup_doc path="${displayPath}">`, content, "</startup_doc>"].join("\n");

/**
 * The registry. Order is the canonical head order for new threads and for
 * the compaction fold-in. Each block declares:
 *
 *   - `id`          stable identity used in logs and fold bookkeeping;
 *   - `customType`  the persisted custom-message type (all `bootstrap.*`
 *                   so compaction head-protection and prompt persistence
 *                   keep working unchanged);
 *   - `docPath`     display path when the block renders as a
 *                   `<startup_doc>` wrapper (absent for the skills block,
 *                   which carries its own `<skills>` envelope);
 *   - `resolve`     canonical body from the per-turn agent context
 *                   (deterministic — same state, same bytes);
 *   - `diskFile`    optional data-dir-relative file the compaction fold-in
 *                   re-reads for a fresh render (`renderDiskBody` applies
 *                   the same shaping as `resolve`);
 *   - `boundaryOnly` renders only where a context starts (a fresh head or a
 *                   compaction fold), never as a per-turn delta: for state
 *                   that changes too often to append every time it moves.
 */
export const RESIDENT_BLOCKS: ResidentBlock[] = [
  {
    id: "personality",
    customType: BOOTSTRAP_STARTUP_DOC_CUSTOM_TYPE,
    docPath: LIFE_PERSONALITY_DISPLAY_PATH,
    diskFile: "PERSONALITY.md",
    memoryDoc: false,
    resolve: (context) => context.personality?.trim() || undefined,
    renderDiskBody: (raw) => raw.trim() || undefined,
  },
  {
    id: "main-memory",
    customType: BOOTSTRAP_STARTUP_DOC_CUSTOM_TYPE,
    docPath: MAIN_MEMORY_DISPLAY_PATH,
    diskFile: MAIN_MEMORY_RELATIVE_PATH,
    memoryDoc: true,
    resolve: (context) =>
      context.mainMemory
        ? shapeResidentMemoryDoc(
            context.mainMemory,
            MAIN_MEMORY_INJECTED_MAX_CHARS,
          )
        : undefined,
    renderDiskBody: (raw) =>
      shapeResidentMemoryDoc(raw, MAIN_MEMORY_INJECTED_MAX_CHARS),
  },
  {
    id: "skills",
    customType: BOOTSTRAP_SKILLS_CUSTOM_TYPE,
    // The catalog carries its own `<skills>` envelope; no startup_doc wrap.
    resolve: (context) => context.skillsCatalog?.trim() || undefined,
  },
  {
    id: "execution-devices",
    customType: BOOTSTRAP_STARTUP_DOC_CUSTOM_TYPE,
    docPath: "stella://context/execution-devices",
    resolve: (context) =>
      context.executionContext
        ? renderExecutionDevices(context.executionContext)
        : undefined,
  },
  {
    id: "execution-destination",
    customType: BOOTSTRAP_STARTUP_DOC_CUSTOM_TYPE,
    docPath: "stella://context/execution-destination",
    resolve: (context) =>
      context.executionContext
        ? renderExecutionDestination(context.executionContext)
        : undefined,
    changeReminder: (context) =>
      wrapSystemReminder(
        `The execution destination changed. ${renderExecutionDestination(context.executionContext!)} Existing agents keep their own execution locations.`,
      ),
  },
  {
    // Whether the user can generate media right now. Rides the execution
    // context snapshot stamped on each user message, so a plan or key change
    // mid-thread lands as a delta and compaction folds in the latest copy.
    id: "media-access",
    customType: BOOTSTRAP_STARTUP_DOC_CUSTOM_TYPE,
    docPath: "stella://context/media-access",
    resolve: (context) =>
      context.executionContext
        ? renderMediaAccess(context.executionContext)
        : undefined,
    changeReminder: (context) =>
      wrapSystemReminder(
        `What the user can generate changed:\n${renderMediaAccess(context.executionContext!)}`,
      ),
  },
  {
    // Stella's agents: active ones first, then the most recent inactive.
    // Agents change constantly, so the list is a snapshot from where the
    // context started; agent_status gives a live one.
    id: "agents",
    customType: BOOTSTRAP_STARTUP_DOC_CUSTOM_TYPE,
    docPath: AGENT_ROSTER_DOC_PATH,
    boundaryOnly: true,
    resolve: (context) => context.agentRoster?.trim() || undefined,
  },
];

/** Full message text for a block, or undefined when the block is absent. */
export const renderResidentBlockText = (
  block: ResidentBlock,
  context: ResidentContext,
): string | undefined => {
  const body = block.resolve(context);
  if (!body) return undefined;
  return block.docPath ? buildStartupDocText(block.docPath, body) : body;
};

/** The memory documents kept resident, by the display path the model sees. */
export const RESIDENT_MEMORY_DISPLAY_PATHS: string[] = [
  MAIN_MEMORY_DISPLAY_PATH,
];

export const customMessageContentText = (
  content: CustomMessage["content"],
): string => {
  if (typeof content === "string") {
    return content;
  }
  return content
    .map((entry) => (entry.type === "text" ? entry.text : ""))
    .join("\n");
};

/** Startup messages for retired automatic-memory artifacts must never replay. */
export const isRetiredMemoryCustomMessage = (
  customMessage?: CustomMessage | null,
): boolean => {
  if (!customMessage) return false;
  const text = customMessageContentText(customMessage.content);
  return RETIRED_MEMORY_DISPLAY_PATHS.some((displayPath) =>
    text.includes(displayPath),
  );
};

/** Whether the thread already carries any resident block (its head was sent). */
export const hasResidentHead = (
  context: Pick<ResidentContext, "threadHistory">,
): boolean =>
  (context.threadHistory ?? []).some(
    (entry) =>
      entry.role === "runtimeInternal" &&
      residentIdentityForCustomMessage(entry.customMessage) !== null,
  );

const STARTUP_DOC_PATH_RE = /^<startup_doc path="([^"]+)">/;

/** Display path from a rendered `<startup_doc>` body, or null. */
export const parseStartupDocPath = (text: string): string | null => {
  const match = STARTUP_DOC_PATH_RE.exec(text.trim());
  return match?.[1] ?? null;
};

/**
 * Stable fold identity for a persisted resident-block custom message:
 * `skills` for the skill catalog, `doc:<display path>` for startup docs
 * (including legacy docs this registry no longer renders, e.g. the old
 * registry.md doc — they still fold as themselves). Null for anything that
 * is not a resident block.
 */
export const residentIdentityForCustomMessage = (
  customMessage?: CustomMessage | null,
): string | null => {
  if (!customMessage) return null;
  if (isRetiredMemoryCustomMessage(customMessage)) return null;
  if (customMessage.customType === BOOTSTRAP_SKILLS_CUSTOM_TYPE) {
    return "skills";
  }
  if (customMessage.customType === BOOTSTRAP_STARTUP_DOC_CUSTOM_TYPE) {
    const docPath = parseStartupDocPath(
      customMessageContentText(customMessage.content),
    );
    return docPath ? `doc:${docPath}` : null;
  }
  return null;
};

