import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type {
  UserAsk,
  UserAskAnswer,
  UserAskAnswerFieldValue,
} from "@stella/contracts/user-ask";
import type { UserAskRecord } from "@stella/contracts/user-ask-deck";
import { userAskAwaitsAnswer } from "@stella/contracts/user-ask";
import { getElectronApi } from "@/platform/electron/electron";
import { isWebsiteHost } from "@/platform/capabilities";
import { backendClient, backendUrl } from "@/platform/backend/backend-client";
import { getAuthHeaders } from "@/global/auth/services/auth-token";
import { sealUserAskValueOnWeb } from "./web-user-ask-seal";

const EMPTY_ASKS: readonly UserAsk[] = [];
const EMPTY_RECORDS: readonly UserAskRecord[] = [];
const MAX_RECORDS_PER_CONVERSATION = 50;

let recordsByConversation: ReadonlyMap<string, readonly UserAskRecord[]> = new Map();
const recordListeners = new Set<() => void>();

let openAsks: readonly UserAsk[] = EMPTY_ASKS;
let detachBridge: (() => void) | null = null;

const listeners = new Set<() => void>();
const answered = new Set<string>();

const userAskBridge = () => getElectronApi()?.userAsk;

const emit = () => {
  for (const listener of listeners) listener();
};

const byCreation = (rows: readonly UserAsk[]): readonly UserAsk[] =>
  [...rows].sort((left, right) => left.createdAt - right.createdAt);

const isUsableAsk = (value: unknown): value is UserAsk => {
  if (!value || typeof value !== "object") return false;
  const ask = value as Partial<UserAsk>;
  return (
    typeof ask.askId === "string" &&
    typeof ask.revision === "number" &&
    typeof ask.state === "string" &&
    Boolean(ask.detail)
  );
};

const upsertAsk = (incoming: unknown) => {
  if (!isUsableAsk(incoming)) return;
  const current = openAsks.find((ask) => ask.askId === incoming.askId);
  if (current && current.revision > incoming.revision) return;
  if (!userAskAwaitsAnswer(incoming.state) || answered.has(incoming.askId)) {
    dropAsk(incoming.askId);
    return;
  }
  openAsks = byCreation([
    ...openAsks.filter((ask) => ask.askId !== incoming.askId),
    incoming,
  ]);
  emit();
};

const hasAskId = (value: unknown): value is { askId: string } =>
  Boolean(value) &&
  typeof value === "object" &&
  typeof (value as { askId?: unknown }).askId === "string";

const firstAsk = (args: readonly unknown[]): unknown => args.find(isUsableAsk);

const firstAskId = (args: readonly unknown[]): unknown =>
  args.find(hasAskId)?.askId;

const dropAsk = (askId: unknown) => {
  if (typeof askId !== "string") return;
  if (!openAsks.some((ask) => ask.askId === askId)) return;
  openAsks = openAsks.filter((ask) => ask.askId !== askId);
  emit();
};

const replaceAsks = (rows: unknown) => {
  const usable = (Array.isArray(rows) ? rows : [])
    .filter(isUsableAsk)
    .filter(
      (ask) => userAskAwaitsAnswer(ask.state) && !answered.has(ask.askId),
    );
  openAsks = byCreation(usable);
  emit();
};

const relayedRows = (rows: unknown): readonly UserAsk[] =>
  (Array.isArray(rows) ? rows : [])
    .filter(isUsableAsk)
    .map((ask) => ({ ...ask, relayed: true }));

const webAsksRequest = async (
  path: string,
  init?: { method: string; body?: unknown },
): Promise<Response | null> => {
  if (!backendUrl) return null;
  try {
    return await fetch(`${backendUrl.replace(/\/$/u, "")}/api/user-asks${path}`, {
      method: init?.method ?? "GET",
      headers: await getAuthHeaders({ "Content-Type": "application/json" }),
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    return null;
  }
};

const refreshWebAsks = async (): Promise<void> => {
  const response = await webAsksRequest("");
  if (!response?.ok) return;
  const body = (await response.json().catch(() => null)) as {
    open?: unknown;
  } | null;
  if (body && Array.isArray(body.open)) replaceAsks(relayedRows(body.open));
};

const sealWebFields = async (
  ask: UserAsk,
  fields: readonly UserAskAnswerFieldValue[],
): Promise<readonly UserAskAnswerFieldValue[]> => {
  const detail = ask.detail;
  if (detail.kind !== "secure_input") return fields;
  return await Promise.all(
    fields.map(async (entry): Promise<UserAskAnswerFieldValue> => {
      const field = detail.fields.find((candidate) => candidate.id === entry.fieldId);
      if (entry.kind !== "plain" || !field?.sensitive) return entry;
      return {
        fieldId: entry.fieldId,
        kind: "sealed",
        sealed: await sealUserAskValueOnWeb({
          askId: ask.askId,
          fieldId: entry.fieldId,
          value: entry.value,
          recipientKey: ask.recipientKey,
        }),
      };
    }),
  );
};

const answerWebAsk = async (answer: UserAskAnswer): Promise<boolean> => {
  const ask = openAsks.find((candidate) => candidate.askId === answer.askId);
  if (!ask) return false;
  let sealed: UserAskAnswer;
  try {
    sealed =
      answer.kind === "fields"
        ? { ...answer, fields: await sealWebFields(ask, answer.fields) }
        : answer;
  } catch {
    return false;
  }
  const post = async (revision: number) =>
    await webAsksRequest(`/${encodeURIComponent(answer.askId)}/answer`, {
      method: "POST",
      body: { ...sealed, revision },
    });
  let response = await post(ask.revision);
  if (response?.status === 409) {
    await refreshWebAsks();
    const current = openAsks.find((candidate) => candidate.askId === answer.askId);
    if (!current) return false;
    response = await post(current.revision);
  }
  return response?.ok === true;
};

const attachBridge = () => {
  if (detachBridge) return;
  if (isWebsiteHost()) {
    detachBridge = backendClient.watch(
      "userAsks.open",
      {},
      (rows) => replaceAsks(relayedRows(rows)),
      () => undefined,
    );
    return;
  }
  const bridge = userAskBridge();
  if (!bridge) return;
  const offs = [
    bridge.onOpened?.((...args: unknown[]) => upsertAsk(firstAsk(args))),
    bridge.onUpdated?.((...args: unknown[]) => upsertAsk(firstAsk(args))),
    bridge.onClosed?.((...args: unknown[]) => dropAsk(firstAskId(args))),
  ].filter((off): off is () => void => typeof off === "function");
  if (offs.length === 0) return;
  detachBridge = () => {
    for (const off of offs) off();
  };
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  attachBridge();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && detachBridge) {
      detachBridge();
      detachBridge = null;
    }
  };
};

