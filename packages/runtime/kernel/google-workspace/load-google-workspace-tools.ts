/**
 * Loads Google Workspace tools directly via the per-API `@googleapis/*`
 * clients (gmail, calendar, drive, docs, people).
 *
 * @license
 * Portions Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createRuntimeLogger } from "../debug.js";
import {
  GOOGLE_WORKSPACE_TOOL_ALLOWLIST,
  toGoogleWorkspaceToolRegistrationName,
} from "./tool-allowlist.js";
import type { ToolDefinition } from "../extensions/types.js";
import type { ToolContext, ToolResult } from "../tools/types.js";
import { setGoogleWorkspaceProjectRoot } from "./paths.js";
import { SCOPES } from "./scopes.js";
import type { AuthManager } from "./AuthManager.js";
import type { DriveService } from "./DriveService.js";
import type { DocsService } from "./DocsService.js";
import type { CalendarService } from "./CalendarService.js";
import type { GmailService } from "./GmailService.js";
import type { PeopleService } from "./PeopleService.js";
import { TimeService } from "./TimeService.js";
import { formatGoogleWorkspaceCallToolResult } from "./format-google-workspace-result.js";
import { GOOGLE_WORKSPACE_TOOL_METADATA } from "./google-workspace-tool-metadata.js";
import {
  hasConnectorAccount,
  listConnectorAccounts,
  removeConnectorAccount,
  resolveConnectorAccount,
} from "../connectors/accounts.js";
import {
  connectorAccountToolHint,
  splitConnectorAccountArg,
  withConnectorAccountParameter,
} from "../connectors/connector-tools.js";
import { GOOGLE_WORKSPACE_ACCOUNTS } from "./accounts.js";

const logger = createRuntimeLogger("google-workspace");

const AUTH_ERROR_PATTERN =
  /\bauth\b|oauth|sign[._-]?in|login|consent|credential|unauthorized|unauthenticated|\b403\b|\b401\b/i;

export type GoogleWorkspaceCallToolFn = (
  name: string,
  args: Record<string, unknown>,
) => Promise<ToolResult>;

function buildHandlers(
  auth: AuthManager,
  drive: DriveService,
  docs: DocsService,
  calendar: CalendarService,
  gmail: GmailService,
  people: PeopleService,
  time: TimeService,
): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
  return {
    "auth.refreshToken": async () => {
      await auth.refreshToken();
      return {
        content: [
          {
            type: "text" as const,
            text: "Token refresh process triggered successfully.",
          },
        ],
      };
    },
    "docs.getSuggestions": (args) =>
      docs.getSuggestions(args as { documentId: string }),
    "docs.getComments": async (args) => {
      const fileId =
        (typeof args.documentId === "string" && args.documentId) ||
        (typeof args.fileId === "string" && args.fileId) ||
        "";
      if (!fileId) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "documentId or fileId is required.",
              }),
            },
          ],
        };
      }
      return drive.getComments({ fileId });
    },
    "docs.create": (args) =>
      docs.create(args as { title: string; content?: string }),
    "docs.writeText": (args) =>
      docs.writeText(
        args as {
          documentId: string;
          text: string;
          position?: string;
          tabId?: string;
        },
      ),
    "docs.getText": (args) =>
      docs.getText(args as { documentId: string; tabId?: string }),
    "docs.replaceText": (args) =>
      docs.replaceText(
        args as {
          documentId: string;
          findText: string;
          replaceText: string;
          tabId?: string;
        },
      ),
    "docs.formatText": (args) =>
      docs.formatText(
        args as {
          documentId: string;
          formats: {
            startIndex: number;
            endIndex: number;
            style: string;
            url?: string;
          }[];
          tabId?: string;
        },
      ),
    "drive.search": (args) => drive.search(args as Record<string, unknown>),
    "drive.findFolder": (args) =>
      drive.findFolder(args as { folderName: string }),
    "drive.createFolder": (args) =>
      drive.createFolder(
        args as { name: string; parentId?: string },
      ),
    "drive.downloadFile": (args) =>
      drive.downloadFile(
        args as { fileId: string; localPath: string },
      ),
    "drive.renameFile": (args) =>
      drive.renameFile(
        args as { fileId: string; newName: string },
      ),
    "calendar.list": () => calendar.listCalendars(),
    "calendar.createEvent": (args) =>
      calendar.createEvent(args as never),
    "calendar.listEvents": (args) =>
      calendar.listEvents(args as never),
    "calendar.getEvent": (args) =>
      calendar.getEvent(args as never),
    "calendar.findFreeTime": (args) =>
      calendar.findFreeTime(args as never),
    "calendar.updateEvent": (args) =>
      calendar.updateEvent(args as never),
    "calendar.respondToEvent": (args) =>
      calendar.respondToEvent(args as never),
    "gmail.search": (args) => gmail.search(args as never),
    "gmail.get": (args) => gmail.get(args as never),
    "gmail.downloadAttachment": (args) =>
      gmail.downloadAttachment(args as never),
    "gmail.modify": (args) => gmail.modify(args as never),
    "gmail.send": (args) => gmail.send(args as never),
    "gmail.createDraft": (args) =>
      gmail.createDraft(args as never),
    "gmail.sendDraft": (args) =>
      gmail.sendDraft(args as { draftId: string }),
    "gmail.listLabels": () => gmail.listLabels(),
    "gmail.createLabel": (args) =>
      gmail.createLabel(args as never),
    ...buildTimeHandlers(time),
    "people.getMe": () => people.getMe(),
  };
}

function buildTimeHandlers(
  time: TimeService,
): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
  return {
    "time.getCurrentDate": () => time.getCurrentDate(),
    "time.getCurrentTime": () => time.getCurrentTime(),
    "time.getTimeZone": () => time.getTimeZone(),
  };
}

type GoogleWorkspaceModules = {
  AuthManager: typeof import("./AuthManager.js").AuthManager;
  DriveService: typeof import("./DriveService.js").DriveService;
  DocsService: typeof import("./DocsService.js").DocsService;
  CalendarService: typeof import("./CalendarService.js").CalendarService;
  GmailService: typeof import("./GmailService.js").GmailService;
  PeopleService: typeof import("./PeopleService.js").PeopleService;
};

const loadGoogleWorkspaceModules = async (): Promise<GoogleWorkspaceModules> => {
  const [
    { AuthManager },
    { DriveService },
    { DocsService },
    { CalendarService },
    { GmailService },
    { PeopleService },
  ] = await Promise.all([
    import("./AuthManager.js"),
    import("./DriveService.js"),
    import("./DocsService.js"),
    import("./CalendarService.js"),
    import("./GmailService.js"),
    import("./PeopleService.js"),
  ]);
  return {
    AuthManager,
    DriveService,
    DocsService,
    CalendarService,
    GmailService,
    PeopleService,
  };
};

export const loadGoogleWorkspaceTools = async (options: {
  stellaAppDir: string;
  onAuthStateChanged?: (authenticated: boolean) => void;
}): Promise<{
  tools: ToolDefinition[];
  disconnect: () => Promise<void>;
  callTool: GoogleWorkspaceCallToolFn | null;
  hasStoredCredentials: boolean;
}> => {
  const root = path.join(options.stellaAppDir, "google-workspace");
  await mkdir(root, { recursive: true, mode: 0o700 });
  setGoogleWorkspaceProjectRoot(root);

  const modules = await loadGoogleWorkspaceModules();
  const time = new TimeService();
  const authManagers = new Set<AuthManager>();

  const handlersForAccount = (tokenKey: string) => {
    const authManager = new modules.AuthManager(SCOPES, tokenKey);
    authManagers.add(authManager);
    return {
      authManager,
      handlers: buildHandlers(
        authManager,
        new modules.DriveService(authManager),
        new modules.DocsService(authManager),
        new modules.CalendarService(authManager),
        new modules.GmailService(authManager),
        new modules.PeopleService(authManager),
        time,
      ),
    };
  };

  const NON_AUTH_TOOLS = new Set(["time.getCurrentDate", "time.getCurrentTime", "time.getTimeZone"]);

  const callGoogleWorkspaceTool = async (
    name: string,
    rawArgs: Record<string, unknown>,
  ): Promise<ToolResult> => {
    const { account: requestedAccount, rest: args } =
      splitConnectorAccountArg(rawArgs);
    if (NON_AUTH_TOOLS.has(name)) {
      const timeHandlers = buildTimeHandlers(time);
      const handler = timeHandlers[name];
      if (!handler) return { error: `Unknown Google Workspace tool: ${name}` };
      return formatGoogleWorkspaceCallToolResult(await handler(args));
    }
    if (!(await hasConnectorAccount(options.stellaAppDir, GOOGLE_WORKSPACE_ACCOUNTS))) {
      options.onAuthStateChanged?.(false);
      return {
        error:
          "Google Workspace is not connected. Enable Gmail / Calendar / Docs / Drive in the Store first.",
      };
    }
    let account;
    try {
      account = await resolveConnectorAccount(
        options.stellaAppDir,
        GOOGLE_WORKSPACE_ACCOUNTS,
        requestedAccount,
      );
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
    const accountLabel = account.email ?? "the primary Google account";

    try {
      if (name === "auth.clear") {
        await removeConnectorAccount(
          options.stellaAppDir,
          GOOGLE_WORKSPACE_ACCOUNTS,
          account.id,
        );
        return {
          result: `Disconnected ${accountLabel}. Connect it again from the Store to use it.`,
        };
      }
      const { handlers, authManager } = handlersForAccount(account.tokenKey);
      const handler = handlers[name];
      if (!handler) {
        return { error: `Unknown Google Workspace tool: ${name}` };
      }
      const raw = await handler(args).finally(() => {
        authManager.dispose();
        authManagers.delete(authManager);
      });
      const formatted = formatGoogleWorkspaceCallToolResult(raw);
      if (
        "error" in formatted &&
        AUTH_ERROR_PATTERN.test(formatted.error ?? "")
      ) {
        options.onAuthStateChanged?.(false);
        return { error: `${formatted.error} (account: ${accountLabel})` };
      }
      if (!("error" in formatted)) {
        options.onAuthStateChanged?.(true);
        return account.email
          ? { ...formatted, details: { account: account.email } }
          : formatted;
      }
      return formatted;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (AUTH_ERROR_PATTERN.test(message)) {
        options.onAuthStateChanged?.(false);
      }
      return {
        error: `Google Workspace tool failed for ${accountLabel}: ${message}`,
      };
    }
  };

  const accounts = await listConnectorAccounts(
    options.stellaAppDir,
    GOOGLE_WORKSPACE_ACCOUNTS,
  ).catch(() => []);

  const toolsOut: ToolDefinition[] = [];
  for (const toolName of GOOGLE_WORKSPACE_TOOL_ALLOWLIST) {
    const registrationToolName =
      toGoogleWorkspaceToolRegistrationName(toolName);
    const meta = GOOGLE_WORKSPACE_TOOL_METADATA[toolName];
    if (!meta) {
      logger.warn("google_workspace.missing_metadata", { toolName });
      continue;
    }

    const execute = async (
      executeArgs: Record<string, unknown>,
      _context: ToolContext,
    ): Promise<ToolResult> => callGoogleWorkspaceTool(toolName, executeArgs);

    const accountAware = !toolName.startsWith("time.");
    toolsOut.push({
      name: registrationToolName,
      description: accountAware
        ? `${meta.description} ${connectorAccountToolHint(accounts)}`
        : meta.description,
      agentTypes: ["general"],
      parameters: accountAware
        ? withConnectorAccountParameter(meta.parameters, accounts)
        : meta.parameters,
      execute,
    });
  }

  logger.info("google_workspace.direct.ready", {
    toolCount: toolsOut.length,
    dataRoot: root,
  });

  const disconnect = async () => {
    for (const authManager of authManagers) authManager.dispose();
    authManagers.clear();
  };

  return {
    tools: toolsOut,
    disconnect,
    callTool: callGoogleWorkspaceTool,
    hasStoredCredentials: accounts.length > 0,
  };
};
