import { Context, Effect, Layer } from "effect";
import { NOTIFICATION_NAMES } from "@stella/contracts/protocol";
import { performance } from "node:perf_hooks";
import { createDesktopDatabase } from "../../../kernel/storage/database.js";
import { getDesktopDatabasePath } from "../../../kernel/storage/database-init.js";
import { DatabaseMaintenance } from "../../../kernel/storage/maintenance.js";
import { ChatStore } from "../../../kernel/storage/chat-store.js";
import { RuntimeStore } from "../../../kernel/storage/runtime-store.js";
import { projectLocalChatUpdateEvent } from "../../../kernel/storage/session-store.js";
import type {
  LocalChatEventRecord,
  SqliteDatabase,
} from "../../../kernel/storage/shared.js";
import {
  recordBootField,
  recordBootStep,
} from "../../../observability/boot-timing.js";
import * as HostBus from "../host-bus.js";
import * as SessionConfig from "./config.js";

export interface Interface {
  readonly db: SqliteDatabase;
  readonly chatStore: ChatStore;
  readonly runtimeStore: RuntimeStore;
  readonly maintenance: DatabaseMaintenance;
  readonly notifyLocalChatUpdated: (
    conversationId?: string,
    event?: LocalChatEventRecord,
  ) => void;
  readonly appendChatEventAndNotify: (
    args: Parameters<ChatStore["chat"]["appendEvent"]>[0],
  ) => LocalChatEventRecord;
}

export class Service extends Context.Service<Service, Interface>()(
  "@stella/runtime/worker/SessionStorage",
) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const hostBus = yield* HostBus.Service;
    const config = yield* SessionConfig.Service;
    const db = createDesktopDatabase(config.get().stellaDataDirPath, {
      onTiming: (timing) => {
        recordBootStep("dbOpen", timing.openMs);
        recordBootStep("dbMigrate", timing.durationMs);
        recordBootField("dbFromVersion", timing.fromVersion);
        recordBootField("dbToVersion", timing.toVersion);
        recordBootField("dbMigrated", timing.migrated);
      },
    });
    const storesStartedAt = performance.now();
    const chatStore = new ChatStore(db);
    const runtimeStore = chatStore as RuntimeStore;
    recordBootStep("chatStore", performance.now() - storesStartedAt);
    const maintenance = new DatabaseMaintenance({
      db,
      databasePath: getDesktopDatabasePath(config.get().stellaDataDirPath),
    });

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        maintenance.stop();
        db.close();
      }),
    );

    const notifyLocalChatUpdated = (
      conversationId?: string,
      event?: LocalChatEventRecord,
    ) => {
      hostBus.notify(
        NOTIFICATION_NAMES.LOCAL_CHAT_UPDATED,
        event || conversationId
          ? {
              ...(conversationId ? { conversationId } : {}),
              ...(event ? { event: projectLocalChatUpdateEvent(event) } : {}),
            }
          : null,
      );
    };

    const appendChatEventAndNotify: Interface["appendChatEventAndNotify"] = (
      args,
    ) => {
      const event = chatStore.chat.appendEvent(args);
      notifyLocalChatUpdated(args.conversationId, event);
      return event;
    };

    return {
      db,
      chatStore,
      runtimeStore,
      maintenance,
      notifyLocalChatUpdated,
      appendChatEventAndNotify,
    };
  }),
);
