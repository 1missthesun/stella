import type { RpcResponse } from "@stella/contracts/backend/protocol";
import { sha256Hex } from "../hash.js";
import { crewSpaceForTeam } from "../owner-store/crew-scope.js";
import type { OwnerCrewScope } from "../owner-store/registry.js";
import { unwrapRpc } from "../owner-store/errors.js";
import { ownerGateStub } from "../rpc-release.js";
import { checkpointKey } from "../workspace.js";
import { isSlackConversationId } from "./conversation-id.js";

export type CrewPlace = Readonly<{ teamId: string; crew: OwnerCrewScope }>;

const SCOPE_CACHE_MS = 60_000;
const placeCache = new Map<string, { place: CrewPlace; at: number }>();

export const crewScopeForInstall = (install: { teamId: string; homeFolder: string }): OwnerCrewScope => ({
  space: crewSpaceForTeam(install.teamId),
  home: install.homeFolder,
});

export const crewPlaceForConversation = async (
  env: { DB?: D1Database },
  conversationId: string,
): Promise<CrewPlace> => {
  const cached = placeCache.get(conversationId);
  if (cached && Date.now() - cached.at < SCOPE_CACHE_MS) return cached.place;
  const row = env.DB
    ? await env.DB.prepare(
        `SELECT t.team_id AS team_id, i.home_folder AS home_folder
           FROM slack_threads t JOIN slack_installations i ON i.team_id = t.team_id
          WHERE t.conversation_id = ? LIMIT 1`,
      )
        .bind(conversationId)
        .first<{ team_id: string; home_folder: string | null }>()
    : null;
  if (!row?.home_folder) {
    const unplaced = `unplaced-${(await sha256Hex(conversationId)).slice(0, 32)}`;
    return { teamId: unplaced, crew: { space: crewSpaceForTeam(unplaced), home: "Slack/unplaced" } };
  }
  const place: CrewPlace = {
    teamId: row.team_id,
    crew: crewScopeForInstall({ teamId: row.team_id, homeFolder: row.home_folder }),
  };
  placeCache.set(conversationId, { place, at: Date.now() });
  if (placeCache.size > 2_000) placeCache.delete(placeCache.keys().next().value!);
  return place;
};

export const crewWorldName = async (ownerId: string, teamId: string): Promise<string> =>
  `${await sha256Hex(ownerId)}:${await sha256Hex(`crew:${teamId}:${await checkpointKey(ownerId)}`)}`;

export const conversationWorldName = async (
  env: { DB?: D1Database },
  ownerId: string,
  conversationId: string | undefined,
  ownerWorld: (ownerId: string) => Promise<string>,
): Promise<string> => {
  if (!conversationId || !isSlackConversationId(conversationId)) return await ownerWorld(ownerId);
  return await crewWorldName(ownerId, (await crewPlaceForConversation(env, conversationId)).teamId);
};

export const crewScopeForConversation = async (
  env: { DB?: D1Database },
  conversationId: string | undefined,
): Promise<OwnerCrewScope | undefined> =>
  conversationId && isSlackConversationId(conversationId)
    ? (await crewPlaceForConversation(env, conversationId)).crew
    : undefined;

export const ownerCallFor =
  (
    env: Pick<Cloudflare.Env, "OWNER_GATES">,
    ownerId: string,
    ownerGeneration: string | (() => Promise<string>),
    crew: OwnerCrewScope | undefined,
  ) =>
  async (name: string, args: unknown): Promise<unknown> =>
    unwrapRpc(
      (await ownerGateStub(env.OWNER_GATES, ownerId).ownerInternal({
        name,
        args,
        ownerGeneration: typeof ownerGeneration === "string" ? ownerGeneration : await ownerGeneration(),
        ...(crew ? { crew } : {}),
      })) as RpcResponse,
    );
