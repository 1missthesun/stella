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
  savedValueRecipients,
  savedValueSealAad,
  savedValueSealSalt,
  type SavedValueHead,
  type SavedValuePayload,
  type SavedValueSeal,
  type SavedValueSealBinding,
  type SavedValuesSyncStatus,
} from "@stella/contracts/saved-values";
import { protectValue, unprotectValue } from "@stella/node-shared/shared/protected-storage";
import { readPrivateJsonValueSync, writePrivateFileSync } from "@stella/node-shared/shared/private-fs";
import type { SavedSecureValues, SavedValuesChange } from "./saved-secure-values.js";

/**
 * Keeps this computer's saved private values in step with the owner's other
 * devices. The local store stays the one tasks read; what syncs is each record
 * sealed separately to every device's own key, so Stella's cloud holds only
 * ciphertext. Off when signed out or when the user turns sync off: then the
 * values stay on this computer only.
 */

const STATE_FILE = "saved-values-sync.json";
const PROTECT_SCOPE = "saved-values-sync";
const SPKI_X25519_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const PKCS8_SCOPE = `${PROTECT_SCOPE}:device-key`;
const RECONCILE_DEBOUNCE_MS = 1_500;
const RETRY_MS = 60_000;
const GET_BATCH = 50;

type SyncState = {
  v: 1;
  /** Off only when the user turned it off; on by default. */
  enabled: boolean;
  deviceId: string;
  publicKey: string;
  privateKeyProtected: string;
  /** The owner this computer last synced with; a different one starts clean. */
  ownerId?: string;
  /** Per record, the version this computer and the cloud last agreed on. */
  synced: Record<string, number>;
  /** Records removed here that the cloud hasn't heard about yet. */
  removed: Record<string, number>;
  /** The account each record synced with: a record never moves to another account that signs in here. */
  owners: Record<string, string>;
  cardAt?: number;
};


export type SavedValuesSyncOptions = {
  saved: SavedSecureValues;
  getDataDir: () => string | null;
  getDeviceId: () => string | null | undefined;
  getBackendUrl: () => string | null | undefined;
  getAuthToken: () => Promise<string | null | undefined>;
  log?: (event: string, detail?: Record<string, unknown>) => void;
  /** Told when values on this computer changed because another device changed them. */
  onSyncedChange?: () => void;
};

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

/** Seals a record's payload to one recipient's key. */
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

/** Opens a seal addressed to this device; null when it isn't, or was altered. */
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

