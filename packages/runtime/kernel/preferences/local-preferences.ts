import fs from "fs";
import path from "path";
import {
  Cause,
  Context,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Ref,
} from "effect";
import {
  ensurePrivateDirSync,
  writePrivateFileSync,
} from "../shared/private-fs.js";
import {
  coerceRealtimeVoiceProvider,
  type RealtimeVoicePreferences,
  type RealtimeVoiceSelections,
  type RealtimeVoiceUnderlyingProvider,
} from "@stella/contracts/local-preferences";
import {
  coerceAgentRuntimeEngine,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_SERVICE_TIER,
  type AgentRuntimeEngine,
  type CodexServiceTier,
} from "@stella/contracts/agent-engine";
import {
  DEFAULT_REASONING_EFFORT,
  normalizeReasoningEffortLevel,
  type ReasoningEffortLevel,
} from "@stella/contracts/reasoning-effort";
import {
  DEFAULT_USER_ASK_ESCALATION_POLICY,
  normalizeUserAskEscalationPolicy,
  type UserAskEscalationPolicy,
} from "@stella/contracts/user-ask";
import {
  DEFAULT_MESSAGE_SOUND,
  normalizeMessageSound,
  type MessageSound,
  type MessageSoundPreferences,
} from "@stella/contracts/message-sound";

type AgentEngine = AgentRuntimeEngine;
export const DEFAULT_CLAUDE_CODE_MODEL = "default";
export type ReasoningEffort = ReasoningEffortLevel;
export type ImageGenerationProvider =
  | "stella"
  | "openai"
  | "openrouter"
  | "fal";

export type ImageGenerationPreferences = {
  provider: ImageGenerationProvider;
  model?: string;
};

export type {
  RealtimeVoiceUnderlyingProvider,
  RealtimeVoicePreferences,
} from "@stella/contracts/local-preferences";

export type LocalPreferences = {
  defaultModels: Record<string, string>;
  modelOverrides: Record<string, string>;
  assistantPropagatedAgents: string[];
  reasoningEfforts: Record<string, ReasoningEffort>;
  stellaConversationModelOverrides: Record<string, string>;
  stellaConversationReasoningEfforts: Record<string, ReasoningEffort>;
  agentRuntimeEngine: AgentEngine;
  useNativeClaudeCodeRuntime: boolean;
  codexModel: string;
  codexModelExplicit: boolean;
  codexReasoningEffort: ReasoningEffort;
  codexServiceTier: CodexServiceTier;
  claudeCodeModel: string;
  claudeCodeReasoningEffort: ReasoningEffort;
  maxAgentConcurrency: number;
  imageGeneration: ImageGenerationPreferences;
  realtimeVoice: RealtimeVoicePreferences;
  memoryEnabled: boolean;
  /** The user's last explicit Memory choice, here or on their account; null until they make one. */
  memoryChoice: boolean | null;
  dictationShortcut: string;
  voiceRtcShortcut: string;
  preventComputerSleep: boolean;
  lockedComputerUseEnabled: boolean;
  messageSoundEnabled: boolean;
  messageSound: MessageSound;
  dictationSoundEffectsEnabled: boolean;
  telemetryEnabled: boolean;
  telemetryAccountOffPending: boolean;
  readAloudEnabled: boolean;
  companionEnabled: boolean;
  companionAnchor: { x: number; y: number } | null;
  chronicleEnabled: boolean;
  chroniclePendingEnable: boolean;
  wakeWordEnabled: boolean;
  onboardingCompleted: boolean;
  wakeWordThreshold: number;
  promptPresetSelections: Record<string, string>;
  userAskEscalationPolicy: UserAskEscalationPolicy;
};

export type LocalModelPreferencesSnapshot = Pick<
  LocalPreferences,
  | "defaultModels"
  | "modelOverrides"
  | "assistantPropagatedAgents"
  | "reasoningEfforts"
  | "stellaConversationModelOverrides"
  | "stellaConversationReasoningEfforts"
  | "agentRuntimeEngine"
  | "useNativeClaudeCodeRuntime"
  | "codexModel"
  | "codexModelExplicit"
  | "codexReasoningEffort"
  | "codexServiceTier"
  | "claudeCodeModel"
  | "claudeCodeReasoningEffort"
  | "maxAgentConcurrency"
  | "imageGeneration"
  | "realtimeVoice"
  | "memoryEnabled"
  | "memoryChoice"
>;

const DEFAULT_MAX_AGENT_CONCURRENCY = 24;
const MAX_AGENT_CONCURRENCY_CEILING = 48;

