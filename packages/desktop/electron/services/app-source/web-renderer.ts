import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WEB_RENDERER_UPLOAD_PREFIX } from "@stella/contracts/backend/app-source";
import { git, gitRaw, run } from "./git.js";

export type WebRendererDeps = {
  getBackendUrl: () => string | null;
  getAuthToken: () => Promise<string | null>;
  log: (event: string, data: Record<string, unknown>) => void;
};

const SHARED_INPUTS = ["packages/desktop-ui/", "packages/contracts/", "packages/theme/", "bun.lock"];
const UPSTREAM_REF = "refs/remotes/stella-upstream/main";
/** The renderer kind (its uploaded ref) the backend last recorded for this checkout, so a desktop that changes engine uploads its own build even when HEAD hasn't moved. */
const LAST_KIND_KEY = "stella.webRendererKind";

type RendererKind = {
  inputs: string[];
  uploadedRef: string;
  buildScript: string;
  rendererId: (treeSha: string) => string;
};

const DESKTOP_UI_RENDERER: RendererKind = {
  inputs: SHARED_INPUTS,
  uploadedRef: "refs/stella/web-renderer",
  buildScript: "packages/desktop/scripts/build-web-renderer.ts",
  rendererId: (treeSha) => treeSha,
};

// The backend serves a renderer id as immutable, so the Rune UI's build of a tree needs an id of its own.
const RUNE_RENDERER: RendererKind = {
  inputs: [...SHARED_INPUTS, "packages/desktop-rune/", ":(exclude)packages/desktop-rune/engine/"],
  uploadedRef: "refs/stella/web-renderer-rune",
  buildScript: "packages/desktop-rune/web/build.ts",
  rendererId: (treeSha) => createHash("sha1").update(`stella-rune-web\0${treeSha}`).digest("hex"),
};

// stella.sh's shared /chat-app is the Rune UI's web build, so a user's own renderer is too, whichever
// engine their desktop runs. Only a checkout from before Rune (no Rune web build) builds desktop-ui's.
const rendererKind = (cwd: string): RendererKind =>
  fs.existsSync(path.join(cwd, RUNE_RENDERER.buildScript)) ? RUNE_RENDERER : DESKTOP_UI_RENDERER;

const verifiedRef = async (cwd: string, ref: string) => {
  const result = await gitRaw(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return result.code === 0 ? result.stdout.trim() : null;
};

export const tarDirectory = (root: string): Buffer => {
  const blocks: Buffer[] = [];
  const names = (fs.readdirSync(root, { recursive: true }) as string[])
    .map((name) => name.replace(/\\/g, "/"))
    .filter((name) => fs.statSync(path.join(root, name)).isFile())
    .sort();
  for (const name of names) {
    const body = fs.readFileSync(path.join(root, name));
    const header = Buffer.alloc(512);
    const split = Buffer.byteLength(name) <= 100 ? -1 : name.lastIndexOf("/");
    const [prefix, base] = split < 0 ? ["", name] : [name.slice(0, split), name.slice(split + 1)];
    if (Buffer.byteLength(base) > 100 || Buffer.byteLength(prefix) > 155) {
      throw new Error(`Path too long for the renderer archive: ${name}`);
    }
    const octal = (value: number, length: number) => `${value.toString(8).padStart(length - 1, "0")}\0`;
    header.write(base, 0);
    header.write(octal(0o644, 8), 100);
    header.write(octal(0, 8), 108);
    header.write(octal(0, 8), 116);
    header.write(octal(body.byteLength, 12), 124);
    header.write(octal(0, 12), 136);
    header.fill(0x20, 148, 156);
    header[156] = 0x30;
    header.write("ustar\0", 257);
    header.write("00", 263);
    header.write(prefix, 345);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, body, Buffer.alloc((512 - (body.byteLength % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
};

const uploadOnce = async (cwd: string, deps: WebRendererDeps) => {
  const kind = rendererKind(cwd);
  const head = await git(cwd, ["rev-parse", "HEAD"]);
  const otherRef = kind === RUNE_RENDERER ? DESKTOP_UI_RENDERER.uploadedRef : RUNE_RENDERER.uploadedRef;
  const lastKind =
    (await gitRaw(cwd, ["config", "--get", LAST_KIND_KEY])).stdout.trim() || ((await verifiedRef(cwd, otherRef)) ? otherRef : null);
  const switched = lastKind !== null && lastKind !== kind.uploadedRef;
  const base = (await verifiedRef(cwd, kind.uploadedRef)) ?? (await verifiedRef(cwd, UPSTREAM_REF));
  if (base && !switched) {
    const changed = await git(cwd, ["diff", "--name-only", base, head, "--", ...kind.inputs]);
    if (!changed) return;
  }
  const baseUrl = deps.getBackendUrl()?.replace(/\/+$/, "");
  const token = await deps.getAuthToken();
  if (!baseUrl || !token) return;
  const treeSha = await git(cwd, ["rev-parse", "HEAD^{tree}"]);
  const rendererId = kind.rendererId(treeSha);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "stella-web-renderer-"));
  const startedAt = Date.now();
  try {
    const bun = process.env.STELLA_BUN_PATH?.trim() || "bun";
    const build = await run(bun, [kind.buildScript, "--out", outDir], { cwd, timeoutMs: 10 * 60_000 });
    if (build.code !== 0) {
      throw new Error(`The browser renderer didn't build: ${(build.stderr || build.stdout).trim().slice(-400)}`);
    }
    const archive = tarDirectory(outDir);
    const response = await fetch(`${baseUrl}${WEB_RENDERER_UPLOAD_PREFIX}${rendererId}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/x-tar" },
      body: new Uint8Array(archive),
      signal: AbortSignal.timeout(5 * 60_000),
    });
    if (!response.ok) {
      throw new Error(`The browser renderer upload failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    }
    await git(cwd, ["update-ref", kind.uploadedRef, head]);
    await git(cwd, ["config", LAST_KIND_KEY, kind.uploadedRef]);
    deps.log("app-source.web-renderer-uploaded", {
      kind: kind.uploadedRef,
      treeSha,
      rendererId,
      bytes: archive.byteLength,
      ms: Date.now() - startedAt,
    });
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
};

const inFlight = new Map<string, { running: Promise<void>; again: boolean }>();

export const buildAndUploadWebRenderer = (cwd: string, deps: WebRendererDeps): Promise<void> => {
  const current = inFlight.get(cwd);
  if (current) {
    current.again = true;
    return current.running;
  }
  const entry = { running: Promise.resolve(), again: false };
  entry.running = (async () => {
    try {
      do {
        entry.again = false;
        await uploadOnce(cwd, deps);
      } while (entry.again);
    } finally {
      inFlight.delete(cwd);
    }
  })();
  inFlight.set(cwd, entry);
  return entry.running;
};
