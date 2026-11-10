import { promises as fs } from "node:fs";
import path from "node:path";
import type { ChatContext } from "@stella/contracts";

/**
 * What the user attached to a message they have not sent yet, kept on disk so
 * a restart does not drop it. Only what they put there themselves is kept:
 * a captured window or its text describes a moment that has passed.
 */
export type ComposerAttachments = Pick<ChatContext, "regionScreenshots" | "files" | "pastedTexts">;

const FILE_NAME = "composer-attachments.json";
const WRITE_DELAY_MS = 300;
const MAX_BYTES = 32 * 1024 * 1024;

export const composerAttachmentsOf = (context: ChatContext | null): ComposerAttachments | null => {
  if (!context) return null;
  const { regionScreenshots, files, pastedTexts } = context;
  if (!regionScreenshots?.length && !files?.length && !pastedTexts?.length) return null;
  return { regionScreenshots: regionScreenshots ?? [], files: files ?? [], pastedTexts: pastedTexts ?? [] };
};

const sameAttachments = (a: ComposerAttachments | null, b: ComposerAttachments | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.regionScreenshots === b.regionScreenshots &&
    a.files === b.files &&
    a.pastedTexts === b.pastedTexts);

export const createComposerAttachmentsStore = (dataDir: string, log: (message: string) => void) => {
  const file = path.join(dataDir, FILE_NAME);
  let written: ComposerAttachments | null = null;
  let wanted: ComposerAttachments | null = null;
  let timer: NodeJS.Timeout | null = null;
  let writing: Promise<void> = Promise.resolve();

  const write = async (attachments: ComposerAttachments | null) => {
    const body = attachments ? JSON.stringify(attachments) : null;
    if (body === null || body.length > MAX_BYTES) {
      await fs.rm(file, { force: true });
      return;
    }
    const staging = `${file}.${process.pid}.tmp`;
    await fs.writeFile(staging, body, { mode: 0o600 });
    await fs.rename(staging, file);
  };

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (sameAttachments(wanted, written)) return writing;
    const next = wanted;
    written = next;
    writing = writing
      .then(() => write(next))
      .catch((error: unknown) => log(`composer attachments not saved: ${error instanceof Error ? error.message : String(error)}`));
    return writing;
  };

  return {
    async read(): Promise<ComposerAttachments | null> {
      try {
        const kept = composerAttachmentsOf(JSON.parse(await fs.readFile(file, "utf8")) as ChatContext);
        written = kept;
        wanted = kept;
        return kept;
      } catch {
        return null;
      }
    },
    keep(context: ChatContext | null) {
      const next = composerAttachmentsOf(context);
      wanted = sameAttachments(next, wanted) ? wanted : next;
      timer ??= setTimeout(() => void flush(), WRITE_DELAY_MS);
    },
    flush,
  };
};
