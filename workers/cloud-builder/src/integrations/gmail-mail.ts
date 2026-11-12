import { GMAIL_API, GoogleApiError, gmailHeader, gmailMessageText, type Fetcher } from "./google.js";

type JsonObject = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const BODY_CHARS = 2_400;
const HISTORY_PAGES = 5;
const SENT_SCAN = 200;

export type GmailAttachmentRef = { filename: string; mimeType: string; size: number; attachmentId: string };

export type GmailMail = {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  fromAddress: string;
  to: string;
  cc: string;
  subject: string;
  receivedAt: number;
  labelIds: string[];
  text: string;
  bulk: boolean;
  attachments: GmailAttachmentRef[];
};

export const parseAddress = (value: string): { name: string; address: string } => {
  const trimmed = value.trim();
  const angle = /^(.*)<([^>]+)>\s*$/u.exec(trimmed);
  if (angle) {
    const name = angle[1]!.trim().replace(/^"|"$/gu, "").trim();
    return { name: name || angle[2]!.trim(), address: angle[2]!.trim().toLowerCase() };
  }
  return { name: trimmed, address: trimmed.toLowerCase() };
};

export const addressesIn = (value: string): string[] =>
  value
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/u)
    .map((entry) => parseAddress(entry).address)
    .filter((address) => address.includes("@"));

export const gmailProfile = async (get: Fetcher): Promise<{ emailAddress: string; historyId: string }> => {
  const profile = (await get(`${GMAIL_API}/profile`)) as JsonObject;
  return { emailAddress: str(profile.emailAddress).toLowerCase(), historyId: str(profile.historyId) };
};

/** Asks Gmail to publish this inbox's changes to the Pub/Sub topic; it lasts up to 7 days. */
export const gmailWatch = async (get: Fetcher, topicName: string): Promise<{ historyId: string; expiration: number }> => {
  const answer = (await get(`${GMAIL_API}/watch`, {
    method: "POST",
    body: { topicName, labelIds: ["INBOX", "SENT"], labelFilterBehavior: "INCLUDE" },
  })) as JsonObject;
  return { historyId: str(answer.historyId), expiration: Number(answer.expiration) || 0 };
};

export const gmailStopWatch = async (get: Fetcher): Promise<void> => {
  await get(`${GMAIL_API}/stop`, { method: "POST", body: {} }).catch(() => undefined);
};

export type GmailHistory = {
  /** Messages added (or moved into the inbox) since the cursor, oldest first, with the labels they had then. */
  added: { id: string; labelIds: string[] }[];
  historyId: string;
  /** The cursor was too old for Gmail to answer from; start again from now. */
  expired: boolean;
};

export const gmailHistorySince = async (get: Fetcher, startHistoryId: string): Promise<GmailHistory> => {
  const added: { id: string; labelIds: string[] }[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  let historyId = startHistoryId;
  try {
    for (let page = 0; page < HISTORY_PAGES; page += 1) {
      const params = new URLSearchParams({ startHistoryId, maxResults: "200" });
      params.append("historyTypes", "messageAdded");
      params.append("historyTypes", "labelAdded");
      if (pageToken) params.set("pageToken", pageToken);
      const answer = (await get(`${GMAIL_API}/history?${params.toString()}`)) as JsonObject;
      historyId = str(answer.historyId) || historyId;
      for (const entry of Array.isArray(answer.history) ? answer.history : []) {
        if (!isRecord(entry)) continue;
        const movedIn = (Array.isArray(entry.labelsAdded) ? entry.labelsAdded : []).filter(
          (labelEntry) => isRecord(labelEntry) && Array.isArray(labelEntry.labelIds) && labelEntry.labelIds.includes("INBOX"),
        );
        for (const addedEntry of [...(Array.isArray(entry.messagesAdded) ? entry.messagesAdded : []), ...movedIn]) {
          const message = isRecord(addedEntry) && isRecord(addedEntry.message) ? addedEntry.message : null;
          const id = message ? str(message.id) : "";
          if (!id || seen.has(id)) continue;
          seen.add(id);
          added.push({ id, labelIds: Array.isArray(message!.labelIds) ? message!.labelIds.map(String) : [] });
        }
      }
      pageToken = str(answer.nextPageToken) || undefined;
      if (!pageToken) break;
    }
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 404) return { added: [], historyId: "", expired: true };
    throw error;
  }
  return { added, historyId, expired: false };
};