const DEFAULT_PREFERENCES: LocalPreferences = {
  defaultModels: {},
  modelOverrides: {},
  assistantPropagatedAgents: [],
  reasoningEfforts: {},
  stellaConversationModelOverrides: {},
  stellaConversationReasoningEfforts: {},
  agentRuntimeEngine: "default",
  useNativeClaudeCodeRuntime: false,
  codexModel: DEFAULT_CODEX_MODEL,
  codexModelExplicit: false,
  codexReasoningEffort: DEFAULT_REASONING_EFFORT,
  codexServiceTier: DEFAULT_CODEX_SERVICE_TIER,
  claudeCodeModel: DEFAULT_CLAUDE_CODE_MODEL,
  claudeCodeReasoningEffort: DEFAULT_REASONING_EFFORT,
  maxAgentConcurrency: DEFAULT_MAX_AGENT_CONCURRENCY,
  imageGeneration: { provider: "stella" },
  realtimeVoice: { provider: "stella" },
  memoryEnabled: true,
  memoryChoice: null,
  dictationShortcut: "Alt",
  voiceRtcShortcut: "CommandOrControl+Shift+D",
  preventComputerSleep: false,
  lockedComputerUseEnabled: false,
  messageSoundEnabled: true,
  messageSound: DEFAULT_MESSAGE_SOUND,
  dictationSoundEffectsEnabled: true,
  telemetryEnabled: true,
  telemetryAccountOffPending: false,
  wakeWordEnabled: false,
  onboardingCompleted: false,
  wakeWordThreshold: 0.6,
  readAloudEnabled: false,
  companionEnabled: false,
  companionAnchor: null,
  chronicleEnabled: false,
  chroniclePendingEnable: false,
  promptPresetSelections: {},
  userAskEscalationPolicy: DEFAULT_USER_ASK_ESCALATION_POLICY,
};

const normalizePromptPresetSelections = (
  value: unknown,
): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [agentId, presetId] of Object.entries(value)) {
    if (typeof presetId !== "string") continue;
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(presetId) || presetId === "default")
      continue;
    if (!/^[a-z0-9_-]{1,64}$/.test(agentId)) continue;
    out[agentId] = presetId;
  }
  return out;
};

const LEGACY_STELLA_DEFAULT_MODEL = "stella/default";
const RETIRED_MODEL_PROVIDERS = new Set([
  "google-antigravity",
  "google-gemini-cli",
  "groq",
  "mistral",
  "fal",
]);
const RETIRED_OPENAI_CODEX_MODELS = new Set([
  "gpt-5.1",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.3-codex",
]);

const prefsPath = (stellaDataDir: string) =>
  path.join(stellaDataDir, "preferences.json");

