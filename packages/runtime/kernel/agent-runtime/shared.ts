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
 * Resolve the filesystem root an agent should operate from. The install root
 * remains a separate absolute path for bundled assets; it is only selected
 * here for the legacy `frontend` mode when it is a real directory. Packaged
 * Electron builds expose `app.asar` as the install root, but child-process
 * `cwd` must be a directory, so those builds fall back to the user's home.
 */
export const resolveAgentWorkingDirectory = ({
  agentType,
  stellaAppDir,
  workingDirectory,
}: {
  agentType: string;
  stellaAppDir?: string;
  workingDirectory?: string;
}): string | undefined => {
  const homeDirectory = os.homedir().trim();
  const explicitWorkingDirectory = workingDirectory?.trim();
  if (explicitWorkingDirectory) {
    return path.resolve(
      expandWorkingDirectory(explicitWorkingDirectory, homeDirectory),
    );
  }
  const normalizedStellaAppDir = stellaAppDir?.trim();
  if (
    getLocalCliWorkingDirectory(agentType) === "frontend" &&
    normalizedStellaAppDir &&
    isDirectory(normalizedStellaAppDir)
  ) {
    return normalizedStellaAppDir;
  }
  if (homeDirectory) return path.resolve(homeDirectory);
  return undefined;
};

export const textFromUnknown = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

