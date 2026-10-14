export type JournalCheckpoint = {
  summary: string;
  throughSeq: number;
};

export type JournalCheckpointFirstKept = { seq: number } | { turnId: string } | { localTurnId: string };

export type JournalCheckpointPublish = {
  expectedOwnerGeneration: string;
  deviceId?: string;
  summary: string;
  firstKept: JournalCheckpointFirstKept;
};

export const JOURNAL_CHECKPOINT_PATH = "/checkpoint";
export const JOURNAL_CHECKPOINT_SUMMARY_MAX_BYTES = 256 * 1024;

export const parseJournalCheckpoint = (value: unknown): JournalCheckpoint | undefined => {
  const candidate = value as Partial<JournalCheckpoint> | null | undefined;
  return candidate &&
    typeof candidate.summary === "string" &&
    candidate.summary.length > 0 &&
    typeof candidate.throughSeq === "number" &&
    Number.isInteger(candidate.throughSeq) &&
    candidate.throughSeq >= 0
    ? { summary: candidate.summary, throughSeq: candidate.throughSeq }
    : undefined;
};

export const parseJournalCheckpointFirstKept = (value: unknown): JournalCheckpointFirstKept | undefined => {
  const candidate = value as { seq?: unknown; turnId?: unknown; localTurnId?: unknown } | null | undefined;
  if (typeof candidate?.seq === "number" && Number.isInteger(candidate.seq) && candidate.seq >= 0) {
    return { seq: candidate.seq };
  }
  if (typeof candidate?.turnId === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(candidate.turnId)) {
    return { turnId: candidate.turnId };
  }
  if (typeof candidate?.localTurnId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate.localTurnId)) {
    return { localTurnId: candidate.localTurnId };
  }
  return undefined;
};
