/**
 * `connector_status` for the cloud orchestrator — the device tool's exact
 * model-visible surface (see `defs/connector-status-def.ts`) over the
 * account's Store integrations.
 *
 * Same contract as the device: pure lookup plus the inline connect card,
 * blocking until the user connects, declines, or the card times out. The
 * card itself is delivered through the conversation (the Durable Object
 * publishes a pending connect request the clients render), and the user's
 * answer resolves the same account-level Composio connection the desktop
 * app would have made.
 */

import type { TSchema } from "@sinclair/typebox";
import {
  CONNECTOR_STATUS_SEARCH_TERMS,
  CONNECTOR_STATUS_TOOL_DESCRIPTION,
  CONNECTOR_STATUS_TOOL_LABEL,
  CONNECTOR_STATUS_TOOL_NAME,
  CONNECTOR_STATUS_TOOL_PARAMETERS,
  CONNECTOR_STATUS_TOOL_REPLAY,
  CONNECTOR_STATUS_TOOL_WORKING_TEXT,
  connectorConnectedText,
  connectorNotConnectedText,
} from "@stella/runtime/kernel/tools/defs/connector-status-def.js";
import type { CloudCodeSourceAgentTool } from "./cloud-code-tool.js";
import {
  resolveCloudConnectorEntry,
  type CloudConnectorCatalogEntry,
  type CloudConnectorDirectory,
} from "./cloud-connect-client.js";

export type CloudConnectorConnectionRequest = Readonly<{
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  category?: string;
  reason?: string;
}>;

export type CloudConnectorConnectionOutcome =
  | Readonly<{ ok: true; status: "connected" | "already_connected" }>
  | Readonly<{
      ok: false;
      reason: "declined" | "cancelled" | "timeout" | "unsupported" | string;
    }>;

/** The cloud hop that renders the inline connect card and awaits the answer. */
export type CloudConnectorConnectionRequester = (
  request: CloudConnectorConnectionRequest,
  signal?: AbortSignal,
) => Promise<CloudConnectorConnectionOutcome>;

export type CloudConnectorStatusToolOptions = Readonly<{
  directory: CloudConnectorDirectory;
  requestConnection?: CloudConnectorConnectionRequester;
}>;

const text = (value: string, details: Record<string, unknown>, isError = false) => ({
  content: [{ type: "text" as const, text: value }],
  details,
  ...(isError ? { isError: true } : {}),
});

const diagnosticsFor = (
  entry: CloudConnectorCatalogEntry,
  connected: boolean,
) => ({
  id: entry.id,
  toolCount: entry.catalogToolCount,
  connected,
});

export const createCloudConnectorStatusTool = (
  options: CloudConnectorStatusToolOptions,
): CloudCodeSourceAgentTool => ({
  name: CONNECTOR_STATUS_TOOL_NAME,
  replay: CONNECTOR_STATUS_TOOL_REPLAY,
  label: CONNECTOR_STATUS_TOOL_LABEL,
  workingText: CONNECTOR_STATUS_TOOL_WORKING_TEXT,
  description: CONNECTOR_STATUS_TOOL_DESCRIPTION,
  parameters: CONNECTOR_STATUS_TOOL_PARAMETERS as unknown as TSchema,
  demoted: { searchTerms: CONNECTOR_STATUS_SEARCH_TERMS },
  execute: async (_toolCallId, params, signal) => {
    const args = params as { connector?: unknown; reason?: unknown };
    const query =
      typeof args.connector === "string" ? args.connector.trim() : "";
    if (!query) {
      return text("connector is required (id or name).", {}, true);
    }
    const reason =
      typeof args.reason === "string" && args.reason.trim()
        ? args.reason.trim()
        : undefined;

    const catalog = await options.directory.catalog();
    const { entry, suggestions } = resolveCloudConnectorEntry(catalog, query);
    if (!entry) {
      const hint =
        suggestions.length > 0
          ? ` Closest matches: ${suggestions
              .map((candidate) => `${candidate.name} (\`${candidate.id}\`)`)
              .join(", ")}.`
          : "";
      return text(
        `No Store connector matched "${query}".${hint} If no connector fits, proceed via the browser/computer fallback.`,
        {},
        true,
      );
    }

    const connected = await options.directory.isConnected(entry.id, {
      refresh: true,
    });
    const diagnostics = diagnosticsFor(entry, connected);
    if (connected) {
      return text(
        connectorConnectedText(entry.name, entry.id),
        { ...diagnostics, status: "executable" },
      );
    }

    if (entry.catalogToolCount === 0) {
      return text(
        connectorNotConnectedText(entry.name, "it has no tools it can run"),
        { ...diagnostics, status: "not_executable" },
      );
    }

    if (!options.requestConnection) {
      return text(
        connectorNotConnectedText(entry.name, "it can't be connected from here"),
        { ...diagnostics, status: "not_connected", reason: "flow_unavailable" },
      );
    }

    const outcome = await options.requestConnection(
      {
        id: entry.id,
        name: entry.name,
        description: entry.description,
        ...(entry.iconUrl ? { iconUrl: entry.iconUrl } : {}),
        category: entry.category,
        ...(reason ? { reason } : {}),
      },
      signal,
    );

    if (outcome.ok) {
      // The connect card resolved an account-level connection; the
      // directory's connection snapshot for this turn is now stale.
      await options.directory.connections({ refresh: true }).catch(() => []);
      return text(
        `${connectorConnectedText(entry.name, entry.id)} The user approved the card.`,
        { id: entry.id, status: "connected" },
      );
    }
    if (outcome.reason === "declined") {
      return text(
        connectorNotConnectedText(entry.name, "the user declined"),
        { id: entry.id, status: "declined" },
      );
    }
    if (outcome.reason === "cancelled" && signal?.aborted) {
      return text(
        connectorNotConnectedText(entry.name, "the turn was canceled"),
        { id: entry.id, status: "not_connected", reason: "turn_cancelled" },
      );
    }
    if (outcome.reason === "cancelled" || outcome.reason === "timeout") {
      return text(
        connectorNotConnectedText(
          entry.name,
          outcome.reason === "timeout" ? "the card went unanswered" : "the user dismissed the card",
        ),
        {
          id: entry.id,
          status: "not_connected",
          reason: outcome.reason === "timeout" ? "timeout" : "dismissed",
        },
      );
    }
    return text(
      connectorNotConnectedText(entry.name, `the connect flow failed (${outcome.reason})`),
      { id: entry.id, status: "not_connected", reason: outcome.reason },
      true,
    );
  },
});
