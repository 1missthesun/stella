import path from "node:path";

export const defaultAgentDirectory = (
  dataDir: string,
  threadId: string,
  startedAt: number | Date = new Date(),
): string => {
  const at = new Date(startedAt);
  const day = [at.getFullYear(), at.getMonth() + 1, at.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
  return path.join(
    dataDir,
    "agents",
    day,
    threadId.replace(/[^A-Za-z0-9._-]/g, "_"),
  );
};