export class SavedValuesSync {
  private state: SyncState | null = null;
  private privateKey: KeyObject | null = null;
  private lease: { baseUrl: string; value: BackendClientLease } | null = null;
  private stopWatch: (() => void) | null = null;
  private latest: SavedValuesState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private status: SavedValuesSyncStatus = { enabled: true, active: false, devices: 0, records: 0 };
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
      };
      return this.state;
    }
    // A new key: this computer's first sync, or its identity changed.
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
    };
    this.saveState();
    return this.state;
  }

  private saveState() {
    const file = this.statePath();
    if (file && this.state) writePrivateFileSync(file, JSON.stringify(this.state, null, 2));
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
        value: leaseBackendClient({ baseUrl, getToken: async () => (await this.options.getAuthToken()) ?? null }),
      };
    }
    return this.lease.value.client;
  }

  /** Starts syncing when signed in and on; safe to call again (sign-in, wake). */
  start(): void {
    const state = this.loadState();
    this.status = { ...this.status, enabled: state?.enabled !== false };
    if (!state?.enabled) return;
    const client = this.client();
    if (!client) return;
    if (!this.stopWatch) {
      this.stopWatch = client.watch(
        "savedValues.state",
        {},
        (value) => {
          this.latest = value;
          this.status = { ...this.status, active: true, devices: value.devices.length, records: value.records.length };
          this.schedule(0);
        },
        (error) => {
          this.stopWatch?.();
          this.stopWatch = null;
          this.status = { ...this.status, active: false, error: error instanceof Error ? error.message : String(error) };
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
    this.status = { ...this.status, active: false };
  }

  noteAuthToken(token: string | null | undefined): void {
    this.lease?.value.noteAuthToken(token ?? null);
    if (token) this.start();
    else this.stop();
  }

  getStatus(): SavedValuesSyncStatus {
    const state = this.loadState();
    return { ...this.status, enabled: state?.enabled !== false };
  }

  /**
   * Sync on: this computer publishes its key and its values. Off: the cloud
   * stops sealing to this computer, and its values stay here only.
   */
  async setEnabled(enabled: boolean): Promise<SavedValuesSyncStatus> {
    const state = this.loadState();
    if (!state) return this.getStatus();
    state.enabled = enabled;
    if (!enabled) {
      state.cardAt = undefined;
      this.saveState();
      this.stop();
      await this.client()?.call("savedValues.removeDevice", { deviceId: state.deviceId }).catch(() => undefined);
      this.latest = null;
      return this.getStatus();
    }
    state.synced = {};
    this.saveState();
    this.start();
    return this.getStatus();
  }

  dispose(): void {
    this.stop();
    this.unsubscribe();
    this.lease?.value.release();
    this.lease = null;
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
          this.status = { ...this.status, lastSyncedAt: Date.now(), error: undefined };
        } catch (error) {
          this.status = { ...this.status, error: error instanceof Error ? error.message : String(error) };
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
    if (!state?.enabled || !client || !remote || !this.privateKey) return;
    const { ownerId } = await client.call("owner.identity", {});
    if (state.ownerId !== ownerId) {
      // Another account: what this computer agreed with the last one says nothing here.
      state.ownerId = ownerId;
      state.synced = {};
      state.cardAt = undefined;
      this.saveState();
    }
    const now = Date.now();
    const card = remote.devices.find((device) => device.deviceId === state.deviceId);
    if (!card || card.publicKey !== state.publicKey || !state.cardAt || now - state.cardAt > SAVED_VALUES_DEVICE_REFRESH_MS) {
      await client.call("savedValues.putDevice", {
        deviceId: state.deviceId,
        kind: "computer",
        publicKey: state.publicKey,
        name: hostname().trim().replace(/\.(local|localdomain|lan|home)$/i, "").slice(0, 120) || "Computer",
      });
      state.cardAt = now;
      this.saveState();
      // The new card arrives through the watch; sealing waits for it.
      if (!card || card.publicKey !== state.publicKey) return;
    }
    const recipients = savedValueRecipients(remote.devices, now);
    const recipientIds = recipients.map((device) => device.deviceId);
    const heads = new Map(remote.records.map((head) => [head.id, head]));
    const local = new Map((await this.options.saved.heads()).map((head) => [head.id, head.updatedAt]));
    let changedHere = false;

    // Take what other devices changed.
    const toFetch: SavedValueHead[] = [];
    for (const head of heads.values()) {
      const mine = local.get(head.id);
      if (head.deleted) {
        if (mine !== undefined && mine <= head.updatedAt) {
          await this.options.saved.removeSynced(head.id);
          local.delete(head.id);
          changedHere = true;
        }
        delete state.removed[head.id];
        state.synced[head.id] = head.updatedAt;
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
        const text = openSavedValue(seal, this.privateKey, {
          recordId: record.id,
          recipientId: state.deviceId,
          updatedAt: record.updatedAt,
        });
        const payload = text ? parseSavedValuePayload(text) : null;
        if (!payload || payload.id !== record.id || payload.updatedAt !== record.updatedAt) {
          this.options.log?.("saved_values_sync_unreadable", { id: record.id });
          continue;
        }
        await this.options.saved.applySynced(payload);
        local.set(record.id, record.updatedAt);
        state.synced[record.id] = record.updatedAt;
        state.owners[record.id] = ownerId;
        changedHere = true;
      }
    }

    // Send what changed here, and seal to devices that joined.
    for (const [id, at] of Object.entries(state.removed)) {
      const head = heads.get(id);
      if (head && (head.deleted || head.updatedAt > at)) {
        delete state.removed[id];
        continue;
      }
      if (!head && state.synced[id] === undefined) {
        // Never synced: nothing to remove in the cloud.
        delete state.removed[id];
        continue;
      }
      const result = await client.call("savedValues.put", {
        id,
        updatedAt: Math.max(at, (head?.updatedAt ?? 0) + 1),
        updatedBy: state.deviceId,
        deleted: true,
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
      const sealed: Record<string, SavedValueSeal> = {};
      for (const device of recipients) {
        try {
          sealed[device.deviceId] = sealSavedValue(plaintext, device.publicKey, {
            recordId: id,
            recipientId: device.deviceId,
            updatedAt: payload.updatedAt,
          });
        } catch {
          // A malformed card is skipped; the others still get the value.
        }
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
      }
    }
    this.saveState();
    if (changedHere) this.options.onSyncedChange?.();
  }
}

export type { SavedValuePayload };
