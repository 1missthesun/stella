import {
  CLOUD_BROWSER_HANDOFF_METHODS,
  CLOUD_BROWSER_METHODS,
} from "@stella/contracts/cloud-browser";
import type { CloudBrowserBridge } from "@stella/runtime/kernel/tools/types.js";
import {
  CLOUD_BROWSER_BROKER_PATH,
  type CloudBrowserBrokerRequest,
  type CloudBrowserBrokerResponse,
} from "./cloud-browser-broker-protocol.js";

type BrokerPost = (route: string, body: unknown) => Promise<Response>;

export type BrokerCloudBrowser = CloudBrowserBridge & {
  used(): boolean;
  checkpoint(): Promise<void>;
};

/**
 * The container agent's cloud browser: every command goes through the turn
 * broker to the Browser Gateway, and a sign-in handed to the user is waited
 * out here, one bounded broker request at a time.
 */
export const createBrokerCloudBrowser = (args: {
  post: BrokerPost;
  turnId: string;
}): BrokerCloudBrowser => {
  let used = false;
  const send = async (
    request: Omit<CloudBrowserBrokerRequest, "turnId"> & Record<string, unknown>,
  ): Promise<CloudBrowserBrokerResponse> => {
    const response = await args.post(CLOUD_BROWSER_BROKER_PATH, {
      ...request,
      turnId: args.turnId,
    });
    const body = (await response
      .json()
      .catch(() => null)) as CloudBrowserBrokerResponse | null;
    if (!response.ok || !body || typeof body.ok !== "boolean") {
      throw new Error(`The cloud browser is unavailable right now (${response.status}).`);
    }
    if (!body.ok) throw new Error(body.error);
    return body;
  };

  const waitForUser = async (
    interactionId: string,
    signal: AbortSignal,
  ): Promise<unknown> => {
    while (true) {
      if (signal.aborted) {
        await send({ op: "cancel", interactionId }).catch(() => undefined);
        throw new Error("The sign-in handoff was withdrawn.");
      }
      const answer = await send({ op: "wait", interactionId });
      if ("ended" in answer) return answer.ended;
      if (!("waiting" in answer)) {
        throw new Error("The cloud browser returned an invalid handoff state.");
      }
    }
  };

  return {
    methods: CLOUD_BROWSER_METHODS,
    awaitsUser: (method) => CLOUD_BROWSER_HANDOFF_METHODS.has(method),
    call: async (method, callArgs, signal) => {
      used = true;
      const answer = await send({ op: "call", method, args: [...callArgs] });
      if ("handoff" in answer) {
        return await waitForUser(answer.handoff.interactionId, signal);
      }
      if ("value" in answer) return answer.value;
      throw new Error("The cloud browser returned an invalid response.");
    },
    used: () => used,
    checkpoint: async () => {
      if (!used) return;
      await send({ op: "checkpoint" });
    },
  };
};
