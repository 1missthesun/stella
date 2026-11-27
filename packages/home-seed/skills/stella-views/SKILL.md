---
name: stella-views
description: Build a Stella View, a native live mini-app or visual (tracker, dashboard, calculator, small tool, game, explainer) written as one TSX file that Stella draws itself on the user's device and updates within milliseconds as you edit it. Use for anything the user looks at or uses inside Stella when you have the `view` tool or `STELLA_VIEWS=1` is set in your shell; without either, make an HTML page instead.
---

# Stella Views

A view is one `.view.tsx` file. Stella compiles it on the device, runs it in a small sandboxed VM and draws it with its own native components, so it follows the user's theme, needs no browser or server, and keeps working offline. Saving the file swaps the running view to the new code in a few milliseconds and keeps its state.

Views run on the user's phone, in the web chat and in Stella's native desktop app. You can make one when you have the `view` tool (in the cloud and on that desktop) or `STELLA_VIEWS=1` is set in your shell. Without either, build an HTML page.

## Make one

With the `view` tool, call it with a `slug`, a `title` and the whole file as `source` (and `data` for `useData()`). It saves the file, checks it (common mistakes, icon names and the compile devices do), says whether it rendered where Stella draws views, and puts it in the user's chat on every device, live. To change it, call `view` again with the same slug and the whole new file: open copies swap to it and keep their state. Link the path it returns in your report.

Without the tool (`STELLA_VIEWS=1` only), the view reaches only this computer:

1. Write `~/.stella/outputs/views/<slug>.view.tsx`. For a view made from the user's files, put it beside those files instead. Write the whole file in one step (write to `<file>.tmp`, then `mv`) so an open view never reads half a file.
2. Check it:
   ```bash
   bun "$STELLA_APP_DIR/packages/views/scripts/check.ts" ~/.stella/outputs/views/<slug>.view.tsx
   ```
   This type-checks the file against the view API, checks icon names and compiles it the way devices do. When the view is open on this device, it then prints `on screen (rendered in N ms)` or the error it hit while running. Fix every problem it prints. A broken edit never blanks an open view: the last good version stays on screen with the error under it.
3. Show it: link it in your report as `[Title](</absolute/path/<slug>.view.tsx>)`. The user gets it live in the chat and can open it in the panel.

To change a file-only view, edit the file. Small edits are fine, and each save is live.

## The file

```tsx
import { Column, Row, Text, Button, Progress, useStorage } from "@stella/view";

export default function App() {
  const [glasses, setGlasses] = useStorage("glasses", 0);
  return (
    <Column gap={16} padding={20} maxWidth={640}>
      <Text variant="title">Water today</Text>
      <Progress value={glasses / 8} />
      <Row gap={8}>
        <Button variant="primary" icon="plus" onPress={() => setGlasses((n) => n + 1)}>Add a glass</Button>
        <Button variant="ghost" onPress={() => setGlasses((n) => Math.max(0, n - 1))}>Undo</Button>
      </Row>
    </Column>
  );
}
```

- Write React-style TSX with `export default function`. Import everything only from `"@stella/view"`. There are no HTML elements, no CSS, no DOM and no npm packages.
- The full API, with every component, prop and hook documented: `$STELLA_APP_DIR/packages/views/types/view.d.ts`. Read it before your first view. Worked examples: `$STELLA_APP_DIR/packages/desktop-rune/demo/view-samples/`.
- **Layout:** Column, Row, Grid, Stack, Scroll, Spacer, Divider, Pressable. Spacing is in points; sizes take points, `"full"`, `"fit"` or `"50%"`.
- **Content:** Text (variants display, title, heading, subheading, body, label, caption, mono), Markdown, Image, Icon, Code, Video, Audio, Progress.
- **Inputs:** Button, TextField, Checkbox, Switch, Slider, Select, Segmented, Tabs, Disclosure, Modal.
- **Data:** Table (sortable, formatted columns), List (long lists stay fast), Chart (line, area, bar, pie, scatter), Canvas (drawing and pointer input; animate it with `useFrame`).
- **Icons:** any Lucide name, such as `droplet`, `calendar`, `trash-2` or `circle-check`. The checker suggests close names for a wrong one.
- **Colours:** `text`, `muted`, `accent`, `danger`, `success`, `warning`, `surface`, `subtle`, `border`, or hex. Prefer the names: they follow light and dark mode.
- **Hooks:**
  - React's: useState, useReducer, useEffect, useMemo, useCallback, useRef, useContext.
  - `useStorage(key, initial)` keeps a value across restarts.
  - `useData()` reads `<slug>.data.json` beside the view, live. Rewrite that file to update the view's data without touching its code.
  - Also useViewport, useTheme, `useFrame((dt) => …)`, `useInterval(fn, ms)` and `useKey("mod+k", fn)`.
- **`stella`:**
  - `fetch(url, init)` reaches public https APIs.
  - `clipboard.writeText` / `readText`.
  - `openUrl(url)`.
  - `notify(title, { body })`.
  - `saveFile(name, text)` and `pickFile()`.
  - `send(text)` posts to the chat as the user.

State survives a swap by each hook's name and initial value. Renaming a `useState` variable, or changing its initial value, starts that one fresh; everything else carries over. `useStorage` values belong to the file's path, so moving or renaming the file starts them over.

## Design

Design it like a top information designer would for this exact content:

- **First screen:** it answers what the user needs to know or decide.
- **Shapes are drawn:** anything with a shape (a trend, split, comparison or sequence) is a Chart, Canvas or Table, not prose.
- **Narrow-first:** views show in the chat, in a side panel about 400–500 points wide, and on phones. Use one column with `maxWidth` around 640, and nothing that needs a wide screen.
- **Restrained look:** hierarchy comes from Text variants and spacing. Use one accent, and build structure from type and space rather than boxes and borders.
- **Labels:** no subtext that restates its label.
