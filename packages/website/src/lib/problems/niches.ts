import type { Niche } from "./types";

/** Hubs, in the order the index lists them. A niche needs at least one published page. */
export const NICHES: Niche[] = [
  {
    slug: "minecraft",
    name: "Minecraft mods",
    h1: "Minecraft mods, installed and working.",
    title: "Minecraft mods: install guides and fixes",
    description:
      "Step-by-step guides for installing Minecraft Java mods with Fabric: Sodium, Iris shaders, Mod Menu and more. Do it yourself, or let Stella (stella.sh) do it.",
    intro:
      "Installing Java Edition mods by hand means matching a loader, a game version and every mod file. Each guide below shows the manual way, and Stella (stella.sh) doing it on a real computer.",
  },
  {
    slug: "video",
    name: "Video editing",
    h1: "Video edits, done on your computer.",
    title: "Video editing how-tos: subtitles, silences, exports",
    description:
      "How to burn in subtitles, cut silences and prepare videos for TikTok, Reels and YouTube, with free tools or with Stella (stella.sh) working on your own files.",
    intro:
      "Most quick video jobs (captions, trimming dead air, resizing for vertical) are a few commands in free tools. Each guide gives you those, and shows Stella (stella.sh) doing it on a real file.",
  },
  {
    slug: "files",
    name: "Files and folders",
    h1: "Tidy files, without the guesswork.",
    title: "Organize files and folders on Windows and Mac",
    description:
      "How to sort a messy Downloads folder, find duplicates and clear space safely on Windows or Mac, by hand or with Stella (stella.sh) asking before anything is deleted.",
    intro:
      "Cleaning up files is mostly sorting, spotting duplicates and deciding what can go. Each guide covers the manual way and shows Stella (stella.sh) doing it, asking before anything is deleted.",
  },
  {
    slug: "excel",
    name: "Excel and PDFs",
    h1: "PDFs and spreadsheets, sorted.",
    title: "Excel and PDF how-tos: statements, tables, merges",
    description:
      "How to get tables out of PDFs and into Excel: bank statements, invoices and reports, with Excel's own tools or with Stella (stella.sh) on your own files.",
    intro:
      "Getting numbers out of PDFs and into a clean spreadsheet is fiddly by hand. Each guide shows Excel's own route first, then Stella (stella.sh) doing it with a real file.",
  },
];

export function getNiche(slug: string) {
  return NICHES.find((niche) => niche.slug === slug);
}
