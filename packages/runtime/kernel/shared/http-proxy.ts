// Routes global fetch through the proxy named in the environment. undici's
// EnvHttpProxyAgent reads only these four variables, and without them it is a
// plain Agent, so undici (about 1.1 MB in Electron main) loads only when one is
// set. NO_PROXY alone changes nothing.
const PROXY_ENV_NAMES = ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY"];

if (
  typeof process !== "undefined" &&
  process.versions?.node &&
  PROXY_ENV_NAMES.some((name) => process.env[name]?.trim())
) {
  import("undici").then((m) => {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = m;
    setGlobalDispatcher(new EnvHttpProxyAgent());
  });
}

export {};
