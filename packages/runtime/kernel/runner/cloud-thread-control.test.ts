import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import {
  createStateContext,
  handleSendMessage,
  handleSpawnAgent,
} from "../tools/state.js";
import type { AgentToolApi, ToolContext } from "../tools/types.js";
import { initializeDesktopDatabase } from "../storage/database-init.js";
import { SessionStore } from "../storage/session-store.js";
import type { SqliteDatabase } from "../storage/shared.js";
import { createCloudThreadController as createDispatcherRaw } from "./cloud-spawn-dispatch.js";
/**
 * These cases were written against call-ref fakes (`mutation(ref, args)`
 * and `action(ref, args)` with string refs). This maps them onto the backend
 * calls the dispatcher now takes, one for one, so the refs still name what
 * was sent.
 */
type DispatcherOptions = Parameters<typeof createDispatcherRaw>[0];
type LegacyDispatcherOptions = Omit<DispatcherOptions, "backend"> & {
  backendRefs: { cloud_apps: Record<string, unknown> };
  mutation: (ref: unknown, args: unknown) => Promise<unknown>;
  action: (ref: unknown, args: unknown) => Promise<unknown>;
  query?: (ref: unknown, args: unknown) => Promise<unknown>;
};

const adaptLegacyDispatcherOptions = (
  options: LegacyDispatcherOptions,
): DispatcherOptions => {
  const { backendRefs, mutation, action, query: _query, ...rest } = options;
  const refs = backendRefs.cloud_apps;
  return {
    ...rest,
    backend: {
      spawn: async (args) => await mutation(refs.spawnCloudAgentFromDesktop, args),
      continue: async (args) =>
        await mutation(refs.continueMyCloudAgentFromDesktop, args),
      cancel: async (args) => await action(refs.cancelMyCloudAgentThread, args),
    },
  };
};

const createCloudThreadController = (options: LegacyDispatcherOptions) =>
  createDispatcherRaw(adaptLegacyDispatcherOptions(options));


const OWNER_GENERATION = "owner-generation-1";

const createStore = (database = new Database(":memory:")) => {
  initializeDesktopDatabase(database as unknown as SqliteDatabase);
  return {
    database,
    store: new SessionStore(database as unknown as SqliteDatabase),
  };
};

const toolContext = {
  agentType: AGENT_IDS.ORCHESTRATOR,
  conversationId: "local-conversation",
  requestId: "request-1",
  storageMode: "local",
} as ToolContext;

const agentApi = (overrides: Partial<AgentToolApi>): AgentToolApi =>
  ({
    createAgent: async () => {
      throw new Error("not used");
    },
    getAgent: async () => null,
    cancelAgent: async () => ({ canceled: false }),
    sendAgentMessage: async () => ({ delivered: false }),
    ...overrides,
  }) as AgentToolApi;

