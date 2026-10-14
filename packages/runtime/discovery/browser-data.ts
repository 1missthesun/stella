import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { z } from "zod";
import { Effect } from "effect";
import { mainMemoryPath } from "../kernel/memory/memory-layout.js";
import {
  acquireCloseable,
  runDiscovery,
  tryDiscovery,
  tryDiscoverySync,
} from "./effect-io.js";
import type {
  BrowserType,
  PreferredBrowserProfile,
  BrowserProfile,
} from "@stella/contracts";
import { openSqliteSnapshot } from "./sqlite-snapshot.js";
import type {
  BrowserAccount,
  BrowserVisit,
  BrowserVisitSource,
} from "./browsing-digest.js";

export type {
  BrowserType,
  PreferredBrowserProfile,
  BrowserProfile,
}

export type BrowserCollectionOptions = {
  selectedBrowser?: BrowserType | null;
  selectedProfile?: string | null;
};

type SqliteDatabase = {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
  close(): void;
};

const openDatabase = (dbPath: string): Promise<SqliteDatabase> =>
  openSqliteSnapshot(dbPath);

const log = (...args: unknown[]) => console.error("[browser-data]", ...args);

type BrowserConfig = {
  type: BrowserType;
  paths: {
    win32: string[];
    darwin: string[];
    linux: string[];
  };
};

const PROFILE_VARIANTS = ["Default", "Profile 1", "Profile 2", "Profile 3"];

const generateProfilePaths = (basePath: string): string[] => {
  return PROFILE_VARIANTS.map((profile) =>
    basePath.replace("/Default/", `/${profile}/`)
  );
};

const BROWSER_CONFIGS: BrowserConfig[] = [
  {
    type: "chrome",
    paths: {
      win32: [
        ...generateProfilePaths("Google/Chrome/User Data/Default/History"),
        ...generateProfilePaths("Google/Chrome/User/Default/History"),
        ...generateProfilePaths("Google/Chrome Beta/User Data/Default/History"),
        ...generateProfilePaths("Google/Chrome SxS/User Data/Default/History"),
      ],
      darwin: [
        ...generateProfilePaths("Google/Chrome/Default/History"),
        ...generateProfilePaths("Google/Chrome Beta/Default/History"),
        ...generateProfilePaths("Google/Chrome Canary/Default/History"),
      ],
      linux: [
        ...generateProfilePaths(".config/google-chrome/Default/History"),
        ...generateProfilePaths(".config/google-chrome-beta/Default/History"),
        ...generateProfilePaths(".config/chromium/Default/History"),
      ],
    },
  },
  {
    type: "arc",
    paths: {
      win32: [
        ...generateProfilePaths("Arc/User Data/Default/History"),
      ],
      darwin: [
        ...generateProfilePaths("Arc/User Data/Default/History"),
      ],
      linux: [],
    },
  },
  {
    type: "edge",
    paths: {
      win32: [
        ...generateProfilePaths("Microsoft/Edge/User Data/Default/History"),
        ...generateProfilePaths("Microsoft/Edge/User/Default/History"),
        ...generateProfilePaths("Microsoft/Edge Beta/User Data/Default/History"),
        ...generateProfilePaths("Microsoft/Edge Dev/User Data/Default/History"),
      ],
      darwin: [
        ...generateProfilePaths("Microsoft Edge/Default/History"),
        ...generateProfilePaths("Microsoft Edge Beta/Default/History"),
      ],
      linux: [
        ...generateProfilePaths(".config/microsoft-edge/Default/History"),
        ...generateProfilePaths(".config/microsoft-edge-beta/Default/History"),
      ],
    },
  },
  {
    type: "brave",
    paths: {
      win32: [
        ...generateProfilePaths("BraveSoftware/Brave-Browser/User Data/Default/History"),
        ...generateProfilePaths("BraveSoftware/Brave-Browser/User/Default/History"),
      ],
      darwin: [
        ...generateProfilePaths("BraveSoftware/Brave-Browser/Default/History"),
      ],
      linux: [
        ...generateProfilePaths(".config/BraveSoftware/Brave-Browser/Default/History"),
      ],
    },
  },
  {
    type: "opera",
    paths: {
      win32: [
        "Opera Software/Opera Stable/History",
        "Opera Software/Opera GX Stable/History",
      ],
      darwin: [
        "com.operasoftware.Opera/History",
        "com.operasoftware.OperaGX/History",
      ],
      linux: [
        ".config/opera/History",
      ],
    },
  },
  {
    type: "vivaldi",
    paths: {
      win32: [
        ...generateProfilePaths("Vivaldi/User Data/Default/History"),
      ],
      darwin: [
        ...generateProfilePaths("Vivaldi/Default/History"),
      ],
      linux: [
        ...generateProfilePaths(".config/vivaldi/Default/History"),
      ],
    },
  },
];

