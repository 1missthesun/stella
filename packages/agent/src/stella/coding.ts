import { defineExtension } from "@earendil-works/pi-durable";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools";

export const STELLA_CODING_EXTENSION = "stella-coding";

const fileTools = [
  { ...createReadTool(), name: "Read" },
  { ...createWriteTool(), name: "Write" },
  { ...createEditTool(), name: "Edit" },
];

export const StellaCoding = defineExtension({
  name: STELLA_CODING_EXTENSION,
  tools: [{ ...createBashTool(), name: "Bash" }, ...fileTools],
});

/** For a host whose tool host runs `Bash` and `write_stdin` itself. */
export const StellaCodingFiles = defineExtension({
  name: STELLA_CODING_EXTENSION,
  tools: fileTools,
});
