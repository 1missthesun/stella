import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import type { SavedValuesState } from "@stella/contracts/backend/saved-values";
import type { SavedValuesListedDevice } from "@stella/contracts/saved-values";
import {
  SAVED_VALUES_QUIET_MS,
  addToRoster,
  checkRoster,
  formatJoinCode,
  foundRoster,
  joinCode,
  joinCommit,
  onRoster,
  removeFromRoster,
  rosterEntryHash,
  toBase64Url,
  type SavedValuesJoin,
  type SavedValuesMember,
  type SavedValuesRoster,
  type SavedValuesRosterCheck,
  type SavedValuesRosterPin,
} from "@stella/contracts/saved-values-trust";
import { getBackendClient, readBackendView } from "./backend";
import {
  loadDeviceKeys,
  loadTrust,
  saveTrust,
  selfMember,
  type SavedValuesDeviceKeys,
  type SavedValuesStopped,
  type SavedValuesTrust,
} from "./saved-values-device";

/**
 * This phone's place on the user's list of devices that may hold saved
 * values: checking the list, asking to join it, and letting other devices
 * join. The rules are in `@stella/contracts/saved-values-trust`.
 *
 * Everything a code is made from stays in memory here: this phone's own
 * number, and the other device's request or answer exactly as it first
 * arrived. What the cloud says about a request later never changes a code.
 */

const NO_ARGS = {} as const;
const NONCE_BYTES = 32;
const RETRY_MS = 30_000;
const JOIN_RETRY_MS = 60_000;
const APPEND_ATTEMPTS = 4;
const WAKE_SLACK_MS = 1_000;
/** How long after an ask ended the user may still say the codes matched. */
const DECIDED_GRACE_MS = 5 * 60_000;

export type SavedValuesRequestView = Readonly<{
  joinId: string;
  name: string;
  kind: SavedValuesMember["kind"];
  code: string;
}>;

export type SavedValuesTrustView =
  | Readonly<{ standing: "off" }>
  | Readonly<{
      standing: "member";
      devices: readonly SavedValuesListedDevice[];
      requests: readonly SavedValuesRequestView[];
    }>
  | Readonly<{
      standing: "waiting";
      /** The code to compare, once another device answered. */
      code: string | null;
      /** The device that answered, which is where to allow this phone. */
      answeredBy: string | null;
      /** The user said here that the codes match; the other device hasn't allowed it yet. */
      confirmed: boolean;
      stopped: SavedValuesStopped | null;
    }>
  | Readonly<{
      standing: "problem";
      problem: "rollback" | "fork" | "invalid";
    }>;

type MyJoin = {
  joinId: string;
  device: SavedValuesMember;
  nonce: string;
  commit: string;
  expiresAt: number;
  /** The first answer that arrived, kept as it was. */
  answer: {
    byName: string;
    listedNonce: string;
    pin: SavedValuesRosterPin;
  } | null;
  revealed: boolean;
  /** The user said on this phone that the codes match. */
  confirmed: boolean;
  /** The other device allowed it. */
  allowed: boolean;
};

/** A request this phone answered, as it was then, with this phone's own number and pin. */
type MyAnswer = {
  join: SavedValuesJoin;
  nonce: string;
  pin: SavedValuesRosterPin;
  /** The other device's number, the first one that fits what it committed to. */
  joinerNonce: string | null;
};

const OFF: SavedValuesTrustView = { standing: "off" };

let ownerId: string | null = null;
let trust: SavedValuesTrust | null = null;
let state: SavedValuesState | null = null;
let roster: SavedValuesRoster | null = null;
let view: SavedValuesTrustView = OFF;
let myJoin: MyJoin | null = null;
const myAnswers = new Map<string, MyAnswer>();
let nextJoinAt = 0;
let session = 0;

const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

export const subscribeSavedValues = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const setView = (next: SavedValuesTrustView) => {
  if (JSON.stringify(next) === JSON.stringify(view)) return;
  view = next;
  notify();
};

export const useSavedValuesTrust = (): SavedValuesTrustView =>
  useSyncExternalStore(subscribeSavedValues, () => view);

export const savedValuesState = (): SavedValuesState | null => state;

