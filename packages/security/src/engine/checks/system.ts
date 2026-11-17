import { readFileSync } from "node:fs";
import type { Finding, HandledLine } from "../types.ts";
import { OS, exists, powershell, run } from "../util.ts";

type Out = { findings: Finding[]; handled: HandledLine[] };
const now = () => Date.now();

const settingsUrl = {
  encryption: { darwin: "x-apple.systempreferences:com.apple.preference.security?FileVault", win32: "ms-settings:deviceencryption" },
  firewall: { darwin: "x-apple.systempreferences:com.apple.preference.security?Firewall", win32: "windowsdefender://network" },
  updates: { darwin: "x-apple.systempreferences:com.apple.Software-Update-Settings.extension", win32: "ms-settings:windowsupdate" },
  lock: { darwin: "x-apple.systempreferences:com.apple.Lock-Screen-Settings.extension", win32: "ms-settings:signinoptions" },
} as const;

/** Disk encryption: a stolen laptop shouldn't mean stolen files. */
export const checkEncryption = async (): Promise<Out> => {
  const out: Out = { findings: [], handled: [] };
  let encrypted: boolean | undefined;
  if (OS === "darwin") {
    const r = await run("fdesetup", ["status"]);
    if (r.ok) encrypted = /FileVault is On/i.test(r.stdout);
  } else if (OS === "win32") {
    // Works without admin; 1 = on, 2 = off, 0/3+ = not applicable or in progress.
    const r = await powershell("(New-Object -ComObject Shell.Application).NameSpace('C:').Self.ExtendedProperty('System.Volume.BitLockerProtection')");
    const v = parseInt(r.stdout.trim(), 10);
    if (v === 1 || v === 3 || v === 5) encrypted = true;
    else if (v === 2) encrypted = false;
  } else {
    const r = await run("lsblk", ["-J", "-o", "NAME,TYPE,MOUNTPOINTS"]);
    if (r.ok) {
      const tree = JSON.parse(r.stdout) as { blockdevices: Array<Record<string, any>> };
      const walk = (n: Record<string, any>, inCrypt: boolean): boolean => {
        const crypt = inCrypt || n.type === "crypt";
        const mounts: string[] = (n.mountpoints ?? []).filter(Boolean);
        if (mounts.some((m) => m === "/" || m === "/home")) return crypt;
        return (n.children ?? []).some((c: Record<string, any>) => walk(c, crypt));
      };
      encrypted = tree.blockdevices.some((d) => walk(d, false));
    }
  }
  if (encrypted === true) out.handled.push({ id: "encryption", text: "Your disk is encrypted", at: now() });
  else if (encrypted === false) {
    out.findings.push({
      id: "encryption-off",
      kind: "encryption",
      title: "Turn on disk encryption",
      detail: "If this computer is lost or stolen, anyone could read your files. Encryption locks them to your password.",
      needsYou: true,
      urgency: 40,
      ...(OS === "darwin" || OS === "win32" ? { action: { kind: "open" as const, label: "Turn it on", url: settingsUrl.encryption[OS] } } : {}),
    });
  }
  return out;
};

export const checkFirewall = async (): Promise<Out> => {
  const out: Out = { findings: [], handled: [] };
  let on: boolean | undefined;
  if (OS === "darwin") {
    const r = await run("/usr/libexec/ApplicationFirewall/socketfilterfw", ["--getglobalstate"]);
    if (r.ok) on = /enabled|State = 1|State = 2/i.test(r.stdout);
  } else if (OS === "win32") {
    const r = await powershell("Get-NetFirewallProfile | Select-Object Name,Enabled | ConvertTo-Json");
    if (r.ok && r.stdout.trim()) {
      const rows = ([] as Array<{ Name: string; Enabled: number | boolean }>).concat(JSON.parse(r.stdout));
      on = rows.every((x) => x.Enabled === true || x.Enabled === 1);
    }
  } else {
    // Without root we can only see whether a firewall service is running.
    for (const unit of ["ufw", "firewalld", "nftables"]) {
      const r = await run("systemctl", ["is-active", unit]);
      if (r.stdout.trim() === "active") on = true;
    }
    if (on === undefined) {
      const any = await run("systemctl", ["list-unit-files", "ufw.service", "firewalld.service", "nftables.service", "--no-legend"]);
      if (any.ok && any.stdout.trim()) on = false;
    }
  }
  if (on === true) out.handled.push({ id: "firewall", text: "Firewall is on", at: now() });
  else if (on === false) {
    out.findings.push({
      id: "firewall-off",
      kind: "firewall",
      title: "Turn on your firewall",
      detail: "It stops other devices on the same Wi-Fi (cafés, hotels, airports) from reaching into your computer.",
      needsYou: OS !== "linux",
      urgency: 30,
      ...(OS === "linux" ? {} : { action: { kind: "fix" as const, label: "Turn it on", fix: "firewall-on" as const } }),
    });
  }
  return out;
};

