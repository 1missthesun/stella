import { Doto, Fraunces, Martian_Mono, Pixelify_Sans } from "next/font/google";

export const martian = Martian_Mono({
  variable: "--l-mono",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  preload: false,
});

export const doto = Doto({
  variable: "--l-doto",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export const pixelify = Pixelify_Sans({
  variable: "--l-pixel",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export const fraunces = Fraunces({
  variable: "--l-serif",
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  display: "swap",
  preload: false,
});

export const landingFontVars = [
  martian.variable,
  doto.variable,
  pixelify.variable,
  fraunces.variable,
].join(" ");
