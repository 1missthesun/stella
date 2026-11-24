const LOCAL_EXECUTOR_NO_PROXY = "127.0.0.1,localhost,::1";

// Cloudflare may give sandbox sessions an HTTP(S) egress proxy, which every
// client spelling must bypass to reach the loopback-only credential broker.
export const executorSessionEnvironment = (): Record<string, string> => ({
  NO_PROXY: LOCAL_EXECUTOR_NO_PROXY,
  no_proxy: LOCAL_EXECUTOR_NO_PROXY,
});
