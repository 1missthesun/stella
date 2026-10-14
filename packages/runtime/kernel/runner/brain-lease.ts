import {
  samePiBrainHost,
  type PiBrainClaim,
  type PiBrainHost,
  type PiBrainRecord,
} from "@stella/contracts/turn-plane/pi-brain";

export type BrainLeaseView = {
  note(conversationId: string, record: PiBrainRecord | null): void;
  claim(conversationId: string): PiBrainClaim;
  holds(conversationId: string): boolean | undefined;
  holder(conversationId: string): PiBrainHost | undefined;
  superseded(conversationId: string, epoch: number): boolean;
  beganUnder(conversationId: string, epoch: number | null): boolean;
  onChange(listener: (conversationId: string, record: PiBrainRecord | null) => void): () => void;
};

export const createBrainLeaseView = (deviceId: string): BrainLeaseView => {
  const records = new Map<string, PiBrainRecord | null>();
  const listeners = new Set<(conversationId: string, record: PiBrainRecord | null) => void>();
  const turnEpochs = new Map<string, number | null>();
  return {
    note(conversationId, record) {
      const known = records.get(conversationId);
      if (known && record && record.epoch < known.epoch) return;
      if (known && !record) return;
      records.set(conversationId, record);
      if (known === undefined ? record === null : known?.epoch === record?.epoch) return;
      for (const listener of listeners) {
        try {
          listener(conversationId, record);
        } catch {
          // A listener's failure is its own.
        }
      }
    },
    claim(conversationId) {
      const record = records.get(conversationId);
      return { epoch: record ? record.epoch : null };
    },
    holds(conversationId) {
      if (!records.has(conversationId)) return undefined;
      const record = records.get(conversationId);
      return record ? samePiBrainHost(record, { host: "device", deviceId }) : false;
    },
    holder(conversationId) {
      const record = records.get(conversationId);
      if (!record) return undefined;
      return record.host === "cloud"
        ? { host: "cloud" }
        : { host: "device", deviceId: record.deviceId, ...(record.label ? { label: record.label } : {}) };
    },
    superseded(conversationId, epoch) {
      const record = records.get(conversationId);
      return Boolean(record && record.epoch > epoch);
    },
    beganUnder(conversationId, epoch) {
      const moved = turnEpochs.has(conversationId) && turnEpochs.get(conversationId) !== epoch;
      turnEpochs.set(conversationId, epoch);
      return moved;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
