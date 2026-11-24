import { STELLA_PROMPT_SCHEMA_VERSION } from "@stella/contracts/stella-prompts";

import { STELLA_PROMPT_DEFAULTS } from "./defaults.generated.js";
import { STELLA_PROMPT_LEGACY } from "./legacy.generated.js";

type Publication = Readonly<{
  revision: string;
  publishedAt: number;
  prompts: readonly Readonly<{ id: string; sha256: string; content: string }>[];
}>;

const promptsRoute = (publication: Publication) => {
  const etag = `"${publication.revision}"`;
  const body = JSON.stringify({
    schemaVersion: STELLA_PROMPT_SCHEMA_VERSION,
    revision: publication.revision,
    publishedAt: publication.publishedAt,
    prompts: publication.prompts.map(({ id, sha256, content }) => ({
      id,
      sha256,
      content,
    })),
  });
  return (request: Request): Response => {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control":
        "public, max-age=60, s-maxage=300, stale-while-revalidate=300",
      "Content-Type": "application/json; charset=utf-8",
      ETag: etag,
    };
    // Edge compression may weaken the ETag a client echoes back.
    if (request.headers.get("if-none-match")?.replace(/^W\//u, "") === etag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(body, { status: 200, headers });
  };
};

export const stellaPromptsResponse = promptsRoute(STELLA_PROMPT_DEFAULTS);

/** For desktops from before explicit messaging (`src/prompts/legacy/`). */
export const stellaLegacyPromptsResponse = promptsRoute(STELLA_PROMPT_LEGACY);
