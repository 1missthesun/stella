import { markdownResponse } from "@/lib/agent-pages";
import { renderProductDocsIndex } from "@/lib/product-docs";

export const dynamic = "force-static";

export function GET(): Response {
  return markdownResponse(renderProductDocsIndex());
}
