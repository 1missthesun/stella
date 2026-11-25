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
      "Generate a still image with the provider chosen in Models → Image (Stella managed, or the user's OpenAI, OpenRouter or Fal key). The call waits for the final outcome and the image appears in the chat, so don't describe or link its path unless asked. Never resubmit, poll or open it: a pending call is reattached after interruptions.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "The image to generate: subject, style, framing, colour, lighting and any text in it.",
        },
        aspectRatio: {
          type: "string",
          description:
            "Optional aspect ratio (e.g. '1:1', '16:9', '9:16', '4:3'). Defaults to the model's choice.",
        },
        size: {
          type: "object",
          description:
            "Exact pixel size, only when no aspectRatio will do. Max edge 3840, 655,360 ≤ width × height ≤ 8,294,400, longest edge ≤ 3× shortest.",
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
            "Local reference images; with any reference the result is an edit of them. At most four references across paths and URLs.",
        },
        referenceImageUrls: {
          type: "array",
          items: { type: "string" },
          maxItems: MAX_MANAGED_IMAGE_REFERENCE_ITEMS,
          description:
            "http(s) or data:image reference URLs; mix with referenceImagePaths freely.",
        },
        allowManagedReferenceUpload: {
          type: "boolean",
          description:
            "Required when local or data:image references go through Stella's managed provider; set it only when the user asked to use those images. They are uploaded encrypted and removed after the request. Not needed for http(s) URLs or the user's own provider key.",
        },
      },
      required: ["prompt"],
    },
    execute: handler,
  };
};
