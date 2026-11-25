// Preloaded into utilityProcess children: Electron's `process.parentPort` over Node IPC.

import { EventEmitter } from "node:events";

const port = new EventEmitter();
process.on("message", (data) => port.emit("message", { data, ports: [] }));
Object.assign(port, {
  postMessage: (message: unknown) => process.send?.(message),
  start: () => {},
  close: () => process.disconnect?.(),
});
(process as unknown as { parentPort: EventEmitter }).parentPort = port;
