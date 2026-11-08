import { DurableObject } from "cloudflare:workers";
import type { CloudTurnStartRequest } from "@stella/contracts/turn-plane/turn-start";
import type {
  AdmittedCloudChat,
  CloudChatPreparation,
} from "./cloud-chat-admission.js";
import type {
  CloudAgentAttemptProbe,
  CloudAgentAttemptState,
  PiHarnessAgentControl,
  PiHarnessAgentControlResult,
  PiThreadStop,
  PiThreadStopResult,
  PiThreadStart,
  PiThreadSteer,
  PiThreadSteerResult,
} from "./cloud-agent-dispatch.js";
import type { OwnerModelGrantFreezeRequest } from "./owner-model-grants.js";
import type { SessionRevocations } from "./session-revocation.js";
import type { Env } from "./build-session/shared/env.js";

export class OrchestratorSession extends DurableObject<Env> {
  private implementation?: Promise<
    import("./orchestrator-session-object.js").OrchestratorSessionObject
  >;

  private loadImplementation(): Promise<
    import("./orchestrator-session-object.js").OrchestratorSessionObject
  > {
    if (!this.implementation) {
      this.implementation = import("./orchestrator-session-object.js")
        .then(async ({ OrchestratorSessionObject }) => {
          const implementation = new OrchestratorSessionObject(
            this.ctx,
            this.env,
          );
          await implementation.ready();
          return implementation;
        })
        .catch((error: unknown) => {
          this.implementation = undefined;
          throw error;
        });
    }
    return this.implementation;
  }

  async fetch(request: Request): Promise<Response> {
    return await (await this.loadImplementation()).fetch(request);
  }

  async alarm(): Promise<void> {
    await (await this.loadImplementation()).alarm();
  }

  async prepareCloudChatReader(): Promise<string> {
    return await (await this.loadImplementation()).prepareCloudChatReader();
  }

  async startAdmittedChat(
    start: CloudTurnStartRequest,
    authority: AdmittedCloudChat,
    preparation: CloudChatPreparation,
  ): Promise<Response> {
    return await (
      await this.loadImplementation()
    ).startAdmittedChat(start, authority, preparation);
  }

  async freezeOwnerModelGrants(
    args: OwnerModelGrantFreezeRequest,
  ): Promise<{ frozen: true }> {
    return await (await this.loadImplementation()).freezeOwnerModelGrants(args);
  }

  async closeRevokedSockets(revocations: SessionRevocations): Promise<{ closed: number; open: number }> {
    return (await this.loadImplementation()).closeRevokedSockets(revocations);
  }

  async startPiThread(input: PiThreadStart): Promise<void> {
    await (await this.loadImplementation()).startPiThread(input);
  }

  async steerPiThread(input: PiThreadSteer): Promise<PiThreadSteerResult> {
    return await (await this.loadImplementation()).steerPiThread(input);
  }

  async stopPiThread(input: PiThreadStop): Promise<PiThreadStopResult> {
    return await (await this.loadImplementation()).stopPiThread(input);
  }

  async piThreadAttemptState(input: CloudAgentAttemptProbe): Promise<CloudAgentAttemptState> {
    return await (await this.loadImplementation()).piThreadAttemptState(input);
  }

  async harnessAgentAttemptState(input: CloudAgentAttemptProbe): Promise<CloudAgentAttemptState> {
    return await (await this.loadImplementation()).harnessAgentAttemptState(input);
  }

  async controlPiHarnessAgent(
    input: PiHarnessAgentControl,
  ): Promise<PiHarnessAgentControlResult> {
    return await (await this.loadImplementation()).controlPiHarnessAgent(input);
  }

  async queryHistory(ownerId: string, request: unknown): Promise<unknown> {
    return await (await this.loadImplementation()).queryHistory(ownerId, request);
  }

  async catchUpSource(ownerId: string): Promise<import("@stella/contracts/catch-up").CatchUpSource> {
    return await (await this.loadImplementation()).catchUpSource(ownerId);
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    await (await this.loadImplementation()).webSocketMessage(ws, message);
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): Promise<void> {
    await (
      await this.loadImplementation()
    ).webSocketClose(ws, code, reason, wasClean);
  }

  async restartForVerification(): Promise<{ restartScheduled: true }> {
    this.ctx.waitUntil(
      scheduler.wait(50).then(() => {
        this.ctx.abort("dev verification restart");
      }),
    );
    return { restartScheduled: true };
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    await (await this.loadImplementation()).webSocketError(ws, error);
  }
}
