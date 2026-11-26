export const HTML_TOOL_NAME = "html";

export const HTML_TOOL_DESCRIPTION =
  "Show a complete HTML document as a canvas in the chat and workspace panel. Returns its private link (the user can make it public from Share), or the saved file when no link can be made; the same slug overwrites the same canvas and keeps its link. Sandboxed: inline scripts and styles work; scripts, styles and fonts load only from cdn.jsdelivr.net, unpkg.com, cdnjs.cloudflare.com, cdn.tailwindcss.com, esm.sh and Google Fonts (pin versions, e.g. chart.js@4.4.1), images from any https URL, and fetch() reaches only those CDNs, so keep the content in the HTML itself. Design it like a top information designer would for this exact content: the first screen answers what the reader needs to know or decide; only what changes that stays, with detail folded behind a click (never the answer or what they must act on) and the rest left out, so it reads in about five minutes; and anything with a shape (a comparison, flow, split, trend or sequence) is drawn rather than described. It is read on phones and in Stella's side panel (about 400–500px wide, up to 960px when expanded), so build it narrow-first: one column that looks intentional at phone width, with every chart, table, timeline and comparison made for that width, sitting centred when there's more room. Keep the look restrained and professional: a white or near-black background, one clean sans-serif with hierarchy from size, weight and spacing, one accent colour used sparingly, and consistent spacing, with structure from type and space rather than boxes, cards, badges or decorative labels.\n\n" +
  "Controls can act: declare them in `actions` ({ id, label }) and mark each control `data-stella-action=\"<id>\"` (a button or any element; on a <form> its fields go along on submit; `data-stella-value` adds a `value`). A tap reaches you as a message from the user that is one <canvas-action> block naming the canvas, the action's id and label, and its fields. Only declared ids work, the page can't send one without a real tap, and the chat shows the user your label, so a tap is their yes to exactly what the label says, sending or paying included; fields are whatever the page sent (their typing, or anything the page shows), so what an action commits them to belongs in its label, never in a field. After a tap the control gets `data-stella-state` \"sending\", then \"sent\" (disabled unless it has `data-stella-repeat`) or \"failed\"; the page can listen for `stella:action` on `document`. To show what came of it, call html again with the same slug.";


export const HTML_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    slug: {
      type: "string",
      description:
        "Kebab-case id and filename (e.g. 'onboarding-options'), up to 64 chars. The same slug overwrites that canvas; a new one makes a new canvas.",
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
    actions: {
      type: "array",
      description:
        "The controls in the page that send something back to you, each { id, label }: id as the page names it in data-stella-action (letters, digits, ':', '.', '_', '-'), label what tapping it does in the user's words (\"Send the reply to Ana\").",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
        },
        required: ["id", "label"],
      },
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
