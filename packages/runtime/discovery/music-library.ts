import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { Effect } from "effect";
import { runDiscovery, tryDiscovery, tryDiscoverySync } from "./effect-io.js";
import { openSqliteSnapshot } from "./sqlite-snapshot.js";

const log = (...args: unknown[]) => console.error("[music-library]", ...args);

export type MusicArtist = {
  name: string;
  playCount: number;
};

export type MusicGenre = {
  name: string;
  trackCount: number;
};

export type MusicLibrarySignals = {
  source: "itunes" | "apple_music";
  totalTracks: number;
  topArtists: MusicArtist[];
  topGenres: MusicGenre[];
};

const ITUNES_XML_PATHS_WIN = (): string[] => {
  const home = os.homedir();
  return [
    path.join(home, "Music", "iTunes", "iTunes Music Library.xml"),
    path.join(home, "Music", "iTunes", "iTunes Library.xml"),
  ];
};

const ITUNES_XML_PATHS_MAC = (): string[] => {
  const home = os.homedir();
  return [
    path.join(home, "Music", "iTunes", "iTunes Music Library.xml"),
    path.join(home, "Music", "iTunes", "iTunes Library.xml"),
    path.join(home, "Music", "Music", "Music Library.xml"),
  ];
};

const findItunesXml = async (): Promise<string | null> => {
  const paths = process.platform === "darwin"
    ? ITUNES_XML_PATHS_MAC()
    : ITUNES_XML_PATHS_WIN();

  for (const p of paths) {
    try {
      await fs.access(p);
      return p;
    } catch { /* try next */ }
  }
  return null;
};

/**
 * Lightweight XML plist track parser.
 * iTunes XML is a plist with a <dict> of track entries.
 * Each track has key-value pairs for Name, Artist, Genre, Play Count, etc.
 * We parse just the track dicts without a full XML parser.
 */
const parseItunesXml = async (xmlPath: string): Promise<MusicLibrarySignals> => {
  const content = await fs.readFile(xmlPath, "utf-8");

  const artistCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();
  let totalTracks = 0;

  const tracksIdx = content.indexOf("<key>Tracks</key>");
  if (tracksIdx === -1) {
    return { source: "itunes", totalTracks: 0, topArtists: [], topGenres: [] };
  }

  // Match individual track entries: <key>ID</key><dict>...</dict>
  // We iterate through key-value pairs within each track dict
  // Start after the Tracks key
  const tracksSection = content.substring(tracksIdx);

  // Simpler approach: find all Artist and Genre values with their Play Count
  // Each track dict has sequential key-value pairs
  const trackPattern = /<key>Track ID<\/key>/g;
  let match;
  let prevIdx = 0;

  // Split by Track ID to get individual track blocks
  const trackBlocks: string[] = [];
  while ((match = trackPattern.exec(tracksSection)) !== null) {
    if (prevIdx > 0) {
      trackBlocks.push(tracksSection.substring(prevIdx, match.index));
    }
    prevIdx = match.index;
  }
  if (prevIdx > 0) {
    // Add the last block (up to the closing dict of Tracks)
    const endIdx = tracksSection.indexOf("</dict>", prevIdx + 1000);
    if (endIdx > 0) trackBlocks.push(tracksSection.substring(prevIdx, endIdx));
  }

  for (const block of trackBlocks) {
    const podcastMatch = block.match(/<key>Podcast<\/key>\s*<true\/>/);
    if (podcastMatch) continue;
    const kindMatch = block.match(/<key>Kind<\/key>\s*<string>([^<]+)<\/string>/);
    if (kindMatch && kindMatch[1].toLowerCase().includes("audiobook")) continue;

    totalTracks++;

    const artistMatch = block.match(/<key>Artist<\/key>\s*<string>([^<]+)<\/string>/);
    const artist = artistMatch?.[1];

    const genreMatch = block.match(/<key>Genre<\/key>\s*<string>([^<]+)<\/string>/);
    const genre = genreMatch?.[1];

    const playCountMatch = block.match(/<key>Play Count<\/key>\s*<integer>(\d+)<\/integer>/);
    const playCount = playCountMatch ? Number(playCountMatch[1]) : 0;

    if (artist) {
      artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + playCount);
    }
    if (genre) {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    }
  }

  const topArtists = [...artistCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, playCount]) => ({ name, playCount }));

  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, trackCount]) => ({ name, trackCount }));

  return { source: "itunes", totalTracks, topArtists, topGenres };
};

type SqliteDatabase = {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
  close(): void;
};

const APPLE_MUSIC_DB_PATHS = (): string[] => {
  const home = os.homedir();
  return [
    path.join(home, "Music", "Music", "Music Library.musiclibrary", "Library.musicdb"),
    path.join(home, "Music", "Music", "Music Library.musiclibrary", "Library.db"),
  ];
};

const findAppleMusicDb = async (): Promise<string | null> => {
  for (const p of APPLE_MUSIC_DB_PATHS()) {
    try {
      await fs.access(p);
      return p;
    } catch { /* try next */ }
  }
  return null;
};

