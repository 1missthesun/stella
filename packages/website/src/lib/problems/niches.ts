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
    title: "Video how-tos: subtitles, silences, file size, MKV to MP4",
    description:
      "Burn in subtitles, cut silences, shrink a video for Discord and convert MKV to MP4 for your TV, with free tools or Stella (stella.sh) on your own files.",
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
    title: "Photos and files: convert, de-duplicate, sort by date, rename",
    description:
      "Convert HEIC to JPG, find duplicate photos, sort photos into folders by date taken, fix Takeout dates and rename PDFs, with free tools or Stella (stella.sh).",
    intro:
      "Big batches of photos and documents are where hand-sorting stops being practical. Each guide shows the free manual route, and Stella (stella.sh) doing it on your own computer instead of a converter website.",
  },
  {
    slug: "pdf-excel",
    name: "PDFs and Excel",
    h1: "PDFs and spreadsheets, sorted.",
    title: "PDF and Excel how-tos: compress, convert, combine, receipts",
    description:
      "Shrink a PDF to email, get bank statements and receipts into Excel and combine Excel files into one sheet, with free tools or Stella (stella.sh), no uploads.",
    intro:
      "PDFs are where office jobs get fiddly: files too big to send, numbers stuck in tables you can't copy. Each guide shows the free route first, then Stella (stella.sh) doing it with a real file.",
  },
  {
    slug: "local-ai",
    name: "AI on your computer",
    h1: "AI that runs on your own computer.",
    title: "Run AI locally: offline models on your own computer",
    description:
      "Set up a small AI model that runs offline on your own computer with Ollama, LM Studio or llama.cpp, or let Stella (stella.sh) install and test one for you.",
    intro:
      "Small AI models now run on ordinary computers with no internet, if you're curious and don't mind them being slower and less clever than ChatGPT or Claude. Each guide gives the manual setup and Stella (stella.sh) doing it on a real computer.",
  },
];

export function getNiche(slug: string) {
  return NICHES.find((niche) => niche.slug === slug);
}