const normalizeStoredPreferences = (
  parsed: Partial<LocalPreferences>,
): LocalPreferences => ({
  ...DEFAULT_PREFERENCES,
  defaultModels: normalizeModelPreferenceMap(parsed.defaultModels),
  modelOverrides: normalizeModelPreferenceMap(parsed.modelOverrides),
  assistantPropagatedAgents: normalizeAssistantPropagatedAgents(
    parsed.assistantPropagatedAgents,
  ),
  reasoningEfforts: normalizeReasoningEfforts(parsed.reasoningEfforts),
  stellaConversationModelOverrides: normalizeModelPreferenceMap(
    parsed.stellaConversationModelOverrides,
  ),
  stellaConversationReasoningEfforts: normalizeReasoningEfforts(
    parsed.stellaConversationReasoningEfforts,
  ),
  agentRuntimeEngine: normalizeEngine(parsed.agentRuntimeEngine),
  useNativeClaudeCodeRuntime:
    typeof parsed.useNativeClaudeCodeRuntime === "boolean"
      ? parsed.useNativeClaudeCodeRuntime
      : (parsed as { useNativeAgentRuntimes?: unknown })
          .useNativeAgentRuntimes === true,
  codexModel: normalizeCodexModel(parsed.codexModel),
  codexModelExplicit: parsed.codexModelExplicit === true,
  codexReasoningEffort: normalizeReasoningEffort(parsed.codexReasoningEffort),
  codexServiceTier: normalizeCodexServiceTier(parsed.codexServiceTier),
  claudeCodeModel: normalizeClaudeCodeModel(parsed.claudeCodeModel),
  claudeCodeReasoningEffort: normalizeReasoningEffort(
    parsed.claudeCodeReasoningEffort,
  ),
  maxAgentConcurrency: normalizeConcurrency(parsed.maxAgentConcurrency),
  imageGeneration: normalizeImageGenerationPreferences(parsed.imageGeneration),
  realtimeVoice: normalizeRealtimeVoicePreferences(parsed.realtimeVoice),
  memoryEnabled: parsed.memoryEnabled !== false,
  memoryChoice:
    typeof parsed.memoryChoice === "boolean" ? parsed.memoryChoice : null,
  dictationShortcut:
    typeof parsed.dictationShortcut === "string"
      ? parsed.dictationShortcut
      : DEFAULT_PREFERENCES.dictationShortcut,
  voiceRtcShortcut:
    typeof parsed.voiceRtcShortcut === "string"
      ? parsed.voiceRtcShortcut
      : DEFAULT_PREFERENCES.voiceRtcShortcut,
  preventComputerSleep: parsed.preventComputerSleep === true,
  lockedComputerUseEnabled: parsed.lockedComputerUseEnabled === true,
  messageSoundEnabled:
    (parsed.messageSoundEnabled ??
      (parsed as { soundNotificationsEnabled?: unknown }).soundNotificationsEnabled) !== false,
  messageSound: normalizeMessageSound(parsed.messageSound),
  dictationSoundEffectsEnabled: parsed.dictationSoundEffectsEnabled !== false,
  telemetryEnabled: parsed.telemetryEnabled !== false,
  telemetryAccountOffPending: parsed.telemetryAccountOffPending === true,
  wakeWordEnabled:
    typeof parsed.wakeWordEnabled === "boolean"
      ? parsed.wakeWordEnabled
      : DEFAULT_PREFERENCES.wakeWordEnabled,
  onboardingCompleted: parsed.onboardingCompleted === true,
  wakeWordThreshold:
    typeof parsed.wakeWordThreshold === "number" &&
    Number.isFinite(parsed.wakeWordThreshold) &&
    parsed.wakeWordThreshold > 0 &&
    parsed.wakeWordThreshold <= 1
      ? parsed.wakeWordThreshold
      : DEFAULT_PREFERENCES.wakeWordThreshold,
  readAloudEnabled: parsed.readAloudEnabled === true,
  companionEnabled: parsed.companionEnabled === true,
  companionAnchor: normalizeCompanionAnchor(parsed.companionAnchor),
  chronicleEnabled: parsed.chronicleEnabled === true,
  chroniclePendingEnable:
    parsed.chronicleEnabled !== true && parsed.chroniclePendingEnable === true,
  promptPresetSelections: normalizePromptPresetSelections(
    parsed.promptPresetSelections,
  ),
  userAskEscalationPolicy: normalizeUserAskEscalationPolicy(
    parsed.userAskEscalationPolicy,
  ),
});

/**
 * Identity of the preferences file as last read or written. Electron main and
 * the worker both write this file (each process has its own cache), so every
 * load re-stats (~1 µs) and re-reads only when the identity changed.
 * `mtimeMs` alone is not enough: Linux stamps mtime from a coarse clock, so
 * two writes a few ms apart can share it; size and inode (a replace-by-rename
 * gets a new one) narrow that further. A same-size in-place rewrite inside
 * one mtime tick would still match, so, like git's "racily clean" index
 * entries, an entry is trusted only when it was observed more than
 * `RACY_WINDOW_MS` (wider than any filesystem's mtime granularity) after the
 * file's mtime. Until then every load re-reads: a few re-reads right after a
 * save buy an exact cache.
 */
type FileKey = {
  readonly filePath: string;
  readonly mtimeMs: number;
  readonly size: number;
  readonly ino: number;
};

type CacheEntry = {
  readonly prefs: LocalPreferences;
  readonly key: FileKey | null;
  readonly observedAtMs: number;
};

const RACY_WINDOW_MS = 2_000;

const isTrustedHit = (
  entry: CacheEntry | null,
  key: FileKey,
): entry is CacheEntry =>
  entry !== null &&
  sameFileKey(entry.key, key) &&
  entry.observedAtMs - key.mtimeMs > RACY_WINDOW_MS;

const fileKeyOf = (filePath: string, stat: fs.Stats): FileKey => ({
  filePath,
  mtimeMs: stat.mtimeMs,
  size: stat.size,
  ino: stat.ino,
});

const sameFileKey = (a: FileKey | null, b: FileKey): boolean =>
  a !== null &&
  a.filePath === b.filePath &&
  a.mtimeMs === b.mtimeMs &&
  a.size === b.size &&
  a.ino === b.ino;

export type PreferencesPatch = Partial<LocalPreferences>;
export type PreferencesUpdate =
  | PreferencesPatch
  | ((current: LocalPreferences) => PreferencesPatch | null);

