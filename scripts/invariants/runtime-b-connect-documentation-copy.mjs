import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE = "packages/runtime/kernel/connectors/connect-documentation.ts";
const INLINE_COPY = "packages/runtime/kernel/connectors/connect-worker-api.ts";

const templateAfter = (text, marker) => {
  const start = text.indexOf(marker);
  if (start === -1) return null;
  let index = start + marker.length;
  let body = "";
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      body += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char === "`") return body;
    if (char === "$" && text[index + 1] === "{") return null;
    body += char;
    index += 1;
  }
  return null;
};

export async function check(root) {
  const source = templateAfter(
    readFileSync(path.join(root, SOURCE), "utf8"),
    "CONNECT_DOCUMENTATION = `",
  );
  const inline = templateAfter(
    readFileSync(path.join(root, INLINE_COPY), "utf8"),
    "const DOCUMENTATION = `",
  );
  if (source === null) return [`${SOURCE}: CONNECT_DOCUMENTATION must be a plain template literal`];
  if (inline === null) return [`${INLINE_COPY}: DOCUMENTATION must be a plain template literal`];
  if (source !== inline) {
    return [
      `${INLINE_COPY}: DOCUMENTATION must be a byte-identical copy of CONNECT_DOCUMENTATION in ${SOURCE} (the worker source is stringified and cannot import it)`,
    ];
  }
  return [];
}
