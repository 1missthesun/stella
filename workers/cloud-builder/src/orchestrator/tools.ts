import { AgentHome } from "../agent-home.js";
import { createWorldMemory, ownerMemoryWorld } from "../world-memory.js";
import type { CloudSkillCatalogSnapshot } from "../cloud-home-store.js";
import { WORLD_ROOT, worldName } from "../workspace.js";
import { historySearchOptions, runHistoryQuery, searchHistory } from "../history-sql.js";
import {
  type CloudCodeSourceAgentTool,
  createCloudCodeAgentTool,
} from "../cloud-code-tool.js";
import { createCloudImageGenTool } from "../cloud-image-gen-tool.js";
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
  type CloudConnectorDeclines,
  CloudConnectorDirectory,
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

/** The orchestrator's tool set and connector connection requests. */
export abstract class OrchestratorTools extends OrchestratorPi {
  /**
   * The cloud orchestrator's own tools for pi: the desktop orchestrator's
   * model-visible contract (`orchestrator.md`'s allowlist — code, html,
   * image_gen, web, map, Read — plus the demoted schedule_* and
   * connector_status tools reachable inside code, and the `connect`,
   * `history` and `memory` clients inside code). The agent tools and
   * `switch_destination` are pi's own. The model reads one description and
   * calls one shape on either host; only the execution behind each tool
   * differs, and every cloud-specific difference is stated in the cloud
   * session overlay.
   *
   * Code-pinned on purpose — frontmatter allowlists are agent-writable home
   * data on desktop; in the cloud the execution surface is never data-driven.
   */
  protected async createTools(
    turn: ChatTurnRequest,
    agentHome: AgentHome,
    skillCatalog: CloudSkillCatalogSnapshot,
    memoryEnabled: boolean,
  ): Promise<{
    /** Code and every other tool, demoted ones included. */
    catalog: readonly CloudCodeSourceAgentTool[];
  }> {
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
          }),
        ),
    };
    // Resolved on first use: a turn that never reads a world file never
    // touches the world Durable Object. `drive/` is not in the world: a Read
    // under it reaches the user's drive itself (`world-drive-files.ts`).
    const worldBinding = this.env.WORLDS as typeof this.env.WORLDS | undefined;
    const world = worldBinding
      ? (() => {
          const store = async () =>
            worldBinding.getByName(await worldName(turn.ownerId));
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
            // Read's image branch: the world's own Read is line-oriented and
            // refuses binaries, so pixels come from the files directly.
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
    const declines = this.connectorDeclines();
    // Connectors belong to the account: the same Store integrations the
    // desktop app connected, from the global catalog and the owner object.
    // One directory per turn memoizes the catalog and the owner's live
    // connections for every connect.* call and status check.
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
      declines,
    });

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
        ...(agentHome.available
          ? { skills: { home: agentHome.cloudStore(), snapshot: skillCatalog } }
          : {}),
        ...(world ? { world } : {}),
      }),
      createCloudDriveTool({ ownerInternal: toolContext.ownerInternal }),
      ...createCloudScheduleTools(toolContext),
      createCloudConnectorStatusTool({
        directory: connectors,
        declines,
        requestConnection: (request, signal) =>
          this.requestCloudConnectorConnection(
            turn,
            toolContext.ownerInternal,
            request,
            signal,
          ),
      }),
    ];
    // The orchestrator's memory files are world files; with memory off it has
    // no `memory` client at all. Each write holds to the memory epoch it
    // started in, so one running when a wipe begins cannot undo it.
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
      ...(memoryEnabled
        ? {
            history: {
              search: async (text: string, options: unknown) => {
                await this.archive.reindexArchivedSearch();
                return searchHistory(this.ctx.storage, text, historySearchOptions(options));
              },
              sql: (query: string, params: readonly SqlStorageValue[]) =>
                runHistoryQuery(this.ctx.storage, query, params),
              read: (fromSeq: number, toSeq: number) =>
                this.archive.readRange(
                  Math.max(0, fromSeq),
                  toSeq,
                  BACKFILL_BATCH_RECORDS,
                ),
            },
          }
        : {}),
    });
    return { catalog: [codeTool, ...tools] };
  }

  /**
   * The user's memory of connect offers they declined, so the card is never
   * re-shown for that connector in this conversation.
   */
  protected connectorDeclines(): CloudConnectorDeclines {
    const key = (id: string) => `connector_decline:${id}`;
    return {
      isDeclined: async (id) =>
        (await this.ctx.storage.get<boolean>(key(id))) === true,
      recordDecline: async (id) => {
        await this.ctx.storage.put(key(id), true);
      },
    };
  }

  /**
   * Show the inline connect card and wait for the answer. The card is a
   * pending request row in the owner object that every signed-in client
   * watches (`connect.pending`); the user's answer
   * either finishes the account-level Composio connection or declines.
   * Polling is the wait: the turn holds the tool call open while the row
   * moves through pending → connecting → connected/declined/expired.
   */
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
      // An abort just ends the wait; the loop's next check cancels the card.
      await sleepWithAbort(
        CONNECT_CARD_POLL_MS,
        signal,
        () => new Error("Connect card wait aborted."),
      ).catch(() => undefined);
    }
  }
}
