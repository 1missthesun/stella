/**
 * Where a cloud-stored conversation's tools run when they leave this
 * computer (`@stella/agent/host/desktop-execution`): another of the owner's
 * computers, through the owner gate, or a cloud container the conversation's
 * object holds for it. Both are reached over HTTP with the user's sign-in
 * (`@stella/agent/host/remote-tools`).
 */
import { httpExecutionRemote, type DesktopExecutionRemote } from "@stella/agent/host/remote-tools";
import type { OpenSession } from "./sessions.js";

export const executionRemoteFor = (
  session: OpenSession,
  conversationId: string,
): DesktopExecutionRemote | undefined =>
  httpExecutionRemote(conversationId, () => session.runnerCell.get()?.getStellaSiteAuth());
