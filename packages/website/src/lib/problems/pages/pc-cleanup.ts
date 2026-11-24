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
  shortGuide({
    slug: "mac-system-data-too-large",
    niche: "pc-cleanup",
    searchPhrases: [
      "mac system data too large",
      "clear system data mac",
      "system data taking up space mac",
      "mac system data over 100gb",
    ],
    title: "Mac System Data too large? Shrink it back down",
    description:
      "System Data eating 100 GB or more of your Mac? Stella (stella.sh) finds what's really inside, like caches, logs and old snapshots, and clears out the leftovers.",
    h1: "Mac System Data too large? Here's how to shrink it",
    short: "Shrink Mac System Data",
    lede: "Your Mac's mystery System Data back to a normal size.",
    answer:
      "System Data is the Mac's catch-all for caches, logs, Time Machine snapshots and bits left by deleted apps. Stella (stella.sh) opens it up, tells you what each part is and clears the leftovers.",
    gets: [
      "What's inside System Data, in plain words",
      "Old caches, logs and waiting snapshots cleared",
      "Files left by apps you deleted, gone too",
    ],
    prompt:
      "My MacBook says System Data is using 140 GB and I can't even install the macOS update. Find out what it is and clear out what I don't need.",
    demo: {
      ack: "Okay. Opening up System Data first.",
      task: "Shrinking System Data",
      rows: [
        "Measuring hidden Library folders",
        "Clearing old app caches and logs",
        "Removing local Time Machine snapshots",
        "Finding files from deleted apps",
      ],
      reply:
        "System Data is down from **140 GB to 31 GB**. Most of it was app caches, years of logs and Time Machine snapshots waiting for your backup drive. 22 GB from apps you'd already deleted went to the Trash.",
    },
    faq: [
      ["What is System Data on a Mac?", "Everything macOS doesn't file elsewhere: caches, logs, memory swap, Time Machine snapshots and support files from apps, including ones you've removed."],
      ["Why does System Data keep growing?", "Caches and snapshots pile up quietly. A restart or a finished Time Machine backup trims some of it, but never all."],
    ],
    byHand: [
      "Restart first: macOS clears some temporary files when it starts up.",
      "In Finder, Go, Go to Folder, ~/Library/Caches, and delete folders from apps you recognise.",
      "In Terminal, tmutil listlocalsnapshots / lists snapshots; tmutil deletelocalsnapshots with a date removes one.",
    ],
    related: [
      "pc-cleanup/free-up-space-on-mac",
      "pc-cleanup/remove-leftover-files-after-uninstall",
      "pc-cleanup/find-large-files-taking-up-space",
    ],
    platforms: ["mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "free-up-space-on-mac",
    niche: "pc-cleanup",
    searchPhrases: [
      "how to free up space on mac",
      "free up space on macbook air",
      "free up space on mac for software update",
      "macintosh hd full",
      "what to do when macintosh hd is full",
    ],
    title: "How to free up space on a Mac (MacBook Air, Pro, iMac)",
    description:
      "Mac almost full, or no room for the macOS update? Stella (stella.sh) finds the big stuff, moves keepers to an external drive and clears the junk to get space back.",
    h1: "How to free up space on your Mac",
    short: "Free up space on a Mac",
    lede: "Room on your Mac again, with nothing you care about lost.",
    answer:
      "To free up space on a Mac, move what's big and old off it and clear the junk. Stella (stella.sh) finds old videos, downloads and installers, moves keepers to an external drive and empties the rest.",
    gets: [
      "Big, forgotten files found across the whole Mac",
      "Keepers moved to an external drive, in tidy folders",
      "Installers, old downloads and the Trash cleared",
    ],
    prompt:
      "My MacBook Air keeps saying the disk is almost full and the macOS update needs 25 GB. Free up space, and move old videos to my Samsung T7 drive instead of deleting them.",
    demo: {
      ack: "Sure. Measuring your Mac first.",
      task: "Freeing up space on your Mac",
      rows: [
        "Measuring every folder, hidden ones too",
        "Moving 2019 to 2022 videos to the T7",
        "Deleting installers for apps you have",
        "Emptying the Trash",
      ],
      reply:
        "You now have **61 GB free**, plenty for the update. 212 old videos are on the T7 in Videos by year, 38 installers are gone, and Photos and Documents weren't touched.",
    },
    faq: [
      ["Why is my Mac full when I have hardly any files?", "Photos, Messages attachments, Mail downloads and System Data all take room outside your folders. Stella checks those too."],
      ["How much space does a macOS update need?", "A major upgrade can ask for 20 GB or more. Software Update shows the exact amount before it starts."],
    ],
    byHand: [
      "System Settings, General, Storage: try Store in iCloud, Optimize Storage and Empty Trash Automatically.",
      "Click the info button beside each category to see and delete its largest files.",
    ],
    related: [
      "pc-cleanup/mac-system-data-too-large",
      "pc-cleanup/find-large-files-taking-up-space",
      "pc-cleanup/download-all-photos-from-icloud",
    ],
    platforms: ["mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "icloud-storage-full",
    niche: "pc-cleanup",
    searchPhrases: [
      "icloud storage full what to delete",
      "icloud storage full what to do",
      "icloud storage full how to free up space",
      "icloud full but no photos",
      "icloud storage full but phone is not",
    ],
    title: "iCloud storage full? What to delete to free up space",
    description:
      "iCloud storage full? Stella (stella.sh) shows what's really using it, like old iPhone backups and big files, saves what you want to keep and frees up the space.",
    h1: "iCloud storage full? What to delete first",
    short: "iCloud storage full",
    lede: "Your iCloud back under its limit, with nothing you want lost.",
    answer:
      "When iCloud is full, the space usually goes to backups of old devices, big files in iCloud Drive and message attachments. Stella (stella.sh) shows the breakdown on your Mac or PC, saves what you want and clears the rest.",
    gets: [
      "What's using your iCloud, biggest first",
      "Backups of phones you no longer have removed",
      "Big iCloud Drive files saved to your computer first",
    ],
    prompt:
      "My iCloud is full again. Find what's using my 50 GB, delete backups of my old phones and move the big stuff to my laptop.",
    demo: {
      ack: "Okay. Opening your iCloud storage on your Mac.",
      task: "Clearing space in iCloud",
      rows: [
        "Reading the iCloud storage breakdown",
        "Removing backups of two old devices",
        "Moving 9 GB of videos to your Mac",
      ],
      reply:
        "iCloud is at **18 of 50 GB** now. Backups of your iPhone 11 and old iPad are gone, and the big screen recordings sit in a Saved from iCloud folder on your Mac.",
    },
    faq: [
      ["iCloud full but no photos: what's using it?", "Usually backups of old phones and iPads, iCloud Drive files and Messages attachments."],
      ["What happens if I delete an old iPhone backup?", "That old phone loses its restore copy. Your current phone, its backup and your photos stay as they are."],
    ],
    byHand: [
      "iPhone: Settings, your name, iCloud, Manage Storage, Backups, then delete devices you no longer use.",
      "Mac: System Settings, your name, iCloud, Manage.",
      "At icloud.com, download big iCloud Drive files to your computer before deleting them.",
    ],
    related: [
      "pc-cleanup/download-all-photos-from-icloud",
      "pc-cleanup/delete-duplicate-photos-in-icloud",
      "pc-cleanup/free-up-space-on-mac",
    ],
    platforms: ["mac", "windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "download-all-photos-from-icloud",
    niche: "pc-cleanup",
    searchPhrases: [
      "download all photos from icloud",
      "download all photos from icloud to external hard drive",
      "download all photos from icloud to pc",
      "download all photos from icloud more than 1000",
      "back up iphone photos to computer",
    ],
    title: "Download all photos from iCloud and free up iCloud space",
    description:
      "Download every photo and video from iCloud to your PC, Mac or an external drive, full quality and sorted by date. Stella (stella.sh) checks every one arrived.",
    h1: "Download all your photos from iCloud to your computer",
    short: "Download all photos from iCloud",
    lede: "Every iCloud photo safe on your own drive, sorted by date.",
    answer:
      "iCloud.com only downloads 1,000 photos at a time. Stella (stella.sh) pulls your whole library in full quality to your computer or an external drive, sorts it by year and month, and counts that every item arrived.",
    gets: [
      "Every photo and video in original quality",
      "Year and month folders on the drive you pick",
      "A count that matches your iCloud library",
    ],
    prompt:
      "Download all my iCloud photos and videos to my WD external drive in full quality, sorted by year. Then clear the old ones from iCloud.",
    demo: {
      ack: "On it. Starting the download to your WD drive.",
      task: "Saving your iCloud photos",
      rows: ["Downloading originals, 14,212 items", "Sorting into year and month folders", "Checking every item arrived"],
      reply:
        "All **14,212 photos and videos** are on the WD drive in Photos by year, full quality with their dates. Live Photos kept their moving part. Say go and I'll remove 2015 to 2021 from iCloud.",
    },
    faq: [
      ["Does deleting photos from iCloud delete them from my iPhone?", "Yes. With iCloud Photos on, deleting anywhere deletes everywhere, which is why Stella copies and counts everything first."],
      ["How do I download more than 1,000 photos from iCloud?", "Use the Photos app on a Mac or the iCloud app on Windows, or ask Stella."],
    ],
    byHand: [
      "Mac: Photos, Settings, iCloud, Download Originals to this Mac, then File, Export, Export Unmodified Originals to your drive.",
      "Windows: in the iCloud app, turn on Photos; they download to Pictures, iCloud Photos.",
    ],
    related: [
      "pc-cleanup/icloud-storage-full",
      "photos-files/sort-photos-into-folders-by-date",
      "photos-files/convert-heic-to-jpg",
    ],
    platforms: ["mac", "windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "google-photos-storage-full",
    niche: "pc-cleanup",
    searchPhrases: [
      "google photos storage full",
      "google photos storage full what to do",
      "how to free up google storage without deleting photos",
      "download all google photos to pc",
      "move google photos to external hard drive",
    ],
    title: "Google Photos storage full? Move photos off and free space",
    description:
      "Google storage full? Stella (stella.sh) saves your Google Photos to your computer with Takeout, checks every photo arrived with its date, then clears space.",
    h1: "Google Photos storage full? Move your photos off and free it up",
    short: "Google Photos storage full",
    lede: "Your Google account back under 15 GB, with every photo kept.",
    answer:
      "Google's free 15 GB is shared by Photos, Gmail and Drive. Stella (stella.sh) saves your photos to your computer with Google Takeout, puts their dates back, checks every one is there, then clears the biggest from Google.",
    gets: [
      "Every Google photo and video saved on your computer",
      "The right date on each file",
      "Big videos and old years cleared from Google",
    ],
    prompt:
      "My Google storage is full and Gmail stopped getting emails. Save all my Google Photos to my computer, then clear the big videos from Google.",
    demo: {
      ack: "Sure. Starting a Google Takeout of your photos.",
      task: "Freeing your Google storage",
      rows: [
        "Downloading 6 Takeout zips",
        "Unpacking and fixing photo dates",
        "Matching 9,840 items to your library",
        "Clearing large videos from Google Photos",
      ],
      reply:
        "Your **9,840 photos and videos** are in Pictures, Google Photos, by year. Big videos and 2016 to 2019 are cleared from Google and the bin is emptied, so you're at **11.8 of 15 GB**.",
    },
    faq: [
      ["Why is Google storage still full after deleting photos?", "Gmail and Drive share the same 15 GB, and deleted items can wait in a bin. Stella empties the bins and checks all three."],
      ["How do I free up Google storage without deleting photos?", "Save them to your computer or a drive first. Then removing them from Google loses nothing."],
    ],
    byHand: [
      "Go to takeout.google.com, deselect all, tick Google Photos and pick 50 GB zips.",
      "In Google Photos, Manage storage lists large videos, blurry shots and screenshots to review.",
    ],
    related: [
      "photos-files/fix-google-takeout-photo-dates",
      "pc-cleanup/delete-duplicate-photos-in-icloud",
      "pc-cleanup/download-all-photos-from-icloud",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "delete-duplicate-photos-in-icloud",
    niche: "pc-cleanup",
    searchPhrases: [
      "delete duplicate photos icloud",
      "find duplicate photos icloud",
      "how to merge duplicate photos in google photos",
      "merge icloud and google photos without duplicates",
      "merge photo libraries mac without duplicates",
    ],
    title: "Delete duplicate photos across iCloud and Google Photos",
    description:
      "Same photos in iCloud, Google Photos and old downloads? Stella (stella.sh) merges them into one library with one copy of each, keeping the best-quality original.",
    h1: "Delete duplicate photos in iCloud and Google Photos",
    short: "Duplicates across iCloud and Google",
    lede: "One photo library, one copy of every picture, wherever it came from.",
    answer:
      "Photos backed up to both iCloud and Google Photos come back as two copies, often in different sizes and formats. Stella (stella.sh) matches them by the picture itself, keeps the full-quality original and sets the extras aside.",
    gets: [
      "Copies matched across iCloud, Google and old folders",
      "The original full-size file kept each time",
      "Extras in one folder to look over before deleting",
    ],
    prompt:
      "I downloaded my iCloud photos and my Google Photos and now I have two of almost everything. Merge them into one folder with one copy of each photo, the best quality one.",
    demo: {
      ack: "Got it. Comparing both downloads now.",
      task: "Merging iCloud and Google photos",
      rows: [
        "Matching 22,400 photos by the picture",
        "Picking the full-quality copy each time",
        "Setting 8,930 extras aside",
      ],
      reply:
        "Your merged library has **13,470 photos and videos** in Photos, All, by year. Google's squeezed copies lost to the iCloud originals, and the 8,930 extras wait in a Duplicates to delete folder.",
    },
    faq: [
      ["Does iCloud have a duplicate finder?", "Yes, inside the Photos app on iPhone and Mac: a Duplicates album under Utilities merges copies within iCloud Photos, but not with Google."],
      ["Why are my Google Photos copies smaller?", "Photos backed up in Storage saver quality get compressed, so they never match the original file for file."],
    ],
    byHand: [
      "iPhone or Mac: Photos, Utilities, Duplicates, then Merge for each set.",
      "For downloaded folders, dupeGuru's Picture mode finds copies even when sizes differ.",
      "Keep the largest file of each pair.",
    ],
    related: [
      "photos-files/find-duplicate-photos",
      "pc-cleanup/google-photos-storage-full",
      "pc-cleanup/download-all-photos-from-icloud",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "delete-blurry-photos",
    niche: "pc-cleanup",
    searchPhrases: [
      "delete blurry photos",
      "find blurry photos",
      "remove blurry photos",
      "delete similar photos windows",
      "how to delete burst photos and keep one",
    ],
    title: "Delete blurry and similar photos, keep the best shot",
    description:
      "Thousands of blurry shots and near-identical bursts? Stella (stella.sh) finds them in your photo folders, keeps the sharpest of each group and sets the rest aside.",
    h1: "Delete blurry photos and keep the best of each burst",
    short: "Delete blurry and similar photos",
    lede: "The sharpest shot of every moment, and the blurry ones out of the way.",
    answer:
      "To delete blurry photos and near-identical bursts in one go, ask Stella (stella.sh). It scores every photo for sharpness, groups shots taken seconds apart, keeps the best of each and moves the rest to one folder.",
    gets: [
      "Blurry, dark and pocket shots picked out",
      "The sharpest photo of each burst kept",
      "A page of picks to look over before deleting",
    ],
    prompt:
      "Half my 20,000 photos are blurry or ten shots of the same thing. Keep the best of each and pull out the blurry ones.",
    demo: {
      ack: "Sure. Scoring your photos for sharpness.",
      task: "Weeding out blurry and similar shots",
      rows: [
        "Scoring 20,316 photos for sharpness",
        "Grouping shots taken seconds apart",
        "Keeping the sharpest of each group",
      ],
      reply:
        "I set aside **6,140 photos**: 1,920 blurry or dark, the rest repeats from bursts. They're in Set aside to review, with a page showing each one next to the shot I kept. Say go and they'll go to the Trash.",
    },
    faq: [
      ["What about photos that are soft on purpose?", "Nothing is deleted until you've looked. Name the ones to keep, like night shots, and they go back."],
      ["How do I delete burst photos and keep one?", "On iPhone, open the burst, tap Select, pick your favourite and keep only that. Stella does every burst in a folder at once."],
    ],
    byHand: [
      "Google Photos: Manage storage offers a group of blurry photos to review.",
      "digiKam (free): Tools, Maintenance, Image Quality Sorter labels blurry and badly exposed shots.",
    ],
    related: [
      "photos-files/find-duplicate-photos",
      "pc-cleanup/delete-duplicate-photos-in-icloud",
      "photos-files/separate-screenshots-from-photos",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "transfer-photos-from-old-laptop",
    niche: "pc-cleanup",
    searchPhrases: [
      "transfer photos from old laptop to new laptop",
      "transfer photos from old phone to computer",
      "merge photo folders without duplicates",
      "combine photos from multiple devices into one folder",
    ],
    title: "Move photos from an old laptop or phone, without duplicates",
    description:
      "Moving photos off an old laptop, phone or drive? Stella (stella.sh) gathers them all into one library on your new computer, sorted by date, one copy of each.",
    h1: "Transfer photos from your old laptop to the new one, no duplicates",
    short: "Move photos from old devices",
    lede: "Every photo from every old device in one place, once.",
    answer:
      "When photos come from an old laptop, a couple of phones and backup drives, the same pictures turn up three times. Stella (stella.sh) copies everything to your new computer, keeps one copy of each and files them by date.",
    gets: [
      "Photos gathered from laptops, phones and drives",
      "One copy of each, at original quality",
      "Year and month folders, ready for your photo app",
    ],
    prompt:
      "My old Dell laptop and an old Samsung phone are plugged in, and I have a USB stick of photos too. Put all the photos on this new laptop in one place, with no duplicates.",
    demo: {
      ack: "Okay. Finding photos on all three now.",
      task: "Gathering photos from old devices",
      rows: [
        "Copying from the Dell, phone and stick",
        "Matching repeats across all three",
        "Filing by the date each was taken",
      ],
      reply:
        "Done. **31,050 photos and videos** came in, and 11,600 were repeats. The 19,450 left are in Pictures, All photos, by year and month. Your old devices weren't changed.",
    },
    faq: [
      ["What's the best way to move photos to a new laptop?", "A cable or USB drive is fastest. Copy everything first and sort after, so nothing slips through."],
      ["Are the photos removed from my old laptop?", "No. Stella only copies from old devices, so they stay as a spare backup until you wipe them."],
    ],
    byHand: [
      "Windows: plug the phone in, unlock it, and use Import in the Photos app.",
      "Run dupeGuru's Picture mode across them, then sort what's left by date.",
    ],
    related: [
      "photos-files/sort-photos-into-folders-by-date",
      "pc-cleanup/delete-duplicate-photos-in-icloud",
      "photos-files/find-duplicate-photos",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "whatsapp-media-taking-up-space",
    niche: "pc-cleanup",
    searchPhrases: [
      "whatsapp media taking up space",
      "transfer whatsapp media to pc",
      "whatsapp photos taking up space",
      "why is my whatsapp taking up so much space",
      "transfer all whatsapp photos to pc",
    ],
    title: "WhatsApp media taking up space? Move it to your computer",
    description:
      "WhatsApp photos, videos and voice notes filling your phone? Stella (stella.sh) copies them all to your computer, sorted by month, so you can clear the phone.",
    h1: "WhatsApp media taking up space? Move it all to your computer",
    short: "Move WhatsApp media off your phone",
    lede: "Every WhatsApp photo and video saved, and your phone's space back.",
    answer:
      "WhatsApp keeps every photo, video and voice note anyone sends you, so it can grow to tens of gigabytes. Stella (stella.sh) copies them from your Android phone to your computer, sorted and without repeats.",
    gets: [
      "WhatsApp photos, videos and voice notes on your computer",
      "Sorted by type and month, forwarded repeats dropped",
      "Stickers and status clips left out",
    ],
    prompt:
      "WhatsApp is using 38 GB on my Samsung and my phone is full. It's plugged into my laptop. Save all the WhatsApp photos and videos here so I can delete them from the phone.",
    demo: {
      ack: "Sure. Opening the phone's WhatsApp folder.",
      task: "Saving your WhatsApp media",
      rows: [
        "Copying photos, videos and voice notes",
        "Dropping forwarded repeats and stickers",
        "Sorting by month into WhatsApp media",
      ],
      reply:
        "All saved: **24,880 photos, 3,100 videos** and 900 voice notes are in Pictures, WhatsApp media, by month. In WhatsApp, Settings, Storage and data, Manage storage is where you clear them from the phone.",
    },
    faq: [
      ["Why is my WhatsApp taking up so much space?", "Every photo, video and voice note from every chat is saved on your phone, and busy groups pile up fast."],
      ["Does this work with an iPhone?", "iPhone keeps WhatsApp files inside the app. Turn on Save to Photos in WhatsApp, and Stella moves them off with your other photos."],
    ],
    byHand: [
      "Android: plug in, choose File transfer, then open Android, media, com.whatsapp, WhatsApp, Media.",
      "Copy WhatsApp Images, WhatsApp Video and Voice Notes to your computer.",
      "In WhatsApp: Settings, Storage and data, Manage storage, then clear the biggest chats.",
    ],
    related: [
      "chats-data-exports/export-whatsapp-chat-to-pdf",
      "pc-cleanup/transfer-photos-from-old-laptop",
      "photos-files/find-duplicate-photos",
    ],
    platforms: ["windows", "mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "onedrive-taking-up-space",
    niche: "pc-cleanup",
    searchPhrases: [
      "onedrive taking up space on c drive",
      "onedrive filling up c drive",
      "onedrive keeps filling up",
      "onedrive is full what to do",
      "make onedrive files online only",
    ],
    title: "OneDrive taking up space on your C drive? Free it up",
    description:
      "OneDrive filling your C drive or its own 5 GB? Stella (stella.sh) keeps files in the cloud until you open them and moves big stuff out, so neither fills up.",
    h1: "OneDrive taking up space on your C drive? Here's the fix",
    short: "OneDrive taking up space",
    lede: "Your C drive and your OneDrive both with room to spare.",
    answer:
      "OneDrive often keeps a full copy of every file on your PC. Stella (stella.sh) switches big and old files to online-only, so they stay in OneDrive and open when you click, and clears what's filling OneDrive itself.",
    gets: [
      "Gigabytes back on C, with every file still in OneDrive",
      "Files you haven't opened in a month kept online only",
      "Big videos moved off a full OneDrive",
    ],
    prompt:
      "OneDrive has eaten 90 GB of my C drive and says it's full too. Free up space in both without losing any files.",
    demo: {
      ack: "Okay. Checking what OneDrive keeps on this PC.",
      task: "Freeing space from OneDrive",
      rows: [
        "Setting 74 GB of old files online-only",
        "Turning on automatic free-up after 30 days",
        "Moving 3 GB of home videos to D",
      ],
      reply:
        "C drive has **71 GB more free**. Every file still shows in OneDrive and downloads when you open it. OneDrive is at **3.1 of 5 GB** now the home videos live on your D drive.",
    },
    faq: [
      ["Why does OneDrive keep filling up my C drive?", "Files you open download and stay on the PC unless Storage Sense is set to free them up."],
      ["What does the cloud icon mean in OneDrive?", "The file is online-only: it takes no space and downloads when you open it."],
    ],
    byHand: [
      "Right-click the OneDrive folder in File Explorer and choose Free up space.",
      "Settings, System, Storage, Storage Sense: set OneDrive content to go online-only after 30 days unopened.",
      "OneDrive full? Manage storage at onedrive.com lists the largest files.",
    ],
    related: [
      "pc-cleanup/free-up-space-on-c-drive",
      "pc-cleanup/system-and-reserved-storage-huge",
      "pc-cleanup/find-large-files-taking-up-space",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "system-and-reserved-storage-huge",
    niche: "pc-cleanup",
    searchPhrases: [
      "system and reserved storage huge windows 11",
      "winsxs folder too large",
      "hiberfil.sys too large",
      "reduce system reserved storage windows 11",
      "windows.old safe to delete",
    ],
    title: "System and reserved storage huge on Windows 11? Shrink it",
    description:
      "System and reserved storage taking 40 GB or more? Stella (stella.sh) shrinks WinSxS, hiberfil.sys and Windows.old leftovers so Windows takes a normal amount.",
    h1: "System and reserved storage huge on Windows 11? Shrink it back",
    short: "Shrink system and reserved storage",
    lede: "Windows' own files back down to a sensible size.",
    answer:
      "System and reserved storage is Windows' own files: old update copies in WinSxS, the hibernation file, space held for updates and restore points. Stella (stella.sh) trims each one the way Windows supports and says what it freed.",
    gets: [
      "Old update copies in WinSxS cleaned up",
      "hiberfil.sys removed if you never hibernate",
      "Windows.old and spare restore points cleared",
    ],
    prompt:
      "Settings says System and reserved is using 58 GB on my 256 GB laptop. That seems crazy. Shrink it down without breaking Windows.",
    demo: {
      ack: "Okay. Looking at what Windows is holding on to.",
      task: "Shrinking system and reserved storage",
      rows: [
        "Cleaning old update copies from WinSxS",
        "Removing Windows.old from the last upgrade",
        "Turning off hibernation you never use",
        "Trimming restore points to 5 GB",
      ],
      reply:
        "System and reserved is down from **58 GB to 27 GB**. Windows.old was the biggest piece. Sleep still works as before, and your newest restore point is kept.",
    },
    faq: [
      ["Can I just delete the WinSxS folder?", "No, Windows needs WinSxS. Its own cleanup removes old copies of updates, and that's what Stella runs."],
      ["What is hiberfil.sys?", "The file Windows uses to hibernate, often several gigabytes. Turning hibernation off removes it, and sleep keeps working."],
    ],
    byHand: [
      "Disk Cleanup, Clean up system files: tick Windows Update Cleanup and Previous Windows installation(s).",
      "WinSxS: in an admin Terminal, run DISM /Online /Cleanup-Image /StartComponentCleanup.",
      "Hibernation: powercfg /h off removes hiberfil.sys.",
      "Reserved storage: DISM /Online /Set-ReservedStorageState /State:Disabled.",
    ],
    related: [
      "pc-cleanup/free-up-space-on-c-drive",
      "pc-cleanup/onedrive-taking-up-space",
      "pc-cleanup/find-large-files-taking-up-space",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "remove-leftover-files-after-uninstall",
    niche: "pc-cleanup",
    searchPhrases: [
      "remove leftover files after uninstall",
      "how to completely uninstall an app on windows",
      "how to completely uninstall an app on mac",
      "uninstall programs windows 11",
      "uninstall unused programs",
    ],
    title: "Uninstall apps you don't use and remove the leftover files",
    description:
      "Apps you never open, plus the junk they leave behind? Stella (stella.sh) lists what you haven't used, uninstalls the ones you pick and clears their leftover files.",
    h1: "Uninstall unused apps and remove leftover files",
    short: "Uninstall apps and leftovers",
    lede: "Only the apps you use, and none of their leftovers.",
    answer:
      "Uninstalling an app usually leaves its settings, caches and support folders behind. Stella (stella.sh) lists apps you haven't opened in months, uninstalls the ones you pick the proper way and clears what each left behind.",
    gets: [
      "Your apps listed by size and when you last opened them",
      "The ones you pick uninstalled properly",
      "Leftover folders from old apps cleared out",
    ],
    prompt:
      "My laptop came with loads of junk and I've installed tons of stuff over the years. Show me apps I never use, remove the ones I pick, and clean up what they leave behind.",
    demo: {
      ack: "Sure. Listing your apps first.",
      task: "Clearing out unused apps",
      rows: [
        "Listing 86 apps by size and last use",
        "Uninstalling the 19 you picked",
        "Clearing their leftover folders and caches",
      ],
      reply:
        "Removed **19 apps**, including the trial antivirus and three old game launchers, plus 14 GB of folders they'd left behind. Everything you kept is as it was.",
    },
    faq: [
      ["Does dragging an app to the Trash fully uninstall it on a Mac?", "The app goes, but its settings and caches stay in your Library folder. Stella finds and clears those too."],
      ["Why won't McAfee or Norton fully uninstall?", "Trial antivirus often leaves parts running. Each maker has its own removal tool for the rest, and Stella runs it for you."],
    ],
    byHand: [
      "Windows: Settings, Apps, Installed apps, sort by size, then the three dots and Uninstall.",
      "Afterwards, check Program Files and AppData for folders with the app's name.",
      "Mac: the free [AppCleaner](https://freemacsoft.net/appcleaner/) removes an app along with its leftover files.",
    ],
    related: [
      "pc-cleanup/free-up-space-on-c-drive",
      "pc-cleanup/free-up-space-on-mac",
      "sideloading/remove-bloatware-android-with-pc",
    ],
    platforms: ["windows", "mac"],
    lastChecked: "2026-11-24",
  }),
];
