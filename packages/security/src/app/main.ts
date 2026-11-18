import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BrowserWindow, Menu, Notification, Tray, app, dialog, ipcMain, nativeImage, powerMonitor, safeStorage, shell } from "electron";
import { connectGmail, gmailCheck, gmailTestApi, moveToSpam, type GmailDeps, type GmailTokens } from "../engine/email/gmail.ts";
import { openRouterClient, type ModelClient } from "../engine/model.ts";
import { markFixed, runScan, snooze } from "../engine/scan.ts";
import { loadState, saveState } from "../engine/state.ts";
import type { Finding, RunSummary } from "../engine/types.ts";
import { OS, powershell, run } from "../engine/util.ts";
import { DEV_BACKEND, PROD_BACKEND, createStellaAccount, type Vault } from "./stella-account.ts";

app.setName("Stella Security");
if (process.env.STELLA_SECURITY_DATA_DIR) app.setPath("userData", process.env.STELLA_SECURITY_DATA_DIR);
const TEST_CONTROL = process.env.STELLA_SECURITY_TEST_CONTROL_FILE;

if (!TEST_CONTROL && !app.requestSingleInstanceLock()) app.quit();

const MODEL = process.env.STELLA_SECURITY_MODEL ?? "deepseek/deepseek-v4.1-flash";
const CHECK_EVERY_MS = 4 * 3_600_000;
const dataDir = () => app.getPath("userData");

// ---------- a small log on this computer (for "it got stuck" reports; never sent anywhere) ----------
const logFile = () => path.join(dataDir(), "stella-security.log");
const text = (x: unknown) => (x instanceof Error ? (x.stack ?? x.message) : typeof x === "string" ? x : JSON.stringify(x));
for (const level of ["log", "warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    try {
      const file = logFile();
      if (existsSync(file) && statSync(file).size > 1_000_000) renameSync(file, `${file}.old`);
      appendFileSync(file, `${new Date().toISOString()} ${level} ${args.map(text).join(" ")}\n`);
    } catch {
      /* logging must never break the app */
    }
  };
}
process.on("unhandledRejection", (e) => console.error("[unhandled]", e));

// ---------- secrets on disk, encrypted by the OS keychain ----------
const vaultFile = () => path.join(dataDir(), "vault.bin");
// The OS key store (DPAPI, Keychain, libsecret) is only usable once the app is ready; nothing may
// read or write the vault before then, or it reads as empty and the person looks signed out.
const readVault = (): Record<string, string> => {
  if (!app.isReady()) throw new Error("vault read before the app was ready");
  let raw: Buffer;
  try {
    raw = readFileSync(vaultFile());
  } catch {
    return {};
  }
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return JSON.parse(safeStorage.decryptString(raw)) as Record<string, string>;
    } catch {
      /* written where no key store was available: plain JSON, re-encrypted on the next write */
    }
  }
  try {
    return JSON.parse(raw.toString("utf8")) as Record<string, string>;
  } catch (e) {
    console.error("[vault] unreadable; treating as signed out", e);
    return {};
  }
};
const vault: Vault = {
  get: (k) => readVault()[k],
  set: (k, v) => {
    const all = readVault();
    if (v === undefined) delete all[k];
    else all[k] = v;
    mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    const text = JSON.stringify(all);
    writeFileSync(vaultFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text), { mode: 0o600 });
  },
};

const backendUrl = process.env.STELLA_SECURITY_BACKEND ?? (process.env.STELLA_SECURITY_DEV ? DEV_BACKEND : PROD_BACKEND);
const stella = createStellaAccount(backendUrl, vault);

const gmailDeps: GmailDeps = {
  backendUrl,
  authToken: () => stella.authToken(),
  openUrl: (u) => openUrl(u),
  load: () => {
    const raw = vault.get("gmail");
    return raw ? (JSON.parse(raw) as GmailTokens) : undefined;
  },
  save: (t) => vault.set("gmail", t ? JSON.stringify(t) : undefined),
};

/** The model as the signed-in Stella user; a local developer key only when explicitly configured. */
const modelClient = async (): Promise<ModelClient | undefined> => {
  const devKeyFile = process.env.STELLA_SECURITY_OPENROUTER_KEY_FILE;
  if (devKeyFile && existsSync(devKeyFile)) return openRouterClient(MODEL, readFileSync(devKeyFile, "utf8").trim());
  return stella.model(MODEL).catch(() => undefined);
};

