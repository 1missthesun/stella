"use client";

import type {
  SlackRepoAdd,
  SlackRepoAddResponse,
  SlackRepoUpdate,
  SlackWorkspaceEnvironment,
  SlackWorkspaceEnvironmentUpdate,
  SlackWorkspacePreviews,
  SlackWorkspaceRepo,
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

const githubAccount = (
  account: string,
  installationId: string,
  status: SlackWorkspaceGithub["status"],
): SlackWorkspaceGithub => ({
  installationId,
  account,
  accountType: "Organization",
  status,
  manageUrl: `https://github.com/organizations/${account}/settings/installations/${installationId}`,
});

const previews: SlackWorkspacePreviews = {
  access: "members",
  ttlDays: 14,
  usedBytes: 38 * 1024 * 1024,
  quotaBytes: 5 * 1024 * 1024 * 1024,
  live: 6,
  maxPreviewBytes: 100 * 1024 * 1024,
};

const defaultEnvironment = (): SlackWorkspaceEnvironment => ({
  name: "Default",
  network: "full",
  allowedHosts: [],
  secrets: [],
  setupScript: "",
  envVars: "",
  lastSetup: null,
});

const firmware = (access: SlackWorkspaceRepo["access"]): SlackWorkspaceRepo => ({
  id: "r0000000000a1",
  fullName: "acme/robot-firmware",
  branch: "",
  access,
  rules: "Never push to main; open a branch per change.",
  channels: [{ id: "C0FIRM", name: "#firmware" }],
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
      log: "+ curl -fsSL https://bun.sh/install\ncurl: (22) The requested URL returned error: 403\nBlocked: this environment has Limited network access, which doesn't include example.org.",
    },
  },
  previews,
});

const dashboard: SlackWorkspaceRepo = {
  id: "r0000000000b2",
  fullName: "clearshelf/web",
  branch: "develop",
  access: "github",
  rules: "",
  channels: [],
  environment: defaultEnvironment(),
  previews: { ...previews, access: "public", ttlDays: 7 },
};

const base: SlackWorkspace = {
  teamId: "T0MOCK123",
  teamName: "Acme Robotics",
  homeFolder: "Slack/Acme Robotics",
  installedAt: Date.now() - 3 * 86_400_000,
  engine: "stella",
  model: "stella/default",
  effort: "medium",
  slackCommands: true,
  githubAccounts: [],
  repos: [],
  previews,
  environment: defaultEnvironment(),
  rules: "Only Priya can ask for deploys.\nKeep answers in threads.",
  memory: "Standup is at 9:30 in #eng.\nThe firmware release train ships every second Tuesday.",
  slackUrl: "https://app.slack.com/client/T0MOCK123",
};

let workspace: SlackWorkspace | null = null;

const current = (mode: SlackMockMode | null): SlackWorkspace => {
  if (workspace) return workspace;
  workspace =
    mode === "github"
      ? {
          ...base,
          githubAccounts: [githubAccount("acme", "1", "active"), githubAccount("clearshelf", "3", "active")],
          repos: [firmware("github"), dashboard],
        }
      : mode === "revoked"
        ? { ...base, githubAccounts: [githubAccount("acme", "1", "revoked")], repos: [firmware("public")] }
        : mode === "legacy"
          ? { ...base, repos: [firmware("token")] }
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
  { fullName: "clearshelf/web", private: true, defaultBranch: "main" },
  { fullName: "muse/app", private: true, defaultBranch: "main" },
];

const applyEnvironment = (
  now: SlackWorkspaceEnvironment | null,
  update: SlackWorkspaceEnvironmentUpdate | undefined,
): SlackWorkspaceEnvironment | null => {
  if (!update || !now) return now;
  const { secrets, ...fields } = update;
  const kept = now.secrets.filter((secret) => !secrets?.remove?.includes(secret.id));
  const added = (secrets?.add ?? []).map((secret) => ({
    id: crypto.randomUUID(),
    name: secret.name,
    host: secret.host,
    header: secret.header || "Authorization",
  }));
  return { ...now, ...fields, secrets: [...kept, ...added] };
};

const accessFor = (w: SlackWorkspace, fullName: string): SlackWorkspaceRepo["access"] =>
  w.githubAccounts.some((account) => fullName.toLowerCase().startsWith(`${account.account.toLowerCase()}/`))
    ? "github"
    : "public";

const save = (next: SlackWorkspace): Promise<SlackWorkspaceUpdateResponse> => {
  workspace = next;
  return wait({ workspace: next });
};

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
    const { previews: previewUpdate, environment, ...rest } = update;
    const now = current(mockMode());
    return save({
      ...now,
      ...rest,
      previews: { ...now.previews, ...previewUpdate },
      environment: applyEnvironment(now.environment, environment),
    });
  },
  addRepo(_teamId: string, add: SlackRepoAdd): Promise<SlackRepoAddResponse> {
    const now = current(mockMode());
    if (now.repos.some((repo) => repo.fullName.toLowerCase() === add.fullName.toLowerCase())) {
      return Promise.reject(new Error(`${add.fullName} is already in this workspace.`));
    }
    const repo: SlackWorkspaceRepo = {
      id: `r${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`,
      fullName: add.fullName,
      branch: add.branch ?? "",
      access: accessFor(now, add.fullName),
      rules: "",
      channels: [],
      environment: defaultEnvironment(),
      previews: now.previews,
    };
    const next = { ...now, repos: [...now.repos, repo] };
    workspace = next;
    return wait({ workspace: next, repoId: repo.id });
  },
  updateRepo(_teamId: string, repoId: string, update: SlackRepoUpdate): Promise<SlackWorkspaceUpdateResponse> {
    const now = current(mockMode());
    return save({
      ...now,
      repos: now.repos.map((repo) =>
        repo.id !== repoId
          ? repo
          : {
              ...repo,
              ...(update.branch !== undefined ? { branch: update.branch } : {}),
              ...(update.rules !== undefined ? { rules: update.rules } : {}),
              previews: { ...repo.previews, ...update.previews },
              environment: applyEnvironment(repo.environment, update.environment),
              channels: repo.channels.filter((channel) => !update.removeChannels?.includes(channel.id)),
            },
      ),
    });
  },
  removeRepo(_teamId: string, repoId: string): Promise<SlackWorkspaceUpdateResponse> {
    const now = current(mockMode());
    return save({ ...now, repos: now.repos.filter((repo) => repo.id !== repoId) });
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
          { installationId: "4", account: "muse", accountType: "Organization" },
        ],
      });
    }
    const now = current(mockMode());
    const account = installationId === "4" ? "muse" : "acme";
    const accounts = [...now.githubAccounts.filter((a) => a.installationId !== installationId), githubAccount(account, installationId, "active")];
    const next = { ...now, githubAccounts: accounts };
    return save({ ...next, repos: next.repos.map((repo) => ({ ...repo, access: accessFor(next, repo.fullName) })) });
  },
  disconnectGithub(installationId: string): Promise<SlackWorkspaceUpdateResponse> {
    const now = current(mockMode());
    const next = { ...now, githubAccounts: now.githubAccounts.filter((a) => a.installationId !== installationId) };
    return save({
      ...next,
      repos: next.repos.map((repo) => ({ ...repo, access: repo.access === "token" ? "token" : accessFor(next, repo.fullName) })),
    });
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
