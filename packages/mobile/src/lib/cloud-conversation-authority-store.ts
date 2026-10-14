import type { CloudConversationIdentity } from "./cloud-conversation-auth";
import type {
  CloudAuthorityIssue,
  CloudConversationAuthority,
} from "./cloud-conversation-authority";

export type CloudAuthorityEntry =
  | { status: "loading"; identityKey: string }
  | {
      status: "ready";
      identityKey: string;
      authority: CloudConversationAuthority;
    }
  | { status: "failed"; identityKey: string; issue: CloudAuthorityIssue };

export type CloudAuthorityStorePorts = {
  resolve: (
    identity: CloudConversationIdentity,
  ) => Promise<CloudConversationAuthority>;
  describeFailure: (error: unknown) => CloudAuthorityIssue;
  onIdentityChange: (identity: CloudConversationIdentity) => void;
};

export class CloudConversationAuthorityStore {
  private identity: CloudConversationIdentity | null = null;
  private entry: CloudAuthorityEntry | null = null;
  private inflight: Promise<void> | null = null;
  private generation = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly ports: CloudAuthorityStorePorts) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): CloudAuthorityEntry | null => this.entry;

  ensure(identity: CloudConversationIdentity): Promise<void> {
    if (this.identity?.identityKey === identity.identityKey && this.entry) {
      return this.inflight ?? Promise.resolve();
    }
    this.generation += 1;
    this.ports.onIdentityChange(identity);
    this.identity = identity;
    return this.start();
  }

  retry(): Promise<void> {
    if (!this.identity) return Promise.resolve();
    return this.start();
  }

  reset(): void {
    this.generation += 1;
    this.identity = null;
    this.inflight = null;
    if (this.entry === null) return;
    this.entry = null;
    this.emit();
  }

  private start(): Promise<void> {
    const identity = this.identity!;
    const generation = ++this.generation;
    this.entry = { status: "loading", identityKey: identity.identityKey };
    this.emit();
    const request = this.ports.resolve(identity).then(
      (authority) => {
        if (generation !== this.generation) return;
        this.entry = {
          status: "ready",
          identityKey: identity.identityKey,
          authority,
        };
        this.emit();
      },
      (error: unknown) => {
        if (generation !== this.generation) return;
        this.entry = {
          status: "failed",
          identityKey: identity.identityKey,
          issue: this.ports.describeFailure(error),
        };
        this.emit();
      },
    );
    const tracked = request.finally(() => {
      if (this.inflight === tracked) this.inflight = null;
    });
    this.inflight = tracked;
    return tracked;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
