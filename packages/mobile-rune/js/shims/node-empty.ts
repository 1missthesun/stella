// A node: module the phone has no use for: every name is a function that throws when called.
const empty: any = new Proxy(function () {}, { get: (_t, k) => (k === "__esModule" ? false : k === "default" ? empty : () => { throw new Error(`node module member ${String(k)} is not available on the phone`); }) });
export default empty;
