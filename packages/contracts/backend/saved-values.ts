import type {
  SavedValueDevice,
  SavedValueDeviceKind,
  SavedValueHead,
  SavedValueRecord,
  SavedValueSeal,
} from "../saved-values.js";

/** What the cloud holds for an owner's synced saved values: device keys, and record ids and times. */
export type SavedValuesState = {
  devices: SavedValueDevice[];
  records: SavedValueHead[];
};

export type SavedValueCalls = {
  /** Publish (or refresh) this device's key, so records get sealed to it. */
  "savedValues.putDevice": {
    args: { deviceId: string; kind: SavedValueDeviceKind; publicKey: string; name?: string };
    result: SavedValueDevice;
  };
  /** This device stops receiving saved values (sync turned off here, or signed out). */
  "savedValues.removeDevice": {
    args: { deviceId: string };
    result: { removed: boolean };
  };
  "savedValues.get": {
    args: { ids: string[] };
    result: { records: SavedValueRecord[] };
  };
  /**
   * Store a record if it is newer than the one held, or the same version
   * sealed to more recipients. `accepted: false` returns the newer head.
   */
  "savedValues.put": {
    args: {
      id: string;
      updatedAt: number;
      updatedBy: string;
      deleted?: true;
      sealed?: Record<string, SavedValueSeal>;
    };
    result: { accepted: boolean; head: SavedValueHead };
  };
};

export type SavedValueViews = {
  "savedValues.state": { args: Record<string, never>; result: SavedValuesState };
};
