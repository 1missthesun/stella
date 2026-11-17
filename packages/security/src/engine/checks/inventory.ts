import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { listDirSafe } from "../browsers.ts";
import { OS, exists, home, powershell, run } from "../util.ts";

/** Something on the computer that can run code or came from outside, tracked so changes can be judged. */
export type InventoryItem = {
  key: string;
  kind: "startup" | "app" | "download" | "extension";
  name: string;
  facts: Record<string, unknown>;
};

const firstLine = (s: string) => s.split("\n")[0]?.trim() ?? "";

// ---------- things that start by themselves ----------

const plistField = (text: string, key: string): string | undefined => {
  const m = text.match(new RegExp(`<key>${key}</key>\\s*<(string|true|false)\\s*/?>([^<]*)`));
  return m ? (m[1] === "string" ? m[2] : m[1]) : undefined;
};
const plistArray = (text: string, key: string): string[] => {
  const m = text.match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`));
  return m ? [...m[1]!.matchAll(/<string>([^<]*)<\/string>/g)].map((x) => x[1]!) : [];
};

export const startupItems = async (): Promise<InventoryItem[]> => {
  const out: InventoryItem[] = [];
  if (OS === "darwin") {
    for (const dir of [home("Library/LaunchAgents"), "/Library/LaunchAgents", "/Library/LaunchDaemons"]) {
      for (const f of listDirSafe(dir)) {
        if (!f.endsWith(".plist")) continue;
        const file = path.join(dir, f);
        let text = "";
        try {
          text = readFileSync(file, "utf8");
        } catch {
          continue;
        }
        if (!text.includes("<?xml")) {
          const conv = await run("plutil", ["-convert", "xml1", "-o", "-", file]);
          text = conv.stdout;
        }
        const program = plistField(text, "Program") ?? plistArray(text, "ProgramArguments")[0] ?? "";
        const args = plistArray(text, "ProgramArguments").slice(1, 6);
        out.push({ key: `startup:${file}`, kind: "startup", name: plistField(text, "Label") ?? f, facts: { where: dir, file, program, args, runAtLoad: plistField(text, "RunAtLoad") === "true" } });
      }
    }
    // The visible Login Items list needs an Automation permission prompt (System Events), so it's
    // left out; LaunchAgents/Daemons above are where unwanted things actually hide.
  } else if (OS === "win32") {
    const r = await powershell(
      `$o=@(); foreach($k in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce'){ $p=Get-ItemProperty $k -ErrorAction SilentlyContinue; if($p){ $p.PSObject.Properties | ?{ $_.Name -notlike 'PS*' } | %{ $o+=[pscustomobject]@{where=$k;name=$_.Name;command=[string]$_.Value} } } };
       foreach($d in [Environment]::GetFolderPath('Startup'),[Environment]::GetFolderPath('CommonStartup')){ Get-ChildItem $d -ErrorAction SilentlyContinue | %{ $o+=[pscustomobject]@{where=$d;name=$_.Name;command=$_.FullName} } };
       Get-ScheduledTask -ErrorAction SilentlyContinue | ?{ $_.TaskPath -notlike '\\Microsoft\\*' -and $_.State -ne 'Disabled' } | %{ $a=$_.Actions | Select-Object -First 1; $o+=[pscustomobject]@{where='Scheduled task';name=$_.TaskPath+$_.TaskName;command=[string]$a.Execute+' '+[string]$a.Arguments} };
       $o | ConvertTo-Json -Depth 3`,
      40_000,
    );
    if (r.stdout.trim()) {
      for (const it of ([] as Array<{ where: string; name: string; command: string }>).concat(JSON.parse(r.stdout))) out.push({ key: `startup:${it.where}:${it.name}`, kind: "startup", name: it.name, facts: { where: it.where, command: it.command } });
    }
  } else {
    for (const dir of [home(".config/autostart"), "/etc/xdg/autostart"]) {
      for (const f of listDirSafe(dir)) {
        if (!f.endsWith(".desktop")) continue;
        let text = "";
        try {
          text = readFileSync(path.join(dir, f), "utf8");
        } catch {
          continue;
        }
        if (/^Hidden=true/m.test(text)) continue;
        out.push({ key: `startup:${dir}/${f}`, kind: "startup", name: text.match(/^Name=(.*)$/m)?.[1] ?? f, facts: { where: dir, command: text.match(/^Exec=(.*)$/m)?.[1] ?? "" } });
      }
    }
    const userUnits = home(".config/systemd/user");
    for (const wants of listDirSafe(userUnits).filter((d) => d.endsWith(".wants"))) {
      for (const unit of listDirSafe(path.join(userUnits, wants))) {
        let text = "";
        try {
          text = readFileSync(path.join(userUnits, wants, unit), "utf8");
        } catch {
          try {
            text = readFileSync(path.join(userUnits, unit), "utf8");
          } catch {
            /* none */
          }
        }
        out.push({ key: `startup:systemd-user:${unit}`, kind: "startup", name: unit, facts: { where: "systemd user service", command: text.match(/^ExecStart=(.*)$/m)?.[1] ?? "" } });
      }
    }
    const cron = await run("crontab", ["-l"]);
    for (const line of cron.stdout.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"))) out.push({ key: `startup:cron:${line}`, kind: "startup", name: firstLine(line).slice(0, 80), facts: { where: "crontab", command: line } });
  }
  return out;
};

// ---------- installed apps ----------

export const installedApps = async (): Promise<InventoryItem[]> => {
  const out: InventoryItem[] = [];
  if (OS === "darwin") {
    for (const dir of ["/Applications", home("Applications")]) {
      for (const f of listDirSafe(dir)) {
        if (!f.endsWith(".app")) continue;
        const plist = path.join(dir, f, "Contents/Info.plist");
        let version = "";
        let bundleId = "";
        try {
          const text = readFileSync(plist, "utf8");
          version = plistField(text, "CFBundleShortVersionString") ?? "";
          bundleId = plistField(text, "CFBundleIdentifier") ?? "";
        } catch {
          const r = await run("defaults", ["read", plist.replace(/\.plist$/, ""), "CFBundleShortVersionString"]);
          version = r.stdout.trim();
        }
        out.push({ key: `app:${dir}/${f}`, kind: "app", name: f.replace(/\.app$/, ""), facts: { version, bundleId, path: path.join(dir, f) } });
      }
    }
  } else if (OS === "win32") {
    const r = await powershell(
      `$k='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'; Get-ItemProperty $k -ErrorAction SilentlyContinue | ?{ $_.DisplayName -and -not $_.SystemComponent } | Select-Object DisplayName,DisplayVersion,Publisher,InstallDate | ConvertTo-Json`,
      40_000,
    );
    if (r.stdout.trim()) for (const a of ([] as Array<Record<string, string>>).concat(JSON.parse(r.stdout))) out.push({ key: `app:${a.DisplayName}`, kind: "app", name: a.DisplayName!, facts: { version: a.DisplayVersion ?? "", publisher: a.Publisher ?? "", installDate: a.InstallDate ?? "" } });
  } else {
    // Explicitly installed packages (not dependencies) + Flatpaks.
    const pac = await run("pacman", ["-Qe"]);
    if (pac.ok) for (const line of pac.stdout.trim().split("\n")) { const [n, v] = line.split(" "); if (n) out.push({ key: `app:${n}`, kind: "app", name: n, facts: { version: v ?? "", source: "pacman" } }); }
    else {
      const dpkg = await run("dpkg-query", ["-W", "-f", "${Package} ${Version}\n"]);
      if (dpkg.ok) for (const line of dpkg.stdout.trim().split("\n")) { const [n, v] = line.split(" "); if (n) out.push({ key: `app:${n}`, kind: "app", name: n, facts: { version: v ?? "", source: "dpkg" } }); }
    }
    const fp = await run("flatpak", ["list", "--app", "--columns=application,version"]);
    if (fp.ok) for (const line of fp.stdout.trim().split("\n").filter(Boolean)) { const [n, v] = line.split("\t"); if (n) out.push({ key: `app:flatpak:${n}`, kind: "app", name: n, facts: { version: v ?? "", source: "flatpak" } }); }
    for (const f of listDirSafe(home("Applications")).concat(listDirSafe(home(".local/bin")))) if (/\.AppImage$/i.test(f)) out.push({ key: `app:appimage:${f}`, kind: "app", name: f, facts: { source: "AppImage" } });
  }
  return out;
};

// ---------- downloads ----------

/** File types that can run code or carry it (the ones worth a second look). */
export const RISKY_EXT = /\.(exe|msi|msix|appx|bat|cmd|com|scr|pif|ps1|vbs|vbe|js|jse|wsf|hta|lnk|jar|dmg|pkg|mpkg|app|command|sh|run|appimage|deb|rpm|iso|img|vhd|vhdx|zip|7z|rar|docm|xlsm|pptm|apk|crx|xpi|py)$/i;

export const sha256File = (file: string): Promise<string | undefined> =>
  new Promise((resolve) => {
    try {
      const h = createHash("sha256");
      const s = createReadStream(file);
      s.on("data", (c) => h.update(c));
      s.on("end", () => resolve(h.digest("hex")));
      s.on("error", () => resolve(undefined));
    } catch {
      resolve(undefined);
    }
  });

export const downloadsFolder = (): string => (OS === "win32" ? path.join(process.env.USERPROFILE ?? home(), "Downloads") : home("Downloads"));

/** Risky-type files in Downloads changed since `sinceMs` (top level + one folder down). */
export const recentDownloads = async (sinceMs: number): Promise<InventoryItem[]> => {
  const root = downloadsFolder();
  const out: InventoryItem[] = [];
  const consider = async (file: string) => {
    let st;
    try {
      st = statSync(file);
    } catch {
      return;
    }
    const isAppBundle = OS === "darwin" && file.endsWith(".app") && st.isDirectory();
    if (!st.isFile() && !isAppBundle) return;
    if (Math.max(st.mtimeMs, st.birthtimeMs || 0) < sinceMs) return;
    if (!RISKY_EXT.test(file)) return;
    const facts: Record<string, unknown> = { path: file, bytes: st.size, modified: st.mtimeMs };
    if (OS === "darwin") {
      const from = await run("mdls", ["-raw", "-name", "kMDItemWhereFroms", file], 5000);
      const urls = [...from.stdout.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      if (urls.length) facts.from = urls;
      const sig = await run("codesign", ["-dv", "--verbose=2", file], 8000);
      const team = sig.stderr.match(/Authority=Developer ID Application: (.+)/)?.[1];
      facts.signed = team ? `Developer ID: ${team}` : /not signed/i.test(sig.stderr) ? "not signed" : undefined;
    } else if (OS === "win32") {
      const zone = await powershell(`Get-Content -LiteralPath '${file.replace(/'/g, "''")}' -Stream Zone.Identifier -ErrorAction SilentlyContinue`, 8000);
      const host = zone.stdout.match(/HostUrl=(.+)/)?.[1]?.trim();
      if (host) facts.from = [host];
      if (/\.(exe|msi|msix|appx|dll)$/i.test(file)) {
        const sig = await powershell(`$s=Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`, 10_000);
        facts.signed = sig.stdout.trim();
      }
    }
    if (st.isFile() && st.size < 512 * 1024 * 1024) facts.sha256 = await sha256File(file);
    out.push({ key: `download:${file}:${Math.round(st.mtimeMs)}`, kind: "download", name: path.basename(file), facts });
  };
  for (const f of listDirSafe(root)) {
    const p = path.join(root, f);
    if (RISKY_EXT.test(f)) await consider(p);
    else {
      try {
        if (statSync(p).isDirectory() && statSync(p).mtimeMs >= sinceMs) for (const g of listDirSafe(p).slice(0, 200)) if (RISKY_EXT.test(g)) await consider(path.join(p, g));
      } catch {
        /* skip */
      }
    }
  }
  return out;
};

