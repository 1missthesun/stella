import { AgentHome } from "../agent-home.js";
import { createWorldMemory, ownerMemoryWorld } from "../world-memory.js";
import type { CloudSkillCatalogSnapshot } from "../cloud-home-store.js";
import { WORLD_ROOT, worldName } from "../workspace.js";
import { HISTORY_SQL_MAX_BYTES, historySearchOptions, runHistoryQuery } from "../history-sql.js";
import {
  type CloudCodeSourceAgentTool,
  createCloudCodeAgentTool,
} from "../cloud-code-tool.js";
import { createCloudImageGenTool } from "../cloud-image-gen-tool.js";
import { createCloudVideoGenTool } from "../cloud-video-gen-tool.js";
import { createCloudWebTool } from "../cloud-web-tool.js";
import { createCloudHtmlTool } from "../cloud-html-tool.js";
import { unwrapRpc } from "../owner-store/errors.js";
import { createCloudDriveTool } from "../cloud-drive-tool.js";
import { createCloudReadTool } from "../cloud-read-tool.js";
import {
  createDriveFileSession,
  createWorldFilesWithDrive,
  runWorldToolWithDrive,
  type WorldStoreTools,
} from "../world-drive-files.js";
import { worldRelativeToolPath } from "../world/path.js";
import { createCloudScheduleTools } from "../cloud-schedule-tools.js";
import {
  CloudConnectorDirectory,
  ownerMcpSource,
  createCloudConnectClient,
} from "../cloud-connect-client.js";
import {
  listIntegrationActions,
  listIntegrationCatalog,
} from "../integrations/catalog.js";
import {
  type CloudConnectorConnectionOutcome,
  type CloudConnectorConnectionRequest,
  createCloudConnectorStatusTool,
} from "../cloud-connector-status-tool.js";
import { createCloudMapTool } from "../cloud-map-tool.js";
import { createCloudAskUserTool } from "../cloud-ask-user-tool.js";
import { mapsServerKey } from "../maps/google-resolve.js";
import { sleepWithAbort } from "@stella/runtime/kernel/tools/effect-runtime.js";
import { BACKFILL_BATCH_RECORDS } from "../conversation-types.js";
import type { ChatTurnRequest } from "./types.js";
import {
  CONNECT_CARD_WAIT_MS,
  CONNECT_CARD_POLL_MS,
} from "./constants.js";
import { OrchestratorPi } from "./pi.js";
import {
  createSlackMemoryTool,
  isSlackConversationId,
  SLACK_CONNECTOR_SOURCE,
} from "../slack/workspace.js";
import { createSlackRepoTool } from "../slack/repo-tool.js";
import { conversationWorldName, crewScopeForConversation } from "../slack/scope.js";