/** Changes when the synced records or the list they're checked against change. */
export const savedValuesVersion = (): string =>
  state
    ? [
        roster?.head.hash ?? "",
        ...state.records.map((head) => `${head.id}:${head.updatedAt}`),
      ].join(",")
    : "";

// --- Checking the list ---------------------------------------------------------

let lastCheck: { key: string; result: SavedValuesRosterCheck } | null = null;

/** Checking means verifying every signature, so an unchanged list is checked once. */
const check = (
  entries: SavedValuesState["roster"],
  pin: SavedValuesRosterPin | null,
): SavedValuesRosterCheck => {
  const key = JSON.stringify([entries, pin]);
  if (lastCheck?.key === key) return lastCheck.result;
  const result = checkRoster(entries, pin);
  lastCheck = { key, result };
  return result;
};

const samePin = (
  left: SavedValuesRosterPin | null,
  right: SavedValuesRosterPin | null,
) => left?.genesis === right?.genesis && left?.seq === right?.seq && left?.hash === right?.hash;

const updateTrust = async (
  change: Partial<Pick<SavedValuesTrust, "pin" | "stopped">>,
): Promise<void> => {
  if (!trust) return;
  const next = { ...trust, ...change };
  if (samePin(next.pin, trust.pin) && next.stopped === trust.stopped) return;
  trust = next;
  await saveTrust(next);
};

const randomNonce = () => toBase64Url(Crypto.getRandomBytes(NONCE_BYTES));

const isConflict = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === "CONFLICT";

// --- Settling ------------------------------------------------------------------

let running: Promise<void> | null = null;
let again = false;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;

const wakeAt = (at: number) => {
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = setTimeout(
    () => {
      wakeTimer = null;
      void settle();
    },
    Math.max(0, at - Date.now()) + WAKE_SLACK_MS,
  );
};

/** Brings this phone in step with the list as the cloud shows it now. */
export const settle = (): Promise<void> => {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      try {
        await step();
      } catch {
        wakeAt(Date.now() + RETRY_MS);
      }
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
};

const acceptState = (next: SavedValuesState) => {
  state = next;
  notify();
  return settle();
};

const refresh = async (): Promise<void> => {
  const mine = session;
  const next = await readBackendView("savedValues.state", NO_ARGS);
  if (mine === session) state = next;
};

/** Called with each state the cloud pushes for the signed-in account. */
export const noteSavedValuesState = (
  owner: string,
  next: SavedValuesState,
): Promise<void> => {
  if (ownerId !== owner) {
    resetSavedValuesTrust();
    ownerId = owner;
  }
  return acceptState(next);
};

/** Forget everything held in memory for the account (sign-out, another account). */
export const resetSavedValuesTrust = () => {
  session += 1;
  ownerId = null;
  trust = null;
  state = null;
  roster = null;
  myJoin = null;
  myAnswers.clear();
  nextJoinAt = 0;
  lastCheck = null;
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = null;
  view = OFF;
  notify();
};

const step = async (): Promise<void> => {
  const mine = session;
  const owner = ownerId;
  if (!owner || !state) return;
  const keys = await loadDeviceKeys();
  trust ??= await loadTrust(owner);
  if (mine !== session) return;

  let checked = check(state.roster, trust.pin);
  if (!checked.ok && checked.reason === "rollback") {
    // A list this phone just added to can reach it late; look again before calling it a problem.
    await refresh();
    if (mine !== session || !state) return;
    checked = check(state.roster, trust.pin);
  }
  if (!checked.ok && checked.reason === "reset" && state.roster.length > 0) {
    // Another device started a new list, which this phone isn't on.
    await updateTrust({ pin: null });
    myAnswers.clear();
    checked = check(state.roster, null);
  }
  if (mine !== session || !state) return;
  if (!checked.ok) {
    roster = null;
    if (checked.reason === "empty" || checked.reason === "reset") {
      await startList(keys, "rosterAppend");
      return;
    }
    setView({ standing: "problem", problem: checked.reason });
    return;
  }

  const me = selfMember(keys);
  if (trust.pin && isSelfListed(checked.roster, me)) {
    await stayMember(checked.roster, keys);
    return;
  }
  if (trust.pin && !checked.roster.members.has(me.deviceId)) {
    await updateTrust({ pin: null, stopped: "removed" });
  }
  roster = null;
  myAnswers.clear();
  if (mine !== session || !state) return;
  if (checked.roster.members.size === 0) {
    // Every device left this list, so there is nobody to ask and nothing it guards.
    await startList(keys, "rosterReset");
    return;
  }
  await ask(checked.roster, me);
};

