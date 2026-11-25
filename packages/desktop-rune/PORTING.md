# Porting desktop-ui surfaces to Rune

How every surface of `packages/desktop-ui/src` moves to `packages/desktop-rune/ui`.

## Shape

- `ui/app/` is the root: providers, window set, routing between surfaces. It is owned by the
  shell track, and the other tracks mount their surfaces through it.
- Surfaces live in `ui/shell/**`, `ui/chat/**`, `ui/settings/**`, `ui/global/**`, `ui/apps/**` and
  `ui/usage/**`, mirroring desktop-ui's folders file for file where that helps review. Name a file
  like its desktop-ui source: `ui/chat/Composer.tsx` ↔ `desktop-ui/src/app/chat/Composer.tsx`.
- Logic is imported, not copied. Stores, hooks, services, contracts, i18n and formatting all come
  from `@/…` (desktop-ui, through `host/vite-compat.ts`) or `@stella/*`. The DOM-free parts run
  as they are. Only components that render DOM elements are rewritten, on Rune elements
  (`host/ELEMENTS.md`, `host/rune-jsx/props.ts`) and the kit (`ui/kit`, `ui/theme`).
- When a hook is DOM-bound (it reads refs, `getBoundingClientRect`, `ResizeObserver`, scroll
  positions or CSS), write the Rune equivalent next to the component. Don't fork the store it
  serves. If a DOM-free core needs a small extraction to be importable, put that extraction
  under `ui/` as a wrapper; master's file stays unchanged.
- Styles: translate the CSS that applies, token by token, from `ui/theme`. Match the Electron
  app's look and motion exactly. Don't redesign anything.
- Strings: always use `t()` with desktop-ui's keys. Add no new strings unless desktop-ui has
  them; `bun run i18n:parity` must stay green.

## Proof (unit tests are banned: never write, update or run them)

- Run a real session: `STELLA_RUNE_RUN=<name> bun scripts/session.ts start --account pro`. It
  gives an isolated data dir, a dev test account and a private Xvfb display from `:140`–`:199`.
  Use `eval` to set state and inject input, and `shot` to capture.
- Screenshot only displays you started. Never send input to a display you didn't start.
- Capture the same state in Electron with the verify-stella harness
  (`.agents/skills/verify-stella/SKILL.md`) on its own Xvfb, with `STELLA_VERIFY_RUN=<name>` so
  runs don't collide. Make side-by-sides in `~/.stella/outputs/stella-rune/<track>/`.
- Gates before each push:
  - `node ../../node_modules/typescript-7/bin/tsc -p packages/desktop-rune --noEmit`
  - `bun run i18n:parity`
  - `bun run check:invariants`, with 0 comment violations
  - lint where configured

## Integration

- Each track works in its own worktree on `rune/<track>`. Rebase onto `origin/rune/desktop` and
  fast-forward push: `git push origin rune/<track>:rune/desktop`. Push small and often.
- Element or prop missing? Ask the engine platform. Electron-main behaviour, `electronAPI` or a
  DOM global missing? Ask host services. Kit component missing or wrong? Build it in `ui/kit`
  and tell the others.
- Tick lines in `PARITY.md` only with evidence. Put the evidence path next to the tick.
