import path from "path";
import { Cause, Context, Effect, Layer } from "effect";
import {
  detectPreferredBrowserProfile,
  readChromiumVisits,
} from "./browser-data.js";
import {
  BROWSING_WINDOW_DAYS,
  buildBrowsingDigest,
  type BrowserVisitSource,
} from "./browsing-digest.js";
import {
  collectDevProjects,
  formatDevProjectsForSynthesis,
} from "./dev-projects.js";
import { readSafariVisits } from "./safari-data.js";
import {
  collectSystemSignals,
  formatSystemSignalsForSynthesis,
} from "./system-signals.js";
import {
  collectMessagesNotes,
  formatMessagesNotesForSynthesis,
} from "./messages-notes.js";
import { readFirefoxVisits } from "./firefox-data.js";
import {
  collectSteamLibrary,
  formatSteamLibraryForSynthesis,
} from "./steam-library.js";
import {
  collectMusicLibrary,
  formatMusicLibraryForSynthesis,
} from "./music-library.js";
import {
  ensurePrivateDir,
  writePrivateFile,
} from "../kernel/home/private-fs.js";
import { tryDiscovery } from "./effect-io.js";

import type { AllUserSignals, AllUserSignalsResult } from "./types.js";
import type { DiscoveryCategory } from "@stella/contracts/discovery";
import type {
  DevEnvironmentSignals,
  SystemSignals,
  MessagesNotesSignals,
} from "./discovery-types.js";
import type { SteamLibrarySignals } from "./steam-library.js";
import type { MusicLibrarySignals } from "./music-library.js";
import type { BrowserType } from "@stella/contracts";

const log = (...args: unknown[]) => console.error("[collect-all]", ...args);

export const DEFAULT_CATEGORIES: DiscoveryCategory[] = [
  "browsing_bookmarks",
  "dev_environment",
  "apps_system",
];

const DISCOVERY_CATEGORIES_STATE_FILE = "discovery_categories.json";
const CHROMIUM_BROWSERS = new Set([
  "chrome",
  "edge",
  "brave",
  "arc",
  "opera",
  "vivaldi",
]);

type FormattedCategorySections = Partial<Record<DiscoveryCategory, string>>;

const joinSections = (sections: string[]): string =>
  sections.filter((s) => s && s.trim().length > 0).join("\n\n");

const persistSelectedCategories = async (
  stellaDataDir: string,
  categories: DiscoveryCategory[],
): Promise<void> => {
  try {
    const stateDir = stellaDataDir;
    const statePath = path.join(stateDir, DISCOVERY_CATEGORIES_STATE_FILE);
    await ensurePrivateDir(stateDir);
    await writePrivateFile(
      statePath,
      JSON.stringify({ categories, updatedAt: Date.now() }, null, 2),
    );
  } catch (error) {
    log("Failed to persist selected discovery categories:", error);
  }
};

export type ExtendedUserSignals = AllUserSignals & {
  devEnvironment?: DevEnvironmentSignals;
  systemSignals?: SystemSignals;
  messagesNotes?: MessagesNotesSignals;
  steamLibrary?: SteamLibrarySignals | null;
  musicLibrary?: MusicLibrarySignals | null;
};

export type DiscoveryCollectionOptions = {
  readonly concurrency?: number | "unbounded";
  readonly collectorTimeoutMs?: number;
};

