/**
 * A model's safety system stopping a reply: the provider ends the response
 * with a refusal stop instead of the model writing an answer. It is not a
 * decline the model reasons out in its own words (that is an ordinary
 * reply), and not an ordinary request error.
 *
 * A conversation is reused forever, so what tripped the block must be able to
 * leave the model's context: the blocked turn ends `failed` with
 * `SafeguardBlockInfo`, and a `SafeguardCard` records what the user chose.
 */

/** Provider stop reasons that mean the safety system ended the response. */
const BLOCK_STOP_REASONS: ReadonlySet<string> = new Set(["refusal", "sensitive", "content_filter"]);

/**
 * Error text of a block from hosts that only relay a string: pi-ai's wording
 * for Anthropic `refusal` / `sensitive` and OpenAI-style `content_filter`
 * stops, the Claude Code CLI's refusal error, and Anthropic's policy errors.
 */
const BLOCK_TEXT =
  /the model refused to complete the request|provider stopped with: sensitive|finish_reason: content_filter|unable to respond to this request|violate our usage policy|blocked by content filtering policy|stop_reason "?refusal"?|safety system stopped the reply/i;

const BLOCK_MARK = /^\s*\[[a-z-]+\/safeguard-block\]\s*/;

export const SAFEGUARD_BLOCK_ERROR_CODE = "safeguard-block";

/** Marks an engine's error text as a block, the way other engine errors are marked. */
export const markSafeguardBlock = (engine: string, message: string): string =>
  BLOCK_MARK.test(message) ? message : `[${engine}/${SAFEGUARD_BLOCK_ERROR_CODE}] ${message}`;

export const isSafeguardBlockText = (text: string | null | undefined): boolean =>
  Boolean(text) && (BLOCK_MARK.test(text!) || BLOCK_TEXT.test(text!));

/** Whether a failed model response is a safety block. */
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

/** "Fable 5.2" for `claude-fable-5-2`, "Fable" for the alias `fable`; undefined for anything else. */
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

/** Whether a model id or label names an Opus model, the one a block on another Claude model can switch to. */
export const isOpusModel = (...ids: Array<string | undefined>): boolean => ids.some((id) => /\bopus/i.test(id ?? ""));

/** A model the conversation can switch to, as its host names it. */
export type SafeguardSwitch = { pick: string; label: string };

/** What a blocked turn's terminal record says about the block. */
export type SafeguardBlockInfo = {
  /** The model that blocked, as shown to the user. */
  model?: string;
  /** Another model on the same host that may answer; absent when none would help. */
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

/**
 * What the user chose on a block, journaled so every host that holds the
 * conversation applies it. `removed`: the messages in `fromSeq..toSeq` (the
 * turns `turnIds`) leave the model's context and every timeline. `cleared`: the model's context
 * starts over after this card. `switched`: the conversation continues on
 * `pick`, set by the host that ran the blocked turn.
 */
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

/** What a conversation's blocks and the choices made on them add up to. */
export type SafeguardFold = {
  /** The block nothing has resolved yet. */
  block?: {
    turnId: string;
    model?: string;
    switchTo?: SafeguardSwitch;
    /** It followed a removal with no reply in between: something earlier is the likely cause. */
    afterRemoval?: true;
  };
  /** Models that blocked since the conversation last got a reply. */
  blockedModels: string[];
  /** The last choice made since the conversation last got a reply. */
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

/** The events one journal record contributes, for clients that read the journal. */
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

/** What the in-chat card shows and offers, the same on every surface. */
export type SafeguardNotice = {
  turnId: string;
  title: string;
  description: string;
  /** Always offered: take the blocked messages out of what the model sees. */
  remove: { label: string };
  /** Offered when another model may answer and has not blocked here already. */
  switchTo?: SafeguardSwitch & { actionLabel: string };
  /** Offered once a removal did not help: start the model's context over. */
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

/**
 * The line the timeline shows where a choice on a block was made. A removal
 * shows none: its messages leaving the timeline is the whole of it.
 */
export const safeguardCardLabel = (card: Pick<SafeguardCard, "state"> & { label?: string }): string | null =>
  card.state === "removed"
    ? null
    : card.state === "cleared"
      ? SAFEGUARD_CLEARED_LABEL
      : safeguardSwitchedLabel(card.label ?? "another model");

/**
 * The records a timeline shows: without the messages a removal took out, the
 * outcomes of their turns, and the removal's own card. Returns `records`
 * itself when nothing was removed.
 */
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

/** The client message ids of the prompts a removal took out, for a client that still holds its own copy of one. */
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

/** The failed turn's notice, for clients that only show a turn's text. */
export const SAFEGUARD_TERMINAL_NOTICE = "The model's safety system stopped this reply.";

/** What a task's failure says when a block ended it. */
export const safeguardTaskFailure = (model: string | undefined): string =>
  `${model ? `${model}'s` : "The model's"} safety system stopped this task's reply, so the task ended. Its instructions or something it read set that off; retrying it unchanged will stop the same way. Start it again with reworded instructions or on another model.`;

const REMOVED_NOTICE_OPEN = "<system-reminder>\nMessages were removed from this conversation here at the user's request";

/** What the model reads in place of removed messages. */
export const SAFEGUARD_REMOVED_CONTEXT_NOTICE = `${REMOVED_NOTICE_OPEN}; you can no longer see them. Work started in them (tasks, file changes) may still exist and may report back later. Carry on from the user's next message without asking what was removed.\n</system-reminder>`;

export const SAFEGUARD_CLEARED_CONTEXT_NOTICE =
  "<system-reminder>\nThe user started this conversation's context over: everything before this point was removed from what you can see, without a summary. Search the conversation's history only if the user asks about something earlier.\n</system-reminder>";

/** Stands in for a context summary the safety system stopped. */
export const SAFEGUARD_UNSUMMARIZED_CONTEXT_NOTICE =
  "No summary of the earlier conversation is available: the model's safety system stopped the summary, so that part was dropped from what you can see. Only the recent part follows. Search the conversation's history only if the user asks about something earlier.";

export const isSafeguardRemovedContextNotice = (text: string): boolean => text.startsWith(REMOVED_NOTICE_OPEN);

/** What the conversation is told to do once it continues on another model. */
export const SAFEGUARD_CONTINUE_PROMPT =
  "The model that was answering stopped before it finished, and the user chose to continue on this one. Carry on with the user's last request from where it stopped.";

/** How the hook that simulates a block in test builds is named in a message. */
export const SAFEGUARD_TEST_TRIGGER = /\bstella-test-safeguard-block(?::([a-z0-9.-]+))?\b/i;
