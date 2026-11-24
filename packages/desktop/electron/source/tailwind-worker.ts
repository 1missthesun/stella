import { parentPort, workerData } from "node:worker_threads";
import { createTailwindBuild, type TailwindBuild } from "./css.js";
import { loadTailwindTools } from "./tools.js";

const port = parentPort;
if (!port) throw new Error("The Tailwind worker needs a parent port.");
const { root, cacheDir } = workerData as { root: string; cacheDir: string };
const builds = new Map<string, TailwindBuild>();

port.on("message", (message: { id: number; file: string; source: string }) => {
  let build = builds.get(message.file);
  if (!build) {
    build = createTailwindBuild({ loadTools: loadTailwindTools, file: message.file, root, cacheDir });
    builds.set(message.file, build);
  }
  build.build(message.source).then(
    (css) => port.postMessage({ id: message.id, css }),
    (error: unknown) =>
      port.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) }),
  );
});
