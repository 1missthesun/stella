import { describe, expect, mock, test } from "bun:test";
import {
  DEVICE_REQUEST_DEVICE_HEADERS,
  buildDeviceRequestChallenge,
  buildDeviceRequestDeviceProofMessage,
  deviceRequestParamsHash,
  type DeviceRequestMethod,
} from "@stella/contracts/turn-plane/device-requests";
import {
  mobilePairingProofHeaders,
  signMobilePairingProof,
} from "@stella/contracts/turn-plane/pairing-proof";
import { generateDeviceKey } from "./helpers/owner-gate-harness.js";

mock.module("cloudflare:workers", () => ({
  DurableObject: class {},
  RpcTarget: class {},
  WorkerEntrypoint: class {},
}));
const { handleDeviceRequestRoute } = await import(
  "../src/devices/device-request-route.js"
);
const { HEADER_DEVICE_REQUEST_MOBILE_ID } = await import(
  "../src/owner-gate/constants.js"
);
mock.restore();

/**
 * Who may ask one of the owner's computers for something. A phone reaches
 * the computer it was paired with for anything, and the owner's other
 * computers for files only; a computer reaches another for files only,
 * signed with its registered device key.
 */

const PAIRING_KEY = "a".repeat(64);
const MAC = "mac-device";
const OMARCHY = "omarchy-device";
const PHONE = "phone-1";

const caller = {
  ownerId: "owner-1",
  subject: "user-1",
  sessionId: "session-1",
  expiresAtMs: Date.now() + 60_000,
  issuer: "test",
  isAnonymous: false,
};

const setup = async () => {
  const mac = await generateDeviceKey(MAC);
  const omarchy = await generateDeviceKey(OMARCHY);
  const forwarded: Array<{ headers: Headers; body: string }> = [];
  const env = {
    OWNER_GATES: {
      getByName: () => ({
        snapshot: async () => ({
          devices: [
            { deviceId: MAC, publicKey: mac.publicKey, remoteExecutionEnabled: false },
            { deviceId: OMARCHY, publicKey: omarchy.publicKey, remoteExecutionEnabled: false },
          ],
          pairedDevices: [
            { mobileDeviceId: PHONE, desktopDeviceId: MAC, mobilePublicKey: PAIRING_KEY },
          ],
        }),
        fetch: async (_url: string, init: RequestInit) => {
          forwarded.push({
            headers: new Headers(init.headers),
            body: String(init.body),
          });
          return Response.json({ ok: true });
        },
      }),
    },
  };
  return { env, mac, omarchy, forwarded };
};

const phoneRequest = async (input: {
  target: string;
  method: DeviceRequestMethod;
  params: Record<string, unknown>;
  challengeTarget?: string;
}) => {
  const requestId = `dr:${crypto.randomUUID()}`;
  const paramsJson = JSON.stringify(input.params);
  const challenge = buildDeviceRequestChallenge({
    requestId,
    method: input.method,
    paramsHash: await deviceRequestParamsHash(paramsJson),
    ...(input.challengeTarget ? { targetDeviceId: input.challengeTarget } : {}),
  });
  const signed = await signMobilePairingProof({
    mobileDeviceId: PHONE,
    desktopDeviceId: MAC,
    challenge,
    pairingKey: PAIRING_KEY,
  });
  return new Request(`https://x/owners/me/devices/${input.target}/requests`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...mobilePairingProofHeaders({
        mobileDeviceId: PHONE,
        desktopDeviceId: MAC,
        challenge,
        ...signed,
      }),
    },
    body: JSON.stringify({ requestId, method: input.method, params: input.params }),
  });
};

const deviceRequest = async (input: {
  requester: Awaited<ReturnType<typeof generateDeviceKey>>;
  target: string;
  method: DeviceRequestMethod;
  params: Record<string, unknown>;
  signedTarget?: string;
}) => {
  const requestId = `peer:${crypto.randomUUID()}`;
  const paramsJson = JSON.stringify(input.params);
  const signedTarget = input.signedTarget ?? input.target;
  const issuedAt = Date.now();
  const signature = await input.requester.sign(
    buildDeviceRequestDeviceProofMessage({
      requesterDeviceId: input.requester.deviceId,
      targetDeviceId: signedTarget,
      challenge: buildDeviceRequestChallenge({
        requestId,
        method: input.method,
        paramsHash: await deviceRequestParamsHash(paramsJson),
        targetDeviceId: signedTarget,
      }),
      issuedAt,
    }),
  );
  return new Request(`https://x/owners/me/devices/${input.target}/requests`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [DEVICE_REQUEST_DEVICE_HEADERS.deviceId]: input.requester.deviceId,
      [DEVICE_REQUEST_DEVICE_HEADERS.signature]: signature,
      [DEVICE_REQUEST_DEVICE_HEADERS.issuedAt]: String(issuedAt),
    },
    body: JSON.stringify({ requestId, method: input.method, params: input.params }),
  });
};

