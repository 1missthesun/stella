import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import path from "node:path";
import { hostname } from "node:os";
import type { TokenProvider } from "@stella/contracts/backend/client";
import { leaseBackendClient, type BackendClientLease } from "@stella/contracts/backend/shared-client";
import type { SavedValuesState } from "@stella/contracts/backend/saved-values";
import {
  SAVED_VALUES_DEVICE_REFRESH_MS,
  SAVED_VALUE_IV_BYTES,
  SAVED_VALUE_KEY_BYTES,
  SAVED_VALUE_MAX_PAYLOAD_BYTES,
  SAVED_VALUE_PUBLIC_KEY_BYTES,
  SAVED_VALUE_SEAL_ALGORITHM,
  parseSavedValuePayload,
  savedValueSealAad,
  savedValueSealSalt,
  type SavedValueHead,
  type SavedValuePayload,
  type SavedValueSeal,
  type SavedValueSealBinding,
  type SavedValueReleaseLogEntry,
  type SavedValuesJoinRequest,
  type SavedValuesListedDevice,
  type SavedValuesSyncStatus,
} from "@stella/contracts/saved-values";
import {
  SAVED_VALUES_QUIET_MS,
  addToRoster,
  checkRoster,
  deletionValid,
  foundRoster,
  joinCode,
  joinCommit,
  onRoster,
  openEnvelope,
  removeFromRoster,
  savedValueRecipients,
  signDeletion,
  signedEnvelope,
  signingKeyFromSecret,
  type SavedValuesMember,
  type SavedValuesRoster,
  type SavedValuesRosterPin,
  type SavedValuesSigningKey,
  type SavedValuesJoin,
} from "@stella/contracts/saved-values-trust";
import { protectValue, unprotectValue } from "@stella/node-shared/shared/protected-storage";
import { readPrivateJsonValueSync, writePrivateFileSync } from "@stella/node-shared/shared/private-fs";
import type { SavedSecureValues, SavedValuesChange } from "./saved-secure-values.js";

const STATE_FILE = "saved-values-sync.json";
const PROTECT_SCOPE = "saved-values-sync";
const SPKI_X25519_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const PKCS8_SCOPE = `${PROTECT_SCOPE}:device-key`;
const SIGN_SCOPE = `${PROTECT_SCOPE}:sign-key`;
const RECONCILE_DEBOUNCE_MS = 1_500;
const RETRY_MS = 60_000;
const USER_CHECK_MS = 3_000;
const MAX_APPROVER_NAMES = 3;
const GET_BATCH = 50;

type SyncState = {
  v: 1;
  enabled: boolean;
  deviceId: string;
  publicKey: string;
  privateKeyProtected: string;
  ownerId?: string;
  synced: Record<string, number>;
  removed: Record<string, number>;
  owners: Record<string, string>;
  cardAt?: number;
  signSecretProtected?: string;
  pin?: SavedValuesRosterPin;
  joinPaused?: "declined" | "removed";
  askHidden?: boolean;
  ownJoin?: OwnJoin;
  signers?: Record<string, string>;
};


export type SavedValuesSyncOptions = {
  saved: SavedSecureValues;
  getDataDir: () => string | null;
  getDeviceId: () => string | null | undefined;
  getBackendUrl: () => string | null | undefined;
  getAuthToken: TokenProvider;
  log?: (event: string, detail?: Record<string, unknown>) => void;
  onSyncedChange?: () => void;
  onStatus?: (status: SavedValuesSyncStatus) => void;
  isUserActive?: () => boolean;
  getReleaseLog?: () => readonly SavedValueReleaseLogEntry[];
};

type OwnJoin = {
  joinId: string;
  nonce: string;
  commit: string;
  device: SavedValuesMember;
  startedAt: number;
  answer?: { by: string; name: string; listedNonce: string; pin: SavedValuesRosterPin };
  revealed?: boolean;
  confirmed?: boolean;
};

type Answered = Pick<SavedValuesJoin, "joinId" | "device" | "commit"> & {
  listedNonce: string;
  pin: SavedValuesRosterPin;
  at: number;
};

const ACTIVE_ANSWER_MS = 15 * 60_000;

const computerName = () =>
  hostname().trim().replace(/\.(local|localdomain|lan|home)$/i, "").slice(0, 120) || "Computer";

const toBase64Url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const fromBase64Url = (value: string) => Buffer.from(value, "base64url");
const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const rawPublicKey = (key: KeyObject): string =>
  toBase64Url(key.export({ type: "spki", format: "der" }).subarray(-SAVED_VALUE_PUBLIC_KEY_BYTES));

