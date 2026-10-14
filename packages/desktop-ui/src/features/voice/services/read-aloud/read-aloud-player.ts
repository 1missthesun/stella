let context: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let currentStream: StreamPlayback | null = null;

const getContext = (): AudioContext => {
  if (context && context.state !== "closed") return context;
  context = new AudioContext();
  return context;
};

const stopWebAudio = () => {
  if (!currentSource) return;
  try {
    currentSource.onended = null;
    currentSource.stop();
  } catch {
    /* already stopped */
  }
  try {
    currentSource.disconnect();
  } catch {
    /* already disconnected */
  }
  currentSource = null;
};

const stopStream = () => {
  const stream = currentStream;
  currentStream = null;
  if (stream) {
    try {
      stream.teardown();
    } catch {
      /* already torn down */
    }
  }
};

const stopCurrent = () => {
  stopWebAudio();
  stopStream();
};

export type PlayOptions = {
  onEnded?: () => void;
};

export async function playReadAloud(
  encoded: ArrayBuffer,
  options: PlayOptions = {},
): Promise<void> {
  const ctx = getContext();
  if (ctx.state === "suspended") {
    await ctx.resume().catch(() => undefined);
  }

  // decodeAudioData detaches the buffer in newer browsers, so clone
  // once defensively to keep the input usable for callers that retain
  // a reference.
  const decoded = await ctx.decodeAudioData(encoded.slice(0));

  stopCurrent();

  const source = ctx.createBufferSource();
  source.buffer = decoded;
  source.connect(ctx.destination);

  const thisSource = source;
  source.onended = () => {
    if (currentSource === thisSource) {
      currentSource = null;
    }
    options.onEnded?.();
  };

  currentSource = source;
  source.start();
}

const STREAM_MIME = "audio/mpeg";
const KEEP_BEHIND_SECONDS = 3;

type StreamPlayback = { teardown: () => void };

export function canStreamReadAloud(): boolean {
  return (
    typeof MediaSource !== "undefined" &&
    typeof MediaSource.isTypeSupported === "function" &&
    MediaSource.isTypeSupported(STREAM_MIME)
  );
}

export async function playReadAloudStream(
  response: Response,
  options: PlayOptions = {},
): Promise<void> {
  if (!canStreamReadAloud()) {
    throw new Error("read-aloud streaming is not supported");
  }
  const body = response.body;
  if (!body) {
    throw new Error("read-aloud stream response has no body");
  }

  stopCurrent();

  const audio = new Audio();
  audio.autoplay = false;
  audio.preload = "auto";
  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  audio.src = objectUrl;

  const reader = body.getReader();
  const queue: Uint8Array[] = [];
  let sourceBuffer: SourceBuffer | null = null;
  let torn = false;
  let started = false;
  let readerDone = false;
  let endOfStreamSignaled = false;
  let waitingForPlayback = false;

  const teardown = () => {
    if (torn) return;
    torn = true;
    try {
      void reader.cancel().catch(() => undefined);
    } catch {
      /* already released */
    }
    try {
      audio.pause();
    } catch {
      /* ignore */
    }
    try {
      if (sourceBuffer && mediaSource.readyState === "open") {
        sourceBuffer.abort();
      }
    } catch {
      /* ignore */
    }
    try {
      audio.removeAttribute("src");
      audio.load();
    } catch {
      /* ignore */
    }
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      /* ignore */
    }
  };

  const playback: StreamPlayback = { teardown };
  currentStream = playback;

  return await new Promise<void>((resolve, reject) => {
    const detach = () => {
      if (currentStream === playback) currentStream = null;
    };

    const finishStart = () => {
      if (!started) {
        started = true;
        resolve();
      }
    };

    const fail = (error: unknown) => {
      const wasStarted = started;
      detach();
      teardown();
      if (wasStarted) {
        options.onEnded?.();
      } else {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    const playedRange = (slack: number): [number, number] | null => {
      if (!sourceBuffer || sourceBuffer.buffered.length === 0) return null;
      const start = sourceBuffer.buffered.start(0);
      const end = audio.currentTime - KEEP_BEHIND_SECONDS;
      return end > start + slack ? [start, end] : null;
    };

    const removePlayed = (slack: number): boolean => {
      const range = playedRange(slack);
      if (!range || !sourceBuffer) return false;
      try {
        sourceBuffer.remove(range[0], range[1]);
        return true;
      } catch {
        return false;
      }
    };

    const pump = () => {
      if (torn || !sourceBuffer || sourceBuffer.updating) return;
      if (removePlayed(0.5)) return;

      const chunk = queue.shift();
      if (chunk) {
        try {
          sourceBuffer.appendBuffer(chunk as BufferSource);
        } catch (error) {
          if ((error as DOMException)?.name === "QuotaExceededError") {
            queue.unshift(chunk);
            if (!removePlayed(0)) waitingForPlayback = true;
            return;
          }
          fail(error);
        }
        return;
      }

      if (readerDone && !endOfStreamSignaled) {
        endOfStreamSignaled = true;
        try {
          if (mediaSource.readyState === "open") mediaSource.endOfStream();
        } catch {
          /* ignore */
        }
      }
    };

    const readLoop = async () => {
      try {
        while (!torn) {
          const { done, value } = await reader.read();
          if (torn) return;
          if (done) {
            readerDone = true;
            pump();
            return;
          }
          if (value && value.length > 0) {
            queue.push(value);
            pump();
          }
        }
      } catch (error) {
        if (!torn) fail(error);
      }
    };

    audio.onended = () => {
      detach();
      teardown();
      options.onEnded?.();
    };
    audio.onerror = () => fail(new Error("read-aloud audio element error"));
    audio.ontimeupdate = () => {
      if (!waitingForPlayback) return;
      waitingForPlayback = false;
      pump();
    };

    mediaSource.addEventListener(
      "sourceopen",
      () => {
        if (torn) return;
        try {
          sourceBuffer = mediaSource.addSourceBuffer(STREAM_MIME);
        } catch (error) {
          fail(error);
          return;
        }
        sourceBuffer.addEventListener("updateend", () => {
          if (torn) return;
          if (!started && sourceBuffer && sourceBuffer.buffered.length > 0) {
            void audio
              .play()
              .then(finishStart)
              .catch(() => finishStart());
          }
          pump();
        });
        void readLoop();
      },
      { once: true },
    );
  });
}

export function stopReadAloud(): void {
  stopCurrent();
}

export function isReadAloudPlaying(): boolean {
  return currentSource !== null || currentStream !== null;
}
