import { promises as fs } from "fs";
import { execFile } from "child_process";
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
import type { BrowserBookmark, BrowserVisit, BrowserVisitSource } from "./browsing-digest.js";

const log = (...args: unknown[]) => console.error("[safari-data]", ...args);

const CF_ABSOLUTE_EPOCH_S = 978307200;

const RECENT_VISITS_QUERY = `
SELECT hi.url AS url, hv.title AS title, (hv.visit_time + ${CF_ABSOLUTE_EPOCH_S}) * 1000 AS time
FROM history_visits hv
JOIN history_items hi ON hv.history_item = hi.id
WHERE hv.visit_time > ?
ORDER BY hv.visit_time DESC
LIMIT 60000
`;

type SafariBookmarkNode = {
  Title?: string;
  URLString?: string;
  URIDictionary?: { title?: string };
  Children?: SafariBookmarkNode[];
  WebBookmarkType?: string;
};

const readSafariBookmarks = (): Promise<BrowserBookmark[]> =>
  new Promise((resolve) => {
    const file = path.join(os.homedir(), "Library", "Safari", "Bookmarks.plist");
    execFile("plutil", ["-convert", "json", "-o", "-", file], { maxBuffer: 20 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      const bookmarks: BrowserBookmark[] = [];
      const walk = (node: SafariBookmarkNode, folder: string | undefined) => {
        if (node.WebBookmarkType === "WebBookmarkTypeProxy") return;
        if (node.URLString) {
          bookmarks.push({
            title: node.URIDictionary?.title ?? node.Title ?? "",
            url: node.URLString,
            ...(folder ? { folder } : {}),
          });
          return;
        }
        for (const child of node.Children ?? []) walk(child, node.Title || folder);
      };
      try {
        walk(JSON.parse(stdout) as SafariBookmarkNode, undefined);
      } catch {
        resolve([]);
        return;
      }
      resolve(bookmarks.reverse());
    });
  });

export const readSafariVisits = (sinceMs: number): Promise<BrowserVisitSource | null> =>
  runDiscovery(
    Effect.suspend(() => {
      if (process.platform !== "darwin") return Effect.succeed(null);
      const historyPath = path.join(os.homedir(), "Library", "Safari", "History.db");
      return Effect.gen(function* () {
        yield* tryDiscovery(() => fs.access(historyPath));
        const visits = yield* Effect.scoped(
          Effect.gen(function* () {
            const db = yield* acquireCloseable(() => openSqliteSnapshot(historyPath));
            return yield* tryDiscoverySync(
              () =>
                db
                  .prepare(RECENT_VISITS_QUERY)
                  .all(sinceMs / 1000 - CF_ABSOLUTE_EPOCH_S) as BrowserVisit[],
            );
          }),
        );
        const bookmarks = yield* tryDiscovery(() => readSafariBookmarks());
        log(`Read ${visits.length} Safari visits`);
        return { browser: "safari", visits, bookmarks, accounts: [], languages: null };
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            if ((error as NodeJS.ErrnoException).code === "EPERM") {
              log("Safari History access denied - grant Full Disk Access");
            } else {
              log("Error reading Safari history:", error);
            }
            return null;
          }),
        ),
      );
    }),
  );
