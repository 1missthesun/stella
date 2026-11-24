import {
  USER_ASK_MAX_FIELDS,
  USER_ASK_FIELD_TYPES,
  USER_ASK_PRESETS,
  clampUrgency,
  normalizeUserAskOptions,
  userAskPresetFields,
  type SecureInputNotSaved,
  type SecureValueTarget,
  type SecureValueUseReceipt,
  type UserAskField,
  type UserAskFieldType,
  type UserAskQuestion,
  type UserAskResolution,
  type UserAskUrgencyLevel,
} from "@stella/contracts/user-ask";
import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import { redactSensitiveText } from "@stella/contracts/sensitive-data";
import {
  SECRET_REDACTION_MARK,
  createSecretFingerprintParams,
  fingerprintSecrets,
  redactSecretFingerprints,
} from "@stella/contracts/secret-redaction";
import {
  SECURE_FILL_MODES,
  secureFillReceipt,
  type SecureFillMode,
  type SecureFillOutcome,
} from "@stella/contracts/secure-fill";
import { prepareAskUser, userAskResolutionResult } from "./defs/ask-user-def.js";
import type { ToolContext, ToolResult } from "./types.js";

export type AskUserRequest = {
  questions: readonly UserAskQuestion[];
  timeoutMs?: number;
  blocking: boolean;
  urgency: UserAskUrgencyLevel;
  conversationId?: string;
  agentId?: string;
  toolCallId?: string;
};

export type SecureInputSaveRequest = {
  service: string;
  account?: string;
  replace?: boolean;
};

export type SecureInputRequest = {
  purpose: string;
  detail?: string;
  fields: readonly UserAskField[];
  save?: SecureInputSaveRequest;
  savedOnly?: true;
  urgency: UserAskUrgencyLevel;
  conversationId?: string;
  agentId?: string;
  toolCallId?: string;
};

export type SecureValueUseRequest = {
  handle: string;
  target: SecureValueTarget;
  conversationId?: string;
  agentId?: string;
};

export type UserToolsConfig = {
  askUser?: (
    request: AskUserRequest,
    signal?: AbortSignal,
  ) => Promise<UserAskResolution>;
  requestSecureInput?: (
    request: SecureInputRequest,
    signal?: AbortSignal,
  ) => Promise<UserAskResolution | SecureInputNotSaved | null>;
  useSecureValue?: (
    request: SecureValueUseRequest,
  ) => Promise<SecureValueUseReceipt>;
  revealSecureValueForFill?: (request: {
    handle: string;
    conversationId?: string;
    agentId?: string;
  }) => Promise<
    | { ok: true; value: string; label?: string; expiresAt?: number }
    | { ok: false; error: string }
  >;
  fillSecureBrowserField?: (
    context: ToolContext,
    target: {
      tabId?: number;
      selector: string;
      value: string;
      backend?: "in-app" | "external";
      mode?: SecureFillMode;
    },
  ) => Promise<SecureFillOutcome>;
};

const fillFingerprintParams = createSecretFingerprintParams(Math.random);

const scrubFilledSecret = (message: string, secret: string): string =>
  redactSensitiveText(
    redactSecretFingerprints(
      message.split(secret).join(SECRET_REDACTION_MARK),
      fingerprintSecrets([secret], fillFingerprintParams),
    ),
  );

const fillBrowserField = async (
  config: UserToolsConfig,
  handle: string,
  target: Extract<SecureValueTarget, { kind: "browser_field" }>,
  context: ToolContext | undefined,
): Promise<ToolResult> => {
  const usedAt = Date.now();
  const receipt = (ok: boolean, detail: string): ToolResult => ({
    result: { handle, target: "browser_field", usedAt, detail, ok },
  });
  if (!context) return receipt(false, "No agent session to fill a browser in.");
  let tabId: number | undefined;
  if (target.tabId) {
    const parsed = Number(target.tabId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return receipt(
        false,
        "tabId must be the numeric id of a tab you opened with the browser API (tab.id). Leave it out to use your current tab.",
      );
    }
    tabId = parsed;
  }
  const revealed = await config.revealSecureValueForFill!({
    handle,
    ...(context.conversationId ? { conversationId: context.conversationId } : {}),
    ...(context.agentId ? { agentId: context.agentId } : {}),
  });
  if (!revealed.ok) return receipt(false, revealed.error);
  const mode = target.mode ?? "fill";
  try {
    const outcome = await config.fillSecureBrowserField!(context, {
      ...(tabId === undefined ? {} : { tabId }),
      selector: target.selector,
      value: revealed.value,
      ...(target.backend ? { backend: target.backend } : {}),
      mode,
    });
    const written = secureFillReceipt({
      label: revealed.label ?? "",
      selector: target.selector,
      mode,
      outcome,
      ...(revealed.expiresAt ? { usableUntil: clockTime(revealed.expiresAt) } : {}),
    });
    return receipt(
      written.ok,
      scrubFilledSecret(written.detail, revealed.value).slice(0, 2000),
    );
  } catch (error) {
    return receipt(
      false,
      scrubFilledSecret(
        (error as Error)?.message || "The browser field could not be filled.",
        revealed.value,
      ).slice(0, 2000),
    );
  }
};

