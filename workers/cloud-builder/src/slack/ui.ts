/**
 * Slack-side messages and views: setting up the workspace's Stella (the
 * installer connects the Stella account that owns and pays for it) and the
 * App Home tab.
 */

import { slackTry } from "./api.js";
import { SLACK_PATHS, slackPublicOrigin } from "./config.js";
import { signLinkToken } from "./link-state.js";
import type { SlackInstallation } from "./store.js";

export const connectUrl = async (
  env: Cloudflare.Env,
  teamId: string,
  slackUserId: string,
): Promise<string> =>
  `${slackPublicOrigin(env)}${SLACK_PATHS.link}?s=${encodeURIComponent(await signLinkToken(env, { teamId, slackUserId }))}`;

export const connectBlocks = (url: string, lead: string): unknown[] => [
  { type: "section", text: { type: "mrkdwn", text: lead } },
  {
    type: "actions",
    elements: [
      {
        type: "button",
        style: "primary",
        action_id: "stella_connect",
        text: { type: "plain_text", text: "Connect Stella" },
        url,
      },
    ],
  },
  {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "Stella is the whole workspace's shared assistant. Your Stella account pays for her usage here and keeps the workspace's files in your Drive under Slack/. Your personal memory, chats and connected apps stay out of Slack. The link is yours alone and expires in 30 minutes.",
      },
    ],
  },
];

const SETUP_LEAD =
  "*Connect your Stella account to set up Stella for this workspace.* You installed her, so your account runs her here. It takes a few seconds.";

/**
 * Stella isn't set up yet: the installer gets the connect button privately;
 * anyone else is told who can set her up.
 */
export const sendSetupPrompt = async (
  env: Cloudflare.Env,
  install: SlackInstallation,
  args: {
    channelId: string;
    slackUserId: string;
    threadTs?: string;
    isDm: boolean;
  },
): Promise<void> => {
  const installer = args.slackUserId === install.installedBy;
  const text = installer
    ? "Connect your Stella account to set up Stella for this workspace."
    : install.installedBy
      ? `Stella isn't set up here yet. <@${install.installedBy}> installed her and needs to connect a Stella account first (\`/stella connect\`).`
      : "Stella isn't set up here yet. Whoever installed her needs to connect a Stella account first (`/stella connect`).";
  const blocks = installer
    ? connectBlocks(
        await connectUrl(env, install.teamId, args.slackUserId),
        SETUP_LEAD,
      )
    : undefined;
  if (args.isDm) {
    await slackTry(install.botToken, "chat.postMessage", {
      channel: args.channelId,
      text,
      ...(blocks ? { blocks } : {}),
    });
    return;
  }
  await slackTry(install.botToken, "chat.postEphemeral", {
    channel: args.channelId,
    user: args.slackUserId,
    text,
    ...(blocks ? { blocks } : {}),
    ...(args.threadTs ? { thread_ts: args.threadTs } : {}),
  });
};

export const publishHome = async (
  env: Cloudflare.Env,
  install: SlackInstallation,
  slackUserId: string,
): Promise<void> => {
  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: "Stella" } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `Stella is ${install.teamName}'s shared assistant. Mention *@Stella* in a channel (invite her first with \`/invite @Stella\`) or message her here. ` +
          "She answers in the thread, and anyone in it can keep steering her by replying. Longer work runs in the background with a progress checklist and a Stop button, and files she makes are posted in the thread.",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "She keeps short notes about the workspace, each channel and the people she works with. Ask her what she remembers, or to forget something.",
      },
    },
    { type: "divider" },
  ];
  if (install.ownerId) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: install.installedBy
            ? `:white_check_mark: Set up by <@${install.installedBy}>.`
            : ":white_check_mark: Set up.",
        },
      ],
    });
  } else if (slackUserId === install.installedBy) {
    blocks.push(
      ...connectBlocks(
        await connectUrl(env, install.teamId, slackUserId),
        SETUP_LEAD,
      ),
    );
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: install.installedBy
          ? `Stella isn't set up yet: <@${install.installedBy}> needs to connect a Stella account.`
          : "Stella isn't set up yet: whoever installed her needs to connect a Stella account.",
      },
    });
  }
  await slackTry(install.botToken, "views.publish", {
    user_id: slackUserId,
    view: { type: "home", blocks },
  });
};
