import type { ChatArtifact, MobileDisplayPayload, MobileTask } from "../types";
import {
  agentWorkArtifactId,
  artifactId,
  artifactPrimaryFilePath,
} from "./mobile-artifacts";

export type AgentWorkChatArtifact = ChatArtifact & {
  payload: Extract<MobileDisplayPayload, { kind: "agent-work" }>;
};

export type MapRouteChatArtifact = ChatArtifact & {
  payload: Extract<MobileDisplayPayload, { kind: "map-route" }>;
};

export const isAgentWorkArtifact = (
  artifact: ChatArtifact,
): artifact is AgentWorkChatArtifact => artifact.payload.kind === "agent-work";

/**
 * Mobile port of the desktop agent-artifact consolidation semantics
 * (desktop: `path-to-viewer.ts` `isNoiseProducedPath` / `isDeclaredOutputPath`
 * + `agent-completion.ts` `rankDeliverablesFirst`). Files a background agent
 * produces fold INTO that turn's agent-work card as pills — revealed together
 * once the card settles — instead of popping as loose file cards while the
 * agent is still running.
 *
 * The desktop↔mobile bridge ships each synced row's artifacts as loose
 * display payloads with NO per-agent attribution (the `agent-work` payload
 * carries no file list), so consolidation here is row-scoped: a row that
 * carries an agent-work card treats its file artifacts as that card's
 * deliverables. Agents spawned on different turns ride different rows, which
 * keeps attribution correct across concurrent agents at the granularity
 * mobile can represent at the row level. Inline rendering later projects that
 * row into one independently keyed card per agent.
 */

const DECLARED_OUTPUTS_RE = /(?:^|[\\/])(?:\.stella|state)[\\/]outputs[\\/]/;

export const isDeclaredOutputPath = (filePath: string): boolean =>
  DECLARED_OUTPUTS_RE.test(filePath);

const NOISE_PATH_SEGMENTS = new Set(["node_modules", "__pycache__"]);
const NOISE_EXTS = new Set(["log", "tmp", "lock", "pid"]);

const extensionOf = (filePath: string): string | null => {
  const tail = filePath.split(/[\\/]/).pop() ?? filePath;
  const dot = tail.lastIndexOf(".");
  return dot <= 0 || dot === tail.length - 1
    ? null
    : tail.slice(dot + 1).toLowerCase();
};

export const isNoiseProducedPath = (filePath: string): boolean => {
  const trimmed = filePath.trim();
  if (!trimmed) return true;
  for (const segment of trimmed.split(/[\\/]/)) {
    if (!segment) continue;
    if (segment.startsWith(".") && segment !== ".stella") return true;
    if (NOISE_PATH_SEGMENTS.has(segment)) return true;
  }
  const ext = extensionOf(trimmed);
  return ext != null && NOISE_EXTS.has(ext);
};

export const isNoiseFileArtifact = (artifact: ChatArtifact): boolean => {
  const filePath = artifactPrimaryFilePath(artifact.payload);
  return filePath != null && isNoiseProducedPath(filePath);
};

export const rankDeliverablesFirst = (
  artifacts: ChatArtifact[],
): ChatArtifact[] => {
  const isDeliverable = (artifact: ChatArtifact) => {
    const filePath = artifactPrimaryFilePath(artifact.payload);
    return filePath != null && isDeclaredOutputPath(filePath);
  };
  return [
    ...artifacts.filter(isDeliverable),
    ...artifacts.filter((artifact) => !isDeliverable(artifact)),
  ];
};

export type ConsolidatedRowArtifacts = {
  agentWork: AgentWorkChatArtifact[];
  maps: MapRouteChatArtifact[];
  /**
   * Fallback-only: files folded into the agent-work card as pills when the
   * bridge predates per-agent sections. Populated only when the row carries
   * an agent-work card WITHOUT a desktop-computed `agents` list;
   * noise-filtered, deliverables first.
   */
  agentFiles: ChatArtifact[];
  looseFiles: ChatArtifact[];
  agentWorkSettled: boolean;
};

export type AgentWorkCardSection = {
  key: string;
  agentId?: string;
  title?: string;
  files: ChatArtifact[];
  summary?: string;
};

