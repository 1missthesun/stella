const BLOCK_STOP_REASONS: ReadonlySet<string> = new Set(["refusal", "sensitive", "content_filter"]);

/**
 * pi-ai's wording for Anthropic `refusal` / `sensitive` and OpenAI-style
 * `content_filter` stops, the Claude Code CLI's refusal error, and Anthropic's
 * policy errors.
 */
const BLOCK_TEXT =
  /the model refused to complete the request|provider stopped with: sensitive|finish_reason: content_filter|unable to respond to this request|violate our usage policy|blocked by content filtering policy|stop_reason "?refusal"?|safety system stopped the reply/i;

const BLOCK_MARK = /^\s*\[[a-z-]+\/safeguard-block\]\s*/;

export const SAFEGUARD_BLOCK_ERROR_CODE = "safeguard-block";

export const markSafeguardBlock = (engine: string, message: string): string =>
  BLOCK_MARK.test(message) ? message : `[${engine}/${SAFEGUARD_BLOCK_ERROR_CODE}] ${message}`;

export const isSafeguardBlockText = (text: string | null | undefined): boolean =>
  Boolean(text) && (BLOCK_MARK.test(text!) || BLOCK_TEXT.test(text!));

export const isSafeguardBlock = (message: {
  stopReason?: string;
  errorMessage?: string;
  rawStopReason?: string;
}): boolean =>
  message.stopReason === "error" &&
  ((message.rawStopReason !== undefined && BLOCK_STOP_REASONS.has(message.rawStopReason)) ||
    isSafeguardBlockText(message.errorMessage));

const CLAUDE_MODEL_ID = /^(?:[a-z0-9.-]+\/)?claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[1m\])?$/;
const CLAUDE_FAMILY_ALIAS = /^(fable|opus|sonnet|haiku|mythos)(?:\[1m\])?$/;

export const safeguardModelLabel = (...ids: Array<string | undefined>): string | undefined => {
  for (const id of ids) {
    const trimmed = id?.trim().toLowerCase();
    if (!trimmed) continue;
    const full = CLAUDE_MODEL_ID.exec(trimmed);
    if (full) {
      const family = full[1]!.charAt(0).toUpperCase() + full[1]!.slice(1);
      return `${family} ${full[3] ? `${full[2]}.${full[3]}` : full[2]}`;
    }
    const alias = CLAUDE_FAMILY_ALIAS.exec(trimmed);
    if (alias) return alias[1]!.charAt(0).toUpperCase() + alias[1]!.slice(1);
  }
  return undefined;
};

export const isOpusModel = (...ids: Array<string | undefined>): boolean => ids.some((id) => /\bopus/i.test(id ?? ""));

export type SafeguardSwitch = { pick: string; label: string };

export type SafeguardBlockInfo = {
  model?: string;
  switchTo?: SafeguardSwitch;
};

export const parseSafeguardBlockInfo = (value: unknown): SafeguardBlockInfo | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const to = raw.switchTo as Record<string, unknown> | null | undefined;
  const switchTo =
    to && typeof to.pick === "string" && to.pick && typeof to.label === "string" && to.label
      ? { pick: to.pick.slice(0, 200), label: to.label.slice(0, 80) }
      : undefined;
  return {
    ...(typeof raw.model === "string" && raw.model ? { model: raw.model.slice(0, 80) } : {}),
    ...(switchTo ? { switchTo } : {}),
  };
};

export const SAFEGUARD_CARD_TYPE = "safeguard" as const;

export type SafeguardAction = "remove" | "switch" | "clear";

export type SafeguardCard =
  | {
      type: typeof SAFEGUARD_CARD_TYPE;
      state: "removed";
      requestId: string;
      fromSeq: number;
      toSeq: number;
      turnIds: string[];
    }
  | { type: typeof SAFEGUARD_CARD_TYPE; state: "cleared"; requestId: string }
  | { type: typeof SAFEGUARD_CARD_TYPE; state: "switched"; requestId: string; turnId: string; pick: string; label: string };

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_TURN_IDS = 64;

