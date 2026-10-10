import { describe, expect, test } from "bun:test";

import worker from "../src/index.ts";
import {
  canvasOwnerTag,
  signCanvasViewToken,
} from "../../shared/canvas-view-grant.ts";

const request = (pathname, init) =>
  new Request(`https://stellashare.example${pathname}`, init);

const context = () => {
  const pending = [];
  return {
    ctx: {
      waitUntil(promise) {
        pending.push(promise);
      },
      passThroughOnException() {},
      props: {},
    },
    pending,
  };
};

const environment = ({ object = null, disabled = "", vars = {} } = {}) => {
  const reads = [];
  const deletes = [];
  return {
    env: {
      ...vars,
      SHARES_DISABLED: disabled,
      SHARES_BUCKET: {
        async get(key) {
          reads.push(key);
          return object;
        },
        async delete(key) {
          deletes.push(key);
        },
      },
    },
    reads,
    deletes,
  };
};

describe("canvas-share Worker", () => {
  test("streams a valid share with the sandbox boundary intact", async () => {
    const slug = "abcdefghijklmnopqrstuv";
    const html = "<!doctype html><script>document.body.textContent='ok'</script>";
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(html));
        controller.close();
      },
    });
    const { env, reads } = environment({
      object: {
        body,
        customMetadata: {},
        httpEtag: '"canvas-etag"',
      },
    });
    const { ctx } = context();

    const response = await worker.fetch(request(`/c/${slug}`), env, ctx);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(html);
    expect(reads).toEqual([`shares/${slug}.html`]);
    expect(response.headers.get("content-security-policy")).toBe(
      "sandbox allow-scripts allow-popups allow-forms allow-downloads;",
    );
    expect(response.headers.get("content-security-policy")).not.toContain(
      "allow-same-origin",
    );
    expect(response.headers.get("etag")).toBe('"canvas-etag"');
  });

  test("expires shares through a tracked lazy delete", async () => {
    const slug = "abcdefghijklmnopqrstuv";
    const { env, deletes } = environment({
      object: {
        body: new ReadableStream(),
        customMetadata: { "expires-at": "1" },
      },
    });
    const { ctx, pending } = context();

    const response = await worker.fetch(request(`/c/${slug}`), env, ctx);
    await Promise.all(pending);

    expect(response.status).toBe(404);
    expect(deletes).toEqual([`shares/${slug}.html`]);
  });

  test("honors the global kill-switch before touching R2", async () => {
    const { env, reads } = environment({ disabled: "true" });
    const { ctx } = context();

    const response = await worker.fetch(
      request("/c/abcdefghijklmnopqrstuv"),
      env,
      ctx,
    );

    expect(response.status).toBe(503);
    expect(reads).toEqual([]);
  });
});

describe("private canvases", () => {
  const slug = "abcdefghijklmnopqrstuv";
  const secret = "test-view-secret";
  const html = "<!doctype html><p>owner only</p>";
  const vars = { CANVAS_SHARE_VIEW_SECRET: secret, OWNER_SITE_URL: "https://stella.sh" };

  const privateObject = async (metadata = {}) => ({
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(html));
        controller.close();
      },
    }),
    customMetadata: {
      visibility: "private",
      owner: await canvasOwnerTag("owner-account"),
      ...metadata,
    },
  });

  const grantFor = async (ownerId, grantSlug = slug, key = secret) =>
    signCanvasViewToken(key, {
      k: "grant",
      o: await canvasOwnerTag(ownerId),
      s: grantSlug,
      e: Date.now() + 60_000,
    });

  const fetchWith = async (path, { metadata, envVars = vars, cookie } = {}) => {
    const { env } = environment({ object: await privateObject(metadata), vars: envVars });
    const init = cookie ? { headers: { cookie } } : undefined;
    return worker.fetch(request(path, init), env, context().ctx);
  };

  test("trades the owner's grant for a view cookie that opens the canvas", async () => {
    const grant = await grantFor("owner-account");
    const redirect = await fetchWith(`/c/${slug}?grant=${encodeURIComponent(grant)}`);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe(`/c/${slug}`);
    const cookie = redirect.headers.get("set-cookie").split(";")[0];
    expect(cookie.startsWith("stella_canvas_view=")).toBe(true);

    const page = await fetchWith(`/c/${slug}`, { cookie });
    expect(page.status).toBe(200);
    expect(await page.text()).toBe(html);
    expect(page.headers.get("cache-control")).toBe("private, no-store");
  });

  test("refuses another account's grant and a grant signed with another secret", async () => {
    for (const grant of [
      await grantFor("someone-else"),
      await grantFor("owner-account", "zzzzzzzzzzzzzzzzzzzzzz"),
      await grantFor("owner-account", slug, "a-different-secret"),
    ]) {
      const response = await fetchWith(`/c/${slug}?grant=${encodeURIComponent(grant)}`);
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  test("a browser without the cookie gets the private page, linking the owner to sign in", async () => {
    const response = await fetchWith(`/c/${slug}`, {
      metadata: { "owner-site": "https://stella-website-dev.example" },
    });
    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain("This canvas is private");
    expect(body).toContain(`href="https://stella-website-dev.example/canvas/open?c=${slug}"`);
    expect(body).not.toContain(html);
  });

  test("the sign-in link falls back to OWNER_SITE_URL and ignores an unusable owner-site", async () => {
    for (const metadata of [{}, { "owner-site": "javascript:alert(1)" }, { "owner-site": "http://evil.example" }]) {
      const body = await (await fetchWith(`/c/${slug}`, { metadata })).text();
      expect(body).toContain(`href="https://stella.sh/canvas/open?c=${slug}"`);
      expect(body).not.toContain("evil.example");
      expect(body).not.toContain("javascript:");
    }
  });

  test("another owner's cookie does not open it", async () => {
    const view = await signCanvasViewToken(secret, {
      k: "view",
      o: await canvasOwnerTag("someone-else"),
      e: Date.now() + 60_000,
    });
    const response = await fetchWith(`/c/${slug}`, { cookie: `stella_canvas_view=${view}` });
    expect(response.status).toBe(403);
  });

  test("without the view secret nothing opens and no sign-in is offered", async () => {
    const grant = await grantFor("owner-account");
    const response = await fetchWith(`/c/${slug}?grant=${encodeURIComponent(grant)}`, {
      envVars: { OWNER_SITE_URL: "https://stella.sh" },
    });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("/canvas/open");
  });
});
