export const MESSAGE_SOUNDS = ["bubble", "marimba", "chime", "pop", "bloop", "twinkle"] as const;

export type MessageSound = (typeof MESSAGE_SOUNDS)[number];

export const DEFAULT_MESSAGE_SOUND: MessageSound = "bubble";

export type MessageSoundPreferences = {
  enabled: boolean;
  sound: MessageSound;
};

export const normalizeMessageSound = (value: unknown): MessageSound =>
  MESSAGE_SOUNDS.includes(value as MessageSound) ? (value as MessageSound) : DEFAULT_MESSAGE_SOUND;

export const messageSoundUrl = (sound: MessageSound): string => `/sounds/message-${sound}.mp3`;

export type UnreadBadge = {
  count: number;
  overlayIconDataUrl?: string;
};
