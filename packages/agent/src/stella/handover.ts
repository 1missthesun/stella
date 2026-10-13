/**
 * Handing a conversation to another engine or model. The conversation's
 * journal is its one history, whichever engine wrote it; the incoming model
 * starts from it (the resident context, the latest compaction summary, then
 * everything after it). When that is more than the incoming model's window
 * holds, the outgoing model compacts first, while the conversation is still
 * its own, down to fit with headroom: the incoming model can't summarize
 * what it can't read.
 *
 * Should that compaction fail three times, the recent part that fits stays
 * and a compaction boundary marked `truncated` drops the rest, telling the
 * incoming model that older context is gone unsummarized. Either way the
 * journal only grows.
 */
import type { Context } from "@earendil-works/chord";
import type { Message } from "@earendil-works/pi-ai";
import { estimateMessageTokens } from "@earendil-works/pi-ai/utils/estimate";
import { CompactionEntry, type ContextView, type Conversation, type Harness } from "@earendil-works/pi-durable";

/** The share of the incoming window the handed-over context may fill, before the reply's reserve. */
const HEADROOM = 0.8;
const REPLY_RESERVE_TOKENS = 16_384;
const COMPACTION_ATTEMPTS = 3;

export const TRUNCATED_CONTEXT_NOTICE =
  "Older context before this point was dropped without a summary: the conversation moved to a model whose context window could not hold it, and summarizing it failed. Only the recent part follows. Search the conversation's history for anything earlier.";

/** How pi opens a summary it placed (pi-durable `harness/compaction`). */
const PI_SUMMARY_PREFIX = "The conversation history before this point was compacted into the following summary:";

/**
 * Whether `message` opens a context pi compacted or truncated itself (an
 * engine's own compaction is recorded in that engine's words instead).
 */
export const isPiCompactionBoundary = (message: Message): boolean => {
  if (message.role !== "user") return false;
  const text =
    typeof message.content === "string"
      ? message.content
      : message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
  return text.startsWith(PI_SUMMARY_PREFIX) || text.startsWith(TRUNCATED_CONTEXT_NOTICE);
};

export type HandoverFit = { fit: "fits" | "compacted" | "truncated"; window: number; budget: number; tokens: number; attempts: number };

const contextTokens = (messages: readonly Message[]): number =>
  messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);

/** The most context, in tokens, a model with `window` is handed. */
export const handoverBudget = (window: number): number => Math.max(0, Math.floor(window * HEADROOM) - REPLY_RESERVE_TOKENS);

const compactionInstructions = (budget: number) =>
  `The conversation is moving to a model whose context window is smaller. Keep the summary well under ${Math.floor(budget / 2)} tokens, and keep every fact, decision, name, path, number and open task the work still needs.`;

/** The first entry of the newest run of whole turns, from a prompt on, that fits `budget`; else the last prompt's. */
const truncationHead = (view: ContextView, budget: number): number | undefined => {
  const start = view.head === undefined ? 0 : 1;
  const opensTurn = (index: number) => view.contributions[index]?.[0]?.role === "user";
  let kept = 0;
  let head: number | undefined;
  let last: number | undefined;
  for (let index = view.entries.length - 1; index >= start; index -= 1) {
    if (last === undefined && opensTurn(index)) last = index;
    kept += contextTokens(view.contributions[index] ?? []);
    if (kept > budget) break;
    if (opensTurn(index)) head = index;
  }
  return head ?? last;
};

/**
 * Make `conversation` fit a model with a context window of `window` tokens
 * before it takes over. Run while the outgoing model is still configured:
 * `Conversation.compact()` summarizes with the conversation's own model.
 */
export async function fitForHandover(args: {
  harness: Harness;
  conversation: Conversation;
  window: number;
  context: Context;
  report: (error: unknown) => void;
}): Promise<HandoverFit> {
  const { harness, conversation, window, context } = args;
  const budget = handoverBudget(window);
  let tokens = 0;
  const fits = async () => {
    tokens = contextTokens((await conversation.context(context)).messages);
    return tokens <= budget;
  };
  if (!(window > 0) || (await fits())) return { fit: "fits", window, budget, tokens, attempts: 0 };
  for (let attempt = 1; attempt <= COMPACTION_ATTEMPTS; attempt += 1) {
    try {
      const task = await conversation.compact(compactionInstructions(budget), context);
      const settled = await harness.waitForTask(task, context);
      const outcome = settled.state.outcome;
      if (outcome.status === "completed" && outcome.result.submissionId !== undefined) {
        await (await harness.submission(outcome.result.submissionId, context))?.wait(context);
      }
      if (outcome.status === "completed" && (outcome.result.entryId !== undefined || outcome.result.submissionId !== undefined)) {
        if (await fits()) return { fit: "compacted", window, budget, tokens, attempts: attempt };
      } else if (outcome.status === "failed") {
        args.report(new Error(`Handover compaction failed (attempt ${attempt}): ${outcome.error.message}`));
      }
    } catch (error) {
      if (context.abortSignal?.aborted) throw error;
      args.report(error);
    }
  }
  const view = await conversation.context(context);
  const head = truncationHead(view, budget);
  const entry = head === undefined ? undefined : view.entries[head];
  if (entry === undefined) return { fit: "fits", window, budget, tokens, attempts: COMPACTION_ATTEMPTS };
  const submission = await conversation.submit(
    {
      type: "write",
      requestId: `handover-truncation:${entry.id}:${window}`,
      entry: {
        kind: CompactionEntry.kind,
        head: entry.id,
        model: [{ role: "user", content: [{ type: "text", text: TRUNCATED_CONTEXT_NOTICE }], timestamp: Date.now() }],
        data: { reason: "threshold", truncated: true },
      },
    },
    context,
  );
  await submission.wait(context);
  await fits();
  return { fit: "truncated", window, budget, tokens, attempts: COMPACTION_ATTEMPTS };
}