export const parseSafeguardCard = (value: unknown): SafeguardCard | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.type !== SAFEGUARD_CARD_TYPE || typeof raw.requestId !== "string" || !REQUEST_ID.test(raw.requestId)) return null;
  const base = { type: SAFEGUARD_CARD_TYPE, requestId: raw.requestId };
  if (raw.state === "cleared") return { ...base, state: "cleared" };
  if (raw.state === "removed") {
    const { fromSeq, toSeq, turnIds } = raw;
    if (!Number.isInteger(fromSeq) || !Number.isInteger(toSeq) || (fromSeq as number) < 0 || (toSeq as number) < (fromSeq as number)) {
      return null;
    }
    return {
      ...base,
      state: "removed",
      fromSeq: fromSeq as number,
      toSeq: toSeq as number,
      turnIds: Array.isArray(turnIds)
        ? turnIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200).slice(0, MAX_TURN_IDS)
        : [],
    };
  }
  if (raw.state === "switched") {
    if (typeof raw.turnId !== "string" || typeof raw.pick !== "string" || !raw.pick || typeof raw.label !== "string" || !raw.label) {
      return null;
    }
    return { ...base, state: "switched", turnId: raw.turnId, pick: raw.pick.slice(0, 200), label: raw.label.slice(0, 80) };
  }
  return null;
};

export type SafeguardFold = {
  block?: {
    turnId: string;
    model?: string;
    switchTo?: SafeguardSwitch;
    afterRemoval?: true;
  };
  blockedModels: string[];
  resolved?: SafeguardCard["state"];
};

export const emptySafeguardFold = (): SafeguardFold => ({ blockedModels: [] });

export type SafeguardEvent =
  | { e: "blocked"; turnId: string; info: SafeguardBlockInfo }
  | { e: "replied" }
  | { e: "card"; card: SafeguardCard };

const sameTurn = (a: string, b: string): boolean => a === b || a.endsWith(`:${b}`) || b.endsWith(`:${a}`);

export const applySafeguardEvent = (fold: SafeguardFold, event: SafeguardEvent): SafeguardFold => {
  switch (event.e) {
    case "replied":
      return fold.block || fold.resolved || fold.blockedModels.length > 0 ? emptySafeguardFold() : fold;
    case "blocked": {
      const { model, switchTo } = event.info;
      const known = fold.block && sameTurn(fold.block.turnId, event.turnId) ? fold.block : undefined;
      const afterRemoval = known ? known.afterRemoval : fold.resolved === "removed" ? (true as const) : undefined;
      return {
        block: {
          turnId: event.turnId,
          ...(model ? { model } : {}),
          ...(switchTo ? { switchTo } : {}),
          ...(afterRemoval ? { afterRemoval } : {}),
        },
        blockedModels: model && !fold.blockedModels.includes(model) ? [...fold.blockedModels, model] : fold.blockedModels,
        ...(known && fold.resolved ? { resolved: fold.resolved } : {}),
      };
    }
    case "card":
      return event.card.state === "cleared"
        ? { blockedModels: [], resolved: "cleared" }
        : { blockedModels: fold.blockedModels, resolved: event.card.state };
  }
};

export const safeguardEventOfRecord = (record: {
  kind: string;
  turnId: string;
  phase?: string;
  safeguard?: SafeguardBlockInfo;
  card?: unknown;
}): SafeguardEvent | null => {
  if (record.kind === "turn") {
    if (record.phase === "completed") return { e: "replied" };
    if (record.phase === "failed" && record.safeguard) return { e: "blocked", turnId: record.turnId, info: record.safeguard };
    return null;
  }
  if (record.kind !== "card") return null;
  const card = parseSafeguardCard(record.card);
  return card ? { e: "card", card } : null;
};

export type SafeguardNotice = {
  turnId: string;
  title: string;
  description: string;
  remove: { label: string };
  switchTo?: SafeguardSwitch & { actionLabel: string };
  clear?: { label: string };
};

export const safeguardNotice = (fold: SafeguardFold): SafeguardNotice | null => {
  const block = fold.block;
  if (!block) return null;
  const switchTo =
    block.switchTo && block.switchTo.label !== block.model && !fold.blockedModels.includes(block.switchTo.label)
      ? block.switchTo
      : undefined;
  const who = block.model ? `${block.model}'s safety system stopped it. ` : "";
  return {
    turnId: block.turnId,
    title: block.afterRemoval ? "Still stopped by the safety system" : "This reply was stopped",
    description: block.afterRemoval
      ? "Something earlier in the conversation is probably setting it off. Remove these messages too, or start fresh: your history stays, and Stella begins again without the earlier context."
      : `${who}That can happen by mistake. Remove the messages it stopped on and carry on${switchTo ? `, or continue with ${switchTo.label}` : ""}.`,
    remove: { label: "Remove messages" },
    ...(switchTo ? { switchTo: { ...switchTo, actionLabel: `Continue with ${switchTo.label}` } } : {}),
    ...(block.afterRemoval ? { clear: { label: "Start fresh" } } : {}),
  };
};

