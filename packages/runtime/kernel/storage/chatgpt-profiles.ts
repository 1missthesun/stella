import fs from "fs";
import path from "path";
import {
  CHATGPT_UNUSABLE_REFRESH_CODES,
  ChatGptError,
  createChatGptHostId,
  hasChatGptPlanUsage,
  isChatGptHostId,
  type ChatGptProfileSummary,
  type ChatGptProfilesState,
  type ChatGptRegistration,
} from "@stella/contracts/chatgpt-siwc";
import {
  refreshChatGptTokens,
  revokeChatGptRefreshToken,
} from "@stella/contracts/chatgpt-siwc-flows";
import type { ChatGptSavedRegistration } from "../integrations/chatgpt-sign-in.js";
import { protectValue, unprotectValue } from "../shared/protected-storage.js";
import { writePrivateFileSync } from "../shared/private-fs.js";

const PROFILES_FILE = "chatgpt_profiles.json";
const SECRET_SCOPE = "chatgpt-profile";
const REFRESH_WINDOW_MS = 5 * 60_000;
const EXPIRY_MARGIN_MS = 60_000;

type StoredProfile = {
  id: string;
  label: string;
  clientId: string;
  subject?: string;
  email?: string;
  name?: string;
  status: ChatGptProfileSummary["status"];
  planUsage: boolean;
  secretsProtected?: string;
  createdAt: number;
  updatedAt: number;
};

type ProfileSecrets = {
  access: string;
  refresh: string;
  idToken: string;
  expiresAt: number;
  earliestRefreshAt?: number;
  scopes: string[];
};

type ProfilesFile = {
  version: 1;
  hostId: string;
  activeProfileId?: string;
  profiles: StoredProfile[];
};

const filePath = (stellaAppDir: string) => path.join(stellaAppDir, PROFILES_FILE);

const readFile = (stellaAppDir: string): ProfilesFile => {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(stellaAppDir), "utf-8")) as ProfilesFile;
    if (parsed?.version === 1 && isChatGptHostId(parsed.hostId) && Array.isArray(parsed.profiles)) {
      return {
        version: 1,
        hostId: parsed.hostId,
        ...(parsed.activeProfileId ? { activeProfileId: parsed.activeProfileId } : {}),
        profiles: parsed.profiles,
      };
    }
  } catch {
    // Missing or unreadable: a new host.
  }
  const fresh: ProfilesFile = {
    version: 1,
    hostId: createChatGptHostId(),
    profiles: [],
  };
  writeFile(stellaAppDir, fresh);
  return fresh;
};

const writeFile = (stellaAppDir: string, file: ProfilesFile): void => {
  const target = filePath(stellaAppDir);
  const temp = `${target}.${process.pid}.tmp`;
  writePrivateFileSync(temp, JSON.stringify(file, null, 2));
  fs.renameSync(temp, target);
};

const secretScope = (profileId: string) => `${SECRET_SCOPE}:${profileId}`;

