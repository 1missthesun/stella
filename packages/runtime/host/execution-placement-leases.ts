import {
  forkDelayed,
  forkInterval,
  type HostTimerHandle,
} from "./effect-runtime.js";

const HEARTBEAT_INTERVAL_MS = 25_000;
const PRESENCE_SOCKET_RECONNECT_MAX_MS = 30_000;
const EXECUTION_LEASE_RENEWAL_FAILSAFE_MS = 2 * 60_000;
const CLAIM_ACK_RETRY_BASE_MS = 1_000;
const CLAIM_ACK_RETRY_MAX_MS = 15_000;

export class ExecutionPlacementLeases {
  private heartbeatTimer: HostTimerHandle | null = null;
  private heartbeatTask: Promise<void> | null = null;
  private reconnectTimer: HostTimerHandle | null = null;
  private reconnectAttempt = 0;
  private readonly renewalFailureSince = new Map<string, number>();
  private readonly claimAckRetry = new Map<
    string,
    { attempts: number; nextAt: number }
  >();
  private readonly cancellationInFlight = new Map<string, Promise<boolean>>();

  constructor(
    private readonly options: {
      now: () => number;
      leaseRenewalGraceMs?: number;
      claimAckRetryBaseMs?: number;
    },
  ) {}

  startHeartbeat(tick: () => void) {
    this.heartbeatTimer = forkInterval(HEARTBEAT_INTERVAL_MS, tick);
  }

  stopHeartbeat() {
    this.heartbeatTimer?.cancel();
    this.heartbeatTimer = null;
  }

  heartbeat(run: () => Promise<void> | null): Promise<void> {
    if (this.heartbeatTask) return this.heartbeatTask;
    const task = run();
    if (!task) return Promise.resolve();
    this.heartbeatTask = task;
    const clear = () => {
      if (this.heartbeatTask === task) this.heartbeatTask = null;
    };
    void task.then(clear, clear);
    return task;
  }

  joinHeartbeat(): Promise<void> | undefined {
    return this.heartbeatTask?.catch(() => undefined);
  }

  scheduleReconnect(open: () => void) {
    if (this.reconnectTimer) return;
    const attempt = this.reconnectAttempt++;
    const delay = Math.min(
      PRESENCE_SOCKET_RECONNECT_MAX_MS,
      500 * 2 ** Math.min(attempt, 6),
    );
    this.reconnectTimer = forkDelayed(delay, () => {
      this.reconnectTimer = null;
      open();
    });
  }

  cancelReconnect() {
    this.reconnectTimer?.cancel();
    this.reconnectTimer = null;
  }

  resetReconnectBackoff() {
    this.reconnectAttempt = 0;
  }

  clearRenewalFailure(dispatchId: string) {
    this.renewalFailureSince.delete(dispatchId);
  }

  noteRenewalFailure(dispatchId: string, now: number): boolean {
    const failedSince = this.renewalFailureSince.get(dispatchId) ?? now;
    this.renewalFailureSince.set(dispatchId, failedSince);
    return (
      now - failedSince >=
      (this.options.leaseRenewalGraceMs ?? EXECUTION_LEASE_RENEWAL_FAILSAFE_MS)
    );
  }

  noteClaimAckFailure(dispatchId: string) {
    const previous = this.claimAckRetry.get(dispatchId);
    const attempts = (previous?.attempts ?? 0) + 1;
    const baseMs = Math.max(
      1,
      this.options.claimAckRetryBaseMs ?? CLAIM_ACK_RETRY_BASE_MS,
    );
    const delayMs = Math.min(
      CLAIM_ACK_RETRY_MAX_MS,
      baseMs * 2 ** Math.min(attempts - 1, 8),
    );
    this.claimAckRetry.set(dispatchId, {
      attempts,
      nextAt: this.options.now() + delayMs,
    });
  }

  claimAckRetryIsDue(dispatchId: string) {
    const retry = this.claimAckRetry.get(dispatchId);
    return !retry || this.options.now() >= retry.nextAt;
  }

  clearClaimAckRetry(dispatchId: string) {
    this.claimAckRetry.delete(dispatchId);
  }

  clearLeaseHistory() {
    this.renewalFailureSince.clear();
    this.claimAckRetry.clear();
  }

  retryCancellation(
    dispatchId: string,
    run: () => Promise<boolean>,
  ): Promise<boolean> {
    const existing = this.cancellationInFlight.get(dispatchId);
    if (existing) return existing;
    const pending = run();
    this.cancellationInFlight.set(dispatchId, pending);
    const clear = () => {
      if (this.cancellationInFlight.get(dispatchId) === pending) {
        this.cancellationInFlight.delete(dispatchId);
      }
    };
    void pending.then(clear, clear);
    return pending;
  }

  cancellationsInFlight(): Promise<boolean>[] {
    return [...this.cancellationInFlight.values()];
  }
}
