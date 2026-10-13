"use client";

import {
  SLACK_INSTALL_START_PATH,
  SLACK_WORKSPACES_PATH,
  slackGithubPath,
  slackWorkspacePath,
  type SlackGithubBranchesResponse,
  type SlackGithubConnectRequest,
  type SlackGithubConnectResponse,
  type SlackGithubFinishRequest,
  type SlackGithubFinishResponse,
  type SlackGithubReposResponse,
  type SlackInstallStartRequest,
  type SlackInstallStartResponse,
  type SlackWorkspaceUpdate,
  type SlackWorkspaceUpdateResponse,
  type SlackWorkspacesResponse,
} from "@stella/contracts/slack-workspace";
import { getAuthToken } from "@/lib/auth-token";
import { readBackendUrl } from "@/lib/backend-url";
import { mockSlackApi, readMockMode } from "./slack-mock";

export class SlackApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    const message = body.message ?? body.error;
    if (typeof message === "string" && message.trim()) return message.trim();
    if (message && typeof message === "object" && "message" in message) {
      const nested = (message as { message?: unknown }).message;
      if (typeof nested === "string" && nested.trim()) return nested.trim();
    }
  } catch {}
  if (response.status === 401) return "Your sign-in expired. Sign in again.";
  if (response.status === 403) return "Only the Stella account that added this workspace can change it.";
  if (response.status === 404) return "That workspace isn't connected to your Stella account.";
  return `The request failed (${response.status}).`;
};

async function request<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
  const baseUrl = readBackendUrl();
  if (!baseUrl) throw new SlackApiError("Stella's backend isn't configured on this site.", 0);
  const send = async (forceRefresh: boolean) => {
    const token = await getAuthToken(forceRefresh ? { forceRefresh: true } : undefined);
    if (!token) throw new SlackApiError("Sign in to Stella first.", 401);
    return fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  };
  let response = await send(false);
  if (response.status === 401) response = await send(true);
  if (!response.ok) throw new SlackApiError(await readErrorMessage(response), response.status);
  return (await response.json()) as T;
}

export function listSlackWorkspaces(): Promise<SlackWorkspacesResponse> {
  const mock = readMockMode();
  if (mock) return mockSlackApi.list(mock);
  return request<SlackWorkspacesResponse>(SLACK_WORKSPACES_PATH, { method: "GET" });
}

export function updateSlackWorkspace(
  teamId: string,
  update: SlackWorkspaceUpdate,
): Promise<SlackWorkspaceUpdateResponse> {
  if (readMockMode()) return mockSlackApi.update(teamId, update);
  return request<SlackWorkspaceUpdateResponse>(slackWorkspacePath(teamId), {
    method: "POST",
    body: update,
  });
}

export function startSlackInstall(returnTo: string): Promise<SlackInstallStartResponse> {
  if (readMockMode()) return mockSlackApi.install(returnTo);
  const body: SlackInstallStartRequest = { returnTo };
  return request<SlackInstallStartResponse>(SLACK_INSTALL_START_PATH, { method: "POST", body });
}

export function connectGithub(teamId: string, returnTo: string): Promise<SlackGithubConnectResponse> {
  if (readMockMode()) return mockSlackApi.connectGithub(returnTo);
  const body: SlackGithubConnectRequest = { returnTo };
  return request<SlackGithubConnectResponse>(slackGithubPath(teamId, "connect"), { method: "POST", body });
}

export function finishGithub(
  teamId: string,
  code: string,
  installationId?: string,
): Promise<SlackGithubFinishResponse> {
  if (readMockMode()) return mockSlackApi.finishGithub(installationId);
  const body: SlackGithubFinishRequest = { code, ...(installationId ? { installationId } : {}) };
  return request<SlackGithubFinishResponse>(slackGithubPath(teamId, "finish"), { method: "POST", body });
}

export function disconnectGithub(teamId: string): Promise<SlackWorkspaceUpdateResponse> {
  if (readMockMode()) return mockSlackApi.disconnectGithub();
  return request<SlackWorkspaceUpdateResponse>(slackGithubPath(teamId, "disconnect"), { method: "POST" });
}

export function listGithubRepos(teamId: string): Promise<SlackGithubReposResponse> {
  if (readMockMode()) return mockSlackApi.repos();
  return request<SlackGithubReposResponse>(slackGithubPath(teamId, "repos"), { method: "GET" });
}

export function listGithubBranches(teamId: string, repo: string): Promise<SlackGithubBranchesResponse> {
  if (readMockMode()) return mockSlackApi.branches(repo);
  return request<SlackGithubBranchesResponse>(
    `${slackGithubPath(teamId, "branches")}?repo=${encodeURIComponent(repo)}`,
    { method: "GET" },
  );
}
