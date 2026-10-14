export type Env = Cloudflare.Env & {
  SANDBOX_PREWARM_IDLE_TIMEOUT_MS?: string;
  ORCHESTRATOR_IDLE_TIMEOUT_MS?: string;
};
