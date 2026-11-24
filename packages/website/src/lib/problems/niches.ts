import type { Niche } from "./types";

/** Hubs, in the order the index lists them. A niche needs at least one published page. */
export const NICHES: Niche[] = [
  {
    slug: "game-mods",
    recommended: "claude",
    name: "Game mods",
    h1: "Game mods, installed and working.",
    title: "Game mods: get them in your game, fixed or made for you",
    description:
      "Mods for GTA, Skyrim, Fallout, Baldur's Gate 3, Stardew Valley, Minecraft and more: installed, fixed or made for you by Stella (stella.sh).",
    intro:
      "Pick your game, say what you want, and play it. Stella (stella.sh) installs mods, fixes the ones that broke and makes new ones.",
    sections: [
      { title: "Grand Theft Auto and Red Dead.", slugs: ["gta-6-mods", "mod-gta-5", "gta-5-mods-not-working", "gta-5-car-mods", "install-script-hook-v", "install-fivem-mods", "mod-gta-san-andreas", "mod-rdr2"] },
      { title: "Skyrim, Fallout and Starfield.", slugs: ["mod-skyrim", "install-skse", "skyrim-load-order", "skyrim-crash-log", "mod-fallout-4", "downgrade-fallout-4", "install-f4se", "mod-fallout-new-vegas", "mod-starfield", "mod-oblivion-remastered"] },
      { title: "Big adventures.", slugs: ["mod-baldurs-gate-3", "bg3-mods-not-working", "bg3-script-extender", "mod-cyberpunk-2077", "cyberpunk-mods-not-working-after-2-5", "mod-elden-ring", "elden-ring-seamless-co-op", "mod-witcher-3", "witcher-3-script-merger", "mod-hogwarts-legacy", "mod-monster-hunter-wilds", "mod-resident-evil-4"] },
      { title: "Minecraft.", slugs: ["install-minecraft-mods", "install-sodium-iris-minecraft-1-21-fabric", "install-minecraft-shaders", "make-a-minecraft-mod", "make-a-minecraft-modpack", "install-minecraft-resource-pack", "install-minecraft-datapacks", "install-minecraft-map", "allocate-more-ram-to-minecraft", "minecraft-modpack-exit-code-1", "back-up-minecraft-worlds", "fix-corrupted-minecraft-world", "turn-on-cheats-in-minecraft-world", "find-all-minecraft-screenshots"] },
      { title: "Cosy, building and survival.", slugs: ["mod-stardew-valley", "stardew-valley-mods-not-working", "install-sims-4-mods", "find-broken-sims-4-mods", "mod-valheim", "mod-terraria", "mod-rimworld", "mod-palworld", "mod-subnautica", "mod-project-zomboid", "mod-cities-skylines-2", "mod-lethal-company", "mod-balatro", "mod-silksong"] },
      { title: "Driving.", slugs: ["assetto-corsa-mods", "beamng-mods", "euro-truck-simulator-2-mods"] },
      { title: "Mod managers and making your own.", slugs: ["ai-mod-maker", "make-a-skyrim-mod", "install-nexus-mods", "vortex-mod-manager", "mod-organizer-2", "vortex-to-mod-organizer-2", "r2modman-thunderstore", "install-bepinex", "steam-deck-mods"] },
    ],
  },
  {
    slug: "video",
    name: "Video editing",
    h1: "Video edits, done on your computer.",
    title: "Video how-tos: subtitles, cutting, vertical crops, converting",
    description:
      "Add subtitles or music, cut out parts, crop to vertical, make quiet videos louder, and convert MOV, MKV, WebM or AVI to MP4. Just ask Stella (stella.sh).",
    intro:
      "Subtitles, cuts, crops and converting. Tell Stella (stella.sh) what the video needs and get it back done.",
  },
  {
    slug: "pc-cleanup",
    name: "PC cleanup",
    h1: "Get your space back, safely.",
    title: "PC cleanup: free up disk space and tidy folders",
    description:
      "Sort a messy Downloads folder, find what's taking up space, delete empty folders and clear duplicates on Windows or Mac. Just ask Stella (stella.sh).",
    intro:
      "Find what's filling your computer and clear it out. Just ask Stella (stella.sh).",
  },
  {
    slug: "photos-files",
    name: "Photos and files",
    h1: "Photos and files, put in order.",
    title: "Photos and files: convert, resize, de-duplicate, sort, rename",
    description:
      "Convert HEIC, WebP, TIFF or RAW to JPG, remove backgrounds, split scans, watermark or date-stamp photos, fix dates and duplicates. Just ask Stella (stella.sh).",
    intro:
      "Convert, sort, fix and tidy hundreds of photos in one go. Just ask Stella (stella.sh).",
  },
  {
    slug: "files-folders",
    name: "Files and folders",
    h1: "Files and folders, opened and tidied.",
    title: "Files and folders: open RAR and 7z, unzip, rename, search",
    description:
      "Open RAR and 7z files, unzip many zips at once, rename files in bulk, search inside documents and split folders for email. Just ask Stella (stella.sh).",
    intro:
      "Open it, rename it, find it, shrink it. Tell Stella (stella.sh) what you need done with your files.",
  },
  {
    slug: "pdf-excel",
    name: "PDFs and Excel",
    h1: "PDFs and spreadsheets, sorted.",
    title: "PDF and Excel how-tos: merge, split, sign, convert",
    description:
      "Merge, split, sign and edit PDFs, pull text and tables out of them, and get JSON, XML, text or Numbers files into Excel. Just ask Stella (stella.sh).",
    intro:
      "Merge it, split it, sign it, or get the numbers out of it. Give the file to Stella (stella.sh) and ask.",
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
        slugs: ["edit-text-in-pdf", "add-signature-to-pdf", "fill-pdf-form-from-spreadsheet", "add-watermark-to-pdf", "redact-pdf", "remove-password-from-pdf"],
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
      "Budgets, receipts, mileage and double charges, worked out for you by Stella (stella.sh) from your own files.",
  },
  {
    slug: "documents",
    name: "Word and documents",
    h1: "Word documents, letters and PDFs, sorted.",
    title: "Document how-tos: Word, PDF, invoices and mail merge",
    description:
      "Mail merge from Excel, merge or bulk-convert Word files, PDF to Word, slides with notes, invoices and a cookbook. Just ask Stella (stella.sh).",
    intro:
      "Letters, slides, invoices and whole folders of Word files, done in one go by Stella (stella.sh).",
  },
  {
    slug: "audio",
    name: "Audio and music",
    h1: "Music and recordings, sorted and ready to play.",
    title: "Audio and music how-tos: convert, join, split, practise",
    description:
      "Convert WMA or FLAC to MP3, fix tags, trim silence, even out volume, make ringtones and audiobooks, or practice tracks. Just ask Stella (stella.sh).",
    intro:
      "Convert, trim, tidy and practise with your music and recordings. Just ask Stella (stella.sh).",
  },
  {
    slug: "contacts-calendar-email",
    name: "Contacts, calendars and email",
    h1: "Contacts, calendars and email, converted.",
    title: "Contacts, calendar and email files: VCF, CSV, ICS, EML",
    description:
      "Convert contacts between CSV and VCF, merge duplicate contacts, turn a calendar into a spreadsheet and saved emails into one PDF. Just ask Stella (stella.sh).",
    intro:
      "Contacts, calendars and emails moved, cleaned up or turned into a file by Stella (stella.sh).",
  },
  {
    slug: "chats-data-exports",
    name: "Chats and data exports",
    h1: "Read the data apps give you.",
    title: "Chat and data exports: WhatsApp, Messenger, Instagram, Spotify",
    description:
      "Turn a WhatsApp or Messenger export into a readable PDF, see who doesn't follow you back on Instagram, or your all-time Spotify stats, from your own data download.",
    intro:
      "Your chats and account downloads, turned into something you can read by Stella (stella.sh).",
  },
  {
    slug: "study",
    name: "Study",
    h1: "Study materials, made from what you have.",
    title: "Study how-tos: flashcards, study guides, puzzles, timetables",
    description:
      "Turn notes into Anki cards or a study guide, print flashcards, word searches and crosswords, or build a timetable or reference list. Just ask Stella (stella.sh).",
    intro:
      "Flashcards, worksheets, timetables and references made from your own notes by Stella (stella.sh).",
  },
  {
    slug: "printing-labels",
    name: "Printing and labels",
    h1: "Labels, badges and cards, printed from your own lists.",
    title: "Printing how-tos: labels, name tags, certificates, QR codes",
    description:
      "Print address and barcode labels from Excel, name tags, certificates, QR codes, business cards, passport photos and posters. Just ask Stella (stella.sh).",
    intro:
      "Labels, badges, posters and cards, ready to print from your list. Just ask Stella (stella.sh).",
  },
  {
    slug: "weddings-events",
    name: "Weddings and events",
    h1: "Guest lists into headcounts, seating charts and place cards.",
    title: "Wedding and event how-tos: RSVPs, seating charts, place cards",
    description:
      "Count RSVPs when guests replied twice, make a seating chart and place cards from your guest list, and number raffle tickets, in Excel or with Stella (stella.sh).",
    intro:
      "Guest lists, headcounts and printables, sorted out by Stella (stella.sh) from the list you already have.",
  },
  {
    slug: "reading-writing",
    name: "Reading and writing",
    h1: "Books, comics and writing in the format you need.",
    title: "Reading and writing: ebooks, comics, Markdown and manuscripts",
    description:
      "Convert PDF and Word to EPUB, merge ebooks, turn comics into PDFs, Markdown notes into Word or PDF, and format a manuscript. Just ask Stella (stella.sh).",
    intro:
      "Ebooks, comics, notes and manuscripts in the format you need. Just ask Stella (stella.sh).",
  },
  {
    slug: "hobbies",
    name: "Hobbies",
    h1: "Hobby files, rewritten or ready to print.",
    title: "Hobby how-tos: transpose chords, scale recipes, family trees",
    description:
      "Transpose a folder of chord sheets, scale recipes for a crowd and print a family tree chart from a GEDCOM file. Just ask Stella (stella.sh).",
    intro:
      "Chord sheets, recipes and family records, tidied up by Stella (stella.sh).",
  },
  {
    slug: "torrenting",
    recommended: "gemini",
    name: "Torrenting",
    h1: "Torrents, set up, fixed and automated.",
    title: "Torrenting made easy: set up, fixed and sorted",
    description:
      "Set up qBittorrent, fix stuck or slow torrents, get new releases by themselves and sort it all for Plex. Just ask Stella (stella.sh).",
    intro:
      "Say what you want to download, or what's stuck. Stella (stella.sh) does the rest on your computer.",
  },
  {
    slug: "reverse-engineering",
    recommended: "gemini",
    name: "Reverse engineering",
    h1: "Programs, games and files, taken apart.",
    title: "Reverse engineering made easy: just ask",
    description:
      "See what's inside a program, app, game or old file, or change it. Decompile, edit, patch and extract by asking Stella (stella.sh).",
    intro:
      "See what's inside a program, app or game, or change it. Give it to Stella (stella.sh) and ask.",
    sections: [
      {
        title: "Programs.",
        slugs: ["decompile-exe-to-source-code", "use-ai-with-ghidra", "decompile-dotnet-dll-to-csharp", "decompile-python-exe", "patch-exe-file", "is-this-exe-safe", "extract-files-from-exe-installer"],
      },
      { title: "Android, Java and scripts.", slugs: ["decompile-apk", "edit-apk", "decompile-jar-file", "deobfuscate-javascript", "extract-electron-asar", "decompile-lua"] },
      { title: "Games.", slugs: ["edit-save-file", "extract-unity-game-assets", "decompile-unity-game", "decompile-godot-game", "extract-renpy-rpa", "extract-pak-files"] },
      { title: "Formats, networks and devices.", slugs: ["reverse-engineer-a-file-format", "decode-network-protocol-from-pcap", "reverse-engineer-website-api", "inspect-app-traffic-with-mitmproxy", "extract-firmware"] },
    ],
  },
  {
    slug: "emulation",
    recommended: "gemini",
    name: "Emulators and retro games",
    h1: "Console and retro games, on your computer.",
    title: "Emulators made easy: Switch, PS2, PS3, 3DS, GameCube, RetroArch",
    description:
      "Set up Switch, PS2, PS3, 3DS, GameCube and RetroArch emulators, fix stutter and controllers, patch ROMs and move saves. Just ask Stella (stella.sh).",
    intro:
      "Say which console and which game. Stella (stella.sh) sets up the emulator, the controller and the saves.",
    sections: [
      { title: "Nintendo Switch and 3DS.", slugs: ["set-up-switch-emulator-on-pc",  "switch-emulator-firmware-and-keys",  "switch-emulator-stuttering",  "set-up-azahar-3ds-emulator"] },
      { title: "PlayStation.", slugs: ["set-up-pcsx2",  "pcsx2-stuttering-fix",  "set-up-rpcs3",  "ps1-emulator-for-pc",  "psp-emulator-for-pc"] },
      { title: "GameCube, Wii and retro consoles.", slugs: ["set-up-dolphin-emulator",  "set-up-retroarch",  "retroarch-missing-bios",  "patch-rom-hacks-and-fan-translations"] },
      { title: "Controllers, saves and Steam Deck.", slugs: ["emulator-controller-not-working",  "transfer-saves-between-emulators",  "set-up-emudeck-steam-deck"] },
    ],
  },
  {
    slug: "local-ai",
    recommended: "claude",
    name: "Local AI and ComfyUI",
    h1: "AI that runs on your own computer.",
    title: "Local AI made easy: ComfyUI, Ollama and models on your PC",
    description:
      "Install ComfyUI, fix broken nodes and workflows, add models and LoRAs, run Ollama and fix CUDA or VRAM errors. Just ask Stella (stella.sh).",
    intro:
      "Image makers and chat models that run on your own graphics card, set up and fixed by Stella (stella.sh).",
    sections: [
      { title: "Setting up ComfyUI.", slugs: ["install-comfyui",  "add-models-and-loras-to-comfyui",  "install-stable-diffusion-forge"] },
      { title: "Making pictures.", slugs: ["comfyui-text-to-image-workflow",  "comfyui-upscale-image-workflow",  "run-flux-locally"] },
      { title: "Fixing ComfyUI errors.", slugs: ["comfyui-missing-custom-nodes",  "fix-comfyui-workflow-errors",  "torch-not-compiled-with-cuda-enabled",  "comfyui-python-version"] },
      { title: "Small graphics cards.", slugs: ["comfyui-out-of-memory",  "make-comfyui-faster-low-vram"] },
      { title: "Chat AI on your computer.", slugs: ["run-ai-offline-on-your-computer",  "best-ollama-model-for-your-pc",  "ollama-open-webui-setup"] },
    ],
  },
  {
    slug: "pc-gaming",
    recommended: "claude",
    name: "PC and gaming fixes",
    h1: "A PC that runs games smoothly.",
    title: "PC gaming fixes: FPS drops, stutter, crashes, drivers, temps",
    description:
      "Fix FPS drops, stutter, crashes and black screens, update graphics drivers, cool a hot PC and sort monitors, sound and controllers. Just ask Stella (stella.sh).",
    intro:
      "Say what's wrong with your PC or your game. Stella (stella.sh) finds the cause and fixes it.",
    sections: [
      { title: "FPS drops, stutter and crashes.", slugs: ["fix-fps-drops-in-games",  "game-stuttering-on-pc",  "high-cpu-usage-while-gaming",  "games-crashing-to-desktop",  "black-screen-when-launching-games",  "d3dx9-43-dll-not-found"] },
      { title: "Graphics drivers and heat.", slugs: ["update-graphics-drivers",  "clean-install-graphics-drivers",  "pc-overheating-when-gaming",  "undervolt-gpu"] },
      { title: "Monitors and HDR.", slugs: ["second-monitor-not-detected",  "monitor-stuck-at-60hz",  "hdr-washed-out-windows-11"] },
      { title: "Sound, controllers and Bluetooth.", slugs: ["no-sound-on-pc",  "bluetooth-headphones-sound-bad-on-pc",  "controller-not-working-on-pc"] },
      { title: "Startup and game storage.", slugs: ["windows-11-slow-startup",  "move-steam-game-to-another-drive"] },
    ],
  },
];

export function getNiche(slug: string) {
  return NICHES.find((niche) => niche.slug === slug);
}