const readSecrets = (profile: StoredProfile): ProfileSecrets | null => {
  if (!profile.secretsProtected) return null;
  try {
    const raw = unprotectValue(secretScope(profile.id), profile.secretsProtected);
    const parsed = raw ? (JSON.parse(raw) as ProfileSecrets) : null;
    return parsed && typeof parsed.access === "string" && typeof parsed.refresh === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
};

const protectSecrets = (profileId: string, secrets: ProfileSecrets): string =>
  protectValue(secretScope(profileId), JSON.stringify(secrets));

const isServable = (profile: StoredProfile): boolean =>
  profile.status === "signed_in" && profile.planUsage && Boolean(profile.secretsProtected);

const activeProfile = (file: ProfilesFile): StoredProfile | undefined => {
  const servable = file.profiles.filter(isServable);
  return servable.find((profile) => profile.id === file.activeProfileId) ?? servable[0];
};

const summary = (file: ProfilesFile, profile: StoredProfile): ChatGptProfileSummary => ({
  id: profile.id,
  label: profile.label,
  clientId: profile.clientId,
  ...(profile.email ? { email: profile.email } : {}),
  ...(profile.name ? { name: profile.name } : {}),
  active: activeProfile(file)?.id === profile.id,
  status: profile.status,
  planUsage: profile.planUsage,
  updatedAt: profile.updatedAt,
});

export const getChatGptHostId = (stellaAppDir: string): string => readFile(stellaAppDir).hostId;

export const listChatGptProfiles = (stellaAppDir: string): ChatGptProfilesState => {
  const file = readFile(stellaAppDir);
  return { profiles: file.profiles.map((profile) => summary(file, profile)) };
};

export const hasUsableChatGptProfile = (stellaAppDir: string): boolean =>
  Boolean(activeProfile(readFile(stellaAppDir)));

const findProfile = (file: ProfilesFile, profileId: string): StoredProfile => {
  const profile = file.profiles.find((entry) => entry.id === profileId);
  if (!profile) throw new Error("That ChatGPT account isn't saved on this computer anymore.");
  return profile;
};

export const savedChatGptRegistration = (
  stellaAppDir: string,
  profileId: string,
): ChatGptSavedRegistration => {
  const profile = findProfile(readFile(stellaAppDir), profileId);
  const idToken = readSecrets(profile)?.idToken;
  return {
    clientId: profile.clientId,
    ...(profile.subject ? { subject: profile.subject } : {}),
    ...(idToken && profile.status !== "signed_out" ? { idTokenHint: idToken } : {}),
    ...(profile.email ? { email: profile.email } : {}),
  };
};

export const chatGptProfileIdForClient = (stellaAppDir: string, clientId: string): string | null =>
  readFile(stellaAppDir).profiles.find((profile) => profile.clientId === clientId)?.id ?? null;

export const beginChatGptRegistration = (stellaAppDir: string, clientId: string): string => {
  const file = readFile(stellaAppDir);
  const existing = file.profiles.find((profile) => profile.clientId === clientId);
  if (existing) return existing.id;
  const now = Date.now();
  const id = crypto.randomUUID().replaceAll("-", "");
  file.profiles.push({
    id,
    label: "ChatGPT",
    clientId,
    status: "reauth_required",
    planUsage: false,
    createdAt: now,
    updatedAt: now,
  });
  writeFile(stellaAppDir, file);
  return id;
};

export const saveChatGptRegistration = (
  stellaAppDir: string,
  registration: ChatGptRegistration,
): ChatGptProfileSummary => {
  const file = readFile(stellaAppDir);
  const now = Date.now();
  let profile = file.profiles.find((entry) => entry.clientId === registration.clientId);
  if (!profile) {
    profile = {
      id: crypto.randomUUID().replaceAll("-", ""),
      label: "ChatGPT",
      clientId: registration.clientId,
      status: "signed_in",
      planUsage: false,
      createdAt: now,
      updatedAt: now,
    };
    file.profiles.push(profile);
  }
  profile.subject = registration.subject;
  profile.label = registration.email ?? registration.name ?? "ChatGPT";
  if (registration.email) profile.email = registration.email;
  if (registration.name) profile.name = registration.name;
  profile.status = "signed_in";
  profile.planUsage = registration.planUsage;
  profile.secretsProtected = protectSecrets(profile.id, {
    access: registration.tokens.access,
    refresh: registration.tokens.refresh,
    idToken: registration.idToken,
    expiresAt: registration.tokens.expiresAt,
    ...(registration.tokens.earliestRefreshAt !== undefined
      ? { earliestRefreshAt: registration.tokens.earliestRefreshAt }
      : {}),
    scopes: registration.tokens.scopes,
  });
  profile.updatedAt = now;
  if (registration.planUsage) file.activeProfileId = profile.id;
  writeFile(stellaAppDir, file);
  return summary(file, profile);
};

export const setActiveChatGptProfile = (stellaAppDir: string, profileId: string): void => {
  const file = readFile(stellaAppDir);
  const profile = findProfile(file, profileId);
  if (!isServable(profile)) throw new Error("Sign in to this ChatGPT account first.");
  file.activeProfileId = profile.id;
  writeFile(stellaAppDir, file);
};

const dropSecrets = (
  stellaAppDir: string,
  profileId: string,
  status: "signed_out" | "reauth_required",
  onlyIf?: string,
): void => {
  const file = readFile(stellaAppDir);
  const profile = file.profiles.find((entry) => entry.id === profileId);
  if (!profile || (onlyIf !== undefined && profile.secretsProtected !== onlyIf)) return;
  delete profile.secretsProtected;
  profile.status = status;
  profile.updatedAt = Date.now();
  writeFile(stellaAppDir, file);
};

export const signOutChatGptProfile = async (
  stellaAppDir: string,
  profileId: string,
): Promise<{ revoked: boolean }> => {
  const profile = findProfile(readFile(stellaAppDir), profileId);
  const secrets = readSecrets(profile);
  const revoked = secrets
    ? await revokeChatGptRefreshToken({ clientId: profile.clientId, refreshToken: secrets.refresh })
    : true;
  dropSecrets(stellaAppDir, profileId, "signed_out");
  return { revoked };
};

export const removeChatGptProfile = async (
  stellaAppDir: string,
  profileId: string,
): Promise<{ revoked: boolean }> => {
  const result = await signOutChatGptProfile(stellaAppDir, profileId);
  const file = readFile(stellaAppDir);
  file.profiles = file.profiles.filter((profile) => profile.id !== profileId);
  if (file.activeProfileId === profileId) delete file.activeProfileId;
  writeFile(stellaAppDir, file);
  return result;
};

const refreshing = new Map<string, Promise<string | null>>();

export const getChatGptAccessToken = async (
  stellaAppDir: string,
  options: { forceRefresh?: boolean } = {},
): Promise<string | null> => {
  const file = readFile(stellaAppDir);
  const now = Date.now();
  const profile = activeProfile(file);
  if (!profile) return null;
  const secrets = readSecrets(profile);
  if (!secrets) return null;
  const usable = secrets.expiresAt - EXPIRY_MARGIN_MS > now;
  const due =
    secrets.expiresAt - REFRESH_WINDOW_MS <= now &&
    (secrets.earliestRefreshAt === undefined || secrets.earliestRefreshAt <= now || !usable);
  if (usable && !due && !options.forceRefresh) return secrets.access;

  const pending = refreshing.get(profile.id);
  if (pending) return await pending;
  const stored = profile;
  const run = (async () => {
    try {
      const tokens = await refreshChatGptTokens({
        clientId: stored.clientId,
        refreshToken: secrets.refresh,
        scopes: secrets.scopes,
        subject: stored.subject ?? "",
      });
      const latest = readFile(stellaAppDir);
      const current = latest.profiles.find((entry) => entry.id === stored.id);
      if (!current || current.secretsProtected !== stored.secretsProtected) return null;
      current.secretsProtected = protectSecrets(current.id, {
        access: tokens.access,
        refresh: tokens.refresh,
        idToken: tokens.idToken ?? secrets.idToken,
        expiresAt: tokens.expiresAt,
        ...(tokens.earliestRefreshAt !== undefined
          ? { earliestRefreshAt: tokens.earliestRefreshAt }
          : {}),
        scopes: tokens.scopes,
      });
      current.planUsage = hasChatGptPlanUsage(tokens.scopes);
      current.updatedAt = Date.now();
      writeFile(stellaAppDir, latest);
      return tokens.access;
    } catch (error) {
      const unusable =
        error instanceof ChatGptError &&
        (CHATGPT_UNUSABLE_REFRESH_CODES.has(error.code) ||
          error.code === "invalid_client" ||
          error.code === "account_mismatch");
      if (unusable) {
        dropSecrets(stellaAppDir, stored.id, "reauth_required", stored.secretsProtected);
        return null;
      }
      return usable && !options.forceRefresh ? secrets.access : null;
    } finally {
      refreshing.delete(stored.id);
    }
  })();
  refreshing.set(profile.id, run);
  return await run;
};
