"use client";

import type {
  SlackGithubBranchesResponse,
  SlackGithubConnectResponse,
  SlackGithubFinishResponse,
  SlackGithubReposResponse,
  SlackInstallStartResponse,
  SlackWorkspace,
  SlackWorkspaceGithub,
  SlackWorkspaceOptions,
  SlackWorkspaceUpdate,
  SlackWorkspaceUpdateResponse,
  SlackWorkspacesResponse,
} from "@stella/contracts/slack-workspace";

export type SlackMockMode = "empty" | "connected" | "unavailable" | "github" | "revoked" | "legacy";

const MODES: readonly SlackMockMode[] = ["empty", "connected", "unavailable", "github", "revoked", "legacy"];

export function readMockMode(): SlackMockMode | null {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") return null;
  const mode = new URL(window.location.href).searchParams.get("mock");
  return (MODES as readonly (string | null)[]).includes(mode) ? (mode as SlackMockMode) : null;
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
  limitedHosts: ["github.com", "*.github.com", "registry.npmjs.org", "pypi.org", "files.pythonhosted.org", "bun.sh"],
};

const acmeGithub = (status: SlackWorkspaceGithub["status"]): SlackWorkspaceGithub => ({
  account: "acme",
  accountType: "Organization",
  status,
  manageUrl: "https://github.com/organizations/acme/settings/installations/1",
});

const base: SlackWorkspace = {
  teamId: "T0MOCK123",
  teamName: "Acme Robotics",
  homeFolder: "Slack/Acme Robotics",
  installedAt: Date.now() - 3 * 86_400_000,
  engine: "stella",
  model: "stella/default",
  effort: "medium",
  slackCommands: true,
  github: null,
  repo: null,
  previews: {
    access: "members",
    ttlDays: 14,
    usedBytes: 38 * 1024 * 1024,
    quotaBytes: 5 * 1024 * 1024 * 1024,
    live: 6,
    maxPreviewBytes: 100 * 1024 * 1024,
  },
  environment: {
    name: "Acme firmware",
    network: "limited",
    allowedHosts: ["api.acme-robotics.dev"],
    secrets: [{ id: "s1", name: "ACME_API_TOKEN", host: "api.acme-robotics.dev", header: "Authorization" }],
    setupScript: 'set -euo pipefail\ncurl -fsSL https://bun.sh/install | bash -s "bun-v1.4.2"\nexport PATH="$HOME/.bun/bin:$PATH"',
    envVars: "NODE_ENV=development\nFIRMWARE_TARGET=stm32",
    lastSetup: {
      status: "failed",
      exitCode: 1,
      at: Date.now() - 6 * 60_000,
      ms: 4200,
      log: "+ curl -fsSL https://bun.sh/install\ncurl: (22) The requested URL returned error: 403\nBlocked: this Slack workspace's environment has Limited network access, which doesn't include example.org.",
    },
  },
  rules: "Only Priya can ask for deploys.\nKeep answers in threads.",
  memory:
    "Standup is at 9:30 in #eng.\nThe firmware release train ships every second Tuesday.",
  slackUrl: "https://app.slack.com/client/T0MOCK123",
};

let workspace: SlackWorkspace | null = null;

const current = (mode: SlackMockMode | null): SlackWorkspace => {
  if (workspace) return workspace;
  workspace =
    mode === "github"
      ? { ...base, github: acmeGithub("active"), repo: { fullName: "acme/robot-firmware", branch: "", access: "github" } }
      : mode === "revoked"
        ? { ...base, github: acmeGithub("revoked"), repo: { fullName: "acme/robot-firmware", branch: "", access: "public" } }
        : mode === "legacy"
          ? { ...base, repo: { fullName: "acme/robot-firmware", branch: "", access: "token" } }
          : base;
  return workspace;
};

const mockMode = (): SlackMockMode | null => readMockMode();

const wait = <T,>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), 350));

const REPOS = [
  { fullName: "acme/robot-firmware", private: true, defaultBranch: "main" },
  { fullName: "acme/fleet-dashboard", private: true, defaultBranch: "main" },
  { fullName: "acme/docs", private: false, defaultBranch: "trunk" },
  { fullName: "acme/sim", private: true, defaultBranch: "develop" },
];

export const mockSlackApi = {
  list(mode: SlackMockMode): Promise<SlackWorkspacesResponse> {
    return wait({
      available: mode !== "unavailable",
      githubAvailable: true,
      workspaces: mode === "empty" || mode === "unavailable" ? [] : [current(mode)],
      options,
    });
  },
  update(_teamId: string, update: SlackWorkspaceUpdate): Promise<SlackWorkspaceUpdateResponse> {
    const { repo, previews, environment, ...rest } = update;
    const now = current(mockMode());
    let next: SlackWorkspace = { ...now, ...rest, previews: { ...now.previews, ...previews } };
    if (environment && now.environment) {
      const { secrets, ...fields } = environment;
      const kept = now.environment.secrets.filter((secret) => !secrets?.remove?.includes(secret.id));
      const added = (secrets?.add ?? []).map((secret) => ({
        id: crypto.randomUUID(),
        name: secret.name,
        host: secret.host,
        header: secret.header || "Authorization",
      }));
      next = { ...next, environment: { ...now.environment, ...fields, secrets: [...kept, ...added] } };
    }
    if (repo === null) next = { ...next, repo: null };
    else if (repo) {
      const viaGithub = Boolean(next.github && repo.fullName.startsWith(`${next.github.account}/`));
      next = {
        ...next,
        repo: { fullName: repo.fullName, branch: repo.branch ?? "", access: viaGithub ? "github" : "public" },
      };
    }
    workspace = next;
    return wait({ workspace: next });
  },
  install(returnTo: string): Promise<SlackInstallStartResponse> {
    const url = new URL(returnTo);
    url.searchParams.set("slack", "installed");
    url.searchParams.set("mock", "connected");
    return wait({ url: url.toString() });
  },
  connectGithub(returnTo: string): Promise<SlackGithubConnectResponse> {
    const url = new URL(returnTo);
    url.searchParams.set("github", "mock-code");
    url.searchParams.set("team", base.teamId);
    return wait({ url: url.toString() });
  },
  finishGithub(installationId?: string): Promise<SlackGithubFinishResponse> {
    if (!installationId) {
      return wait({
        choices: [
          { installationId: "1", account: "acme", accountType: "Organization" },
          { installationId: "2", account: "priya", accountType: "User" },
        ],
      });
    }
    const next = { ...current(mockMode()), github: acmeGithub("active") };
    workspace = next;
    return wait({ workspace: next });
  },
  disconnectGithub(): Promise<SlackWorkspaceUpdateResponse> {
    const next = { ...current(mockMode()), github: null, repo: null };
    workspace = next;
    return wait({ workspace: next });
  },
  repos(): Promise<SlackGithubReposResponse> {
    return wait({ repos: REPOS, truncated: false });
  },
  branches(repo: string): Promise<SlackGithubBranchesResponse> {
    const found = REPOS.find((r) => r.fullName === repo);
    const defaultBranch = found?.defaultBranch ?? "main";
    return wait({
      branches: [defaultBranch, "release/2.4", "feature/arm-calibration", "fix/watchdog"],
      defaultBranch,
      truncated: false,
    });
  },
};
