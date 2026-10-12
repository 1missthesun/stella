/**
 * When each step of this executor process happened, as epoch milliseconds,
 * returned with the turn's result so the worker can log where a turn's time
 * went. The first time a step is reached is the one kept.
 */
const marks: Record<string, number> = {
  processStart: Math.round(performance.timeOrigin),
};

export const markTurnStep = (name: string): void => {
  if (marks[name] === undefined) marks[name] = Date.now();
};

/** A step whose time is known from elsewhere (a log line's timestamp). */
export const markTurnStepAt = (name: string, at: number): void => {
  if (marks[name] === undefined && Number.isSafeInteger(at)) marks[name] = at;
};

/** A measured quantity rather than a moment, kept beside the steps. */
export const noteTurnValue = (name: string, value: number): void => {
  if (Number.isSafeInteger(value)) marks[name] = value;
};

export const turnTimings = (): Record<string, number> => ({ ...marks });
