// A Stella View shared by link. It lives at the same `/c/<slug>` URLs as a shared canvas, with the
// same private/public visibility, owner grants, expiry and revoke (backend/shares.ts): its object in
// the shares bucket is this payload (JSON) tagged `kind: view` instead of a page. The share Worker
// serves the view page (built by packages/desktop-rune/web/share/build.ts into the Worker's static
// assets under VIEW_SHARE_ASSET_PREFIX) with the payload written into it, and the page runs the view
// in PsychoScript's WebAssembly for anyone who opens the link, with no Stella account.

export const VIEW_SHARE_KIND = "view";

/** Where the view page's files are served on the share origin. */
export const VIEW_SHARE_ASSET_PREFIX = "/_view/";
/** The page template the Worker fills in for each shared view. */
export const VIEW_SHARE_PAGE_PATH = `${VIEW_SHARE_ASSET_PREFIX}page.html`;
/** Replaced in the template with the payload's `<script type="application/json">`. */
export const VIEW_SHARE_PAYLOAD_MARKER = "<!--stella-shared-view-->";
/** Replaced in the template with the view's title, escaped. */
export const VIEW_SHARE_TITLE_MARKER = "__STELLA_SHARED_VIEW_TITLE__";
export const VIEW_SHARE_PAYLOAD_ELEMENT_ID = "stella-shared-view";

export type SharedViewPayload = {
  v: 1;
  title: string;
  source: string;
  data?: unknown;
  /** When this version was written. */
  createdAt: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const parseSharedViewPayload = (raw: unknown): SharedViewPayload | null => {
  if (!isRecord(raw) || raw.v !== 1) return null;
  if (typeof raw.title !== "string" || typeof raw.source !== "string" || !raw.source) return null;
  const createdAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : 0;
  return {
    v: 1,
    title: raw.title,
    source: raw.source,
    ...(raw.data !== undefined ? { data: raw.data } : {}),
    createdAt,
  };
};

/** The payload as an inline JSON script, safe inside HTML (no `</script>`, no `<!--`). */
export const sharedViewPayloadScript = (payloadJson: string): string =>
  `<script type="application/json" id="${VIEW_SHARE_PAYLOAD_ELEMENT_ID}">${payloadJson
    .replace(/</gu, "\\u003c")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029")}</script>`;
