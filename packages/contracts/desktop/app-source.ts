export const APP_RELAUNCHING_EVENT = "stella:relaunching";

export type AppSourceCommit = {
  sha: string;
  subject: string;
  date: number;
  agentId?: string;
  undone?: boolean;
  kind: "version" | "other-computer" | "change";
};

/**
 * A version Stella could not merge with the user's own changes by itself:
 * `allowance` when merging it would spend a Free plan's allowance (so it waits
 * for a click), `unsure` when it tried and was not confident.
 */
export type AppSourceConflicts = { files: string[]; why: "allowance" | "unsure" };

export type AppSourceWaiting =
  | {
      kind: "version";
      key: string;
      adding: boolean;
      draft?: string;
      /** The task drafting or that drafted `draft`. */
      agentId?: string;
      conflicts?: AppSourceConflicts;
    }
  | {
      kind: "other-computer";
      key: string;
      adding: boolean;
      device: string;
      summary: string;
      draft?: string;
      agentId?: string;
    }
  | {
      kind: "draft";
      key: string;
      adding: boolean;
      name: string;
      summary: string;
      sha: string;
      agentId?: string;
      stale: boolean;
      files: number;
      restart: boolean;
      /** Touches only the interface's source, so it is added without a click once it is finished. */
      interfaceOnly: boolean;
      /** Why the windows could not show this change the last time it was added. */
      problem?: string;
    };

export type AppSourceDraftOffer = Extract<AppSourceWaiting, { kind: "draft" }>;

export const isUpdateDraft = (name: string) => /^update-[0-9a-f]{12}$/.test(name);

export const isRemoteMergeDraft = (name: string) => /^merge-[0-9a-f]{12}$/.test(name);

export const isStellaDraft = (name: string) =>
  isUpdateDraft(name) || isRemoteMergeDraft(name);

export type AppSourceState = {
  remote: { status: "none" | "ahead" | "diverged"; count: number };
  upstream: {
    status: "none" | "ahead" | "diverged";
    count: number;
    subject: string;
  };
  /** An agent Stella sent is drafting this merge; nothing else may start until it settles. */
  merging?: { from: "upstream" | "remote" | "draft"; draft: string };
  recent: AppSourceCommit[];
  waiting: AppSourceWaiting[];
  skipped: AppSourceWaiting[];
  busy: boolean;
  /** An update the user asked for waits until their screen recording and its finish card are done. */
  heldForRecording?: boolean;
  /** An update that restarts Stella's runtime waits until she finishes the reply she's in the middle of. */
  heldForReply?: boolean;
  /**
   * The last version that was applied by itself: because the user pressed
   * Update on another computer (`from` names it), or here before it was ready.
   */
  arrived?: {
    sha: string;
    from: string | null;
    date: number;
    undone: boolean;
    /** What Undo (or, once undone, Update) passes to `undo`. */
    flip: string;
  };
};

export type AppSourceActionResult =
  | {
      ok: true;
      background?: boolean;
    }
  | { ok: false; error: string };
