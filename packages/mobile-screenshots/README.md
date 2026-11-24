# Stella store image studio

Eight store slides for every device group, drawn in code: **assistant → computer → approve → trip → create → apps → morning → models**. White, with one continuous aurora strip behind the whole set. Each slide is one short headline and one visual; nothing is cropped and no slide is a wall of chat.

The phone screens are drawn from the app's own pieces (sizes, colours, marks and cards from `packages/mobile/src/components` and `packages/theme`), filled with what Stella makes. Change them when the app's look changes. Keep to things the mobile app does; don't add claims it can't back.

- `src/store/slides.ts` — headlines, order, store sizes.
- `src/components/store/scenes.tsx` — one component per slide. `frames.tsx` hardware, `app.tsx` app pieces.
- `src/app/store.css` — everything visual. Slides are laid out on a 1320-unit-wide canvas and scaled to the store size.
- `public/art` — pictures made with Stella's image model. `lisbon-map.jpg` is drawn from OpenStreetMap by `scripts/render-trip-map.py` (ODbL; the slide shows the credit, keep it). The walking route comes from OpenStreetMap routing.
- `public/brand/store-aura-set.webp` — `bun scripts/render-store-aura.ts set`, the same shader as the earlier panorama with the flat wash lifted toward white.

Store rules that shape the copy: no prices or "free" in screenshots (App Store 2.3.7), no "ask anything" headlines, models are named Claude, ChatGPT, Gemini.

## Preview and export

```sh
bun run dev -- -p 3015      # http://localhost:3015/?device=iphone

STELLA_SCREENSHOT_URL=http://localhost:3015 STELLA_SCREENSHOT_BROWSER_CHANNEL=chrome bun run export:store
STELLA_SCREENSHOT_URL=http://localhost:3015 STELLA_SCREENSHOT_BROWSER_CHANNEL=chrome bun scripts/export-feature-graphic.ts
python3 scripts/review-exports.py out/store-<timestamp>
```

| Device | Size | Group |
| --- | --- | --- |
| iPhone 6.9″ | 1320 × 2868 | `APP_IPHONE_67` |
| iPhone 6.5″ | 1242 × 2688 | `APP_IPHONE_65` |
| iPad 13″ | 2064 × 2752 | `APP_IPAD_PRO_3GEN_129` |
| Android phone | 1080 × 1920 | `phoneScreenshots` |
| Android 7″ tablet | 1080 × 1920 | `sevenInchScreenshots` |
| Android 10″ tablet | 1440 × 2560 | `tenInchScreenshots` |
| Play feature graphic | 1024 × 500 | |

`STELLA_SCREENSHOT_DEVICES=iphone,ipad` limits the groups. The export fails if a picture is missing or any text is cut by its own box or the canvas. Still look at every slide at full size and as a thumbnail: overlaps can't be caught by the check. Exports are ignored by Git; this tool never uploads.

## Chrome Web Store

`bun scripts/export-chrome-store.ts` composes separate, real website captures kept outside Git (`public/chrome-store`, metadata in `SOURCES.json`).
