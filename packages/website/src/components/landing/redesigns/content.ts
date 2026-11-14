/** The one conversation every redesign shows, so each look reads as the same app transformed. */
export const CHAT = {
  stamp: "Today 4:10 PM",
  me1: "Find the receipt for my bike repair and add it to my taxes sheet.",
  her1: "Found it: $186 from Spoke & Wheel on May 3. It's in row 41.",
  me2: "Remind me to pick the bike up Friday.",
  her2: "Done. I'll remind you Friday at 9.",
  placeholder: "Do anything",
};

/**
 * A full Stella window drawn as a pure function of `t` (seconds since it appeared), laid out
 * for exactly one of two sizes: wide 1480x900 or tall 840x1400.
 */
export type SkinProps = { t: number; w: number; h: number };
