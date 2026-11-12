import type { Niche } from "./types";

/** Hubs, in the order the index lists them. A niche needs at least one published page. */
export const NICHES: Niche[] = [
  {
    slug: "game-mods",
    name: "Game mods",
    h1: "Game mods, installed and working.",
    title: "Game mods: install guides and fixes after updates",
    description:
      "Install Minecraft mods (Fabric, Sodium, Iris) and fix a modpack that crashes with exit code 1. The manual steps, or Stella (stella.sh) doing it for you.",
    intro:
      "Mods break when a game updates, and installing them by hand means matching versions, folders and loaders. Each guide gives the manual way, and Stella (stella.sh) doing it on a real computer where we could record it.",
  },
  {
    slug: "video",
    name: "Video editing",
    h1: "Video edits, done on your computer.",
    title: "Video editing how-tos: subtitles, silences, exports",
    description:
      "How to burn in subtitles and cut silences for TikTok, Reels and YouTube, with free tools or with Stella (stella.sh) working on your own files, with no watermark.",
    intro:
      "Most quick video jobs (captions, trimming dead air, resizing for vertical) are a few commands in free tools. Each guide gives you those, and shows Stella (stella.sh) doing it on a real file.",
  },
  {
    slug: "pc-cleanup",
    name: "PC cleanup",
    h1: "Get your space back, safely.",
    title: "PC cleanup: free up disk space and tidy folders",
    description:
      "Sort a messy Downloads folder, find true duplicates and clear space safely on Windows or Mac, by hand or with Stella (stella.sh), told not to delete anything without asking.",
    intro:
      "Cleaning up is mostly finding what's big, sorting what's left and deciding what can go. Each guide covers the manual way and the Stella (stella.sh) way, with a prompt that tells it to ask before deleting anything.",
  },
  {
    slug: "photos-files",
    name: "Photos and files",
    h1: "Photos and files, put in order.",
    title: "Photos and files: fix dates, rename, organise",
    description:
      "Fix Google Takeout photo dates, rename PDFs by what's inside them and organise big folders of files, with free tools or with Stella (stella.sh) on your own computer.",
    intro:
      "Big batches of photos and documents are where hand-sorting stops being practical. Each guide shows the free manual route, and Stella (stella.sh) doing it on your own computer instead of a converter website.",
  },
  {
    slug: "pdf-excel",
    name: "PDFs and Excel",
    h1: "PDFs and spreadsheets, sorted.",
    title: "PDF and Excel how-tos: compress, convert, combine",
    description:
      "Shrink a PDF that's too large to email and get tables like bank statements into Excel, with free tools or with Stella (stella.sh) on your own files, no uploads.",
    intro:
      "PDFs are where office jobs get fiddly: files too big to send, numbers stuck in tables you can't copy. Each guide shows the free route first, then Stella (stella.sh) doing it with a real file.",
  },
];

export function getNiche(slug: string) {
  return NICHES.find((niche) => niche.slug === slug);
}