/**
 * Desktop-computed per-agent file sections for one agent-work card, mapped
 * to openable `ChatArtifact`s. Returns `null` when the payload predates the
 * consolidating bridge (no `agents` field) — callers fall back to row-scoped
 * folding. File ids reuse the path-keyed `artifactId` so the same file
 * dedupes against the artifacts browser.
 */
export const agentWorkCardSections = (
  artifact: AgentWorkChatArtifact,
): AgentWorkCardSection[] | null => {
  const agents = artifact.payload.agents;
  if (agents === undefined) return null;
  const sections: AgentWorkCardSection[] = [];
  for (const agent of agents) {
    if (agent.files.length === 0 && !agent.summary) continue;
    sections.push({
      key: `${artifact.id}:${agent.agentId}`,
      agentId: agent.agentId,
      title: agent.title,
      files: agent.files.map((file, index) => ({
        id: artifactId(file, artifact.conversationId, index),
        conversationId: artifact.conversationId,
        payload: file,
      })),
      ...(agent.summary ? { summary: agent.summary } : {}),
    });
  }
  return sections;
};

export const inlineAgentWorkCardSections = (
  artifact: AgentWorkChatArtifact,
): AgentWorkCardSection[] | null =>
  artifact.payload.state === "done" ? agentWorkCardSections(artifact) : null;

export type AgentWorkCardRender = {
  key: string;
  payload: Extract<MobileDisplayPayload, { kind: "agent-work" }>;
  sections: AgentWorkCardSection[];
};

/**
 * The card(s) to render for one agent-work artifact.
 *
 * The desktop-to-mobile transcript projection historically ships one aggregate
 * `agent-work` payload for every agent spawned by a turn. Expand that payload
 * at the inline-rendering boundary so each task retains its own identity and
 * can transition independently. The activity pill/tray continues to consume
 * the original `MobileTask` collection and is deliberately unaffected.
 */
export const settledAgentWorkCards = (
  artifact: AgentWorkChatArtifact,
  tasks: readonly MobileTask[] = [],
): AgentWorkCardRender[] => {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const sectionById = new Map(
    (artifact.payload.agents ?? []).map((section) => [
      section.agentId,
      section,
    ]),
  );
  const agentIds = [
    ...new Set([
      ...(artifact.payload.agentIds ?? []),
      ...sectionById.keys(),
      ...tasks.map((task) => task.id),
    ]),
  ];
  if (agentIds.length <= 1) {
    const singleTask = agentIds[0] ? taskById.get(agentIds[0]) : undefined;
    const settledUnsuccessfully =
      artifact.payload.state === "done" &&
      (singleTask?.status === "error" || singleTask?.status === "canceled");
    return [
      {
        key: artifact.id,
        payload:
          settledUnsuccessfully && artifact.payload.failed !== true
            ? { ...artifact.payload, failed: true }
            : artifact.payload,
        sections: inlineAgentWorkCardSections(artifact) ?? [],
      },
    ];
  }

  return agentIds.map((agentId, index) => {
    const task = taskById.get(agentId);
    const rawSection = sectionById.get(agentId);
    const taskFinished = task ? task.status !== "running" : Boolean(rawSection);
    const done = artifact.payload.state === "done" || taskFinished;
    const subtitle = task
      ? task.status === "running"
        ? task.statusText || "Working in background"
        : task.status === "error"
          ? "Failed"
          : task.status === "canceled"
            ? "Stopped"
            : "Finished"
      : done
        ? "Finished"
        : "Working in background";
    const payload: Extract<MobileDisplayPayload, { kind: "agent-work" }> = {
      ...artifact.payload,
      state: done ? "done" : "running",
      agentIds: [agentId],
      total: 1,
      completed: done ? 1 : 0,
      title: task?.title || rawSection?.title || "Background work",
      subtitle,
      followUp: undefined,
      failed:
        task && (task.status === "error" || task.status === "canceled")
          ? true
          : undefined,
      createdAt:
        task && task.createdAt > 0
          ? task.createdAt
          : artifact.payload.createdAt,
      ...(artifact.payload.textOffsetsByAgentId?.[agentId] !== undefined
        ? {
            textOffset: artifact.payload.textOffsetsByAgentId[agentId],
            textOffsetsByAgentId: {
              [agentId]: artifact.payload.textOffsetsByAgentId[agentId],
            },
          }
        : index > 0
          ? { textOffset: undefined, textOffsetsByAgentId: undefined }
          : {}),
      ...(artifact.payload.agents !== undefined
        ? { agents: rawSection ? [rawSection] : [] }
        : {}),
    };
    const splitArtifact: AgentWorkChatArtifact = {
      ...artifact,
      id: index === 0 ? artifact.id : agentWorkArtifactId([agentId]),
      payload,
    };
    return {
      key: splitArtifact.id,
      payload,
      sections: inlineAgentWorkCardSections(splitArtifact) ?? [],
    };
  });
};

