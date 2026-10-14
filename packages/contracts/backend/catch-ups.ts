export type CatchUpLink = {
  role: "user" | "assistant";
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
  throughAt?: number;
  throughSeq?: number;
  newMessages?: number;
  done: CatchUpItem[];
  ongoing: CatchUpItem[];
  waiting: CatchUpItem[];
  error?: string;
};

export type CatchUpList = { catchUps: CatchUp[] };

export type CatchUpCalls = {
  "catchUps.request": {
    args: { conversationId: string };
    result: { catchUpId: string };
  };
};

export type CatchUpViews = {
  "catchUps.list": { args: { conversationId: string }; result: CatchUpList };
};