export const SAFEGUARD_CLEARED_LABEL = "Started fresh. Stella no longer sees the conversation before this point.";
export const safeguardSwitchedLabel = (label: string): string => `Continuing with ${label}.`;

export const safeguardCardLabel = (card: Pick<SafeguardCard, "state"> & { label?: string }): string | null =>
  card.state === "removed"
    ? null
    : card.state === "cleared"
      ? SAFEGUARD_CLEARED_LABEL
      : safeguardSwitchedLabel(card.label ?? "another model");

type RemovedSpan = { fromSeq: number; toSeq: number; cardSeq: number };

const removedSpans = (records: readonly { seq: number; kind: string; card?: unknown }[]): RemovedSpan[] => {
  const spans: RemovedSpan[] = [];
  for (const record of records) {
    if (record.kind !== "card") continue;
    const card = parseSafeguardCard(record.card);
    if (card?.state === "removed") spans.push({ fromSeq: card.fromSeq, toSeq: card.toSeq, cardSeq: record.seq });
  }
  return spans;
};

const inRemovedSpan = (spans: readonly RemovedSpan[], record: { seq: number; kind: string }): boolean =>
  (record.kind === "message" || record.kind === "turn") &&
  spans.some((span) => record.seq >= span.fromSeq && record.seq <= span.toSeq);

export const withoutSafeguardRemoved = <Record extends { seq: number; kind: string; card?: unknown }>(
  records: readonly Record[],
): readonly Record[] => {
  const spans = removedSpans(records);
  if (spans.length === 0) return records;
  return records.filter(
    (record) => !spans.some((span) => record.seq === span.cardSeq) && !inRemovedSpan(spans, record),
  );
};

export const safeguardRemovedClientMsgIds = (
  records: readonly { seq: number; kind: string; card?: unknown; role?: string; clientMsgId?: string }[],
): ReadonlySet<string> => {
  const spans = removedSpans(records);
  const ids = new Set<string>();
  if (spans.length === 0) return ids;
  for (const record of records) {
    if (record.role === "user" && record.clientMsgId && inRemovedSpan(spans, record)) ids.add(record.clientMsgId);
  }
  return ids;
};

export const SAFEGUARD_TERMINAL_NOTICE = "The model's safety system stopped this reply.";

export const safeguardTaskFailure = (model: string | undefined): string =>
  `${model ? `${model}'s` : "The model's"} safety system stopped this task's reply, so the task ended. Its instructions or something it read set that off; retrying it unchanged will stop the same way. Start it again with reworded instructions or on another model.`;

const REMOVED_NOTICE_OPEN = "<system-reminder>\nMessages were removed from this conversation here at the user's request";

export const SAFEGUARD_REMOVED_CONTEXT_NOTICE = `${REMOVED_NOTICE_OPEN}; you can no longer see them. Work started in them (tasks, file changes) may still exist and may report back later. Carry on from the user's next message without asking what was removed.\n</system-reminder>`;

export const SAFEGUARD_CLEARED_CONTEXT_NOTICE =
  "<system-reminder>\nThe user started this conversation's context over: everything before this point was removed from what you can see, without a summary. Search the conversation's history only if the user asks about something earlier.\n</system-reminder>";

export const SAFEGUARD_UNSUMMARIZED_CONTEXT_NOTICE =
  "No summary of the earlier conversation is available: the model's safety system stopped the summary, so that part was dropped from what you can see. Only the recent part follows. Search the conversation's history only if the user asks about something earlier.";

export const isSafeguardRemovedContextNotice = (text: string): boolean => text.startsWith(REMOVED_NOTICE_OPEN);

export const SAFEGUARD_CONTINUE_PROMPT =
  "The model that was answering stopped before it finished, and the user chose to continue on this one. Carry on with the user's last request from where it stopped.";

export const SAFEGUARD_TEST_TRIGGER = /\bstella-test-safeguard-block(?::([a-z0-9.-]+))?\b/i;
