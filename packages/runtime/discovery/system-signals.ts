import path from "path";
import os from "os";
import { exec } from "child_process";
import { promises as fs } from "fs";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import {
  acquireCloseable,
  runDiscovery,
  timeoutFallback,
  tryDiscovery,
  tryDiscoverySync,
} from "./effect-io.js";
import type {
  SystemSignals,
  DockPin,
  AppUsageSummary,
  UserIdentitySignal,
  DeviceSignals,
} from "./discovery-types.js";

const log = (...args: unknown[]) => console.error("[system-signals]", ...args);

const execAsync = (command: string, signal?: AbortSignal): Promise<string> => {
  return new Promise((resolve, reject) => {
    exec(command, { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024, windowsHide: true, signal }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type SqliteDatabase = {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
  close(): void;
};

const openDatabase = async (dbPath: string): Promise<SqliteDatabase> => {
  const { Database } = await import("bun:sqlite");
  // Read the live DB directly via an immutable URI: skips locking and reads
  // the main file without its WAL sidecars. Best-effort one-time snapshot.
  const uri = `${pathToFileURL(dbPath).href}?immutable=1`;
  return new Database(uri, { readonly: true }) as SqliteDatabase;
};

async function collectUserIdentity(signal: AbortSignal): Promise<UserIdentitySignal | null> {
  const identity: UserIdentitySignal = {};

  try {
    const info = os.userInfo();
    if (info.username) identity.username = info.username;
  } catch {
    // No passwd entry: the username stays unknown.
  }
  // $HOME, not the passwd entry: a test instance or relocated home points it elsewhere.
  identity.homeDirectory = os.homedir();

  try {
    if (os.platform() === "darwin") {
      const fullName = await execAsync("id -F", signal);
      if (fullName) identity.fullName = fullName;
    } else if (os.platform() === "win32") {
      const fullName = await execAsync("powershell -NoProfile -Command \"[Environment]::UserName\"", signal);
      if (fullName) identity.fullName = fullName;
    }
  } catch {
    // OS account display names are best-effort evidence, not required.
  }

  return identity.username || identity.fullName || identity.homeDirectory
    ? identity
    : null;
}

async function collectDockPins(signal: AbortSignal): Promise<DockPin[]> {
  if (os.platform() !== "darwin") {
    return [];
  }

  try {
    const dockPlistPath = path.join(os.homedir(), "Library/Preferences/com.apple.dock.plist");
    const output = await execAsync(`plutil -convert json -o - "${dockPlistPath}"`, signal);
    const plist = JSON.parse(output);

    const persistentApps = plist["persistent-apps"] || [];
    const pins: DockPin[] = [];

    for (const entry of persistentApps) {
      const tileData = entry["tile-data"];
      if (!tileData) continue;

      const name = tileData["file-label"];
      const fileData = tileData["file-data"];
      const urlString = fileData ? fileData["_CFURLString"] : undefined;

      if (name && urlString) {
        pins.push({ name, path: urlString });
      }
    }

    return pins;
  } catch (error) {
    const message = getErrorMessage(error);
    if (message.includes("invalid object in plist")) {
      log("Dock plist could not be parsed, skipping dock pins");
    } else {
      log("Failed to read dock pins:", message);
    }
    return [];
  }
}

type AppUsageOpenDenied = { readonly _tag: "openDenied" };

const collectAppUsageMacOSEffect: Effect.Effect<AppUsageSummary[]> =
  Effect.scoped(
    Effect.gen(function* () {
      const sourceDb = path.join(
        os.homedir(),
        "Library/Application Support/Knowledge/knowledgeC.db"
      );

      const db = yield* acquireCloseable(() => openDatabase(sourceDb)).pipe(
        Effect.catch((error) => {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EPERM" || code === "EACCES") {
            log("knowledgeC.db access denied - grant Full Disk Access");
            return Effect.fail<AppUsageOpenDenied>({ _tag: "openDenied" });
          }
          return Effect.fail(error);
        }),
      );

      const query = `
      SELECT
        ZVALUESTRING as app,
        SUM(ZENDDATE - ZSTARTDATE) as total_seconds
      FROM ZOBJECT
      WHERE ZSTREAMNAME = '/app/usage'
        AND ZVALUESTRING IS NOT NULL
        AND ZVALUESTRING != ''
        AND ZSTARTDATE > (strftime('%s', 'now') - 978307200 - 604800)
      GROUP BY ZVALUESTRING
      ORDER BY total_seconds DESC
      LIMIT 30
    `;

      const rows = yield* tryDiscoverySync(
        () => db.prepare(query).all() as Array<{ app: string; total_seconds: number }>,
      );
      return processMacAppUsageRows(rows);
    }),
  ).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        if (
          typeof error === "object" &&
          error !== null &&
          (error as AppUsageOpenDenied)._tag === "openDenied"
        ) {
          return [];
        }
        log("Failed to read macOS app usage:", error);
        return [];
      }),
    ),
  );

