export type TurnTool = { name: string; callId: string | null };

export type TurnRun = { tool: TurnTool | null; answerLanded: boolean };

export type TurnActivity =
  | { kind: "idle" }
  | { kind: "admitting" }
  | { kind: "handing_off" }
  | ({ kind: "running_here" } & TurnRun)
  | ({ kind: "running_elsewhere" } & TurnRun);

export const turnActivity = ({
  admitting,
  handingOff,
  here,
  elsewhere,
}: {
  admitting: boolean;
  handingOff: boolean;
  here: TurnRun | null;
  elsewhere: TurnRun | null;
}): TurnActivity => {
  const run = here
    ? { kind: "running_here" as const, ...here }
    : elsewhere
      ? { kind: "running_elsewhere" as const, ...elsewhere }
      : null;
  if (run) return admitting ? { ...run, answerLanded: false } : run;
  if (admitting) return { kind: "admitting" };
  if (handingOff) return { kind: "handing_off" };
  return { kind: "idle" };
};

export const turnActivityBusy = (activity: TurnActivity): boolean => activity.kind !== "idle";

export const turnActivityRun = (activity: TurnActivity): TurnRun | null =>
  activity.kind === "running_here" || activity.kind === "running_elsewhere" ? activity : null;
