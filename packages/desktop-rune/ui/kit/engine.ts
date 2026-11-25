type Cmd = Record<string, unknown>;

const send = (v: Cmd) => (globalThis as { stella?: { command?: (v: Cmd) => void } }).stella?.command?.(v);

/** The engine calls the kit makes, over the raw command channel. */
export const engine = {
  colorMotion(dur: number) {
    send({ cmd: "colorMotion", dur });
  },
  fonts(files: string[], sans: string, mono: string) {
    send({ cmd: "fonts", files, sans, mono });
  },
  windowBackground(color: string) {
    send({ cmd: "bg", color });
  },
};