const processMacAppUsageRows = (
  rows: Array<{ app: string; total_seconds: number }>,
): AppUsageSummary[] => {
  {
    const appUsage: AppUsageSummary[] = rows.map((row) => {
      let appName = row.app;

      if (appName.startsWith("com.apple.")) {
        appName = appName.replace("com.apple.", "");
      }

      const parts = appName.split(".");
      if (parts.length > 1) {
        appName = parts[parts.length - 1];
      }

      appName = appName.charAt(0).toUpperCase() + appName.slice(1);

      const durationMinutes = Math.round(row.total_seconds / 60);

      return {
        app: appName,
        durationMinutes,
      };
    });

    return appUsage.filter((a) => a.durationMinutes > 0);
  }
};

const findWindowsActivitiesCacheDb = async (): Promise<string | null> => {
  const cdpBase = path.join(
    os.homedir(),
    "AppData/Local/ConnectedDevicesPlatform"
  );

  const dirs = await fs.readdir(cdpBase);
  const dbResults = await Promise.all(
    dirs.map(async (dir) => {
      const candidate = path.join(cdpBase, dir, "ActivitiesCache.db");
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        return null;
      }
    })
  );
  return dbResults.find((p) => p !== null) ?? null;
};

const collectAppUsageWindowsEffect: Effect.Effect<AppUsageSummary[]> =
  Effect.scoped(
    Effect.gen(function* () {
      const dbPath = yield* tryDiscovery(() => findWindowsActivitiesCacheDb());

      if (!dbPath) {
        log("ActivitiesCache.db not found");
        return [];
      }

      const db = yield* acquireCloseable(() => openDatabase(dbPath));

      const query = `
        SELECT
          AppId,
          SUM(COALESCE(ActiveDurationSeconds, 0)) as total_seconds
        FROM Activity
        WHERE LastModifiedTime > datetime('now', '-7 days')
        GROUP BY AppId
        ORDER BY total_seconds DESC
        LIMIT 30
      `;
      const fallbackQuery = `
        SELECT
          AppId,
          COUNT(*) as total_seconds
        FROM Activity
        WHERE LastModifiedTime > datetime('now', '-7 days')
        GROUP BY AppId
        ORDER BY total_seconds DESC
        LIMIT 30
      `;
      const rows = yield* tryDiscoverySync(
        () => db.prepare(query).all() as Array<{ AppId: string; total_seconds: number }>,
      ).pipe(
        Effect.catch(() =>
          tryDiscoverySync(
            () =>
              db.prepare(fallbackQuery).all() as Array<{
                AppId: string;
                total_seconds: number;
              }>,
          ),
        ),
      );

      const appUsage: AppUsageSummary[] = rows
        .map((row) => {
          let appName = row.AppId;

          try {
            const parsed = JSON.parse(appName);
            if (parsed.application) {
              appName = parsed.application;
            }
          } catch {
            // Not JSON, use as-is
          }

          if (appName.startsWith("Microsoft.")) {
            appName = appName.replace("Microsoft.", "");
          }

          return {
            app: appName,
            durationMinutes: Math.round((row.total_seconds || 0) / 60),
          };
        })
        .filter((a) => a.durationMinutes > 0);

      return appUsage;
    }),
  ).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        log("Failed to read Windows app usage:", error);
        return [];
      }),
    ),
  );

const collectAppUsageEffect: Effect.Effect<AppUsageSummary[]> = Effect.suspend(
  () => {
    if (os.platform() === "darwin") {
      return collectAppUsageMacOSEffect;
    } else if (os.platform() === "win32") {
      return collectAppUsageWindowsEffect;
    }
    return Effect.succeed([]);
  },
);

