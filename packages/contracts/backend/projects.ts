export type CloudProject = {
  projectId: string;
  slug: string;
  name: string;
  provider: string;
  remoteUrl?: string;
  githubConnected: boolean;
  defaultBranch: string;
  status: string;
  createdAt: number;
  updatedAt: number;
};

export type GithubConnection = {
  installationId: string;
  accountLogin: string;
  accountType: string;
  status: string;
  updatedAt: number;
};

export type ProjectCalls = {
  "projects.create": {
    args: {
      name: string;
      slug?: string;
      remoteUrl?: string;
      defaultBranch?: string;
      installationId?: string;
    };
    result: CloudProject;
  };
  "projects.startGithubInstall": {
    args: Record<string, never>;
    result: { installUrl: string };
  };
  "projects.finishGithubConnect": {
    args: { connectCode: string };
    result: { ok: boolean; accountLogin: string; accountType: string; reason?: string };
  };
};

export type ProjectViews = {
  "projects.list": { args: Record<string, never>; result: CloudProject[] };
  "projects.github": {
    args: Record<string, never>;
    result: { appConfigured: boolean; connections: GithubConnection[] };
  };
};
