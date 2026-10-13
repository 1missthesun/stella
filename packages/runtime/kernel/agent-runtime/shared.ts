import fs from "fs";
import os from "os";
import path from "path";
import { getLocalCliWorkingDirectory } from "@stella/contracts/agent-runtime";

const expandWorkingDirectory = (
  value: string,
  homeDirectory: string,
): string => {
  if (value === "~") return homeDirectory;
  if (value.startsWith(`~${path.sep}`) || value.startsWith("~/")) {
    return path.join(homeDirectory, value.slice(2));
  }
  return value;
};

const isDirectory = (value: string): boolean => {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Resolve the filesystem root an agent should operate from: the folder its
 * brief names, else its definition's default (`stella-home` is Stella's data
 * folder, `frontend` the app checkout), else the user's home. Both defaults
 * apply only when the folder is a real directory.
 */
export const resolveAgentWorkingDirectory = ({
  agentType,
  stellaAppDir,
  stellaDataDir,
  workingDirectory,
}: {
  agentType: string;
  stellaAppDir?: string;
  stellaDataDir?: string;
  workingDirectory?: string;
}): string | undefined => {
  const homeDirectory = os.homedir().trim();
  const explicitWorkingDirectory = workingDirectory?.trim();
  if (explicitWorkingDirectory) {
    return path.resolve(
      expandWorkingDirectory(explicitWorkingDirectory, homeDirectory),
    );
  }
  const preferred = getLocalCliWorkingDirectory(agentType);
  const defaultDirectory =
    preferred === "stella-home"
      ? stellaDataDir?.trim()
      : preferred === "frontend"
        ? stellaAppDir?.trim()
        : undefined;
  if (defaultDirectory && isDirectory(defaultDirectory)) {
    return path.resolve(defaultDirectory);
  }
  if (homeDirectory) return path.resolve(homeDirectory);
  return undefined;
};

export const textFromUnknown = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

