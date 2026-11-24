const STEP_NAME = /^[A-Za-z]{1,64}$/u;

const marks: Record<string, number> = {
  processStart: Math.round(performance.timeOrigin),
};

export const markTurnStep = (name: string): void => {
  if (STEP_NAME.test(name) && marks[name] === undefined) marks[name] = Date.now();
};

export const turnTimings = (): Record<string, number> => ({ ...marks });
