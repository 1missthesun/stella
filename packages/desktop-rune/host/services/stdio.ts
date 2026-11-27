// The host's stdout belongs to the engine bridge, so every console method (Bun writes log, info,
// debug, dir, table and others to stdout) and process.stdout go to stderr. Imported first.

import { Console } from "node:console";

const toStderr = new Console({ stdout: process.stderr, stderr: process.stderr });
for (const key of Object.keys(console) as Array<keyof Console>) {
  const method: unknown = toStderr[key];
  if (typeof method === "function") (console as unknown as Record<string, unknown>)[key] = (method as Function).bind(toStderr);
}
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