const snapshot = () => openAsks;

export const refreshUserAsks = async (): Promise<void> => {
  if (isWebsiteHost()) {
    await refreshWebAsks();
    return;
  }
  const bridge = userAskBridge();
  if (!bridge?.list) return;
  try {
    replaceAsks(await bridge.list());
  } catch {
    replaceAsks([]);
  }
};

export const answerUserAsk = async (answer: UserAskAnswer): Promise<boolean> => {
  if (answered.has(answer.askId)) return true;
  if (isWebsiteHost()) {
    answered.add(answer.askId);
    if (!(await answerWebAsk(answer))) {
      answered.delete(answer.askId);
      return false;
    }
    dropAsk(answer.askId);
    return true;
  }
  const bridge = userAskBridge();
  if (!bridge?.answer) return false;
  answered.add(answer.askId);
  try {
    const result = await bridge.answer(answer);
    if (result?.ok === false) {
      answered.delete(answer.askId);
      return false;
    }
    dropAsk(answer.askId);
    return true;
  } catch {
    answered.delete(answer.askId);
    return false;
  }
};

export const declineUserAsk = async (
  askId: string,
  reason: string,
): Promise<boolean> => {
  if (answered.has(askId)) return true;
  answered.add(askId);
  try {
    let ok = false;
    if (isWebsiteHost()) {
      const response = await webAsksRequest(
        `/${encodeURIComponent(askId)}/cancel`,
        { method: "POST", body: reason ? { reason } : {} },
      );
      ok = response?.ok === true;
    } else {
      const bridge = userAskBridge();
      const result = bridge?.cancel
        ? await bridge.cancel({ askId, ...(reason ? { reason } : {}) })
        : null;
      ok = result?.ok === true;
    }
    if (!ok) {
      answered.delete(askId);
      return false;
    }
    dropAsk(askId);
    return true;
  } catch {
    answered.delete(askId);
    return false;
  }
};

export const recordUserAskAnswer = (
  conversationId: string,
  record: UserAskRecord,
): void => {
  if (!conversationId) return;
  const current = recordsByConversation.get(conversationId) ?? EMPTY_RECORDS;
  const next = new Map(recordsByConversation);
  next.set(
    conversationId,
    [...current.filter((entry) => entry.id !== record.id), record]
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(-MAX_RECORDS_PER_CONVERSATION),
  );
  recordsByConversation = next;
  for (const listener of recordListeners) listener();
};

const subscribeRecords = (listener: () => void) => {
  recordListeners.add(listener);
  return () => {
    recordListeners.delete(listener);
  };
};

const recordsSnapshot = () => recordsByConversation;

export const useConversationUserAskRecords = (
  conversationId: string | null | undefined,
): readonly UserAskRecord[] => {
  const records = useSyncExternalStore(
    subscribeRecords,
    recordsSnapshot,
    recordsSnapshot,
  );
  return conversationId
    ? (records.get(conversationId) ?? EMPTY_RECORDS)
    : EMPTY_RECORDS;
};

export const useUserAsks = (): readonly UserAsk[] =>
  useSyncExternalStore(subscribe, snapshot, snapshot);

export const useConversationUserAsks = (
  conversationId: string | null | undefined,
): readonly UserAsk[] => {
  const asks = useUserAsks();
  return useMemo(
    () =>
      conversationId
        ? asks.filter((ask) => ask.conversationId === conversationId)
        : EMPTY_ASKS,
    [asks, conversationId],
  );
};

export const useUserAskRemainingMs = (
  deadlineAt: number | undefined,
): number | null => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadlineAt === undefined) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadlineAt]);

  if (deadlineAt === undefined) return null;
  return Math.max(0, deadlineAt - now);
};
