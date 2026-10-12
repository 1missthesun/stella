"use client";

import type {
  SlackInstallStartResponse,
  SlackWorkspace,
  SlackWorkspaceOptions,
  SlackWorkspaceUpdate,
  SlackWorkspaceUpdateResponse,
  SlackWorkspacesResponse,
} from "@stella/contracts/slack-workspace";

export type SlackMockMode = "empty" | "connected" | "unavailable";

export function readMockMode(): SlackMockMode | null {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") return null;
  const mode = new URL(window.location.href).searchParams.get("mock");
  return mode === "empty" || mode === "connected" || mode === "unavailable" ? mode : null;
}

const options: SlackWorkspaceOptions = {
  engines: [
    { id: "stella", label: "Stella", detail: "Stella's own agents, on your Stella plan." },
    { id: "claude-code", label: "Claude Code", detail: "Claude Code on your Claude login." },
  ],
  models: {
    stella: [
      { id: "stella/default", label: "Stella default" },
      { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5" },
      { id: "openai/gpt-6", label: "GPT-6" },
    ],
    "claude-code": [
      { id: "opus", label: "Opus" },
      { id: "sonnet", label: "Sonnet" },
    ],
  },
  efforts: ["low", "medium", "high", "xhigh", "max"],
};

let workspace: SlackWorkspace = {
  teamId: "T0MOCK123",
  teamName: "Acme Robotics",
  homeFolder: "Slack/Acme Robotics",
  installedAt: Date.now() - 3 * 86_400_000,
  engine: "stella",
  model: "stella/default",
  effort: "medium",
  slackCommands: true,
  repo: { fullName: "acme/robot-firmware", branch: "", hasToken: true },
  rules: "Only Priya can ask for deploys.\nKeep answers in threads.",
  memory:
    "Standup is at 9:30 in #eng.\nThe firmware release train ships every second Tuesday.",
  slackUrl: "https://app.slack.com/client/T0MOCK123",
};

const wait = <T,>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), 350));

export const mockSlackApi = {
  list(mode: SlackMockMode): Promise<SlackWorkspacesResponse> {
    return wait({
      available: mode !== "unavailable",
      workspaces: mode === "connected" ? [workspace] : [],
      options,
    });
  },
  update(_teamId: string, update: SlackWorkspaceUpdate): Promise<SlackWorkspaceUpdateResponse> {
    const { repo, ...rest } = update;
    workspace = { ...workspace, ...rest };
    if (repo === null) workspace = { ...workspace, repo: null };
    else if (repo) {
      workspace = {
        ...workspace,
        repo: {
          fullName: repo.fullName,
          branch: repo.branch ?? "",
          hasToken: repo.token === undefined ? Boolean(workspace.repo?.hasToken) : repo.token !== "",
        },
      };
    }
    return wait({ workspace });
  },
  install(returnTo: string): Promise<SlackInstallStartResponse> {
    const url = new URL(returnTo);
    url.searchParams.set("slack", "installed");
    url.searchParams.set("mock", "connected");
    return wait({ url: url.toString() });
  },
};
