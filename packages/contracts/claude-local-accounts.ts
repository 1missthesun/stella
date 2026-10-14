export type ClaudeLocalConfig = {
  configId: string;
  isDefault: boolean;
  loggedIn: boolean;
  email?: string;
  plan?: string;
};

export type ClaudeLocalAccountsState = {
  cliInstalled: boolean;
  configs: ClaudeLocalConfig[];
  activeConfigId: string | null;
  activeReason?: "selected" | "own_login" | "other_login";
  chosenEmail?: string;
};

export type ClaudeLocalLoginStart = {
  loginId: string;
  authorizeUrl: string;
};
