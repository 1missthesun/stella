// Re-export from shared location to avoid circular dependency between home/ and storage/.
// Canonical location: ../shared/private-fs.ts
export {
  ensurePrivateDir,
  writePrivateFile,
} from "@stella/node-shared/shared/private-fs.js";
