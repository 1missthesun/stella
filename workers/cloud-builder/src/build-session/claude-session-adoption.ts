/**
 * A computer's synced Claude Code session, written into the container for
 * the conversation's orchestrator thread when the cloud resumes it
 * (`CloudOrchestratorCliTurnSpec.adoptSession`): the cloud took the brain
 * over from that computer, or it moved here, and the cloud's own session is
 * behind the log.
 *
 * The files land in the thread's emptied native state root, under
 * `CLOUD_ADOPTED_SESSION_DIR`; the executor moves them under the CLI's
 * working folder (only it resolves that folder) and resumes the session by
 * its own id. Each part is checked against the hash chain the computer
 * uploaded it under. Anything amiss returns undefined, and the turn rebuilds
 * from the log as it would have.
 */
import {
  claudeSessionChainInput,
  CLAUDE_SESSION_CHAIN_GENESIS,
  isClaudeSessionFilePath,
  type ClaudeSessionCalls,
  type ClaudeSessionManifest,
} from "@stella/contracts/backend/claude-sessions";
import type { RpcResponse } from "@stella/contracts/backend/protocol";
import type { CloudOrchestratorCliAdoptedSession } from "@stella/contracts/cloud-orchestrator-cli";
import { CLOUD_ADOPTED_SESSION_DIR } from "@stella/contracts/cloud-native-state";
import type { ExecutionSession } from "../sandbox-client.js";
import { sha256Hex } from "../hash.js";
import { log } from "./shared/keys.js";

/** The most of a session the container takes; a larger one rebuilds. */
const MAX_ADOPTED_BYTES = 64 * 1024 * 1024;

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

export const writeAdoptedClaudeSession = async (args: {
  gates: Pick<Cloudflare.Env, "OWNER_GATES">["OWNER_GATES"];
  ownerId: string;
  ownerGeneration: string;
  session: ExecutionSession;
  stateRoot: string;
  adopt: CloudOrchestratorCliAdoptedSession;
}): Promise<{ sessionId: string; cliVersion: string } | undefined> => {
  const call = async (name: string, callArgs: unknown): Promise<unknown> => {
    const response = (await args.gates.getByName(args.ownerId).ownerInternal({
      name,
      args: callArgs,
      ownerGeneration: args.ownerGeneration,
    })) as RpcResponse;
    if (!response.ok) throw new Error(response.error.message);
    return response.value;
  };
  const refuse = (reason: string) => {
    log("info", "claude_session_adoption_skipped", { threadId: args.adopt.threadId, reason });
    return undefined;
  };
  const manifest = (await call("claudeSessions.latestForRestore", {
    threadId: args.adopt.threadId,
  })) as ClaudeSessionManifest | null;
  if (!manifest || manifest.sessionId !== args.adopt.sessionId) return refuse("session_changed");
  const { sessionId } = manifest;
  const files = manifest.files.filter((file) => isClaudeSessionFilePath(sessionId, file.path));
  if (!files.some((file) => file.path === `${sessionId}.jsonl`)) return refuse("no_transcript");
  if (files.reduce((sum, file) => sum + file.length, 0) > MAX_ADOPTED_BYTES) return refuse("too_large");
  for (const file of files) {
    let next = 0;
    let chain = CLAUDE_SESSION_CHAIN_GENESIS;
    const body = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        const chunk = file.chunks[next];
        if (!chunk) {
          if (chain !== file.chain) controller.error(new Error(`${file.path} is incomplete in the cloud.`));
          else controller.close();
          return;
        }
        next += 1;
        try {
          const read = (await call("claudeSessions.readChunkForRestore", {
            threadId: manifest.threadId,
            sessionId,
            path: file.path,
            generation: file.generation,
            index: chunk.index,
          })) as ClaudeSessionCalls["claudeSessions.readChunk"]["result"];
          chain = await sha256Hex(claudeSessionChainInput(chain, read.sha256));
          if (read.sha256 !== chunk.sha256 || chain !== chunk.chain) {
            throw new Error(`${file.path} broke its hash chain.`);
          }
          controller.enqueue(fromBase64(read.data));
        } catch (error) {
          controller.error(error);
        }
      },
    });
    await args.session.writeFile(`${args.stateRoot}/${CLOUD_ADOPTED_SESSION_DIR}/${file.path}`, body);
  }
  log("info", "claude_session_adopted", {
    threadId: manifest.threadId,
    sessionId,
    deviceId: manifest.deviceId,
    files: files.length,
  });
  return { sessionId, cliVersion: manifest.cliVersion };
};