const isSelfListed = (list: SavedValuesRoster, me: SavedValuesMember) => {
  const listed = list.members.get(me.deviceId);
  return !!listed && onRoster(list, { ...me, name: listed.name });
};

const startList = async (
  keys: SavedValuesDeviceKeys,
  how: "rosterAppend" | "rosterReset",
): Promise<void> => {
  const entry = foundRoster({
    self: selfMember(keys),
    key: keys.signing,
    at: Date.now(),
  });
  const hash = rosterEntryHash(entry);
  const before = trust;
  // Remembered first: if the answer is lost, this phone still knows its own list.
  await updateTrust({
    pin: { genesis: hash, seq: 0, hash },
    stopped: null,
  });
  try {
    await getBackendClient().call(`savedValues.${how}`, { entry });
  } catch (error) {
    if (isConflict(error)) {
      await updateTrust({ pin: before?.pin ?? null, stopped: before?.stopped ?? null });
    }
    throw error;
  }
  myJoin = null;
  await refresh();
  again = true;
};

// --- On the list ---------------------------------------------------------------

const listedDevices = (
  list: SavedValuesRoster,
  deviceId: string,
  now: number,
): SavedValuesListedDevice[] => {
  const seen = new Map(
    (state?.devices ?? []).map((device) => [device.deviceId, device]),
  );
  return [...list.members.values()]
    .map((member) => {
      const card = seen.get(member.deviceId);
      const lastSeenAt = Math.max(card?.updatedAt ?? 0, member.addedAt);
      const thisDevice = member.deviceId === deviceId;
      return {
        deviceId: member.deviceId,
        name: member.name,
        kind: member.kind,
        thisDevice,
        lastSeenAt,
        quiet: !thisDevice && now - lastSeenAt >= SAVED_VALUES_QUIET_MS,
      };
    })
    .sort(
      (left, right) =>
        Number(right.thisDevice) - Number(left.thisDevice) ||
        left.name.localeCompare(right.name),
    );
};

const codeFor = (answer: MyAnswer): string | null =>
  answer.joinerNonce
    ? joinCode({
        joinId: answer.join.joinId,
        device: answer.join.device,
        commit: answer.join.commit,
        listedNonce: answer.nonce,
        pin: answer.pin,
        joinerNonce: answer.joinerNonce,
      })
    : null;

const openJoins = (deviceId: string, now: number): SavedValuesJoin[] =>
  (state?.joins ?? []).filter(
    (join) =>
      join.state === "open" &&
      join.expiresAt > now &&
      join.device.deviceId !== deviceId,
  );

const openRequests = (deviceId: string, now: number): SavedValuesRequestView[] => {
  const requests: SavedValuesRequestView[] = [];
  for (const join of openJoins(deviceId, now)) {
    const answer = myAnswers.get(join.joinId);
    // Answered on another device, or on this phone before it restarted: its code isn't this phone's to show.
    if (!answer) continue;
    if (
      !answer.joinerNonce &&
      join.joinerNonce &&
      joinCommit(join.joinerNonce) === answer.join.commit
    ) {
      answer.joinerNonce = join.joinerNonce;
    }
    const code = codeFor(answer);
    if (!code) continue;
    requests.push({
      joinId: answer.join.joinId,
      name: answer.join.device.name,
      kind: answer.join.device.kind,
      code: formatJoinCode(code),
    });
  }
  return requests;
};

/**
 * While Stella is open here, this phone adds its own number to a request
 * nobody has answered, which makes it the device that shows the code.
 */
