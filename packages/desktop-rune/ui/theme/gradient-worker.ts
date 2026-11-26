import { renderGradientFile, type GradientReply, type GradientRequest } from "./gradient-file";

declare const self: Worker;

self.onmessage = async (e: MessageEvent<GradientRequest>) => {
  self.postMessage((await renderGradientFile(e.data)) satisfies GradientReply);
};