async function collectDevice(signal: AbortSignal): Promise<DeviceSignals> {
  const platform = os.platform();
  const cpus = os.cpus();
  const cpu = cpus[0]?.model?.trim() || undefined;
  const cpuCores = cpus.length || undefined;
  const totalMem = os.totalmem();
  const memoryGB = totalMem ? Math.round(totalMem / 1024 ** 3) : undefined;
  const arch =
    process.arch === "arm64"
      ? platform === "darwin"
        ? "Apple Silicon (arm64)"
        : "ARM64"
      : process.arch;

  let osLabel = `${platform} ${os.release()}`;
  let model: string | undefined;

  if (platform === "darwin") {
    try {
      const product = (await execAsync("sw_vers -productVersion", signal)).trim();
      if (product) osLabel = `macOS ${product}`;
    } catch {
      // Keep the os.release() fallback.
    }
    try {
      model = (await execAsync("sysctl -n hw.model", signal)).trim() || undefined;
    } catch {
      // Model is optional.
    }
  } else if (platform === "win32") {
    try {
      const caption = (
        await execAsync(
          'powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).Caption"',
          signal,
        )
      ).trim();
      if (caption) osLabel = caption;
    } catch {
      // Keep the os.release() fallback.
    }
    try {
      const winModel = (
        await execAsync(
          'powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystem).Model"',
          signal,
        )
      ).trim();
      model = winModel || undefined;
    } catch {
      // Model is optional.
    }
  }

  return { os: osLabel, arch, model, cpu, cpuCores, memoryGB };
}

const collectSystemSignalsEffect: Effect.Effect<SystemSignals, unknown> =
  Effect.all(
    [
      timeoutFallback(tryDiscovery(collectUserIdentity), 2000, null),
      timeoutFallback(tryDiscovery(collectDockPins), 3000, []),
      timeoutFallback(collectAppUsageEffect, 10000, []),
      timeoutFallback(tryDiscovery(collectDevice), 4000, null),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map(([userIdentity, dockPins, appUsage, device]) => ({
      userIdentity,
      dockPins,
      appUsage,
      device,
    })),
  );

export async function collectSystemSignals(): Promise<SystemSignals> {
  return runDiscovery(collectSystemSignalsEffect);
}

export function formatSystemSignalsForSynthesis(data: SystemSignals): string {
  const sections: string[] = [];

  if (data.userIdentity) {
    const identitySection = ["### OS Account Identity"];
    if (data.userIdentity.fullName) {
      identitySection.push(`Full Name: ${data.userIdentity.fullName}`);
    }
    if (data.userIdentity.username) {
      identitySection.push(`Username: ${data.userIdentity.username}`);
    }
    if (data.userIdentity.homeDirectory) {
      identitySection.push(`Home Directory: ${data.userIdentity.homeDirectory}`);
    }
    sections.push(identitySection.join("\n"));
  }

  if (data.device) {
    const d = data.device;
    const deviceLines = ["### Device"];
    const head = [d.model, d.os, d.arch].filter(Boolean);
    if (head.length > 0) deviceLines.push(head.join(" · "));
    const specs: string[] = [];
    if (d.cpu) specs.push(d.cpu);
    if (d.cpuCores) specs.push(`${d.cpuCores} cores`);
    if (d.memoryGB) specs.push(`${d.memoryGB} GB RAM`);
    if (specs.length > 0) deviceLines.push(specs.join(", "));
    if (deviceLines.length > 1) sections.push(deviceLines.join("\n"));
  }

  if (data.dockPins.length > 0) {
    const dockSection = ["### Dock/Pinned Apps"];
    for (const pin of data.dockPins) {
      dockSection.push(`${pin.name} (${pin.path})`);
    }
    sections.push(dockSection.join("\n"));
  }

  if (data.appUsage.length > 0) {
    const appSection = ["### App Usage (Screen Time)"];
    for (const app of data.appUsage) {
      const hours = Math.floor(app.durationMinutes / 60);
      const minutes = app.durationMinutes % 60;
      if (hours > 0) {
        appSection.push(`${app.app}: ${hours}h ${minutes}m`);
      } else {
        appSection.push(`${app.app}: ${minutes}m`);
      }
    }
    sections.push(appSection.join("\n"));
  }

  if (sections.length === 0) {
    return "";
  }

  return `## System Signals\n${sections.join("\n\n")}`;
}
