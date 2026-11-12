import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findExternalCliPath } from "@stella/runtime/kernel/integrations/external-cli-resolution";
import { readClaudeCliVersion } from "@stella/runtime/kernel/integrations/claude-cli-update";
import type {
  ClaudeCliInstallProgress,
  ClaudeCliInstallResult,
} from "@stella/contracts/claude-local-accounts";

export type { ClaudeCliInstallProgress, ClaudeCliInstallResult };

/**
 * Installs Claude Code for someone who has a Claude plan but has never opened
 * a terminal, with Anthropic's own native installer (install.sh on macOS and
 * Linux, install.ps1 on Windows; https://code.claude.com/docs/en/setup). It
 * installs into the user's home, needs no admin rights, and keeps itself
 * updated; Stella's background updater covers it from then on.
 *
 * The installer prints nothing while it downloads, so progress comes from
 * the binary it is writing into ~/.claude/downloads against the size the
 * release manifest gives for this platform.
 */

const RELEASES = "https://downloads.claude.ai/claude-code-releases";
const INSTALLER_SH = "https://claude.ai/install.sh";
const INSTALLER_PS1 = "https://claude.ai/install.ps1";
const LOOKUP_TIMEOUT_MS = 20_000;
const INSTALL_TIMEOUT_MS = 15 * 60_000;
const POLL_MS = 250;
const OUTPUT_TAIL_CHARS = 2_000;
const SETTING_UP = /Setting up Claude Code/i;

const NETWORK_ERROR =
  /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|fetch failed|network|timed out|Could not resolve host|Failed to connect|Unable to connect|No such host|remote name could not be resolved/i;

const describe = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  const causeText =
    cause instanceof Error
      ? `${cause.name}: ${cause.message} ${(cause as NodeJS.ErrnoException).code ?? ""}`
      : "";
  return `${error.message} ${causeText}`.trim();
};

const isMusl = (): boolean =>
  fs.existsSync("/lib/libc.musl-x86_64.so.1") || fs.existsSync("/lib/libc.musl-aarch64.so.1");

/** The release manifest's name for this computer, as the installer works it out. */
export const claudeCliPlatform = (): string | null => {
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
  if (!arch) return null;
  if (process.platform === "darwin") return `darwin-${arch}`;
  if (process.platform === "win32") return `win32-${arch}`;
  if (process.platform === "linux") return `linux-${arch}${isMusl() ? "-musl" : ""}`;
  return null;
};

const fetchText = async (url: string, signal?: AbortSignal): Promise<string> => {
  const timeout = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return await response.text();
};

const sizeOnDisk = (dir: string, prefix: string): number => {
  try {
    let total = 0;
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(prefix)) continue;
      try {
        total = Math.max(total, fs.statSync(path.join(dir, name)).size);
      } catch {
        // Renamed or removed between the listing and the stat.
      }
    }
    return total;
  } catch {
    return 0;
  }
};

const installerEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const next = { ...env };
  delete next.ANTHROPIC_API_KEY;
  delete next.ANTHROPIC_AUTH_TOKEN;
  delete next.CLAUDE_CODE_OAUTH_TOKEN;
  return next;
};

const runInstaller = (
  script: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal | undefined,
  onOutput: (text: string) => void,
): Promise<{ exitCode: number | null; output: string }> =>
  new Promise((resolve) => {
    const [command, args] =
      process.platform === "win32"
        ? [
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
          ]
        : ["bash", [script]];
    let output = "";
    const child = spawn(command, args, {
      env,
      cwd: os.tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: INSTALL_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    });
    const collect = (chunk: Buffer) => {
      const text = chunk.toString();
      output = `${output}${text}`.slice(-OUTPUT_TAIL_CHARS);
      onOutput(text);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let settled = false;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode, output: output.trim() });
    };
    child.on("error", (error) => {
      output = `${output}\n${error.message}`;
      finish(null);
    });
    child.on("close", finish);
  });

export const installClaudeCli = async (
  options: {
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    onProgress?: (progress: ClaudeCliInstallProgress) => void;
  } = {},
): Promise<ClaudeCliInstallResult> => {
  const env = options.env ?? process.env;
  const report = options.onProgress ?? (() => {});
  report({ phase: "checking" });

  const platform = claudeCliPlatform();
  if (!platform) {
    return {
      status: "unavailable",
      detail: `Claude Code doesn't run on ${process.platform}/${process.arch}.`,
    };
  }

  let version: string;
  let total: number | null = null;
  let script: string;
  try {
    version = (await fetchText(`${RELEASES}/latest`, options.signal)).trim();
    if (!/^\d+\.\d+\.\d+/.test(version)) {
      return {
        status: "unavailable",
        detail:
          "Anthropic's download service didn't answer with a version. Claude Code may not be offered in your region.",
      };
    }
    try {
      const manifest = JSON.parse(
        await fetchText(`${RELEASES}/${version}/manifest.json`, options.signal),
      ) as { platforms?: Record<string, { size?: number }> };
      const size = manifest.platforms?.[platform]?.size;
      total = typeof size === "number" && size > 0 ? size : null;
    } catch {
      total = null;
    }
    script = await fetchText(
      process.platform === "win32" ? INSTALLER_PS1 : INSTALLER_SH,
      options.signal,
    );
  } catch (error) {
    if (options.signal?.aborted) return { status: "failed", detail: "Canceled." };
    const detail = describe(error);
    return NETWORK_ERROR.test(detail)
      ? { status: "offline", detail }
      : { status: "failed", detail };
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "stella-claude-install-"));
  const scriptPath = path.join(workDir, process.platform === "win32" ? "install.ps1" : "install.sh");
  fs.writeFileSync(scriptPath, script, { mode: 0o700 });

  const home =
    (process.platform === "win32" ? env.USERPROFILE : env.HOME)?.trim() || os.homedir();
  const downloadDir = path.join(home, ".claude", "downloads");
  const prefix = `claude-${version}-${platform}`;
  let settingUp = false;
  let lastReceived = -1;
  const poll = setInterval(() => {
    if (settingUp) return;
    const received = sizeOnDisk(downloadDir, prefix);
    if (received === lastReceived) return;
    lastReceived = received;
    report({
      phase: "downloading",
      received: total ? Math.min(received, total) : received,
      total,
    });
  }, POLL_MS);
  report({ phase: "downloading", received: 0, total });

  let result: { exitCode: number | null; output: string };
  try {
    result = await runInstaller(scriptPath, installerEnv(env), options.signal, (text) => {
      if (!settingUp && SETTING_UP.test(text)) {
        settingUp = true;
        report({ phase: "setting-up" });
      }
    });
  } finally {
    clearInterval(poll);
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  if (options.signal?.aborted) return { status: "failed", detail: "Canceled." };
  const executable = findExternalCliPath("claude", { env });
  if (result.exitCode === 0 && executable) {
    return {
      status: "installed",
      version: await readClaudeCliVersion(executable, env),
      executable,
    };
  }
  const detail = result.output || `The installer exited with code ${result.exitCode}.`;
  if (/not available in your region|supported-countries|unexpected content/i.test(detail)) {
    return { status: "unavailable", detail };
  }
  if (NETWORK_ERROR.test(detail)) return { status: "offline", detail };
  return { status: "failed", detail };
};
