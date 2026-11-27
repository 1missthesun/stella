import os from "node:os";
import path from "node:path";
import { chromiumFor } from "./chromium";
import type { Session } from "./session";

const EPHEMERAL_PROFILE = path.join(os.tmpdir(), `stella-rune-chromium-${process.pid}`);
const contexts = new Map<Session, Promise<string>>();

/** The Chromium profile a session's pages open in: its own on-disk profile, or an in-memory browser context. */
export async function chromiumTargetFor(session: Session): Promise<{ profileDir: string; browserContextId?: string }> {
  const persistent = session.chromiumProfileDir;
  if (persistent) return { profileDir: persistent };
  let context = contexts.get(session);
  if (!context) {
    context = chromiumFor(EPHEMERAL_PROFILE).then(async (proc) => {
      const { browserContextId } = await proc.send<{ browserContextId: string }>("Target.createBrowserContext", { disposeOnDetach: false });
      proc.once("exit", () => contexts.delete(session));
      return browserContextId;
    });
    context.catch(() => contexts.delete(session));
    contexts.set(session, context);
  }
  return { profileDir: EPHEMERAL_PROFILE, browserContextId: await context };
}
