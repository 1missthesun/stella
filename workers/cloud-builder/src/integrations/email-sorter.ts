import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import { GATEWAY_DECISIONS_MODEL, GATEWAY_DECISIONS_PATH } from "@stella/contracts/gateway/api";
import type { ManagedModelAudience } from "@stella/contracts/gateway/capability";
import { STELLA_DEFAULT_MODEL } from "@stella/model-catalog/aliases";
import { mintTurnCapability } from "../capability-signer.js";

export const DECISION_INPUT_USD_PER_M = 0.1;
export const WAKE_THRESHOLD = 0.8;
export const RULE_THRESHOLD = 0.6;
const DECISION_TIMEOUT_MS = 25_000;
const RUN_BUDGET_MICRO_CENTS = 5_000_000;
const GATE_TEXT_CHARS = 1_200;

export type SorterAccess = {
  env: Cloudflare.Env;
  ownerId: string;
  ownerGeneration: string;
  execution: CloudExecutionSelection;
  audience: ManagedModelAudience;
  budgetMicroCents: number;
  ownKey?: OwnKeyProvider;
  onOwnKeyRefused?: (message: string) => void;
};

export type OwnKeyProvider = "openrouter";

export class OwnKeyRefused extends Error {}

export class DecisionRefused extends Error {}

export type WakeInput = {
  note: string;
  account: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  receivedAt: number;
  text: string;
  bulk: boolean;
  wroteToSender: number;
  rules: { ruleId: string; when: string }[];
};

export type WakeVerdict = {
  urgentP: number;
  ruleId?: string;
  inputTokens: number;
};

const execFor = (execution: CloudExecutionSelection): Extract<CloudExecutionSelection, { engine: "stella" }> =>
  execution.engine === "stella"
    ? execution
    : { engine: "stella", provider: "stella", model: STELLA_DEFAULT_MODEL, reasoningEffort: "low" };

const capabilityFor = async (access: SorterAccess) =>
  await mintTurnCapability(access.env, {
    ownerId: access.ownerId,
    ownerGeneration: access.ownerGeneration,
    turnId: `email-wake-${crypto.randomUUID()}`,
    conversationId: "email",
    execution: access.ownKey
      ? { engine: "provider", provider: access.ownKey, model: GATEWAY_DECISIONS_MODEL, reasoningEffort: "low" }
      : execFor(access.execution),
    audience: access.audience,
    budgetMicroCents: Math.min(access.budgetMicroCents, RUN_BUDGET_MICRO_CENTS),
    agentTypes: ["general"],
  });

const relationLine = (count: number): string =>
  count > 0
    ? `They have written to this sender ${count} time${count === 1 ? "" : "s"} in the last six months.`
    : "They have never written to this sender in the last six months.";

const inputText = (input: WakeInput): string =>
  [
    input.note.trim() ? `What matters to this person, in their own words ("you" is them): ${input.note.trim()}` : "",
    `A new email arrived in their inbox (${input.account}).`,
    relationLine(input.wroteToSender),
    input.bulk ? "It was sent to a mailing list." : "It was sent directly, not through a mailing list.",
    `From: ${input.from}`,
    `To: ${input.to}`,
    input.cc ? `Cc: ${input.cc}` : "",
    `Subject: ${input.subject}`,
    `Received: ${new Date(input.receivedAt).toISOString()}`,
    "",
    input.text.slice(0, GATE_TEXT_CHARS) || "(no text)",
  ]
    .filter((line, index) => line !== "" || index > 0)
    .join("\n");

export const wakeRequest = (input: WakeInput): Record<string, unknown> => {
  const questions: Record<string, unknown> = {
    urgent: {
      type: "noul",
      instructions:
        "Their assistant reads their mail a few times a day. Would this person want their assistant to look at this email right now instead of at the next read?",
      criteria: {
        true_description:
          "Waiting hours would cost them: something due or happening today, money or account security at risk, a trip changing, someone close needing them now.",
        false_description: "It can wait a few hours without harm, or it is routine, promotional or automated.",
      },
    },
  };
  if (input.rules.length > 0) {
    questions.rule = {
      type: "choice",
      instructions: "Which of the person's standing instructions is about this email, if any?",
      criteria: {
        none: "None of the instructions is about this email.",
        ...Object.fromEntries(input.rules.map((rule) => [rule.ruleId, rule.when])),
      },
    };
  }
  return { input: [{ type: "text", text: inputText(input) }], questions };
};

type Answers = Record<string, { choice?: unknown; noul?: unknown; probabilities?: unknown } | undefined>;

export const wakeVerdictFrom = (payload: unknown, input: WakeInput): WakeVerdict => {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const answers = (record.answers && typeof record.answers === "object" ? record.answers : {}) as Answers;
  const usage = (record.usage && typeof record.usage === "object" ? record.usage : {}) as Record<string, unknown>;
  const urgentP = typeof answers.urgent?.noul === "number" ? answers.urgent.noul : 0;
  const ruleChoice = answers.rule?.choice;
  const ruleProbability =
    typeof ruleChoice === "string" && answers.rule?.probabilities && typeof answers.rule.probabilities === "object"
      ? Number((answers.rule.probabilities as Record<string, unknown>)[ruleChoice])
      : 0;
  const ruleId =
    typeof ruleChoice === "string" &&
    ruleChoice !== "none" &&
    input.rules.some((rule) => rule.ruleId === ruleChoice) &&
    ruleProbability >= RULE_THRESHOLD
      ? ruleChoice
      : undefined;
  return {
    urgentP,
    ...(ruleId ? { ruleId } : {}),
    inputTokens: typeof usage.total_input_tokens === "number" ? usage.total_input_tokens : 0,
  };
};

export const checkWake = async (access: SorterAccess, input: WakeInput): Promise<WakeVerdict> => {
  const gateway = access.env.MODEL_GATEWAY;
  const origin = access.env.MODEL_GATEWAY_URL?.trim() ?? "";
  if (!gateway || !origin) throw new Error("Model gateway is not configured.");
  const capability = await capabilityFor(access);
  const response = await gateway.fetch(
    new Request(`${origin.replace(/\/+$/u, "")}${GATEWAY_DECISIONS_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${capability.token}` },
      body: JSON.stringify(wakeRequest(input)),
      signal: AbortSignal.timeout(DECISION_TIMEOUT_MS),
    }),
  );
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const error = payload?.error && typeof payload.error === "object" ? (payload.error as Record<string, unknown>) : {};
    const message = typeof error.message === "string" ? error.message : `The decision model answered ${response.status}.`;
    if (access.ownKey && (response.status === 401 || response.status === 402 || response.status === 403)) {
      access.onOwnKeyRefused?.(message);
      throw new OwnKeyRefused(message);
    }
    if (response.status === 400) throw new DecisionRefused(message);
    throw new Error(message);
  }
  return wakeVerdictFrom(payload, input);
};
