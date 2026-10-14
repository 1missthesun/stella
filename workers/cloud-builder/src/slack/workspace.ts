import { Type, type TSchema } from "@sinclair/typebox";
import type { CloudCodeSourceAgentTool } from "../cloud-code-tool.js";
import type { CloudConnectorSource } from "../cloud-connect-client.js";
import type { CloudSkillCatalogSnapshot } from "../cloud-home-store.js";
import type { OwnerInternalCall } from "../owner-store/registry.js";
import type { DriveTurnFilesResult } from "../owner-store/domains/drive.js";
import type { SlackPlace } from "./format.js";
import slackPrompt from "./slack.md";

export {
  isSlackConversationId,
  SLACK_CONVERSATION_PREFIX,
} from "./conversation-id.js";
export const SLACK_MEMORY_TOOL_NAME = "slack_memory";
export const SLACK_REPO_ROOT = "/workspace/repos";
export const SLACK_NO_REPLY = "<no-reply/>";

export type SlackPerson = { id: string; name: string };

export type SlackRepoContext = {
  fullName: string;
  branch: string;
  push: boolean;
  environment?: string;
  rules?: string;
};

export type SlackWorkspaceContext = {
  teamId?: string;
  teamName: string;
  homeFolder: string;
  channelId: string;
  place: SlackPlace;
  requester: SlackPerson;
  participants: SlackPerson[];
  repos?: SlackRepoContext[];
  currentRepo?: string;
  currentRepoSource?: "chosen" | "channel" | "only";
  noRepo?: boolean;
  channelRepo?: string;
  environment?: string;
};

const shortText = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() && value.length <= max
    ? value.trim()
    : null;

const parsePerson = (value: unknown): SlackPerson | null => {
  const record = (value ?? {}) as Record<string, unknown>;
  const id = shortText(record.id, 32);
  const name = shortText(record.name, 120);
  return id && name ? { id, name } : null;
};

const parsePlace = (value: unknown): SlackPlace | null => {
  const record = (value ?? {}) as Record<string, unknown>;
  if (record.kind === "dm" || record.kind === "group-dm")
    return { kind: record.kind };
  const name = shortText(record.name, 200);
  if (record.kind !== "channel" || !name) return null;
  return {
    kind: "channel",
    name,
    isPrivate: record.isPrivate === true,
    memberCount:
      typeof record.memberCount === "number" ? record.memberCount : null,
  };
};

export const parseSlackWorkspaceContext = (
  value: unknown,
): SlackWorkspaceContext | null => {
  const record = (value ?? {}) as Record<string, unknown>;
  const teamName = shortText(record.teamName, 200);
  const homeFolder = shortText(record.homeFolder, 200);
  const channelId = shortText(record.channelId, 32);
  const place = parsePlace(record.place);
  const requester = parsePerson(record.requester);
  if (!teamName || !homeFolder || !channelId || !place || !requester)
    return null;
  const participants = Array.isArray(record.participants)
    ? record.participants
        .map(parsePerson)
        .filter((person): person is SlackPerson => person !== null)
        .slice(0, 12)
    : [];
  const repos = Array.isArray(record.repos)
    ? record.repos
        .map((value): SlackRepoContext | null => {
          const entry = (value ?? {}) as Record<string, unknown>;
          const fullName = shortText(entry.fullName, 200);
          if (!fullName) return null;
          const environment = shortText(entry.environment, 3000);
          const rules = shortText(entry.rules, 4000);
          return {
            fullName,
            branch: shortText(entry.branch, 200) ?? "",
            push: entry.push === true,
            ...(environment ? { environment } : {}),
            ...(rules ? { rules } : {}),
          };
        })
        .filter((entry): entry is SlackRepoContext => entry !== null)
        .slice(0, 50)
    : [];
  const currentRepo = shortText(record.currentRepo, 200);
  const source = record.currentRepoSource;
  const currentRepoSource = source === "chosen" || source === "channel" || source === "only" ? source : undefined;
  const channelRepo = shortText(record.channelRepo, 200);
  const environment = shortText(record.environment, 3000);
  const teamId = shortText(record.teamId, 32);
  return {
    ...(teamId ? { teamId } : {}),
    teamName,
    homeFolder,
    channelId,
    place,
    requester,
    participants,
    ...(repos.length ? { repos } : {}),
    ...(currentRepo ? { currentRepo, ...(currentRepoSource ? { currentRepoSource } : {}) } : {}),
    ...(record.noRepo === true ? { noRepo: true } : {}),
    ...(channelRepo ? { channelRepo } : {}),
    ...(environment ? { environment } : {}),
  };
};

