import {
  DEVICE_REQUEST_DEVICE_HEADERS,
  DEVICE_REQUEST_DEVICE_PROOF_MAX_SKEW_MS,
  DEVICE_REQUEST_LIMITS,
  buildDeviceRequestChallenge,
  buildDeviceRequestDeviceProofMessage,
  deviceRequestParamsHash,
  deviceRequesterLabel,
  isDeviceClaudeLoginRequestMethod,
  isDeviceFileRequestMethod,
  isDeviceMcpRequestMethod,
  isDeviceRequestMethod,
  type DeviceRequestBody,
} from "@stella/contracts/turn-plane/device-requests";
import type { OwnerSnapshot } from "@stella/contracts/turn-plane/owner-snapshot";
import {
  MOBILE_PAIRING_HEADERS,
  verifyMobilePairingProof,
} from "@stella/contracts/turn-plane/pairing-proof";
import { verifyDevicePresenceProof } from "../owner-gate/presence.js";
import {
  HEADER_OWNER,
  HEADER_SESSION,
  HEADER_SUBJECT,
  HEADER_TOKEN_EXP,
} from "../conversation-types.js";
import { deviceRequestErrorResponse } from "../device-request-relay.js";
import {
  HEADER_DEVICE_REQUEST_ID,
  HEADER_DEVICE_REQUEST_METHOD,
  HEADER_DEVICE_REQUEST_MOBILE_ID,
  HEADER_PRESENCE_DEVICE_ID,
} from "../owner-gate.js";
import type { Env } from "../build-session/shared/env.js";
import { log } from "../build-session/shared/keys.js";
import type { ConversationCaller } from "../build-session/shared/types.js";
import { ownerGateStub } from "../rpc-release.js";

