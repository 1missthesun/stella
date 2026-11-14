import { promises as fs } from "node:fs";
import path from "node:path";

import { Effect } from "effect";

import {
  createDirectoryEntryAdapter,
  listTrackedBundledEntryIds,
  reconcileBundledEntriesEffect,
  type BundledSyncReport,
} from "./bundled-sync.js";

// Live re-export (not a top-level binding read): this module sits inside the
// home facade/service import cycle, and reading the binding at evaluation
// time would hit the temporal dead zone depending on entry order.
export { summarizeBundledSync as summarizeSkillsSync } from "./bundled-sync.js";

const USER_PROFILE_SKILL_ID = "user-profile";
const PLATFORM_SKILL_IDS: Partial<Record<NodeJS.Platform, readonly string[]>> =
  {
    darwin: ["stella-computer-macos"],
    win32: ["stella-computer-windows"],
    linux: ["stella-computer-linux"],
  };
const PLATFORM_EXCLUSIVE_SKILL_IDS = new Set(
  Object.values(PLATFORM_SKILL_IDS).flat(),
);

export type SkillsSyncOptions = {
  platform?: NodeJS.Platform;
};

export type SkillsSyncReport = BundledSyncReport;

const isBundledSkillIncludedForPlatform = (
  skillId: string,
  platform: NodeJS.Platform,
): boolean => {
  if (!PLATFORM_EXCLUSIVE_SKILL_IDS.has(skillId)) {
    return true;
  }
  return PLATFORM_SKILL_IDS[platform]?.includes(skillId) === true;
};

/** Written beside `skills/` by the app-source publish (scripts/shipped-skill-hashes.ts); absent in a dev checkout. */
export const SHIPPED_SKILL_HASHES_FILENAME = "shipped-skill-hashes.json";

const readShippedSkillHashes = async (
  bundledSkillsDir: string,
): Promise<Record<string, string[]>> => {
  try {
    const parsed = JSON.parse(
      await fs.readFile(
        path.join(
          path.dirname(bundledSkillsDir),
          SHIPPED_SKILL_HASHES_FILENAME,
        ),
        "utf-8",
      ),
    ) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string[]] =>
          Array.isArray(entry[1]) &&
          entry[1].every((hash) => typeof hash === "string"),
      ),
    );
  } catch {
    return {};
  }
};

const bundledSkillAdapter = createDirectoryEntryAdapter(
  (id) => id !== USER_PROFILE_SKILL_ID,
);

export const listIncludedBundledSkillIds = async (
  bundledSkillsDir: string,
  options: SkillsSyncOptions = {},
): Promise<Set<string>> => {
  const platform = options.platform ?? process.platform;
  const ids = await bundledSkillAdapter.listIds(bundledSkillsDir);
  return new Set(
    ids.filter((id) => isBundledSkillIncludedForPlatform(id, platform)),
  );
};

export const reconcileBundledSkillsEffect = (
  bundledSkillsDir: string,
  homeSkillsDir: string,
  options: SkillsSyncOptions = {},
): Effect.Effect<SkillsSyncReport, unknown> => {
  const platform = options.platform ?? process.platform;
  return Effect.flatMap(
    Effect.promise(() => readShippedSkillHashes(bundledSkillsDir)),
    (previouslyShipped) =>
      reconcileBundledEntriesEffect(
        bundledSkillsDir,
        homeSkillsDir,
        bundledSkillAdapter,
        {
          includeBundledId: (id) =>
            isBundledSkillIncludedForPlatform(id, platform),
          // Manifests seeded before the generic rename stored hashes under
          // `skills`; read them so already-installed users still get updates.
          legacyEntriesKey: "skills",
          previouslyShipped,
        },
      ),
  );
};

export const listTrackedBundledSkillIds = (
  homeSkillsDir: string,
): Promise<string[]> =>
  listTrackedBundledEntryIds(homeSkillsDir, { legacyEntriesKey: "skills" });
