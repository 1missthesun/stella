declare const __STELLA_SANDBOX_CODE__:
  | Readonly<{ sha256: string; bytes: number }>
  | undefined;

export type SandboxCodeBundle = Readonly<{ sha256: string; bytes: number }>;

export const SANDBOX_CODE_HOST = "code.stella.internal";

export const sandboxCodeAssetPath = (sha256: string): string =>
  `/sandbox-code/${sha256}.tar.gz`;

export const SANDBOX_CODE_INSTALL = "/opt/stella/bin/stella-code-install";
export const SANDBOX_EXECUTOR = "/opt/stella/bin/stella-executor";

export const SANDBOX_PAGE_CACHE_WARM_COMMAND = `setsid ${SANDBOX_EXECUTOR} --warm </dev/null >/dev/null 2>&1 &`;

const SHA256 = /^[0-9a-f]{64}$/u;

export const sandboxCode = (): SandboxCodeBundle => {
  const bundle =
    typeof __STELLA_SANDBOX_CODE__ === "undefined"
      ? undefined
      : __STELLA_SANDBOX_CODE__;
  if (!bundle || !SHA256.test(bundle.sha256)) {
    throw new Error(
      "This Worker was built without a sandbox code bundle (scripts/build-worker.mjs).",
    );
  }
  return bundle;
};

export const sandboxCodeUrl = (sha256: string): string =>
  `http://${SANDBOX_CODE_HOST}/${sha256}.tar.gz`;

export type SandboxCodeInstall = Readonly<{
  sha256: string;
  source: "fetched" | "cached";
  bytes: number;
  fetchMs: number;
  installMs: number;
}>;

export const parseSandboxCodeInstall = (
  stdout: string,
  sha256: string,
): SandboxCodeInstall | null => {
  const line = stdout.trim().split("\n").at(-1);
  if (!line) return null;
  try {
    const value = JSON.parse(line) as Partial<SandboxCodeInstall>;
    if (
      value.sha256 !== sha256 ||
      (value.source !== "fetched" && value.source !== "cached") ||
      typeof value.bytes !== "number" ||
      typeof value.fetchMs !== "number" ||
      typeof value.installMs !== "number"
    ) {
      return null;
    }
    return value as SandboxCodeInstall;
  } catch {
    return null;
  }
};