class UnreadablePreferencesError extends Error {}

const LOCK_WAIT_MS = 2_000;
const LOCK_POLL_MS = 5;
const UNREADABLE_RETRIES = 3;
const sleepSync = (ms: number) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const withFileLock = <A>(filePath: string, run: () => A): A => {
  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  let fd: number | null = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        fs.rmSync(lockPath, { force: true });
        continue;
      }
      sleepSync(LOCK_POLL_MS);
    }
  }
  try {
    return run();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lockPath, { force: true });
  }
};

const readEntry = (filePath: string): CacheEntry | null => {
  const observedAtMs = Date.now();
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new UnreadablePreferencesError(String(error));
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return {
      prefs: normalizeStoredPreferences(parsed as Partial<LocalPreferences>),
      key: fileKeyOf(filePath, stat),
      observedAtMs,
    };
  } catch (error) {
    throw new UnreadablePreferencesError(String(error));
  }
};

const writeAtomicSync = (filePath: string, prefs: LocalPreferences) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) ensurePrivateDirSync(dir);
  const tmpPath = `${filePath}.${process.pid}.${Math.random()
    .toString(36)
    .slice(2)}.tmp`;
  writePrivateFileSync(tmpPath, JSON.stringify(prefs, null, 2));
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    fs.rmSync(tmpPath, { force: true });
    throw error;
  }
};

/**
 * Electron main, the runtime worker and the `stella-computer` CLI all write
 * this file. Every write takes the sibling `.lock`, re-reads the file, applies
 * only the patched keys and replaces the file by rename, so a reader never
 * sees a torn file and one process can't drop another's change. An unreadable
 * file is never overwritten with defaults: reads fall back to the last good
 * copy, and a write moves the file aside first.
 */
export interface Interface {
  readonly load: (stellaDataDir: string) => Effect.Effect<LocalPreferences>;
  readonly update: (
    stellaDataDir: string,
    update: PreferencesUpdate,
  ) => Effect.Effect<LocalPreferences, unknown>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@stella/runtime/kernel/LocalPreferences",
) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cache = yield* Ref.make<CacheEntry | null>(null);
    const lastGood = yield* Ref.make<LocalPreferences | null>(null);

    const load = Effect.fn("LocalPreferences.load")(function* (
      stellaDataDir: string,
    ) {
      const filePath = prefsPath(stellaDataDir);
      const cached = yield* Ref.get(cache);
      const loaded = yield* Effect.try({
        try: (): CacheEntry | null => {
          const stat = fs.statSync(filePath);
          if (isTrustedHit(cached, fileKeyOf(filePath, stat))) return cached;
          return readEntry(filePath);
        },
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              return null;
            }
            return "unreadable" as const;
          }),
        ),
      );
      if (loaded === "unreadable") {
        const good = yield* Ref.get(lastGood);
        return good ? { ...good } : { ...DEFAULT_PREFERENCES };
      }
      if (loaded === null) {
        return { ...DEFAULT_PREFERENCES };
      }
      if (loaded !== cached) {
        yield* Ref.set(cache, loaded);
        yield* Ref.set(lastGood, loaded.prefs);
      }
      return loaded.prefs;
    });

    const update = Effect.fn("LocalPreferences.update")(function* (
      stellaDataDir: string,
      change: PreferencesUpdate,
    ) {
      const filePath = prefsPath(stellaDataDir);
      const good = yield* Ref.get(lastGood);
      const written = yield* Effect.try({
        try: () =>
          withFileLock(filePath, (): CacheEntry | null => {
            let current: LocalPreferences | null = null;
            for (let attempt = 0; current === null; attempt += 1) {
              try {
                current = readEntry(filePath)?.prefs ?? {
                  ...DEFAULT_PREFERENCES,
                };
              } catch (error) {
                if (!(error instanceof UnreadablePreferencesError)) throw error;
                if (attempt + 1 < UNREADABLE_RETRIES) {
                  sleepSync(20);
                  continue;
                }
                const asidePath = `${filePath}.unreadable-${Date.now()}`;
                fs.renameSync(filePath, asidePath);
                console.warn(
                  `[preferences] ${filePath} was unreadable (${error.message}); moved it to ${asidePath}.`,
                );
                current = good ? { ...good } : { ...DEFAULT_PREFERENCES };
              }
            }
            const patch =
              typeof change === "function" ? change(current) : change;
            if (patch === null) return null;
            const prefs = normalizeStoredPreferences({ ...current, ...patch });
            writeAtomicSync(filePath, prefs);
            return {
              prefs,
              key: fileKeyOf(filePath, fs.statSync(filePath)),
              observedAtMs: Date.now(),
            };
          }),
        catch: (error) => error,
      });
      if (written === null) return yield* load(stellaDataDir);
      yield* Ref.set(cache, written);
      yield* Ref.set(lastGood, written.prefs);
      return written.prefs;
    });

    return { load, update };
  }),
);

