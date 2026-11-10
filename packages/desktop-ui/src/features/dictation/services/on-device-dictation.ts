import type {
  OnDeviceDictationStatus,
  OnDeviceTranscript,
} from "@stella/contracts/desktop/ipc-contract";

const languageOf = (tag: string): string => tag.split(/[-_]/)[0]?.toLowerCase() ?? "";

/** Stella's language first, in the system's regional variant when it has one. */
export const dictationLocales = (): string[] => {
  const stella = document.documentElement.dataset.stellaLocale ?? "";
  const system = typeof navigator === "undefined" ? [] : [...(navigator.languages ?? [])];
  const out: string[] = [];
  const add = (tag: string | undefined) => {
    if (tag && !out.includes(tag)) out.push(tag);
  };
  if (stella) {
    for (const tag of system) if (languageOf(tag) === languageOf(stella)) add(tag);
    add(stella);
  } else {
    for (const tag of system) add(tag);
  }
  return out.slice(0, 4);
};

const api = () => window.electronAPI?.dictation;

let cached: { key: string; value: Promise<OnDeviceDictationStatus | null> } | null = null;

export const onDeviceDictationStatus = (): Promise<OnDeviceDictationStatus | null> => {
  const status = api()?.onDeviceStatus;
  if (!status) return Promise.resolve(null);
  const locales = dictationLocales();
  const key = locales.join(",");
  if (cached?.key === key) return cached.value;
  const entry = {
    key,
    value: status({ locales }).catch(() => null),
  };
  cached = entry;
  setTimeout(() => {
    if (cached === entry) cached = null;
  }, 10_000);
  return entry.value;
};

export const invalidateOnDeviceDictation = (): void => {
  cached = null;
};

export const onDeviceDictationAvailable = async (): Promise<boolean> =>
  (await onDeviceDictationStatus())?.available === true;

export const openSystemDictationSettings = (): void => {
  invalidateOnDeviceDictation();
  api()?.openSystemDictationSettings?.();
};

export const transcribeOnDevice = async (wav: ArrayBuffer): Promise<OnDeviceTranscript> => {
  const transcribe = api()?.onDeviceTranscribeFile;
  if (!transcribe) throw new Error("On-device dictation isn't available in this window.");
  return await transcribe({ wav, locales: dictationLocales() });
};

const exactBuffer = (pcm: Int16Array): ArrayBuffer =>
  pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer;

export class OnDeviceDictationStream {
  private readonly sessionId = crypto.randomUUID();
  private opened: Promise<void> | null = null;
  private pending: Int16Array[] = [];
  private ready = false;
  private cancelled = false;

  open(): Promise<void> {
    const start = api()?.onDeviceStart;
    if (!start) return Promise.reject(new Error("On-device dictation isn't available in this window."));
    this.opened = start({ sessionId: this.sessionId, locales: dictationLocales() }).then(() => {
      if (this.cancelled) {
        api()?.onDeviceCancel?.({ sessionId: this.sessionId });
        return;
      }
      this.ready = true;
      for (const chunk of this.pending) this.forward(chunk);
      this.pending = [];
    });
    return this.opened;
  }

  send(pcm: Int16Array): void {
    if (this.cancelled || pcm.length === 0) return;
    if (!this.ready) {
      this.pending.push(pcm.slice());
      return;
    }
    this.forward(pcm);
  }

  private forward(pcm: Int16Array): void {
    api()?.onDeviceAudio?.({ sessionId: this.sessionId, pcm: exactBuffer(pcm) });
  }

  async finish(): Promise<OnDeviceTranscript> {
    await this.opened;
    const finish = api()?.onDeviceFinish;
    if (!finish) throw new Error("On-device dictation isn't available in this window.");
    return await finish({ sessionId: this.sessionId });
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.pending = [];
    if (this.ready) api()?.onDeviceCancel?.({ sessionId: this.sessionId });
  }
}
