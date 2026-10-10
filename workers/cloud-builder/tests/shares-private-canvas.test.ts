import { describe, expect, test } from "bun:test";
import { openSqlStorageFake } from "./fixtures/sql-storage.js";
import { RATE_LIMIT_MIGRATION } from "../src/owner-store/rate-limit.js";
import {
  createOwnerRegistry,
  type OwnerCaller,
  type OwnerDomain,
} from "../src/owner-store/registry.js";
import { OwnerStore } from "../src/owner-store/store.js";
import { sharesDomain } from "../src/owner-store/domains/shares.js";
import {
  canvasOwnerTag,
  verifyCanvasViewToken,
} from "../../shared/canvas-view-grant.js";

const SECRET = "test-view-secret";

const callerFor = (ownerId: string): OwnerCaller => ({
  ownerId,
  subject: ownerId,
  sessionId: `session-${ownerId}`,
  isAnonymous: false,
  expiresAtMs: Date.now() + 30 * 60_000,
});

type Put = { key: string; customMetadata?: Record<string, string> };

const createHarness = (ownerId: string, env: Record<string, unknown>, puts: Put[]) => {
  const fake = openSqlStorageFake();
  const bucket = {
    put: async (key: string, _body: unknown, options?: { customMetadata?: Record<string, string> }) => {
      puts.push({ key, customMetadata: options?.customMetadata });
    },
    get: async () => null,
    delete: async () => {},
  };
  const store = new OwnerStore({
    ctx: {
      storage: { sql: fake.sql, transactionSync: <T>(fn: () => T) => fn() },
      getWebSockets: () => [],
    } as unknown as DurableObjectState,
    env: {
      CANVAS_SHARES: bucket,
      CANVAS_SHARE_BASE_URL: "https://stellashare.app",
      CANVAS_SHARE_VIEW_SECRET: SECRET,
      ...env,
    } as unknown as Cloudflare.Env,
    ownerId: () => ownerId,
    registry: createOwnerRegistry([
      { name: "system", migrations: [RATE_LIMIT_MIGRATION] } as OwnerDomain,
      sharesDomain,
    ]),
    host: {
      snapshot: async () => {
        throw new Error("no snapshot in tests");
      },
    },
    verifyToken: async () => null,
  });
  const caller = callerFor(ownerId);
  return {
    call: async (name: string, args: unknown) => {
      const response: any = await store.call(name, args, caller);
      return response.ok ? { value: response.value } : { error: response.error };
    },
  };
};

describe("private canvas links", () => {
  test("a saved canvas names its owner and the site the owner signs in through", async () => {
    const puts: Put[] = [];
    const owner = createHarness("owner-1", { CANVAS_OWNER_SITE_URL: "https://stella.sh/" }, puts);
    const saved = await owner.call("shares.save", { canvas: "report", html: "<p>hi</p>" });
    expect(saved.value.visibility).toBe("private");
    expect(puts.at(-1)?.customMetadata).toMatchObject({
      visibility: "private",
      owner: await canvasOwnerTag("owner-1"),
      "owner-site": "https://stella.sh",
    });
  });

  test("leaves the owner site to the share worker when none is configured", async () => {
    const puts: Put[] = [];
    const owner = createHarness("owner-1", {}, puts);
    await owner.call("shares.save", { canvas: "report", html: "<p>hi</p>" });
    expect(puts.at(-1)?.customMetadata?.["owner-site"]).toBeUndefined();
  });

  test("the owner's view link carries a grant for that link and owner only", async () => {
    const puts: Put[] = [];
    const owner = createHarness("owner-1", {}, puts);
    const saved = await owner.call("shares.save", { canvas: "report", html: "<p>hi</p>" });
    const { value } = await owner.call("shares.viewLink", { slug: saved.value.slug });
    const url = new URL(value.url);
    expect(`${url.origin}${url.pathname}`).toBe(saved.value.url);
    const claims = await verifyCanvasViewToken(SECRET, url.searchParams.get("grant")!, Date.now());
    expect(claims).toMatchObject({
      k: "grant",
      s: saved.value.slug,
      o: await canvasOwnerTag("owner-1"),
    });

    const stranger = createHarness("owner-2", {}, []);
    const refused = await stranger.call("shares.viewLink", { slug: saved.value.slug });
    expect(refused.error?.code).toBe("NOT_FOUND");
  });
});
