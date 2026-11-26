import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import type { BillingStatus } from "@stella/contracts/backend/billing";
import type { EngineSettings } from "@stella/contracts/backend/engines";
import {
  foldUsageLimitPauses,
  usageLimitHoldsCloudReply,
  type ClaudeUsageLimitCard,
} from "@stella/contracts/claude-usage-limit";
import {
  composerPrewarmPath,
  type ComposerPrewarmTarget,
} from "@stella/contracts/composer-prewarm";
import type { JournalRecord } from "@stella/contracts/conversation-protocol";
import type { DeviceDestination } from "@stella/contracts/turn-plane/placement";
import { useEffect, useMemo, useState } from "react";
import { useBackendView } from "./backend";
import type { AutomaticExecutionTarget } from "./execution-placement-core";
import { postJson } from "./http";
import { getPreferredPhoneAccess, type StoredPhoneAccess } from "./phone-access";

// Mirrors the owner gate's mobile placement: Cloud when chosen, a chosen
// computer when one is selected, and with "automatic" the paired computer when
// it can take the turn, otherwise Cloud. `pairedDeviceId` undefined = unknown.
export const composerPrewarmTarget = (args: {
  executionTarget: AutomaticExecutionTarget;
  pairedDeviceId: string | null | undefined;
  devices: readonly DeviceDestination[] | undefined;
}): ComposerPrewarmTarget | null => {
  const { executionTarget, pairedDeviceId, devices } = args;
  if (executionTarget.mode === "cloud") return "cloud";
  if (executionTarget.mode === "device") return null;
  if (pairedDeviceId === undefined) return null;
  if (pairedDeviceId === null) return "automatic";
  if (!devices) return null;
  const paired = devices.find((device) => device.deviceId === pairedDeviceId);
  const computerTakesTurn = Boolean(
    paired?.online &&
      paired.remoteExecutionEnabled &&
      paired.availability?.ready !== false,
  );
  return computerTakesTurn ? null : "automatic";
};

const cloudClaudeLoginMissing = (engines: EngineSettings): boolean => {
  const places = engines.connections
    .filter((connection) => connection.provider === "anthropic")
    .flatMap((connection) => connection.places ?? [])
    .filter((place) => place.kind === "cloud");
  if (places.length === 0) return true;
  return places.some((place) => place.active && place.loginEnded);
};

// What the phone already knows would keep the turn out of a Cloud Claude Code
// container. Unknown state is not a block: the server makes the final call.
export const composerPrewarmBlock = (args: {
  billing: BillingStatus | undefined;
  claudeReplyHeld: boolean;
  execution: CloudExecutionSelection | undefined;
  engines: EngineSettings | undefined;
}): string | null => {
  const { billing, claudeReplyHeld, execution, engines } = args;
  if (billing?.cloudSandbox?.enabled === false) return "plan";
  if (billing?.usageLimit) return "usage_limit";
  if (claudeReplyHeld) return "claude_usage_limit";
  if (!execution) return null;
  if (execution.engine !== "anthropic") return "not_claude_code";
  return engines && cloudClaudeLoginMissing(engines) ? "claude_login" : null;
};

export const useComposerPrewarm = (args: {
  conversationId: string;
  composing: boolean;
  executionTarget: AutomaticExecutionTarget;
  access: StoredPhoneAccess | null;
  devices: readonly DeviceDestination[] | undefined;
  execution: CloudExecutionSelection | undefined;
  usageLimitRecords: readonly JournalRecord[];
}): void => {
  const {
    conversationId,
    composing,
    executionTarget,
    access,
    devices,
    execution,
    usageLimitRecords,
  } = args;
  const billing = useBackendView(
    "billing.status",
    conversationId ? {} : "skip",
  ).value;
  const engines = useBackendView(
    "engines.get",
    conversationId && execution?.engine === "anthropic" ? {} : "skip",
  ).value;
  const usageLimitPauses = useMemo(() => {
    const cards: { card: ClaudeUsageLimitCard; createdAtMs: number }[] = [];
    for (const record of usageLimitRecords) {
      if (record.kind === "card" && record.card.type === "usage-limit") {
        cards.push({ card: record.card, createdAtMs: record.createdAtMs });
      }
    }
    return cards.length > 0 ? foldUsageLimitPauses(cards) : null;
  }, [usageLimitRecords]);
  const needsStoredAccess =
    composing && !access && executionTarget.mode === "automatic";
  const [storedAccess, setStoredAccess] = useState<
    StoredPhoneAccess | null | undefined
  >(undefined);
  useEffect(() => {
    if (!needsStoredAccess || storedAccess !== undefined) return;
    let active = true;
    void getPreferredPhoneAccess().then(
      (stored) => {
        if (active) setStoredAccess(stored ?? null);
      },
      () => {
        if (active) setStoredAccess(null);
      },
    );
    return () => {
      active = false;
    };
  }, [needsStoredAccess, storedAccess]);

  const pairedDeviceId = access
    ? access.desktopDeviceId
    : storedAccess === undefined
      ? undefined
      : (storedAccess?.desktopDeviceId ?? null);
  const target = composing
    ? composerPrewarmTarget({ executionTarget, pairedDeviceId, devices })
    : null;
  const blocked =
    target !== null &&
    composerPrewarmBlock({
      billing,
      claudeReplyHeld: usageLimitPauses
        ? usageLimitHoldsCloudReply(usageLimitPauses)
        : false,
      execution,
      engines,
    }) !== null;
  const send = target && !blocked ? target : null;
  const executionKey = execution ? JSON.stringify(execution) : "";
  useEffect(() => {
    if (!send || !conversationId) return;
    void postJson(
      composerPrewarmPath(conversationId),
      {
        target: send,
        ...(executionKey ? { execution: JSON.parse(executionKey) as unknown } : {}),
      },
      { timeoutMs: 10_000 },
    ).catch(() => undefined);
  }, [conversationId, executionKey, send]);
};