const execAsync = (command: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    exec(command, { encoding: "utf-8", windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
};

const BROWSER_PROCESSES: Record<BrowserType, Record<string, string[]>> = {
  chrome: {
    win32: ["chrome.exe"],
    darwin: ["Google Chrome"],
    linux: ["chrome", "google-chrome", "chromium"],
  },
  edge: {
    win32: ["msedge.exe"],
    darwin: ["Microsoft Edge"],
    linux: ["msedge", "microsoft-edge"],
  },
  brave: {
    win32: ["brave.exe"],
    darwin: ["Brave Browser"],
    linux: ["brave", "brave-browser"],
  },
  arc: {
    win32: ["Arc.exe"],
    darwin: ["Arc"],
    linux: [],
  },
  opera: {
    win32: ["opera.exe"],
    darwin: ["Opera"],
    linux: ["opera"],
  },
  vivaldi: {
    win32: ["vivaldi.exe"],
    darwin: ["Vivaldi"],
    linux: ["vivaldi"],
  },
};

const detectRunningBrowsers = async (): Promise<BrowserType[]> => {
  const platform = process.platform;
  const running: BrowserType[] = [];

  try {
    let processList: string;

    if (platform === "win32") {
      processList = await execAsync("tasklist /FO CSV /NH");
    } else if (platform === "darwin") {
      processList = await execAsync("ps -eo comm");
    } else {
      processList = await execAsync("ps -eo comm");
    }

    const processListLower = processList.toLowerCase();

    const browserOrder: BrowserType[] = ["chrome", "arc", "edge", "brave", "opera", "vivaldi"];

    for (const browser of browserOrder) {
      const processNames = BROWSER_PROCESSES[browser]?.[platform] || [];
      
      for (const processName of processNames) {
        if (processListLower.includes(processName.toLowerCase())) {
          running.push(browser);
          break;
        }
      }
    }

    if (running.length > 0) {
      log("Running browsers detected:", running);
    }
  } catch (error) {
    log("Failed to detect running browsers:", error);
  }

  return running;
};

const detectDefaultBrowserWindows = async (): Promise<BrowserType | null> => {
  try {
    const output = await execAsync(
      'reg query "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice" /v ProgId'
    );
    
    const progId = output.toLowerCase();
    log("Registry ProgId output:", progId);
    
    if (progId.includes("chromehtm") || progId.includes("chromehtml")) return "chrome";
    if (progId.includes("msedge") || progId.includes("edgehtm")) return "edge";
    if (progId.includes("bravehtm") || progId.includes("bravehtml")) return "brave";
    if (progId.includes("archtml") || progId.includes("archtm")) return "arc";
    if (progId.includes("operahtml") || progId.includes("operahtm")) return "opera";
    if (progId.includes("vivaldi")) return "vivaldi";
    
    log("Could not match ProgId to a supported browser");
    return null;
  } catch (error) {
    log("Failed to detect default browser on Windows:", error);
    return null;
  }
};

const detectDefaultBrowserMac = async (): Promise<BrowserType | null> => {
  try {
    const output = await execAsync(
      "defaults read ~/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers 2>/dev/null | grep -A2 'LSHandlerURLScheme = http;' | grep LSHandlerRoleAll | head -1"
    );
    
    const bundleId = output.toLowerCase();
    
    if (bundleId.includes("chrome")) return "chrome";
    if (bundleId.includes("edge")) return "edge";
    if (bundleId.includes("brave")) return "brave";
    if (bundleId.includes("arc")) return "arc";
    if (bundleId.includes("opera")) return "opera";
    if (bundleId.includes("vivaldi")) return "vivaldi";
    
    log("Default browser bundle ID:", bundleId);
    return null;
  } catch {
    try {
      const output = await execAsync(
        "perl -MMac::InternetConfig -le 'print +(GetICHelper \"http\")[1]' 2>/dev/null || true"
      );
      const app = output.toLowerCase();
      if (app.includes("chrome")) return "chrome";
      if (app.includes("safari")) return null;
    } catch {
      // Ignore
    }
    return null;
  }
};

const detectDefaultBrowserLinux = async (): Promise<BrowserType | null> => {
  try {
    const output = await execAsync("xdg-settings get default-web-browser 2>/dev/null");
    const desktop = output.toLowerCase();
    
    if (desktop.includes("chrome") || desktop.includes("chromium")) return "chrome";
    if (desktop.includes("edge")) return "edge";
    if (desktop.includes("brave")) return "brave";
    if (desktop.includes("opera")) return "opera";
    if (desktop.includes("vivaldi")) return "vivaldi";
    
    log("Default browser desktop file:", desktop);
    return null;
  } catch {
    return null;
  }
};

const detectDefaultBrowser = async (): Promise<BrowserType | null> => {
  const platform = process.platform;
  
  switch (platform) {
    case "win32":
      return detectDefaultBrowserWindows();
    case "darwin":
      return detectDefaultBrowserMac();
    case "linux":
      return detectDefaultBrowserLinux();
    default:
      return null;
  }
};

const BROWSER_BASE_DIRS: Record<BrowserType, Record<string, string>> = {
  chrome: {
    win32: "Google/Chrome/User Data",
    win32Alt: "Google/Chrome/User",
    darwin: "Google/Chrome",
    linux: ".config/google-chrome",
  },
  edge: {
    win32: "Microsoft/Edge/User Data",
    darwin: "Microsoft Edge",
    linux: ".config/microsoft-edge",
  },
  brave: {
    win32: "BraveSoftware/Brave-Browser/User Data",
    darwin: "BraveSoftware/Brave-Browser",
    linux: ".config/BraveSoftware/Brave-Browser",
  },
  arc: {
    win32: "Arc/User Data",
    darwin: "Arc/User Data",
    linux: "",
  },
  opera: {
    win32: "Opera Software/Opera Stable",
    darwin: "com.operasoftware.Opera",
    linux: ".config/opera",
  },
  vivaldi: {
    win32: "Vivaldi/User Data",
    darwin: "Vivaldi",
    linux: ".config/vivaldi",
  },
};

const getMostRecentlyUsedProfile = async (browserType: BrowserType): Promise<string> => {
  const platform = process.platform;
  const basePath = getBasePath(platform);
  
  const browserDirs = [
    BROWSER_BASE_DIRS[browserType]?.[platform as string],
    platform === "win32" ? BROWSER_BASE_DIRS[browserType]?.win32Alt : null,
  ].filter(Boolean) as string[];
  
  if (browserDirs.length === 0) return "Default";
  
  const profilePatterns = ["Default", "Profile 1", "Profile 2", "Profile 3", "Profile 4", "Profile 5"];
  
  const profileChecks = browserDirs.flatMap((browserDir) => {
    const userDataPath = path.join(basePath, browserDir);
    return profilePatterns.map(async (profile) => {
      const profilePath = path.join(userDataPath, profile);
      try {
        const stat = await fs.stat(profilePath);
        if (!stat.isDirectory()) return null;
        const historyPath = path.join(profilePath, "History");
        try {
          const historyStat = await fs.stat(historyPath);
          return { profile, mtime: historyStat.mtimeMs };
        } catch {
          return { profile, mtime: stat.mtimeMs };
        }
      } catch {
        return null;
      }
    });
  });

  const profileResults = await Promise.all(profileChecks);
  let mostRecentProfile = "Default";
  let mostRecentTime = 0;
  for (const result of profileResults) {
    if (result && result.mtime > mostRecentTime) {
      mostRecentTime = result.mtime;
      mostRecentProfile = result.profile;
    }
  }
  
  if (mostRecentTime > 0) {
    const lastModified = new Date(mostRecentTime).toISOString();
    log(`Most recent profile for ${browserType}: ${mostRecentProfile} (last modified: ${lastModified})`);
  }
  
  return mostRecentProfile;
};

const getHistoryPathForBrowserProfile = async (
  browserType: BrowserType,
  profile: string
): Promise<string | null> => {
  const platform = process.platform;
  const basePath = getBasePath(platform);
  
  const browserDir = BROWSER_BASE_DIRS[browserType]?.[platform as string];
  if (!browserDir) return null;
  
  const historyPath = path.join(basePath, browserDir, profile, "History");
  try {
    await fs.access(historyPath);
    return historyPath;
  } catch {
    if (platform === "win32" && BROWSER_BASE_DIRS[browserType]?.win32Alt) {
      const altDir = BROWSER_BASE_DIRS[browserType].win32Alt;
      const altHistoryPath = path.join(basePath, altDir, profile, "History");
      try {
        await fs.access(altHistoryPath);
        return altHistoryPath;
      } catch {
        // Path doesn't exist
      }
    }
  }
  
  return null;
};

const getBasePath = (platform: NodeJS.Platform): string => {
  const home = os.homedir();
  switch (platform) {
    case "win32":
      return process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    case "darwin":
      return path.join(home, "Library", "Application Support");
    default:
      return home;
  }
};

const getBrowserHistoryPaths = (
  browserType: BrowserType,
  platform: NodeJS.Platform
): string[] => {
  const config = BROWSER_CONFIGS.find((c) => c.type === browserType);
  if (!config) return [];

  const basePath = getBasePath(platform);
  const relativePaths = config.paths[platform as keyof typeof config.paths];
  if (!relativePaths || relativePaths.length === 0) return [];

  return relativePaths.map((rel) => path.join(basePath, rel));
};

const parseProfileFromHistoryPath = (historyPath: string): string | null => {
  const segments = historyPath.split(/[\\/]+/).filter(Boolean);
  const profile = segments.find((segment) =>
    segment === "Default" || /^Profile \d+$/i.test(segment)
  );
  return profile ?? null;
};


const findMostRecentlyModifiedBrowser = async (): Promise<{
  type: BrowserType;
  historyPath: string;
  mtime: number;
} | null> => {
  const candidateResults = await Promise.all(
    BROWSER_CONFIGS.map(async (config) => {
      const recentProfile = await getMostRecentlyUsedProfile(config.type);
      const historyPath = await getHistoryPathForBrowserProfile(config.type, recentProfile);
      if (!historyPath) return null;
      try {
        const stat = await fs.stat(historyPath);
        return { type: config.type, historyPath, mtime: stat.mtimeMs };
      } catch {
        return null;
      }
    })
  );
  const candidates = candidateResults.filter(
    (c): c is { type: BrowserType; historyPath: string; mtime: number } => c !== null
  );

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.mtime - a.mtime);
  
  const winner = candidates[0];
  log(`Most recently modified browser: ${winner.type} (modified ${new Date(winner.mtime).toISOString()})`);
  
  return winner;
};

const resolveSelectedBrowser = async (
  options: BrowserCollectionOptions,
): Promise<{
  type: BrowserType;
  historyPath: string;
  profile: string | null;
} | null> => {
  const { selectedBrowser, selectedProfile } = options;
  if (!selectedBrowser) return null;

  if (selectedProfile) {
    const historyPath = await getHistoryPathForBrowserProfile(
      selectedBrowser,
      selectedProfile,
    );
    if (historyPath) {
      log(
        `Using selected browser/profile: ${selectedBrowser} (${selectedProfile}) at ${historyPath}`,
      );
      return {
        type: selectedBrowser,
        historyPath,
        profile: selectedProfile,
      };
    }

    log(
      `Selected browser/profile not accessible, falling back to another profile in ${selectedBrowser}: ${selectedProfile}`,
    );
  }

  const lastProfile = await getMostRecentlyUsedProfile(selectedBrowser);
  const historyPath = await getHistoryPathForBrowserProfile(
    selectedBrowser,
    lastProfile,
  );
  if (historyPath) {
    log(
      `Using selected browser: ${selectedBrowser} (${lastProfile} profile) at ${historyPath}`,
    );
    return {
      type: selectedBrowser,
      historyPath,
      profile: lastProfile,
    };
  }

  if (lastProfile !== "Default") {
    const defaultHistoryPath = await getHistoryPathForBrowserProfile(
      selectedBrowser,
      "Default",
    );
    if (defaultHistoryPath) {
      log(
        `Using selected browser default profile: ${selectedBrowser} (Default) at ${defaultHistoryPath}`,
      );
      return {
        type: selectedBrowser,
        historyPath: defaultHistoryPath,
        profile: "Default",
      };
    }
  }

  const platform = process.platform;
  const historyPaths = getBrowserHistoryPaths(selectedBrowser, platform);
  for (const fallbackHistoryPath of historyPaths) {
    try {
      await fs.access(fallbackHistoryPath);
      const fallbackProfile = parseProfileFromHistoryPath(fallbackHistoryPath);
      log(
        `Using selected browser fallback path: ${selectedBrowser} (${fallbackProfile ?? "unknown profile"}) at ${fallbackHistoryPath}`,
      );
      return {
        type: selectedBrowser,
        historyPath: fallbackHistoryPath,
        profile: fallbackProfile,
      };
    } catch {
      continue;
    }
  }

  log(`Selected browser ${selectedBrowser} has no accessible history`);
  return null;
};

const findBrowserWithOptions = async (
  options: BrowserCollectionOptions = {},
): Promise<{
  type: BrowserType;
  historyPath: string;
  profile: string | null;
} | null> => {
  if (options.selectedBrowser) {
    return resolveSelectedBrowser(options);
  }

  const platform = process.platform;

  log("Detecting running browsers and OS default browser...");
  const [runningBrowsers, defaultBrowser] = await Promise.all([
    detectRunningBrowsers(),
    detectDefaultBrowser(),
  ]);

  if (runningBrowsers.length > 0) {
    for (const browser of runningBrowsers) {
      const lastProfile = await getMostRecentlyUsedProfile(browser);
      const historyPath = await getHistoryPathForBrowserProfile(browser, lastProfile);

      if (historyPath) {
        log(`Found ${browser} history (currently running, ${lastProfile} profile) at: ${historyPath}`);
        return { type: browser, historyPath, profile: lastProfile };
      }
    }
    log("Running browsers detected but history not accessible, continuing...");
  }

  if (defaultBrowser) {
    log(`OS default browser: ${defaultBrowser}`);

    const lastProfile = await getMostRecentlyUsedProfile(defaultBrowser);
    const historyPath = await getHistoryPathForBrowserProfile(defaultBrowser, lastProfile);

    if (historyPath) {
      log(`Found ${defaultBrowser} history (OS default, ${lastProfile} profile) at: ${historyPath}`);
      return { type: defaultBrowser, historyPath, profile: lastProfile };
    }

    if (lastProfile !== "Default") {
      const defaultHistoryPath = await getHistoryPathForBrowserProfile(defaultBrowser, "Default");
      if (defaultHistoryPath) {
        log(`Found ${defaultBrowser} history (OS default, Default profile) at: ${defaultHistoryPath}`);
        return { type: defaultBrowser, historyPath: defaultHistoryPath, profile: "Default" };
      }
    }

    log(`OS default browser ${defaultBrowser} detected but history not accessible, falling back...`);
  } else {
    log("Could not detect OS default browser, trying most recently modified...");
  }

  log("Finding most recently modified browser...");
  const mostRecent = await findMostRecentlyModifiedBrowser();
  
  if (mostRecent) {
    log(`Using most recently modified: ${mostRecent.type} at ${mostRecent.historyPath}`);
    return {
      type: mostRecent.type,
      historyPath: mostRecent.historyPath,
      profile: parseProfileFromHistoryPath(mostRecent.historyPath),
    };
  }

  log("Most recent detection failed, checking all browsers in priority order...");
  for (const config of BROWSER_CONFIGS) {
    const historyPaths = getBrowserHistoryPaths(config.type, platform);
    for (const historyPath of historyPaths) {
      try {
        await fs.access(historyPath);
        log(`Found ${config.type} history at: ${historyPath}`);
        return {
          type: config.type,
          historyPath,
          profile: parseProfileFromHistoryPath(historyPath),
        };
      } catch {
        continue;
      }
    }
  }

  log("No browser history found");
  return null;
};

const CHROME_EPOCH_OFFSET_MS = 11644473600000;
const MAX_VISIT_ROWS = 60_000;

const RECENT_VISITS_QUERY = `
SELECT u.url AS url, u.title AS title, (v.visit_time / 1000) - ${CHROME_EPOCH_OFFSET_MS} AS time
FROM visits v
JOIN urls u ON u.id = v.url
WHERE v.visit_time > ?
ORDER BY v.visit_time DESC
LIMIT ${MAX_VISIT_ROWS}
`;

const accountInfoSchema = z.array(
  z.looseObject({ full_name: z.string().optional(), email: z.string().optional() }),
);
const chromiumPreferencesSchema = z.looseObject({
  account_info: z.unknown().optional(),
  intl: z.looseObject({ accept_languages: z.string().optional() }).optional(),
});

const readChromiumProfileHints = async (
  historyPath: string,
): Promise<{ accounts: BrowserAccount[]; languages: string | null }> => {
  const raw = await fs
    .readFile(path.join(path.dirname(historyPath), "Preferences"), "utf-8")
    .catch(() => null);
  if (!raw) return { accounts: [], languages: null };
  try {
    const prefs = chromiumPreferencesSchema.parse(JSON.parse(raw));
    const accounts = accountInfoSchema.safeParse(prefs.account_info);
    return {
      accounts: accounts.success
        ? accounts.data.map((account) => ({
            name: account.full_name?.trim() || undefined,
            email: account.email?.trim() || undefined,
          }))
        : [],
      languages: prefs.intl?.accept_languages?.trim() || null,
    };
  } catch {
    return { accounts: [], languages: null };
  }
};

export const readChromiumVisits = (
  options: BrowserCollectionOptions,
  sinceMs: number,
): Promise<BrowserVisitSource | null> =>
  runDiscovery(
    Effect.gen(function* () {
      const browser = yield* tryDiscovery(() => findBrowserWithOptions(options));
      if (!browser) return null;
      const visits = yield* Effect.scoped(
        Effect.gen(function* () {
          const db = yield* acquireCloseable(() => openDatabase(browser.historyPath));
          return yield* tryDiscoverySync(
            () =>
              db
                .prepare(RECENT_VISITS_QUERY)
                .all((sinceMs + CHROME_EPOCH_OFFSET_MS) * 1000) as BrowserVisit[],
          );
        }),
      ).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            log("Error reading browser history:", error);
            return [] as BrowserVisit[];
          }),
        ),
      );
      const hints = yield* tryDiscovery(() => readChromiumProfileHints(browser.historyPath));
      log(`Read ${visits.length} visits from ${browser.type}`);
      return { browser: browser.type, visits, ...hints };
    }),
  );