/** How long the system has gone without security updates. */
export const checkSystemUpdates = async (latest?: { macos?: string[]; windowsBuild?: Record<string, number> }): Promise<Out> => {
  const out: Out = { findings: [], handled: [] };
  if (OS === "darwin") {
    const v = (await run("sw_vers", ["-productVersion"])).stdout.trim();
    // Pending updates the system already knows about (no network call; reads its own cache).
    const plist = await run("defaults", ["read", "/Library/Preferences/com.apple.SoftwareUpdate", "RecommendedUpdates"]);
    const pending = plist.ok ? (plist.stdout.match(/"Display Name" = "?([^";]+)/g) ?? []).map((s) => s.replace(/.*= "?/, "")) : [];
    const major = v.split(".")[0];
    const newest = latest?.macos?.find((x) => x.split(".")[0] === major);
    const behind = newest && v && newest.localeCompare(v, undefined, { numeric: true }) > 0;
    if (pending.length || behind) {
      out.findings.push({
        id: `macos-update-${newest ?? pending.join(",")}`,
        kind: "update",
        title: "Update your Mac",
        detail: `macOS ${newest ?? "has an update"}${behind ? ` is out (you have ${v})` : ""}. Updates close holes attackers are using.`,
        needsYou: true,
        urgency: 45,
        action: { kind: "open", label: "Open Software Update", url: settingsUrl.updates.darwin },
        evidence: { version: v, newest, pending },
      });
    } else if (v) out.handled.push({ id: "os-updates", text: `macOS ${v} is up to date`, at: now() });
  } else if (OS === "win32") {
    const r = await powershell("$s=New-Object -ComObject Microsoft.Update.Session; $q=$s.CreateUpdateSearcher(); $c=$q.GetTotalHistoryCount(); if($c -gt 0){ ($q.QueryHistory(0,1) | Select-Object -First 1).Date.ToString('o') }", 40_000);
    const last = Date.parse(r.stdout.trim());
    const ver = (await powershell("[System.Environment]::OSVersion.Version.ToString()")).stdout.trim();
    if (Number.isFinite(last) && Date.now() - last > 45 * 86_400_000) {
      out.findings.push({
        id: "windows-update-stale",
        kind: "update",
        title: "Update Windows",
        detail: `Windows hasn't installed an update in ${Math.round((Date.now() - last) / 86_400_000)} days. Updates close holes attackers are using.`,
        needsYou: true,
        urgency: 45,
        action: { kind: "open", label: "Open Windows Update", url: settingsUrl.updates.win32 },
        evidence: { version: ver, lastUpdate: last },
      });
    } else if (Number.isFinite(last)) out.handled.push({ id: "os-updates", text: "Windows is installing its updates", at: now() });
  } else {
    // Linux: how stale is the last full system upgrade? (Arch pacman log, Debian/Ubuntu apt history)
    let lastUpgrade: number | undefined;
    for (const [file, re] of [
      ["/var/log/pacman.log", /\[(\d{4}-\d{2}-\d{2}T[\d:]+[+-]\d{4})\] \[PACMAN\] starting full system upgrade/g],
      ["/var/log/apt/history.log", /Start-Date: (\d{4}-\d{2}-\d{2}\s+[\d:]+)/g],
    ] as const) {
      if (!exists(file)) continue;
      try {
        const text = readFileSync(file, "utf8");
        const all = [...text.matchAll(re)];
        const m = all.at(-1)?.[1];
        if (m) lastUpgrade = Date.parse(m.replace(/([+-]\d{2})(\d{2})$/, "$1:$2").replace(/\s+/, "T"));
      } catch {
        /* unreadable */
      }
    }
    if (lastUpgrade && Date.now() - lastUpgrade > 30 * 86_400_000) {
      out.findings.push({
        id: "linux-update-stale",
        kind: "update",
        title: "Update your system",
        detail: `Your system hasn't been updated in ${Math.round((Date.now() - lastUpgrade) / 86_400_000)} days.`,
        needsYou: true,
        urgency: 35,
        evidence: { lastUpgrade },
      });
    } else if (lastUpgrade) out.handled.push({ id: "os-updates", text: `System updated ${Math.max(0, Math.round((Date.now() - lastUpgrade) / 86_400_000))} days ago`, at: now() });
  }
  return out;
};

/** Signs in without a password, or never locks. */
export const checkScreenLock = async (): Promise<Out> => {
  const out: Out = { findings: [], handled: [] };
  if (OS === "darwin") {
    const r = await run("defaults", ["read", "/Library/Preferences/com.apple.loginwindow", "autoLoginUser"]);
    if (r.ok && r.stdout.trim()) {
      out.findings.push({
        id: "autologin-on",
        kind: "screenlock",
        title: "Turn off automatic login",
        detail: "Your Mac opens without a password, so anyone who picks it up gets in.",
        needsYou: true,
        urgency: 35,
        action: { kind: "open", label: "Open Login settings", url: "x-apple.systempreferences:com.apple.Users-Groups-Settings.extension" },
      });
    } else out.handled.push({ id: "screenlock", text: "Your Mac asks for a password", at: now() });
  } else if (OS === "win32") {
    const r = await powershell("(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' -ErrorAction SilentlyContinue).AutoAdminLogon");
    if (r.stdout.trim() === "1") {
      out.findings.push({
        id: "autologin-on",
        kind: "screenlock",
        title: "Turn off automatic sign-in",
        detail: "Windows opens without a password, so anyone who picks up this computer gets in.",
        needsYou: true,
        urgency: 35,
        action: { kind: "open", label: "Open sign-in options", url: settingsUrl.lock.win32 },
      });
    } else out.handled.push({ id: "screenlock", text: "Windows asks for a password", at: now() });
  }
  return out;
};
