/**
 * Catch-ups: short summaries of a busy stretch of a conversation (what got
 * done, what is still running, what waits on the user), made on request by a
 * small model in the cloud and kept per conversation so every device scrolls
 * the same history.
 */

/** A message a catch-up line came from, as the chat timelines key it. */
export type CatchUpLink = {
  role: "user" | "assistant";
  /**
   * The ids the message may go by in a client's timeline, most specific
   * first (a placed prompt's origin id, its client id, then the journal id).
   */
  messageIds: string[];
  seq: number;
  at: number;
};

export type CatchUpItem = {
  text: string;
  links: CatchUpLink[];
};

export type CatchUpState = "pending" | "ready" | "failed";

export type CatchUp = {
  catchUpId: string;
  conversationId: string;
  createdAt: number;
  state: CatchUpState;
  /** The newest message it covers. */
  throughAt?: number;
  throughSeq?: number;
  /** How many of Stella's messages it covers that no earlier catch-up did. */
  newMessages?: number;
  done: CatchUpItem[];
  ongoing: CatchUpItem[];
  waiting: CatchUpItem[];
  error?: string;
};

export type CatchUpList = { catchUps: CatchUp[] };

export type CatchUpCalls = {
  /**
   * Summarize what is new since the conversation's last catch-up. Answers at
   * once with the pending entry; the list view fills it in.
   */
  "catchUps.request": {
    args: { conversationId: string };
    result: { catchUpId: string };
  };
};

export type CatchUpViews = {
  /** The conversation's catch-ups, oldest first. */
  "catchUps.list": { args: { conversationId: string }; result: CatchUpList };
};
