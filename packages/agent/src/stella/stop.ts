/**
 * pi-durable records a stopped reply only when one had started streaming (it
 * keeps the partial as an `aborted` assistant entry).
 */
import type { Context } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantEntry, LiveDoc, type Conversation, type Harness } from "@earendil-works/pi-durable";

export async function afterStop(harness: Harness, root: Conversation, context: Context): Promise<void> {
  for (;;) {
    const taskId = (await harness.snapshot(LiveDoc, root.id, context))?.run?.taskId;
    if (taskId === undefined || (await harness.getTask(taskId, context))?.abortRequested !== true) return;
    await harness.waitForTask(taskId, context);
  }
}

export async function stopStella(harness: Harness, root: Conversation, context: Context): Promise<void> {
  const { model } = await root.agent(context);
  await harness.commit(async (tx) => {
    const live = await tx.doc(LiveDoc, root.id);
    if (!live.run || live.generation?.message) return undefined;
    const stopped: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "stella-stop",
      provider: model?.provider ?? "stella",
      model: model?.modelId ?? "stopped",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "aborted",
      timestamp: Date.now(),
    };
    await tx.appendEntry(root.id, { kind: AssistantEntry.kind, model: [stopped] });
    return undefined;
  }, context);
  await root.abort(context);
}