// ---------- opening things ----------
const BROWSER_BIN: Record<string, { linux: string[]; darwin: string; win32: string[] }> = {
  chrome: { linux: ["google-chrome-stable", "google-chrome"], darwin: "Google Chrome", win32: ["Google\\Chrome\\Application\\chrome.exe"] },
  chromium: { linux: ["chromium", "chromium-browser"], darwin: "Chromium", win32: ["Chromium\\Application\\chrome.exe"] },
  brave: { linux: ["brave", "brave-browser"], darwin: "Brave Browser", win32: ["BraveSoftware\\Brave-Browser\\Application\\brave.exe"] },
  edge: { linux: ["microsoft-edge", "microsoft-edge-stable"], darwin: "Microsoft Edge", win32: ["Microsoft\\Edge\\Application\\msedge.exe"] },
  firefox: { linux: ["firefox"], darwin: "Firefox", win32: ["Mozilla Firefox\\firefox.exe"] },
};

const openUrl = (url: string, browser?: string) => {
  if (TEST_CONTROL) {
    // Tests never open anything on the person's screen; the harness reads these instead.
    writeFileSync(path.join(dataDir(), "opened-urls.txt"), `${browser ?? "default"} ${url}\n`, { flag: "a" });
    return;
  }
  // Browser-internal pages (chrome://, edge://, about:) only open by launching that browser.
  if (browser && /^(chrome|edge|brave|about):/.test(url)) {
    const b = BROWSER_BIN[browser];
    if (b) {
      if (OS === "darwin") return void spawn("open", ["-a", b.darwin, url], { detached: true, stdio: "ignore" }).unref();
      if (OS === "win32") {
        const roots = [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean) as string[];
        for (const r of roots) for (const rel of b.win32) if (existsSync(path.join(r, rel))) return void spawn(path.join(r, rel), [url], { detached: true, stdio: "ignore" }).unref();
      } else {
        for (const bin of b.linux) {
          const child = spawn(bin, [url], { detached: true, stdio: "ignore" });
          child.on("error", () => {});
          child.unref();
          return;
        }
      }
    }
  }
  void shell.openExternal(url);
};

const runKnownFix = async (fix: string): Promise<boolean> => {
  if (fix === "firewall-on") {
    if (OS === "darwin") return (await run("osascript", ["-e", 'do shell script "/usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on" with administrator privileges'], 120_000)).ok;
    if (OS === "win32") return (await powershell("Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-WindowStyle','Hidden','-Command','Set-NetFirewallProfile -All -Enabled True'", 120_000)).ok;
  }
  return false;
};

// ---------- state the window shows ----------
type View = {
  phase: "signed-out" | "first-check" | "checking" | "ready";
  progress?: string;
  summary?: RunSummary;
  account?: { email?: string };
  email?: { connected: boolean; address?: string };
  error?: string;
};
// Set for real once the app is ready (signing in reads the OS key store).
let view: View = { phase: "signed-out" };
let win: BrowserWindow | undefined;
let tray: Tray | undefined;
const push = () => win?.webContents.send("view", view);
const setView = (v: Partial<View>) => {
  view = { ...view, ...v };
  push();
  updateTray();
};

const notifyNew = (before: Finding[] | undefined, after: Finding[]) => {
  const old = new Set((before ?? []).map((f) => f.id));
  const fresh = after.filter((f) => !old.has(f.id));
  if (!fresh.length || TEST_CONTROL || !Notification.isSupported()) return;
  const n = new Notification({ title: after.length === 1 ? "1 thing needs you" : `${after.length} things need you`, body: fresh[0]!.title, silent: false });
  n.on("click", () => showWindow());
  n.show();
};

let checking: Promise<void> | undefined;
const check = async (reason: string) => {
  if (checking) return checking;
  if (!stella.signedIn() && !process.env.STELLA_SECURITY_OPENROUTER_KEY_FILE) return;
  checking = (async () => {
    console.log(`[check] start (${reason})`);
    const before = loadState(dataDir()).lastRun?.needsYou;
    setView({ phase: view.summary ? "checking" : "first-check", progress: "Starting", error: undefined });
    try {
      const model = await modelClient();
      const account = stella.signedIn() ? await stella.account() : undefined;
      const mailOn = Boolean(gmailDeps.load());
      const summary = await runScan({
        dataDir: dataDir(),
        ...(model ? { model } : {}),
        // The day's news is read once on Stella's server for everyone; this computer only downloads it.
        feedUrl: process.env.STELLA_SECURITY_FEED_URL ?? `${backendUrl}/api/security/feed`,
        emails: [account?.email, gmailDeps.load()?.email].filter(Boolean) as string[],
        ...(mailOn ? { mail: gmailCheck(gmailDeps) } : {}),
        onProgress: (p) => (console.log(`[check] ${p}`), setView({ progress: p })),
      });
      console.log(`[check] ${reason}: ${summary.needsYou.length} need you, ${summary.handled.length} handled, ${summary.errors.length} errors, $${summary.model.costUsd.toFixed(4)}`);
      notifyNew(before, summary.needsYou);
      setView({ phase: "ready", summary, progress: undefined, ...(account ? { account } : {}) });
    } catch (e) {
      console.error(`[check] ${reason} failed`, e);
      setView({ phase: "ready", error: (e as Error).message, progress: undefined });
    } finally {
      checking = undefined;
    }
  })();
  return checking;
};

