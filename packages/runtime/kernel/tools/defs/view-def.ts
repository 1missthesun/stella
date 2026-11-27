export const VIEW_TOOL_NAME = "view";

export const VIEW_TOOL_DESCRIPTION =
  "Show a Stella View: a native, live mini-app written as one TSX file, drawn by Stella itself (no browser) and run on the user's device. Prefer it to `html` for anything the user looks at or uses here: dashboards, trackers, tools, calculators, games, explainers, visual answers. Use `html` only for a page that must open as a web link or needs a web library. It shows live in the chat and opens in Stella's panel. Returns the saved path and whether it rendered. To change it, call view again with the same slug and the whole new file: the open view swaps to it within milliseconds and keeps its state (counts, typed text, what's selected).\n\n" +
  "Write React-style TSX: `export default function App() {...}`, hooks and components imported only from \"@stella/view\". No HTML elements, CSS, DOM or npm packages.\n" +
  "- Layout: Column, Row (gap, padding: n | [v,h] | [t,r,b,l], align start|center|end|stretch|baseline, justify start|center|end|between|around|evenly, wrap, grow, width/height/minWidth/maxWidth/minHeight/maxHeight as points | \"full\" | \"fit\" | \"50%\", background, radius sm|md|lg|xl|full|n, border, shadow sm|md|lg, animate), Grid (columns), Stack (layers), Scroll (horizontal, stickToBottom), Spacer, Divider, Pressable (onPress, onLongPress, onHover, onDrag, hoverBackground).\n" +
  "- Content: Text (variant display|title|heading|subheading|body|label|caption|mono, color, weight, size, lines, align, href; nest Text for inline styles), Markdown (children string), Image (src https or data: URI, fit, aspect, zoomable), Icon (name: any Lucide icon name, e.g. search, plus, check, x, trash-2, droplet, calendar, heart, house, sparkles), Code, Video, Audio, Progress (value 0–1).\n" +
  "- Inputs: Button (variant primary|secondary|ghost|danger, icon, onPress), TextField (value, onChange, onSubmit, placeholder, label, multiline), Checkbox, Switch, Slider (min, max, step), Select / Segmented / Tabs (value, options|tabs: string | {value,label}, onChange), Disclosure (title), Modal (open, onClose, title).\n" +
  "- Data: Table (columns {key,title,align,format number|currency|percent|date,sortable,width}, rows, renderCell, onRowPress, striped), List (items, renderItem, itemKey, dividers; long lists stay fast), Chart (type line|area|bar|pie|scatter, data, x, y: field | fields, stacked, format, height), Canvas (width, height, fit, draw(g) with g.rect/circle/ellipse/line/path/polyline/text/image/save/restore/translate/rotate/scale/alpha; onPointer; pair with useFrame to animate).\n" +
  "- Colors: text, muted, accent, danger, success, warning, surface, subtle, border, or any hex. They follow the user's light/dark theme; prefer the names.\n" +
  "- Hooks: useState, useReducer, useEffect, useMemo, useCallback, useRef, useContext; useStorage(key, initial) keeps values across restarts; useData() reads `<slug>.data.json` beside the view, live (pass `data` here or write that file to update it without touching code); useViewport, useTheme, useFrame((dt) => …), useInterval(fn, ms), useKey(\"mod+k\", fn).\n" +
  "- `stella`: fetch(url, init) for public https APIs; clipboard.writeText/readText; openUrl; notify(title, { body }); saveFile(name, text); pickFile(); send(text) posts to this chat as the user.\n\n" +
  "Design it like a top information designer would for this exact content: the first screen answers what the user needs to know or decide; anything with a shape is drawn (Chart, Canvas, Table) rather than described. It shows in Stella's side panel (about 400–500px wide, up to 960px expanded) and on phones, so build it narrow-first: one column, maxWidth about 640, nothing that needs a wide screen. Keep it restrained: hierarchy from Text variants and spacing, one accent, structure from type and space rather than boxes and borders.";

export const VIEW_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    slug: {
      type: "string",
      description:
        "Kebab-case id and filename (e.g. 'trip-budget'), up to 64 chars. The same slug replaces that view and keeps its stored values; a new one makes a new view.",
    },
    title: {
      type: "string",
      description: "Short title for the view's tab and card (e.g. 'Trip budget').",
    },
    source: {
      type: "string",
      description: "The whole .view.tsx file.",
    },
    data: {
      description:
        "Optional JSON the view reads with useData(), saved as <slug>.data.json beside it. Rewrite that file later to update the view without changing its code.",
    },
  },
  required: ["slug", "title", "source"],
};