const expandInlineAgentWork = (
  artifacts: readonly ChatArtifact[],
  tasks: readonly MobileTask[],
): ChatArtifact[] => {
  const expanded: ChatArtifact[] = [];
  const agentCardIndexById = new Map<string, number>();
  for (const artifact of artifacts) {
    if (!isAgentWorkArtifact(artifact)) {
      expanded.push(artifact);
      continue;
    }
    for (const card of settledAgentWorkCards(artifact, tasks)) {
      const split = { ...artifact, id: card.key, payload: card.payload };
      const existingIndex = agentCardIndexById.get(card.key);
      if (existingIndex === undefined) {
        agentCardIndexById.set(card.key, expanded.length);
        expanded.push(split);
      } else {
        expanded[existingIndex] = split;
      }
    }
  }
  return expanded;
};

const EMPTY_ROW_ARTIFACTS: ConsolidatedRowArtifacts = {
  agentWork: [],
  maps: [],
  agentFiles: [],
  looseFiles: [],
  agentWorkSettled: false,
};

const rowArtifactsByMessage = new WeakMap<object, ConsolidatedRowArtifacts>();

export const messageRowArtifacts = (message: {
  artifacts?: readonly ChatArtifact[];
  tasks?: readonly MobileTask[];
}): ConsolidatedRowArtifacts => {
  if (!message.artifacts?.length) return EMPTY_ROW_ARTIFACTS;
  let consolidated = rowArtifactsByMessage.get(message);
  if (!consolidated) {
    consolidated = consolidateRowArtifacts(message.artifacts, message.tasks ?? []);
    rowArtifactsByMessage.set(message, consolidated);
  }
  return consolidated;
};

export const consolidateRowArtifacts = (
  artifacts: readonly ChatArtifact[],
  tasks: readonly MobileTask[] = [],
): ConsolidatedRowArtifacts => {
  const agentWork: AgentWorkChatArtifact[] = [];
  const maps: MapRouteChatArtifact[] = [];
  const files: ChatArtifact[] = [];
  for (const artifact of expandInlineAgentWork(artifacts, tasks)) {
    if (artifact.payload.kind === "agent-work") {
      agentWork.push(artifact as AgentWorkChatArtifact);
    } else if (artifact.payload.kind === "map-route") {
      maps.push(artifact as MapRouteChatArtifact);
    } else if (!isNoiseFileArtifact(artifact)) {
      files.push(artifact);
    }
  }
  const sectionFileIds = new Set<string>();
  for (const artifact of agentWork) {
    for (const section of agentWorkCardSections(artifact) ?? []) {
      for (const file of section.files) sectionFileIds.add(file.id);
    }
  }
  const ranked = rankDeliverablesFirst(
    files.filter((artifact) => !sectionFileIds.has(artifact.id)),
  );
  const hasAgentWork = agentWork.length > 0;
  // A card carrying an `agents` list marks a consolidating bridge: agent
  // files ride the card's own sections and whatever is left loose on the row
  // is orchestrator-direct. Older desktops omit the field entirely, so the
  // row's files fold into the card as an unattributed group instead.
  const bridgeConsolidated = agentWork.some(
    (artifact) => artifact.payload.agents !== undefined,
  );
  const fold = hasAgentWork && !bridgeConsolidated;
  return {
    agentWork,
    maps,
    agentFiles: fold ? ranked : [],
    looseFiles: fold ? [] : ranked,
    agentWorkSettled:
      hasAgentWork &&
      agentWork.every((artifact) => artifact.payload.state === "done"),
  };
};
