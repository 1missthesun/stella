/**
 * The `connector_status` tool's model-visible surface, split from the
 * executable definition so workerd hosts advertise the byte-identical tool.
 * The device implementation resolves the catalog from disk and shows the
 * card over Electron IPC; the cloud Durable Object resolves it from the
 * Store backend and shows the card through the conversation journal.
 */

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
  "Check whether a Store connector (Gmail, Outlook, Slack, Notion and hundreds more) is connected; if not, show the user a connect card, which is their consent, and wait for their choice. Once connected, its actions are tools in code (find them with tools.$search); continue the task without asking again. After a decline or a dismissed card, mention once that it's in the Store, don't offer it again unless asked, and continue another way (the browser or computer).";

export const connectorConnectedText = (
  name: string,
  id: string,
): string =>
  `${name} (\`${id}\`) connected. Its actions are tools in code: await tools.$search({ query: "${name}" }).`;

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
  },
  required: ["connector"],
  additionalProperties: false,
};

/** Replay policy (`ToolReplayPolicy` in ../types.ts). A status read. The connect card it may show is not a durable effect on desktop (it dies with the process) and is deduplicated per turn and integration in the cloud. */
export const CONNECTOR_STATUS_TOOL_REPLAY = "safe" as const;
