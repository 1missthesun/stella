import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * expo-constants' `EXConstants.bundle/app.config` is the config compiled into
 * the binary, never the OTA update's manifest, so an update published to an
 * older store build cannot turn a capability on.
 */
export type NativeCapability =
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

export const selfHostServersAvailable = hasNativeCapability("self-host-servers");
