import crypto, { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import {
  deviceSignerForIdentity,
  type DeviceIdentity,
} from "../kernel/home/device.js";
import {
  getLocalLlmCredential,
  listLocalLlmCredentials,
} from "../kernel/storage/llm-credentials.js";
import {
  getLocalLlmOAuthApiKey,
  listLocalLlmOAuthCredentials,
} from "../kernel/storage/llm-oauth-credentials.js";
import {
  resolveRuntimeStatePath,
  resolveStellaAppDir,
} from "../kernel/home/stella-paths.js";

export type HeadlessAuthInput = {
  authToken?: string | null;
};

export type HeadlessHostPaths = {
  stellaAppDir: string;
  stellaDataDirPath: string;
  stellaWorkspacePath: string;
};

export const resolveHeadlessHostPaths = (options?: {
  stellaAppDir?: string;
  stellaDataDirPath?: string;
}): HeadlessHostPaths => {
  const stellaAppDir = resolveStellaAppDir(undefined, options?.stellaAppDir);
  const stellaDataDirPath = resolveRuntimeStatePath(
    undefined,
    stellaAppDir,
    options?.stellaDataDirPath,
  );
  return {
    stellaAppDir,
    stellaDataDirPath,
    stellaWorkspacePath: path.join(stellaDataDirPath, "workspace"),
  };
};

const createEphemeralDeviceIdentity = (): DeviceIdentity => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    deviceId: `headless-${crypto.randomUUID()}`,
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privateKey: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64"),
  };
};

export const createHeadlessHostHandlers = (
  paths: HeadlessHostPaths,
  auth: HeadlessAuthInput = {},
) => {
  const identity = createEphemeralDeviceIdentity();
  const signer = deviceSignerForIdentity(identity);
  const publicIdentity = () => ({
    deviceId: identity.deviceId,
    publicKey: identity.publicKey,
  });
  return {
    getDeviceIdentity: async () => publicIdentity(),
    signDeviceInput: async (input: string) => ({
      alg: signer.alg,
      rawPublicKey: Array.from(signer.rawPublicKey),
      signature: await signer.sign(input),
    }),
    requestRuntimeAuthRefresh: async () => {
      const token = auth.authToken?.trim() || null;
      return token
        ? { authenticated: true as const, token, hasConnectedAccount: false }
        : {
            authenticated: false as const,
            token: null,
            hasConnectedAccount: false,
            reason: "signed_out" as const,
          };
    },
    requestLlmCredentials: async (request: {
      operation: string;
      kind?: "api-key" | "oauth-api-key";
      provider?: string;
      forceRefresh?: boolean;
    }) => {
      if (request.operation === "list") {
        return {
          ok: true as const,
          apiKeyProviders: listLocalLlmCredentials(
            paths.stellaDataDirPath,
          ).map(({ provider }) => provider),
          oauthProviders: listLocalLlmOAuthCredentials(
            paths.stellaDataDirPath,
          ).map(({ provider }) => provider),
        };
      }
      if (request.operation === "claude-config") {
        return { ok: true as const, configDir: null, signedIn: true };
      }
      try {
        const value =
          request.kind === "api-key"
            ? getLocalLlmCredential(
                paths.stellaDataDirPath,
                request.provider ?? "",
              )
            : await getLocalLlmOAuthApiKey(
                paths.stellaDataDirPath,
                request.provider ?? "",
                { forceRefresh: request.forceRefresh === true },
              );
        return { ok: true as const, value };
      } catch {
        return { ok: true as const, value: null };
      }
    },
    askUser: async () => {
      throw new Error("Headless host has no UI to ask the user anything.");
    },
    requestSecureInput: async () => {
      throw new Error("Headless host has no UI to collect secure input.");
    },
    useSecureValue: async () => {
      throw new Error("Headless host has no secure value store.");
    },
    displayUpdate: () => {},
    showNotification: async () => {},
  };
};