type LocationProvider = {
  url: string;
  extract: (body: Record<string, unknown>) => {
    city?: unknown;
    region?: unknown;
    postal?: unknown;
    country?: unknown;
  };
};

const LOCATION_PROVIDERS: LocationProvider[] = [
  {
    url: "https://ipwho.is/",
    extract: (b) => ({
      city: b.city,
      region: b.region,
      postal: b.postal,
      country: b.country,
    }),
  },
  {
    url: "https://get.geojs.io/v1/ip/geo.json",
    extract: (b) => ({
      city: b.city,
      region: b.region,
      postal: undefined,
      country: b.country,
    }),
  },
];

const jsonRecordSchema = z.record(z.string(), z.unknown());

const profileInfoSchema = z.looseObject({
  name: z.string().optional(),
  gaia_name: z.string().optional(),
});

const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  jsonRecordSchema.safeParse(value).success;

const asTrimmed = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const extractLocationLine = (
  provider: LocationProvider,
  body: Record<string, unknown>,
): string | null => {
  // ipwho.is uses `success:false`; ipapi.co uses `error:true` on failure.
  if (body.success === false || body.error === true) return null;
  const fields = provider.extract(body);
  const city = asTrimmed(fields.city);
  const region = asTrimmed(fields.region);
  const postal = asTrimmed(fields.postal);
  const country = asTrimmed(fields.country);
  if (!city || !country) return null;
  const cityRegion = region ? `${city}, ${region}` : city;
  const cityRegionPostal = postal ? `${cityRegion} ${postal}` : cityRegion;
  return `${cityRegionPostal}, ${country}`;
};

