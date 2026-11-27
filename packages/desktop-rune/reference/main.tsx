import { GALLERY_THEMES } from "../ui/gallery/spec";

const params = new URLSearchParams(location.search);
const requested = params.get("theme") ?? "light";
const themeKey = (requested in GALLERY_THEMES ? requested : "light") as keyof typeof GALLERY_THEMES;
const theme = GALLERY_THEMES[themeKey];
window.__stellaUiState = {
  "stella-theme-id": theme.themeId,
  "stella-custom-base": theme.base,
  "stella-color-mode": theme.mode,
  "stella-gradient-mode": "soft",
  "stella-gradient-color": "relative",
};

await import("@/index.css");
await import("@/ui/register-styles");
await import("@/shared/styles/app-base.css");
await import("@/shared/styles/app-components.css");
await import("@/app/chat/markdown.css");
await import("@/app/chat/full-shell.chat.css");
const { mountReference } = await import("./Reference");
mountReference(document.getElementById("root")!, params.get("page") ?? "buttons", themeKey);