export const repoCheckout = (fullName: string): string => `${SLACK_REPO_ROOT}/${fullName.split("/")[1] ?? fullName}`;

const repoLine = (repo: SlackRepoContext): string =>
  [
    `- ${repo.fullName}: branch ${repo.branch || "(the default branch)"}; ${repo.push ? "agents can commit and push" : "agents can't push (no GitHub connection for it)"}.`,
    repo.environment ? `  Environment: ${repo.environment}` : "",
    repo.rules ? `  Rules for this repository:\n${repo.rules.split("\n").map((line) => `    ${line}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

const SOURCE_LABEL: Record<NonNullable<SlackWorkspaceContext["currentRepoSource"]>, string> = {
  chosen: "chosen earlier in this conversation",
  channel: "this channel's default",
  only: "the workspace's only repository",
};

const repositoryBlock = (context: SlackWorkspaceContext): string => {
  const repos = context.repos ?? [];
  if (!repos.length) return "Repositories: none connected";
  const current = context.currentRepo
    ? `This conversation works in ${context.currentRepo} (${SOURCE_LABEL[context.currentRepoSource ?? "chosen"]}): every agent you start has it cloned at ${repoCheckout(context.currentRepo)}, in its environment. It's the only one they can reach: the workspace's other repositories aren't cloned and can't be fetched from this thread.`
    : context.noRepo
      ? "This conversation works in no repository (chosen earlier): agents start without one."
      : "This conversation hasn't picked a repository yet. Agents you start get none until you pick one with slack_repo.";
  return [
    `Repositories (${repos.length}):`,
    ...repos.map(repoLine),
    ...(context.channelRepo ? [`This channel's default repository: ${context.channelRepo}`] : []),
    current,
  ].join("\n");
};

const NOTE_MAX_CHARS = 6_000;
const NOTE_LOAD_MAX_CHARS = 4_000;
const MAX_PEOPLE_NOTES = 6;
const SLACK_ID = /^[A-Z0-9]{2,32}$/u;

type NoteScope = "workspace" | "channel" | "person" | "dm";

export const rulesPath = (homeFolder: string): string =>
  `${homeFolder}/memories/rules.md`;

export const workspaceNotesPath = (homeFolder: string): string =>
  `${homeFolder}/memories/workspace.md`;

const notePath = (
  context: SlackWorkspaceContext,
  scope: NoteScope,
  person?: string,
): string => {
  const root = `${context.homeFolder}/memories`;
  if (scope === "workspace") return workspaceNotesPath(context.homeFolder);
  if (scope === "channel") return `${root}/channels/${context.channelId}.md`;
  return `${root}/${scope === "person" ? "people" : "dms"}/${person}.md`;
};

const isMissing = (error: unknown): boolean =>
  Boolean(
    error &&
      typeof error === "object" &&
      ((error as { code?: unknown }).code === "NOT_FOUND" ||
        /not in your drive/iu.test(String((error as { message?: unknown }).message))),
  );

const readNote = async (
  ownerInternal: OwnerInternalCall,
  path: string,
): Promise<string> => {
  try {
    const file = (await ownerInternal("drive.turnRead", {
      path,
      length: NOTE_MAX_CHARS * 4,
    })) as { bytes: Uint8Array };
    return new TextDecoder().decode(file.bytes).trim();
  } catch (error) {
    if (isMissing(error)) return "";
    throw error;
  }
};

const inert = (text: string): string => text.replace(/<!--/gu, "< !--");

const clipNote = (text: string): string =>
  text.length > NOTE_LOAD_MAX_CHARS
    ? `${text.slice(0, NOTE_LOAD_MAX_CHARS)}\n[…truncated; read the file for the rest]`
    : text;

const placeLabel = (place: SlackPlace): string => {
  if (place.kind === "dm") return "a 1:1 direct message";
  if (place.kind === "group-dm") return "a group direct message";
  return `${place.isPrivate ? "the private" : "the public"} channel #${place.name}`;
};

export const renderSlackSystemPrompt = async (
  context: SlackWorkspaceContext | null,
  ownerInternal: OwnerInternalCall,
): Promise<string> => {
  if (!context) return slackPrompt.trim();
  const people = [context.requester, ...context.participants]
    .filter(
      (person, index, all) =>
        SLACK_ID.test(person.id) &&
        all.findIndex((other) => other.id === person.id) === index,
    )
    .slice(0, MAX_PEOPLE_NOTES);
  const loads: Array<{ label: string; path: string }> = [
    { label: "Workspace notes", path: notePath(context, "workspace") },
  ];
  if (context.place.kind === "dm") {
    loads.push({
      label: `Notes for your DM with @${context.requester.name}`,
      path: notePath(context, "dm", context.requester.id),
    });
  } else {
    loads.push({
      label: `Notes for ${placeLabel(context.place)}`,
      path: notePath(context, "channel"),
    });
  }
  for (const person of people) {
    loads.push({
      label: `Notes about @${person.name} (${person.id})`,
      path: notePath(context, "person", person.id),
    });
  }
  const [rules, notes] = await Promise.all([
    readNote(ownerInternal, rulesPath(context.homeFolder)).catch(() => ""),
    Promise.all(
      loads.map(async (load) => ({
        ...load,
        text: await readNote(ownerInternal, load.path).catch(() => ""),
      })),
    ),
  ]);
  const noteBlocks = notes
    .filter((note) => note.text)
    .map((note) => `### ${note.label}\n${inert(clipNote(note.text))}`);
  const participants = context.participants.length
    ? context.participants
        .map((person) => `@${person.name} (${person.id})`)
        .join(", ")
    : "nobody else yet";
  const workspace = [
    `Workspace: ${context.teamName}`,
    `Home folder (Drive): ${context.homeFolder} — read files as drive/${context.homeFolder}/…`,
    `Where: ${placeLabel(context.place)} (channel id ${context.channelId})`,
    `Latest request from: @${context.requester.name} (${context.requester.id})`,
    `Others in this thread: ${participants}`,
    repositoryBlock(context),
    ...(context.environment ? [`Environment without a repository: ${context.environment}`] : []),
  ].join("\n");
  return [
    slackPrompt.trim(),
    `<workspace>\n${inert(workspace)}\n</workspace>`,
    `<workspace-rules>\n${rules ? inert(clipNote(rules)) : "No rules set."}\n</workspace-rules>`,
    `<workspace-notes>\n${noteBlocks.length ? noteBlocks.join("\n\n") : "No notes yet."}\n</workspace-notes>`,
  ].join("\n\n");
};

export const SLACK_CONNECTOR_SOURCE: CloudConnectorSource = {
  catalog: async () => [],
  actions: async () => null,
  connections: async () => ({ connections: [] }),
  run: async () => {
    throw new Error("No apps are connected in this Slack workspace.");
  },
};

export const slackSkillCatalog = (
  snapshot: CloudSkillCatalogSnapshot,
): CloudSkillCatalogSnapshot => ({
  ...snapshot,
  entries: snapshot.entries.filter(
    (entry) =>
      entry.source === "bundled" && entry.slug !== "create-stella-cloud-app",
  ),
});

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

const SLACK_MEMORY_PARAMETERS = Type.Object({
  action: Type.Union([Type.Literal("read"), Type.Literal("write")], {
    description: "read returns a notes file; write replaces it.",
  }),
  scope: Type.Union(
    [
      Type.Literal("workspace"),
      Type.Literal("channel"),
      Type.Literal("person"),
      Type.Literal("dm"),
    ],
    {
      description:
        "workspace: the whole workspace. channel: this channel or group DM. person: one person. dm: one person's 1:1 DM with you.",
    },
  ),
  person: Type.Optional(
    Type.String({
      description:
        "The person's Slack user id (like U0123ABCD), for scope person or dm.",
    }),
  ),
  content: Type.Optional(
    Type.String({
      description:
        "For write: the file's whole new content, short Markdown. Empty clears it.",
    }),
  ),
});

const failure = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: null,
  isError: true,
});

