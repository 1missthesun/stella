# Changing Stella's interface on Rune

Read this with the modify-stella skill when Stella runs on Rune (`STELLA_LAUNCHER_ENGINE=rune`).
Paths are in `packages/desktop-rune/`. A native engine draws every window, and `ui/` is the whole
interface. Change the look there, not in `packages/desktop-ui/src`: Rune imports desktop-ui's
stores, hooks and i18n, but none of its components or CSS. A finished draft that only touches
`ui/` is added by Stella and swaps into the running window in under a second, with no restart and
no engine build.

- Elements are the engine's (`col`, `row`, `box`, `text`, `input`, ...), not HTML or CSS. Props
  are in `host/ELEMENTS.md`, types in `host/rune-jsx/props.ts`; colours and sizes come from
  `useTokens()` in `ui/theme`. The chat composer is `ui/chat/Composer.tsx`.
- Typecheck from the draft root: `bun packages/desktop-rune/scripts/typecheck.ts`.
- Check in the skill's preview: `stella-preview://<name>` runs the draft's `ui/` in an off-screen
  engine window of its own and shows it in the tab (a new one, or `goto` in one you have open),
  which you click, type into and screenshot as usual. Edits under `ui/` rebuild it by themselves (`tab.reload()` does too); a broken one shows
  its error over the last good frame. The window takes the tab's size. Computer use never drives
  Stella's own window, so look through the preview.

## Effects: glass, metal, light

GPU effects are props on a `col`, `row` or `box`, painted in its shape (`radius`). Use them when
the user asks for glass, metal, a material, a glow or a lit look; ordinary colours and gradients
stay `fill` and `gradient`. Every key, fill and preset: `host/ELEMENTS.md`, "Effects: fx, light,
lit".

- Liquid Glass refracts whatever is behind the element. Give it no `fill` or `gradient` of its own
  (the lens is the surface; `tint` + `veil` colour it), and no `clip` (it cuts the glass's shadow).
  `adapt` dims the veil over busy content; `onBackdrop` reports `{ lum, contrast }` so text can
  flip between light and dark.

  ```tsx
  <col radius={20} border={hairline}
    fx={{ glass: { frost: 0.1, frostSigma: 26, saturation: 1.6, perceptual: true, veil: 0.8, tint: c.background, adapt: 0.25 } }}
    onBackdrop={(b) => setLight((was) => (was ? b.lum > 0.45 : b.lum > 0.6))}>
  ```

- Fills paint the element's shape under its children: `liquidMetal` (presets `chrome` `gold`
  `rose` `gunmetal`), `flutedGlass` (`reeded` `fine` `frosted` `wide`; refracts the backdrop),
  `metaballs` (`lava` `mint`), and `meshGradient` `grainGradient` `waves` `swirl` `voronoi`
  `halftone` `plastic` `dither`. `border: 2` paints only a rim that wide; an array stacks layers.

  ```tsx
  <row radius={24} fx={{ fill: "liquidMetal", preset: "chrome" }}>…</row>
  <col radius={16} fx={[{ fill: "flutedGlass", preset: "reeded" }, { fill: "liquidMetal", preset: "gold", border: 2 }]}>…</col>
  ```

- Light: `light` on a container lights its contents; children opt in with `lit`.

  ```tsx
  <col light={{ ambient: 0.35, lights: [{ x: 180, y: 120, color: "#ffe2bd", intensity: 2 }] }}>
    <col radius={16} fill="#3a3a40" lit={{ raised: 10, bevel: [8, 3] }} />
  </col>
  ```

Cost and limits:

- Glass and the still fills cost nothing at rest: they draw again only when something under or
  around them changes. Animated fills (`liquidMetal`, `metaballs`, `waves`, `swirl`, ...) keep the
  window drawing at the display's refresh while on screen (about 12% of a core for one metal bar
  at 240 Hz), so keep them to small surfaces, not whole panels. A moving `light` costs the same.
- Never fade glass. An element below opacity 1 (an opacity `enter`/`exit`, `opacity` < 1 on it or an
  ancestor) paints in an isolated layer where glass sees no backdrop and turns into a grey slab.
  Glass enters by scale (`enter={{ scale: 0.96, dur: 0.18 }}`).
- Text over metal or a busy fill needs contrast: a dark fill colour on chrome and gold, light on
  `gunmetal`, or a `veil`-heavy glass behind it.
- An unknown fill, preset or key drops that layer (the element draws as before) and logs
  `stella-engine: fx: …` in the host log.
