export type TranscriptRole = "user" | "assistant";

export type CompletedTranscriptTurn = {
  role: TranscriptRole;
  text: string;
  startMs: number;
  endMs: number;
};

const TURN_GAP_MS = 1_200;
const TURN_IDLE_MS = 800;
const MAX_RETAINED_TURNS = 24;

type OpenTurn = {
  role: TranscriptRole;
  parts: string[];
  startMs: number;
  endMs: number;
};

const joinFragments = (parts: readonly string[]): string => {
  let text = "";
  for (const part of parts) {
    if (!part) continue;
    if (!text) {
      text = part;
      continue;
    }
    const needsSpace =
      !/\s$/.test(text) && !/^\s/.test(part) && !/^[,.!?;:)\]}'"]/.test(part);
    text += needsSpace ? ` ${part}` : part;
  }
  return text.replace(/\s+/g, " ").trim();
};

export class TranscriptAccumulator {
  private open: OpenTurn | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private turns: CompletedTranscriptTurn[] = [];

  constructor(
    private readonly handlers: {
      onPartial: (role: TranscriptRole, text: string) => void;
      onTurn: (turn: CompletedTranscriptTurn) => void;
    },
  ) {}

  push(args: {
    role: TranscriptRole;
    delta: string;
    startMs?: number;
    endMs?: number;
  }): void {
    const delta = args.delta;
    if (!delta) return;

    const startMs = Number.isFinite(args.startMs)
      ? (args.startMs as number)
      : (this.open?.endMs ?? 0);
    const endMs = Number.isFinite(args.endMs)
      ? (args.endMs as number)
      : startMs;

    if (this.open) {
      const roleChanged = this.open.role !== args.role;
      const gapped = startMs - this.open.endMs > TURN_GAP_MS;
      if (roleChanged || gapped) this.flush();
    }

    if (!this.open) {
      this.open = { role: args.role, parts: [], startMs, endMs };
    }
    this.open.parts.push(delta);
    this.open.endMs = Math.max(this.open.endMs, endMs);

    this.handlers.onPartial(args.role, delta);
    this.armIdleTimer();
  }

  flush(): CompletedTranscriptTurn | null {
    this.clearIdleTimer();
    const open = this.open;
    this.open = null;
    if (!open) return null;

    const text = joinFragments(open.parts);
    if (!text) return null;

    const turn: CompletedTranscriptTurn = {
      role: open.role,
      text,
      startMs: open.startMs,
      endMs: open.endMs,
    };
    this.turns.push(turn);
    if (this.turns.length > MAX_RETAINED_TURNS) {
      this.turns.splice(0, this.turns.length - MAX_RETAINED_TURNS);
    }
    this.handlers.onTurn(turn);
    return turn;
  }

  snapshot(): CompletedTranscriptTurn[] {
    const pending = this.open
      ? [
          {
            role: this.open.role,
            text: joinFragments(this.open.parts),
            startMs: this.open.startMs,
            endMs: this.open.endMs,
          },
        ].filter((turn) => turn.text.length > 0)
      : [];
    return [...this.turns, ...pending];
  }

  recentUserTurns(limit: number): CompletedTranscriptTurn[] {
    return this.snapshot()
      .filter((turn) => turn.role === "user")
      .slice(-limit);
  }

  reset(): void {
    this.clearIdleTimer();
    this.open = null;
    this.turns = [];
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.flush();
    }, TURN_IDLE_MS);
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}
