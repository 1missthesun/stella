export const APP_RELAUNCHING_EVENT = "stella:relaunching";

export type AppSourceCommit = {
  sha: string;
  subject: string;
  date: number;
  agentId?: string;
  undone?: boolean;
  kind: "version" | "other-computer" | "change";
};

export type AppSourceWaiting =
  | { kind: "version"; key: string; adding: boolean; draft?: string }
  | {
      kind: "other-computer";
      key: string;
      adding: boolean;
      device: string;
      summary: string;
      draft?: string;
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
};

export type AppSourceActionResult =
  | {
      ok: true;
      background?: boolean;
    }
  | { ok: false; error: string };
