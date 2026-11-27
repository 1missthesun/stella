// Rune captures the microphone natively on every platform (host/services/microphone-capture.ts),
// where Electron's helper is macOS-only, so dictation never needs the media page's WebView.

export * from "@/features/dictation/services/native-microphone";

export const nativeMicrophoneSupported = (): boolean => true;
