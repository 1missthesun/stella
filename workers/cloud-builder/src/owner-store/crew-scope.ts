import type { OwnerCrewScope } from "./registry.js";

export const CREW_SPACE_PREFIX = "crew:";

const CREW_SPACE = /^crew:[A-Za-z0-9_.:-]{1,160}$/u;
const CREW_HOME = /^Slack\/[^\u0000-\u001f/][^\u0000-\u001f]{0,200}$/u;

export const CREW_OWNER_CALLS: ReadonlySet<string> = new Set([
  "search.web",
  "maps.admit",
  "maps.settle",
  "media.generateForTurn",
  "media.lookup",
  "media.cancelForTurn",
  "shares.saveCanvas",
  "drive.usage",
  "drive.list",
  "drive.fileUrl",
  "drive.turnFiles",
  "drive.turnStage",
  "drive.turnDelete",
  "drive.turnStat",
  "drive.turnList",
  "drive.turnRead",
  "drive.turnSync",
  "drive.turnAttachments",
  "drive.signImages",
]);

export const crewRefusal = (crew: OwnerCrewScope, name: string): string | null => {
  if (!CREW_SPACE.test(crew.space) || !CREW_HOME.test(crew.home)) {
    return "This Slack workspace's storage could not be identified.";
  }
  if (!CREW_OWNER_CALLS.has(name)) return `${name} isn't available to Stella in Slack.`;
  return null;
};

export const crewSpaceForTeam = (teamId: string): string => `${CREW_SPACE_PREFIX}${teamId}`;
