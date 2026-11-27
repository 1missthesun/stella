// A cloud task's `view` tool hands each version of a view to its turn broker, which puts it into
// the user's chat as a view card (`@stella/contracts/view-card`).
export const CLOUD_VIEW_PATH = "/api/cloud/view";

export type CloudViewRequest = {
  turnId: string;
  filePath: string;
  slug: string;
  title: string;
  source: string;
  data?: unknown;
  createdAt: number;
};

export type CloudViewResponse = { ok: true; posted: boolean } | { ok: false; error: string };
