import type {
  SavedValueDevice,
  SavedValueDeviceKind,
  SavedValueHead,
  SavedValueRecord,
  SavedValueSeal,
} from "../saved-values.js";
import type {
  SavedValuesJoin,
  SavedValuesMember,
  SavedValuesRosterEntry,
  SavedValuesRosterPin,
} from "../saved-values-trust.js";

/**
 * What the cloud holds for an owner's synced saved values: the devices' list
 * (signed by the devices), devices asking to join, each device's last
 * check-in, and record ids and times.
 */
export type SavedValuesState = {
  /** Each device's check-in: when it was last seen, and the seal key it has now. */
  devices: SavedValueDevice[];
  records: SavedValueHead[];
  roster: SavedValuesRosterEntry[];
  joins: SavedValuesJoin[];
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
      /** A deletion's signature by `updatedBy` (signDeletion). */
      deleteSig?: string;
      sealed?: Record<string, SavedValueSeal>;
    };
    result: { accepted: boolean; head: SavedValueHead };
  };
  /** Add the next entry to the devices' list (the cloud checks it chains; devices check it too). */
  "savedValues.rosterAppend": {
    args: { entry: SavedValuesRosterEntry };
    result: { seq: number };
  };
  /** Start the list over from this device (every device of the account lost or unavailable). */
  "savedValues.rosterReset": {
    args: { entry: SavedValuesRosterEntry };
    result: { seq: number };
  };
  /** A device not on the list asks to join. */
  "savedValues.joinStart": {
    args: { joinId: string; device: SavedValuesMember; commit: string };
    result: SavedValuesJoin;
  };
  /** A device on the list adds its random number and its pin of the list (step 2). */
  "savedValues.joinAnswer": {
    args: { joinId: string; by: string; listedNonce: string; pin: SavedValuesRosterPin };
    result: SavedValuesJoin;
  };
  /** The joining device reveals its random number (step 3). */
  "savedValues.joinReveal": {
    args: { joinId: string; joinerNonce: string };
    result: SavedValuesJoin;
  };
  /** The user allowed or declined it on a device on the list. */
  "savedValues.joinDecide": {
    args: { joinId: string; by: string; state: "allowed" | "declined" };
    result: SavedValuesJoin;
  };
  "savedValues.joinCancel": {
    args: { joinId: string };
    result: { canceled: boolean };
  };
};

export type SavedValueViews = {
  "savedValues.state": { args: Record<string, never>; result: SavedValuesState };
};