const collectAllUserSignalsEffect = (
  StellaDataDir: string,
  categories: DiscoveryCategory[],
  selectedBrowser?: string | null,
  selectedProfile?: string | null,
  options?: DiscoveryCollectionOptions,
): Effect.Effect<ExtendedUserSignals, unknown> =>
  Effect.gen(function* () {
    log("Starting sequential collection for categories:", categories);
    if (selectedBrowser) log("Selected browser:", selectedBrowser);
    if (selectedProfile) log("Selected browser profile:", selectedProfile);
    const start = Date.now();

    const tasks: Record<string, () => Promise<unknown>> = {};

    if (categories.includes("browsing_bookmarks")) {
      const since = Date.now() - BROWSING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      const shouldCollectChromium =
        !selectedBrowser || CHROMIUM_BROWSERS.has(selectedBrowser);
      const preferredChromiumSelection =
        !selectedBrowser && shouldCollectChromium
          ? yield* tryDiscovery(() => detectPreferredBrowserProfile())
          : null;
      const selectedChromiumBrowser = selectedBrowser
        ? (selectedBrowser as BrowserType | undefined)
        : (preferredChromiumSelection?.browser ?? undefined);
      const selectedChromiumProfile = selectedBrowser
        ? selectedProfile
        : (preferredChromiumSelection?.profile ?? undefined);

      const readers: (() => Promise<BrowserVisitSource | null>)[] = [];
      if (shouldCollectChromium && selectedChromiumBrowser) {
        readers.push(() =>
          readChromiumVisits(
            {
              selectedBrowser: selectedChromiumBrowser,
              selectedProfile: selectedChromiumProfile,
            },
            since,
          ),
        );
      }
      if (!selectedBrowser || selectedBrowser === "firefox") {
        readers.push(() => readFirefoxVisits(since));
      }
      if (!selectedBrowser || selectedBrowser === "safari") {
        readers.push(() => readSafariVisits(since));
      }
      tasks.browsing = async () => {
        const sources: BrowserVisitSource[] = [];
        for (const read of readers) {
          const source = await read().catch((e) => {
            log("Browser history read failed:", e);
            return null;
          });
          if (source) sources.push(source);
        }
        return buildBrowsingDigest(sources);
      };
    }

    if (categories.includes("dev_environment")) {
      tasks.devProjects = () => collectDevProjects();
    }

    if (categories.includes("apps_system")) {
      tasks.system = () =>
        collectSystemSignals().catch((e) => {
          log("System signals collection failed:", e);
          return {
            userIdentity: null,
            dockPins: [],
            appUsage: [],
            device: null,
          };
        });
      tasks.steam = () =>
        collectSteamLibrary().catch((e) => {
          log("Steam library collection failed:", e);
          return null;
        });
      tasks.music = () =>
        collectMusicLibrary().catch((e) => {
          log("Music library collection failed:", e);
          return null;
        });
    }

    if (categories.includes("messages_notes")) {
      tasks.messagesNotes = () =>
        collectMessagesNotes().catch((e) => {
          log("Messages/notes collection failed:", e);
          return { contacts: [], groupChats: [], noteFolders: [], calendars: [] };
        });
    }

    const keys = Object.keys(tasks);
    const results: Record<string, unknown> = {};
    const collectorTimeoutMs = options?.collectorTimeoutMs;
    yield* Effect.forEach(
      keys,
      (key) =>
        Effect.suspend(() => {
          const collect = tryDiscovery(tasks[key]);
          const timed =
            collectorTimeoutMs === undefined
              ? collect
              : collect.pipe(Effect.timeout(collectorTimeoutMs));
          return Effect.map(timed, (value) => {
            results[key] = value;
          });
        }),
      { concurrency: options?.concurrency ?? 1, discard: true },
    );

    const elapsed = Date.now() - start;
    log(`Collection complete in ${elapsed}ms`);

    return {
      browsing: (results.browsing as AllUserSignals["browsing"]) ?? null,
      devProjects: (results.devProjects as AllUserSignals["devProjects"]) ?? [],
      systemSignals: results.system as SystemSignals | undefined,
      messagesNotes: results.messagesNotes as MessagesNotesSignals | undefined,
      steamLibrary: results.steam as SteamLibrarySignals | null | undefined,
      musicLibrary: results.music as MusicLibrarySignals | null | undefined,
    };
  });

