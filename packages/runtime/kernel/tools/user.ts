import {
  USER_ASK_MAX_FIELDS,
  USER_ASK_FIELD_TYPES,
  USER_ASK_PRESETS,
  clampUrgency,
  normalizeUserAskOptions,
  userAskPresetFields,
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
  ) => Promise<UserAskResolution>;
  useSecureValue?: (
    request: SecureValueUseRequest,
  ) => Promise<SecureValueUseReceipt>;
  revealSecureValueForFill?: (request: {
    handle: string;
    conversationId?: string;
    agentId?: string;
  }) => Promise<{ ok: true; value: string } | { ok: false; error: string }>;
  fillSecureBrowserField?: (
    context: ToolContext,
    target: {
      tabId?: number;
      selector: string;
      value: string;
      backend?: "in-app" | "external";
    },
  ) => Promise<number>;
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
  try {
    const filled = await config.fillSecureBrowserField!(context, {
      ...(tabId === undefined ? {} : { tabId }),
      selector: target.selector,
      value: revealed.value,
      ...(target.backend ? { backend: target.backend } : {}),
    });
    return receipt(
      true,
      `Filled the stored value into ${target.selector} in tab ${filled}.`,
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

/** A preset's fields first, in order; an explicit field with a preset field's id refines that one, any other is added after. */
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
      urgency: clampUrgency(args.urgency),
      ...contextFields(context, args),
    }, signal);
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
    if (!selector) return null;
    const tabId =
      typeof source.tabId === "number"
        ? String(source.tabId)
        : text(source.tabId, 128);
    const backend = text(source.backend, 16);
    return {
      kind,
      selector,
      ...(tabId ? { tabId } : {}),
      ...(backend === "in-app" || backend === "external" ? { backend } : {}),
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
