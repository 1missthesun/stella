/**
 * What Slack's standalone Stella reaches in the account that linked Slack.
 *
 * A Slack conversation lives under the user's account, which pays for it,
 * but it is not the user's Stella: it reads none of their memory, world,
 * Drive (beyond the `Slack/` folder its own files land in), schedules,
 * connectors or other conversations. Its tools reach the owner's object only
 * through the calls listed here.
 */

import { RpcError } from "../owner-store/errors.js";

/** The Drive folder Slack's files land in, and the only one it reads. */
export const SLACK_DRIVE_FOLDER = "Slack";

const STANDALONE_OWNER_CALLS = new Set([
  "search.web",
  "maps.admit",
  "media.lookup",
  "media.generateForTurn",
  "media.cancelForTurn",
  "shares.saveCanvas",
  "drive.turnFiles",
  "drive.signImages",
]);

const drivePathOf = (path: string): string =>
  path
    .trim()
    .replace(/\\/gu, "/")
    .replace(/^(?:\/workspace\/world\/)?(?:\/?drive\/)?\/*/u, "");

export const isSlackDrivePath = (path: string): boolean => {
  const relative = drivePathOf(path);
  return (
    relative.startsWith(`${SLACK_DRIVE_FOLDER}/`) &&
    !relative.split("/").some((part) => part === "..")
  );
};

const outsideReach = (name: string): RpcError =>
  new RpcError(
    "FORBIDDEN",
    name.startsWith("drive.")
      ? `Slack's Stella only reaches files in the ${SLACK_DRIVE_FOLDER}/ folder.`
      : "Slack's Stella can't use that here.",
  );

/** The owner calls of a standalone (Slack) turn or agent: the listed ones only. */
export const standaloneOwnerInternal =
  (
    inner: (name: string, args: unknown) => Promise<unknown>,
  ): ((name: string, args: unknown) => Promise<unknown>) =>
  async (name, args) => {
    if (!STANDALONE_OWNER_CALLS.has(name)) throw outsideReach(name);
    if (name === "drive.signImages") {
      const paths = (args as { paths?: unknown } | null)?.paths;
      if (
        !Array.isArray(paths) ||
        !paths.every((path) => typeof path === "string" && isSlackDrivePath(path))
      ) {
        throw outsideReach(name);
      }
    }
    return await inner(name, args);
  };
