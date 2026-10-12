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

export const turnTimings = (): Record<string, number> => ({ ...marks });