const SQLITE_HEADER = "SQLite format 3\0";

const isSqliteDatabaseFileEffect = (
  dbPath: string,
): Effect.Effect<boolean> =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* Effect.acquireRelease(
        tryDiscovery(() => fs.open(dbPath, "r")),
        (h) => Effect.promise(() => h.close().catch(() => {})),
      );
      const buffer = Buffer.alloc(SQLITE_HEADER.length);
      const { bytesRead } = yield* tryDiscovery(() =>
        handle.read(buffer, 0, buffer.length, 0),
      );
      return bytesRead === buffer.length && buffer.toString("utf8") === SQLITE_HEADER;
    }),
  ).pipe(Effect.catch(() => Effect.succeed(false)));

const collectFromAppleMusicDbEffect = (
  dbPath: string,
): Effect.Effect<MusicLibrarySignals, unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const db = yield* Effect.acquireRelease(
        tryDiscovery(
          () => openSqliteSnapshot(dbPath) as Promise<SqliteDatabase>,
        ),
        (openDb) => Effect.sync(() => openDb.close()),
      );

      return yield* tryDiscoverySync(() => {
        const countRow = db.prepare("SELECT COUNT(*) as c FROM ZTRACK WHERE ZISPODCAST = 0").all() as { c: number }[];
        const totalTracks = countRow[0]?.c ?? 0;

        const artistRows = db.prepare(`
      SELECT ZARTIST as name, SUM(ZPLAYCOUNT) as play_count
      FROM ZTRACK
      WHERE ZISPODCAST = 0 AND ZARTIST IS NOT NULL
      GROUP BY ZARTIST
      ORDER BY play_count DESC
      LIMIT 20
    `).all() as { name: string; play_count: number }[];

        const genreRows = db.prepare(`
      SELECT ZGENRE as name, COUNT(*) as track_count
      FROM ZTRACK
      WHERE ZISPODCAST = 0 AND ZGENRE IS NOT NULL
      GROUP BY ZGENRE
      ORDER BY track_count DESC
      LIMIT 10
    `).all() as { name: string; track_count: number }[];

        return {
          source: "apple_music" as const,
          totalTracks,
          topArtists: artistRows.map((r) => ({ name: r.name, playCount: r.play_count })),
          topGenres: genreRows.map((r) => ({ name: r.name, trackCount: r.track_count })),
        };
      });
    }),
  );

const collectMusicLibraryEffect: Effect.Effect<
  MusicLibrarySignals | null,
  unknown
> = Effect.gen(function* () {
    if (process.platform === "darwin") {
      const appleMusicDb = yield* tryDiscovery(() => findAppleMusicDb());
      if (appleMusicDb) {
        log(`Found Apple Music database at: ${appleMusicDb}`);
        if (!(yield* isSqliteDatabaseFileEffect(appleMusicDb))) {
          log("Apple Music library exists but is not a SQLite database on this system");
        } else {
          const result = yield* collectFromAppleMusicDbEffect(appleMusicDb).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                const code = (error as NodeJS.ErrnoException).code;
                if (code === "SQLITE_NOTADB") {
                  log("Apple Music database format is not readable on this system");
                } else {
                  log("Failed to read Apple Music database:", error);
                }
                return null;
              }),
            ),
          );
          if (result) {
            log(`Collected from Apple Music: ${result.totalTracks} tracks, ${result.topArtists.length} artists, ${result.topGenres.length} genres`);
            return result;
          }
        }
      }
    }

    const itunesXml = yield* tryDiscovery(() => findItunesXml());
    if (itunesXml) {
      log(`Found iTunes library at: ${itunesXml}`);
      const result = yield* tryDiscovery(() => parseItunesXml(itunesXml)).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            log("Failed to parse iTunes library:", error);
            return null;
          }),
        ),
      );
      if (result) {
        log(`Collected from iTunes: ${result.totalTracks} tracks, ${result.topArtists.length} artists, ${result.topGenres.length} genres`);
        return result;
      }
    }

    log("No music library found");
    return null;
  });

export const collectMusicLibrary = async (): Promise<MusicLibrarySignals | null> =>
  runDiscovery(collectMusicLibraryEffect);

export const formatMusicLibraryForSynthesis = (signals: MusicLibrarySignals): string => {
  if (signals.totalTracks === 0) return "";

  const source = signals.source === "apple_music" ? "Apple Music" : "iTunes";
  const sections: string[] = [`## Music Library (${source})`];
  sections.push(`${signals.totalTracks} tracks`);

  if (signals.topGenres.length > 0) {
    sections.push(
      "\nGenres: " +
        signals.topGenres
          .slice(0, 8)
          .map((g) => `${g.name} (${g.trackCount})`)
          .join(", "),
    );
  }

  if (signals.topArtists.length > 0) {
    sections.push("\n### Most Played Artists");
    sections.push(
      signals.topArtists
        .filter((a) => a.playCount > 0)
        .slice(0, 15)
        .map((a) => `- ${a.name} (${a.playCount} plays)`)
        .join("\n"),
    );
  }

  return sections.join("\n");
};
