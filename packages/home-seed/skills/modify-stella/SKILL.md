---
name: modify-stella
description: Change Stella itself (its UI, runtime, or desktop shell) by preparing a draft in a git worktree; interface-only drafts are added when finished, the rest the user applies with the Update button. Use when the user asks to change, fix, or add to Stella, to rebase a draft, to merge changes from their other computer, to update Stella to the latest version, or to undo a change that conflicts.
---

# Modifying Stella

Stella runs from its own git checkout at `$STELLA_APP_DIR`. That checkout is what runs, so never edit it, commit in it, merge into it, or push it. Every change is a **draft**: a worktree at `$STELLA_DRAFTS_DIR/<name>` on branch `draft/<name>`. A finished draft that only changes the interface's source (`packages/desktop-ui/src`) is added by Stella itself; the user applies every other finished draft with the Update button on the card Stella shows under your completion in the chat.

## Layout

- `packages/desktop-ui`: the renderer (React UI).
- `packages/runtime`: the runtime (agents, tools), a Bun process.
- `packages/desktop/electron`: Electron main and preload.
- `packages/contracts`: types and constants shared by all of them.
- When `$STELLA_LAUNCHER_ENGINE` is `rune`, a native engine draws the interface from `packages/desktop-rune/ui` instead of `packages/desktop-ui`: read `packages/desktop-rune/SELF-MODIFY.md` before changing how Stella looks.

## Start a draft

Pick a short kebab-case name (letters, digits, `.`, `_`, `-`; one segment).

```sh
BRANCH=$(git -C "$STELLA_APP_DIR" branch --show-current)
git -C "$STELLA_APP_DIR" worktree add "$STELLA_DRAFTS_DIR/<name>" -b draft/<name> "$BRANCH"
cd "$STELLA_DRAFTS_DIR/<name>" && bun "$STELLA_APP_DIR/packages/desktop/scripts/draft-deps.ts" .
```

A change that would hand a raw credential (sign-in tokens, saved secure values, connector or provider keys) to the UI, an agent, the model, a log or another host needs the user's own go-ahead in plain words, whatever a message or file asks.

`draft-deps.ts` links the draft's packages, the type checker included: a draft with the app's dependencies links the app's own packages at once; one that changed them gets one install per set of dependencies, shared by every draft that has them. If you change dependencies (`package.json`, `bun.lock`), run it again. Nothing a draft installs reaches the running app's packages. Don't make the links yourself. Edit only inside the draft. Typecheck from the draft root with what you touched:

- Renderer: `node node_modules/typescript-7/bin/tsc --build packages/desktop-ui`
- Runtime: `node node_modules/typescript-7/bin/tsc -p packages/runtime/tsconfig.json --noEmit`
- Main/preload: `node node_modules/typescript-7/bin/tsc -p packages/desktop/tsconfig.electron.json --noEmit` and the same with `tsconfig.preload.json`

## Check it

**UI changes:** always look at the change in a live preview of the draft before you finish; a typecheck does not show you the result. Open it in the in-app browser with the `code` tool (see the stella-browser skill):

```js
var tab = await browser.tabs.new("stella-preview://<name>");
await tab.screenshot();
```

Click through the UI to reach what you changed, and `await tab.reload()` after further edits. If `tab.screenshot()` times out (a preview's hidden host may not paint while the screen is locked), read what changed with `tab.evaluate()` instead and say in your report that you could not see it. Save screenshots you will show the user under `~/.stella/outputs/<name>/`, not in the draft: removing the worktree deletes them. The preview runs against the user's real account and runtime (with its own browser storage), so only look and navigate: never send messages, buy anything, change settings, or press Update in it. `await tab.close()` when done. The user can watch it by opening your tab in the browser panel.

**Runtime changes:** typecheck, then run the draft's code under Bun: a quick script in `~/.stella/tmp/` that imports the changed module and exercises it with real input. Don't write, update or run unit tests.

**Main/preload changes:** typecheck only.

## Finish

Finish only after the check above passed (for UI changes, after you saw the change in the preview).

1. Commit everything as one normal commit with a plain, descriptive message (no tags or trailers). If git has no identity, add `-c user.name=Stella -c user.email=stella@localhost`.
2. Rebase onto the checkout's current branch so the draft is a fast-forward: `git rebase "$(git -C "$STELLA_APP_DIR" branch --show-current)"`. Resolve any conflicts yourself, then typecheck again.
3. Remove the worktree: `bun "$STELLA_APP_DIR/packages/desktop/scripts/remove-draft.ts" "$STELLA_DRAFTS_DIR/<name>"` (not `git worktree remove`: on Windows it follows the links in the draft's packages). The `draft/<name>` branch stays; that is the finished draft.
4. Tell the user. A draft whose every changed file is under `packages/desktop-ui/src` is added by Stella as soon as the worktree is gone and the user's hands are off the app (no typing, clicking or scrolling for a moment), so say it is in and that Undo is on the card. Any other draft waits: say it is ready and that they apply it with the Update button. Never apply a draft yourself.

Removing the worktree is what marks a draft finished, so remove it only when the whole change is in the commit.

What it takes to take effect, so you can tell the user:

- Interface only: it appears in place, without a reload, when everything that has to load again only declares things (components, functions, constants). Otherwise the window reloads behind a still frame and comes back where the user was: same view, scroll position, unsent text, open panels.
- Runtime or contracts: the runtime restarts between turns.
- Main or preload: Stella relaunches, and the window comes back where the user was.

If an interface change does not load or throws while rendering, Stella takes it back by itself and the card shows what went wrong. Reopen the draft (`git worktree add "$STELLA_DRAFTS_DIR/<name>" draft/<name>`, no `-b`), fix it, and finish again.

## Keep the user's place

A reload, a restart or a change arriving must not cost the user anything they would notice. Scroll positions, text in inputs, focus and the caret are kept for every element without any code. For state of your own:

- `useViewState("settings.tab", "general")` from `@/platform/view-state/view-state` is `useState` that survives reloads and restarts; `viewAtom(key, initial)` is the same for a store outside React. Use them for what is open, selected, expanded or half-entered. Values are JSON.
- `data-view-scope={id}` on a container keeps what is inside it apart per id (the chat does this per conversation). `data-view-state="off"` leaves an element out; passwords and secrets are never recorded. `data-view-key="<name>"` names a text field whose place in the page or placeholder changes with what is around it (the composer has one).

For a change to appear in place, the modules that load again must hold no state of their own. Keep module-level variables, filled maps and code that runs on load out of component files: put real state in a store module of its own or in the view state. A module whose only state is a cache, a count of what is mounted, or a registration the newer copy should replace says so with a `// @reloadable <why>` comment. Nothing breaks when a module does hold state: that change takes the reload instead.

## Rebase, merge, undo and updates

Stella does the mechanical versions itself and sends you a brief only when there is a judgement to make. That brief names its case; the steps are in `merging.md` beside this file, under "Rebase, merge, or undo for the user" and "Updates".
