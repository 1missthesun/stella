import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * Capabilities the installed native binary declares in its embedded app
 * config (`expo.extra.nativeCapabilities` in app.json at build time).
 *
 * This reads the config compiled INTO the binary (expo-constants'
 * `EXConstants.bundle/app.config`), never the OTA update's manifest, so an
 * update published to an older store build cannot turn a capability on. A
 * feature whose first exposure has to be a store build (App Review) or that
 * needs native pieces the old binary lacks checks here.
 */
export type NativeCapability =
  /** Self-hosted servers: the `stella://` scheme, server list, pairing. */
  "self-host-servers";

type ExponentConstantsModule = { manifest?: unknown };

const readEmbeddedCapabilities = (): ReadonlySet<string> => {
  try {
    const native =
      requireOptionalNativeModule<ExponentConstantsModule>("ExponentConstants");
    const raw = native?.manifest;
    const config = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
      extra?: { nativeCapabilities?: unknown };
    } | null;
    const list = config?.extra?.nativeCapabilities;
    return new Set(
      Array.isArray(list)
        ? list.filter((entry): entry is string => typeof entry === "string")
        : [],
    );
  } catch {
    return new Set();
  }
};

const embedded = readEmbeddedCapabilities();

/**
 * Development only: `EXPO_PUBLIC_STELLA_NATIVE_CAPABILITIES=self-host-servers`
 * lets an older dev client run the JS. Production bundles ignore it.
 */
const devOverride = (): ReadonlySet<string> =>
  __DEV__
    ? new Set(
        (process.env.EXPO_PUBLIC_STELLA_NATIVE_CAPABILITIES ?? "")
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
      )
    : new Set();

const override = devOverride();

export const hasNativeCapability = (capability: NativeCapability): boolean =>
  embedded.has(capability) || override.has(capability);

/** Self-hosted server support is in this binary. */
export const selfHostServersAvailable = hasNativeCapability("self-host-servers");
