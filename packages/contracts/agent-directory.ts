import { agentStatusOf, isLiveAgentStatus, type AgentStatus } from "./agent-status.js";

export const STELLA_MESSAGE_TARGET = "stella";

export const AGENT_MESSAGE_MAX_CHARS = 8_000;

export const AGENT_MESSAGE_STARTER_RELATION = "started you";

export const AGENT_ROSTER_ACTIVE_LIMIT = 200;
export const AGENT_ROSTER_SLOTS = 16;

const DIRECTORY_SESSION_LIMIT = 10;

export type AgentDirectoryStatus = AgentStatus;

export type AgentDirectoryAgentRow = {
  threadId: string;
  conversationId: string;
  parentThreadId?: string;
  description: string;
  status: AgentDirectoryStatus;
  where: string;
  updatedAt: number;
  offline?: { lastSeenAt?: number };
  awaitingConsent?: true;
};

export type AgentDirectorySessionRow = {
  conversationId: string;
  title: string;
  active: boolean;
  where: string;
  updatedAt: number;
};

export type AgentDirectoryCaller = {
  conversationId: string;
  threadId?: string;
  parentThreadId?: string;
};

export type AgentDirectoryStatusValue = string | undefined | null;

export const normalizeAgentDirectoryStatus = (
  status: AgentDirectoryStatusValue,
): AgentDirectoryStatus => agentStatusOf(status) ?? "canceled";

