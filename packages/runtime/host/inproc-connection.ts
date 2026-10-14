import { EventEmitter } from "node:events";
import type { JsonRpcMessage } from "@stella/contracts/protocol";
import {
  createRuntimeUnavailableError,
  JsonRpcPeer,
} from "@stella/contracts/protocol/rpc-peer";
import type { WorkerConnection, WorkerProcess } from "./worker-lifecycle.js";

export const createInprocPeerPair = (
  options: { onError?: (error: unknown) => void } = {},
): { left: JsonRpcPeer; right: JsonRpcPeer; close: () => void } => {
  let left: JsonRpcPeer | null = null;
  let right: JsonRpcPeer | null = null;
  const deliverTo =
    (target: () => JsonRpcPeer | null) => (message: JsonRpcMessage) => {
      const copy = JSON.parse(JSON.stringify(message)) as JsonRpcMessage;
      queueMicrotask(() => {
        const peer = target();
        if (peer && !peer.isClosed()) void peer.handleMessage(copy);
      });
    };
  left = new JsonRpcPeer(deliverTo(() => right), options);
  right = new JsonRpcPeer(deliverTo(() => left), options);
  const close = () => {
    const reason = createRuntimeUnavailableError(
      "Runtime RPC transport is closed.",
    );
    left?.dispose(reason);
    right?.dispose(reason);
  };
  return { left, right, close };
};

export type InprocWorkerAttach = (peer: JsonRpcPeer) => () => void;

class InprocWorkerProcess extends EventEmitter implements WorkerProcess {
  exitCode: number | null = null;
  readonly signalCode = null;
  readonly stdin = { end: () => this.exit() };

  constructor(private readonly disconnect: () => void) {
    super();
  }

  kill(): boolean {
    this.exit();
    return true;
  }

  private exit(): void {
    if (this.exitCode != null) return;
    this.exitCode = 0;
    this.disconnect();
    this.emit("exit", 0, null);
  }
}

export const buildInprocConnectionFactory = (
  attachWorker: InprocWorkerAttach,
  options: { onError?: (error: unknown) => void } = {},
) => {
  return async (_workerEntryPath: string): Promise<WorkerConnection> => {
    const pair = createInprocPeerPair(options);
    const detach = attachWorker(pair.right);
    return {
      process: new InprocWorkerProcess(() => {
        detach();
        pair.close();
      }),
      peer: pair.left,
      pid: process.pid,
      attachedToExistingWorker: false,
    };
  };
};
