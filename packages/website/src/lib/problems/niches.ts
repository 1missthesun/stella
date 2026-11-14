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
    title: "Video how-tos: subtitles, cutting, vertical crops, converting",
    description:
      "Add subtitles or music, cut out parts, crop to vertical, make quiet videos louder, and convert MOV, MKV, WebM or AVI to MP4, with free tools or Stella (stella.sh).",
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
      "Convert HEIC, WebP or TIFF to JPG, remove backgrounds, split scans, watermark or date-stamp photos, fix dates and duplicates, with free tools or Stella (stella.sh).",
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
    title: "PDF and Excel how-tos: merge, split, sign, convert",
    description:
      "Merge, split, sign and edit PDFs, pull text and tables out of them, and get JSON, XML, text or Numbers files into Excel, with free tools or Stella (stella.sh).",
    intro:
      "Merge, split, sign or edit a PDF, get the numbers out of one, or turn an export Excel won't open into a sheet you can sort. Each guide shows the free route first, then Stella (stella.sh) doing it with a real file.",
    sections: [
      {
        title: "Merge, split and tidy PDFs.",
        slugs: [
          "merge-pdf-files",
          "split-pdf-into-multiple-files",
          "extract-pages-from-pdf",
          "delete-pages-from-pdf",
          "reorder-pdf-pages",
          "rotate-pdf-pages",
          "split-pdf-pages-in-half",
          "add-page-numbers-to-pdf",
          "compress-pdf-too-large-to-email",
        ],
      },
      {
        title: "Edit, sign and protect PDFs.",
        slugs: ["edit-text-in-pdf", "add-signature-to-pdf", "fill-pdf-form-from-spreadsheet", "redact-pdf", "remove-password-from-pdf"],
      },
      {
        title: "Get text, tables and pictures out of PDFs.",
        slugs: [
          "extract-text-from-pdf",
          "make-scanned-pdf-searchable",
          "extract-table-from-pdf-to-excel",
          "extract-images-from-pdf",
          "convert-pdf-to-jpg",
          "convert-excel-to-pdf-without-cutting-off",
          "convert-epub-to-pdf",
          "convert-mobi-to-epub",
        ],
      },
      {
        title: "Get files into Excel, and back out.",
        slugs: [
          "convert-json-to-excel",
          "convert-xml-to-excel",
          "convert-text-file-to-excel",
          "convert-numbers-to-excel",
          "convert-word-table-to-excel",
          "convert-excel-to-csv",
        ],
      },
      {
        title: "Split, combine and clean spreadsheets.",
        slugs: [
          "split-excel-sheet-into-multiple-files",
          "split-csv-file-into-multiple-files",
          "combine-excel-files-into-one-sheet",
          "merge-two-spreadsheets-by-matching-column",
          "compare-two-excel-files",
          "remove-duplicate-rows-in-excel",
          "fix-dates-in-excel",
          "fix-garbled-characters-in-csv",
          "summarize-spreadsheet-by-category",
        ],
      },
      {
        title: "Statements, receipts and bills.",
        slugs: ["bank-statement-pdf-to-excel", "find-subscriptions-in-bank-statement", "receipts-to-spreadsheet", "split-bills-with-roommates"],
      },
    ],
  },
  {
    slug: "money-household",
    name: "Money and household",
    h1: "Your money files, added up properly.",
    title: "Money how-tos: budgets, bank files, double charges, mileage",
    description:
      "Make a budget from bank downloads, find double charges, open OFX and QIF files, total mileage or timesheets, and see your Amazon spending, with Stella (stella.sh).",
    intro:
      "Bank downloads, order histories and logs already hold the answer; the work is adding them up without counting anything twice. Each guide gives the spreadsheet route, and Stella (stella.sh) doing it from files you download yourself, with no bank login shared. None of it is financial or tax advice.",
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
    h1: "Music and recordings, sorted and ready to play.",
    title: "Audio and music how-tos: convert, join, split, practise",
    description:
      "Convert WMA or FLAC to MP3, fix tags, trim silence, even out volume, make ringtones and audiobooks, or practice tracks, with free tools or Stella (stella.sh).",
    intro:
      "Audio goes wrong in batches: memos the car won't play, lessons in the wrong order, songs at different volumes. Musicians want practice copies: slower, in their key, without the singer. Each guide gives the free tool route, and Stella (stella.sh) doing it on real files, with what it installed and how good the result is.",
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
    slug: "chats-data-exports",
    name: "Chats and data exports",
    h1: "Read the data apps give you.",
    title: "Chat and data exports: WhatsApp, Messenger, Instagram, Spotify",
    description:
      "Turn a WhatsApp or Messenger export into a readable PDF, see who doesn't follow you back on Instagram, or your all-time Spotify stats, from your own data download.",
    intro:
      "Apps let you download your data, then hand you a zip of text and JSON files nobody can read. You request the download from the service yourself; each guide shows how, the free manual route, and Stella (stella.sh) turning the files into an answer or a PDF on your computer, with no login or upload site.",
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
    slug: "printing-labels",
    name: "Printing and labels",
    h1: "Labels, badges and cards, printed from your own lists.",
    title: "Printing how-tos: labels, name tags, certificates, QR codes",
    description:
      "Print address and barcode labels from Excel, name tags, certificates, QR codes, business cards, passport photos and posters, by hand or with Stella (stella.sh).",
    intro:
      "Printing from a list goes wrong in the details: ZIP codes that lose their zero, labels that drift off the sheet, a double sign-up with two badges. Each guide gives the Word or free-tool route, and Stella (stella.sh) making the print file from a real list on your computer.",
  },
  {
    slug: "weddings-events",
    name: "Weddings and events",
    h1: "Guest lists into headcounts, seating charts and place cards.",
    title: "Wedding and event how-tos: RSVPs, seating charts, place cards",
    description:
      "Count RSVPs when guests replied twice, make a seating chart and place cards from your guest list, and number raffle tickets, in Excel or with Stella (stella.sh).",
    intro:
      "Event planning runs on one spreadsheet that never quite agrees with itself. Each guide shows the Excel or Word way, and Stella (stella.sh) turning a real guest list or form export into the headcount and the printables.",
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