const answerJoins = async (
  open: readonly SavedValuesJoin[],
  list: SavedValuesRoster,
  keys: SavedValuesDeviceKeys,
): Promise<void> => {
  if (!appIsOpen()) return;
  for (const join of open) {
    if (join.listedNonce || myAnswers.has(join.joinId)) continue;
    const answer: MyAnswer = {
      join,
      nonce: randomNonce(),
      pin: list.head,
      joinerNonce: null,
    };
    myAnswers.set(join.joinId, answer);
    try {
      const result = await getBackendClient().call("savedValues.joinAnswer", {
        joinId: join.joinId,
        by: keys.deviceId,
        listedNonce: answer.nonce,
        pin: answer.pin,
      });
      // Another device answered first: the code is on that one.
      if (result.listedNonce !== answer.nonce) myAnswers.delete(join.joinId);
    } catch (error) {
      myAnswers.delete(join.joinId);
      throw error;
    }
  }
};

const stayMember = async (
  list: SavedValuesRoster,
  keys: SavedValuesDeviceKeys,
): Promise<void> => {
  await updateTrust({ pin: list.head, stopped: null });
  myJoin = null;
  const grew = roster?.head.hash !== list.head.hash;
  roster = list;
  const now = Date.now();
  const requests = openRequests(keys.deviceId, now);
  const open = openJoins(keys.deviceId, now);
  for (const joinId of myAnswers.keys()) {
    if (!open.some((join) => join.joinId === joinId)) myAnswers.delete(joinId);
  }
  const ends = open.map((join) => join.expiresAt);
  if (ends.length > 0) wakeAt(Math.min(...ends));
  setView({
    standing: "member",
    devices: listedDevices(list, keys.deviceId, now),
    requests,
  });
  if (grew) notify();
  await answerJoins(open, list, keys);
};

/** This phone's keys and the list it checked, while it is on it. */
export const savedValuesMembership = async (): Promise<{
  keys: SavedValuesDeviceKeys;
  roster: SavedValuesRoster;
  state: SavedValuesState;
} | null> => {
  if (running) await running;
  if (!roster || !state) return null;
  const held = { roster, state };
  return { keys: await loadDeviceKeys(), ...held };
};

const append = async (
  make: (list: SavedValuesRoster, keys: SavedValuesDeviceKeys) => ReturnType<typeof addToRoster> | null,
): Promise<void> => {
  for (let attempt = 1; ; attempt += 1) {
    await refresh();
    await settle();
    const membership = await savedValuesMembership();
    if (!membership) throw new Error("This phone isn’t on your devices’ list.");
    const entry = make(membership.roster, membership.keys);
    if (!entry) return;
    try {
      await getBackendClient().call("savedValues.rosterAppend", { entry });
      await refresh();
      await settle();
      return;
    } catch (error) {
      if (!isConflict(error) || attempt >= APPEND_ATTEMPTS) throw error;
    }
  }
};

/** The user saw the same code on both and allowed it. */
export const allowSavedValuesJoin = async (joinId: string): Promise<void> => {
  const answer = myAnswers.get(joinId);
  if (!answer || !codeFor(answer)) return;
  const { device } = answer.join;
  await append((list, keys) =>
    onRoster(list, device) && list.members.get(device.deviceId)?.name === device.name
      ? null
      : addToRoster({
          roster: list,
          device,
          by: keys.deviceId,
          key: keys.signing,
          at: Date.now(),
        }),
  );
  await decide(joinId, "allowed").catch(() => decide(joinId, "allowed"));
};

export const declineSavedValuesJoin = (joinId: string): Promise<void> =>
  decide(joinId, "declined");

const decide = async (
  joinId: string,
  decision: "allowed" | "declined",
): Promise<void> => {
  const { deviceId } = await loadDeviceKeys();
  await getBackendClient().call("savedValues.joinDecide", {
    joinId,
    by: deviceId,
    state: decision,
  });
  myAnswers.delete(joinId);
  await refresh().catch(() => undefined);
  await settle();
};

export const removeFromSavedValues = (target: string): Promise<void> =>
  append((list, keys) =>
    list.members.has(target)
      ? removeFromRoster({
          roster: list,
          target,
          by: keys.deviceId,
          key: keys.signing,
          at: Date.now(),
        })
      : null,
  );

// --- Asking to join ------------------------------------------------------------

