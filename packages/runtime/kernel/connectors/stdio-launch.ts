import fs from "node:fs";
import path from "node:path";

export type StdioLaunch = {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
};

const CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/gu;

const envValue = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
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

const escapeCmdArgument = (value: string, doubleEscape: boolean): string => {
  let escaped = value
    .replace(/(\\*)"/gu, '$1$1\\"')
    .replace(/(\\*)$/u, "$1$1");
  escaped = `"${escaped}"`.replace(CMD_META_CHARS, "^$1");
  return doubleEscape ? escaped.replace(CMD_META_CHARS, "^$1") : escaped;
};

export const windowsBatchLaunch = (
  scriptPath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): StdioLaunch => {
  const doubleEscape = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/iu.test(scriptPath);
  const commandLine = [
    path.win32.normalize(scriptPath).replace(CMD_META_CHARS, "^$1"),
    ...args.map((arg) => escapeCmdArgument(arg, doubleEscape)),
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
