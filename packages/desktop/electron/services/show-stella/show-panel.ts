import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolveNativeHelperPath } from "../../native-helper-path.js";

const HELPER = "show_panel";

/** A rectangle in Electron screen points. */
export type PanelRect = { x: number; y: number; width: number; height: number };

export type PanelCard = {
  /** Horizontal centre and top edge, in screen points. */
  x: number;
  y: number;
  title: string;
  status: string | null;
  image: string | null;
  sendEnabled: boolean;
  strings: { note: string; send: string; open: string; discard: string };
};

export type PanelEvent =
  | { event: "ready" }
  | { event: "hit"; id: string }
  | { event: "card"; action: "send" | "open" | "discard"; note: string }
  | { event: "engaged"; on: boolean; typing?: boolean };

/**
 * Show Stella's clickable surfaces on macOS (the ⇧ catch layer, the bar's
 * Done, the finish card), drawn by the `show_panel` helper as panels that
 * never activate Stella. Electron's windows bring Stella forward on any
 * click, which would pull the user out of the app they're showing.
 */
export class ShowPanel {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";

  constructor(private readonly onEvent: (event: PanelEvent) => void) {}

  static available(): boolean {
    return process.platform === "darwin" && Boolean(resolveNativeHelperPath(HELPER));
  }

  private ensure(): ChildProcessWithoutNullStreams | null {
    if (this.child && this.child.exitCode === null && !this.child.killed) return this.child;
    const helper = resolveNativeHelperPath(HELPER);
    if (!helper) return null;
    const child = spawn(helper, [], { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf("\n");
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        newline = this.buffer.indexOf("\n");
        if (!line) continue;
        try {
          this.onEvent(JSON.parse(line) as PanelEvent);
        } catch {
          // Not a message.
        }
      }
    });
    child.stderr.on("data", () => undefined);
    child.on("error", (error) => console.warn("[show-stella] panel helper:", error.message));
    child.on("exit", () => {
      if (this.child === child) this.child = null;
    });
    child.stdin.on("error", () => undefined);
    return child;
  }

  private send(message: Record<string, unknown>): void {
    const child = this.ensure();
    if (!child || !child.stdin.writable) return;
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /**
   * While armed, ⇧ held on its own puts a click-catching layer over `rect`;
   * the helper watches ⇧ itself so a quick ⇧-click can't beat it. Null disarms.
   */
  arm(rect: PanelRect | null): void {
    if (!rect && !this.child) return;
    this.send({ cmd: "arm", rect });
  }

  setHit(id: string, rect: PanelRect | null): void {
    if (!rect && !this.child) return;
    this.send({ cmd: "hit", id, rect });
  }

  showCard(card: PanelCard): void {
    this.send({ cmd: "card", card });
  }

  hideCard(): void {
    if (this.child) this.send({ cmd: "hideCard" });
  }

  dispose(): void {
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      child.stdin.end(`${JSON.stringify({ cmd: "quit" })}\n`);
    } catch {
      child.kill();
    }
  }
}
