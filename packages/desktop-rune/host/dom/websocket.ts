// A browser dispatches each WebSocket message as its own task, so work React schedules from one
// message (its scheduler runs on setImmediate here) runs before the next message arrives. Bun
// delivers a burst of buffered messages back to back in one turn, which lets a fast server chain
// dozens of commits without a render in between. This WebSocket hands its "message" listeners one
// message per task, after the microtasks and immediates the previous one queued.

type MessageListener = EventListenerOrEventListenerObject;

export function installTaskWebSocket(): void {
  const g = globalThis as Record<string, any>;
  const Native: typeof WebSocket = g.WebSocket;
  if (!Native || (Native as any).__taskMessages) return;

  class TaskWebSocket extends Native {
    static readonly __taskMessages = true;
    #queue: MessageEvent[] = [];
    #busy = false;
    #handler: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
    #listeners = new EventTarget();

    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      super.addEventListener("message", (event) => {
        this.#queue.push(event as MessageEvent);
        if (!this.#busy) this.#pump();
      });
    }

    #pump = (): void => {
      const event = this.#queue.shift();
      if (!event) {
        this.#busy = false;
        return;
      }
      this.#busy = true;
      try {
        this.#deliver(event);
      } finally {
        queueMicrotask(() => setImmediate(this.#pump));
      }
    };

    #deliver(event: MessageEvent): void {
      const copy = new MessageEvent("message", { data: event.data, origin: event.origin, lastEventId: event.lastEventId });
      Object.defineProperty(copy, "target", { value: this });
      Object.defineProperty(copy, "currentTarget", { value: this });
      try {
        this.#handler?.call(this, copy);
      } catch (error) {
        reportError(error);
      }
      this.#listeners.dispatchEvent(copy);
    }

    override get onmessage(): ((this: WebSocket, ev: MessageEvent) => any) | null {
      return this.#handler;
    }

    override set onmessage(handler: ((this: WebSocket, ev: MessageEvent) => any) | null) {
      this.#handler = typeof handler === "function" ? handler : null;
    }

    override addEventListener(type: string, listener: MessageListener | null, options?: boolean | AddEventListenerOptions): void {
      if (type === "message") this.#listeners.addEventListener(type, listener, options);
      else super.addEventListener(type, listener as any, options);
    }

    override removeEventListener(type: string, listener: MessageListener | null, options?: boolean | EventListenerOptions): void {
      if (type === "message") this.#listeners.removeEventListener(type, listener, options);
      else super.removeEventListener(type, listener as any, options);
    }
  }

  g.WebSocket = TaskWebSocket;
}
