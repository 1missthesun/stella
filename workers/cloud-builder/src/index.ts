import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { worker } from "./build-session/worker-router.js";
import type { Env } from "./build-session/shared/env.js";
import { OrchestratorSession } from "./orchestrator-session.js";
import { OwnerGate } from "./owner-gate.js";
export { OrchestratorSession };
export { OwnerGate };
export { BillingControl } from "./billing/control.js";
export { ComputeBilling } from "./billing/compute-billing.js";
export { WorldStore } from "./world-store.js";
export { AppReleaseChannel } from "./app-source-releases.js";
export { SlackPreviewAssets, SlackPreviewBindings, SlackPreviewData, SlackPreviewOutbound } from "./slack/preview-worker.js";

export class SitesHost extends WorkerEntrypoint<Cloudflare.Env> {
  override async fetch(request: Request): Promise<Response> {
    const { SitesHost: Impl } = await import("./slack/previews.js");
    return await new Impl(this.ctx, this.env).fetch(request);
  }
}

export { Sandbox, SandboxCode, SandboxEgress } from "./sandbox-container.js";

export { DirectoryBackupGateway } from "@cloudflare/sandbox";

export class BuildSession extends DurableObject<Env> {
  private implementation?: Promise<
    import("./build-session/object.js").BuildSessionObject
  >;

  private loadImplementation(): Promise<
    import("./build-session/object.js").BuildSessionObject
  > {
    if (!this.implementation) {
      this.implementation = import("./build-session/object.js")
        .then(
          ({ BuildSessionObject }) =>
            new BuildSessionObject(this.ctx, this.env),
        )
        .catch((error: unknown) => {
          this.implementation = undefined;
          throw error;
        });
    }
    return this.implementation;
  }

  async fetch(request: Request): Promise<Response> {
    return (await this.loadImplementation()).fetch(request);
  }

  async alarm(): Promise<void> {
    await (await this.loadImplementation()).alarm();
  }
}

export default worker;
