import { sha256Hex } from "../hash.js";

const TICKET_PATTERN = /^([0-9a-f]{64})\.([0-9a-f]{64})\.([0-9a-z]{1,12})$/u;

export type TtsTicket = { ticket: string; ownerHash: string; id: string; expiresAt: number };

export const ttsOwnerPrefix = async (ownerId: string): Promise<string> => `tts/${await sha256Hex(ownerId)}.`;

export const ttsObjectKey = (ticket: string, file: string): string => `tts/${ticket}/${file}`;

export const mintTtsTicket = async (ownerId: string, expiresAt: number): Promise<TtsTicket> => {
  const ownerHash = await sha256Hex(ownerId);
  const id = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/gu, "");
  return { ticket: `${ownerHash}.${id}.${expiresAt.toString(36)}`, ownerHash, id, expiresAt };
};

export const readTtsTicket = (ticket: string, now: number): TtsTicket | null => {
  const match = TICKET_PATTERN.exec(ticket);
  if (!match) return null;
  const [, ownerHash, id, exp] = match;
  const expiresAt = Number.parseInt(exp!, 36);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return { ticket, ownerHash: ownerHash!, id: id!, expiresAt };
};
