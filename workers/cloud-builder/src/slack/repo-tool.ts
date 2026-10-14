import { Type, type TSchema } from "@sinclair/typebox";
import type { CloudCodeSourceAgentTool } from "../cloud-code-tool.js";
import { environmentSummary, loadEnvironment, slackEnvironmentsEnabled } from "./environment.js";
import { parseRepoName } from "./settings.js";
import {
  listRepos,
  setChannelDefault,
  setConversationRepo,
  type SlackRepoRecord,
} from "./repos.js";
import { repoCheckout, type SlackWorkspaceContext } from "./workspace.js";

export const SLACK_REPO_TOOL_NAME = "slack_repo";

const PARAMETERS = Type.Object({
  action: Type.Union(
    [
      Type.Literal("use"),
      Type.Literal("none"),
      Type.Literal("set_channel_default"),
      Type.Literal("clear_channel_default"),
    ],
    {
      description:
        "use: this conversation works in `repo` from now on. none: it works in no repository. set_channel_default: threads in this channel use `repo` unless they pick another (also uses it here). clear_channel_default: the channel has no default again.",
    },
  ),
  repo: Type.Optional(
    Type.String({
      description: "For use and set_channel_default: one of the workspace's repositories, as owner/name (or just its name when that's unique).",
    }),
  ),
});

const failure = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: null,
  isError: true,
});

const done = (text: string) => ({ content: [{ type: "text" as const, text }], details: null });

export const matchRepo = (repos: SlackRepoRecord[], wanted: string): SlackRepoRecord | null => {
  const full = parseRepoName(wanted)?.toLowerCase();
  if (full) return repos.find((repo) => repo.fullName.toLowerCase() === full) ?? null;
  const name = wanted.trim().toLowerCase();
  const byName = repos.filter((repo) => repo.fullName.split("/")[1]!.toLowerCase() === name);
  return byName.length === 1 ? byName[0]! : null;
};

export const createSlackRepoTool = (options: {
  env: Cloudflare.Env;
  conversationId: string;
  context: () => Promise<SlackWorkspaceContext | null>;
}): CloudCodeSourceAgentTool => ({
  name: SLACK_REPO_TOOL_NAME,
  label: "Repository",
  workingText: "Choosing the repository",
  description:
    "Pick which of the workspace's repositories this conversation is about, before starting agents for code work. Agents you start afterwards get it cloned and run in its environment. Can also set or clear this channel's default repository.",
  parameters: PARAMETERS as unknown as TSchema,
  execute: async (_toolCallId, params) => {
    const args = (params ?? {}) as Record<string, unknown>;
    const context = await options.context();
    if (!context?.teamId) return failure("Repositories can only be picked in Slack. Try again on the next message.");
    const repos = await listRepos(options.env, context.teamId);
    const list = repos.map((repo) => repo.fullName).join(", ") || "none";
    const action = args.action;
    const channelLabel =
      context.place.kind === "channel" ? `#${context.place.name}` : context.place.kind === "dm" ? `DM with @${context.requester.name}` : "group DM";

    if (action === "none") {
      await setConversationRepo(options.env, options.conversationId, context.teamId, "");
      return done("This conversation now works in no repository. Agents you start from now on get none.");
    }
    if (action === "clear_channel_default") {
      await setChannelDefault(options.env, context.teamId, context.channelId, null, channelLabel);
      return done(`${channelLabel} has no default repository now.`);
    }
    if (action !== "use" && action !== "set_channel_default") {
      return failure("action must be use, none, set_channel_default or clear_channel_default.");
    }
    const wanted = typeof args.repo === "string" ? args.repo : "";
    if (!wanted.trim()) return failure(`Name the repository. The workspace has: ${list}.`);
    const repo = matchRepo(repos, wanted);
    if (!repo) {
      return failure(
        `${wanted.slice(0, 120)} isn't one of the workspace's repositories (${list}). The workspace owner adds repositories at stella.sh/crew.`,
      );
    }
    await setConversationRepo(options.env, options.conversationId, context.teamId, repo.id);
    if (action === "set_channel_default") {
      await setChannelDefault(options.env, context.teamId, context.channelId, repo.id, channelLabel);
    }
    const environment = slackEnvironmentsEnabled(options.env)
      ? environmentSummary(await loadEnvironment(options.env, context.teamId, repo.id))
      : null;
    return done(
      [
        action === "set_channel_default"
          ? `${repo.fullName} is now the default repository for ${channelLabel}, and this conversation works in it.`
          : `This conversation now works in ${repo.fullName}.`,
        `Agents you start from now on get it cloned at ${repoCheckout(repo.fullName)} on branch ${repo.branch || "(the default branch)"}${environment ? `, in its environment: ${environment}` : "."}`,
        "An agent already running keeps its container until its next run; tell it to work in the new checkout when it does.",
      ].join(" "),
    );
  },
});
