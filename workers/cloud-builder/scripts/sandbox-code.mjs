#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { isEntryPoint } from "../../../scripts/lib/entry-point.mjs";

const workerRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(workerRoot, "..", "..");

export const SANDBOX_CODE_PACKAGES = Object.freeze([
  "contracts",
  "runtime",
  "executor-cloud",
  "model-catalog",
  "agent",
]);

export const sandboxCodeAssetsDirectory = path.join(
  workerRoot,
  ".wrangler",
  "sandbox-code",
);
export const SANDBOX_CODE_ASSET_PREFIX = "sandbox-code";

const isExcluded = (relative) => {
  const segments = relative.split("/");
  return (
    segments.includes("node_modules") ||
    segments.includes(".git") ||
    segments.includes("test-fixtures") ||
    segments[0] === "tests" ||
    /\.test\.[cm]?[jt]sx?$/u.test(relative)
  );
};

const collect = async (packageName) => {
  const root = path.join(repoRoot, "packages", packageName);
  const entries = [];
  const walk = async (relative) => {
    const absolute = path.join(root, relative);
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (isExcluded(child)) continue;
      if (entry.isDirectory()) {
        entries.push({ kind: "directory", path: child });
        await walk(child);
      } else if (entry.isFile()) {
        const info = await lstat(path.join(root, child));
        entries.push({
          kind: "file",
          path: child,
          executable: (info.mode & 0o111) !== 0,
          bytes: await readFile(path.join(root, child)),
        });
      } else {
        throw new Error(
          `packages/${packageName}/${child} is neither a file nor a directory; the sandbox code bundle ships only plain files.`,
        );
      }
    }
  };
  await walk("");
  return entries.map((entry) => ({
    ...entry,
    path: `packages/${packageName}/${entry.path}`,
  }));
};

const encoder = new TextEncoder();

const header = ({ name, mode, size, type, linkname = "" }) => {
  const block = new Uint8Array(512);
  let prefix = "";
  let base = name;
  if (encoder.encode(name).length > 100) {
    const split = name.lastIndexOf("/", 155);
    prefix = name.slice(0, split);
    base = name.slice(split + 1);
    if (
      split <= 0 ||
      encoder.encode(prefix).length > 155 ||
      encoder.encode(base).length > 100
    ) {
      throw new Error(`Path is too long for the sandbox code archive: ${name}`);
    }
  }
  const put = (offset, length, value) => {
    const bytes = encoder.encode(value);
    if (bytes.length > length) throw new Error(`Tar field overflow: ${value}`);
    block.set(bytes, offset);
  };
  const octal = (offset, length, value) =>
    put(offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
  put(0, 100, base);
  octal(100, 8, mode);
  octal(108, 8, 0);
  octal(116, 8, 0);
  octal(124, 12, size);
  octal(136, 12, 0);
  block.fill(0x20, 148, 156);
  put(156, 1, type);
  put(157, 100, linkname);
  put(257, 6, "ustar\0");
  put(263, 2, "00");
  put(265, 32, "root");
  put(297, 32, "root");
  put(345, 155, prefix);
  let checksum = 0;
  for (const byte of block) checksum += byte;
  put(148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return block;
};

const tar = (entries) => {
  const chunks = [];
  for (const entry of entries) {
    if (entry.kind === "directory") {
      chunks.push(
        header({ name: `${entry.path}/`, mode: 0o755, size: 0, type: "5" }),
      );
    } else if (entry.kind === "symlink") {
      chunks.push(
        header({
          name: entry.path,
          mode: 0o777,
          size: 0,
          type: "2",
          linkname: entry.target,
        }),
      );
    } else {
      chunks.push(
        header({
          name: entry.path,
          mode: entry.executable ? 0o755 : 0o644,
          size: entry.bytes.length,
          type: "0",
        }),
        entry.bytes,
      );
      const padding = (512 - (entry.bytes.length % 512)) % 512;
      if (padding) chunks.push(new Uint8Array(padding));
    }
  }
  chunks.push(new Uint8Array(1024));
  return Buffer.concat(chunks);
};

export const buildSandboxCode = async ({
  assetsDirectory = sandboxCodeAssetsDirectory,
} = {}) => {
  const entries = [
    { kind: "directory", path: "node_modules" },
    { kind: "directory", path: "node_modules/@stella" },
    { kind: "directory", path: "packages" },
    {
      kind: "file",
      path: "package.json",
      executable: false,
      bytes: Buffer.from(
        `${JSON.stringify(
          { name: "stella-sandbox-code", private: true, type: "module" },
          null,
          2,
        )}\n`,
      ),
    },
    {
      kind: "symlink",
      path: "packages/stella-office",
      target: "/opt/stella/packages/stella-office",
    },
  ];
  for (const packageName of SANDBOX_CODE_PACKAGES) {
    const manifest = JSON.parse(
      await readFile(
        path.join(repoRoot, "packages", packageName, "package.json"),
        "utf8",
      ),
    );
    if (manifest.name !== `@stella/${packageName}`) {
      throw new Error(
        `packages/${packageName} is ${manifest.name}, not @stella/${packageName}.`,
      );
    }
    entries.push(
      { kind: "directory", path: `packages/${packageName}` },
      {
        kind: "symlink",
        path: `node_modules/@stella/${packageName}`,
        target: `../../packages/${packageName}`,
      },
      ...(await collect(packageName)),
    );
  }
  entries.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const archive = gzipSync(tar(entries), { level: 9 });
  const sha256 = createHash("sha256").update(archive).digest("hex");
  const directory = path.join(assetsDirectory, SANDBOX_CODE_ASSET_PREFIX);
  await rm(assetsDirectory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${sha256}.tar.gz`);
  await writeFile(file, archive);
  return {
    sha256,
    bytes: archive.length,
    files: entries.filter((entry) => entry.kind === "file").length,
    sourceBytes: entries.reduce(
      (sum, entry) => sum + (entry.kind === "file" ? entry.bytes.length : 0),
      0,
    ),
    file,
  };
};

if (isEntryPoint(import.meta.url)) {
  const bundle = await buildSandboxCode();
  process.stdout.write(
    `${JSON.stringify({
      event: "sandbox_code_bundle",
      sha256: bundle.sha256,
      bytes: bundle.bytes,
      files: bundle.files,
      sourceBytes: bundle.sourceBytes,
      file: path.relative(workerRoot, bundle.file),
    })}\n`,
  );
}
