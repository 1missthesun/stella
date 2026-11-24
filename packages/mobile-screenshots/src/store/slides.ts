export const slides = [
  { slug: "assistant", title: ["Your personal", "assistant."] },
  { slug: "computer", title: ["Your computer,", "in your pocket."], tabletTitle: ["Your computer,", "from anywhere."] },
  { slug: "approve", title: ["You just", "say yes."] },
  { slug: "trip", title: ["Plans the", "whole trip."] },
  { slug: "create", title: ["Make what", "you imagine."] },
  { slug: "apps", title: ["Apps made", "just for you."] },
  { slug: "morning", title: ["Ready before", "you are."] },
  { slug: "models", title: ["Bring the AI", "you pay for."] },
] as const satisfies readonly { slug: string; title: readonly [string, string]; tabletTitle?: readonly [string, string] }[];

export type SlideSlug = (typeof slides)[number]["slug"];

export const devices = {
  iphone: { label: "iPhone 6.9″", width: 1320, height: 2868, group: "APP_IPHONE_67", frame: "iphone" },
  iphone65: { label: "iPhone 6.5″", width: 1242, height: 2688, group: "APP_IPHONE_65", frame: "iphone" },
  ipad: { label: "iPad 13″", width: 2064, height: 2752, group: "APP_IPAD_PRO_3GEN_129", frame: "ipad" },
  android: { label: "Android phone", width: 1080, height: 1920, group: "phoneScreenshots", frame: "android" },
  android7: { label: "Android 7″ tablet", width: 1080, height: 1920, group: "sevenInchScreenshots", frame: "androidTablet" },
  android10: { label: "Android 10″ tablet", width: 1440, height: 2560, group: "tenInchScreenshots", frame: "androidTablet" },
} as const;

export type Device = keyof typeof devices;
export type Frame = (typeof devices)[Device]["frame"];

/** Every slide is laid out on a canvas this many units wide, then scaled to the store size. */
export const CANVAS = 1320;