const file = { filePath: "/home/alex/out/home.png", conversationId: "c1" };

describe("device request route", () => {
  test("a phone asks its paired computer as before", async () => {
    const { env, forwarded } = await setup();
    const response = await handleDeviceRequestRoute(
      await phoneRequest({ target: MAC, method: "voice.config", params: { conversationId: "c1" } }),
      env as never,
      MAC,
      caller,
    );
    expect(response.status).toBe(200);
    expect(forwarded[0]?.headers.get(HEADER_DEVICE_REQUEST_MOBILE_ID)).toBe(PHONE);
  });

  test("a phone reads a file from another of the owner's computers", async () => {
    const { env, forwarded } = await setup();
    const response = await handleDeviceRequestRoute(
      await phoneRequest({
        target: OMARCHY,
        method: "file.read",
        params: file,
        challengeTarget: OMARCHY,
      }),
      env as never,
      OMARCHY,
      caller,
    );
    expect(response.status).toBe(200);
    expect(forwarded).toHaveLength(1);
  });

  test("a phone's proof for one computer can't be replayed at another", async () => {
    const { env, forwarded } = await setup();
    const response = await handleDeviceRequestRoute(
      await phoneRequest({ target: OMARCHY, method: "file.read", params: file }),
      env as never,
      OMARCHY,
      caller,
    );
    expect(response.status).toBe(403);
    expect(forwarded).toHaveLength(0);
  });

  test("a phone can't reach another computer for anything but files", async () => {
    const { env, forwarded } = await setup();
    const response = await handleDeviceRequestRoute(
      await phoneRequest({
        target: OMARCHY,
        method: "voice.executeTool",
        params: { conversationId: "c1" },
        challengeTarget: OMARCHY,
      }),
      env as never,
      OMARCHY,
      caller,
    );
    expect(response.status).toBe(403);
    expect(forwarded).toHaveLength(0);
  });

  test("a computer reads a file from another, signed with its device key", async () => {
    const { env, mac, forwarded } = await setup();
    const response = await handleDeviceRequestRoute(
      await deviceRequest({ requester: mac, target: OMARCHY, method: "file.stat", params: file }),
      env as never,
      OMARCHY,
      caller,
    );
    expect(response.status).toBe(200);
    expect(forwarded[0]?.headers.get(HEADER_DEVICE_REQUEST_MOBILE_ID)).toBe(`device:${MAC}`);
  });

  test("a computer's signature for one target is refused at another", async () => {
    const { env, omarchy, forwarded } = await setup();
    const response = await handleDeviceRequestRoute(
      await deviceRequest({
        requester: omarchy,
        target: MAC,
        method: "file.read",
        params: file,
        signedTarget: "some-other-device",
      }),
      env as never,
      MAC,
      caller,
    );
    expect(response.status).toBe(403);
    expect(forwarded).toHaveLength(0);
  });

  test("a computer can't ask another for anything but files", async () => {
    const { env, mac, forwarded } = await setup();
    const response = await handleDeviceRequestRoute(
      await deviceRequest({
        requester: mac,
        target: OMARCHY,
        method: "voice.config",
        params: { conversationId: "c1" },
      }),
      env as never,
      OMARCHY,
      caller,
    );
    expect(response.status).toBe(403);
    expect(forwarded).toHaveLength(0);
  });

  test("a key the owner never registered is refused", async () => {
    const { env, forwarded } = await setup();
    const stranger = await generateDeviceKey("stranger");
    const response = await handleDeviceRequestRoute(
      await deviceRequest({ requester: stranger, target: OMARCHY, method: "file.read", params: file }),
      env as never,
      OMARCHY,
      caller,
    );
    expect(response.status).toBe(403);
    expect(forwarded).toHaveLength(0);
  });
});
