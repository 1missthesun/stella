import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { homedir, hostname } from "node:os";
import path from "node:path";
import {
  CLAUDE_LOGIN_WARN_BEFORE_MS,
  type ClaudeLocalAccountsState,
  type ClaudeLocalConfig,
  type ClaudeLocalLoginStart,
  type ClaudeLoginAttention,
} from "@stella/contracts/claude-local-accounts";
import type { ClaudeLocalLogin, EngineConnection } from "@stella/contracts/backend/engines";
import { readStoredClaudeLogin, type StoredClaudeLogin } from "@stella/contracts/claude-login";
import {
  buildExternalCliChildEnv,
  findExternalCliPath,
} from "@stella/runtime/kernel/integrations/external-cli-resolution";
import {
  installClaudeCli,
  type ClaudeCliInstallProgress,
  type ClaudeCliInstallResult,
} from "./claude-cli-install.js";
import type { EngineAccountAccess } from "./engine-account-access.js";

const ACCOUNTS_DIR = "claude-accounts";
const DEFAULT_CONFIG_ID = "default";
const LOGIN_TIMEOUT_MS = 15 * 60_000;
const LOGIN_URL_TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = 20_000;
const LOGOUT_TIMEOUT_MS = 30_000;
const FOCUS_REFRESH_MIN_INTERVAL_MS = 30_000;
const REPORT_SETTLE_MS = 15_000;
const REPORT_RETRY_MIN_INTERVAL_MS = 60_000;
// Logins are checked at start and then on this beat, so one that is about to
// end is noticed days before, not by a reply that fails.
const FIRST_CHECK_DELAY_MS = 20_000;
const PERIODIC_CHECK_MS = 30 * 60_000;
// A turn waiting for a sign-in asks often; it re-reads the logins at most
// this often while none can answer.
const SIGNED_OUT_RECHECK_MS = 60_000;

const STRIPPED_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];

type ConfigStatus = ClaudeLocalConfig & {
  dir: string | null;
  known: boolean;
  createdAt: number;
};

/**
 * The login stored in a config directory, read from Claude Code's own file
 * without any secret leaving this function. Used when `claude auth status`
 * reports a different credential (a token in Claude Code's settings) than
 * the login Stella's turns run on. macOS keeps the login in the keychain,
 * where the status is read instead.
 */
/** Claude Code's own default: `CLAUDE_CONFIG_DIR` when set, else ~/.claude. */
const defaultConfigDir = (): string | null => process.env.CLAUDE_CONFIG_DIR?.trim() || null;

const readStoredLogin = (dir: string | null): StoredClaudeLogin & { plan?: string } => {
  let raw: string | null = null;
  try {
    raw = fs.readFileSync(
      path.join(dir ?? defaultConfigDir() ?? path.join(homedir(), ".claude"), ".credentials.json"),
      "utf8",
    );
  } catch {
    return { present: false, alive: false };
  }
  const stored = readStoredClaudeLogin(raw);
  let plan: string | undefined;
  try {
    plan = text((JSON.parse(raw) as { claudeAiOauth?: { subscriptionType?: unknown } }).claudeAiOauth?.subscriptionType);
  } catch {
    plan = undefined;
  }
  return { ...stored, ...(plan ? { plan } : {}) };
};

/** The account a config directory last signed in to, even after it ended. */
const storedEmail = (dir: string | null): string | undefined => {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(
        path.join(dir ?? defaultConfigDir() ?? homedir(), ".claude.json"),
        "utf8",
      ),
    ) as { oauthAccount?: { emailAddress?: unknown } };
    return text(parsed.oauthAccount?.emailAddress);
  } catch {
    return undefined;
  }
};

const epochMs = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

type PendingLogin = {
  loginId: string;
  configId: string;
  dir: string | null;
  isNew: boolean;
  child: ChildProcess;
  output: string;
  exited: Promise<number | null>;
  exitCode: number | null | undefined;
  timer: ReturnType<typeof setTimeout>;
  outcome: Promise<ClaudeLocalConfig>;
  finishing: boolean;
  canceled: boolean;
};

