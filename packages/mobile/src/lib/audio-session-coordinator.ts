export type MobileAudioMode = {
  allowsRecording?: boolean;
  playsInSilentMode?: boolean;
  [key: string]: unknown;
};

export type RecordingAudioLease = number;

export type PlaybackHolder = symbol;

type ApplyAudioMode = (mode: MobileAudioMode) => Promise<void>;
type DeactivateAudioSession = () => Promise<void>;

/**
 * Serializes process-global audio-mode changes and gives recording immediate
 * priority over playback. On iOS, applying a mode whose `allowsRecording`
 * field is false synchronously stops every Expo audio recorder, so unrelated
 * playback setup must never race a live microphone lease.
 */
export class AudioSessionCoordinator {
  private activeRecordingLease: RecordingAudioLease | null = null;
  private readonly playbackHolders = new Set<PlaybackHolder>();
  private nextLease = 0;
  private operations: Promise<void> = Promise.resolve();

  constructor(
    private readonly applyAudioMode: ApplyAudioMode,
    private readonly deactivateAudioSession: DeactivateAudioSession = async () => {},
  ) {}

  acquireRecording(
    mode: MobileAudioMode = { playsInSilentMode: true },
  ): Promise<RecordingAudioLease | null> {
    const lease = ++this.nextLease;
    // Claim synchronously. Playback requests queued before this point re-check
    // the claim before touching the native session.
    this.activeRecordingLease = lease;

    return this.enqueue(async () => {
      if (this.activeRecordingLease !== lease) return null;
      try {
        await this.applyAudioMode({
          ...mode,
          allowsRecording: true,
        });
      } catch (error) {
        if (this.activeRecordingLease === lease) {
          this.activeRecordingLease = null;
        }
        throw error;
      }
      return this.activeRecordingLease === lease ? lease : null;
    });
  }

  refreshRecording(
    lease: RecordingAudioLease,
    mode: MobileAudioMode,
  ): Promise<boolean> {
    if (this.activeRecordingLease !== lease) return Promise.resolve(false);
    return this.enqueue(async () => {
      if (this.activeRecordingLease !== lease) return false;
      await this.applyAudioMode({ ...mode, allowsRecording: true });
      return this.activeRecordingLease === lease;
    });
  }

  releaseRecording(lease: RecordingAudioLease): Promise<void> {
    if (this.activeRecordingLease !== lease) return Promise.resolve();
    this.activeRecordingLease = null;

    return this.enqueue(async () => {
      // A newer recording claim was made while this release waited in line.
      if (this.activeRecordingLease !== null) return;
      await this.applyAudioMode({ allowsRecording: false });
    });
  }

  configurePlayback(mode: MobileAudioMode = {}): Promise<boolean> {
    if (this.activeRecordingLease !== null) return Promise.resolve(false);

    return this.enqueue(async () => {
      if (this.activeRecordingLease !== null) return false;
      await this.applyAudioMode({
        ...mode,
        allowsRecording: false,
        playsInSilentMode: true,
      });
      // If recording claimed the session while the native call was in flight,
      // its queued recording mode runs next. The playback caller must not start
      // a player in the meantime.
      return this.activeRecordingLease === null;
    });
  }

  holdPlayback(holder: PlaybackHolder): boolean {
    if (this.activeRecordingLease !== null) return false;
    this.playbackHolders.add(holder);
    return true;
  }

  acquirePlayback(
    holder: PlaybackHolder,
    mode: MobileAudioMode = {},
  ): Promise<boolean> {
    if (!this.holdPlayback(holder)) return Promise.resolve(false);

    return this.enqueue(async () => {
      if (!this.playbackHolders.has(holder)) return false;
      if (this.activeRecordingLease !== null) {
        this.playbackHolders.delete(holder);
        return false;
      }
      try {
        await this.applyAudioMode({
          ...mode,
          allowsRecording: false,
          playsInSilentMode: true,
        });
      } catch (error) {
        this.playbackHolders.delete(holder);
        throw error;
      }
      if (this.activeRecordingLease !== null) {
        this.playbackHolders.delete(holder);
        return false;
      }
      return this.playbackHolders.has(holder);
    });
  }

  releasePlayback(holder: PlaybackHolder): Promise<void> {
    if (!this.playbackHolders.delete(holder)) return Promise.resolve();
    if (!this.canDeactivate()) return Promise.resolve();

    return this.enqueue(async () => {
      if (!this.canDeactivate()) return;
      await this.deactivateAudioSession();
    });
  }

  private canDeactivate() {
    return this.playbackHolders.size === 0 && this.activeRecordingLease === null;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation, operation);
    this.operations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