const preferencesRuntime = ManagedRuntime.make(layer);

const runPreferences = <A, E>(effect: Effect.Effect<A, E, Service>): A => {
  const exit = preferencesRuntime.runSyncExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw Cause.squash(exit.cause);
};

export const loadLocalPreferences = (
  stellaDataDir: string,
): LocalPreferences =>
  runPreferences(
    Effect.gen(function* () {
      const service = yield* Service;
      return yield* service.load(stellaDataDir);
    }),
  );

export const updateLocalPreferences = (
  stellaDataDir: string,
  update: PreferencesUpdate,
): LocalPreferences =>
  runPreferences(
    Effect.gen(function* () {
      const service = yield* Service;
      return yield* service.update(stellaDataDir, update);
    }),
  );

export const getModelOverride = (
  stellaDataDir: string,
  agentType: string,
): string | undefined => {
  const prefs = loadLocalPreferences(stellaDataDir);
  return prefs.modelOverrides[agentType];
};

export const getReasoningEffort = (
  stellaDataDir: string,
  agentType: string,
): ReasoningEffort => {
  const prefs = loadLocalPreferences(stellaDataDir);
  return normalizeReasoningEffort(prefs.reasoningEfforts[agentType]);
};

export const getAgentRuntimeEngine = (stellaDataDir: string): AgentEngine => {
  return loadLocalPreferences(stellaDataDir).agentRuntimeEngine;
};

export const getSubscriptionHarnessEnabled = (
  stellaDataDir: string,
  engine: AgentEngine,
): boolean => {
  const prefs = loadLocalPreferences(stellaDataDir);
  if (engine === "claude_code_local") {
    return !prefs.useNativeClaudeCodeRuntime;
  }
  return false;
};

export const getImageGenerationPreferences = (
  stellaDataDir: string,
): ImageGenerationPreferences => {
  return normalizeImageGenerationPreferences(
    loadLocalPreferences(stellaDataDir).imageGeneration,
  );
};

export const getRealtimeVoicePreferences = (
  stellaDataDir: string,
): RealtimeVoicePreferences => {
  return normalizeRealtimeVoicePreferences(
    loadLocalPreferences(stellaDataDir).realtimeVoice,
  );
};

export const getLocalModelPreferences = (
  stellaDataDir: string,
): LocalModelPreferencesSnapshot => {
  const prefs = loadLocalPreferences(stellaDataDir);
  return {
    defaultModels: { ...prefs.defaultModels },
    modelOverrides: { ...prefs.modelOverrides },
    assistantPropagatedAgents: [...prefs.assistantPropagatedAgents],
    reasoningEfforts: { ...prefs.reasoningEfforts },
    stellaConversationModelOverrides: {
      ...prefs.stellaConversationModelOverrides,
    },
    stellaConversationReasoningEfforts: {
      ...prefs.stellaConversationReasoningEfforts,
    },
    agentRuntimeEngine: prefs.agentRuntimeEngine,
    useNativeClaudeCodeRuntime: prefs.useNativeClaudeCodeRuntime,
    codexModel: prefs.codexModel,
    codexModelExplicit: prefs.codexModelExplicit,
    codexReasoningEffort: prefs.codexReasoningEffort,
    codexServiceTier: prefs.codexServiceTier,
    claudeCodeModel: prefs.claudeCodeModel,
    claudeCodeReasoningEffort: prefs.claudeCodeReasoningEffort,
    maxAgentConcurrency: prefs.maxAgentConcurrency,
    imageGeneration: { ...prefs.imageGeneration },
    realtimeVoice: { ...prefs.realtimeVoice },
    memoryEnabled: prefs.memoryEnabled,
    memoryChoice: prefs.memoryChoice,
  };
};

