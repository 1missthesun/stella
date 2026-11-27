// Messages between the host and the media page (host/media/page), a system WebView that runs
// desktop-ui's own WebRTC, WebAudio and MediaSource modules. Objects living in the page are named
// by handles: positive ones the host chose (`new`), negative ones the page made (a microphone
// lease). An argument or result `{ $h: handle }` stands for that page object.

export type HandleRef = { $h: number };

export type AnalyserFrame = { freq: string; time: string };

export type ToPage =
  | { t: "state"; values: Record<string, string | null> }
  | { t: "new"; id: number; handle: number; cls: string; args: unknown[] }
  | { t: "call"; id: number; handle: number; method: string; args: unknown[] }
  | { t: "abort"; id: number }
  | { t: "drop"; handle: number }
  | { t: "cbret"; id: number; ok: boolean; value?: unknown; error?: string }
  | { t: "chunk"; stream: number; data?: string; done?: boolean; error?: string }
  | { t: "sample" };

export type FromPage =
  | { t: "hello"; caps: MediaPageCaps }
  | { t: "ret"; id: number; ok: boolean; value?: unknown; error?: string; name?: string }
  | { t: "event"; handle: number; name: string; args: unknown[] }
  | { t: "cb"; id: number; handle: number; name: string; args: unknown[] }
  | { t: "pull"; stream: number }
  | { t: "samples"; frames: Record<string, AnalyserFrame | null> }
  | { t: "log"; level: "debug" | "warn" | "error"; text: string };

export type MediaPageCaps = {
  secureContext: boolean;
  rtc: boolean;
  audioContext: boolean;
  mediaSource: boolean;
  mpegStream: boolean;
  getUserMedia: boolean;
  userAgent: string;
};