export abstract class OrchestratorTools extends OrchestratorPi {
  protected async createTools(
    turn: ChatTurnRequest,
    agentHome: AgentHome,
    skillCatalog: CloudSkillCatalogSnapshot,
    memoryEnabled: boolean,
  ): Promise<{
    catalog: readonly CloudCodeSourceAgentTool[];
  }> {
    const slack = isSlackConversationId(turn.conversationId);
    // Stella Crew works in its Slack workspace's own drive space and world.
    const crewScope = slack
      ? await crewScopeForConversation(this.env, turn.conversationId)
      : undefined;
    const toolContext = {
      ownerId: turn.ownerId,
      ownerGeneration: turn.ownerGeneration,
      conversationId: turn.conversationId,
      ownerInternal: async (name: string, args: unknown) =>
        unwrapRpc(
          await this.ownerGate(turn.ownerId).ownerInternal({
            name,
            args,
            ownerGeneration: turn.ownerGeneration,
            ...(crewScope ? { crew: crewScope } : {}),
          }),
        ),
    };
    let turnWorld: Promise<string> | undefined;
    const turnWorldName = () =>
      (turnWorld ??= conversationWorldName(this.env, turn.ownerId, turn.conversationId, worldName));
    const worldBinding = this.env.WORLDS as typeof this.env.WORLDS | undefined;
    const world = worldBinding
      ? (() => {
          const store = async () =>
            worldBinding.getByName(await turnWorldName());
          const worldTools: WorldStoreTools = {
            tool: async (call) => await (await store()).tool(call),
            stat: async (path) => await (await store()).stat(path),
            list: async (prefix, options) =>
              await (await store()).list(prefix, options),
            readFile: async (path, options) =>
              await (await store()).readFile(path, options),
            writeFile: async (path, bytes, options) =>
              await (await store()).writeFile(path, bytes, options),
            remove: async (path, options) =>
              await (await store()).remove(path, options),
            rename: async (from, to) => await (await store()).rename(from, to),
          };
          const drive = createDriveFileSession({
            turnId: turn.turnId,
            call: toolContext.ownerInternal,
          });
          const files = createWorldFilesWithDrive(worldTools, drive);
          return {
            tool: async (call: {
              name: "Read";
              arguments: Record<string, unknown>;
            }) => await runWorldToolWithDrive(call, worldTools, drive),
            stat: async (path: string) =>
              await files.stat(worldRelativeToolPath(path, WORLD_ROOT)),
            readFile: async (
              path: string,
              options?: { offset?: number; length?: number },
            ) =>
              await files.readFile(
                worldRelativeToolPath(path, WORLD_ROOT),
                options ?? {},
              ),
          };
        })()
      : undefined;
    const connectors = new CloudConnectorDirectory({
      source: {
        catalog: () => listIntegrationCatalog(this.env),
        actions: (args) => listIntegrationActions(this.env, args),
        connections: async () =>
          (await toolContext.ownerInternal("integrations.connections", {})) as {
            connections: Array<{ id: string; connected: boolean }>;
          },
        run: (args) => toolContext.ownerInternal("integrations.run", args),
      },
      ...(isSlackConversationId(turn.conversationId)
        ? {}
        : { mcp: ownerMcpSource(toolContext.ownerInternal) }),
    });

    if (slack) {
      const tools: CloudCodeSourceAgentTool[] = [
        createCloudWebTool({ ownerInternal: toolContext.ownerInternal }),
        createCloudImageGenTool({
          ownerGeneration: turn.ownerGeneration,
          conversationId: turn.conversationId,
          turnId: turn.turnId,
          ownerInternal: toolContext.ownerInternal,
          ...(crewScope ? { driveRoot: crewScope.home } : {}),
          publishFiles: (writerKey, files) =>
            this.publishTurnFilesCard(turn.turnId, writerKey, files),
        }),
        createCloudVideoGenTool({
          ownerGeneration: turn.ownerGeneration,
          conversationId: turn.conversationId,
          turnId: turn.turnId,
          ownerInternal: toolContext.ownerInternal,
          ...(crewScope ? { driveRoot: crewScope.home } : {}),
          publishFiles: (writerKey, files) =>
            this.publishTurnFilesCard(turn.turnId, writerKey, files),
        }),
        createCloudHtmlTool({
          turnId: turn.turnId,
          ownerInternal: toolContext.ownerInternal,
          ...(crewScope ? { driveRoot: crewScope.home } : {}),
          publishFiles: (writerKey, files) =>
            this.publishTurnFilesCard(turn.turnId, writerKey, files),
        }),
        createCloudMapTool({
          apiKey: mapsServerKey(this.env),
          ownerInternal: toolContext.ownerInternal,
        }),
        createCloudReadTool({
          ...(this.env.IMAGES ? { images: this.env.IMAGES } : {}),
          ...(agentHome.available
            ? { skills: { home: agentHome.cloudStore(), snapshot: skillCatalog } }
            : {}),
          ...(world ? { world } : {}),
        }),
        createCloudDriveTool({ ownerInternal: toolContext.ownerInternal }),
        createSlackMemoryTool({
          turnId: turn.turnId,
          ownerInternal: toolContext.ownerInternal,
          context: () => this.slack().workspace(),
        }),
        createSlackRepoTool({
          env: this.env as unknown as Cloudflare.Env,
          conversationId: turn.conversationId,
          context: () => this.slack().workspace(),
        }),
      ];
      const codeTool = await createCloudCodeAgentTool({
        loader: this.env.LOADER,
        tools,
        executionScope: `${turn.ownerGeneration}:${turn.conversationId}:${turn.turnId}`,
        connect: createCloudConnectClient(
          new CloudConnectorDirectory({ source: SLACK_CONNECTOR_SOURCE }),
        ),
        history: this.historyClient(),
      });
      return { catalog: [codeTool, ...tools] };
    }

    const tools: CloudCodeSourceAgentTool[] = [
      createCloudWebTool({ ownerInternal: toolContext.ownerInternal }),
      createCloudImageGenTool({
        ownerGeneration: turn.ownerGeneration,
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        ownerInternal: toolContext.ownerInternal,
        publishFiles: (writerKey, files) =>
          this.publishTurnFilesCard(turn.turnId, writerKey, files),
      }),
      createCloudVideoGenTool({
        ownerGeneration: turn.ownerGeneration,
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        ownerInternal: toolContext.ownerInternal,
        publishFiles: (writerKey, files) =>
          this.publishTurnFilesCard(turn.turnId, writerKey, files),
      }),
      createCloudHtmlTool({
        turnId: turn.turnId,
        ownerInternal: toolContext.ownerInternal,
        publishFiles: (writerKey, files) =>
          this.publishTurnFilesCard(turn.turnId, writerKey, files),
      }),
      createCloudMapTool({
        apiKey: mapsServerKey(this.env),
        ownerInternal: toolContext.ownerInternal,
      }),
      createCloudAskUserTool({
        conversationId: turn.conversationId,
        ownerInternal: toolContext.ownerInternal,
      }),
      createCloudReadTool({
        ...(this.env.IMAGES ? { images: this.env.IMAGES } : {}),
        ...(agentHome.available
          ? { skills: { home: agentHome.cloudStore(), snapshot: skillCatalog } }
          : {}),
        ...(world ? { world } : {}),
      }),
      createCloudDriveTool({ ownerInternal: toolContext.ownerInternal }),
      ...createCloudScheduleTools(toolContext),
      createCloudConnectorStatusTool({
        directory: connectors,
        requestConnection: (request, signal) =>
          this.requestCloudConnectorConnection(
            turn,
            toolContext.ownerInternal,
            request,
            signal,
          ),
      }),
    ];
    const memory =
      memoryEnabled && worldBinding
        ? createWorldMemory(
            () => ownerMemoryWorld(worldBinding, turn.ownerId),
            agentHome.memoryEpochFence(),
          )
        : undefined;
    const codeTool = await createCloudCodeAgentTool({
      loader: this.env.LOADER,
      tools,
      executionScope: `${turn.ownerGeneration}:${turn.conversationId}:${turn.turnId}`,
      connect: createCloudConnectClient(connectors),
      ...(memory ? { memory } : {}),
      ...(memoryEnabled ? { history: this.historyClient() } : {}),
    });
    return { catalog: [codeTool, ...tools] };
  }