const clockTime = (at: number): string => {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

const text = (value: unknown, max = 2000): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const contextFields = (
  context: ToolContext | undefined,
  args: Record<string, unknown>,
): { conversationId?: string; agentId?: string; toolCallId?: string } => {
  const conversationId = context?.conversationId;
  const agentId = context?.agentId;
  const toolCallId = text(args.__toolCallId, 128) || context?.requestId;
  return {
    ...(conversationId ? { conversationId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(toolCallId ? { toolCallId } : {}),
  };
};

export const handleAskUser = async (
  config: UserToolsConfig,
  args: Record<string, unknown>,
  context?: ToolContext,
  signal?: AbortSignal,
): Promise<ToolResult> => {
  if (!config.askUser) {
    return { error: "Asking the user is not supported on this device." };
  }
  const prepared = prepareAskUser(args, {
    orchestrator: context?.agentType === AGENT_IDS.ORCHESTRATOR,
  });
  if (!prepared.ok) return { error: prepared.error };
  const { questions, blocking, timeoutMs, urgency } = prepared;
  try {
    const resolution = await config.askUser({
      questions,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      blocking,
      urgency,
      ...contextFields(context, args),
    }, signal);
    return userAskResolutionResult(resolution, questions);
  } catch (error) {
    return { error: (error as Error).message || "The ask failed." };
  }
};

const normalizeFieldType = (value: unknown): UserAskFieldType => {
  const candidate = text(value, 32).toLowerCase();
  return (USER_ASK_FIELD_TYPES as readonly string[]).includes(candidate)
    ? (candidate as UserAskFieldType)
    : "text";
};

const normalizeFields = (input: unknown): readonly UserAskField[] => {
  const rows = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const fields: UserAskField[] = [];
  for (const row of rows) {
    if (fields.length >= USER_ASK_MAX_FIELDS) break;
    const source = (row ?? {}) as Record<string, unknown>;
    const label = text(source.label, 120);
    if (!label) continue;
    const baseId =
      text(source.id, 48)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") ||
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    let id = baseId || `field_${fields.length + 1}`;
    while (seen.has(id)) id = `${id}_${fields.length + 1}`;
    seen.add(id);
    const type = normalizeFieldType(source.type);
    const sensitive =
      typeof source.sensitive === "boolean" ? source.sensitive : type === "secret";
    const placeholder = text(source.placeholder, 120);
    const hint = text(source.hint, 240);
    const choices =
      type === "choice" ? normalizeUserAskOptions(source.choices) : [];
    fields.push({
      id,
      label,
      type,
      sensitive,
      ...(placeholder ? { placeholder } : {}),
      ...(hint ? { hint } : {}),
      ...(source.optional === true ? { optional: true } : {}),
      ...(choices.length > 0 ? { choices } : {}),
    });
  }
  return fields;
};

const mergePresetFields = (
  presetFields: readonly UserAskField[],
  explicit: unknown,
): unknown[] => {
  const rows: Record<string, unknown>[] = presetFields.map((field) => ({ ...field }));
  for (const row of Array.isArray(explicit) ? explicit : []) {
    const source = (row ?? {}) as Record<string, unknown>;
    const at = rows.findIndex((field) => field.id === source.id);
    if (at >= 0 && presetFields.length > 0) rows[at] = { ...rows[at], ...source };
    else rows.push(source);
  }
  return rows;
};

export const SECURE_INPUT_SAVED_ONLY_ARG = "__savedOnly";

const cloudNotSavedNote = (service: string, found: SecureInputNotSaved): string => {
  const retry = "Call again without saved_only to ask the user on a secure card (they can answer on any device; a phone that holds the login fills it with one tap).";
  if (found.reason === "no_computer") {
    return `None of the user's computers that hold their saved values is online, so Stella could not look for "${service}". ${retry}`;
  }
  if (found.reason === "limit") {
    return `The user's computer that holds "${service}" has given saved values to cloud tasks many times in the last hour, so this one needs the user. ${retry}`;
  }
  if (found.reason === "sync_off") {
    return `The user's saved values don't sync to any computer Stella can ask, so nothing saved was found for "${service}". ${retry}`;
  }
  if (found.savedHere.length === 0) {
    return `Nothing is saved for "${service}" or anything else. ${retry}`;
  }
  return `Nothing saved matches "${service}". savedHere lists what is saved (names only). If one of them is what you need, call again with its service (and account); otherwise ${retry.charAt(0).toLowerCase()}${retry.slice(1)}`;
};

const notSavedResult = (service: string, found: SecureInputNotSaved | null): ToolResult => {
  const savedHere = found?.savedHere ?? [];
  if (found?.reason) {
    const note = [found.message, cloudNotSavedNote(service, found)].filter(Boolean).join(" ");
    const details = {
      outcome: "not_saved" as const,
      savedHere,
      reason: found.reason,
      ...(found.message ? { message: found.message } : {}),
    };
    return { result: { ...details, note }, details };
  }
  const note = savedHere.length === 0
    ? `Nothing is saved on this computer for "${service}" or anything else. Call again without saved_only to ask the user on a secure card.`
    : `Nothing saved on this computer matches "${service}". savedHere lists what is saved (names only). If one of them is what you need, call again with its service (and account); otherwise call again without saved_only to ask the user.`;
  const details = { outcome: "not_saved" as const, savedHere };
  return { result: { ...details, note }, details };
};

export const handleRequestSecureInput = async (
  config: UserToolsConfig,
  args: Record<string, unknown>,
  context?: ToolContext,
  signal?: AbortSignal,
): Promise<ToolResult> => {
  if (!config.requestSecureInput) {
    return { error: "Secure input is not supported on this device." };
  }
  const purpose = text(args.purpose, 300);
  if (!purpose) return { error: "purpose is required." };
  const preset = text(args.preset, 32).toLowerCase();
  const presetFields = userAskPresetFields(preset);
  if (preset && presetFields.length === 0) {
    return { error: `preset must be one of: ${USER_ASK_PRESETS.join(", ")}.` };
  }
  const fields = normalizeFields(mergePresetFields(presetFields, args.fields));
  if (fields.length === 0) {
    return {
      error:
        'fields is required: describe each value you need with a label, a type (text, secret, code, choice), and whether it is sensitive, or pass preset "login" or "card".',
    };
  }
  const detail = text(args.detail, 1000);
  const service = text(args.service, 120);
  const account = text(args.account, 120);
  const replace = args.replace_saved === true || args.replaceSaved === true;
  if (replace && !service) {
    return {
      error:
        "replace_saved needs service (and account when you know it) so Stella knows which saved value to replace.",
    };
  }
  const savedOnly = args[SECURE_INPUT_SAVED_ONLY_ARG] === true || args.saved_only === true;
  try {
    const resolution = await config.requestSecureInput({
      purpose,
      ...(detail ? { detail } : {}),
      fields,
      save: {
        service,
        ...(account ? { account } : {}),
        ...(replace ? { replace: true } : {}),
      },
      ...(savedOnly ? { savedOnly: true as const } : {}),
      urgency: clampUrgency(args.urgency),
      ...contextFields(context, args),
    }, signal);
    if (resolution === null || resolution.outcome === "not_saved") {
      return notSavedResult(service, resolution);
    }
    return userAskResolutionResult(resolution, [], purpose);
  } catch (error) {
    return { error: (error as Error).message || "Secure input failed." };
  }
};

const normalizeTarget = (input: unknown): SecureValueTarget | null => {
  const source = (input ?? {}) as Record<string, unknown>;
  const kind = text(source.kind, 32);
  if (kind === "browser_field") {
    const selector = text(source.selector, 500);
    if (!selector && text(source.mode, 16).toLowerCase() !== "clear") return null;
    const tabId =
      typeof source.tabId === "number"
        ? String(source.tabId)
        : text(source.tabId, 128);
    const backend = text(source.backend, 16);
    const mode = text(source.mode, 16).toLowerCase();
    return {
      kind,
      selector,
      ...(tabId ? { tabId } : {}),
      ...(backend === "in-app" || backend === "external" ? { backend } : {}),
      ...((SECURE_FILL_MODES as readonly string[]).includes(mode) && mode !== "fill"
        ? { mode: mode as SecureFillMode }
        : {}),
    };
  }
  if (kind === "command") {
    const command = text(source.command, 4000);
    if (!command) return null;
    const placeholder = text(source.placeholder, 64);
    const cwd = text(source.cwd, 1000);
    return {
      kind,
      command,
      ...(placeholder ? { placeholder } : {}),
      ...(cwd ? { cwd } : {}),
    };
  }
  if (kind === "keychain") {
    const service = text(source.service, 200);
    const account = text(source.account, 200);
    if (!service || !account) return null;
    return { kind, service, account };
  }
  return null;
};

export const handleUseSecureValue = async (
  config: UserToolsConfig,
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<ToolResult> => {
  if (!config.useSecureValue) {
    return { error: "Stored secure values are not usable on this device." };
  }
  const handle = text(args.handle, 256);
  if (!handle) return { error: "handle is required." };
  const target = normalizeTarget(args.into ?? args.target);
  if (!target) {
    return {
      error:
        'into is required: {"kind":"browser_field","selector":"#password"}, {"kind":"command","command":"…{{secret}}…"}, or {"kind":"keychain","service":"…","account":"…"}.',
    };
  }
  if (
    target.kind === "browser_field" &&
    config.revealSecureValueForFill &&
    config.fillSecureBrowserField
  ) {
    return await fillBrowserField(config, handle, target, context);
  }
  try {
    const receipt = await config.useSecureValue({
      handle,
      target,
      ...(context?.conversationId ? { conversationId: context.conversationId } : {}),
      ...(context?.agentId ? { agentId: context.agentId } : {}),
    });
    return { result: receipt };
  } catch (error) {
    return {
      error: (error as Error).message || "The secure value could not be used.",
    };
  }
};
