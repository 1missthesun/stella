import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { USER_ASK_PUSH_CAPABILITY } from "@stella/contracts/user-ask-notification";
import {
  createGateHarness,
  withNow,
  type GateHarness,
} from "./helpers/owner-gate-harness.js";

mock.module("cloudflare:workers", () => ({
  DurableObject: class {},
  RpcTarget: class {},
  WorkerEntrypoint: class {},
}));
const { OwnerGate } = await import("../src/owner-gate.js");
const { verifyUserAskReplyRoute } = await import(
  "../src/user-asks/reply-route-signature.js"
);
mock.restore();

const NOW = Date.UTC(2026, 9, 10, 15, 0, 0);
const OWNER = "owner-1";

const caller = {
  ownerId: OWNER,
  subject: "user-1",
  sessionId: "session-1",
  isAnonymous: false,
  expiresAtMs: NOW + 3_600_000,
};

type ExpoMessage = Record<string, any>;

let sent: ExpoMessage[][] = [];
const realFetch = globalThis.fetch;
let harness: GateHarness;

const gate = () => harness.instance as any;

beforeEach(() => {
  sent = [];
  globalThis.fetch = (async (input: string | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://exp.host/")) {
      const body = JSON.parse(String(init?.body)) as ExpoMessage[];
      sent.push(body);
      return Response.json({ data: body.map(() => ({ status: "ok", id: "ticket" })) });
    }
    return realFetch(input as Request, init);
  }) as typeof fetch;
  harness = createGateHarness(OwnerGate);
  Object.assign(gate().env, {
    CLOUD_BUILDER_PUBLIC_URL: "https://backend.example",
    OAUTH_STATE_SECRET: "state-secret",
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  harness.close();
});

const registerPhone = (platform: "ios" | "android", capabilities: string[] = []) =>
  withNow(NOW, () =>
    gate().mobileRoute({
      route: "POST push-token",
      caller,
      query: {},
      headers: {},
      body: {
        token: `ExponentPushToken[${platform}]`,
        platform,
        mobileDeviceId: `phone-${platform}`,
        capabilities,
      },
    }),
  );

const ask = async (
  askId: string,
  detail: unknown,
  extra: Record<string, unknown> = {},
  at = NOW,
) => {
  const result = await withNow(at, () =>
    gate().userAskRoute({
      route: "POST ask",
      askId: "",
      caller,
      body: {
        askId,
        kind: (detail as { kind: string }).kind,
        conversationId: "conversation-1",
        threadId: "thread-1",
        toolCallId: `tool-${askId}`,
        agentLabel: "Muse TestFlight build",
        originDeviceId: "desktop-1",
        localMinuteOfDay: 12 * 60,
        detail,
        ...extra,
      },
    }),
  );
  expect(result.status).toBe(200);
  await withNow(at, () => gate().alarm());
  return JSON.parse(result.json).ask;
};

const question = {
  kind: "question",
  questions: [
    {
      id: "deploy",
      question: "Ship the build to TestFlight now?",
      options: [
        { id: "yes", label: "Ship it" },
        { id: "wait", label: "Wait until tonight" },
      ],
    },
  ],
};

const reply = (askId: string, body: Record<string, unknown>) =>
  withNow(NOW + 5_000, () => gate().userAskReply({ askId, body }));

describe("ask pushes", () => {
  test("a chat-urgency ask reaches the phone at once with its options as actions", async () => {
    await registerPhone("ios");
    await ask("ask-1", question);
    expect(sent).toHaveLength(1);
    const [message] = sent[0]!;
    expect(message.title).toBe("Muse TestFlight build needs you");
    expect(message.body).toBe("Ship the build to TestFlight now?");
    expect(message.mutableContent).toBe(true);
    expect(message.threadId).toBe("user_ask");
    expect(message.collapseId).toBe("user_ask:ask-1");
    expect(message.categoryId).toBe("user_ask");
    expect(message.sound).toBeUndefined();
    expect(message.data.actions.map((action: { id: string; title: string }) => [action.id, action.title])).toEqual([
      ["ask.o.0.0", "Ship it"],
      ["ask.o.0.1", "Wait until tonight"],
      ["ask.t.0", "Something else…"],
    ]);
    expect(message.data.replyUrl).toBe("https://backend.example/api/user-asks/ask-1/reply");
    expect(typeof message.data.replyToken).toBe("string");
  });

  test("a second ask inside a minute joins the stack quietly instead of alerting again", async () => {
    await registerPhone("ios");
    await ask("ask-1", question, { urgency: 3 });
    await ask("ask-2", question, { urgency: 3, toolCallId: "tool-ask-2" }, NOW + 20_000);
    expect(sent).toHaveLength(2);
    expect(sent[0]![0]!.sound).toBe("default");
    expect(sent[0]![0]!.interruptionLevel).toBe("time-sensitive");
    expect(sent[1]![0]!.sound).toBeUndefined();
    expect(sent[1]![0]!.interruptionLevel).toBe("passive");
    expect(sent[1]![0]!.threadId).toBe("user_ask");
  });

  test("the user's quiet hours still hold the push", async () => {
    await registerPhone("ios");
    await ask("ask-1", question, { localMinuteOfDay: 23 * 60 });
    expect(sent).toHaveLength(0);
  });

  test("a sensitive request only offers to open the secure card", async () => {
    await registerPhone("ios");
    await ask("ask-1", {
      kind: "secure_input",
      purpose: "Sign in to the airline",
      fields: [{ id: "password", label: "Password", type: "secret", sensitive: true }],
    }, {
      recipientKey: {
        algorithm: "x25519-hkdf-sha256-aes-256-gcm-v1",
        keyId: "key-1",
        publicKey: "AAAA",
      },
    });
    const [message] = sent[0]!;
    expect(message.body).toBe("Sign in to the airline");
    expect(message.data.actions).toEqual([
      { id: "ask.open", title: "Enter securely", foreground: true },
    ]);
  });

  test("an Android phone with the new build gets a data push it can draw with buttons; older builds keep the plain one", async () => {
    await registerPhone("android", [USER_ASK_PUSH_CAPABILITY]);
    await ask("ask-1", question);
    const [message] = sent[0]!;
    expect(message.title).toBeUndefined();
    expect(message.data.alertTitle).toBe("Muse TestFlight build needs you");
    expect(message.data.actions).toHaveLength(3);
    expect(message.tag).toBe("user_ask:ask-1");

    sent = [];
    await withNow(NOW, () =>
      gate().mobileRoute({
        route: "POST push-token",
        caller,
        query: {},
        headers: {},
        body: { token: "ExponentPushToken[android]", platform: "android", mobileDeviceId: "phone-android" },
      }),
    );
    await ask("ask-2", question, { toolCallId: "tool-ask-2" }, NOW + 120_000);
    const [legacy] = sent[0]!;
    expect(legacy.title).toBe("Muse TestFlight build needs you");
    expect(legacy.data.actions).toBeUndefined();
  });

  test("the desktop's later escalation does not repeat a push the phone already has", async () => {
    await registerPhone("ios");
    await ask("ask-1", question, { urgency: 3 });
    const escalated = await withNow(NOW + 180_000, () =>
      gate().userAskRoute({
        route: "POST escalate",
        askId: "ask-1",
        caller,
        body: { level: 3, deviceId: "desktop-1" },
      }),
    );
    expect(JSON.parse(escalated.json).reason).toBe("already_notified");
    expect(sent).toHaveLength(1);
  });
});

describe("answering from the notification", () => {
  const tokenOf = () => sent[0]![0]!.data.replyToken as string;

  test("a button answer lands exactly like an in-app answer", async () => {
    await registerPhone("ios");
    await ask("ask-1", question);
    const result = await reply("ask-1", { token: tokenOf(), action: "ask.o.0.1", deviceId: "phone-ios" });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.json)).toEqual({ accepted: true, state: "answered", label: "Wait until tonight" });
    const answer = await withNow(NOW + 6_000, () =>
      gate().userAskRoute({
        route: "GET answer",
        askId: "ask-1",
        caller,
        body: {},
        query: { deviceId: "desktop-1" },
      }),
    );
    expect(JSON.parse(answer.json).answer).toEqual({
      askId: "ask-1",
      revision: 1,
      kind: "questions",
      responses: [{ questionId: "deploy", kind: "option", choiceId: "wait" }],
      answeredOnDeviceId: "phone-ios",
    });
  });

  test("typed text that names an option picks it; anything else is the user's own answer", async () => {
    await registerPhone("ios");
    await ask("ask-1", question);
    const picked = await reply("ask-1", { token: tokenOf(), action: "ask.t.0", text: " ship it " });
    expect(JSON.parse(picked.json).label).toBe("Ship it");

    sent = [];
    await ask("ask-2", question, { toolCallId: "tool-ask-2" }, NOW + 120_000);
    const own = await withNow(NOW + 125_000, () =>
      gate().userAskReply({ askId: "ask-2", body: { token: sent[0]![0]!.data.replyToken, action: "ask.t.0", text: "Only after QA signs off" } }),
    );
    expect(JSON.parse(own.json)).toEqual({ accepted: true, state: "answered", label: "Only after QA signs off" });
  });

  test("a non-sensitive field takes a text reply", async () => {
    await registerPhone("ios");
    await ask("ask-1", {
      kind: "secure_input",
      purpose: "Where should the package go?",
      fields: [{ id: "address", label: "Delivery address", type: "text", sensitive: false }],
    });
    expect(sent[0]![0]!.data.actions[0].id).toBe("ask.f.0");
    const result = await reply("ask-1", { token: tokenOf(), action: "ask.f.0", text: "1 Infinite Loop" });
    expect(JSON.parse(result.json)).toEqual({ accepted: true, state: "answered", label: "1 Infinite Loop" });
  });

  test("a second reply after the ask closed is refused without changing the answer", async () => {
    await registerPhone("ios");
    await ask("ask-1", question);
    await reply("ask-1", { token: tokenOf(), action: "ask.o.0.0" });
    const again = await reply("ask-1", { token: tokenOf(), action: "ask.o.0.1" });
    expect(JSON.parse(again.json)).toEqual({ accepted: false, state: "answered" });
  });

  test("a wrong or foreign token is refused", async () => {
    await registerPhone("ios");
    await ask("ask-1", question);
    const token = tokenOf();
    const forged = `${token.slice(0, -4)}AAAA`;
    const result = await reply("ask-1", { token: forged, action: "ask.o.0.0" });
    expect(result.status).toBe(403);
    const [, owner, signature] = token.split(".");
    expect(await verifyUserAskReplyRoute(gate().env, atob(owner!.replace(/-/g, "+").replace(/_/g, "/")), signature!)).toBe(true);
    expect(await verifyUserAskReplyRoute(gate().env, "owner-2", signature!)).toBe(false);
  });
});
