import {
  CLOUD_TURN_ATTEMPT_DIRECTORY_FLAG,
  parseCloudTurnAttemptDirectory,
} from "@stella/contracts/cloud-turn-attempt";
import { loadModelRegistry } from "@stella/contracts/model-registry";
import "@stella/runtime/kernel/shared/http-proxy.js";
import { forkAbortTimer } from "@stella/runtime/kernel/tools/effect-runtime.js";
import { Effect } from "effect";
import { readFile, rm, writeFile } from "node:fs/promises";
import { runAgentTurn } from "./agent-turn.js";
import {
  attachedToolClientPaths,
  runAttachedToolClient,
} from "./attached-tool-client.js";
import {
  parseAttachedToolHostInput,
  runAttachedToolHost,
  writeAttachedToolDaemonIdentity,
} from "./attached-tool-host.js";
import { attachedToolPathsForDirectory } from "./attached-tool-protocol.js";
import { markTurnStep, turnTimings } from "./turn-timing.js";

markTurnStep("modulesLoaded");
await loadModelRegistry();
markTurnStep("modelRegistryLoaded");

if (process.argv.includes("--warm")) process.exit(0);

if (process.argv.includes("--attached-tool-host")) {
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(signal, () => {
      console.error(`attached tool host received ${signal}`);
      process.exit(1);
    });
  }
  process.on("uncaughtException", (error) => {
    console.error(
      `attached tool host crashed: ${String(error?.stack ?? error)}`,
    );
    process.exit(1);
  });
  process.on("unhandledRejection", (error) => {
    console.error(
      `attached tool host rejected: ${String((error as { stack?: string })?.stack ?? error)}`,
    );
    process.exit(1);
  });
  const directoryFlag = process.argv.indexOf("--dir");
  const directory =
    directoryFlag >= 0 ? process.argv[directoryFlag + 1] : undefined;
  if (!directory) throw new Error("Attached tool host requires --dir.");
  const paths = attachedToolPathsForDirectory(directory);
  await writeAttachedToolDaemonIdentity(paths);
  const raw = await readFile(paths.hostInput, "utf8");
  await rm(paths.hostInput, { force: true });
  let report: unknown;
  try {
    report = await Effect.runPromise(
      runAttachedToolHost(
        parseAttachedToolHostInput(JSON.parse(raw) as unknown),
        paths,
      ),
    );
  } catch (error) {
    console.error(
      `attached tool host failed: ${String((error as { stack?: string })?.stack ?? error)}`,
    );
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(0);
}
if (process.argv.includes("--attached-tool-client")) {
  await Effect.runPromise(
    runAttachedToolClient(attachedToolClientPaths(process.argv)),
  );
  process.exit(0);
}

if (!process.argv.includes("--agent-turn")) {
  throw new Error("executor-cloud requires a supported command.");
}
const attemptFlag = process.argv.indexOf(CLOUD_TURN_ATTEMPT_DIRECTORY_FLAG);
const attempt = parseCloudTurnAttemptDirectory(
  attemptFlag >= 0 ? process.argv[attemptFlag + 1] : undefined,
);
if (!attempt) {
  throw new Error(
    `Agent turn requires ${CLOUD_TURN_ATTEMPT_DIRECTORY_FLAG} <attempt directory>.`,
  );
}
const result = await Effect.runPromise(runAgentTurn(attempt));
markTurnStep("turnFinished");
const serialized = JSON.stringify({ ...result, timings: turnTimings() });
await writeFile(attempt.result, `${serialized}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
const cancelForcedExit = forkAbortTimer(1_000, () => process.exit(0));
process.stdout.write(`${serialized}\n`, () => {
  cancelForcedExit();
  process.exit(0);
});
