import { createHash, randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { BackendClient } from "@stella/contracts/backend/client";
import type { ScheduleRow } from "@stella/contracts/backend/schedules";
import {
  cronJobOfScheduleRow as toCronJob,
  scheduleKindOf as kindFor,
  schedulePromptOf as promptFor,
  scheduleUpdateArgsOf,
  scheduleWatchFieldsOf as watchFields,
} from "@stella/contracts/schedule-records";
import type {
  LocalCronJobCreateInput,
  LocalCronJobRecord,
  LocalCronJobUpdatePatch,
} from "@stella/contracts/scheduling";

export const isCloudScheduleId = (id: string): boolean => id.startsWith("sch-");

export const isCloudSchedulePayload = (
  payload: LocalCronJobCreateInput["payload"],
): boolean =>
  payload.kind === "notify" ||
  payload.kind === "task" ||
  (payload.kind === "watch" && Boolean(payload.script) && !payload.scriptPath);

const LIST_TIMEOUT_MS = 15_000;

const requestIdFor = (...parts: unknown[]): string =>
  `desk-${createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 40)}`;

const readSchedules = async (client: BackendClient): Promise<ScheduleRow[]> => {
  let unsubscribe: (() => void) | undefined;
  try {
    return await Effect.runPromise(
      Effect.callback<ScheduleRow[], Error>((resume) => {
        unsubscribe = client.watch(
          "schedules.list",
          {},
          (rows) => resume(Effect.succeed(rows)),
          (error) => resume(Effect.fail(error)),
        );
      }).pipe(
        Effect.timeoutOrElse({
          duration: LIST_TIMEOUT_MS,
          orElse: () => Effect.fail(new Error("Schedules took too long to load.")),
        }),
      ),
    );
  } finally {
    unsubscribe?.();
  }
};

export type CloudSchedules = ReturnType<typeof createCloudSchedules>;

export const createCloudSchedules = (options: {
  getClient: () => BackendClient | null;
  getDeviceId: () => string | undefined;
}) => {
  const client = (): BackendClient => {
    const backend = options.getClient();
    if (!backend) {
      throw new Error("Sign in to Stella to use schedules.");
    }
    return backend;
  };

  const list = async (): Promise<LocalCronJobRecord[]> => {
    const backend = options.getClient();
    if (!backend) return [];
    return (await readSchedules(backend)).map(toCronJob);
  };

  const add = async (
    input: LocalCronJobCreateInput,
  ): Promise<LocalCronJobRecord> => {
    const prompt = promptFor(input.payload);
    const deviceId = options.getDeviceId();
    const description = input.name || input.description;
    const row = await client().call("schedules.create", {
      requestId: `desk-${randomUUID()}`,
      kind: kindFor(input.payload),
      ...watchFields(input.payload),
      prompt,
      schedule: input.schedule,
      ...(description ? { description } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(deviceId ? { targetDeviceId: deviceId } : {}),
    });
    if (input.enabled === false) {
      return (await update(row.scheduleId, { enabled: false })) ?? toCronJob(row);
    }
    return toCronJob(row);
  };

  const update = async (
    jobId: string,
    patch: LocalCronJobUpdatePatch,
  ): Promise<LocalCronJobRecord | null> => {
    const args = scheduleUpdateArgsOf(jobId, patch);
    const row = await client().call("schedules.update", {
      requestId: requestIdFor("update", args, Date.now()),
      ...args,
    });
    return toCronJob(row);
  };

  const remove = async (jobId: string): Promise<boolean> => {
    await client().call("schedules.remove", {
      requestId: requestIdFor("remove", jobId),
      scheduleId: jobId,
    });
    return true;
  };

  const runNow = async (jobId: string): Promise<boolean> => {
    await client().call("schedules.runNow", { scheduleId: jobId });
    return true;
  };

  const subscribe = (onChange: () => void): (() => void) => {
    const backend = options.getClient();
    if (!backend) return () => {};
    return backend.watch("schedules.list", {}, () => {
      onChange();
    });
  };

  return { list, add, update, remove, runNow, subscribe };
};
