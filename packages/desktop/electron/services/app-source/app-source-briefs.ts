import type { UpdatePlan } from "./update-plan.js";

export type AgentBrief = { description: string; prompt: string };

export const mergeDraftName = (tip: string) => `update-${tip.slice(0, 12)}`;

const listing = (paths: string[], limit = 40) => {
  const shown = paths.slice(0, limit).map((path) => `- ${path}`);
  if (paths.length > limit) shown.push(`- …and ${paths.length - limit} more`);
  return shown.join("\n");
};

const reason = (
  plan: Extract<UpdatePlan, { kind: "clean" | "conflict" }>,
  gateOutput: string | undefined,
  what: string,
) =>
  plan.kind === "conflict"
    ? `Git cannot merge it on its own: ${plan.conflicts.length} file(s) conflict.

Conflicting files:
${listing(plan.conflicts)}`
    : `Git merges it without a single conflict, but the merged tree fails the check the app runs before it applies ${what} by itself: Electron main and preload must build. Resolve what the merge got wrong, not just the symptom.

Build output:
\`\`\`
${gateOutput ?? "(not captured)"}
\`\`\``;

const state = (
  plan: Extract<UpdatePlan, { kind: "clean" | "conflict" }>,
  head: string,
  theirs: { label: string; ref: string },
) => `State the app established, so you do not have to:

- ${theirs.label}: \`${plan.tip}\` — "${plan.subject}"
- Ref to merge: \`${theirs.ref}\` (already fetched; never fetch or pull yourself)
- This checkout's HEAD: \`${head}\`
- Commit the two sides last shared (the merge base): \`${plan.base}\`
- Commits that side has that this checkout lacks: ${plan.count}
- This checkout has changes of its own against that merge base: ${plan.localChanges ? "yes" : "no"}`;

const KEEP_MERGE = `Keep the merge commit — do not squash or rebase it.`;

export const upstreamMergeBrief = (
  plan: Extract<UpdatePlan, { kind: "clean" | "conflict" }>,
  head: string,
  gateOutput?: string,
): AgentBrief => ({
  description: `Merge Stella update ${plan.tip.slice(0, 7)}`,
  prompt: `An official Stella update has to be merged with this computer's own changes. The user already pressed Update, so nobody is waiting on a question — finish the draft. It then waits in Updates until they add it, so Stella never relaunches under them.

Follow the "Updates" section of the modify-stella skill. Name the draft \`${mergeDraftName(plan.tip)}\`.

${reason(plan, gateOutput, "an update")}

${state(plan, head, {
  label: "Published version (upstream)",
  ref: "refs/remotes/stella-upstream/main",
})}

Resolve every conflict by keeping the user's changes: take the new version's code, then carry the user's changes onto it so both work. ${KEEP_MERGE}`,
});

export const remoteMergeBrief = (
  plan: Extract<UpdatePlan, { kind: "clean" | "conflict" }>,
  head: string,
  forkRef: string,
  gateOutput?: string,
): AgentBrief => ({
  description: `Merge changes from another computer ${plan.tip.slice(0, 7)}`,
  prompt: `The user changed Stella on another of their computers, and that change has to be merged with this computer's own changes. They already pressed the button to add it here, so nobody is waiting on a question — finish the draft. It then waits in Updates until they add it, so Stella never relaunches under them.

Follow the "Rebase, merge, or undo for the user" section of the modify-stella skill, the "changes from another computer diverged" case. Name the draft \`${mergeDraftName(plan.tip)}\`.

${reason(plan, gateOutput, "a change from another computer")}

${state(plan, head, {
  label: "The other computer's version (the fork)",
  ref: forkRef,
})}

Both sides are the user's own work, so neither wins by default: keep what each one was for. ${KEEP_MERGE}`,
});

export const staleDraftBrief = (
  plan: Extract<UpdatePlan, { kind: "clean" | "conflict" }>,
  head: string,
  name: string,
  gateOutput?: string,
): AgentBrief => ({
  description: `Bring the draft "${name}" up to date`,
  prompt: `A finished change of the user's was made against an older version of Stella and no longer fits the current one. They pressed Update on it, so they want it — bring it up to date and leave it finished on its own branch, \`draft/${name}\`. It then waits in Updates until they add it.

Follow the "Rebase, merge, or undo for the user" section of the modify-stella skill, the "stale draft" case: \`git worktree add "$STELLA_DRAFTS_DIR/${name}" draft/${name}\` (no \`-b\`), rebase onto the checkout's current branch, resolve, check, finish.

${reason(plan, gateOutput, "a change")}

${state(plan, head, {
  label: `The draft's tip (draft/${name})`,
  ref: `refs/heads/draft/${name}`,
})}

Keep what the change was for: take the current version's code, then carry the change onto it so it still does what it set out to do.`,
});

export const undoBrief = (args: {
  sha: string;
  base: string;
  subject: string;
  head: string;
  conflicts: string[];
  buildOutput?: string;
}): AgentBrief => ({
  description: `Undo "${args.subject}"`,
  prompt: `The user asked to undo a change to Stella, and it cannot be lifted out mechanically: ${
    args.buildOutput !== undefined
      ? "taking it out leaves Electron main or preload unable to build, so work that came after it depends on it."
      : "work that came after it builds on it."
  }

Follow the "Rebase, merge, or undo for the user" section of the modify-stella skill, the "undo that conflicts or doesn't build" case: start a draft, \`git revert --no-edit ${args.base}..${args.sha}\`, resolve, check, finish. Finish it the normal way and tell the user it is ready — this one they apply themselves, because what to keep of the later work is a judgement and they should see it first.

State the app established, so you do not have to:

- Change to undo: the commits in \`${args.base}..${args.sha}\` (they arrived together) — "${args.subject}"
- This checkout's HEAD: \`${args.head}\`
- Files later work and this undo disagree about: ${args.conflicts.length}

${
  args.conflicts.length > 0
    ? `Disagreeing files:
${listing(args.conflicts)}

`
    : ""
}${
  args.buildOutput !== undefined
    ? `The build of HEAD with the change taken out:

\`\`\`
${args.buildOutput}
\`\`\`

`
    : ""
}Take out what the change did, and keep the later work that was built on it working. If the two are genuinely incompatible, say so in your completion rather than quietly dropping either.`,
});
