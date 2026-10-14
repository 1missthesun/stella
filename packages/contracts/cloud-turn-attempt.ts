export const CLOUD_TURN_ATTEMPT_ANCHOR = "/workspace/.stella-turn-attempts";

const ATTEMPT_DIRECTORY_PATTERN =
  /^\/workspace\/\.stella-turn-attempts\/[0-9a-f]{64}-[1-9][0-9]{0,15}$/u;

export type CloudTurnAttemptPaths = {
  directory: string;
  input: string;
  result: string;
  inbox: string;
};

const pathsFor = (directory: string): CloudTurnAttemptPaths => ({
  directory,
  input: `${directory}/turn-input.json`,
  result: `${directory}/result.json`,
  inbox: `${directory}/inbox`,
});

export const CLOUD_TURN_INBOX_MESSAGE_PATTERN =
  /^([0-9]{16})-([0-9a-f]{64})\.json$/u;

export const cloudTurnInboxMessageName = (
  receivedAt: number,
  messageIdHash: string,
): string => {
  if (!/^[0-9a-f]{64}$/u.test(messageIdHash)) {
    throw new Error("Inbox message id hash is invalid.");
  }
  return `${String(Math.max(0, Math.floor(receivedAt))).padStart(16, "0")}-${messageIdHash}.json`;
};

export const cloudTurnAttemptPaths = (
  threadHash: string,
  attemptGeneration: number,
): CloudTurnAttemptPaths => {
  if (!/^[0-9a-f]{64}$/u.test(threadHash)) {
    throw new Error("Turn attempt thread hash is invalid.");
  }
  if (!Number.isSafeInteger(attemptGeneration) || attemptGeneration < 1) {
    throw new Error("Turn attempt generation is invalid.");
  }
  return pathsFor(
    `${CLOUD_TURN_ATTEMPT_ANCHOR}/${threadHash}-${attemptGeneration}`,
  );
};

export const parseCloudTurnAttemptDirectory = (
  directory: string | undefined,
): CloudTurnAttemptPaths | null =>
  directory && ATTEMPT_DIRECTORY_PATTERN.test(directory)
    ? pathsFor(directory)
    : null;

export const CLOUD_TURN_ATTEMPT_DIRECTORY_FLAG = "--attempt-dir";
