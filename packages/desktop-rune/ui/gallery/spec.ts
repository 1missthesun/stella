export type GalleryPage = "type" | "buttons" | "controls" | "overlays" | "dialog" | "icons" | "markdown" | "empty";

export const GALLERY_PAGES: GalleryPage[] = ["type", "buttons", "controls", "overlays", "dialog", "icons", "markdown", "empty"];

export const GALLERY_THEMES = {
  light: { themeId: "custom", base: "default", mode: "light" },
  dark: { themeId: "custom", base: "default", mode: "dark" },
  gradient: { themeId: "custom", base: "aura", mode: "dark" },
} as const;

export const GALLERY_MARKDOWN = `## Your Lisbon weekend

I checked your calendar and **nothing clashes**, so here's the plan:

1. Fly out Friday at 18:40 (TAP 1351)
2. Check in at *Casa do Príncipe*, 5 minutes from Príncipe Real
3. Saturday: Belém in the morning, LX Factory after lunch

- Tickets are in \`~/Documents/Travel\`
- The hotel confirmation is [in your inbox](https://mail.google.com)

> Tip: trams fill up after 10am, so go early.

| Day | Plan | Budget |
| --- | --- | ---: |
| Fri | Flight + dinner | €210 |
| Sat | Belém, LX Factory | €95 |
| Sun | Sintra day trip | €60 |

\`\`\`ts
const total = days.reduce((sum, d) => sum + d.budget, 0); // 365
\`\`\`

---

Want me to book the Sintra train too?`;

export const TYPE_WEIGHTS = [200, 300, 400, 500, 600, 700, 800] as const;
export const TYPE_FAMILIES = [
  { family: "Manrope", sizes: [13, 15, 20], weights: TYPE_WEIGHTS },
  { family: "Mona Sans", sizes: [20], weights: [400, 600, 800] },
  { family: "IBM Plex Mono", sizes: [12], weights: [400, 500, 700] },
] as const;
export const TYPE_SAMPLE = "Stella plans your Lisbon weekend 0123";

export const GALLERY_MOTIFS = ["unavailable", "preview", "blank", "changes", "apps", "trash", "updates", "mail"] as const;