const publicKeyFromRaw = (raw: string): KeyObject => {
  const bytes = fromBase64Url(raw);
  if (bytes.length !== SAVED_VALUE_PUBLIC_KEY_BYTES) throw new Error("Malformed device key.");
  return createPublicKey({ key: Buffer.concat([SPKI_X25519_PREFIX, bytes]), format: "der", type: "spki" });
};

const sealKey = (shared: Buffer, binding: SavedValueSealBinding) => {
  const aad = savedValueSealAad(binding);
  const key = Buffer.from(
    hkdfSync("sha256", shared, savedValueSealSalt(sha256Hex(aad)), aad, SAVED_VALUE_KEY_BYTES),
  );
  return { aad, key };
};

export const sealSavedValue = (
  plaintext: string,
  recipientPublicKey: string,
  binding: SavedValueSealBinding,
): SavedValueSeal => {
  const ephemeral = generateKeyPairSync("x25519");
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: publicKeyFromRaw(recipientPublicKey) });
  const { aad, key } = sealKey(shared, binding);
  const iv = randomBytes(SAVED_VALUE_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  key.fill(0);
  return {
    algorithm: SAVED_VALUE_SEAL_ALGORITHM,
    clientPublicKey: rawPublicKey(ephemeral.publicKey),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(ciphertext),
  };
};

export const openSavedValue = (
  seal: SavedValueSeal,
  privateKey: KeyObject,
  binding: SavedValueSealBinding,
): string | null => {
  try {
    if (seal.algorithm !== SAVED_VALUE_SEAL_ALGORITHM) return null;
    const shared = diffieHellman({ privateKey, publicKey: publicKeyFromRaw(seal.clientPublicKey) });
    const { aad, key } = sealKey(shared, binding);
    const body = fromBase64Url(seal.ciphertext);
    const decipher = createDecipheriv("aes-256-gcm", key, fromBase64Url(seal.iv));
    decipher.setAAD(aad);
    decipher.setAuthTag(body.subarray(body.length - 16));
    const plaintext = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
    key.fill(0);
    return plaintext.toString("utf8");
  } catch {
    return null;
  }
};


const randomNonce = () => toBase64Url(randomBytes(32));

export class SavedValuesSync {
  private state: SyncState | null = null;
  private privateKey: KeyObject | null = null;
  private signing: SavedValuesSigningKey | null = null;
  private lease: { baseUrl: string; value: BackendClientLease } | null = null;
  private stopWatch: (() => void) | null = null;
  private latest: SavedValuesState | null = null;
  private roster: SavedValuesRoster | null = null;
  private answered = new Map<string, Answered>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setInterval> | null = null;
  private userCheck: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private status: SavedValuesSyncStatus = {
    enabled: true,
    active: false,
    standing: "off",
    devices: [],
    requests: [],
    records: 0,
    releases: [],
  };
  private readonly unsubscribe: () => void;

  constructor(private readonly options: SavedValuesSyncOptions) {
    this.unsubscribe = options.saved.onChange((change) => this.noteLocalChange(change));
  }

  private statePath(): string | null {
    const dir = this.options.getDataDir();
    return dir ? path.join(dir, STATE_FILE) : null;
  }

