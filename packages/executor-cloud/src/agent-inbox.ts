import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { CLOUD_TURN_INBOX_MESSAGE_PATTERN } from "@stella/contracts/cloud-turn-attempt";

export type AgentInbox = {
  take(): Promise<string[]>;
  close(): Promise<string[]>;
  reopen(): Promise<void>;
};

export const openAgentInbox = async (
  directory: string,
): Promise<AgentInbox> => {
  const taken = new Set<string>();
  let closings = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.catch(() => undefined);
    return run;
  };
  const drain = async (from: string): Promise<string[]> => {
    const names = (await readdir(from).catch(() => [] as string[]))
      .filter((name) => CLOUD_TURN_INBOX_MESSAGE_PATTERN.test(name))
      .sort();
    const texts: string[] = [];
    for (const name of names) {
      const file = `${from}/${name}`;
      const raw = await readFile(file, "utf8").catch(() => "");
      await rm(file, { force: true });
      const idHash = CLOUD_TURN_INBOX_MESSAGE_PATTERN.exec(name)![2]!;
      if (taken.has(idHash)) continue;
      taken.add(idHash);
      try {
        const text = (JSON.parse(raw) as { text?: unknown }).text;
        if (typeof text === "string" && text.trim()) texts.push(text);
      } catch {
        // BuildSession writes whole JSON files; anything else is not a message.
      }
    }
    return texts;
  };
  const open = async (): Promise<void> => {
    await mkdir(directory, { mode: 0o700 }).catch((error: unknown) => {
      if ((error as { code?: unknown }).code !== "EEXIST") throw error;
    });
  };
  await open();
  return {
    take: () => serial(() => drain(directory)),
    close: () =>
      serial(async () => {
        closings += 1;
        const closed = `${directory}.closed-${closings}`;
        try {
          await rename(directory, closed);
        } catch {
          return [];
        }
        try {
          return await drain(closed);
        } finally {
          await rm(closed, { recursive: true, force: true });
        }
      }),
    reopen: () => serial(open),
  };
};
