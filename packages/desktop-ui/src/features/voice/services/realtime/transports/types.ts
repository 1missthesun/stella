export type RealtimeTransportProvider = "gptlive" | "openai" | "xai";

export type SdpAnswerFetcher = (
  sdpOffer: string,
  signal: AbortSignal,
) => Promise<string>;

export interface RealtimeTransportEvents {
  onEvent: (event: Record<string, unknown>) => void;
  onClose: (reason: string) => void;
}

export interface RealtimeTransport {
  readonly provider: RealtimeTransportProvider;
  readonly model: string;

  connect(events: RealtimeTransportEvents): Promise<void>;

  send(event: Record<string, unknown>): void;

  setMicEnabled(enabled: boolean): Promise<void>;

  applySoftInputMute(muted: boolean): void;

  getMicAnalyser(): AnalyserNode | null;

  getOutputAnalyser(): AnalyserNode | null;

  interruptPlayback(): void;

  disconnect(): Promise<void>;
}
