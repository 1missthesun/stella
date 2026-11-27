# iOS Liquid Glass reference (Stella mobile, real UIGlassEffect)

Captured 2026-11-26 on the iOS 26.2 Simulator (iPhone 17, @3x, 1206×2622) with a dev build of `packages/mobile` at master `519c3a93f`, signed in to a dev test account.
Each shot comes in three forms: `<shot>.jpg` (whole screen, 552×1200), `<shot>--composer-3x.png` (native-pixel crop of the composer band, y 2100–2400) and `<shot>--top-buttons-3x.png` (native-pixel crop of the top buttons, y 170–340).

| Shot | What's under the glass |
|---|---|
| `*-1-table-under-composer` | table rows (busy text) |
| `*-2-code-under-composer` | code block (dense monospace) |
| `*-3-plain-under-composer` | plain page background (black / white) |
| `*-4-blue-under-composer` | bright blue user bubble (saturated colour) |

Units: colours are 8-bit sRGB from the framebuffer. 1 pt = 3 px here, and 1 pt maps to 1 CSS px on the desktop.

## Numbers for the desktop shader

Model: `out = mix(sat(blur(backdrop), S), tint.rgb, tint.a)`, plus a rim. The numbers are fitted from flat backdrop→glass pairs, sampled just outside the glass edge and under it.

### Composer: `glass="regular"`, `tintColor = surface @ 50%`, `interactive`

| | Dark | Light |
|---|---|---|
| over black (0,0,0) | **31,31,32** | n/a |
| over white (255,255,255) | n/a | **253,253,253** |
| over grey bubble | 58,58,60 → **41,41,43** | 233,233,238 → **251,251,255** |
| over blue bubble (40,113,201) | → **33,55,84** | → **205,235,255** |
| effective tint RGBA | **rgba(39,39,40,0.80)** | **rgba(255,255,255,0.82)** |
| backdrop pass-through `1−α` | 0.17–0.26 (≈0.20) | 0.13–0.22 (≈0.18) |
| saturation of what passes, S | ≈1.6× | ≈1.7× (the blue channel clips at 255) |
| blur σ | **≈2.6 pt** (7.8 px @3x, from a 20 px 10–90% edge spread) | same material: text ghosts are as soft |
| rim, inside the edge | 2 px (≈0.7 pt) at +22 then +14 over 31 (**≈+0.09 / +0.05 white**) | ≈+1 level (**invisible**) |
| outer hairline (RN border) | 1 px #38383a, opaque (`panelSurfaceBorder`) | 1 px rgba(214,214,214,0.6), reads 230 on white |
| shadow | **none visible**: the shell's shadow (0,8) r24 at 8% is clipped by `overflow:hidden` | none |
| corner radius | 999 (a pill), or 20 when expanded | same |

### Top buttons and floating buttons: `glass="clear"`, no tint, `interactive`, 40 pt circles

| | Dark | Light |
|---|---|---|
| over black | 0 → **23,23,24** (a lift of +23) | n/a |
| over the dark blue top scrim | 23,41,62 → **18,31,46** (×0.75, hue kept) | n/a |
| over near-white page (242–250) | n/a | → **252,252,253** (brightens) |
| effective tint | ≈ rgba(30,30,32,0.75): even "clear" dims in dark | ≈ rgba(255,255,255,0.75) |
| vertical gradient inside | 22 at the top → 33 at the bottom (lighter toward the bottom) | flat at 251–252 |
| rim | 1 px at +30–40 (RN ring `border@60%` plus the glass rim; the glass alone adds ≈+10–20) | 1 px at 255 (+3) |
| shadow | n/a on black | faint, ≈2–3% black, falling off over ≈10 pt (247→251 beside the button) |

### What this means for Rune
1. Apple's glass here is **not clear**. In dark it is a ~80% veil of ≈#27272A. In light it is a ~80% veil of white. Only ~20% of the backdrop comes through, and that part is more saturated (≈1.6×), so colours under the glass stay tinted rather than going grey.
2. Blur is **modest** (σ ≈ 2.6 pt). Text behind is hidden mostly by the veil, not by heavy blur. The code block under the composer stays faintly readable when the contrast is stretched (see `dark-2-…--composer-3x.png`).
3. The rim is subtle: a ~0.7 pt inner highlight of ~+9% white in dark and nothing visible in light, plus an opaque hairline border drawn by the app.
4. No drop shadow on the composer. Buttons in light get a barely visible soft shadow.
5. Near the edge (within ≈5–8 pt) content is lensed or refracted: text just outside the composer appears displaced inside its top edge (`light-1-…--composer-3x.png`).

## Source (packages/mobile, master 519c3a93f)
- `src/components/glass.tsx:54-91`: `GlassSurface` → `expo-glass-effect` `GlassView`: `glassEffectStyle={{style: present ? glass : "none", animate:true}}`, `isInteractive`, `colorScheme` = app theme (light/dark), `tintColor`, `borderRadius` + `overflow:hidden`. Default `glass="regular"`, radius 16.
- `src/components/glass.tsx:75-76`: `legible` → tint `fadeHex(colors.surface, 0.78)`. Otherwise there is no tint unless one is passed.
- `src/components/glass.tsx:93-103`: the non-glass fallback: dark `rgba(255,255,255,0.06)`, light `rgba(255,255,255,0.72)`.
- `src/components/chat/Composer.tsx:596-603`: the composer uses `glass="regular"`, `interactive`, `tintColor={fadeHex(colors.surface, 0.5)}`, radius 999 or 20.
- `src/components/chat/Composer.tsx:913-923`: the shell has a hairline `panelSurfaceBorder`, `overflow:hidden`, and a shadow (0,8) r24 at 0.08, which is clipped.
- `src/components/GlassIconButtonBase.tsx:76-82, 126-129`: top and nav buttons use `glass="clear"`, interactive, radius = size/2 (40 pt → 20), plus a hairline ring `fadeHex(colors.border, 0.6)`.
- `src/components/chat/FloatingControls.tsx:54-60`: the catch-up pill uses `regular`, `legible`, radius 15. `:140-146`: the scroll-to-bottom FAB uses `clear`, interactive, radius 16.
- `app/onboarding.tsx:293`: Skip uses `regular`, interactive, radius 999.
- Theme values (`src/theme/colors.ts:71`, the default theme): surface light **#ffffff** and dark **#2c2c2e**. So the composer tint is rgba(255,255,255,0.5) in light and rgba(44,44,46,0.5) in dark. border is #d6d6d6 in light and #38383a in dark. The app background is #fff in light and #000 in dark.
- The same tint rule applies in both themes: `surface @ 50%`. Only the theme colour differs, and UIKit's own dark/light glass material (set via `colorScheme` → `overrideUserInterfaceStyle`) supplies the rest of the dimming.
- Native: `expo-glass-effect@57.0.1` `ios/GlassView.swift:123` `UIGlassEffect(style:)`, `:261-264` `effect.tintColor`, `effect.isInteractive`, `overrideUserInterfaceStyle`.