const dueCheck = () => {
  const last = loadState(dataDir()).lastRun?.startedAt ?? 0;
  if (Date.now() - last > CHECK_EVERY_MS) void check("scheduled");
};

// ---------- window + tray ----------
const iconPath = () => path.join(__dirname, "icon.png");

const showWindow = () => {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 420,
    height: 680,
    minWidth: 360,
    minHeight: 520,
    title: "Stella Security",
    backgroundColor: "#ffffff",
    show: false,
    icon: iconPath(),
    ...(TEST_CONTROL ? { paintWhenInitiallyHidden: true } : {}),
    ...(OS === "darwin" ? { titleBarStyle: "hiddenInset" as const } : {}),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, ...(TEST_CONTROL ? { offscreen: true } : {}) },
  });
  win.removeMenu();
  void win.loadFile(path.join(__dirname, "renderer", "index.html"));
  if (!TEST_CONTROL) win.once("ready-to-show", () => win?.show());
  win.webContents.on("did-finish-load", push);
  if (TEST_CONTROL) {
    win.setContentSize(840, 1360);
    win.webContents.on("did-finish-load", () => win?.webContents.setZoomFactor(2));
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    openUrl(url);
    return { action: "deny" };
  });
  win.on("close", (e) => {
    if (!quitting && tray) {
      e.preventDefault();
      win?.hide();
    }
  });
};

let quitting = false;
const updateTray = () => {
  if (!tray) return;
  const n = view.summary?.needsYou.length ?? 0;
  tray.setToolTip(n ? `Stella Security: ${n} thing${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you` : "Stella Security: you're safe");
};

app.whenReady().then(async () => {
  if (process.env.STELLA_SECURITY_TEST_SESSION_FILE && !stella.signedIn()) stella.useSession(readFileSync(process.env.STELLA_SECURITY_TEST_SESSION_FILE, "utf8").trim());
  view.phase = stella.signedIn() ? "ready" : "signed-out";
  console.log(`[start] ${app.getVersion()} ${process.platform} signed ${stella.signedIn() ? "in" : "out"}`);
  const state = loadState(dataDir());
  if (state.lastRun) view.summary = state.lastRun;
  view.email = { connected: Boolean(gmailDeps.load()), ...(gmailDeps.load()?.email ? { address: gmailDeps.load()!.email } : {}) };
  showWindow();
  if (TEST_CONTROL) startTestControl(TEST_CONTROL);
  else try {
    tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 18, height: 18 }));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open Stella Security", click: showWindow },
      { label: "Check now", click: () => void check("tray") },
      { type: "separator" },
      { label: "Quit", click: () => ((quitting = true), app.quit()) },
    ]));
    tray.on("click", showWindow);
    updateTray();
  } catch {
    tray = undefined;
  }
  // Start with the computer in packaged installs only (never while developing on someone's machine).
  if (app.isPackaged && OS !== "linux") app.setLoginItemSettings({ openAtLogin: true });
  if (stella.signedIn()) {
    void stella.account().then((a) => a && setView({ account: a }));
    dueCheck();
  } else if (process.env.STELLA_SECURITY_OPENROUTER_KEY_FILE) dueCheck();
  setInterval(dueCheck, 10 * 60_000);
  powerMonitor.on("resume", () => setTimeout(dueCheck, 30_000));
});
app.on("second-instance", showWindow);
app.on("before-quit", () => (quitting = true));
app.on("window-all-closed", () => {
  if (!tray) app.quit();
});

