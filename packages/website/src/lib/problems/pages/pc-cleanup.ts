import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const PC_CLEANUP_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "organize-downloads-folder",
    niche: "pc-cleanup",
    searchPhrases: [
      "organize downloads folder",
      "how to clean up my downloads folder windows",
      "sort downloads folder by file type automatically",
      "delete duplicate files in downloads",
      "what can i delete from my downloads folder",
    ],
    title: "Organize a messy Downloads folder (Windows and Mac)",
    description:
      "Downloads folder a mess? Ask Stella (stella.sh) to sort it into folders by type, find the files saved twice and clear them out. Works on Windows and Mac.",
    h1: "Organize a messy Downloads folder",
    short: "Sort a messy Downloads folder",
    lede: "A tidy Downloads folder, with every file in a folder that makes sense.",
    answer:
      "To clean up your Downloads folder, ask Stella (stella.sh). It sorts every file into a few clear folders and clears out true duplicates, even ones saved under different names.",
    gets: [
      "Files sorted into a handful of folders",
      "Repeat copies found, whatever they're called",
      "A log of every move",
    ],
    prompt:
      "My Downloads folder is a total mess. Sort everything into sensible folders and get rid of anything I've downloaded twice.",
    demo: {
      ack: "Sure. Going through your Downloads now.",
      task: "Tidying your Downloads",
      rows: ["Sorting 299 files by type", "Finding repeat copies", "Moving extras to the Trash"],
      reply:
        "Done. **297 files** are sorted into 14 folders, like Documents, Images and Installers. 58 extra copies went to the Trash, and two half-finished downloads stayed put.",
      files: ["Downloads"],
    },
    faq: [
      ["What can I delete from my Downloads folder?", "Installers for apps you already have, zips you've opened, and repeats like 'report (1).pdf'. Move documents and photos into folders first."],
      ["Can Downloads be sorted automatically every week?", "Yes. Ask Stella to repeat the sort every Sunday."],
    ],
    byHand: [
      "Open Downloads and group by type: right-click, Group by, Type on Windows; View, Use Groups on a Mac.",
      "Drag each group into its own folder, then delete installers (.exe, .dmg) for apps you've installed.",
      "Windows: Settings, System, Storage, Storage Sense can clear downloads you haven't opened in 30 or 60 days.",
    ],
    related: [
      "photos-files/find-duplicate-photos",
      "pc-cleanup/find-large-files-taking-up-space",
      "pdf-excel/bank-statement-pdf-to-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "delete-empty-folders",
    niche: "pc-cleanup",
    searchPhrases: [
      "delete empty folders",
      "remove empty folders windows 11",
      "delete empty folders mac",
      "find and delete empty folders",
    ],
    title: "Delete empty folders in one go, including nested ones",
    description:
      "Get rid of all your empty folders at once, nested ones included. Ask Stella (stella.sh) and it clears them on Windows or Mac and keeps every folder that holds a file.",
    h1: "Delete all empty folders at once",
    short: "Delete empty folders",
    lede: "Every empty folder gone, and every folder with a file in it kept.",
    answer:
      "To delete all empty folders at once, including ones that only hold other empty folders, ask Stella (stella.sh). It clears them level by level and keeps any folder with a file in it.",
    gets: ["Every empty folder removed, deepest first", "Folders with files left as they were"],
    prompt:
      "Documents is full of empty folders from years of moving things around. Delete every empty one and keep anything with files in it.",
    demo: {
      ack: "On it. Looking through your Documents.",
      task: "Clearing empty folders",
      rows: [
        "Checking every folder, hidden files too",
        "Removing folders with nothing inside",
        "Clearing parents left empty",
      ],
      reply:
        "All clear. I deleted **28 empty folders**, including old 'New folder (2)' leftovers. All 31 of your files are where they were.",
    },
    faq: [
      ["Why won't a folder that looks empty go?", "It holds a hidden file like .DS_Store or Thumbs.db. Ask Stella to treat those as junk and the folder goes too."],
      ["How do I remove empty folders in Windows 11?", "Windows has no button for it. The free Remove Empty Directories lists them before deleting."],
    ],
    byHand: [
      "Mac: in Terminal, find ~/Documents -type d -empty -delete removes empty folders from the bottom up.",
      "Windows: the free Remove Empty Directories lists empty folders and deletes the ones you tick.",
    ],
    related: [
      "pc-cleanup/find-large-files-taking-up-space",
      "files-folders/move-files-from-subfolders-into-one-folder",
      "pc-cleanup/organize-downloads-folder",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "find-large-files-taking-up-space",
    niche: "pc-cleanup",
    searchPhrases: [
      "what is taking up space on my pc",
      "find large files windows 11",
      "find large files on mac",
      "disk space analyzer",
      "folder size",
    ],
    title: "Find the large files and folders taking up space",
    description:
      "Running out of space? Stella (stella.sh) finds the biggest files and folders on your Windows PC or Mac and saves you a simple list, biggest first, with sizes.",
    h1: "Find what's taking up space on your computer",
    short: "Find large files taking up space",
    lede: "See exactly what's filling your computer, biggest first.",
    answer:
      "To see what's taking up space on your PC or Mac, ask Stella (stella.sh). It measures every file and folder, even ones packed with thousands of small files, and lists the biggest.",
    gets: ["The biggest files and folders, with sizes", "Hidden space hogs, like old phone backups"],
    prompt:
      "My computer keeps saying it's almost out of space. Find what's taking up the most room and list the biggest files and folders for me.",
    demo: {
      ack: "Let me measure everything first.",
      task: "Finding what's using your space",
      rows: ["Measuring every folder, hidden ones too", "Ranking everything by size"],
      reply:
        "The biggest item is an **Old phone backup** folder of 1,200 photos, then 10 large videos and archives. The full list is on your Desktop.",
      files: ["Disk space report.html"],
    },
    faq: [
      ["What is taking up space on my PC?", "Usually videos, old phone backups, games and Downloads, plus system files you never see. Stella checks all of it."],
      ["Is there a free disk space analyzer?", "Yes. WinDirStat and WizTree show every folder by size on Windows."],
    ],
    byHand: [
      "Windows: Settings, System, Storage, Cleanup recommendations, then Large or unused files.",
      "For folder sizes, the free [WinDirStat](https://windirstat.net) or [WizTree](https://diskanalyzer.com) maps the whole drive.",
      "Mac: System Settings, General, Storage, then the info button next to Documents.",
    ],
    related: [
      "pc-cleanup/organize-downloads-folder",
      "pc-cleanup/delete-empty-folders",
      "photos-files/find-duplicate-photos",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "free-up-space-on-c-drive",
    niche: "pc-cleanup",
    searchPhrases: [
      "how to free up space on c drive",
      "c drive full for no reason",
      "c drive full but nothing to delete",
      "what is taking up space on my c drive",
      "c drive full after windows update",
      "c drive getting full automatically",
    ],
    title: "How to free up space on C drive (full for no reason?)",
    description:
      "C drive full for no reason? Stella (stella.sh) finds the hidden space eaters on your Windows PC, like update leftovers and temp files, and clears them out.",
    h1: "How to free up space on C drive when it's full for no reason",
    short: "Free up space on C drive",
    lede: "Gigabytes back on a full C drive, even when nothing looks big.",
    answer:
      "When your C drive fills up for no reason, the space is usually hidden in update leftovers, temp files and old phone backups. Stella (stella.sh) finds it on your PC and clears out the junk.",
    gets: [
      "What's filling your C drive, in plain words",
      "Update leftovers and temp files cleared",
      "Big folders you could move to another drive",
    ],
    prompt:
      "My C drive is almost full and I have no idea why. Find what's using all the space, hidden stuff included, and clear out the junk.",
    demo: {
      ack: "Okay. Measuring your C drive now.",
      task: "Freeing up space on C",
      rows: ["Measuring hidden and system folders", "Clearing Windows Update leftovers", "Emptying temp folders"],
      reply:
        "Done. I cleared **Windows Update leftovers**, temp files and old error reports. Most of what's left is an old iPhone backup and your games. Want me to move those to your D drive?",
    },
    faq: [
      ["Why does my C drive keep filling up by itself?", "Windows downloads updates in the background, and temp files and restore points grow. None of it shows in your folders."],
      ["Is it safe to delete Windows.old?", "Yes, once you're happy with your Windows version. Windows clears it by itself after about ten days."],
    ],
    byHand: [
      "Search Start for Disk Cleanup, pick C:, click Clean up system files and tick Windows Update Cleanup.",
      "Settings, System, Storage, Temporary files often holds several gigabytes you can clear.",
      "The free [WizTree](https://diskanalyzer.com) shows every big folder on C:, hidden ones included.",
    ],
    related: ["pc-cleanup/find-large-files-taking-up-space", "pc-cleanup/organize-downloads-folder"],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "find-duplicate-files",
    niche: "pc-cleanup",
    searchPhrases: [
      "find duplicate files",
      "find duplicate files windows 11",
      "find duplicate files mac",
      "remove duplicate files",
      "delete duplicate files",
    ],
    title: "Find duplicate files and move the extra copies to the Trash",
    description:
      "Same files saved twice all over your computer? Stella (stella.sh) finds exact duplicates, even renamed ones, keeps one of each and moves the rest to the Trash.",
    h1: "Find duplicate files and clear the extra copies",
    short: "Find duplicate files",
    lede: "One copy of every file, and the extras in the Trash.",
    answer:
      "To find duplicate files on Windows 11 or a Mac, compare what's inside them, not their names. Stella (stella.sh) does that, keeps the clearest-named copy and moves the extras to the Trash.",
    gets: ["Exact duplicates found, even renamed ones", "Extras in the Trash, easy to restore"],
    prompt:
      "Documents and Downloads are full of files I've saved more than once. Find the exact duplicates, keep one of each, and put the extras in the Trash.",
    demo: {
      ack: "Sure. Comparing your files now.",
      task: "Clearing duplicate files",
      rows: ["Comparing 60 files by what's inside", "Moving extras to the Trash"],
      reply:
        "Done. **12 files** were saved more than once, and the 16 extra copies are in the Trash. Look-alikes, like two different Notes.txt files, are still there.",
    },
    faq: [
      ["Does Windows 11 have a duplicate file finder?", "No. Storage Sense clears temporary files but doesn't look for duplicates."],
      ["Are two files with the same name duplicates?", "Not always. Only identical contents make a duplicate, and a renamed copy still counts."],
    ],
    byHand: [
      "Free tools like dupeGuru or Czkawka compare what's inside files and list the copies.",
      "Keep the copy with the clearest name; ones with (1) or copy are usually the extras.",
    ],
    related: [
      "photos-files/find-duplicate-photos",
      "pc-cleanup/find-large-files-taking-up-space",
      "files-folders/compare-two-folders",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