const fetchLocationFromProviderEffect = (
  provider: LocationProvider,
  deadline: number,
): Effect.Effect<string | null> =>
  Effect.suspend(() => {
    const budget = deadline - Date.now();
    if (budget <= 0) return Effect.succeed(null);
    return Effect.tryPromise({
      try: (signal) =>
        fetch(provider.url, {
          signal,
          headers: { accept: "application/json" },
        }),
      catch: (error) => error,
    }).pipe(
      Effect.flatMap((response) => {
        if (!response.ok) {
          log(`Location lookup ${provider.url} HTTP ${response.status}`);
          return Effect.succeed(null);
        }
        return tryDiscovery(() => response.json() as Promise<unknown>).pipe(
          Effect.map((parsed) =>
            isJsonRecord(parsed) ? extractLocationLine(provider, parsed) : null,
          ),
        );
      }),
      Effect.timeout(Math.min(budget, 5_000)),
      Effect.catch((error) =>
        Effect.sync(() => {
          log(`Location lookup ${provider.url} failed:`, error);
          return null;
        }),
      ),
    );
  });

/**
 * Resolve the user's coarse location via IP geolocation. The app's very first
 * network call can hit cold DNS/TLS (and a VPN adds latency), so a single
 * best-effort request dropped location too often — and once core memory is
 * written without it, it never retries. Retries across providers within a
 * bounded total budget so a transient blip doesn't permanently lose location,
 * while still failing fast (and not blocking onboarding) when truly offline.
 */
