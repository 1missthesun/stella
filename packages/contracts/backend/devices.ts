import type { DeviceRemoteExecution, DevicesResponse } from "../turn-plane/placement.js";

export type ActivityNotificationKind = "started" | "completed" | "failed";

export type DeviceCalls = {
  "devices.identity": {
    args: { deviceId?: string };
    result: {
      ownerId: string;
      ownerGeneration: string;
      deviceId?: string;
      builderOrigin?: string;
    };
  };
  "devices.register": {
    args: {
      deviceId: string;
      devicePublicKey: string;
      deviceName?: string;
      platform?: string;
      capabilities?: string[];
    };
    result: {
      deviceId: string;
      ownerGeneration: string;
      remoteExecutionEnabled: boolean;
      remoteExecution: DeviceRemoteExecution;
      rotated: boolean;
    };
  };
  "devices.setRemoteExecution": {
    args: { deviceId: string; enabled: boolean };
    result: {
      deviceId: string;
      remoteExecution: DeviceRemoteExecution;
      changed: boolean;
    };
  };
  "devices.requestRemoteExecution": {
    args: { deviceId: string };
    result: { deviceId: string; remoteExecution: DeviceRemoteExecution };
  };
  "devices.setBrainHome": {
    args: { deviceId: string | null };
    result: { deviceId: string | null };
  };
  "devices.adoptSuccession": {
    args: { previousDeviceId: string; deviceId: string };
    result: {
      ok: true;
      migratedPairings: number;
      migratedRemoteExecution: boolean;
    };
  };
  "phone.notifyActivity": {
    args: { kind: ActivityNotificationKind; title?: string; taskId?: string };
    result: null;
  };
};

export type DeviceViews = {
  "devices.list": { args: Record<string, never>; result: DevicesResponse };
};
