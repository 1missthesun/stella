/**
 * Mid-call updates from the conversation the call belongs to.
 *
 * The conversation's pi transcript holds every turn, in either storage mode,
 * and the call watches it. Output is deliberately small: new text turns and
 * finished agent work, tagged as something to SAY or something to merely KNOW. The session layer turns
 * those into `session.commentary.append` / `session.thinking.append`.
 */

import { legacyReportStatus } from "@stella/contracts/agent-status";
import {
  isPiAgentInput,
  isPiScheduledInput,
  PI_REPORT_RE,
  piMessageText,
  piUserView,
  type PiEntry,
  type PiUserMessage,
} from "@stella/contracts/pi-chat";
import { splitReplyRefs } from "@stella/contracts/reply-refs";

/** `say`: worth speaking. `note`: context only, never announced. */
export type ConversationUpdateKind = "say" | "note";

export type ConversationUpdate = {
  /** Stable per source row, so a replay cannot re-announce it. */
  id: string;
  kind: ConversationUpdateKind;
  text: string;
};

export type ConversationUpdateFeed = {
  /**
   * Adopt everything already present as known, without emitting. Called once
   * before the call goes live so the opening history is not narrated.
   */
  prime: () => Promise<void>;
  start: () => void;
  stop: () => void;
};

// ---------------------------------------------------------------------------
// Shared mapping
// ---------------------------------------------------------------------------

const agentCompletedUpdate = (result: string): string =>
  `A delegated agent finished. ${
    result || "The work is done."
  } Tell the user the outcome if they have not already heard it.`;

const agentFailedUpdate = (verb: string, error: string): string =>
  `A delegated agent ${verb}. ${
    error || "No reason was given."
  } Tell the user briefly.`;

const textTurnNote = (speaker: string, text: string): string =>
  `${speaker} in the text chat: ${text}`;

// ---------------------------------------------------------------------------
// pi-durable source
// ---------------------------------------------------------------------------

/**
 * A conversation on pi-durable: its transcript, in either storage mode (a
 * cloud one's other turns are imported into it). Text turns are notes; an
 * agent's report reaching Stella is something to say. What the call itself
 * said, and the turns it handed to Stella, stay out.
 */
const createPiFeed = (args: {
  conversationId: string;
  onUpdate: (update: ConversationUpdate) => void;
}): ConversationUpdateFeed => {
  const api = () => window.electronAPI?.piChat;
  const seen = new Set<number>();
  /** Whether the turn the next replies belong to is one nobody typed. */
  let hiddenTurn = false;
  let emitting = false;
  let watching = false;
  let unsubscribe: (() => void) | null = null;

  const reportUpdate = (entry: PiEntry, text: string): ConversationUpdate => {
    const outcome = legacyReportStatus(text);
    const body =
      /\n(?:result|error): ([\s\S]*?)(?=\n(?:agent_state|routing|presentation): |$)/.exec(text)?.[1]?.trim() ?? "";
    return {
      id: `pi:${entry.id}`,
      kind: "say",
      text:
        outcome === "completed"
          ? agentCompletedUpdate(body)
          : agentFailedUpdate(
              outcome === "canceled" ? "was canceled" : outcome === "paused" ? "was paused" : "failed",
              body,
            ),
    };
  };

  const take = (entry: PiEntry) => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    const message = entry.model?.[0];
    if (!message) return;
    let update: ConversationUpdate | null = null;
    if (entry.kind === "pi.user" && message.role === "user") {
      const user = message as PiUserMessage;
      const text = piMessageText(user).trimStart();
      if (PI_REPORT_RE.test(text)) {
        hiddenTurn = false;
        update = reportUpdate(entry, text);
      } else if (isPiAgentInput(user) || isPiScheduledInput(user)) {
        // A note an agent sent Stella, or a schedule's prompt: nothing to say, but Stella's answer to it is relayed.
        hiddenTurn = false;
      } else {
        const typed = piUserView(user).text.trim();
        hiddenTurn = !typed || user.source === "voice";
        if (!hiddenTurn) update = { id: `pi:${entry.id}`, kind: "note", text: textTurnNote("The user typed", typed) };
      }
    } else if (entry.kind === "pi.assistant" && message.role === "assistant") {
      if (hiddenTurn || message.stella?.hidden || message.source === "voice") return;
      const text = splitReplyRefs(piMessageText(message)).text.trim();
      if (text) update = { id: `pi:${entry.id}`, kind: "note", text: textTurnNote("Stella replied", text) };
    }
    if (update && emitting) args.onUpdate(update);
  };

  const watch = async () => {
    const chat = api();
    if (!chat || watching) return;
    watching = true;
    unsubscribe = chat.onEvents(({ conversationId, events }) => {
      if (conversationId !== args.conversationId) return;
      for (const event of events) {
        if (event.type === "message_end" || event.type === "entry_appended") take(event.entry);
        else if (event.type === "snapshot") for (const entry of event.entries) take(entry);
      }
    });
    const result = (await chat.request({ op: "watch", conversationId: args.conversationId })) as {
      snapshot: { entries: PiEntry[] };
    };
    for (const entry of result.snapshot.entries) take(entry);
  };

  return {
    prime: () =>
      watch().catch((err) => {
        console.debug("[voice-updates] pi conversation unavailable:", (err as Error).message);
      }),
    start: () => {
      emitting = true;
      void watch().catch(() => undefined);
    },
    stop: () => {
      emitting = false;
      unsubscribe?.();
      unsubscribe = null;
      if (watching) {
        watching = false;
        void api()?.request({ op: "unwatch", conversationId: args.conversationId }).catch(() => undefined);
      }
      seen.clear();
    },
  };
};

// ---------------------------------------------------------------------------

/**
 * One feed for the conversation the call is attached to, picking the source
 * the conversation is actually stored in.
 */
export const createConversationUpdateFeed = (args: {
  conversationId: string;
  onUpdate: (update: ConversationUpdate) => void;
}): ConversationUpdateFeed => {
  // The transcript holds every turn, in either storage mode.
  return createPiFeed(args);
};
