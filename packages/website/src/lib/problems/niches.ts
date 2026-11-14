import type { Niche } from "./types";

/** Hubs, in the order the index lists them. A niche needs at least one published page. */
export const NICHES: Niche[] = [
  {
    slug: "game-mods",
    name: "Game mods",
    h1: "Game mods, installed and working.",
    title: "Game mods: install guides and fixes after updates",
    description:
      "Install Minecraft mods and resource packs, give a modpack more RAM and fix exit code 1 crashes. The manual steps, or Stella (stella.sh) doing it for you.",
    intro:
      "Mods break when a game updates, and installing them by hand means matching versions, folders and loaders. Each guide gives the manual way, and Stella (stella.sh) doing it on a real computer where we could record it.",
  },
  {
    slug: "video",
    name: "Video editing",
    h1: "Video edits, done on your computer.",
    title: "Video how-tos: subtitles, silences, merging, MKV to MP4",
    description:
      "Burn in subtitles, cut silences, join clips into one video, shrink a video for Discord and convert MKV to MP4, with free tools or Stella (stella.sh).",
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
    title: "Photos and files: convert, resize, de-duplicate, sort, rename",
    description:
      "Convert HEIC to JPG, resize photos in bulk, remove their location, find duplicates, sort by date taken and rename PDFs, with free tools or Stella (stella.sh).",
    intro:
      "Big batches of photos and documents are where hand-sorting stops being practical. Each guide shows the free manual route, and Stella (stella.sh) doing it on your own computer instead of a converter website.",
  },
  {
    slug: "pdf-excel",
    name: "PDFs and Excel",
    h1: "PDFs and spreadsheets, sorted.",
    title: "PDF and Excel how-tos: split, redact, compress, compare",
    description:
      "Split, redact, unlock and number PDFs, get statements and receipts into Excel, and compare or combine spreadsheets, with free tools or Stella (stella.sh).",
    intro:
      "PDFs are where office jobs get fiddly: files too big to send, numbers stuck in tables you can't copy. Each guide shows the free route first, then Stella (stella.sh) doing it with a real file.",
  },
  {
    slug: "documents",
    name: "Word and documents",
    h1: "Letters and documents, filled in.",
    title: "Document how-tos: mail merge and Word letters",
    description:
      "Make one Word letter per person from an Excel sheet, with Word's own mail merge or Stella (stella.sh) filling your template on your own computer.",
    intro:
      "Documents eat time in the repetitive parts: the same letter for sixteen people, each with their own name, fee and date. Each guide shows the way to do it in Word, and Stella (stella.sh) doing it on a real computer.",
  },
  {
    slug: "audio",
    name: "Audio and music",
    h1: "Music and audio files, fixed in bulk.",
    title: "Audio how-tos: MP3 tags, FLAC to MP3, voice memos to text",
    description:
      "Fix MP3s that show Unknown Artist, add album art, convert FLAC to MP3 for the car and turn voice memos into text, with free tools or Stella (stella.sh).",
    intro:
      "Music and recordings go wrong in batches: a whole album with no tags, a format the car won't play, memos you'd rather read than replay. Each guide gives the free tool route, and Stella (stella.sh) doing it on real files.",
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
