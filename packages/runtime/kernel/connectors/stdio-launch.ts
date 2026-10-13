import fs from "node:fs";
import path from "node:path";

export type StdioLaunch = {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
};

const CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/gu;

const envValue = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const keys = Object.keys(env).filter((candidate) => candidate.toLowerCase() === name.toLowerCase());
  const key = keys[keys.length - 1];
  return key ? env[key] : undefined;
};

export const mergeChildEnv = (
  base: NodeJS.ProcessEnv,
  overrides: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv => {
  if (platform !== "win32") return { ...base, ...overrides };
  const merged: NodeJS.ProcessEnv = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    for (const existing of Object.keys(merged)) {
      if (existing.toLowerCase() === key.toLowerCase()) delete merged[existing];
    }
    merged[key] = value;
  }
  return merged;
};

const isFile = (candidate: string): boolean => {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
};

const windowsExtensions = (env: NodeJS.ProcessEnv): string[] =>
  (envValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean);

const withExtensions = (base: string, env: NodeJS.ProcessEnv): string[] =>
  path.win32.extname(base)
    ? [base, ...windowsExtensions(env).map((extension) => `${base}${extension}`)]
    : windowsExtensions(env).map((extension) => `${base}${extension}`);

export const resolveWindowsCommand = (
  command: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
): string | null => {
  const hasDirectory = /[\\/]/u.test(command) || path.win32.isAbsolute(command);
  const directories = hasDirectory
    ? [path.win32.resolve(cwd, path.win32.dirname(command))]
    : (envValue(env, "PATH") ?? "")
        .split(";")
        .map((entry) => entry.trim().replace(/^"(.*)"$/u, "$1"))
        .filter(Boolean)
        .map((entry) => path.win32.resolve(cwd, entry));
  const name = hasDirectory ? path.win32.basename(command) : command;
  for (const directory of directories) {
    for (const candidate of withExtensions(path.win32.join(directory, name), env)) {
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
};

const escapeCmdArgument = (value: string): string => {
  const quoted = `"${value
    .replace(/(\\*)"/gu, '$1$1\\"')
    .replace(/(\\*)$/u, "$1$1")}"`;
  return quoted.replace(CMD_META_CHARS, "^$1").replace(CMD_META_CHARS, "^$1");
};

export const windowsBatchLaunch = (
  scriptPath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): StdioLaunch => {
  const commandLine = [
    path.win32.normalize(scriptPath).replace(CMD_META_CHARS, "^$1"),
    ...args.map(escapeCmdArgument),
  ].join(" ");
  return {
    command: envValue(env, "ComSpec") || "cmd.exe",
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
};

export const resolveStdioLaunch = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; cwd?: string; platform?: NodeJS.Platform },
): StdioLaunch => {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return { command, args: [...args] };
  const resolved = resolveWindowsCommand(command, options.env, options.cwd ?? process.cwd());
  if (!resolved) return { command, args: [...args] };
  if (/\.(?:exe|com)$/iu.test(resolved)) {
    return { command: resolved, args: [...args] };
  }
  return windowsBatchLaunch(resolved, args, options.env);
};