export const updateLocalModelPreferences = (
  stellaDataDir: string,
  patch: Partial<LocalModelPreferencesSnapshot>,
): LocalModelPreferencesSnapshot => {
  updateLocalPreferences(stellaDataDir, (prefs) => ({
    defaultModels:
      patch.defaultModels === undefined
        ? prefs.defaultModels
        : normalizeModelPreferenceMap(patch.defaultModels),
    modelOverrides:
      patch.modelOverrides === undefined
        ? prefs.modelOverrides
        : normalizeModelPreferenceMap(patch.modelOverrides),
    assistantPropagatedAgents:
      patch.assistantPropagatedAgents === undefined
        ? prefs.assistantPropagatedAgents
        : normalizeAssistantPropagatedAgents(patch.assistantPropagatedAgents),
    reasoningEfforts:
      patch.reasoningEfforts === undefined
        ? prefs.reasoningEfforts
        : normalizeReasoningEfforts(patch.reasoningEfforts),
    stellaConversationModelOverrides:
      patch.stellaConversationModelOverrides === undefined
        ? prefs.stellaConversationModelOverrides
        : normalizeModelPreferenceMap(patch.stellaConversationModelOverrides),
    stellaConversationReasoningEfforts:
      patch.stellaConversationReasoningEfforts === undefined
        ? prefs.stellaConversationReasoningEfforts
        : normalizeReasoningEfforts(patch.stellaConversationReasoningEfforts),
    agentRuntimeEngine:
      patch.agentRuntimeEngine === undefined
        ? prefs.agentRuntimeEngine
        : normalizeEngine(patch.agentRuntimeEngine),
    useNativeClaudeCodeRuntime:
      patch.useNativeClaudeCodeRuntime === undefined
        ? prefs.useNativeClaudeCodeRuntime
        : patch.useNativeClaudeCodeRuntime === true,
    codexModel:
      patch.codexModel === undefined
        ? prefs.codexModel
        : normalizeCodexModel(patch.codexModel),
    codexModelExplicit:
      patch.codexModelExplicit === undefined
        ? prefs.codexModelExplicit
        : patch.codexModelExplicit === true,
    codexReasoningEffort:
      patch.codexReasoningEffort === undefined
        ? prefs.codexReasoningEffort
        : normalizeReasoningEffort(patch.codexReasoningEffort),
    codexServiceTier:
      patch.codexServiceTier === undefined
        ? prefs.codexServiceTier
        : normalizeCodexServiceTier(patch.codexServiceTier),
    claudeCodeModel:
      patch.claudeCodeModel === undefined
        ? prefs.claudeCodeModel
        : normalizeClaudeCodeModel(patch.claudeCodeModel),
    claudeCodeReasoningEffort:
      patch.claudeCodeReasoningEffort === undefined
        ? prefs.claudeCodeReasoningEffort
        : normalizeReasoningEffort(patch.claudeCodeReasoningEffort),
    maxAgentConcurrency:
      patch.maxAgentConcurrency === undefined
        ? prefs.maxAgentConcurrency
        : normalizeConcurrency(patch.maxAgentConcurrency),
    imageGeneration:
      patch.imageGeneration === undefined
        ? prefs.imageGeneration
        : normalizeImageGenerationPreferences(patch.imageGeneration),
    realtimeVoice:
      patch.realtimeVoice === undefined
        ? prefs.realtimeVoice
        : normalizeRealtimeVoicePreferences(patch.realtimeVoice),
    memoryEnabled:
      patch.memoryEnabled === undefined
        ? prefs.memoryEnabled
        : patch.memoryEnabled !== false,
    memoryChoice:
      patch.memoryChoice === undefined
        ? prefs.memoryChoice
        : typeof patch.memoryChoice === "boolean"
          ? patch.memoryChoice
          : null,
  }));
  return getLocalModelPreferences(stellaDataDir);
};

export const getPreventComputerSleep = (stellaDataDir: string): boolean => {
  return loadLocalPreferences(stellaDataDir).preventComputerSleep;
};

export const getMessageSoundPreferences = (
  stellaDataDir: string,
): MessageSoundPreferences => {
  const prefs = loadLocalPreferences(stellaDataDir);
  return { enabled: prefs.messageSoundEnabled, sound: prefs.messageSound };
};

export const getTelemetryEnabled = (stellaDataDir: string): boolean => {
  try {
    return loadLocalPreferences(stellaDataDir).telemetryEnabled;
  } catch {
    return true;
  }
};

export type TelemetryState = {
  enabled: boolean;
  accountOffPending: boolean;
};

export const getTelemetryState = (stellaDataDir: string): TelemetryState => {
  try {
    const prefs = loadLocalPreferences(stellaDataDir);
    return {
      enabled: prefs.telemetryEnabled,
      accountOffPending: prefs.telemetryAccountOffPending,
    };
  } catch {
    return { enabled: true, accountOffPending: false };
  }
};

