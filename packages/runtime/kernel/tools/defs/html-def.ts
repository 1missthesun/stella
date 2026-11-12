export const HTML_TOOL_NAME = "html";

export const HTML_TOOL_DESCRIPTION =
  "Show a complete HTML document as a canvas in the chat and workspace panel. Returns its private link (the user can make it public from Share), or the saved file when no link can be made; the same slug overwrites the same canvas and keeps its link. Sandboxed: inline scripts and styles work; scripts, styles and fonts load only from cdn.jsdelivr.net, unpkg.com, cdnjs.cloudflare.com, cdn.tailwindcss.com, esm.sh and Google Fonts (pin versions, e.g. chart.js@4.4.1), images from any https URL, and fetch() reaches only those CDNs, so keep the content in the HTML itself. Design it like a top information designer would for this exact content: the first screen answers what the reader needs to know or decide; only what changes that stays, with detail folded behind a click (never the answer or what they must act on) and the rest left out, so it reads in about five minutes; and anything with a shape (a comparison, flow, split, trend or sequence) is drawn rather than described. It is read on phones and in Stella's side panel (about 400–500px wide, up to 960px when expanded), so build it narrow-first: one column that looks intentional at phone width, with every chart, table, timeline and comparison made for that width, sitting centred when there's more room. Keep the look restrained and professional: a white or near-black background, one clean sans-serif with hierarchy from size, weight and spacing, one accent colour used sparingly, and consistent spacing, with structure from type and space rather than boxes, cards, badges or decorative labels.";

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