  private loadState(): SyncState | null {
    if (this.state) return this.state;
    const file = this.statePath();
    const deviceId = this.options.getDeviceId();
    if (!file || !deviceId) return null;
    let stored: Partial<SyncState> | undefined;
    try {
      stored = readPrivateJsonValueSync(file) as Partial<SyncState> | undefined;
    } catch {
      stored = undefined;
    }
    const privatePkcs8 =
      stored?.v === 1 && typeof stored.privateKeyProtected === "string"
        ? unprotectValue(PKCS8_SCOPE, stored.privateKeyProtected)
        : null;
    if (stored?.v === 1 && privatePkcs8 && stored.deviceId === deviceId && typeof stored.publicKey === "string") {
      this.privateKey = createPrivateKey({ key: Buffer.from(privatePkcs8, "base64"), format: "der", type: "pkcs8" });
      this.state = {
        v: 1,
        enabled: stored.enabled !== false,
        deviceId,
        publicKey: stored.publicKey,
        privateKeyProtected: stored.privateKeyProtected!,
        ...(typeof stored.ownerId === "string" ? { ownerId: stored.ownerId } : {}),
        synced: { ...(stored.synced ?? {}) },
        removed: { ...(stored.removed ?? {}) },
        owners: { ...(stored.owners ?? {}) },
        ...(typeof stored.cardAt === "number" ? { cardAt: stored.cardAt } : {}),
        ...(typeof stored.signSecretProtected === "string" ? { signSecretProtected: stored.signSecretProtected } : {}),
        ...(stored.pin ? { pin: stored.pin } : {}),
        ...(stored.joinPaused ? { joinPaused: stored.joinPaused } : {}),
        ...(stored.askHidden ? { askHidden: true } : {}),
        ...(stored.ownJoin ? { ownJoin: stored.ownJoin } : {}),
        signers: { ...(stored.signers ?? {}) },
      };
    } else {
      const pair = generateKeyPairSync("x25519");
      this.privateKey = pair.privateKey;
      this.state = {
        v: 1,
        enabled: stored?.enabled !== false,
        deviceId,
        publicKey: rawPublicKey(pair.publicKey),
        privateKeyProtected: protectValue(
          PKCS8_SCOPE,
          pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
        ),
        synced: {},
        removed: {},
        owners: { ...(stored?.owners ?? {}) },
        signers: {},
      };
    }
    const secret = this.state.signSecretProtected ? unprotectValue(SIGN_SCOPE, this.state.signSecretProtected) : null;
    if (secret) {
      this.signing = signingKeyFromSecret(new Uint8Array(Buffer.from(secret, "base64")));
    } else {
      const bytes = randomBytes(32);
      this.signing = signingKeyFromSecret(new Uint8Array(bytes));
      this.state.signSecretProtected = protectValue(SIGN_SCOPE, bytes.toString("base64"));
      delete this.state.pin;
      delete this.state.ownJoin;
    }
    this.saveState();
    return this.state;
  }

  private saveState() {
    const file = this.statePath();
    if (file && this.state) writePrivateFileSync(file, JSON.stringify(this.state, null, 2));
  }

  private self(): SavedValuesMember | null {
    const state = this.loadState();
    if (!state || !this.signing) return null;
    return {
      deviceId: state.deviceId,
      kind: "computer",
      name: computerName(),
      signKey: this.signing.publicKey,
      sealKey: state.publicKey,
    };
  }

  private client() {
    const baseUrl = this.options.getBackendUrl();
    if (!baseUrl) return null;
    if (this.lease?.baseUrl !== baseUrl) {
      this.stopWatch?.();
      this.stopWatch = null;
      this.lease?.value.release();
      this.lease = {
        baseUrl,
        value: leaseBackendClient({ baseUrl, getToken: (request) => this.options.getAuthToken(request) }),
      };
    }
    return this.lease.value.client;
  }

  start(): void {
    const state = this.loadState();
    this.setStatus({ enabled: state?.enabled !== false });
    if (!state?.enabled) return;
    const client = this.client();
    if (!client) return;
    if (!this.stopWatch) {
      this.stopWatch = client.watch(
        "savedValues.state",
        {},
        (value) => {
          this.latest = value;
          this.setStatus({ active: true, records: value.records.filter((head) => !head.deleted).length });
          this.schedule(0);
        },
        (error) => {
          this.stopWatch?.();
          this.stopWatch = null;
          this.setStatus({ active: false, error: error instanceof Error ? error.message : String(error) });
        },
      );
    }
    if (!this.retry) {
      this.retry = setInterval(() => {
        if (!this.stopWatch) this.start();
        else this.schedule(0);
      }, RETRY_MS);
      this.retry.unref?.();
    }
  }

  stop(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    if (this.retry) clearInterval(this.retry);
    this.retry = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stopWaitingForUser();
    this.setStatus({ active: false });
  }

  private waitForUser(): void {
    if (this.userCheck) return;
    this.userCheck = setInterval(() => {
      if (this.options.isUserActive?.() === false) return;
      this.stopWaitingForUser();
      this.schedule(0);
    }, USER_CHECK_MS);
    this.userCheck.unref?.();
  }

  private stopWaitingForUser(): void {
    if (this.userCheck) clearInterval(this.userCheck);
    this.userCheck = null;
  }

  noteAuthToken(token: string | null | undefined): void {
    this.lease?.value.noteAuthToken(token ?? null);
    if (token) this.start();
    else this.stop();
  }

  getStatus(): SavedValuesSyncStatus {
    const state = this.loadState();
    return {
      ...this.status,
      enabled: state?.enabled !== false,
      ...(state?.enabled === false ? { standing: "off" as const } : {}),
      releases: this.options.getReleaseLog?.() ?? [],
    };
  }

