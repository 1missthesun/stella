/**
 * This computer's view of each cloud conversation's brain lease
 * (`@stella/contracts/turn-plane/pi-brain`), the one both engines read: the
 * record as last seen in a read, a move, a begin's answer or a refusal. A
 * turn claims the lease with the epoch seen here; a Claude Code session
 * synced under an older epoch than the record's stops uploading, since the
 * lease it ran under is gone and what this computer holds of it is a cache.
 */
import {
  samePiBrainHost,
  type PiBrainClaim,
  type PiBrainHost,
  type PiBrainRecord,
} from "@stella/contracts/turn-plane/pi-brain";

export type BrainLeaseView = {
  /** What this computer last saw of a conversation's lease; null when there is no record. */
  note(conversationId: string, record: PiBrainRecord | null): void;
  /** The claim a turn of the conversation begins with. */
  claim(conversationId: string): PiBrainClaim;
  /** Whether this computer holds the conversation's lease, as last seen; undefined when unknown. */
  holds(conversationId: string): boolean | undefined;
  /** The host holding the conversation's lease, as last seen; undefined when unknown or none. */
  holder(conversationId: string): PiBrainHost | undefined;
  /** Whether work done under `epoch` belongs to a lease the conversation has since moved past. */
  superseded(conversationId: string, epoch: number): boolean;
  /**
   * The epoch a turn of the conversation begins under in this process
   * (null: no record); true when the process's previous turn there ran
   * under another, so what it kept of that turn is a cache.
   */
  beganUnder(conversationId: string, epoch: number | null): boolean;
  /** Called when a conversation's lease moves to another epoch. */
  onChange(listener: (conversationId: string, record: PiBrainRecord | null) => void): () => void;
};

export const createBrainLeaseView = (deviceId: string): BrainLeaseView => {
  const records = new Map<string, PiBrainRecord | null>();
  const listeners = new Set<(conversationId: string, record: PiBrainRecord | null) => void>();
  const turnEpochs = new Map<string, number | null>();
  return {
    note(conversationId, record) {
      const known = records.get(conversationId);
      // A late answer never rolls the view back.
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
