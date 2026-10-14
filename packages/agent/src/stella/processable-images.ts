import { GenerationTask, hook } from "@earendil-works/pi-durable";
import { withProcessableImages } from "@stella/runtime/kernel/shared/image-payload";

export const processableImagesHook = hook(GenerationTask, {
  beforeRequest: (request) => {
    const messages = withProcessableImages(request.messages);
    return messages === request.messages ? undefined : { messages };
  },
});
