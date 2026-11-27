// Unpacks a zip archive (stored and deflated entries, Unix modes and symlinks) without loading it
// into memory, for the runtimes Stella downloads (Chrome for Testing is ~200 MB).

import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, open, symlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;

type Entry = { name: string; method: number; compressed: number; size: number; mode: number; offset: number };

async function readEntries(file: Awaited<ReturnType<typeof open>>, fileSize: number): Promise<Entry[]> {
  const tailSize = Math.min(fileSize, 65_557);
  const tail = Buffer.alloc(tailSize);
  await file.read(tail, 0, tailSize, fileSize - tailSize);
  let eocd = -1;
  for (let i = tailSize - 22; i >= 0; i--) if (tail.readUInt32LE(i) === EOCD) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip archive");
  const count = tail.readUInt16LE(eocd + 10);
  const centralSize = tail.readUInt32LE(eocd + 12);
  const centralOffset = tail.readUInt32LE(eocd + 16);
  if (count === 0xffff || centralOffset === 0xffffffff) throw new Error("zip64 archives aren't supported");
  const central = Buffer.alloc(centralSize);
  await file.read(central, 0, centralSize, centralOffset);
  const entries: Entry[] = [];
  for (let at = 0, i = 0; i < count; i++) {
    if (central.readUInt32LE(at) !== CENTRAL) throw new Error("corrupt zip central directory");
    const madeBy = central.readUInt16LE(at + 4) >> 8;
    const nameLength = central.readUInt16LE(at + 28);
    const extraLength = central.readUInt16LE(at + 30);
    const commentLength = central.readUInt16LE(at + 32);
    const name = central.toString("utf8", at + 46, at + 46 + nameLength);
    entries.push({
      name,
      method: central.readUInt16LE(at + 10),
      compressed: central.readUInt32LE(at + 20),
      size: central.readUInt32LE(at + 24),
      mode: madeBy === 3 ? central.readUInt32LE(at + 38) >>> 16 : 0,
      offset: central.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Extracts `archive` into `dest`; an entry naming a path outside `dest` fails the whole extraction. */
export async function extractZip(archive: string, dest: string): Promise<void> {
  const root = path.resolve(dest);
  const file = await open(archive, "r");
  try {
    const { size: fileSize } = await file.stat();
    const header = Buffer.alloc(30);
    for (const entry of await readEntries(file, fileSize)) {
      const target = path.resolve(root, entry.name);
      if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`zip entry outside the destination: ${entry.name}`);
      const kind = entry.mode & S_IFMT;
      if (entry.name.endsWith("/") || kind === S_IFDIR) {
        await mkdir(target, { recursive: true });
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true });
      await file.read(header, 0, 30, entry.offset);
      if (header.readUInt32LE(0) !== LOCAL) throw new Error(`corrupt zip entry ${entry.name}`);
      const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      if (entry.method !== 0 && entry.method !== 8) throw new Error(`zip entry ${entry.name} uses compression method ${entry.method}`);
      const raw = entry.compressed === 0 ? null : createReadStream(archive, { start, end: start + entry.compressed - 1 });
      if (kind === S_IFLNK) {
        const chunks: Buffer[] = [];
        if (raw) for await (const chunk of entry.method === 8 ? raw.pipe(createInflateRaw()) : raw) chunks.push(chunk as Buffer);
        await symlink(Buffer.concat(chunks).toString("utf8"), target);
        continue;
      }
      const out = createWriteStream(target, { mode: (entry.mode & 0o777) || 0o644 });
      if (!raw) out.end();
      else if (entry.method === 8) await pipeline(raw, createInflateRaw(), out);
      else await pipeline(raw, out);
      if (!raw) await new Promise<void>((resolve, reject) => out.on("close", resolve).on("error", reject));
      if (entry.mode & 0o777) await chmod(target, entry.mode & 0o777);
    }
  } finally {
    await file.close();
  }
}