export type ClaudeCodeConfigForTurn = {
  configDir: string | null;
  email?: string;
  signedIn: boolean;
};

export type ClaudeLocalAccountsOptions = {
  stellaDataDir: string;
  engineAccounts: EngineAccountAccess;
  loadDeviceId: () => Promise<string | null>;
  onChanged: () => void;
  /** Claude Code turned up where it wasn't (installed by Stella or by hand). */
  onCliFound?: () => void;
};

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b\[[0-9;?]*[A-Za-z]/g;
const stripAnsi = (text: string) => text.replace(ANSI_PATTERN, "");

export const parseClaudeLoginUrl = (output: string): string | null => {
  // eslint-disable-next-line no-control-regex
  const osc = /\u001b\]8;[^;]*;(https:\/\/[^\u0007\u001b\s]+)(?:\u0007|\u001b\\)/.exec(output);
  if (osc?.[1]) return osc[1];
  const plain = /https:\/\/\S+/.exec(stripAnsi(output));
  return plain ? plain[0] : null;
};

const lastErrorLine = (output: string): string | null => {
  const lines = stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.replace(/^.*Paste code here if prompted >\s*/, "").trim())
    .filter((line) => line && !/^Opening browser|^If the browser didn't open/i.test(line));
  return lines.at(-1) ?? null;
};

const lower = (value: string | undefined) => value?.trim().toLowerCase() || undefined;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

export class ClaudeLocalAccounts {
  private configs: ConfigStatus[] | null = null;
  private cliInstalled = false;
  private refreshing: Promise<void> | null = null;
  private lastRefreshAt = 0;
  private readonly logins = new Map<string, PendingLogin>();
  private lastBroadcast = "";
  private reporting = false;
  private reportAgain = false;
  private lastSent: { key: string; at: number } | null = null;
  private lastFailed: { key: string; at: number } | null = null;
  private deviceId: string | null = null;
  private readonly unsubscribe: () => void;
  private installing: Promise<ClaudeCliInstallResult> | null = null;
  private readonly installListeners = new Set<(progress: ClaudeCliInstallProgress) => void>();
  private readonly installAbort = new AbortController();
  /**
   * Logins Anthropic refused in a turn although their status read fine,
   * keyed by config, with the expiry they had then: they stay out of use
   * until they are signed in again (the expiry changes) or a sign-in here
   * finishes.
   */
  private readonly rejected = new Map<string, number | null>();
  private readonly timers: ReturnType<typeof setTimeout>[] = [];

  constructor(private readonly options: ClaudeLocalAccountsOptions) {
    this.unsubscribe = options.engineAccounts.onSettingsChanged(() => {
      this.broadcastIfChanged();
      void this.reportIfChanged();
    });
    void this.loadDeviceId().then(() => this.broadcastIfChanged());
    const check = () => void this.refresh().catch(() => undefined);
    const first = setTimeout(check, FIRST_CHECK_DELAY_MS);
    const periodic = setInterval(check, PERIODIC_CHECK_MS);
    first.unref?.();
    periodic.unref?.();
    this.timers.push(first, periodic);
  }

  private get accountsDir(): string {
    return path.join(this.options.stellaDataDir, ACCOUNTS_DIR);
  }

  async list(): Promise<ClaudeLocalAccountsState> {
    // Every window surface that shows Claude logins asks on mount; a fresh
    // read is shared rather than run once per surface.
    if (!this.configs || Date.now() - this.lastRefreshAt >= FOCUS_REFRESH_MIN_INTERVAL_MS) {
      await this.refresh();
    }
    return this.state();
  }

  noteWindowFocus(): void {
    if (Date.now() - this.lastRefreshAt < FOCUS_REFRESH_MIN_INTERVAL_MS) return;
    void this.refresh().catch(() => undefined);
  }

