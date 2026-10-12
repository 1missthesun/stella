import { releasingStub } from "../../shared/rpc-release.js";

export { released, releasingStub } from "../../shared/rpc-release.js";

export const ownerGateStub = <T extends Rpc.DurableObjectBranded | undefined>(
  namespace: DurableObjectNamespace<T>,
  name: string,
): DurableObjectStub<T> => releasingStub(namespace.getByName(name));