export const setTelemetryEnabled = (
  stellaDataDir: string,
  enabled: boolean,
  options: { accountOffPending?: boolean; mirrorAccount?: boolean } = {},
): TelemetryState => {
  const accountOffPending = !enabled && options.accountOffPending === true;
  const prefs = updateLocalPreferences(stellaDataDir, (current) =>
    options.mirrorAccount && enabled && current.telemetryAccountOffPending
      ? null
      : {
          telemetryEnabled: enabled,
          telemetryAccountOffPending: accountOffPending,
        },
  );
  return {
    enabled: prefs.telemetryEnabled,
    accountOffPending: prefs.telemetryAccountOffPending,
  };
};

export const getDictationSoundEffectsEnabled = (
  stellaDataDir: string,
): boolean => {
  return loadLocalPreferences(stellaDataDir).dictationSoundEffectsEnabled;
};

const normalizeCompanionAnchor = (
  value: unknown,
): { x: number; y: number } | null => {
  if (!value || typeof value !== "object") return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null;
  }
  return { x: Math.round(x), y: Math.round(y) };
};

export const getCompanionEnabled = (stellaDataDir: string): boolean =>
  loadLocalPreferences(stellaDataDir).companionEnabled;

export const setCompanionEnabled = (
  stellaDataDir: string,
  enabled: boolean,
): void => {
  if (loadLocalPreferences(stellaDataDir).companionEnabled === enabled) return;
  updateLocalPreferences(stellaDataDir, { companionEnabled: enabled });
};

export const getCompanionAnchor = (
  stellaDataDir: string,
): { x: number; y: number } | null =>
  loadLocalPreferences(stellaDataDir).companionAnchor;

export const setCompanionAnchor = (
  stellaDataDir: string,
  anchor: { x: number; y: number } | null,
): void => {
  updateLocalPreferences(stellaDataDir, {
    companionAnchor: normalizeCompanionAnchor(anchor),
  });
};

export const getUserAskEscalationPolicy = (
  stellaDataDir: string,
): UserAskEscalationPolicy =>
  normalizeUserAskEscalationPolicy(
    loadLocalPreferences(stellaDataDir).userAskEscalationPolicy,
  );

export const setUserAskEscalationPolicy = (
  stellaDataDir: string,
  input: unknown,
): UserAskEscalationPolicy => {
  const userAskEscalationPolicy = normalizeUserAskEscalationPolicy(input);
  updateLocalPreferences(stellaDataDir, { userAskEscalationPolicy });
  return userAskEscalationPolicy;
};

export const getReadAloudEnabled = (stellaDataDir: string): boolean => {
  return loadLocalPreferences(stellaDataDir).readAloudEnabled;
};

export const setReadAloudEnabled = (
  stellaDataDir: string,
  enabled: boolean,
): void => {
  updateLocalPreferences(stellaDataDir, { readAloudEnabled: enabled });
};

export const getPromptPresetSelections = (
  stellaDataDir: string,
): Record<string, string> =>
  normalizePromptPresetSelections(
    loadLocalPreferences(stellaDataDir).promptPresetSelections,
  );

export const getPromptPresetSelection = (
  stellaDataDir: string,
  agentId: string,
): string => getPromptPresetSelections(stellaDataDir)[agentId] ?? "default";

export const setPromptPresetSelection = (
  stellaDataDir: string,
  agentId: string,
  presetId: string,
): void => {
  updateLocalPreferences(stellaDataDir, (prefs) => {
    const selections = {
      ...normalizePromptPresetSelections(prefs.promptPresetSelections),
    };
    if (!presetId || presetId === "default") delete selections[agentId];
    else selections[agentId] = presetId;
    return { promptPresetSelections: selections };
  });
};

export const getOnboardingCompleted = (stellaDataDir: string): boolean =>
  loadLocalPreferences(stellaDataDir).onboardingCompleted;

export const setOnboardingCompleted = (
  stellaDataDir: string,
  completed: boolean,
): void => {
  updateLocalPreferences(stellaDataDir, { onboardingCompleted: completed });
};

const normalizeEngine = (value: unknown): AgentEngine => {
  return coerceAgentRuntimeEngine(value);
};

const normalizeCodexModel = (value: unknown): string => {
  if (typeof value !== "string") return DEFAULT_CODEX_MODEL;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_CODEX_MODEL;
};

const normalizeClaudeCodeModel = (value: unknown): string => {
  if (typeof value !== "string") return DEFAULT_CLAUDE_CODE_MODEL;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_CLAUDE_CODE_MODEL;
};

const normalizeReasoningEffort = (value: unknown): ReasoningEffort =>
  normalizeReasoningEffortLevel(value);

export const normalizeCodexServiceTier = (value: unknown): CodexServiceTier =>
  value === "fast" ? "fast" : DEFAULT_CODEX_SERVICE_TIER;