const fetchUserLocationLineEffect: Effect.Effect<string | null> = Effect.gen(
  function* () {
    const deadline = Date.now() + 12_000;
    let attempt = 0;
    while (Date.now() < deadline) {
      for (const provider of LOCATION_PROVIDERS) {
        if (Date.now() >= deadline) break;
        const line = yield* fetchLocationFromProviderEffect(provider, deadline);
        if (line) return line;
      }
      attempt += 1;
      if (Date.now() < deadline) {
        yield* Effect.sleep(Math.min(500 * attempt, 1_500));
      }
    }
    log("Location lookup exhausted retries");
    return null;
  },
);

const WHO_HEADING = "## Who the user is";

const MAIN_MEMORY_TEMPLATE = (who: string) =>
  [
    "# Memory",
    "",
    "## Areas",
    "",
    WHO_HEADING,
    who,
    "",
    "## How the user wants Stella to work",
    "",
    "## Global rules",
    "",
  ].join("\n");

const withWhoSection = (existing: string | null, who: string): string => {
  if (!existing?.trim()) return MAIN_MEMORY_TEMPLATE(who);
  const start = existing.indexOf(WHO_HEADING);
  if (start === -1) return `${existing.trimEnd()}\n\n${WHO_HEADING}\n${who}\n`;
  const bodyStart = start + WHO_HEADING.length;
  const next = existing.indexOf("\n## ", bodyStart);
  return `${existing.slice(0, bodyStart)}\n${who}\n${next === -1 ? "" : existing.slice(next)}`;
};

