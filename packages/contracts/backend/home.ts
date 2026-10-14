import type { CloudSkillHead, CloudSkillMirrorDeletion } from "../cloud-home-sync.js";
import type { MemoryPolicy } from "../turn-plane/memory-policy.js";

export type MemoryLifecycleState = "open" | "wiping";

export type MemoryImportDisposition =
  | "automatic_allowed"
  | "explicit_required"
  | "explicit_allowed";

export type MemoryWipeStage = "sweeping" | "metadata" | "releasing" | "completed";

export type MemoryWipeJob = {
  operationId: string;
  stage: MemoryWipeStage;
  attempts: number;
  nextRetryAt: number;
  lastErrorCode?: string;
  objectsDeleted: number;
  rowsDeleted: number;
  completedAt?: number;
  updatedAt: number;
};

export type MemoryWipeStatus = {
  subject: string;
  ownerGeneration: string;
  state: MemoryLifecycleState;
  memoryEpoch: string;
  importDisposition: MemoryImportDisposition;
  lastWipedEpoch?: string;
  job: MemoryWipeJob | null;
};

export type MemoryPreference = MemoryPolicy & {
  subject: string;
  state: MemoryLifecycleState;
  importDisposition: MemoryImportDisposition;
  lastWipedEpoch?: string;
};

export type SkillMirrorDeletion = CloudSkillMirrorDeletion & {
  skillId: string;
  revision: number;
};

type MemoryEpochRequest = {
  requestId: string;
  expectedOwnerGeneration: string;
  expectedMemoryEpoch: string;
};

export type MemorySyncFile = {
  path: string;
  size: number;
  sha: string;
  updatedAt: number;
};

export type MemorySyncListing = {
  memoryEpoch: string;
  importDisposition: MemoryImportDisposition;
  files: MemorySyncFile[];
};

type MemorySyncFenced = {
  expectedMemoryEpoch: string;
};

export type HomeCalls = {
  "memory.setEnabled": {
    args: {
      requestId: string;
      memoryEnabled: boolean;
      expectedRevision: number;
      expectedOwnerGeneration: string;
    };
    result: MemoryPreference;
  };
  "memory.startWipe": { args: MemoryEpochRequest; result: MemoryWipeStatus };
  "memory.authorizeReimport": { args: MemoryEpochRequest; result: MemoryWipeStatus };
  "memory.files.list": { args: Record<string, never>; result: MemorySyncListing };
  "memory.files.read": {
    args: MemorySyncFenced & { path: string };
    result: { content: string; sha: string } | null;
  };
  "memory.files.write": {
    args: MemorySyncFenced & {
      path: string;
      content: string;
      expectSha: string | null;
      importing: boolean;
    };
    result:
      | { status: "written"; sha: string; bytes: number }
      | { status: "conflict"; actualSha: string | null };
  };
  "memory.files.delete": {
    args: MemorySyncFenced & { path: string; expectSha: string };
    result:
      | { status: "deleted" | "missing" }
      | { status: "conflict"; actualSha: string | null };
  };
  "skills.deleteMirrored": {
    args: { clientScope: string; slug: string; expectedRevision: number };
    result: SkillMirrorDeletion;
  };
};

export type HomeViews = {
  "memory.preference": { args: Record<string, never>; result: MemoryPreference };
  "memory.wipeStatus": { args: Record<string, never>; result: MemoryWipeStatus };
  "skills.heads": { args: { clientScope: string }; result: CloudSkillHead[] };
};
