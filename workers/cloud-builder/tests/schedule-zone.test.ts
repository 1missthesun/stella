import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PHONE_ZONE_STALE_MS, formatTurnClock } from "@stella/contracts/schedule-zone";
import { openSqlStorageFake, type SqlStorageFake } from "./fixtures/sql-storage.js";
import { createOwnerRegistry, type OwnerCaller } from "../src/owner-store/registry.js";
import { OwnerStore } from "../src/owner-store/store.js";
import { schedulesDomain, snapshotTimeZone } from "../src/owner-store/domains/schedules.js";

const OWNER = "https://issuer.example|user-1";
const caller: OwnerCaller = {
  ownerId: OWNER,
  subject: "user-1",
  sessionId: "session-1",
  isAnonymous: false,
  expiresAtMs: Date.now() + 30 * 60_000,
};

const wallClock = (atMs: number, zone: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(atMs),
  );

describe("the user's time zone", () => {
  let fake: SqlStorageFake;
  let store: OwnerStore;
  beforeEach(() => {
    fake = openSqlStorageFake();
    store = new OwnerStore({
      ctx: { storage: { sql: fake.sql, transactionSync: <T>(fn: () => T) => fn() } } as unknown as DurableObjectState,
      env: {} as Cloudflare.Env,
      ownerId: () => OWNER,
      registry: createOwnerRegistry([schedulesDomain]),
      host: { snapshot: async () => { throw new Error("no snapshot in tests"); } },
      verifyToken: async () => null,
    });
  });
  afterEach(() => fake.close());

  const call = async (name: string, args: unknown) => {
    const result = await store.call(name, args, caller);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value as any;
  };
  const report = (timeZone: string, source: "phone" | "computer") => call("schedules.reportZone", { timeZone, source });
  const daily8 = (requestId: string, tz?: string) =>
    call("schedules.create", {
      requestId: `request-${requestId}-0000000000`,
      kind: "reminder",
      prompt: "Stretch",
      schedule: { kind: "cron", expr: "0 8 * * *", ...(tz ? { tz } : {}) },
    });
  const row = (scheduleId: string) =>
    fake.sql
      .exec<{ schedule_json: string; next_run_at: number }>(
        "SELECT schedule_json, next_run_at FROM schedules WHERE schedule_id = ?",
        scheduleId,
      )
      .one();

  test("the phone decides; a computer only fills in while no phone reports", async () => {
    expect(await report("America/New_York", "computer")).toMatchObject({ zone: "America/New_York", source: "computer" });
    expect(await report("Asia/Tokyo", "phone")).toMatchObject({ zone: "Asia/Tokyo", source: "phone" });
    expect(await report("America/New_York", "computer")).toMatchObject({ zone: "Asia/Tokyo", source: "phone" });
    expect(snapshotTimeZone(store.context(null).db)).toEqual({ timeZone: "Asia/Tokyo" });
    fake.sql.exec("UPDATE schedule_zone SET phone_reported_at = ?", Date.now() - PHONE_ZONE_STALE_MS - 1);
    expect(await report("America/New_York", "computer")).toMatchObject({ zone: "America/New_York", source: "computer" });
  });

  test("a repeating schedule follows the user to a new zone without asking", async () => {
    await report("America/Los_Angeles", "phone");
    const created = await daily8("r1");
    expect(JSON.parse(created.schedule)).toEqual({ kind: "cron", expr: "0 8 * * *" });
    expect(created.zone).toBe("America/Los_Angeles");
    expect(wallClock(row(created.scheduleId).next_run_at, "America/Los_Angeles")).toBe("08:00");

    await report("Europe/Paris", "phone");
    expect(wallClock(row(created.scheduleId).next_run_at, "Europe/Paris")).toBe("08:00");
    const [listed] = schedulesDomain.views["schedules.list"].read(store.context(null) as never) as any[];
    expect(listed.zone).toBe("Europe/Paris");
  });

  test("a cron pinned to the user's own zone follows them; another place stays put", async () => {
    await report("America/Los_Angeles", "phone");
    const own = await daily8("r1", "America/Los_Angeles");
    const market = await daily8("r2", "America/New_York");
    expect(JSON.parse(own.schedule).tz).toBeUndefined();
    expect(JSON.parse(market.schedule).tz).toBe("America/New_York");
    await report("Asia/Tokyo", "phone");
    expect(wallClock(row(own.scheduleId).next_run_at, "Asia/Tokyo")).toBe("08:00");
    expect(wallClock(row(market.scheduleId).next_run_at, "America/New_York")).toBe("08:00");
  });

  test("a one-off keeps its instant", async () => {
    await report("America/Los_Angeles", "phone");
    const atMs = Date.now() + 3 * 60 * 60_000;
    const once = await call("schedules.create", {
      requestId: "request-o1-0000000000",
      kind: "reminder",
      prompt: "Call",
      schedule: { kind: "at", atMs },
    });
    await report("Asia/Tokyo", "phone");
    expect(row(once.scheduleId).next_run_at).toBe(atMs);
  });

  test("the clock Stella reads names the user's zone", () => {
    const at = Date.UTC(2026, 9, 11, 23, 40);
    expect(formatTurnClock(at, "America/Los_Angeles")).toBe(
      "2026-10-11T23:40:00.000Z (Sunday, October 11, 2026 at 4:40 PM in America/Los_Angeles (UTC-07:00))",
    );
    expect(formatTurnClock(at)).toBe("2026-10-11T23:40:00.000Z (Sunday, October 11, 2026 at 11:40 PM UTC)");
  });
});
