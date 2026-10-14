import type {
  BillingControlRpc,
  GatewayConfigSnapshot,
} from "@stella/contracts/gateway/usage";
import { releasingStub } from "../../shared/rpc-release.js";

export const billingControl = (env: Pick<Env, "BILLING">): BillingControlRpc =>
  releasingStub(env.BILLING as unknown as BillingControlRpc);

export type GatewayConfigLoader = () => Promise<GatewayConfigSnapshot>;

export const billingGatewayConfig =
  (env: Pick<Env, "BILLING">): GatewayConfigLoader =>
  () =>
    billingControl(env).gatewayConfig();
