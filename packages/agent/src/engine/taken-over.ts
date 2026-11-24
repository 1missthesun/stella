/**
 * The user's next message took over what the main chat was doing: the step in
 * flight ends so that message is read now. Unlike Stop, the conversation goes
 * straight on, so an engine may keep its process for the next step.
 */
export class TakenOver extends Error {
  override readonly name = "TakenOver";
  constructor() {
    super("The user sent a new message.");
  }
}

export const isTakenOver = (reason: unknown): reason is TakenOver => reason instanceof TakenOver;

const LIMIT = 256;
const cut = new Set<string>();

/** This running tool call was ended early for the user's next message. */
export const noteCutCall = (callId: string): void => {
  cut.add(callId);
  while (cut.size > LIMIT) {
    const oldest = cut.values().next().value;
    if (oldest === undefined) break;
    cut.delete(oldest);
  }
};

export const isCutCall = (callId: string): boolean => cut.has(callId);

export const takeCutCall = (callId: string): boolean => cut.delete(callId);
