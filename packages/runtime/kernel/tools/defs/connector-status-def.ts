export const CONNECTOR_STATUS_TOOL_NAME = "connector_status";

export const CONNECTOR_STATUS_TOOL_LABEL = "Connector status";

export const CONNECTOR_STATUS_TOOL_WORKING_TEXT = "Checking connector";

export const CONNECTOR_STATUS_SEARCH_TERMS = [
  "connector",
  "connectors",
  "integration",
  "integrations",
  "connect",
  "connection",
  "status",
  "oauth",
  "account",
  "service",
  "store",
] as const;

export const CONNECTOR_STATUS_TOOL_DESCRIPTION =
  "Check whether a Store connector (Gmail, Outlook, Slack, Notion and hundreds more) is connected; if not, show the user a connect card, which is their consent, and wait for their choice. Once connected, its actions are tools in code (find them with tools.$search); continue the task without asking again. After a decline or a dismissed card, mention once that it's in the Store, don't offer it again unless asked, and continue another way (the browser or computer). Google connectors (Gmail, Calendar, Drive, Docs, Sheets) can have several accounts: the result lists each connected account's email and which is primary; their tools take an optional `account` email (default: the primary). Pass `account` to check one account, or `add_account: true` when the user asks to connect another account (shows the connect card again).";

export const connectorConnectedText = (
  name: string,
  id: string,
): string =>
  `${name} (\`${id}\`) connected. Its actions are tools in code: await tools.$search({ query: "${name}" }).`;

export type ConnectorStatusAccount = {
  email?: string;
  label: string;
  primary: boolean;
  connected?: boolean;
};

export const connectorAccountsText = (
  accounts: readonly ConnectorStatusAccount[],
): string => {
  if (accounts.length === 0) return "";
  const list = accounts
    .map(
      (account) =>
        `${account.email ?? account.label}${account.primary ? " (primary)" : ""}${account.connected === false ? " (needs reconnecting)" : ""}`,
    )
    .join(", ");
  return accounts.length === 1
    ? ` Connected account: ${list}.`
    : ` Connected accounts: ${list}. Its tools take \`account\` (an email) to choose one, defaulting to the primary; when the user doesn't say which, search or read each account and label the results.`;
};

export const findConnectorStatusAccount = <T extends ConnectorStatusAccount>(
  accounts: readonly T[],
  query: string,
): T | undefined => {
  const wanted = query.trim().toLowerCase();
  return accounts.find(
    (account) =>
      account.email?.toLowerCase() === wanted ||
      account.label.toLowerCase() === wanted,
  );
};

export const connectorNotConnectedText = (name: string, reason: string): string =>
  `${name} not connected: ${reason}.`;

export const CONNECTOR_STATUS_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    connector: {
      type: "string",
      description:
        'Connector id or name (e.g. "gmail", "Google Calendar", "notion").',
    },
    reason: {
      type: "string",
      description:
        'Optional one-line, user-facing context shown on the card (e.g. "To check your recent purchase emails").',
    },
    account: {
      type: "string",
      description:
        "Optional email of one account to check, for connectors with several accounts (Google).",
    },
    add_account: {
      type: "boolean",
      description:
        "Show the connect card even when already connected, to add another account (Google connectors). Only when the user asked to connect another account.",
    },
  },
  required: ["connector"],
  additionalProperties: false,
};

export const CONNECTOR_STATUS_TOOL_REPLAY = "safe" as const;
