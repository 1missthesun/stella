import { readFileSync } from "node:fs";
import { BackendClient } from "../../../../packages/contracts/backend/client";

const [token, ...pairs] = process.argv.slice(2);
const client = new BackendClient({
  baseUrl: process.env.STELLA_BACKEND_URL ?? "https://stella-v2-cloud-builder-dev.fromyou.workers.dev",
  getToken: async () => token!,
});
for (let index = 0; index < pairs.length; index += 2) {
  const local = pairs[index]!;
  const drivePath = pairs[index + 1]!;
  const bytes = readFileSync(local);
  const contentType = local.endsWith(".mp4") ? "video/mp4" : local.endsWith(".md") ? "text/markdown" : local.endsWith(".png") ? "image/png" : "application/octet-stream";
  const prepared = await client.call("drive.prepareUpload", { path: drivePath, sizeBytes: bytes.byteLength, contentType });
  const put = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "Content-Type": prepared.contentType }, body: bytes });
  if (!put.ok) throw new Error(`PUT ${put.status}`);
  const record = await client.call("drive.finalizeUpload", { path: prepared.path, uploadId: prepared.uploadId, contentType: prepared.contentType, source: "upload" });
  console.log(JSON.stringify(record));
}
console.log(JSON.stringify((await client.call("drive.list", {})).files.map((f) => f.path)));
client.dispose();