export const writeCoreMemory = async (
  StellaDataDir: string,
  content: string,
  options?: { includeLocation?: boolean }
): Promise<void> =>
  runDiscovery(
    Effect.gen(function* () {
      const filePath = mainMemoryPath(StellaDataDir);
      yield* tryDiscovery(() =>
        fs.mkdir(path.dirname(filePath), { recursive: true }),
      );
      const location = options?.includeLocation
        ? yield* fetchUserLocationLineEffect
        : null;
      const who = location
        ? `${content.trim()}\n- Approximate location (from IP): ${location}`
        : content.trim();
      const existing = yield* tryDiscovery(() =>
        fs.readFile(filePath, "utf-8"),
      ).pipe(Effect.catch(() => Effect.succeed(null)));
      yield* tryDiscovery(() =>
        fs.writeFile(filePath, withWhoSection(existing, who), "utf-8"),
      );
      log(`Wrote ~/.stella/memories/main.md${location ? " (with location)" : ""}`);
    }),
  );

export const detectPreferredBrowserProfile = async (): Promise<PreferredBrowserProfile> =>
  runDiscovery(
    tryDiscovery(() => findBrowserWithOptions()).pipe(
      Effect.map((browser) => {
        if (!browser) {
          return { browser: null, profile: null };
        }
        return {
          browser: browser.type,
          profile: browser.profile,
        };
      }),
    ),
  );

