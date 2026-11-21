# Stella's desktop app

This folder is the source of the Stella desktop app on this computer, and the
app runs from it. Change it only in a draft, as the `modify-stella` skill
describes: never edit, commit in, merge into or push this checkout itself.

## What is here

- `packages/desktop-ui`: the window's interface (React).
- `packages/runtime` and `packages/agent`: the runtime (agents, tools), a Bun process.
- `packages/desktop/electron`: Electron main and preload.
- `packages/contracts`: types and constants they share.
- `packages/theme`, `packages/home-seed`, `packages/model-catalog`,
  `packages/stella-browser`, `packages/stella-office`, `packages/native`:
  theme, the files a new Stella home starts with, model list, and the
  browser, Office and native helpers.

Stella's phone app and its cloud service are not part of this copy and can't
be changed from it. A change the user asks for applies to this desktop app;
say plainly when part of what they want lives in the phone app or the cloud.

## Checking a change

Typecheck from the draft's root what you touched (the type checker comes
with the draft's packages):

- Interface: `node node_modules/typescript-7/bin/tsc --build packages/desktop-ui`
- Runtime: `node node_modules/typescript-7/bin/tsc -p packages/runtime/tsconfig.json --noEmit`
- Main/preload: `node node_modules/typescript-7/bin/tsc -p packages/desktop/tsconfig.electron.json --noEmit`
  and the same with `tsconfig.preload.json`

Don't write or run unit tests; look at the change in the real app as the
skill describes.