  /**
   * The login a Claude Code turn runs on. `recheck` reads every login again
   * first (a turn whose login Anthropic just refused); `cached` answers from
   * what is known, re-reading in the background at most once a minute while
   * nothing can answer (a turn waiting for a sign-in asks often).
   */
  async configForTurn(
    options: { recheck?: boolean; cached?: boolean } = {},
  ): Promise<ClaudeCodeConfigForTurn> {
    if (!this.configs || options.recheck) await this.refresh().catch(() => undefined);
    let resolved = this.resolveForTurn();
    if (!resolved.signedIn) {
      if (options.cached) {
        if (Date.now() - this.lastRefreshAt >= SIGNED_OUT_RECHECK_MS) {
          void this.refresh().catch(() => undefined);
        }
        return resolved;
      }
      if (!options.recheck) {
        await this.refresh().catch(() => undefined);
        resolved = this.resolveForTurn();
      }
    }
    return resolved;
  }

  /**
   * Anthropic refused the login a turn ran on (`configDir` as the turn had
   * it). It stays out of use until it is signed in again, and Stella shows
   * that it needs a sign-in.
   */
  noteRejected(configDir: string | null): void {
    const config = (this.configs ?? []).find((entry) => entry.dir === configDir);
    if (!config) return;
    this.rejected.set(config.configId, config.loginExpiresAt ?? null);
    this.configs = (this.configs ?? []).map((entry) =>
      entry === config ? { ...entry, loggedIn: false, ended: true } : entry,
    );
    this.broadcastIfChanged();
    void this.reportIfChanged();
  }

  state(): ClaudeLocalAccountsState {
    const active = this.activeConfig();
    const chosenEmail = this.chosenAccount()?.email;
    const attention = this.attention(active);
    return {
      cliInstalled: this.cliInstalled,
      configs: (this.configs ?? []).map(
        ({ configId, isDefault, loggedIn, email, plan, loginExpiresAt, ended }) => ({
          configId,
          isDefault,
          loggedIn,
          ...(email ? { email } : {}),
          ...(plan ? { plan } : {}),
          ...(loginExpiresAt !== undefined ? { loginExpiresAt } : {}),
          ...(ended ? { ended: true } : {}),
        }),
      ),
      activeConfigId: active?.configId ?? null,
      ...(active ? { activeReason: this.reasonFor(active) } : {}),
      ...(chosenEmail ? { chosenEmail } : {}),
      ...(attention ? { attention } : {}),
    };
  }

  /**
   * The login Stella answers with here when it ends within a few days, or
   * the login that ended when nothing else here can answer. A computer that
   * never had a Claude login needs no reminder.
   */
  private attention(active: ConfigStatus | null): ClaudeLoginAttention | undefined {
    if (!this.cliInstalled) return undefined;
    if (active) {
      const expiresAt = active.loginExpiresAt;
      if (expiresAt === undefined || expiresAt - Date.now() > CLAUDE_LOGIN_WARN_BEFORE_MS) return undefined;
      return {
        state: "ending",
        configId: active.configId,
        ...(active.email ? { email: active.email } : {}),
        expiresAt,
      };
    }
    const ended = (this.configs ?? []).filter((config) => config.ended);
    if (ended.length === 0) return undefined;
    const wanted = lower(this.chosenAccount()?.email);
    const config =
      (wanted ? ended.find((entry) => lower(entry.email) === wanted) : undefined) ??
      ended.find((entry) => entry.isDefault) ??
      ended[0]!;
    return {
      state: "ended",
      configId: config.configId,
      ...(config.email ? { email: config.email } : {}),
    };
  }

  async startRemoteLogin(params: Record<string, unknown>): Promise<ClaudeLocalLoginStart> {
    const email = text(params.email);
    return await this.startLogin({ ...(email ? { email } : {}), remote: true });
  }

  async finishRemoteLogin(params: Record<string, unknown>): Promise<{ email?: string }> {
    const loginId = text(params.loginId) ?? "";
    const code = typeof params.code === "string" ? params.code : "";
    const config = await this.finishLogin(loginId, code);
    return config.email ? { email: config.email } : {};
  }