// ---------- what the window can ask for ----------
ipcMain.handle("view", () => view);
ipcMain.handle("check-now", () => check("button"));
ipcMain.handle("sign-in", async (_e, how: { kind: "google" } | { kind: "email"; email: string }) => {
  try {
    setView({ error: undefined, progress: how.kind === "google" ? "Finish signing in in your browser" : `Open the link we sent to ${how.email}` });
    if (how.kind === "google") await stella.signInWithGoogle((u) => openUrl(u));
    else await stella.signInWithEmail(how.email);
    setView({ phase: "first-check", progress: "Starting" });
    const a = await stella.account();
    if (a) setView({ account: a });
    void check("signed in");
  } catch (e) {
    setView({ error: (e as Error).message, progress: undefined });
  }
});
ipcMain.handle("connect-email", async () => {
  try {
    setView({ error: undefined });
    const t = await connectGmail(gmailDeps);
    setView({ email: { connected: true, address: t.email } });
    void check("email connected");
  } catch (e) {
    setView({ error: (e as Error).message });
  }
});
ipcMain.handle("disconnect-email", () => {
  gmailDeps.save(undefined);
  setView({ email: { connected: false } });
});
ipcMain.handle("snooze", (_e, id: string) => {
  snooze(dataDir(), id);
  setView({ summary: loadState(dataDir()).lastRun });
});
ipcMain.handle("fix", async (_e, id: string) => {
  const f = view.summary?.needsYou.find((x) => x.id === id);
  if (!f?.action) return;
  const a = f.action;
  let done = false;
  if (a.kind === "open") {
    openUrl(a.url, a.browser);
    done = true;
  } else if (a.kind === "trash") {
    const r = TEST_CONTROL ? { response: 0 } : await dialog.showMessageBox(win!, { type: "question", buttons: ["Move to Trash", "Cancel"], defaultId: 0, cancelId: 1, message: `Move ${path.basename(a.path)} to the Trash?`, detail: "You can get it back from the Trash if you need it." });
    if (r.response !== 0) return;
    await shell.trashItem(a.path);
    done = true;
  } else if (a.kind === "fix") {
    done = await runKnownFix(a.fix);
  } else if (a.kind === "email-spam") {
    await moveToSpam(gmailDeps, a.messageId);
    const s = loadState(dataDir());
    if (s.mail) delete s.mail.verdicts[a.messageId];
    saveState(dataDir(), s);
    done = true;
  }
  if (!done) return;
  const handledText: Record<string, string> = { trash: `Moved ${f.evidence?.name ?? "the file"} to the Trash`, "email-spam": `Moved a fake email to spam`, fix: `${f.title.replace(/^Turn on/, "Turned on")}`, open: `${f.title}: opened` };
  markFixed(dataDir(), id, handledText[a.kind] ?? f.title);
  setView({ summary: loadState(dataDir()).lastRun });
  // Confirm with a fresh look a little later (updates and password changes take a minute).
  setTimeout(() => void check("after fix"), a.kind === "open" ? 5 * 60_000 : 20_000);
});
ipcMain.handle("open-url", (_e, url: string) => openUrl(url));
ipcMain.handle("sign-out", () => {
  stella.signOut();
  setView({ phase: "signed-out", account: undefined });
});

/**
 * Test-only remote control (STELLA_SECURITY_TEST_CONTROL_FILE): the window renders offscreen,
 * never on the screen, and a localhost-only port takes "eval" and "shot" requests. Off in normal runs.
 */
function startTestControl(portFile: string) {
  const http = require("node:http") as typeof import("node:http");
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    try {
      const q = body ? (JSON.parse(body) as { raw?: string; id?: string; js?: string; path?: string; width?: number; height?: number; channel?: string; args?: unknown[] }) : {};
      let out: unknown = null;
      if (req.url === "/eval") out = await win!.webContents.executeJavaScript(q.js!, true);
      else if (req.url === "/size") win!.setContentSize((q.width ?? 420) * 2, (q.height ?? 680) * 2);
      else if (req.url === "/shot") {
        const img = await win!.webContents.capturePage();
        writeFileSync(q.path!, img.toPNG());
        out = img.getSize();
      } else if (req.url === "/view") out = view;
      else if (req.url === "/gmail-insert") out = await gmailTestApi(gmailDeps).insert(q.raw!);
      else if (req.url === "/gmail-labels") out = await gmailTestApi(gmailDeps).labels(q.id!);
      else if (req.url === "/gmail-trash") out = await gmailTestApi(gmailDeps).trash(q.id!);
      else if (req.url === "/gmail-audit") {
        const g = gmailTestApi(gmailDeps);
        const hits = await g.search(q.raw!);
        out = { hits: await Promise.all(hits.map(async (m) => ({ id: m.id, labels: await g.labels(m.id) }))), userLabels: await g.userLabels(), drafts: await g.draftCount() };
      } else if (req.url === "/gmail-delete") out = await gmailTestApi(gmailDeps).remove(q.id!);
      else if (req.url === "/quit") {
        res.end("{}");
        quitting = true;
        app.quit();
        return;
      }
      res.end(JSON.stringify(out ?? null));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  });
  server.listen(0, "127.0.0.1", () => {
    const a = server.address();
    writeFileSync(portFile, String(typeof a === "object" && a ? a.port : 0));
  });
}
