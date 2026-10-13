import { formatDateTimeReminder, THIRTY_MINUTES_MS, wrapSystemReminder } from "@stella/contracts/message-timestamp";
import { getNativeConnectorConnectionState } from "../../kernel/connectors/connection-status.js";
import { getConnectorKeywordIndex, matchConnectorsInMessage } from "../../kernel/connectors/keyword-index.js";
import type { NativeConnectorCatalogEntry } from "../../kernel/connectors/native-integrations.js";

const MAX_CONNECTOR_REMINDERS = 2;
const MCP_KEYWORD_RE = /\bmcp\b/iu;

const MCP_HINT =
  "Keyword hint: MCP was mentioned, possibly incidentally. If the user wants to manage an MCP connection, agents can use connect.addMcp(…) or connect.remove(id) inside code; an added server's actions become tools there. connect.documentation() has details.";

const connectedHint = (entry: NativeConnectorCatalogEntry): string =>
  `Keyword hint: ${entry.name} may be relevant. It is connected (integration id \`${entry.id}\`). If it fits the user's intent, its actions are tools in \`code\` (await tools.$search({ query: "${entry.name} <task>" })). The keyword match alone does not imply it should be used.`;

const offerHint = (entry: NativeConnectorCatalogEntry): string =>
  [
    `Keyword hint: ${entry.name} may be relevant. Its connector is not connected.`,
    `If it fits the user's intent and would help, \`connector_status\` can show an inline connect card (connector: "${entry.id}"; also available inside code as tools.connector_status({ connector: "${entry.id}" })).`,
    `The keyword match alone does not imply a connection is needed.`,
  ].join(" ");

const connectorHints = async (dataDir: string, text: string): Promise<string[]> => {
  const hints: string[] = [];
  if (MCP_KEYWORD_RE.test(text)) hints.push(MCP_HINT);
  let matches: NativeConnectorCatalogEntry[];
  try {
    matches = matchConnectorsInMessage(await getConnectorKeywordIndex(dataDir), text);
  } catch {
    matches = [];
  }
  for (const entry of matches) {
    if (hints.length >= MAX_CONNECTOR_REMINDERS) break;
    try {
      const state = await getNativeConnectorConnectionState(dataDir, entry);
      if (state.connected) {
        hints.push(connectedHint(entry));
        continue;
      }
      if (!entry.connectable) continue;
      hints.push(offerHint(entry));
    } catch {
      continue;
    }
  }
  return hints;
};

export const piUserReminders = async (
  dataDir: string,
  input: { text: string; sentAt: number; previousUserAt?: number; timezone?: string },
): Promise<string[]> => {
  const reminders: string[] = [];
  if (input.previousUserAt === undefined || input.sentAt - input.previousUserAt >= THIRTY_MINUTES_MS) {
    reminders.push(formatDateTimeReminder(input.sentAt, input.timezone));
  }
  reminders.push(...(await connectorHints(dataDir, input.text)));
  return reminders.map((text) => wrapSystemReminder(text));
};
