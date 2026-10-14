import { markdownResponse } from "@/lib/agent-pages";
import { SELF_HOST_MD } from "@/lib/self-host-doc";

export const dynamic = "force-static";

export function GET(): Response {
  return markdownResponse(SELF_HOST_MD);
}
