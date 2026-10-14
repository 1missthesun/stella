import { defineExtension } from "@earendil-works/pi-durable";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools";

export const STELLA_CODING_EXTENSION = "stella-coding";

export const StellaCoding = defineExtension({
  name: STELLA_CODING_EXTENSION,
  tools: [
    { ...createBashTool(), name: "Bash" },
    { ...createReadTool(), name: "Read" },
    { ...createWriteTool(), name: "Write" },
    { ...createEditTool(), name: "Edit" },
  ],
});
