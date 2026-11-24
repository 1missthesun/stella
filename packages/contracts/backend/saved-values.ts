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

export type SavedValuesState = {
  devices: SavedValueDevice[];
  records: SavedValueHead[];
  roster: SavedValuesRosterEntry[];
  joins: SavedValuesJoin[];
};

export type SavedValueCalls = {
  "savedValues.putDevice": {
    args: { deviceId: string; kind: SavedValueDeviceKind; publicKey: string; name?: string };
    result: SavedValueDevice;
  };
  "savedValues.removeDevice": {
    args: { deviceId: string };
    result: { removed: boolean };
  };
  "savedValues.get": {
    args: { ids: string[] };
    result: { records: SavedValueRecord[] };
  };
  "savedValues.put": {
    args: {
      id: string;
      updatedAt: number;
      updatedBy: string;
      deleted?: true;
      deleteSig?: string;
      sealed?: Record<string, SavedValueSeal>;
    };
    result: { accepted: boolean; head: SavedValueHead };
  };
  "savedValues.rosterAppend": {
    args: { entry: SavedValuesRosterEntry };
    result: { seq: number };
  };
  "savedValues.rosterReset": {
    args: { entry: SavedValuesRosterEntry };
    result: { seq: number };
  };
  "savedValues.joinStart": {
    args: { joinId: string; device: SavedValuesMember; commit: string };
    result: SavedValuesJoin;
  };
  "savedValues.joinAnswer": {
    args: { joinId: string; by: string; listedNonce: string; pin: SavedValuesRosterPin };
    result: SavedValuesJoin;
  };
  "savedValues.joinReveal": {
    args: { joinId: string; joinerNonce: string };
    result: SavedValuesJoin;
  };
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