const plainText = (text: string): string =>
  text
    .replace(/\r/gu, "")
    .split("\n")
    .filter((line) => !/^>/u.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

export const gmailReadMail = async (get: Fetcher, id: string): Promise<GmailMail | null> => {
  let message: JsonObject;
  try {
    message = (await get(`${GMAIL_API}/messages/${encodeURIComponent(id)}?format=full`)) as JsonObject;
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 404) return null;
    throw error;
  }
  const payload = isRecord(message.payload) ? message.payload : {};
  const headers = payload.headers;
  const from = gmailHeader(headers, "From") ?? "";
  const sender = parseAddress(from);
  const body = gmailMessageText(payload);
  const internal = Number(message.internalDate);
  return {
    id: str(message.id) || id,
    threadId: str(message.threadId) || id,
    from,
    fromName: sender.name,
    fromAddress: sender.address,
    to: gmailHeader(headers, "To") ?? "",
    cc: gmailHeader(headers, "Cc") ?? "",
    subject: (gmailHeader(headers, "Subject") ?? "").trim() || "(no subject)",
    receivedAt: Number.isFinite(internal) && internal > 0 ? internal : Date.now(),
    labelIds: Array.isArray(message.labelIds) ? message.labelIds.map(String) : [],
    text: plainText(body.text || str(message.snippet)).slice(0, BODY_CHARS),
    bulk: Boolean(gmailHeader(headers, "List-Unsubscribe") || /bulk|list/iu.test(gmailHeader(headers, "Precedence") ?? "")),
    attachments: body.attachments.flatMap((entry) => {
      const attachmentId = str(entry.attachmentId);
      return attachmentId
        ? [{ filename: str(entry.filename), mimeType: str(entry.mimeType).toLowerCase(), size: Number(entry.size) || 0, attachmentId }]
        : [];
    }),
  };
};

/** One attachment's bytes as standard base64. */
export const gmailAttachmentBase64 = async (get: Fetcher, messageId: string, attachmentId: string): Promise<string> => {
  const answer = (await get(
    `${GMAIL_API}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  )) as JsonObject;
  const data = str(answer.data);
  return data.replace(/-/gu, "+").replace(/_/gu, "/");
};

/** Labels a message has now (to see whether the user already read or archived it). */
export const gmailLabelsOf = async (get: Fetcher, id: string): Promise<string[] | null> => {
  try {
    const message = (await get(`${GMAIL_API}/messages/${encodeURIComponent(id)}?format=minimal`)) as JsonObject;
    return Array.isArray(message.labelIds) ? message.labelIds.map(String) : [];
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 404) return null;
    throw error;
  }
};

/** Everyone this inbox wrote to recently, with how often: the people who matter, read from headers only. */
export const gmailSentPeople = async (get: Fetcher): Promise<Map<string, { count: number; lastAt: number }>> => {
  const list = (await get(
    `${GMAIL_API}/messages?${new URLSearchParams({ q: "in:sent newer_than:180d", maxResults: String(SENT_SCAN) }).toString()}`,
  )) as JsonObject;
  const ids = (Array.isArray(list.messages) ? list.messages : []).map((entry) => str((entry as JsonObject).id)).filter(Boolean);
  const people = new Map<string, { count: number; lastAt: number }>();
  for (let index = 0; index < ids.length; index += 20) {
    const batch = await Promise.all(
      ids.slice(index, index + 20).map(async (id) => {
        const message = (await get(
          `${GMAIL_API}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=To&metadataHeaders=Cc`,
        ).catch(() => null)) as JsonObject | null;
        return message;
      }),
    );
    for (const message of batch) {
      if (!message) continue;
      const headers = isRecord(message.payload) ? message.payload.headers : undefined;
      const at = Number(message.internalDate) || 0;
      for (const address of [...addressesIn(gmailHeader(headers, "To") ?? ""), ...addressesIn(gmailHeader(headers, "Cc") ?? "")]) {
        const known = people.get(address);
        people.set(address, { count: (known?.count ?? 0) + 1, lastAt: Math.max(known?.lastAt ?? 0, at) });
      }
    }
  }
  return people;
};
