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
        log(`Read ${visits.length} Safari visits`);
        return { browser: "safari", visits, accounts: [], languages: null };
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
