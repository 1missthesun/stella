export type WorkspaceApp = {
  appId: string;
  slug: string;
  title: string;
  icon?: string;
  revision: string;
  status: "ready" | "error";
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export function parseWorkspaceApps(value: unknown): WorkspaceApp[] {
  if (
    !Array.isArray(value) ||
    value.length > 50 ||
    value.some(
      (app) =>
        !app ||
        typeof app !== "object" ||
        typeof app.slug !== "string" ||
        !/^[a-z][a-z0-9-]{0,31}$/.test(app.slug) ||
        app.appId !== app.slug ||
        typeof app.title !== "string" ||
        (app.icon !== undefined && typeof app.icon !== "string") ||
        typeof app.revision !== "string" ||
        !["ready", "error"].includes(app.status) ||
        !Number.isFinite(app.createdAt) ||
        !Number.isFinite(app.updatedAt) ||
        (app.error !== undefined && typeof app.error !== "string"),
    )
  )
    throw new Error("Invalid app list.");
  return value;
}

export const STELLA_APP_URL_PREFIX = "stella://app/";

const APP_SLUG = /^[a-z][a-z0-9-]{0,31}$/;

export function parseStellaAppUrl(url: string): string | null {
  if (!url.startsWith(STELLA_APP_URL_PREFIX)) return null;
  const slug = url
    .slice(STELLA_APP_URL_PREFIX.length)
    .split(/[/?#]/)[0]!
    .toLowerCase();
  return APP_SLUG.test(slug) ? slug : null;
}

export function extractStellaAppLinkSlugs(text: string): string[] {
  const slugs: string[] = [];
  for (const match of text.matchAll(/stella:\/\/app\/[A-Za-z0-9-]+/g)) {
    const slug = parseStellaAppUrl(match[0]);
    if (slug && !slugs.includes(slug)) slugs.push(slug);
  }
  return slugs.slice(0, 4);
}