  private setStatus(patch: Partial<SavedValuesSyncStatus>) {
    this.status = { ...this.status, ...patch };
    this.options.onStatus?.(this.getStatus());
  }

  noteReleaseLogChanged(): void {
    this.options.onStatus?.(this.getStatus());
  }

  async setEnabled(enabled: boolean): Promise<SavedValuesSyncStatus> {
    const state = this.loadState();
    if (!state) return this.getStatus();
    state.enabled = enabled;
    if (!enabled) {
      state.cardAt = undefined;
      this.saveState();
      this.stop();
      await this.cancelOwnJoin();
      await this.client()?.call("savedValues.removeDevice", { deviceId: state.deviceId }).catch(() => undefined);
      this.latest = null;
      this.roster = null;
      this.setStatus({ enabled: false, active: false, standing: "off", devices: [], requests: [], records: 0 });
      return this.getStatus();
    }
    state.synced = {};
    this.saveState();
    this.start();
    return this.getStatus();
  }

  async decideJoin(joinId: string, allow: boolean): Promise<{ ok: boolean; error?: string }> {
    const state = this.loadState();
    const client = this.client();
    const answered = this.answered.get(joinId);
    const join = this.latest?.joins.find((candidate) => candidate.joinId === joinId);
    if (!state || !client || !this.signing || !this.roster || !answered || !join) {
      return { ok: false, error: "That request isn't there any more." };
    }
    if (!allow) {
      this.answered.delete(joinId);
      await client.call("savedValues.joinDecide", { joinId, by: state.deviceId, state: "declined" });
      this.schedule(0);
      return { ok: true };
    }
    if (!joinCode({ ...answered, joinerNonce: join.joinerNonce })) return { ok: false, error: "That request isn't ready yet." };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const fresh = this.latest ? checkRoster(this.latest.roster, state.pin) : null;
      if (!fresh?.ok) return { ok: false, error: "Stella couldn't check your devices." };
      try {
        if (!onRoster(fresh.roster, answered.device)) {
          await client.call("savedValues.rosterAppend", {
            entry: addToRoster({ roster: fresh.roster, device: answered.device, by: state.deviceId, key: this.signing, at: Date.now() }),
          });
        }
        await client.call("savedValues.joinDecide", { joinId, by: state.deviceId, state: "allowed" });
        this.answered.delete(joinId);
        this.schedule(0);
        return { ok: true };
      } catch (error) {
        if ((error as { code?: string })?.code !== "CONFLICT") throw error;
        await this.waitForListChange(fresh.roster.head.seq);
      }
    }
    return { ok: false, error: "Your devices kept changing. Try again." };
  }

  confirmJoin(): void {
    const state = this.loadState();
    if (!state?.ownJoin?.answer) return;
    state.ownJoin.confirmed = true;
    this.saveState();
    this.schedule(0);
  }

  async removeListedDevice(deviceId: string): Promise<{ ok: boolean; error?: string }> {
    const state = this.loadState();
    const client = this.client();
    if (!state || !client || !this.signing || !this.roster) return { ok: false, error: "Saved values aren't syncing here." };
    if (deviceId === state.deviceId) return { ok: false, error: "Turn sync off to stop this computer syncing." };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const fresh = this.latest ? checkRoster(this.latest.roster, state.pin) : null;
      if (!fresh?.ok) return { ok: false, error: "Stella couldn't check your devices' list." };
      if (!fresh.roster.members.has(deviceId)) return { ok: true };
      try {
        await client.call("savedValues.rosterAppend", {
          entry: removeFromRoster({ roster: fresh.roster, target: deviceId, by: state.deviceId, key: this.signing, at: Date.now() }),
        });
        this.schedule(0);
        return { ok: true };
      } catch (error) {
        if ((error as { code?: string })?.code !== "CONFLICT") throw error;
        await this.waitForListChange(fresh.roster.head.seq);
      }
    }
    return { ok: false, error: "Your devices' list kept changing. Try again." };
  }

  hideAsk(): void {
    const state = this.loadState();
    if (!state) return;
    state.askHidden = true;
    this.saveState();
    this.schedule(0);
  }

  askAgain(): void {
    const state = this.loadState();
    if (!state) return;
    delete state.joinPaused;
    delete state.askHidden;
    const old = state.ownJoin;
    delete state.ownJoin;
    this.saveState();
    if (old) void this.client()?.call("savedValues.joinCancel", { joinId: old.joinId }).catch(() => undefined);
    this.setStatus({ waiting: { code: null } });
    this.schedule(0);
  }

  async startOver(): Promise<{ ok: boolean; error?: string }> {
    const state = this.loadState();
    const client = this.client();
    const self = this.self();
    if (!state || !client || !self || !this.signing) return { ok: false, error: "Saved values aren't syncing here." };
    await this.cancelOwnJoin();
    await client.call("savedValues.rosterReset", {
      entry: foundRoster({ self, key: this.signing, at: Date.now() }),
    });
    delete state.pin;
    delete state.joinPaused;
    state.synced = {};
    this.saveState();
    this.schedule(0);
    return { ok: true };
  }

  dispose(): void {
    this.stop();
    this.unsubscribe();
    this.lease?.value.release();
    this.lease = null;
  }

  private async waitForListChange(seq: number) {
    for (let index = 0; index < 20; index += 1) {
      if ((this.latest?.roster.length ?? 0) - 1 > seq) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  private async cancelOwnJoin() {
    const state = this.loadState();
    const join = state?.ownJoin;
    if (!state || !join) return;
    delete state.ownJoin;
    this.saveState();
    await this.client()?.call("savedValues.joinCancel", { joinId: join.joinId }).catch(() => undefined);
  }

  private noteLocalChange(change: SavedValuesChange) {
    const state = this.loadState();
    if (!state?.enabled) return;
    if (change.kind === "removed") {
      for (const id of change.ids) state.removed[id] = change.at;
      this.saveState();
    }
    this.schedule(RECONCILE_DEBOUNCE_MS);
  }

  private schedule(delayMs: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.reconcile();
    }, delayMs);
    this.timer.unref?.();
  }

  private async reconcile(): Promise<void> {
    if (this.running) {
      this.again = true;
      return await this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        try {
          await this.reconcileOnce();
          this.setStatus({ lastSyncedAt: Date.now(), error: undefined });
        } catch (error) {
          this.setStatus({ error: error instanceof Error ? error.message : String(error) });
          this.options.log?.("saved_values_sync_failed", { error: this.status.error });
        }
      } while (this.again);
    })();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  private async reconcileOnce(): Promise<void> {
    const state = this.loadState();
    const client = this.client();
    const remote = this.latest;
    const self = this.self();
    if (!state?.enabled || !client || !remote || !this.privateKey || !this.signing || !self) return;
    const { ownerId } = await client.call("owner.identity", {});
    if (state.ownerId !== ownerId) {
      state.ownerId = ownerId;
      state.synced = {};
      state.cardAt = undefined;
      delete state.pin;
      delete state.joinPaused;
      delete state.askHidden;
      delete state.ownJoin;
      this.answered.clear();
      this.saveState();
    }
    const now = Date.now();
    const card = remote.devices.find((device) => device.deviceId === state.deviceId);
    if (!card || card.publicKey !== state.publicKey || !state.cardAt || now - state.cardAt > SAVED_VALUES_DEVICE_REFRESH_MS) {
      await client.call("savedValues.putDevice", {
        deviceId: state.deviceId,
        kind: "computer",
        publicKey: state.publicKey,
        name: self.name,
      });
      state.cardAt = now;
      this.saveState();
      if (!card || card.publicKey !== state.publicKey) return;
    }

    this.stopWaitingForUser();
    let check = checkRoster(remote.roster, state.pin);
    if (!check.ok && check.reason === "reset") {
      delete state.pin;
      this.saveState();
      this.roster = null;
      check = checkRoster(remote.roster);
    }
    if (!check.ok && check.reason === "empty") {
      await client
        .call("savedValues.rosterAppend", { entry: foundRoster({ self, key: this.signing, at: now }) })
        .catch((error: { code?: string }) => {
          if (error?.code !== "CONFLICT") throw error;
        });
      return;
    }
    if (!check.ok) {
      this.roster = null;
      this.setStatus({ standing: "problem", problem: check.reason as "rollback" | "fork" | "invalid", requests: [] });
      this.options.log?.("saved_values_list_refused", { reason: check.reason, detail: check.detail });
      return;
    }
    if (check.roster.members.size === 0) {
      await client.call("savedValues.rosterReset", { entry: foundRoster({ self, key: this.signing, at: now }) });
      delete state.pin;
      this.saveState();
      return;
    }
    const roster = check.roster;
    if (!this.accepted(state, roster, remote, self)) {
      this.roster = null;
      await this.notListed(state, roster, remote, self, now);
      return;
    }

    state.pin = roster.head;
    delete state.joinPaused;
    delete state.askHidden;
    if (state.ownJoin) {
      const finished = state.ownJoin.joinId;
      delete state.ownJoin;
      void client.call("savedValues.joinCancel", { joinId: finished }).catch(() => undefined);
    }
    this.roster = roster;
    this.saveState();
    await this.answerJoins(state, remote, roster, now);
    this.showListed(state, roster, remote, now);
    await this.syncRecords(state, roster, remote, ownerId, now);
  }

  private accepted(state: SyncState, roster: SavedValuesRoster, remote: SavedValuesState, self: SavedValuesMember): boolean {
    if (!onRoster(roster, self)) return false;
    if (state.pin) return true;
    const first = [...remote.roster].sort((left, right) => left.seq - right.seq)[0];
    if (first?.op === "found" && first.device.deviceId === self.deviceId && first.device.signKey === self.signKey) return true;
    const own = state.ownJoin;
    if (!own?.answer || !own.confirmed) return false;
    const join = remote.joins.find((candidate) => candidate.joinId === own.joinId);
    if (join && join.state !== "allowed") return false;
    return checkRoster(remote.roster, own.answer.pin).ok;
  }

  private async notListed(
    state: SyncState,
    roster: SavedValuesRoster,
    remote: SavedValuesState,
    self: SavedValuesMember,
    now: number,
  ) {
    const client = this.client()!;
    if (state.pin && roster.removed.has(state.deviceId)) {
      await this.forgetSynced(state);
      delete state.pin;
      delete state.ownJoin;
      state.joinPaused = "removed";
      this.saveState();
    }
    if (state.joinPaused) {
      this.setStatus({
        standing: "waiting",
        waiting: { code: null, ...(state.joinPaused === "removed" ? { removed: true } : { declined: true }) },
        devices: [],
        requests: [],
      });
      return;
    }
    const own = state.ownJoin;
    const live = own ? remote.joins.find((join) => join.joinId === own.joinId) : undefined;
    if (own && live?.state === "declined") {
      state.joinPaused = "declined";
      delete state.ownJoin;
      this.saveState();
      this.setStatus({ standing: "waiting", waiting: { code: null, declined: true }, devices: [], requests: [] });
      return;
    }
    if (!own || !live || live.expiresAt <= now) {
      if (own && live?.state !== "allowed") {
        delete state.ownJoin;
        this.saveState();
      }
      if (!state.ownJoin && this.options.isUserActive?.() === false) this.waitForUser();
      else if (!state.ownJoin) {
        const nonce = randomNonce();
        const joinId = `join-${randomBytes(12).toString("hex")}`;
        const commit = joinCommit(nonce);
        await client.call("savedValues.joinStart", { joinId, device: self, commit });
        state.ownJoin = { joinId, nonce, commit, device: self, startedAt: now };
        this.saveState();
      }
      this.setStatus({
        standing: "waiting",
        waiting: { code: null, ...this.asking(state, roster, remote, now) },
        devices: [],
        requests: [],
      });
      return;
    }
    if (!own.answer && live.answeredBy && live.listedNonce && live.pin) {
      own.answer = {
        by: live.answeredBy,
        name: live.answeredByName ?? roster.members.get(live.answeredBy)?.name ?? "",
        listedNonce: live.listedNonce,
        pin: live.pin,
      };
      this.saveState();
    }
    if (own.answer && !own.revealed) {
      await client.call("savedValues.joinReveal", { joinId: own.joinId, joinerNonce: own.nonce });
      own.revealed = true;
      this.saveState();
    }
    const code = own.answer
      ? joinCode({
          joinId: own.joinId,
          device: own.device,
          commit: own.commit,
          listedNonce: own.answer.listedNonce,
          joinerNonce: own.nonce,
          pin: own.answer.pin,
        })
      : null;
    this.setStatus({
      standing: "waiting",
      waiting: {
        code,
        ...this.asking(state, roster, remote, now),
        ...(own.answer ? { approver: own.answer.name } : {}),
        ...(own.confirmed ? { confirmed: true } : {}),
      },
      devices: [],
      requests: [],
    });
  }

  private asking(state: SyncState, roster: SavedValuesRoster, remote: SavedValuesState, now: number) {
    const others = [...roster.members.values()].filter((member) => member.deviceId !== state.deviceId);
    const seen = others.filter((member) => !this.isQuiet(member, remote, now));
    const names = new Set((seen.length > 0 ? seen : others).map((member) => member.name));
    return {
      approvers: [...names].slice(0, MAX_APPROVER_NAMES),
      ...(state.askHidden ? { hidden: true } : {}),
    };
  }

  private isQuiet(member: SavedValuesMember, remote: SavedValuesState, now: number): boolean {
    const card = remote.devices.find((device) => device.deviceId === member.deviceId);
    return !card || card.publicKey !== member.sealKey || now - card.updatedAt >= SAVED_VALUES_QUIET_MS;
  }

  private async answerJoins(state: SyncState, remote: SavedValuesState, roster: SavedValuesRoster, now: number) {
    const client = this.client()!;
    for (const [joinId, answered] of this.answered) {
      if (now - answered.at > ACTIVE_ANSWER_MS || !remote.joins.some((join) => join.joinId === joinId && join.state === "open")) {
        this.answered.delete(joinId);
      }
    }
    const unanswered = remote.joins.filter(
      (join) =>
        join.state === "open" && !join.listedNonce && join.device.deviceId !== state.deviceId && join.expiresAt > now,
    );
    if (unanswered.length === 0) return;
    if (this.options.isUserActive?.() === false) {
      this.waitForUser();
      return;
    }
    for (const join of unanswered) {
      const listedNonce = randomNonce();
      const answered: Answered = {
        joinId: join.joinId,
        device: join.device,
        commit: join.commit,
        listedNonce,
        pin: roster.head,
        at: now,
      };
      const result = await client
        .call("savedValues.joinAnswer", { joinId: join.joinId, by: state.deviceId, listedNonce, pin: roster.head })
        .catch(() => null);
      if (result?.answeredBy === state.deviceId && result.listedNonce === listedNonce) this.answered.set(join.joinId, answered);
    }
  }

  private showListed(state: SyncState, roster: SavedValuesRoster, remote: SavedValuesState, now: number) {
    const cards = new Map(remote.devices.map((device) => [device.deviceId, device]));
    const devices: SavedValuesListedDevice[] = [...roster.members.values()]
      .map((member) => {
        const card = cards.get(member.deviceId);
        const thisDevice = member.deviceId === state.deviceId;
        return {
          deviceId: member.deviceId,
          name: member.name,
          kind: member.kind,
          thisDevice,
          addedAt: member.addedAt,
          ...(card ? { lastSeenAt: card.updatedAt } : {}),
          quiet: !thisDevice && this.isQuiet(member, remote, now),
        };
      })
      .sort((left, right) => Number(right.thisDevice) - Number(left.thisDevice) || left.name.localeCompare(right.name) || left.addedAt - right.addedAt);
    const requests: SavedValuesJoinRequest[] = remote.joins.flatMap((join) => {
      const answered = this.answered.get(join.joinId);
      if (!answered || join.state !== "open" || join.expiresAt <= now) return [];
      const code = joinCode({ ...answered, joinerNonce: join.joinerNonce });
      return code
        ? [{ joinId: join.joinId, name: answered.device.name, kind: answered.device.kind, code, createdAt: join.createdAt }]
        : [];
    });
    this.setStatus({ standing: "member", waiting: undefined, problem: undefined, devices, requests });
  }

  private async forgetSynced(state: SyncState) {
    for (const id of Object.keys(state.synced)) {
      if (state.owners[id] === undefined || state.owners[id] === state.ownerId) {
        await this.options.saved.removeSynced(id);
      }
    }
    state.synced = {};
    state.removed = {};
    this.options.onSyncedChange?.();
  }

  private async syncRecords(
    state: SyncState,
    roster: SavedValuesRoster,
    remote: SavedValuesState,
    ownerId: string,
    now: number,
  ) {
    const client = this.client()!;
    const recipients = savedValueRecipients({ roster, devices: remote.devices, selfId: state.deviceId, now });
    const recipientIds = recipients.map((device) => device.deviceId);
    const heads = new Map(remote.records.map((head) => [head.id, head]));
    const local = new Map((await this.options.saved.heads()).map((head) => [head.id, head.updatedAt]));
    const signers = (state.signers ??= {});
    let changedHere = false;

    const toFetch: SavedValueHead[] = [];
    for (const head of heads.values()) {
      const mine = local.get(head.id);
      if (head.deleted) {
        const signed = deletionValid({ id: head.id, updatedAt: head.updatedAt, by: head.updatedBy, sig: head.deleteSig, roster });
        if (signed && mine !== undefined && mine <= head.updatedAt) {
          await this.options.saved.removeSynced(head.id);
          local.delete(head.id);
          delete signers[head.id];
          changedHere = true;
        }
        if (signed) {
          delete state.removed[head.id];
          state.synced[head.id] = head.updatedAt;
        }
        continue;
      }
      if ((mine === undefined || mine < head.updatedAt) && state.removed[head.id] === undefined) {
        if (head.recipients.includes(state.deviceId)) toFetch.push(head);
      }
    }
    for (let start = 0; start < toFetch.length; start += GET_BATCH) {
      const ids = toFetch.slice(start, start + GET_BATCH).map((head) => head.id);
      const { records } = await client.call("savedValues.get", { ids });
      for (const record of records) {
        const seal = record.sealed?.[state.deviceId];
        if (!seal || record.deleted) continue;
        const text = openSavedValue(seal, this.privateKey!, {
          recordId: record.id,
          recipientId: state.deviceId,
          updatedAt: record.updatedAt,
        });
        const inner = text ? openEnvelope(text, roster) : null;
        const payload = inner ? parseSavedValuePayload(inner) : null;
        if (!payload || payload.id !== record.id || payload.updatedAt !== record.updatedAt) {
          this.options.log?.("saved_values_sync_unreadable", { id: record.id });
          continue;
        }
        await this.options.saved.applySynced(payload);
        signers[record.id] = (JSON.parse(text!) as { by: string }).by;
        local.set(record.id, record.updatedAt);
        state.synced[record.id] = record.updatedAt;
        state.owners[record.id] = ownerId;
        changedHere = true;
      }
    }

    for (const [id, updatedAt] of local) {
      const signer = signers[id];
      if (!signer || signer === state.deviceId || roster.members.has(signer)) continue;
      if (state.owners[id] !== undefined && state.owners[id] !== ownerId) continue;
      const payload = await this.options.saved.payloadOf(id);
      if (!payload) continue;
      const bumped = Math.max(updatedAt, heads.get(id)?.updatedAt ?? 0) + 1;
      await this.options.saved.applySynced({ ...payload, updatedAt: bumped });
      local.set(id, bumped);
      signers[id] = state.deviceId;
    }

    for (const [id, at] of Object.entries(state.removed)) {
      const head = heads.get(id);
      if (head && (head.deleted || head.updatedAt > at)) {
        delete state.removed[id];
        continue;
      }
      if (!head && state.synced[id] === undefined) {
        delete state.removed[id];
        continue;
      }
      const updatedAt = Math.max(at, (head?.updatedAt ?? 0) + 1);
      const result = await client.call("savedValues.put", {
        id,
        updatedAt,
        updatedBy: state.deviceId,
        deleted: true,
        deleteSig: signDeletion({ id, updatedAt, key: this.signing! }),
      });
      delete state.removed[id];
      state.synced[id] = result.head.updatedAt;
    }
    for (const [id, updatedAt] of local) {
      const head = heads.get(id);
      const behind = !head || updatedAt > head.updatedAt;
      const narrow =
        head !== undefined &&
        !head.deleted &&
        head.updatedAt === updatedAt &&
        recipientIds.some((recipient) => !head.recipients.includes(recipient));
      if (!behind && !narrow) continue;
      if (head?.deleted && updatedAt <= head.updatedAt) continue;
      if (state.owners[id] !== undefined && state.owners[id] !== ownerId) continue;
      const payload = await this.options.saved.payloadOf(id);
      if (!payload) continue;
      const plaintext = JSON.stringify(payload);
      if (Buffer.byteLength(plaintext, "utf8") > SAVED_VALUE_MAX_PAYLOAD_BYTES) {
        this.options.log?.("saved_values_sync_too_large", { id });
        continue;
      }
      const envelope = signedEnvelope({ payload: plaintext, by: state.deviceId, key: this.signing! });
      const sealed: Record<string, SavedValueSeal> = {};
      for (const device of recipients) {
        try {
          sealed[device.deviceId] = sealSavedValue(envelope, device.sealKey, {
            recordId: id,
            recipientId: device.deviceId,
            updatedAt: payload.updatedAt,
          });
        } catch {}
      }
      if (Object.keys(sealed).length === 0) continue;
      const result = await client.call("savedValues.put", {
        id,
        updatedAt: payload.updatedAt,
        updatedBy: state.deviceId,
        sealed,
      });
      if (result.accepted) {
        state.synced[id] = payload.updatedAt;
        state.owners[id] = ownerId;
        signers[id] = state.deviceId;
      }
    }
    this.saveState();
    if (changedHere) this.options.onSyncedChange?.();
  }
}

export type { SavedValuePayload };
