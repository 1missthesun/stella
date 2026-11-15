# Record screen (Show Stella)

The user records their screen while talking, clicking and drawing red marks, and the capture goes to Stella as a message with a transcript and a contact sheet of moments (the show-me skill reads it). macOS only.

## Entry points

- Composer **Add** (+) › **Record screen** (`app/chat/ComposerAddMenu.tsx`, label `app.chat.addMenu.showStella`). It appears only on a Mac whose native `stella_show` helper is installed (`recordScreen.available`); Linux and Windows show only **Attach files…** and **Screenshot**.
- Global shortcut **⌥⇧S** (`Alt+Shift+S`, `packages/desktop/electron/services/show-stella/show-stella-controller.ts`).
- A finish card (native `show_panel` helper) offers send / discard and names the recording; Updates that need a restart wait for the recording ("After your recording").

## How it works

The native helpers capture video, clicks and drawing; the main window transcribes the audio with the user's dictation route (`features/show-stella/use-show-stella.ts`, falling back to the Mac's on-device recognizer), then builds the capture folder and drops it into the composer. Captures live under `captures/…/show-…` in the data folder.

## Driving it

- Needs the Mac, `--own-app-identity` (Screen Recording and Microphone prompts belong to the test identity, never the user's Stella) and native helpers in the checkout: worktrees lack the gitignored `packages/native/out/darwin`, so copy it from the main checkout.
- Keep to one test copy on the Mac and close it when done.
- Evidence: the composer chip after stopping, the capture folder's files, and the sent message's attachment.

## Gotchas

- Record screen shows in the menu only once native helpers are published; a master push must stay the head until `build-native-helpers` finishes or installs never get the helper.
- Renderer screenshots never show native menus or the finish panel; capture those with `screencapture -R`, only when the user isn't using the Mac (`ioreg` HIDIdleTime ≥ 20 s).
