/**
 * The `html` tool's model-visible surface, split from the executable
 * definition so workerd hosts advertise the byte-identical tool. The device
 * host writes the canvas under `~/.stella/outputs/html/`; the cloud host
 * writes it into the owner's drive. Both then save it to the canvas's
 * private link (`shares.save`) and return that URL, or only the file when the
 * link cannot be made.
 */

export const HTML_TOOL_NAME = "html";

export const HTML_TOOL_DESCRIPTION =
  "Show a complete HTML document as a canvas in the chat and workspace panel. Returns its private link (the user can make it public from Share), or the saved file when no link can be made; the same slug overwrites the same canvas and keeps its link. Sandboxed: inline scripts and styles work; scripts, styles and fonts load only from cdn.jsdelivr.net, unpkg.com, cdnjs.cloudflare.com, cdn.tailwindcss.com, esm.sh and Google Fonts (pin versions, e.g. chart.js@4.4.1), images from any https URL, and fetch() reaches only those CDNs, so keep the content in the HTML itself. House style: spacious layout, soft borders, rounded cards, subtle shadows, Mona Sans display, Manrope body.";

export const HTML_TOOL_PROMPT_SNIPPET =
  "Write a self-contained HTML doc, show it in the Canvas tab, and get its private link";

export const HTML_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    slug: {
      type: "string",
      description:
        "Short kebab-case identifier for this canvas (e.g. 'onboarding-options'). Used as the filename. Lowercase letters, digits, hyphens; max 64 chars. If a canvas with the same slug already exists it is overwritten — use the same slug to iterate, a new slug for a new canvas.",
    },
    title: {
      type: "string",
      description:
        "Short human-readable title shown on the canvas tab/card (e.g. 'Onboarding — 6 directions').",
    },
    html: {
      type: "string",
      description: "Complete <!doctype html> document.",
    },
  },
  required: ["slug", "title", "html"],
};

const HTML_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Canonical slug for a canvas: the caller's if well-formed, else derived. */
export const htmlCanvasSlug = (
  rawSlug: string,
  fallback: string,
  now: number = Date.now(),
): string => {
  if (HTML_SLUG_RE.test(rawSlug)) return rawSlug;
  const lowered = (rawSlug || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return lowered.length > 0 ? lowered : `canvas-${now.toString(36)}`;
};