const formatAge = (timestamp: number, now: number): string => {
  const ageMs = Math.max(0, now - timestamp);
  if (ageMs < 60_000) return "just now";
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h ago`;
  return `${Math.floor(ageMs / 86_400_000)}d ago`;
};

const isLive = (status: AgentDirectoryStatus) => isLiveAgentStatus(status);

const newestFirst = (a: AgentDirectoryAgentRow, b: AgentDirectoryAgentRow) =>
  b.updatedAt - a.updatedAt || a.threadId.localeCompare(b.threadId);

export const selectAgentRoster = (rows: readonly AgentDirectoryAgentRow[]) => {
  const unique = [...new Map(rows.map((row) => [row.threadId, row])).values()];
  const active = unique.filter((row) => isLive(row.status)).sort(newestFirst);
  const inactive = unique.filter((row) => !isLive(row.status)).sort(newestFirst);
  const shownActive = active.slice(0, AGENT_ROSTER_ACTIVE_LIMIT);
  const shownInactive = inactive.slice(
    0,
    Math.max(0, AGENT_ROSTER_SLOTS - shownActive.length),
  );
  return {
    active: shownActive,
    inactive: shownInactive,
    hiddenActive: active.length - shownActive.length,
    hiddenInactive: inactive.length - shownInactive.length,
  };
};

const lastSeen = (lastSeenAt: number | undefined, now: number) =>
  lastSeenAt !== undefined ? ` (last seen ${formatAge(lastSeenAt, now)})` : "";

const offlineText = (row: AgentDirectoryAgentRow, now: number): string | undefined =>
  row.offline
    ? `${row.where} is offline${lastSeen(row.offline.lastSeenAt, now)}, so this status may be out of date; it reports when ${row.where} reconnects`
    : undefined;

const awaitingConsentText = (row: AgentDirectoryAgentRow): string | undefined =>
  row.awaitingConsent && !row.offline
    ? `not started yet: ${row.where} is waiting for the user to allow work from other devices on its screen, and the agent starts once they do (up to an hour after it was sent)`
    : undefined;

const placeOf = (where: string): string[] => (where === "this computer" ? [] : [where]);

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 200);

const rosterLine = (
  row: AgentDirectoryAgentRow,
  now: number,
  options?: { starter?: boolean; startedYou?: boolean },
): string =>
  [
    `- ${row.threadId}`,
    row.offline
      ? `${row.status}, computer offline`
      : row.awaitingConsent
        ? "waiting for consent on that computer"
        : row.status,
    ...placeOf(row.where),
    `last active ${formatAge(row.updatedAt, now)}`,
    ...(options?.startedYou
      ? [AGENT_MESSAGE_STARTER_RELATION]
      : options?.starter !== false && row.parentThreadId
        ? [`started by ${row.parentThreadId}`]
        : []),
  ].join(" · ") + ` — ${oneLine(row.description)}`;

const sessionLine = (row: AgentDirectorySessionRow, now: number): string =>
  [
    `- ${row.conversationId}`,
    row.active ? "running" : "idle",
    ...placeOf(row.where),
    `last active ${formatAge(row.updatedAt, now)}`,
  ].join(" · ") + ` — ${oneLine(row.title) || "Untitled chat"}`;

export const renderAgentRoster = (
  rows: readonly AgentDirectoryAgentRow[],
  now = Date.now(),
): string | undefined => {
  const roster = selectAgentRoster(rows);
  if (roster.active.length === 0 && roster.inactive.length === 0) return undefined;
  const section = (title: string, list: AgentDirectoryAgentRow[], hidden: number) =>
    list.length === 0 && hidden === 0
      ? []
      : [
          `${title}:`,
          ...list.map((row) => rosterLine(row, now)),
          ...(hidden > 0 ? [`- ${hidden} more not shown`] : []),
        ];
  return [
    `Your agents as of ${new Date(now).toISOString().slice(0, 16).replace("T", " ")} UTC. This list is refreshed when your context is compacted; agent_status without a thread_id gives a live one, and send_message reaches any thread_id here.`,
    ...section("Active", roster.active, roster.hiddenActive),
    ...section("Recent", roster.inactive, 0),
    ...(roster.hiddenInactive > 0
      ? ["Older agents are in the history."]
      : []),
  ].join("\n");
};

export const agentDirectoryEntry = (row: AgentDirectoryAgentRow, now = Date.now()) => {
  const offline = offlineText(row, now);
  const waiting = awaitingConsentText(row);
  return {
    thread_id: row.threadId,
    description: row.description,
    status: row.status,
    where: row.where,
    last_active: formatAge(row.updatedAt, now),
    started_by: row.parentThreadId ?? STELLA_MESSAGE_TARGET,
    ...(offline ? { offline } : {}),
    ...(waiting ? { waiting } : {}),
  };
};

export const sessionDirectoryEntry = (row: AgentDirectorySessionRow, now = Date.now()) => ({
  thread_id: row.conversationId,
  description: row.title.trim() || "Untitled chat",
  status: row.active ? "running" : "idle",
  where: row.where,
  last_active: formatAge(row.updatedAt, now),
  relation: "another session",
});

export const buildAgentDirectoryResult = (input: {
  caller: AgentDirectoryCaller;
  agents: AgentDirectoryAgentRow[];
  sessions: AgentDirectorySessionRow[];
  now?: number;
  unavailable?: string;
}): string => {
  const now = input.now ?? Date.now();
  const { caller } = input;
  const roster = selectAgentRoster(
    input.agents.filter(
      (row) =>
        row.conversationId === caller.conversationId &&
        row.threadId !== caller.threadId,
    ),
  );
  const kept = [...roster.active, ...roster.inactive];
  const isOwn = (row: AgentDirectoryAgentRow) =>
    caller.threadId
      ? row.parentThreadId === caller.threadId
      : !row.parentThreadId;
  const subagents = kept
    .filter(isOwn)
    .map((row) => rosterLine(row, now, { starter: false }));
  const teammates = kept
    .filter((row) => !isOwn(row))
    .map((row) =>
      rosterLine(row, now, { startedYou: row.threadId === caller.parentThreadId }),
    );
  const sessions = input.sessions
    .filter((row) => row.conversationId !== caller.conversationId)
    .sort((a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt)
    .slice(0, DIRECTORY_SESSION_LIMIT)
    .map((row) => sessionLine(row, now));
  const section = (title: string, lines: string[]) =>
    lines.length === 0 ? [] : [`${title}:`, ...lines];
  const hidden = roster.hiddenActive + roster.hiddenInactive;
  const lines = [
    ...(caller.threadId ? [`stella: ${caller.conversationId}`] : []),
    ...section("subagents", subagents),
    ...section("teammates", teammates),
    ...section("sessions", sessions),
    ...(hidden > 0 ? [`(${hidden} older agent${hidden === 1 ? "" : "s"} in history)`] : []),
    ...(input.unavailable ? [input.unavailable] : []),
  ];
  return subagents.length + teammates.length + sessions.length === 0
    ? [...lines, "No other agents or sessions."].join("\n")
    : lines.join("\n");
};
export type AgentMessageSender = {
  threadId: string;
  label: string;
};

const escapeAttribute = (value: string) =>
  value.replace(/[\r\n]+/g, " ").replace(/"/g, "'").trim().slice(0, 200);

export const formatAgentMessage = (
  from: AgentMessageSender,
  text: string,
  options?: { starter?: boolean },
): string =>
  `<agent-message from="${escapeAttribute(from.label)}" thread_id="${escapeAttribute(from.threadId)}"${
    options?.starter ? ` relation="${AGENT_MESSAGE_STARTER_RELATION}"` : ""
  }>\n${text.trim()}\n</agent-message>`;

const FRAMED_AGENT_MESSAGE_RE =
  /^<agent-message from="[^"\n]*" thread_id="[^"\n]*"(?: relation="[^"\n]*")?>\n[\s\S]*\n<\/agent-message>$/u;

export const isFramedAgentMessage = (text: string): boolean => FRAMED_AGENT_MESSAGE_RE.test(text.trim());
