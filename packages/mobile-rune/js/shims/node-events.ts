type Fn = (...a: any[]) => void;
export class EventEmitter {
  private _e = new Map<string | symbol, Fn[]>();
  on(n: string | symbol, f: Fn) { (this._e.get(n) ?? this._e.set(n, []).get(n)!).push(f); return this; }
  addListener(n: string | symbol, f: Fn) { return this.on(n, f); }
  once(n: string | symbol, f: Fn) { const w = (...a: any[]) => { this.off(n, w); f(...a); }; return this.on(n, w); }
  off(n: string | symbol, f: Fn) { const l = this._e.get(n); if (l) { const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); } return this; }
  removeListener(n: string | symbol, f: Fn) { return this.off(n, f); }
  removeAllListeners(n?: string | symbol) { if (n === undefined) this._e.clear(); else this._e.delete(n); return this; }
  emit(n: string | symbol, ...a: any[]) { const l = this._e.get(n); if (!l?.length) return false; for (const f of [...l]) f(...a); return true; }
  listenerCount(n: string | symbol) { return this._e.get(n)?.length ?? 0; }
  listeners(n: string | symbol) { return [...(this._e.get(n) ?? [])]; }
  setMaxListeners() { return this; }
}
export default EventEmitter;
export const once = (em: EventEmitter, n: string) => new Promise((r) => em.once(n, (...a) => r(a)));
