type HistoryPageState = {
  conversationId: string | null;
  offsetY: number;
  contentHeight: number;
  layoutHeight: number;
  hasOlder: boolean;
  hasNewer: boolean;
  loading: boolean;
};

export class ChatHistoryPaging {
  private scrolling = false;
  private requested = false;
  private momentumPending = false;
  private gestureConversationId: string | null = null;

  beginDrag(conversationId: string | null): void {
    this.gestureConversationId = conversationId;
    this.scrolling = true;
    this.requested = false;
    this.momentumPending = false;
  }

  endDrag(velocityY = 0): void {
    this.scrolling = false;
    this.momentumPending = velocityY !== 0;
  }

  beginMomentum(): void {
    this.scrolling = this.momentumPending;
    this.momentumPending = false;
  }

  endScroll(): void {
    this.scrolling = false;
    this.momentumPending = false;
  }

  takePage(state: HistoryPageState): "older" | "newer" | null {
    if (
      !this.scrolling ||
      this.requested ||
      state.conversationId !== this.gestureConversationId ||
      state.loading ||
      state.layoutHeight <= 0
    ) {
      return null;
    }
    const threshold = state.layoutHeight * 0.35;
    const page =
      state.hasOlder && state.offsetY <= threshold
        ? "older"
        : state.hasNewer &&
            state.contentHeight - state.offsetY - state.layoutHeight <=
              threshold
          ? "newer"
          : null;
    if (page) this.requested = true;
    return page;
  }
}
