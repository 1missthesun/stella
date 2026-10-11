import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  agentIdCanonicalizer,
  agentIdsOf,
  projectAgentLabels,
  type AgentLabelRow,
} from "@stella/contracts/agent-labels";
import { placementRemoteThreadAgentId, sha256Hex } from "@stella/contracts/placement-thread-id";
import { followUpLabel, journalAgents } from "@stella/contracts/agent-titles";

const a = (id: string, agentIds?: string[]): AgentLabelRow => ({
  id,
  role: "assistant",
  ...(agentIds ? { agentIds } : {}),
});
const u = (id: string): AgentLabelRow => ({ id, role: "user" });

describe("placement thread ids", () => {
  it("hashes like node crypto", () => {
    for (const value of ["", "abc", "thr-e8a03ec550d9443fa7", "x".repeat(130), "héllo ✓"]) {
      expect(sha256Hex(value)).toBe(createHash("sha256").update(value, "utf8").digest("hex"));
    }
    expect(placementRemoteThreadAgentId("thr-e8a03ec550d9443fa7")).toBe(
      "placement-agent:thread:2b829117c06abfd77b9a36422ef46aff",
    );
  });
});

describe("projectAgentLabels", () => {
  it("labels an agent once, then only when the agent changes", () => {
    const labels = projectAgentLabels([
      u("u1"),
      a("r1", ["A"]),
      a("r2", ["A"]),
      a("r3", ["A"]),
      a("r4", ["B"]),
      a("r5", ["B"]),
      a("r6", ["A"]),
    ]);
    expect([...labels]).toEqual([
      ["r1", ["A"]],
      ["r4", ["B"]],
      ["r6", ["A"]],
    ]);
  });

  it("stays quiet when the same agent returns after unrelated messages", () => {
    const labels = projectAgentLabels([a("r1", ["A"]), u("u1"), a("r2"), u("u2"), a("r3", ["A"])]);
    expect([...labels.keys()]).toEqual(["r1"]);
  });

  it("treats a placement id and its cloud id as one agent", () => {
    const local = placementRemoteThreadAgentId("thr-1");
    const rows = [a("r1", ["thr-1"]), a("r2", [local]), a("r3", ["thr-2"])];
    const labels = projectAgentLabels(rows, agentIdCanonicalizer(agentIdsOf(rows)));
    expect([...labels.keys()]).toEqual(["r1", "r3"]);
  });

  it("labels each new agent a row starts", () => {
    const labels = projectAgentLabels([a("r1", ["A"]), a("r2", ["A", "B", "C"]), a("r3", ["C"])]);
    expect(labels.get("r2")).toEqual(["B", "C"]);
    expect(labels.has("r3")).toBe(false);
  });

  it("ignores hidden rows", () => {
    const labels = projectAgentLabels([{ ...a("r1", ["A"]), hidden: true }, a("r2", ["A"])]);
    expect([...labels.keys()]).toEqual(["r2"]);
  });
});

describe("follow-up titles", () => {
  const followUp = "Thanks, stay on hold. You're third in the Mac queue, after the file-links proof and the Show-more screenshots.";
  const wake = (description: string) => ({
    kind: "message",
    role: "user",
    payload: {
      content: `[Agent completed]\ndescription: ${description}\nthread_id: thr-1\nagent_type: general\nresult: ok`,
    },
  });
  const send = {
    kind: "message",
    role: "assistant",
    payload: {
      content: [{ type: "toolCall", id: "c1", name: "send_message", arguments: { thread_id: "thr-1", message: followUp } }],
    },
  };

  it("never names an agent after a follow-up sent to it", () => {
    const agent = journalAgents([send, wake(followUpLabel(followUp))]).get("thr-1");
    expect(agent?.title).toBeUndefined();
    expect(agent?.followUpTitles).toEqual([followUpLabel(followUp)]);
  });

  it("keeps the real name from an earlier wake", () => {
    const agent = journalAgents([wake("iOS verify helper"), send, wake(followUpLabel(followUp))]).get("thr-1");
    expect(agent?.title).toBe("iOS verify helper");
  });
});