describe("desktop cloud thread controls", () => {
  test("send_message falls through to an owned cloud continuation", async () => {
    const requests: unknown[] = [];
    const state = createStateContext(
      "/tmp/stella-cloud-control-test",
      agentApi({
        cloudContinue: async (request) => {
          requests.push(request);
          return {
            delivered: true,
            control: {
              threadId: "thr-cloud",
              ownerGeneration: OWNER_GENERATION,
              attemptGeneration: 4,
              threadUpdatedAt: 400,
              status: "running",
            },
          };
        },
      }),
    );

    const result = await handleSendMessage(
      state,
      {
        thread_id: "thr-cloud",
        message: "Add the appendix.",
      },
      { ...toolContext, ownerGeneration: OWNER_GENERATION },
    );

    // `send_message` takes no description, but the cloud continuation
    // mutation still requires a non-empty one, so the label comes from the
    // follow-up itself rather than re-titling the thread from the caller.
    expect(requests).toEqual([
      {
        threadId: "thr-cloud",
        description: "Add the appendix.",
        message: "Add the appendix.",
        conversationId: "local-conversation",
        requestId: "request-1",
        ownerGeneration: OWNER_GENERATION,
      },
    ]);
    expect(result).toMatchObject({
      result: {
        status: "delivered",
        thread_id: "thr-cloud",
        delivered: "resumed",
      },
    });
  });

  test("controller binds continuation delivery to the current device and conversation", async () => {
    const mutations: Array<{ ref: unknown; args: unknown }> = [];
    const actions: Array<{ ref: unknown; args: unknown }> = [];
    const { store } = createStore();
    store.putCloudAgentThreadControl({
      threadId: "thr-cloud",
      ownerGeneration: OWNER_GENERATION,
      cloudConversationId: "cloud-conversation",
      originConversationId: "local-conversation",
      attemptGeneration: 3,
      threadUpdatedAt: 300,
      status: "completed",
    });
    const controller = createCloudThreadController({
      backendRefs: {
        cloud_apps: {
          continueMyCloudAgentFromDesktop: "continue-ref",
          cancelMyCloudAgentThread: "cancel-ref",
        },
      },
      deviceId: "device-1",
      mutation: async (ref, args) => {
        mutations.push({ ref, args });
        return {
          threadId: "thr-cloud",
          conversationId: "cloud-conversation",
          attemptGeneration: 4,
          threadUpdatedAt: 400,
          status: "running",
        };
      },
      action: async (ref, args) => {
        actions.push({ ref, args });
        return {
          canceled: true,
          status: "canceled",
          threadId: "thr-cloud",
          attemptGeneration: 4,
          threadUpdatedAt: 450,
          currentControl: {
            threadId: "thr-cloud",
            attemptGeneration: 4,
            threadUpdatedAt: 450,
            status: "canceled",
          },
        };
      },
      query: async () => [],
      getOwnerGeneration: async () => OWNER_GENERATION,
      store,
      isSignedIn: () => true,
    });

    expect(
      await controller.continueThread({
        threadId: "thr-cloud",
        description: "Continue report",
        message: "Add the appendix.",
        conversationId: "local-conversation",
        requestId: "request-1",
      }),
    ).toEqual({
      delivered: true,
      steered: false,
      control: {
        threadId: "thr-cloud",
        ownerGeneration: OWNER_GENERATION,
        attemptGeneration: 4,
        threadUpdatedAt: 400,
        status: "running",
      },
    });
    expect(mutations).toEqual([
      {
        ref: "continue-ref",
        args: {
          ownerGeneration: OWNER_GENERATION,
          threadId: "thr-cloud",
          expectedAttemptGeneration: 3,
          expectedTerminalUpdatedAt: 300,
          description: "Continue report",
          prompt: "Add the appendix.",
          originDeviceId: "device-1",
          originConversationId: "local-conversation",
          controlRequestId: "request-1",
        },
      },
    ]);
  });

  test("fails closed before network when no exact thread receipt exists", async () => {
    const { store } = createStore();
    let mutations = 0;
    let actions = 0;
    const controller = createCloudThreadController({
      backendRefs: {
        cloud_apps: {
          continueMyCloudAgentFromDesktop: "continue-ref",
          cancelMyCloudAgentThread: "cancel-ref",
        },
      },
      deviceId: "device-1",
      mutation: async () => {
        mutations += 1;
        return {};
      },
      action: async () => {
        actions += 1;
        return {};
      },
      getOwnerGeneration: async () => OWNER_GENERATION,
      store,
      isSignedIn: () => true,
    });

    expect(
      await controller.continueThread({
        threadId: "missing-thread",
        description: "Continue",
        message: "Continue safely.",
        conversationId: "local-conversation",
        requestId: "missing-continue",
      }),
    ).toMatchObject({
      delivered: false,
      reason: expect.stringContaining("No durable cloud control receipt"),
    });
    expect({ mutations, actions }).toEqual({ mutations: 0, actions: 0 });
  });

  test("restarts a lost continuation response with the immutable generation and terminal receipt", async () => {
    const root = mkdtempSync(join(tmpdir(), "stella-cloud-control-"));
    const databasePath = join(root, "control.sqlite");
    const calls: unknown[] = [];
    let firstDatabase: Database | null = null;
    let restartedDatabase: Database | null = null;
    try {
      firstDatabase = new Database(databasePath);
      const first = createStore(firstDatabase);
      first.store.putCloudAgentThreadControl({
        threadId: "thr-restart",
        ownerGeneration: OWNER_GENERATION,
        cloudConversationId: "cloud-conversation",
        originConversationId: "local-conversation",
        attemptGeneration: 7,
        threadUpdatedAt: 700,
        status: "failed",
      });
      const firstController = createCloudThreadController({
        backendRefs: {
          cloud_apps: {
            continueMyCloudAgentFromDesktop: "continue-ref",
            cancelMyCloudAgentThread: "cancel-ref",
          },
        },
        deviceId: "device-1",
        mutation: async (_ref, args) => {
          calls.push(args);
          throw new Error("response lost after commit");
        },
        action: async () => ({}),
        getOwnerGeneration: async () => OWNER_GENERATION,
        store: first.store,
        isSignedIn: () => true,
      });
      expect(
        await firstController.continueThread({
          threadId: "thr-restart",
          description: "Continue report",
          message: "Add the appendix.",
          conversationId: "local-conversation",
          requestId: "continue-restart-1",
        }),
      ).toMatchObject({ delivered: false });
      firstDatabase.close();
      firstDatabase = null;

      restartedDatabase = new Database(databasePath);
      const restarted = createStore(restartedDatabase);
      let currentGeneration = "owner-generation-2";
      const restartedController = createCloudThreadController({
        backendRefs: {
          cloud_apps: {
            continueMyCloudAgentFromDesktop: "continue-ref",
            cancelMyCloudAgentThread: "cancel-ref",
          },
        },
        deviceId: "device-1",
        mutation: async (_ref, args) => {
          calls.push(args);
          return {
            threadId: "thr-restart",
            conversationId: "cloud-conversation",
            attemptGeneration: 8,
            threadUpdatedAt: 800,
            status: "running",
          };
        },
        action: async () => ({}),
        getOwnerGeneration: async () => currentGeneration,
        store: restarted.store,
        isSignedIn: () => true,
      });
      const continued = await restartedController.continueThread({
        threadId: "thr-restart",
        description: "Continue report",
        message: "Add the appendix.",
        conversationId: "local-conversation",
        requestId: "continue-restart-1",
      });
      expect(continued).toMatchObject({
        delivered: true,
        control: {
          ownerGeneration: OWNER_GENERATION,
          attemptGeneration: 8,
          threadUpdatedAt: 800,
          status: "running",
        },
      });
      expect(calls).toHaveLength(2);
      expect(calls[1]).toEqual(calls[0]);
      expect(calls[1]).toMatchObject({
        ownerGeneration: OWNER_GENERATION,
        expectedAttemptGeneration: 7,
        expectedTerminalUpdatedAt: 700,
      });

      const replayController = createCloudThreadController({
        backendRefs: {
          cloud_apps: {
            continueMyCloudAgentFromDesktop: "continue-ref",
            cancelMyCloudAgentThread: "cancel-ref",
          },
        },
        deviceId: "device-1",
        mutation: async () => {
          throw new Error("stored outcome must replay without network");
        },
        action: async () => ({}),
        getOwnerGeneration: async () => {
          throw new Error("stored outcome must not refresh owner generation");
        },
        store: restarted.store,
        isSignedIn: () => false,
      });
      expect(
        await replayController.continueThread({
          threadId: "thr-restart",
          description: "Continue report",
          message: "Add the appendix.",
          conversationId: "local-conversation",
          requestId: "continue-restart-1",
        }),
      ).toEqual(continued);
      restartedDatabase.close();
      restartedDatabase = null;
    } finally {
      try {
        firstDatabase?.close();
      } catch {
        // Best-effort test teardown.
      }
      try {
        restartedDatabase?.close();
      } catch {
        // Best-effort test teardown.
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("terminal control wins an equal-clock race and cannot be resurrected", () => {
    const { store } = createStore();
    const base = {
      threadId: "thr-clock",
      ownerGeneration: OWNER_GENERATION,
      cloudConversationId: "cloud-conversation",
      originConversationId: "local-conversation",
      attemptGeneration: 2,
      threadUpdatedAt: 200,
    } as const;
    store.putCloudAgentThreadControl({ ...base, status: "running" });
    store.putCloudAgentThreadControl({ ...base, status: "completed" });
    store.putCloudAgentThreadControl({
      ...base,
      threadUpdatedAt: 250,
      status: "running",
    });
    expect(
      store.getCloudAgentThreadControl("thr-clock", OWNER_GENERATION),
    ).toMatchObject({
      attemptGeneration: 2,
      threadUpdatedAt: 200,
      status: "completed",
    });

    store.putCloudAgentThreadControl({
      ...base,
      attemptGeneration: 3,
      threadUpdatedAt: 150,
      status: "running",
    });
    expect(
      store.getCloudAgentThreadControl("thr-clock", OWNER_GENERATION),
    ).toMatchObject({
      attemptGeneration: 3,
      threadUpdatedAt: 150,
      status: "running",
    });
  });

  test("replays the exact continuation outcome when terminal state races ahead", async () => {
    const { store } = createStore();
    store.putCloudAgentThreadControl({
      threadId: "thr-fast-terminal",
      ownerGeneration: OWNER_GENERATION,
      cloudConversationId: "cloud-conversation",
      originConversationId: "local-conversation",
      attemptGeneration: 2,
      threadUpdatedAt: 200,
      status: "completed",
    });
    let mutations = 0;
    const controller = createCloudThreadController({
      backendRefs: {
        cloud_apps: {
          continueMyCloudAgentFromDesktop: "continue-ref",
          cancelMyCloudAgentThread: "cancel-ref",
        },
      },
      deviceId: "device-1",
      mutation: async () => {
        mutations += 1;
        store.putCloudAgentThreadControl({
          threadId: "thr-fast-terminal",
          ownerGeneration: OWNER_GENERATION,
          cloudConversationId: "cloud-conversation",
          originConversationId: "local-conversation",
          attemptGeneration: 3,
          threadUpdatedAt: 301,
          status: "completed",
        });
        return {
          threadId: "thr-fast-terminal",
          conversationId: "cloud-conversation",
          attemptGeneration: 3,
          threadUpdatedAt: 300,
          status: "running",
        };
      },
      action: async () => ({}),
      getOwnerGeneration: async () => OWNER_GENERATION,
      store,
      isSignedIn: () => true,
    });
    const request = {
      threadId: "thr-fast-terminal",
      description: "Continue",
      message: "One more check.",
      conversationId: "local-conversation",
      requestId: "fast-terminal-continue-1",
    };
    const first = await controller.continueThread(request);
    expect(first).toMatchObject({
      delivered: true,
      control: {
        attemptGeneration: 3,
        threadUpdatedAt: 300,
        status: "running",
      },
    });
    expect(
      store.getCloudAgentThreadControl(
        "thr-fast-terminal",
        OWNER_GENERATION,
      ),
    ).toMatchObject({
      attemptGeneration: 3,
      threadUpdatedAt: 301,
      status: "completed",
    });
    expect(await controller.continueThread(request)).toEqual(first);
    expect(mutations).toBe(1);
  });

  test("a follow-up keeps the name the thread was spawned with", async () => {
    const continued: Array<Record<string, unknown>> = [];
    const { store } = createStore();
    const base = {
      threadId: "thr-named",
      ownerGeneration: OWNER_GENERATION,
      cloudConversationId: "cloud-conversation",
      originConversationId: "local-conversation",
    };
    store.putCloudAgentThreadControl({
      ...base,
      attemptGeneration: 1,
      threadUpdatedAt: 100,
      status: "running",
      description: "Disk cleanup",
    });
    store.putCloudAgentThreadControl({
      ...base,
      attemptGeneration: 1,
      threadUpdatedAt: 200,
      status: "completed",
      description: "Ignored later name",
    });
    expect(
      store.getCloudAgentThreadControl("thr-named", OWNER_GENERATION)?.description,
    ).toBe("Disk cleanup");
    const controller = createCloudThreadController({
      backendRefs: { cloud_apps: { continueMyCloudAgentFromDesktop: "continue-ref" } },
      deviceId: "device-1",
      mutation: async (_ref, args) => {
        continued.push(args as Record<string, unknown>);
        return {
          threadId: "thr-named",
          conversationId: "cloud-conversation",
          attemptGeneration: 2,
          threadUpdatedAt: 300,
          status: "running",
        };
      },
      action: async () => {
        throw new Error("not used");
      },
      getOwnerGeneration: async () => OWNER_GENERATION,
      store,
      isSignedIn: () => true,
    });
    await controller.continueThread({
      threadId: "thr-named",
      description: "Also check Downloads",
      message: "Also check Downloads.",
      conversationId: "local-conversation",
      requestId: "request-named",
    });
    expect(continued.map((args) => args.description)).toEqual(["Disk cleanup"]);
  });
});