export const createSlackMemoryTool = (options: {
  turnId: string;
  ownerInternal: OwnerInternalCall;
  context: () => Promise<SlackWorkspaceContext | null>;
}): CloudCodeSourceAgentTool => ({
  name: SLACK_MEMORY_TOOL_NAME,
  label: "Notes",
  workingText: "Checking notes",
  description:
    "Read or rewrite the workspace's notes: workspace-wide, this channel's, one person's, or one person's DM. The notes that apply are already loaded in <workspace-notes>; read others only when needed. A write replaces the whole file, so include what should stay.",
  parameters: SLACK_MEMORY_PARAMETERS as unknown as TSchema,
  execute: async (toolCallId, params) => {
    const args = (params ?? {}) as Record<string, unknown>;
    const context = await options.context();
    if (!context) return failure("Notes are only available in Slack.");
    const scope = args.scope as NoteScope;
    if (!["workspace", "channel", "person", "dm"].includes(scope)) {
      return failure("scope must be workspace, channel, person or dm.");
    }
    let person: string | undefined;
    if (scope === "person" || scope === "dm") {
      person =
        typeof args.person === "string" && args.person.trim()
          ? args.person.trim().toUpperCase()
          : scope === "dm" && context.place.kind === "dm"
            ? context.requester.id
            : undefined;
      if (!person || !SLACK_ID.test(person)) {
        return failure("person must be a Slack user id like U0123ABCD.");
      }
    }
    const path = notePath(context, scope, person);
    if (args.action === "read") {
      const text = await readNote(options.ownerInternal, path);
      return {
        content: [{ type: "text" as const, text: text || "(no notes yet)" }],
        details: { path },
      };
    }
    if (args.action !== "write") return failure("action must be read or write.");
    const content = typeof args.content === "string" ? args.content.trim() : "";
    if (content.length > NOTE_MAX_CHARS) {
      return failure(
        `Notes are kept short: at most ${NOTE_MAX_CHARS} characters. Trim it to what matters.`,
      );
    }
    const bytes = new TextEncoder().encode(content ? `${content}\n` : "");
    const result = (await options.ownerInternal("drive.turnFiles", {
      turnId: options.turnId,
      hydratesDrive: false,
      source: "slack",
      batchKey: toolCallId,
      files: [
        {
          path,
          name: path.slice(path.lastIndexOf("/") + 1),
          sizeBytes: bytes.byteLength,
          contentType: "text/markdown; charset=utf-8",
          contentBase64: encodeBase64(bytes),
        },
      ],
    })) as DriveTurnFilesResult;
    if (!result.files.some((file) => file.stored)) {
      return failure(
        `The notes weren't saved: ${result.skipped[0]?.reason ?? "the drive did not store them."}`,
      );
    }
    return {
      content: [{ type: "text" as const, text: `Saved ${scope} notes.` }],
      details: { path },
    };
  },
});