export const handleDeviceRequestRoute = async (
  request: Request,
  env: Env,
  deviceId: string,
  caller: ConversationCaller,
): Promise<Response> => {
  const text = await request.text();
  if (text.length > DEVICE_REQUEST_LIMITS.paramsBytes + 1024) {
    return deviceRequestErrorResponse("bad_request", "Request body is too large.");
  }
  let body: Partial<DeviceRequestBody>;
  try {
    body = JSON.parse(text) as Partial<DeviceRequestBody>;
  } catch {
    return deviceRequestErrorResponse("bad_request", "Malformed JSON request.");
  }
  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  const method = body.method;
  const params = body.params;
  if (
    !requestId ||
    requestId.length > DEVICE_REQUEST_LIMITS.requestId ||
    !/^[A-Za-z0-9._:-]+$/.test(requestId) ||
    !isDeviceRequestMethod(method) ||
    !params ||
    typeof params !== "object" ||
    Array.isArray(params)
  ) {
    return deviceRequestErrorResponse("bad_request", "Malformed device request.");
  }
  if (isDeviceMcpRequestMethod(method)) {
    return deviceRequestErrorResponse(
      "forbidden",
      "MCP servers on a computer are reached through Stella's agents, not directly.",
    );
  }
  if (isDeviceClaudeLoginRequestMethod(method)) {
    return deviceRequestErrorResponse(
      "forbidden",
      "Claude sign-ins on another computer go through Stella's account settings.",
    );
  }
  const paramsJson = JSON.stringify(params);
  if (paramsJson.length > DEVICE_REQUEST_LIMITS.paramsBytes) {
    return deviceRequestErrorResponse("bad_request", "Request params are too large.");
  }

  const gate = ownerGateStub(env.OWNER_GATES, caller.ownerId);
  let snapshot: OwnerSnapshot;
  try {
    snapshot = await gate.snapshot();
  } catch {
    return deviceRequestErrorResponse("failed", "Stella can't check your pairing right now. Try again shortly.");
  }
  const paramsHash = await deviceRequestParamsHash(paramsJson);
  const isOwnerComputer = (id: string) =>
    (snapshot.devices ?? []).some((candidate) => candidate.deviceId === id);

  let asker: string;
  const requesterDeviceId =
    request.headers.get(DEVICE_REQUEST_DEVICE_HEADERS.deviceId)?.trim() ?? "";
  if (requesterDeviceId) {
    const requester = (snapshot.devices ?? []).find(
      (candidate) => candidate.deviceId === requesterDeviceId,
    );
    const signature =
      request.headers.get(DEVICE_REQUEST_DEVICE_HEADERS.signature)?.trim() ?? "";
    const issuedAt = Number(
      request.headers.get(DEVICE_REQUEST_DEVICE_HEADERS.issuedAt)?.trim() ?? "",
    );
    const fresh =
      Number.isFinite(issuedAt) &&
      issuedAt > 0 &&
      Math.abs(Date.now() - issuedAt) <= DEVICE_REQUEST_DEVICE_PROOF_MAX_SKEW_MS;
    const verified =
      isDeviceFileRequestMethod(method) &&
      requesterDeviceId !== deviceId &&
      isOwnerComputer(deviceId) &&
      Boolean(requester) &&
      Boolean(signature) &&
      fresh &&
      (await verifyDevicePresenceProof({
        publicKey: requester!.publicKey,
        message: buildDeviceRequestDeviceProofMessage({
          requesterDeviceId,
          targetDeviceId: deviceId,
          challenge: buildDeviceRequestChallenge({
            requestId,
            method,
            paramsHash,
            targetDeviceId: deviceId,
          }),
          issuedAt,
        }),
        signature,
      }));
    if (!verified) {
      log("error", "device_request_proof_rejected", {
        ownerId: caller.ownerId,
        reason: "device_proof",
        registered: Boolean(requester),
      });
      return deviceRequestErrorResponse(
        "forbidden",
        "That computer can't be reached from this one.",
      );
    }
    asker = deviceRequesterLabel(requesterDeviceId);
  } else {
    const mobileDeviceId =
      request.headers.get(MOBILE_PAIRING_HEADERS.mobileDeviceId)?.trim() ?? "";
    const pairedDesktopId =
      request.headers.get(MOBILE_PAIRING_HEADERS.desktopDeviceId)?.trim() || deviceId;
    const crossDevice = pairedDesktopId !== deviceId;
    if (crossDevice && (!isDeviceFileRequestMethod(method) || !isOwnerComputer(deviceId))) {
      return deviceRequestErrorResponse(
        "forbidden",
        "This phone isn't connected to that computer. Connect it again in Settings.",
      );
    }
    const pairing = (snapshot.pairedDevices ?? []).find(
      (candidate) =>
        candidate.mobileDeviceId === mobileDeviceId &&
        candidate.desktopDeviceId === pairedDesktopId,
    );
    const verified = await verifyMobilePairingProof({
      headers: request.headers,
      pairingKey: pairing?.pairingKey,
      expectedChallenge: buildDeviceRequestChallenge({
        requestId,
        method,
        paramsHash,
        ...(crossDevice ? { targetDeviceId: deviceId } : {}),
      }),
    });
    if (!verified.ok || verified.desktopDeviceId !== pairedDesktopId) {
      log("error", "device_request_proof_rejected", {
        ownerId: caller.ownerId,
        reason: verified.ok ? "device_mismatch" : verified.reason,
        crossDevice,
      });
      return deviceRequestErrorResponse(
        "forbidden",
        "This phone isn't connected to that computer. Connect it again in Settings.",
      );
    }
    asker = verified.mobileDeviceId;
  }

  const headers = new Headers({ "content-type": "application/json" });
  headers.set(HEADER_OWNER, caller.ownerId);
  headers.set(HEADER_SUBJECT, caller.subject);
  if (caller.sessionId) headers.set(HEADER_SESSION, caller.sessionId);
  headers.set(HEADER_TOKEN_EXP, String(caller.expiresAtMs));
  headers.set(HEADER_PRESENCE_DEVICE_ID, deviceId);
  headers.set(HEADER_DEVICE_REQUEST_MOBILE_ID, asker);
  headers.set(HEADER_DEVICE_REQUEST_ID, requestId);
  headers.set(HEADER_DEVICE_REQUEST_METHOD, method);
  return await gate.fetch("https://owner-gate/device-request", {
    method: "POST",
    headers,
    body: paramsJson,
    signal: request.signal,
  });
};
