import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import { MAX_MANAGED_IMAGE_REFERENCE_ITEMS } from "../managed-image-references.js";
import { createMediaToolHandlers } from "../media.js";
import type { ToolDefinition, ToolHandler } from "../types.js";

export type ImageGenToolOptions = {
  getCloudBackendAuth?: () => { baseUrl: string; authToken: string } | null;
};

export const createImageGenTool = (
  options: ImageGenToolOptions,
): ToolDefinition => {
  const handlers = createMediaToolHandlers(options);
  const handler = handlers.image_gen as ToolHandler;
  return {
    name: "image_gen",
    replay: "keyed",
    agentTypes: [AGENT_IDS.ORCHESTRATOR],
    description:
      "Generate a still image with the provider chosen in Settings (Stella managed, or the user's OpenAI, OpenRouter or Fal key). The call waits for the final outcome and the image appears in the chat, so don't describe or link its path unless asked. Never resubmit, poll or open it: a pending call is reattached after interruptions.",
    promptSnippet:
      "Generate a still image and return its terminal artifact result",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Description of the image to generate. Be specific about subject, style, framing, color, lighting, and any text overlays.",
        },
        aspectRatio: {
          type: "string",
          description:
            "Optional aspect ratio (e.g. '1:1', '16:9', '9:16', '4:3'). Defaults to the model's choice.",
        },
        size: {
          type: "object",
          description:
            "Optional explicit pixel dimensions. Only set this when the default aspectRatio presets won't do (e.g. sprite atlases at non-standard sizes). Subject to the model envelope: max edge ≤ 3840, 655,360 ≤ width × height ≤ 8,294,400, longest edge ≤ 3× shortest edge.",
          properties: {
            width: { type: "integer", minimum: 1 },
            height: { type: "integer", minimum: 1 },
          },
          required: ["width", "height"],
        },
        quality: {
          type: "string",
          enum: ["low", "medium", "high", "xhigh", "max"],
          description:
            "Optional quality. Defaults to 'low'; use a higher one only when the user explicitly asks for more fidelity.",
        },
        referenceImagePaths: {
          type: "array",
          items: { type: "string" },
          maxItems: MAX_MANAGED_IMAGE_REFERENCE_ITEMS,
          description:
            "Optional local image paths to use as reference inputs. At most four total references may be supplied across paths and URLs. Managed generation safely normalizes local bytes into a bounded upload envelope. When any reference is provided the image is an edit of them.",
        },
        referenceImageUrls: {
          type: "array",
          items: { type: "string" },
          maxItems: MAX_MANAGED_IMAGE_REFERENCE_ITEMS,
          description:
            "Optional remote http(s) image URLs or validated data:image URLs to use as reference inputs. At most four total references may be supplied across URLs and paths. Mix with referenceImagePaths when you have a local subject photo plus catalog product photos.",
        },
        allowManagedReferenceUpload: {
          type: "boolean",
          description:
            "Required whenever local or inline bytes are sent through the Stella managed provider, including referenceImagePaths, attachment-derived data URLs, and data:image entries in referenceImageUrls. Set true only when the user explicitly asked to use those images; references are uploaded encrypted for managed processing and removed after submission settles. Remote http(s) URLs do not require this flag. BYOK providers receive references directly and do not use Stella managed storage.",
        },
      },
      required: ["prompt"],
    },
    execute: handler,
  };
};