  private historyClient() {
    return {
      search: async (text: string, options: unknown) => {
        await this.archive.reindexArchivedSearch();
        return this.journal.searchTranscript(text, historySearchOptions(options));
      },
      sql: (query: string, params: readonly SqlStorageValue[]) =>
        runHistoryQuery(this.ctx.storage, query, params, HISTORY_SQL_MAX_BYTES),
      read: (fromSeq: number, toSeq: number) =>
        this.archive.readRange(
          Math.max(0, fromSeq),
          toSeq,
          BACKFILL_BATCH_RECORDS,
        ),
    };
  }

  protected async requestCloudConnectorConnection(
    turn: ChatTurnRequest,
    ownerInternal: (name: string, args: unknown) => Promise<unknown>,
    request: CloudConnectorConnectionRequest,
    signal?: AbortSignal,
  ): Promise<CloudConnectorConnectionOutcome> {
    const post = async (
      body: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      const { action, ...args } = body;
      const card =
        action === "create"
          ? await ownerInternal("connect.request", {
              conversationId: turn.conversationId,
              turnId: turn.turnId,
              ...args,
            })
          : await ownerInternal(
              action === "cancel" ? "connect.cancel" : "connect.poll",
              args,
            );
      return { request: card ?? {} };
    };
    const readRequest = (payload: Record<string, unknown>) => {
      const record =
        payload.request && typeof payload.request === "object"
          ? (payload.request as Record<string, unknown>)
          : payload;
      return {
        requestId: typeof record.requestId === "string" ? record.requestId : "",
        state: typeof record.state === "string" ? record.state : "",
        expiresAt: typeof record.expiresAt === "number" ? record.expiresAt : 0,
      };
    };
    let created: ReturnType<typeof readRequest>;
    try {
      created = readRequest(
        await post({
          action: "create",
          integrationId: request.id,
          name: request.name,
          ...(request.description ? { description: request.description } : {}),
          ...(request.iconUrl ? { iconUrl: request.iconUrl } : {}),
          ...(request.category ? { category: request.category } : {}),
          ...(request.reason ? { reason: request.reason } : {}),
        }),
      );
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "unsupported",
      };
    }
    if (!created.requestId) return { ok: false, reason: "unsupported" };
    const deadline = Math.min(
      created.expiresAt || Number.MAX_SAFE_INTEGER,
      Date.now() + CONNECT_CARD_WAIT_MS,
    );
    const cancel = async () => {
      await post({ action: "cancel", requestId: created.requestId }).catch(
        () => undefined,
      );
    };
    while (true) {
      if (signal?.aborted) {
        await cancel();
        return { ok: false, reason: "cancelled" };
      }
      let state: string;
      try {
        state = readRequest(
          await post({ action: "poll", requestId: created.requestId }),
        ).state;
      } catch {
        state = "";
      }
      if (state === "connected") return { ok: true, status: "connected" };
      if (state === "declined") return { ok: false, reason: "declined" };
      if (state === "canceled") return { ok: false, reason: "cancelled" };
      if (state === "expired" || Date.now() >= deadline) {
        await cancel();
        return { ok: false, reason: "timeout" };
      }
      await sleepWithAbort(
        CONNECT_CARD_POLL_MS,
        signal,
        () => new Error("Connect card wait aborted."),
      ).catch(() => undefined);
    }
  }
}