const appIsOpen = () => AppState.currentState === "active";

AppState.addEventListener("change", (next) => {
  if (next === "active" && ownerId) void settle();
});

const ask = async (
  list: SavedValuesRoster,
  me: SavedValuesMember,
): Promise<void> => {
  const mine = session;
  const now = Date.now();
  if (myJoin && now >= myJoin.expiresAt + (myJoin.answer ? DECIDED_GRACE_MS : 0)) {
    myJoin = null;
  }
  const posted = myJoin
    ? state?.joins.find((join) => join.joinId === myJoin?.joinId)
    : undefined;

  if (myJoin && posted?.state === "declined") {
    myJoin = null;
    await updateTrust({ stopped: "declined" });
  }
  if (myJoin && !myJoin.answer && posted?.listedNonce && posted.pin) {
    myJoin.answer = {
      byName:
        posted.answeredByName ??
        list.members.get(posted.answeredBy ?? "")?.name ??
        "",
      listedNonce: posted.listedNonce,
      pin: posted.pin,
    };
  }
  if (myJoin && posted?.state === "allowed") myJoin.allowed = true;
  if (myJoin?.answer && !myJoin.revealed) {
    const join = myJoin;
    await getBackendClient().call("savedValues.joinReveal", {
      joinId: join.joinId,
      joinerNonce: join.nonce,
    });
    join.revealed = true;
    if (mine !== session) return;
  }
  if (myJoin?.answer && myJoin.confirmed && myJoin.allowed && state) {
    // The list is the real one only if it continues from what the other device put in the code.
    const real = check(state.roster, myJoin.answer.pin);
    if (real.ok && isSelfListed(real.roster, me)) {
      await updateTrust({ pin: real.roster.head, stopped: null });
      again = true;
      return;
    }
    if (!real.ok && real.reason !== "rollback") {
      setView({
        standing: "problem",
        problem: real.reason === "fork" ? "fork" : "invalid",
      });
      return;
    }
  }

  if (!myJoin && !trust?.stopped && appIsOpen() && now >= nextJoinAt) {
    const nonce = randomNonce();
    const started: MyJoin = {
      joinId: Crypto.randomUUID(),
      device: me,
      nonce,
      commit: joinCommit(nonce),
      expiresAt: 0,
      answer: null,
      revealed: false,
      confirmed: false,
      allowed: false,
    };
    nextJoinAt = now + JOIN_RETRY_MS;
    const join = await getBackendClient().call("savedValues.joinStart", {
      joinId: started.joinId,
      device: started.device,
      commit: started.commit,
    });
    if (mine !== session) return;
    started.expiresAt = join.expiresAt;
    myJoin = started;
  }
  if (myJoin) wakeAt(Math.max(myJoin.expiresAt, now));

  const code =
    myJoin?.answer && myJoin.revealed
      ? joinCode({
          joinId: myJoin.joinId,
          device: myJoin.device,
          commit: myJoin.commit,
          listedNonce: myJoin.answer.listedNonce,
          pin: myJoin.answer.pin,
          joinerNonce: myJoin.nonce,
        })
      : null;
  setView({
    standing: "waiting",
    code: code ? formatJoinCode(code) : null,
    answeredBy: myJoin?.answer?.byName || null,
    confirmed: myJoin?.confirmed ?? false,
    stopped: trust?.stopped ?? null,
  });
};

/** The user saw the same code on both, here. */
export const confirmSavedValuesCode = (): Promise<void> => {
  if (myJoin?.answer && myJoin.revealed) myJoin.confirmed = true;
  return settle();
};

/** A fresh ask: after a decline or a removal, or to allow this phone on another device. */
export const askSavedValuesAgain = async (): Promise<void> => {
  await updateTrust({ stopped: null });
  nextJoinAt = 0;
  myJoin = null;
  await settle();
};

/** None of the devices can allow this phone: a new list with only this phone on it. */
export const startSavedValuesOver = async (): Promise<void> => {
  if (running) await running;
  if (!ownerId) return;
  trust ??= await loadTrust(ownerId);
  await startList(await loadDeviceKeys(), "rosterReset");
  await settle();
};