  cancelRemoteLogin(params: Record<string, unknown>): null {
    this.cancelLogin(text(params.loginId) ?? "");
    return null;
  }

  async startLogin(
    options: { configId?: string; email?: string; remote?: boolean } = {},
  ): Promise<ClaudeLocalLoginStart> {
    const executable = this.resolveCli();
    if (!executable) throw new Error("Claude Code isn't installed on this computer.");
    if (!this.configs) await this.refresh();
    let configId: string;
    let dir: string | null;
    let isNew = false;
    if (options.configId === DEFAULT_CONFIG_ID) {
      const current = this.configs?.find((config) => config.isDefault);
      if (current?.loggedIn) {
        throw new Error("Claude Code's own login is already signed in on this computer.");
      }
      configId = DEFAULT_CONFIG_ID;
      dir = null;
    } else if (options.configId) {
      const existing = this.configs?.find((config) => config.configId === options.configId);
      if (!existing || !existing.dir) throw new Error("That Claude login isn't on this computer anymore.");
      configId = existing.configId;
      dir = existing.dir;
    } else {
      configId = randomBytes(6).toString("hex");
      dir = path.join(this.accountsDir, configId);
      fs.mkdirSync(this.accountsDir, { recursive: true, mode: 0o700 });
      fs.chmodSync(this.accountsDir, 0o700);
      fs.mkdirSync(dir, { mode: 0o700 });
      isNew = true;
    }
    for (const pending of this.logins.values()) {
      if (pending.configId === configId) this.endLogin(pending, { kill: true });
    }

    const email = text(options.email);
    const child = spawn(
      executable,
      ["auth", "login", "--claudeai", ...(email ? ["--email", email] : [])],
      {
        env: {
          ...this.childEnv(executable, dir),
          ...(options.remote && process.platform !== "win32" ? { BROWSER: "true" } : {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const loginId = randomBytes(12).toString("hex");
    let resolveExit!: (code: number | null) => void;
    const exited = new Promise<number | null>((resolve) => (resolveExit = resolve));
    const pending: PendingLogin = {
      loginId,
      configId,
      dir,
      isNew,
      child,
      output: "",
      exited,
      exitCode: undefined,
      timer: setTimeout(() => this.endLogin(pending, { kill: true }), LOGIN_TIMEOUT_MS),
      outcome: exited.then((code) => this.settleLogin(pending, code)),
      finishing: false,
      canceled: false,
    };
    void pending.outcome.catch(() => undefined);
    this.logins.set(loginId, pending);
    const append = (chunk: Buffer) => {
      pending.output += chunk.toString("utf8");
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.stdin?.on("error", () => undefined);
    child.once("error", (error) => {
      pending.output += `\n${error.message}\n`;
      pending.exitCode = pending.exitCode ?? -1;
      resolveExit(-1);
    });
    child.once("exit", (code) => {
      pending.exitCode = code;
      resolveExit(code);
    });

    try {
      const authorizeUrl = await new Promise<string>((resolve, reject) => {
        const deadline = setTimeout(
          () => reject(new Error("Claude Code didn't start the sign-in. Try again.")),
          LOGIN_URL_TIMEOUT_MS,
        );
        const check = () => {
          const url = parseClaudeLoginUrl(pending.output);
          if (url) {
            clearTimeout(deadline);
            resolve(url);
          }
        };
        child.stdout?.on("data", check);
        child.stderr?.on("data", check);
        void pending.exited.then(() => {
          clearTimeout(deadline);
          reject(new Error(lastErrorLine(pending.output) ?? "Claude Code's sign-in ended."));
        });
      });
      return { loginId, authorizeUrl };
    } catch (error) {
      this.endLogin(pending, { kill: true });
      throw error;
    }
  }

  async waitLogin(loginId: string): Promise<ClaudeLocalConfig> {
    const pending = this.logins.get(loginId);
    if (!pending) throw new Error("This Claude sign-in ended. Start it again.");
    return await pending.outcome;
  }

  async finishLogin(loginId: string, code: string): Promise<ClaudeLocalConfig> {
    const pending = this.logins.get(loginId);
    if (!pending || pending.exitCode !== undefined) {
      throw new Error("This Claude sign-in ended. Start it again.");
    }
    const pasted = code.trim();
    if (!pasted) throw new Error("Paste the code Anthropic showed you.");
    if (pending.finishing) throw new Error("This code is already being checked.");
    pending.finishing = true;
    const before = pending.output.length;
    try {
      const outcome = await new Promise<"exited" | "reprompt">((resolve) => {
        const onData = () => {
          const added = stripAnsi(pending.output.slice(before));
          if (/invalid code|paste code here/i.test(added) && pending.exitCode === undefined) {
            resolve("reprompt");
          }
        };
        pending.child.stdout?.on("data", onData);
        pending.child.stderr?.on("data", onData);
        void pending.exited.then(() => resolve("exited"));
        pending.child.stdin?.write(`${pasted}\n`);
      });
      if (outcome === "reprompt") {
        throw new Error(
          lastErrorLine(pending.output.slice(before)) ?? "Claude Code didn't accept that code.",
        );
      }
      return await pending.outcome;
    } finally {
      pending.finishing = false;
    }
  }

  cancelLogin(loginId: string): { canceled: boolean } {
    const pending = this.logins.get(loginId);
    if (!pending) return { canceled: false };
    pending.canceled = true;
    this.endLogin(pending, { kill: true });
    return { canceled: true };
  }

  async signOut(configId: string): Promise<{ ok: true }> {
    if (!configId || configId === DEFAULT_CONFIG_ID) {
      throw new Error("Stella doesn't sign Claude Code's own login out.");
    }
    if (!this.configs) await this.refresh();
    const config = this.configs?.find((entry) => entry.configId === configId);
    if (!config?.dir) return { ok: true };
    for (const pending of this.logins.values()) {
      if (pending.configId === configId) this.endLogin(pending, { kill: true });
    }
    await this.removeConfigDir(config.dir);
    await this.refresh();
    return { ok: true };
  }

  /**
   * Installs Claude Code with Anthropic's installer when it's missing, for
   * someone who picks it in onboarding. One install at a time; a second
   * caller joins the first and gets its progress from then on.
   */
  async installCli(
    onProgress: (progress: ClaudeCliInstallProgress) => void,
  ): Promise<ClaudeCliInstallResult> {
    const existing = this.resolveCli();
    if (existing) {
      this.broadcastIfChanged();
      return { status: "installed", version: null, executable: existing };
    }
    this.installListeners.add(onProgress);
    try {
      if (!this.installing) {
        this.installing = installClaudeCli({
          signal: this.installAbort.signal,
          onProgress: (progress) => {
            for (const listener of this.installListeners) listener(progress);
          },
        }).finally(() => {
          this.installing = null;
        });
      }
      const result = await this.installing;
      if (result.status === "installed") {
        this.resolveCli();
        await this.refresh().catch(() => undefined);
        this.broadcastIfChanged();
      }
      return result;
    } finally {
      this.installListeners.delete(onProgress);
    }
  }

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.unsubscribe();
    this.installAbort.abort();
    for (const pending of [...this.logins.values()]) this.endLogin(pending, { kill: true });
  }

  private resolveCli(): string | null {
    const executable = findExternalCliPath("claude");
    const wasInstalled = this.cliInstalled;
    this.cliInstalled = executable !== null;
    if (executable && !wasInstalled) this.options.onCliFound?.();
    return executable;
  }

  private childEnv(executable: string, dir: string | null): NodeJS.ProcessEnv {
    const env = buildExternalCliChildEnv(executable, process.env);
    for (const name of STRIPPED_ENV) delete env[name];
    if (dir) env.CLAUDE_CONFIG_DIR = dir;
    return env;
  }

  private runCli(
    executable: string,
    dir: string | null,
    args: string[],
    timeoutMs: number,
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(executable, args, {
        env: this.childEnv(executable, dir),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
      child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timer);
        resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}` });
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  }

  private async readStatus(
    executable: string,
    configId: string,
    dir: string | null,
    createdAt: number,
  ): Promise<ConfigStatus> {
    const base = { configId, isDefault: dir === null, dir, createdAt };
    // `claude auth status` exits 1 while signed out; its JSON is still printed.
    const { stdout } = await this.runCli(executable, dir, ["auth", "status", "--json"], STATUS_TIMEOUT_MS);
    let status: Record<string, unknown>;
    try {
      status = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      return { ...base, loggedIn: false, known: false };
    }
    // Stella's turns run on the claude.ai login stored here. The status
    // describes a different credential when Claude Code's settings carry a
    // token (it then reports "oauth_token" with no account), and it keeps
    // saying signed in after the login's time limit until a request fails;
    // the stored login and its expiry are what count.
    let loggedIn: boolean;
    let email: string | undefined;
    let plan: string | undefined;
    let loginExpiresAt: number | undefined;
    let present: boolean;
    if (status.authMethod === "claude.ai") {
      loggedIn = status.loggedIn === true;
      present = true;
      email = text(status.email);
      plan = text(status.subscriptionType);
      loginExpiresAt = epochMs(status.loginExpiresAt);
    } else {
      const stored = readStoredLogin(dir);
      loggedIn = stored.alive;
      present = stored.present;
      email = storedEmail(dir);
      plan = stored.plan;
      loginExpiresAt = stored.expiresAt;
    }
    if (loggedIn && loginExpiresAt !== undefined && loginExpiresAt <= Date.now()) loggedIn = false;
    if (this.rejected.has(configId)) {
      if (loggedIn && this.rejected.get(configId) === (loginExpiresAt ?? null)) loggedIn = false;
      else if (loggedIn) this.rejected.delete(configId);
    }
    // A login that was here and no longer works has ended; a directory that
    // never finished signing in has not.
    const ended = !loggedIn && (present || Boolean(storedEmail(dir)) || this.rejected.has(configId));
    return {
      ...base,
      loggedIn,
      known: true,
      ...(email ? { email } : {}),
      ...(plan && loggedIn ? { plan } : {}),
      ...(loginExpiresAt !== undefined ? { loginExpiresAt } : {}),
      ...(ended ? { ended: true } : {}),
    };
  }

  private extraConfigDirs(): Array<{ configId: string; dir: string; createdAt: number }> {
    const pendingNew = new Set(
      [...this.logins.values()].filter((login) => login.isNew).map((login) => login.configId),
    );
    let names: string[];
    try {
      names = fs.readdirSync(this.accountsDir);
    } catch {
      return [];
    }
    return names
      .filter((name) => /^[a-f0-9]{6,64}$/.test(name) && !pendingNew.has(name))
      .flatMap((configId) => {
        const dir = path.join(this.accountsDir, configId);
        try {
          const stat = fs.statSync(dir);
          if (!stat.isDirectory()) return [];
          return [{ configId, dir, createdAt: stat.birthtimeMs || stat.ctimeMs }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  private async loadDeviceId(): Promise<string | null> {
    const deviceId = await this.options.loadDeviceId().catch(() => null);
    if (deviceId) this.deviceId = deviceId;
    return this.deviceId;
  }

  private refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const run = (async () => {
      if (!this.deviceId) await this.loadDeviceId();
      const executable = this.resolveCli();
      if (!executable) {
        this.configs = [];
      } else {
        const entries = [
          { configId: DEFAULT_CONFIG_ID, dir: null as string | null, createdAt: 0 },
          ...this.extraConfigDirs(),
        ];
        const previous = new Map((this.configs ?? []).map((config) => [config.configId, config]));
        const statuses = await Promise.all(
          entries.map((entry) => this.readStatus(executable, entry.configId, entry.dir, entry.createdAt)),
        );
        this.configs = statuses.map((status) => {
          const last = previous.get(status.configId);
          return status.known || !last?.known ? status : last;
        });
      }
      this.lastRefreshAt = Date.now();
      this.broadcastIfChanged();
      void this.reportIfChanged();
    })().finally(() => {
      if (this.refreshing === run) this.refreshing = null;
    });
    this.refreshing = run;
    return run;
  }

  private chosenAccount(): EngineConnection | null {
    const settings = this.options.engineAccounts.settings();
    if (settings?.claude) {
      const chosen = settings.claude.chosenAccountId;
      return chosen
        ? (settings.connections.find(
            (connection) => connection.provider === "anthropic" && connection.accountId === chosen,
          ) ?? null)
        : null;
    }
    const deviceId = this.deviceId;
    if (!deviceId) return null;
    return (
      this.options.engineAccounts
        .settings()
        ?.connections.find(
          (connection) =>
            connection.provider === "anthropic" &&
            (connection.places ?? []).some(
              (place) =>
                place.kind === "device" &&
                place.deviceId === deviceId &&
                (place.active ?? connection.active),
            ),
        ) ?? null
    );
  }

  private activeConfig(): ConfigStatus | null {
    const signedIn = (this.configs ?? []).filter((config) => config.loggedIn);
    const wanted = lower(this.chosenAccount()?.email);
    return (
      (wanted ? signedIn.find((config) => lower(config.email) === wanted) : undefined) ??
      signedIn.find((config) => config.isDefault) ??
      signedIn[0] ??
      null
    );
  }

  private reasonFor(config: ConfigStatus): "selected" | "own_login" | "other_login" {
    const wanted = lower(this.chosenAccount()?.email);
    if (wanted && lower(config.email) === wanted) return "selected";
    return config.isDefault ? "own_login" : "other_login";
  }

  private resolveForTurn(): ClaudeCodeConfigForTurn {
    const configs = this.configs ?? [];
    if (!this.cliInstalled || !configs.some((config) => config.known)) {
      return { configDir: null, signedIn: true };
    }
    const config = this.activeConfig();
    if (!config) return { configDir: null, signedIn: false };
    return {
      configDir: config.dir,
      ...(config.email ? { email: config.email } : {}),
      signedIn: true,
    };
  }

  private removeOlderDuplicates(fresh: ConfigStatus): void {
    const email = lower(fresh.email);
    if (!email) return;
    const older = (this.configs ?? []).filter(
      (config) =>
        !config.isDefault &&
        config.configId !== fresh.configId &&
        config.dir &&
        lower(config.email) === email,
    );
    if (older.length === 0) return;
    void Promise.all(older.map((config) => this.removeConfigDir(config.dir!)))
      .then(() => this.refresh())
      .catch(() => undefined);
  }

  private async removeConfigDir(dir: string): Promise<void> {
    if (path.dirname(dir) !== this.accountsDir) return;
    const executable = this.resolveCli();
    if (executable) {
      await this.runCli(executable, dir, ["auth", "logout"], LOGOUT_TIMEOUT_MS);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }

  private async settleLogin(pending: PendingLogin, code: number | null): Promise<ClaudeLocalConfig> {
    if (code !== 0 || pending.canceled) {
      this.endLogin(pending, { kill: false });
      throw new Error(
        pending.canceled
          ? "Claude sign-in was canceled."
          : (lastErrorLine(pending.output) ?? "Claude sign-in failed."),
      );
    }
    this.endLogin(pending, { kill: false, succeeded: true });
    this.rejected.delete(pending.configId);
    await this.refresh();
    const signedIn = this.configs?.find((config) => config.configId === pending.configId);
    if (!signedIn?.loggedIn) {
      throw new Error("Claude Code finished the sign-in but reports no login. Try again.");
    }
    if (pending.isNew) this.removeOlderDuplicates(signedIn);
    return {
      configId: signedIn.configId,
      isDefault: signedIn.isDefault,
      loggedIn: true,
      ...(signedIn.email ? { email: signedIn.email } : {}),
      ...(signedIn.plan ? { plan: signedIn.plan } : {}),
    };
  }

  private endLogin(
    pending: PendingLogin,
    options: { kill: boolean; succeeded?: boolean },
  ): void {
    if (this.logins.get(pending.loginId) !== pending) return;
    this.logins.delete(pending.loginId);
    clearTimeout(pending.timer);
    if (options.kill && pending.exitCode === undefined) {
      pending.child.kill();
    }
    if (pending.isNew && !options.succeeded && pending.dir) {
      const dir = pending.dir;
      const remove = () => {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          // Best effort; an empty leftover dir shows as signed out.
        }
      };
      if (pending.exitCode === undefined) void pending.exited.then(remove);
      else remove();
    }
  }

  private broadcastIfChanged(): void {
    const key = JSON.stringify(this.state());
    if (key === this.lastBroadcast) return;
    this.lastBroadcast = key;
    this.options.onChanged();
  }

  private async reportIfChanged(): Promise<void> {
    if (!this.configs) return;
    if (this.reporting) {
      this.reportAgain = true;
      return;
    }
    const settings = this.options.engineAccounts.settings();
    if (!this.options.engineAccounts.isSignedIn() || !settings) return;
    if (this.configs.some((config) => !config.known)) return;
    const logins = new Map<string, ClaudeLocalLogin>();
    for (const config of this.configs) {
      const email = lower(config.email);
      if (!config.loggedIn || !email || logins.has(email)) continue;
      logins.set(email, {
        email: config.email!,
        ...(config.plan ? { plan: config.plan } : {}),
        ...(config.isDefault ? { isDefault: true } : {}),
      });
    }
    const list = [...logins.values()].sort((a, b) => a.email.localeCompare(b.email));
    const deviceId = await this.loadDeviceId();
    if (!deviceId) return;
    const perPlace = settings.connections.some((connection) =>
      (connection.places ?? []).some((place) => place.active !== undefined),
    );
    const loginKey = (email: string, isDefault: boolean | undefined) =>
      perPlace && isDefault ? `${email}\u0000default` : email;
    const recorded = new Set(
      settings.connections.flatMap((connection) => {
        const email = connection.provider === "anthropic" ? lower(connection.email) : undefined;
        if (!email) return [];
        const here = (connection.places ?? []).find(
          (place) => place.kind === "device" && place.deviceId === deviceId,
        );
        return here?.kind === "device" ? [loginKey(email, here.isDefault)] : [];
      }),
    );
    const reported = [...logins].map(([email, login]) => loginKey(email, login.isDefault));
    const devicePlace = settings.claude?.places.find(
      (place) => place.kind === "device" && place.deviceId === deviceId,
    );
    const deviceKnown =
      !settings.claude || (devicePlace !== undefined && devicePlace.cliInstalled === this.cliInstalled);
    if (
      deviceKnown &&
      recorded.size === reported.length &&
      reported.every((key) => recorded.has(key))
    ) {
      return;
    }
    const key = JSON.stringify({ list, cliInstalled: this.cliInstalled });
    const now = Date.now();
    if (this.lastSent?.key === key && now - this.lastSent.at < REPORT_SETTLE_MS) return;
    if (this.lastFailed?.key === key && now - this.lastFailed.at < REPORT_RETRY_MIN_INTERVAL_MS) {
      return;
    }
    this.reporting = true;
    try {
      const deviceName = hostname().trim().replace(/\.(local|localdomain|lan|home)$/i, "");
      await this.options.engineAccounts.reportClaudeLogins({
        deviceId,
        ...(deviceName ? { deviceName } : {}),
        logins: list,
        cliInstalled: this.cliInstalled,
      });
      this.lastSent = { key, at: Date.now() };
      this.lastFailed = null;
    } catch (error) {
      this.lastFailed = { key, at: Date.now() };
      console.warn(
        `[claude-accounts] reporting logins failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.reporting = false;
      if (this.reportAgain) {
        this.reportAgain = false;
        void this.reportIfChanged();
      }
    }
  }
}
