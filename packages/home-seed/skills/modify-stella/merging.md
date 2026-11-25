# Rebases, merges, undos and updates

These follow the draft lifecycle in `SKILL.md` (start, check, finish), with the differences below.

## Rebase, merge, or undo for the user

Stella does the mechanical version of these itself. When the user presses one of these buttons it classifies the work first: a fast-forward applies, and so does a three-way merge with no conflict whose result still builds Electron main and preload. You are sent one of these **only when there is a judgement to make** — real conflicting files, or a clean merge whose result does not build.

When that happens you get a brief, not a chat message. It already names the shas, the merge base, the conflicting files or the build output, and the draft to use. The user pressed a button; they did not type a request, so do not answer as though they asked you a question, and **never tell them something conflicted** — all they are told is that Stella is working on it.

Do the work in a draft and finish as above, with these differences:

- **Stale draft** (a finished change of theirs made against an older version): work on its existing branch — `git worktree add "$STELLA_DRAFTS_DIR/<name>" draft/<name>` (no `-b`) — rebase onto the checkout's current branch, resolve, check, finish. The user already pressed Update on it, so Stella applies it by itself when you finish.
- **Changes from another computer diverged:** the fork is at `refs/remotes/stella-fork/<branch>`. Start a draft named `merge-<sha12>` of the fork's tip, `git merge refs/remotes/stella-fork/<branch>`, resolve, check, finish. Keep the merge commit; do not squash or rebase it. Both sides are the user's own work, so neither wins by default. The user already pressed the button for it, so Stella applies it by itself when you finish.
- **Undo that conflicts or doesn't build:** start a draft, `git revert --no-edit <base>..<sha>` (the brief gives the range: everything that arrived together), resolve, check, finish. **This one the user applies themselves** — what to keep of the work built on top of the change is a judgement, so tell them it is ready and let them see it before it lands. Say plainly in your completion if the change and the later work are genuinely incompatible.

If a worktree directory was deleted by hand, run `git -C "$STELLA_APP_DIR" worktree prune`.

## Updates

Most updates never reach you. A new version is prepared before Update is offered: it fast-forwards when it can, a clean merge is built and checked, and a conflicting merge is resolved in the background (from resolutions git remembers, then by a model, then typechecked) on one of the user's computers, whose result every computer with the same changes takes. One press of Update applies it on all their computers. You are sent an update only when that could not be done with confidence: real conflicts that need judgement, or a merge whose result fails the build.

When that happens you get a brief, not a chat message — it already names the upstream sha, the merge base, the conflicting files or the build output, and the draft name to use. The user already pressed Update, so the finished `update-` draft is applied by itself as soon as you finish, at a moment that doesn't interrupt them, and goes to their other computers too. Your report is what they see about it in the chat: keep it to a sentence or two on what was kept. The published version is at `refs/remotes/stella-upstream/main` (Stella fetches it; never fetch or pull yourself). Merge it in a draft:

1. Use the draft name from the brief, `update-<sha12>` (the first 12 characters of `git -C "$STELLA_APP_DIR" rev-parse refs/remotes/stella-upstream/main`), and start it as usual.
2. In the draft, `git merge refs/remotes/stella-upstream/main`. Resolve every conflict keeping the user's changes: take the new version's code, then carry the user's changes over onto it so both work.
3. `bun "$STELLA_APP_DIR/packages/desktop/scripts/draft-deps.ts" .` (it links the packages for the merged dependencies, installing them once if they are new), then run all three typechecks (renderer, runtime, main/preload) and check the UI in a preview, as in "Check it", even if no conflict touched the UI.
4. Finish as usual, but keep the merge commit: commit the merge resolution (`git commit --no-edit` after `git add`), and do not squash or rebase it.
