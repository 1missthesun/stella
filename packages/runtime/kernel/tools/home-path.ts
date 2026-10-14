import os from "node:os";
import path from "node:path";

export const resolveHomeRelative = (candidate: string): string => {
  const expanded = candidate.replace(/^~(?=$|[\\/])/, os.homedir());
  return path.resolve(expanded);
};
