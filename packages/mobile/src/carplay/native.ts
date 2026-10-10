import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import {
  requireOptionalNativeModule,
  type EventSubscription,
} from "expo-modules-core";

export type CarPlayIcon =
  | "mic"
  | "waveform"
  | "thinking"
  | "speaker"
  | "replay"
  | "person";

export type CarPlayRow = {
  id: string;
  title: string;
  detail?: string;
  icon?: CarPlayIcon;
  playing?: boolean;
  enabled?: boolean;
};

export type CarPlaySection = { header?: string; rows: CarPlayRow[] };

export type CarPlayVoiceAction = "send" | "cancel" | "dismissed";

type CarPlayEvents = {
  onConnectionChange: (event: { connected: boolean }) => void;
  onRowSelect: (event: { id: string }) => void;
  onVoiceControlAction: (event: { action: CarPlayVoiceAction }) => void;
};

type StellaCarPlayModule = {
  isConnected(): boolean;
  isPhoneForeground(): boolean;
  supportsVoiceControl(): boolean;
  setHome(sections: CarPlaySection[]): void;
  setVoiceControl(state: "listening" | null): void;
  setBackgroundActivity(hold: boolean): void;
  relaxKeychainAccessibility(): Promise<number>;
  addListener<K extends keyof CarPlayEvents>(
    name: K,
    listener: CarPlayEvents[K],
  ): EventSubscription;
};

export const carPlayNative =
  Platform.OS === "ios"
    ? requireOptionalNativeModule<StellaCarPlayModule>("StellaCarPlay")
    : null;

export function isCarPlayConnected(): boolean {
  try {
    return carPlayNative?.isConnected() ?? false;
  } catch {
    return false;
  }
}

/**
 * Whether the user is actually looking at Stella on the phone. With a CarPlay
 * scene in front, iOS reports the whole app as active even while the phone is
 * locked in a pocket, so AppState alone over-reports.
 */
export function isPhoneInForeground(): boolean {
  if (AppState.currentState !== "active") return false;
  if (!carPlayNative || !isCarPlayConnected()) return true;
  try {
    return carPlayNative.isPhoneForeground();
  } catch {
    return true;
  }
}

export function relaxKeychainAccessibility(): void {
  void carPlayNative?.relaxKeychainAccessibility().catch(() => undefined);
}

export function useCarPlayConnected(): boolean {
  const [connected, setConnected] = useState(isCarPlayConnected);
  useEffect(() => {
    if (!carPlayNative) return;
    const subscription = carPlayNative.addListener(
      "onConnectionChange",
      (event) => setConnected(event.connected),
    );
    setConnected(isCarPlayConnected());
    return () => subscription.remove();
  }, []);
  return connected;
}

export function useCarPlayHome(sections: CarPlaySection[]) {
  const serialized = JSON.stringify(sections);
  useEffect(() => {
    carPlayNative?.setHome(JSON.parse(serialized) as CarPlaySection[]);
  }, [serialized]);
}

export function useCarPlayEvents(handlers: {
  onRowSelect?: (id: string) => void;
  onVoiceControlAction?: (action: CarPlayVoiceAction) => void;
}) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  useEffect(() => {
    if (!carPlayNative) return;
    const rows = carPlayNative.addListener("onRowSelect", (event) =>
      handlersRef.current.onRowSelect?.(event.id),
    );
    const voice = carPlayNative.addListener("onVoiceControlAction", (event) =>
      handlersRef.current.onVoiceControlAction?.(event.action),
    );
    return () => {
      rows.remove();
      voice.remove();
    };
  }, []);
}