const normalizeAssistantPropagatedAgents = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};

const normalizeModelPreferenceMap = (
  value: unknown,
): Record<string, string> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const normalized: Record<string, string> = {};
  for (const [agentType, model] of Object.entries(value)) {
    const trimmedAgentType = agentType.trim();
    const trimmedModel = typeof model === "string" ? model.trim() : "";
    if (!trimmedAgentType || !trimmedModel) continue;
    if (trimmedModel === LEGACY_STELLA_DEFAULT_MODEL) continue;
    if (RETIRED_MODEL_PROVIDERS.has(trimmedModel.split("/", 1)[0] ?? "")) {
      continue;
    }
    const [provider, ...modelParts] = trimmedModel.split("/");
    const modelId = modelParts.join("/");
    normalized[trimmedAgentType] =
      provider === "chatgpt" && RETIRED_OPENAI_CODEX_MODELS.has(modelId)
        ? `chatgpt/${DEFAULT_CODEX_MODEL}`
        : trimmedModel;
  }
  return normalized;
};

const normalizeReasoningEfforts = (
  value: unknown,
): Record<string, ReasoningEffort> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const normalized: Record<string, ReasoningEffort> = {};
  for (const [agentType, effort] of Object.entries(value)) {
    const trimmedAgentType = agentType.trim();
    if (!trimmedAgentType) continue;
    normalized[trimmedAgentType] = normalizeReasoningEffort(effort);
  }
  return normalized;
};

const normalizeConcurrency = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MAX_AGENT_CONCURRENCY;
  }
  const rounded = Math.floor(parsed);
  return Math.min(MAX_AGENT_CONCURRENCY_CEILING, rounded);
};

export const normalizeImageGenerationPreferences = (
  value: unknown,
): ImageGenerationPreferences => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { provider: "stella" };
  }
  const record = value as { provider?: unknown; model?: unknown };
  const provider =
    record.provider === "openai" ||
    record.provider === "openrouter" ||
    record.provider === "fal"
      ? record.provider
      : "stella";
  const model =
    typeof record.model === "string" && record.model.trim().length > 0
      ? record.model.trim()
      : undefined;
  return provider === "stella"
    ? { provider }
    : { provider, ...(model ? { model } : {}) };
};

const normalizeRealtimeVoiceSelections = (
  value: unknown,
): RealtimeVoiceSelections | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as {
    gptlive?: unknown;
    openai?: unknown;
    xai?: unknown;
    gemini?: unknown;
  };
  const out: RealtimeVoiceSelections = {};
  if (typeof record.gptlive === "string" && record.gptlive.trim().length > 0) {
    out.gptlive = record.gptlive.trim();
  }
  if (typeof record.openai === "string" && record.openai.trim().length > 0) {
    out.openai = record.openai.trim();
  }
  if (typeof record.xai === "string" && record.xai.trim().length > 0) {
    out.xai = record.xai.trim();
  }
  if (typeof record.gemini === "string" && record.gemini.trim().length > 0) {
    out.gemini = record.gemini.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

export const normalizeRealtimeVoicePreferences = (
  value: unknown,
): RealtimeVoicePreferences => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { provider: "stella" };
  }
  const record = value as {
    provider?: unknown;
    model?: unknown;
    voices?: unknown;
    enabled?: unknown;
    readAloudProvider?: unknown;
  };

  const provider = coerceRealtimeVoiceProvider(
    typeof record.provider === "string" ? record.provider : "",
  );
  const model =
    typeof record.model === "string" && record.model.trim().length > 0
      ? record.model.trim()
      : undefined;
  const voices = normalizeRealtimeVoiceSelections(record.voices);
  const enabled =
    typeof record.enabled === "boolean" ? record.enabled : undefined;
  const readAloudProvider =
    record.readAloudProvider === "openai" ||
    record.readAloudProvider === "gemini"
      ? record.readAloudProvider
      : undefined;

  const result: RealtimeVoicePreferences = { provider };
  if (provider !== "stella" && model) result.model = model;
  if (voices) result.voices = voices;
  if (enabled !== undefined) result.enabled = enabled;
  if (readAloudProvider) result.readAloudProvider = readAloudProvider;
  return result;
};

export const resolveRealtimeVoiceId = (
  prefs: RealtimeVoicePreferences,
  underlyingProvider: RealtimeVoiceUnderlyingProvider,
  fallback: string,
): string => {
  const stored = prefs.voices?.[underlyingProvider]?.trim();
  return stored && stored.length > 0 ? stored : fallback;
};
