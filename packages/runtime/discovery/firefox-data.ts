import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { Effect } from "effect";
import {
  acquireCloseable,
  runDiscovery,
  tryDiscovery,
  tryDiscoverySync,
} from "./effect-io.js";
import { openSqliteSnapshot } from "./sqlite-snapshot.js";
import type { BrowserVisit, BrowserVisitSource } from "./browsing-digest.js";

const log = (...args: unknown[]) => console.error("[firefox-data]", ...args);

const getFirefoxProfilesDir = (): string => {
  const home = os.homedir();
  const platform = process.platform;

  if (platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(home, "AppData", "Roaming"),
      "Mozilla", "Firefox", "Profiles",
    );
  } else if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Firefox", "Profiles");
  } else {
    return path.join(home, ".mozilla", "firefox");
  }
};

const findActiveProfile = async (): Promise<string | null> => {
  const profilesDir = getFirefoxProfilesDir();

  try {
    const entries = await fs.readdir(profilesDir);

    const preferred = entries.find((e) => e.endsWith(".default-release"))
      ?? entries.find((e) => e.endsWith(".default"))
      ?? entries.find((e) => e.includes("default"));

    if (preferred) {
      const profilePath = path.join(profilesDir, preferred);
      const placesPath = path.join(profilePath, "places.sqlite");
      try {
        await fs.access(placesPath);
        return profilePath;
      } catch {
        // places.sqlite doesn't exist
      }
    }

    for (const entry of entries) {
      const placesPath = path.join(profilesDir, entry, "places.sqlite");
      try {
        await fs.access(placesPath);
        return path.join(profilesDir, entry);
      } catch {
        // try next
      }
    }
  } catch {
    // profiles dir doesn't exist
  }

  return null;
};

const RECENT_VISITS_QUERY = `
SELECT p.url AS url, p.title AS title, v.visit_date / 1000 AS time
FROM moz_historyvisits v
JOIN moz_places p ON p.id = v.place_id
WHERE v.visit_date > ?
ORDER BY v.visit_date DESC
LIMIT 60000
`;

const BOOKMARKS_QUERY = `
SELECT b.title AS title, p.url AS url, parent.title AS folder, b.dateAdded / 1000 AS addedAt
FROM moz_bookmarks b
JOIN moz_places p ON b.fk = p.id
LEFT JOIN moz_bookmarks parent ON b.parent = parent.id
WHERE b.type = 1 AND p.url NOT LIKE 'place:%'
ORDER BY b.dateAdded DESC
LIMIT 200
`;

export const readFirefoxVisits = (sinceMs: number): Promise<BrowserVisitSource | null> =>
  runDiscovery(
    Effect.gen(function* () {
      const profilePath = yield* tryDiscovery(() => findActiveProfile());
      if (!profilePath) return null;
      const sourcePath = path.join(profilePath, "places.sqlite");
      const visits = yield* Effect.scoped(
        Effect.gen(function* () {
          const db = yield* acquireCloseable(() => openSqliteSnapshot(sourcePath));
          return yield* tryDiscoverySync(() => ({
            visits: db.prepare(RECENT_VISITS_QUERY).all(sinceMs * 1000) as BrowserVisit[],
            bookmarks: (
              db.prepare(BOOKMARKS_QUERY).all() as {
                title: string | null;
                url: string;
                folder: string | null;
                addedAt: number | null;
              }[]
            ).map((row) => ({
              title: row.title ?? "",
              url: row.url,
              ...(row.folder ? { folder: row.folder } : {}),
              ...(row.addedAt ? { addedAt: row.addedAt } : {}),
            })),
          }));
        }),
      );
      log(`Read ${visits.visits.length} Firefox visits`);
      return { browser: "firefox", ...visits, accounts: [], languages: null } satisfies BrowserVisitSource;
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          log("Failed to read Firefox history:", error);
          return null;
        }),
      ),
    ),
  );
