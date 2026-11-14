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
      "Sort a messy Downloads folder, find what's taking up space, delete empty folders and clear duplicates on Windows or Mac, by hand or with Stella (stella.sh).",
    intro:
      "Cleaning up is mostly finding what's big, sorting what's left and deciding what can go. Each guide covers the manual way and the Stella (stella.sh) way, and says exactly what Stella deleted in the recorded run and what it left for you to decide.",
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
    slug: "files-folders",
    name: "Files and folders",
    h1: "Files and folders, opened and tidied.",
    title: "Files and folders: open RAR and 7z, unzip, rename, search",
    description:
      "Open RAR and 7z files, unzip many zips at once, rename files in bulk, search inside documents and split folders for email, with free tools or Stella (stella.sh).",
    intro:
      "Archives that won't open, hundreds of files with the wrong names, a document you know mentions someone but can't find. Each guide gives the free route on Windows and Mac, and shows Stella (stella.sh) doing it on a real folder.",
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
    h1: "Word documents, letters and PDFs, sorted.",
    title: "Document how-tos: Word, PDF, invoices and mail merge",
    description:
      "Mail merge from Excel, merge or bulk-convert Word files, PDF to Word, slides with notes, invoices and a cookbook, by hand or with Stella (stella.sh) on your computer.",
    intro:
      "Documents eat time in the repetitive parts: the same letter for sixteen people, a name to change in ten templates, a folder to turn into PDFs, a PDF you need to edit. Each guide shows the way to do it in Word or a free tool, and Stella (stella.sh) doing it on a real computer.",
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
    slug: "contacts-calendar-email",
    name: "Contacts, calendars and email",
    h1: "Contacts, calendars and email, converted.",
    title: "Contacts, calendar and email files: VCF, CSV, ICS, EML",
    description:
      "Convert contacts between CSV and VCF, merge duplicate contacts, turn a calendar into a spreadsheet and saved emails into one PDF, with free tools or Stella (stella.sh).",
    intro:
      "Moving contacts to a new phone or getting a calendar into a spreadsheet means odd file formats and garbled names. Each guide gives the free route, usually through Google or Outlook, and Stella (stella.sh) doing it on your own computer instead of an upload site.",
  },
  {
    slug: "study",
    name: "Study",
    h1: "Study materials, made from what you have.",
    title: "Study how-tos: Anki cards, printable flashcards, Kindle highlights",
    description:
      "Turn notes into Anki flashcards, print double-sided flashcards that line up and export Kindle highlights into one file per book, by hand or with Stella (stella.sh).",
    intro:
      "Making study material is mostly copying: terms into cards, highlights into notes. Each guide gives the manual way, and Stella (stella.sh) doing it from your own files on a real computer.",
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
