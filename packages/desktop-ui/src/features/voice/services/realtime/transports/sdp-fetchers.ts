import {
  VOICE_LEASE_HEADER,
  VOICE_LIVE_SDP_PATH,
} from "@stella/contracts/backend/voice";
import { voiceBackendFetch } from "../../voice-backend";
import type { SdpAnswerFetcher } from "./types";

export const bearerSdpFetcher =
  (endpoint: string, bearerToken: string): SdpAnswerFetcher =>
  async (sdpOffer, signal) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/sdp",
      },
      body: sdpOffer,
      signal,
    });
    if (!response.ok) {
      throw new Error(`SDP negotiation failed: ${response.status}`);
    }
    return response.text();
  };

export const stellaProxiedSdpFetcher =
  (leaseId: string): SdpAnswerFetcher =>
  async (sdpOffer, signal) => {
    const response = await voiceBackendFetch(VOICE_LIVE_SDP_PATH, {
      body: sdpOffer,
      contentType: "application/sdp",
      headers: { [VOICE_LEASE_HEADER]: leaseId },
      signal,
    });
    return response.text();
  };
