import { markdownResponse } from "@/lib/agent-pages";
import { renderHowIndexMarkdown } from "@/lib/problems/markdown";

export const dynamic = "force-static";

export function GET(): Response {
  return markdownResponse(renderHowIndexMarkdown());
}