const listBrowserProfilesEffect = (
  browserType: BrowserType,
): Effect.Effect<BrowserProfile[], unknown> =>
  Effect.gen(function* () {
    const platform = process.platform;
    const basePath = getBasePath(platform);

    const browserDirs = [
      BROWSER_BASE_DIRS[browserType]?.[platform as string],
      platform === "win32" ? BROWSER_BASE_DIRS[browserType]?.win32Alt : null,
    ].filter(Boolean) as string[];

    if (browserDirs.length === 0) return [];

    const displayNames = new Map<string, string>();
    for (const browserDir of browserDirs) {
      const localStatePath = path.join(basePath, browserDir, "Local State");
      yield* tryDiscovery(() => fs.readFile(localStatePath, "utf-8")).pipe(
        Effect.flatMap((raw) =>
          tryDiscoverySync(() => {
            const localState = JSON.parse(raw);
            const infoCache = localState?.profile?.info_cache;
            if (infoCache && typeof infoCache === "object") {
              for (const [profileId, info] of Object.entries(infoCache)) {
                const profileInfo = profileInfoSchema.safeParse(info);
                const name = profileInfo.success
                  ? (profileInfo.data.name ?? profileInfo.data.gaia_name ?? profileId)
                  : profileId;
                displayNames.set(profileId, name);
              }
            }
          }),
        ),
        Effect.catch(() => Effect.void),
      );
    }

    const profilePatterns = ["Default", "Profile 1", "Profile 2", "Profile 3", "Profile 4", "Profile 5",
      "Profile 6", "Profile 7", "Profile 8", "Profile 9", "Profile 10"];

    const checks = browserDirs.flatMap((browserDir) => {
      const userDataPath = path.join(basePath, browserDir);
      return profilePatterns.map((profile) =>
        tryDiscovery(async (): Promise<BrowserProfile | null> => {
          const profilePath = path.join(userDataPath, profile);
          const stat = await fs.stat(profilePath);
          if (!stat.isDirectory()) return null;
          await fs.access(path.join(profilePath, "History"));
          return {
            id: profile,
            name: displayNames.get(profile) ?? profile,
          };
        }).pipe(Effect.catch(() => Effect.succeed(null))),
      );
    });

    const results = yield* Effect.all(checks, { concurrency: "unbounded" });
    const seen = new Set<string>();
    const profiles: BrowserProfile[] = [];
    for (const r of results) {
      if (r && !seen.has(r.id)) {
        seen.add(r.id);
        profiles.push(r);
      }
    }

    log(`Found ${profiles.length} profile(s) for ${browserType}:`, profiles.map(p => `${p.id} (${p.name})`));
    return profiles;
  });

export const listBrowserProfiles = async (browserType: BrowserType): Promise<BrowserProfile[]> => {
  return runDiscovery(listBrowserProfilesEffect(browserType));
};
