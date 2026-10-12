export const released = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    (value as { [Symbol.dispose]?: () => void })[Symbol.dispose]?.();
  }
  return value;
};

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  value !== null &&
  (typeof value === "object" || typeof value === "function") &&
  typeof (value as { then?: unknown }).then === "function";

export const releasingStub = <S extends object>(stub: S): S =>
  new Proxy(stub, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop);
      if (typeof value !== "function" || prop === "then") return value;
      const method = value as (...input: unknown[]) => unknown;
      if (prop === "fetch" || prop === "connect") {
        return (...args: unknown[]) => Reflect.apply(method, target, args);
      }
      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(method, target, args);
        return isThenable(result) ? Promise.resolve(result).then(released) : released(result);
      };
    },
  });

export const ownerGateStub = <T extends Rpc.DurableObjectBranded | undefined>(
  namespace: DurableObjectNamespace<T>,
  name: string,
): DurableObjectStub<T> => releasingStub(namespace.getByName(name));
