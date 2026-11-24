import { NOTIFICATION_NAMES } from "@stella/contracts/protocol";
import { performance } from "node:perf_hooks";
import { createDesktopDatabase } from "../../../kernel/storage/database.js";
import { getDesktopDatabasePath } from "@stella/node-shared/storage/database-init.js";
import { DatabaseMaintenance } from "../../../kernel/storage/maintenance.js";
import { ChatStore } from "../../../kernel/storage/chat-store.js";
import { RuntimeStore } from "../../../kernel/storage/runtime-store.js";
import { projectLocalChatUpdateEvent } from "@stella/node-shared/storage/session-store.js";
import type {
  LocalChatEventRecord,
  SqliteDatabase,
} from "@stella/node-shared/storage/shared.js";
import {
  recordBootField,
  recordBootStep,
} from "../../../observability/boot-timing.js";
import type * as HostBus from "../host-bus.js";
import type * as SessionConfig from "./config.js";

export type SessionFinalizer = (succeeded: boolean) => Promise<void> | void;

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

export const make = (args: {
  hostBus: HostBus.Interface;
  config: SessionConfig.Interface;
  addFinalizer: (finalizer: SessionFinalizer) => void;
}): Interface => {
  const { hostBus, config, addFinalizer } = args;
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

  addFinalizer(() => {
    maintenance.stop();
    db.close();
  });

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
    eventArgs,
  ) => {
    const event = chatStore.chat.appendEvent(eventArgs);
    notifyLocalChatUpdated(eventArgs.conversationId, event);
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
};
