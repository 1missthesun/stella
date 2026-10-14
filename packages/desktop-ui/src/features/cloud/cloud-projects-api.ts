import type { CallArgs } from "@stella/contracts/backend/api";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendValue } from "@/platform/backend/use-backend-view";

export type {
  CloudProject,
  GithubConnection,
} from "@stella/contracts/backend/projects";

export const useCloudProjects = () => useBackendValue("projects.list", {});

export const useGithubConnections = () => useBackendValue("projects.github", {});

export const createCloudProject = (args: CallArgs<"projects.create">) =>
  backendClient.call("projects.create", args);

export const startGithubInstall = () =>
  backendClient.call("projects.startGithubInstall", {});

export const finishGithubConnect = (connectCode: string) =>
  backendClient.call("projects.finishGithubConnect", { connectCode });