const formatSignalsForSynthesisWithSections = async (
  data: ExtendedUserSignals,
  categories: DiscoveryCategory[] = DEFAULT_CATEGORIES,
): Promise<{
  formatted: string;
  formattedSections: FormattedCategorySections;
}> => {
  const formattedSections: FormattedCategorySections = {};

  if (categories.includes("browsing_bookmarks")) {
    if (data.browsing?.text) {
      formattedSections.browsing_bookmarks = data.browsing.text;
    }
  }

  if (categories.includes("dev_environment")) {
    const categorySections: string[] = [];

    const projectsSection = formatDevProjectsForSynthesis(data.devProjects);
    if (projectsSection) categorySections.push(projectsSection);

    const categoryFormatted = joinSections(categorySections);
    if (categoryFormatted) {
      formattedSections.dev_environment = categoryFormatted;
    }
  }

  if (categories.includes("apps_system")) {
    const categorySections: string[] = [];

    if (data.systemSignals) {
      const systemSection = formatSystemSignalsForSynthesis(data.systemSignals);
      if (systemSection) categorySections.push(systemSection);
    }

    if (data.steamLibrary) {
      const steamSection = formatSteamLibraryForSynthesis(data.steamLibrary);
      if (steamSection) categorySections.push(steamSection);
    }

    if (data.musicLibrary) {
      const musicSection = formatMusicLibraryForSynthesis(data.musicLibrary);
      if (musicSection) categorySections.push(musicSection);
    }

    const categoryFormatted = joinSections(categorySections);
    if (categoryFormatted) {
      formattedSections.apps_system = categoryFormatted;
    }
  }

  if (categories.includes("messages_notes") && data.messagesNotes) {
    const messagesSection = formatMessagesNotesForSynthesis(data.messagesNotes);
    if (messagesSection) {
      formattedSections.messages_notes = messagesSection;
    }
  }

  const orderedSections = categories
    .map((category) => formattedSections[category])
    .filter((section): section is string =>
      Boolean(section && section.trim().length > 0),
    );

  const formatted = orderedSections.join("\n\n");

  return {
    formatted,
    formattedSections,
  };
};

export interface Interface {
  readonly collectAllUserSignals: (
    stellaDataDir: string,
    categories?: DiscoveryCategory[],
    selectedBrowser?: string | null,
    selectedProfile?: string | null,
    options?: DiscoveryCollectionOptions,
  ) => Effect.Effect<ExtendedUserSignals, unknown>;
  readonly collectAllSignals: (
    stellaDataDir: string,
    categories?: DiscoveryCategory[],
    selectedBrowser?: string | null,
    selectedProfile?: string | null,
    options?: DiscoveryCollectionOptions,
  ) => Effect.Effect<AllUserSignalsResult>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@stella/runtime/discovery/DiscoveryService",
) {}

export const make = (): Interface => ({
  collectAllUserSignals: (
    stellaDataDir,
    categories = DEFAULT_CATEGORIES,
    selectedBrowser,
    selectedProfile,
    options,
  ) =>
    collectAllUserSignalsEffect(
      stellaDataDir,
      categories,
      selectedBrowser,
      selectedProfile,
      options,
    ),

  collectAllSignals: (
    stellaDataDir,
    categories,
    selectedBrowser,
    selectedProfile,
    options,
  ) =>
    Effect.gen(function* () {
      const cats = categories ?? DEFAULT_CATEGORIES;
      yield* tryDiscovery(() =>
        persistSelectedCategories(stellaDataDir, cats),
      );
      const data = yield* collectAllUserSignalsEffect(
        stellaDataDir,
        cats,
        selectedBrowser,
        selectedProfile,
        options,
      );
      const { formatted, formattedSections } = yield* tryDiscovery(() =>
        formatSignalsForSynthesisWithSections(data, cats),
      );

      return {
        data,
        formatted,
        formattedSections,
      } satisfies AllUserSignalsResult;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          const error = Cause.squash(cause);
          log("Error collecting signals:", error);
          return {
            data: null,
            formatted: null,
            formattedSections: null,
            error: (error as Error).message,
          } satisfies AllUserSignalsResult;
        }),
      ),
    ),
});

export const layer = Layer.succeed(Service, make());
