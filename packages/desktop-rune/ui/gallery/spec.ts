export type GalleryPage = "buttons" | "controls" | "overlays" | "dialog" | "icons" | "markdown" | "empty";

export const GALLERY_PAGES: GalleryPage[] = ["buttons", "controls", "overlays", "dialog", "icons", "markdown", "empty"];

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
