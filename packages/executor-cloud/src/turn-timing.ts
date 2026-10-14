const marks: Record<string, number> = {
  processStart: Math.round(performance.timeOrigin),
};

export const markTurnStep = (name: string): void => {
  if (marks[name] === undefined) marks[name] = Date.now();
};

export const turnTimings = (): Record<string, number> => ({ ...marks });
