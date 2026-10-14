import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const isEntryPoint = (moduleUrl) => {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry.length === 0) return false;
  const canonical = (file) => {
    try {
      return pathToFileURL(realpathSync(path.resolve(file))).href;
    } catch {
      return null;
    }
  };
  let modulePath;
  try {
    modulePath = fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
  const here = canonical(modulePath);
  return here !== null && canonical(entry) === here;
};
