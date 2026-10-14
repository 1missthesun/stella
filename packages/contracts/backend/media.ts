import type { MediaModelKind } from "../media-models.js";

export type MediaJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export type MediaJobError = {
  message: string;
  code?: string;
  details?: Record<string, unknown>;
};

export type MediaGenerateRequest = {
  model: string;
  input: Record<string, unknown>;
  clientRequestKey?: string;
  requestHash?: string;
};

export type MediaGenerateAccepted = {
  jobId: string;
  model: string;
  status: MediaJobStatus;
  reattached?: boolean;
  output?: unknown;
};

export type MediaJob = {
  jobId: string;
  model: string;
  kind: MediaModelKind;
  status: MediaJobStatus;
  input: Record<string, unknown>;
  output?: unknown;
  error?: MediaJobError;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

export type MediaModelListing = {
  id: string;
  name: string;
  kind: MediaModelKind;
  does: string;
  docsUrl: string;
};

export type MediaCalls = {
  "media.models": {
    args: Record<string, never>;
    result: { data: MediaModelListing[]; docsUrl: string };
  };
  "media.generate": {
    args: MediaGenerateRequest;
    result: MediaGenerateAccepted;
  };
  "media.cancel": {
    args: { jobId?: string; clientRequestKey?: string };
    result: { state: "canceled" | "terminal" | "not_found"; jobId?: string };
  };
};

export type MediaViews = {
  "media.job": {
    args: { jobId: string };
    result: MediaJob | null;
  };
  "media.jobs": {
    args: { since: number; status?: MediaJobStatus; limit?: number };
    result: MediaJob[];
  };
};
