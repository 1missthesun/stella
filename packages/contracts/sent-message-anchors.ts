export class SentMessageAnchors {
  private readonly anchors = new Map<string, number>();

  note(id: string | undefined, at: number | undefined): void {
    if (!id || typeof at !== "number" || !Number.isFinite(at)) return;
    this.anchors.set(id, at);
  }

  anchorOf(...ids: readonly unknown[]): number | undefined {
    for (const id of ids) {
      if (typeof id !== "string" || !id) continue;
      const anchor = this.anchors.get(id);
      if (anchor !== undefined) return anchor;
    }
    return undefined;
  }

  get size(): number {
    return this.anchors.size;
  }
}
