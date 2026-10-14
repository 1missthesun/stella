export const APP_RELAUNCHING_EVENT = "stella:relaunching";

export type AppSourceDraft = {
  name: string;
  subject: string;
  sha: string;
  agentId?: string;
  files: number;
  restart: boolean;
};

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
    }
  | { kind: "draft"; key: string; adding: boolean; name: string; summary: string };

export const isUpdateDraft = (name: string) => name.startsWith("update-");

export const isStellaDraft = isUpdateDraft;

export type AppSourceState = {
  ready: AppSourceDraft[];
  stale: AppSourceDraft[];
  remote: { status: "none" | "ahead" | "diverged"; count: number };
  upstream: {
    status: "none" | "ahead" | "diverged";
    count: number;
    subject: string;
  };
  update?: { state: "merging" | "done" };
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
