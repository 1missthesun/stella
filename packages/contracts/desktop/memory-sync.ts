export type MemorySyncPhase =
  | "signed_out"
  | "off"
  | "syncing"
  | "synced"
  | "held"
  | "error";

export type MemorySyncStatus = {
  phase: MemorySyncPhase;
  heldReason?: "wiped" | "other_account";
  lastSyncedAt: number | null;
  merging: number;
  refused: string[];
  failure?: MemorySyncFailure;
};

export type MemorySyncFailure = {
  step: "list" | "read" | "write" | "delete" | "local";
  files: string[];
  code: string | null;
  message: string;
  retryAt: number;
};

export type MemorySyncEraseResult = { ok: true } | { ok: false; error: string };
