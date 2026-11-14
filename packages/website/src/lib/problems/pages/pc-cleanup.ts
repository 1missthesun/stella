import { PROOFS, webCuts } from "../media";
import type { ProblemPage } from "../types";

export const PC_CLEANUP_PAGES: ProblemPage[] = [
  {
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
      "Sort a cluttered Downloads folder, find duplicates and old installers, and clear space safely, by hand or with Stella (stella.sh) told to ask before deleting.",
    h1: "Organize a messy Downloads folder",
    short: "Sort a messy Downloads folder",
    lede: "Everything sorted into folders and the duplicates found, with nothing lost.",
    answer:
      "Sort the folder by type, move documents, pictures, videos and archives into their own folders, then delete installers you've already used and the duplicate copies with “(1)” in the name. Windows can also clear old downloads automatically. Stella (stella.sh) does the sorting on your computer, finds true duplicates by their contents rather than their names, and, because the prompt says so, deletes nothing until you tell it to.",
    stellaSteps: [
      "Sorts every file into a handful of folders by name and type: Documents (split into Finance, Personal, Travel and so on), Images, Installers, Archives, Audio & Video",
      "Leaves anything unclear where it is; in the recording, two half-finished downloads stayed in Downloads for you to check",
      "Finds true duplicates by comparing contents (SHA-256), and flags files with similar names but different contents as possible revisions, not duplicates",
      "Writes a report and a log of every move; in the recording it deleted nothing until it was told to go ahead, as the prompt asks",
      "When you approve, removes only the exact extra copies, checking each one again just before, and logs every removed path next to the copy it kept",
    ],
    prompt: "My Downloads folder is a mess, sort it into folders and find duplicates, but don't delete anything without asking.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-10",
      platform: "Linux (Omarchy)",
      model: "Stella’s own models (GPT-6 Luna)",
      result:
        "297 of 299 files sorted into 14 folders, 46 groups of identical files found and reported with nothing deleted, then, after the go-ahead typed in the chat, 58 extra copies removed with one of each kept. 241 files remain, and every move and removal is in a log.",
      note: "The Downloads folder is a test folder of 299 files made for this run. The waits are sped up.",
      video: {
        src: `${PROOFS}/pc-cleanup/organize-downloads-folder/proof.mp4`,
        cuts: webCuts("pc-cleanup/organize-downloads-folder"),
        poster: `${PROOFS}/pc-cleanup/organize-downloads-folder/poster.jpg`,
        width: 1280,
        height: 800,
        duration: 81.8,
        realDuration: 244,
      },
      moments: [
        { at: 0, text: "The prompt, typed into Stella on a Linux computer." },
        { at: 6, text: "Sent." },
        { at: 15, text: "Stella replies that it's sorting Downloads and checking for duplicates, won't delete anything, and will report the duplicates for review." },
        { at: 16, text: "Sorting 299 files, sped up 15×." },
        { at: 23, text: "Done: 297 of 299 files sorted, two incomplete downloads left in place, 46 groups of identical files and three similar-name pairs found. Nothing deleted." },
        { at: 36, text: "The cleanup report Stella wrote: files per folder, and every duplicate group with its checksum." },
        { at: 57, text: "The go-ahead, typed in the chat: “Thanks. Go ahead and delete the extra copies, keep one of each.”" },
        { at: 64, text: "Stella confirms it will remove only the identical copies and leave the possible revisions and incomplete downloads alone." },
        { at: 69, text: "Done: 58 extra copies removed, one kept from each group. No exact duplicates remain." },
      ],
      shots: [
        {
          src: `${PROOFS}/pc-cleanup/organize-downloads-folder/report.jpg`,
          alt: "Stella's Downloads cleanup report: 297 files organised, 58 redundant copies removed from 46 identical groups with approval, and a table of files remaining per folder.",
          width: 1800,
          height: 2200,
          caption: "The report Stella wrote after the cleanup, with the files left in each folder.",
        },
      ],
    },
    manualSteps: [
      {
        title: "See what's there, biggest first",
        body: "Open Downloads. On Windows, switch File Explorer to Details view and click the Size column; on a Mac, use View, then as List, and sort by Size. Big video files and disk images are usually most of the space.",
      },
      {
        title: "Group by type",
        body: "On Windows, right-click an empty spot and choose Group by, then Type. On a Mac, choose View, then Use Groups, and group by Kind. You now see all PDFs, images, installers and archives together.",
      },
      {
        title: "Make folders and drag each group in",
        body: "Create a handful of folders (Documents, Images, Video, Audio, Archives, Installers) and drag each group into its folder. Keep it to a few; ten folders become their own mess.",
      },
      {
        title: "Delete what you've already used",
        body: "Installers (.exe and .msi on Windows, .dmg and .pkg on Mac) are safe to delete once the app is installed. Zip files you've already extracted can go too. Files named like `report (1).pdf` are usually repeat downloads: open both and check before deleting one.",
      },
      {
        title: "Stop it piling up again",
        body: "Windows: Settings, System, Storage, Storage Sense, then set “Delete files in my Downloads folder if they haven't been opened for more than” to 30 or 60 days. Mac: there's no built-in timer for Downloads, so put a monthly reminder in your calendar.",
      },
    ],
    limits: [
      "In the recording Stella deleted nothing until it was told to, because the prompt said so. Its deletes are permanent, not to the Recycle Bin or Trash. If you want a safety net, say “move the extra copies to the Trash” in your go-ahead.",
      "It won't open or run installers it finds. It only reports what they are.",
      "If Downloads syncs with OneDrive or iCloud, moving files also moves them in the cloud copy. Say so in the prompt if you'd rather it left synced files alone.",
      "It sorts by names and file types, so a file called `scan_0012.pdf` lands in Documents, not in the exact subfolder you'd choose. Check the report and move the odd one by hand, or tell Stella your own folder names first.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Is it safe to delete everything in Downloads?",
        a: "Usually not all at once. Some people keep their only copy of a tax form or photo there. Delete installers and duplicates freely, but look at documents and pictures before they go.",
      },
      {
        q: "How do I find duplicate files on Windows?",
        a: "Windows has no built-in duplicate finder. Sorting by name shows copies like “file (1)”, but true duplicates can have different names. A tool that compares file contents, or Stella, catches those.",
      },
      {
        q: "Will moving files out of Downloads break anything?",
        a: "No. Apps don't run from files in Downloads. The only catch is a browser's download list, whose links stop working once a file moves.",
      },
      {
        q: "What should I do with all the bank statements in Downloads?",
        a: "Move them into one Statements folder first. If you need the numbers, [turn the statement PDFs into one Excel sheet](/how/pdf-excel/bank-statement-pdf-to-excel); then the PDFs can go to an archive folder or your cloud storage.",
      },
      {
        q: "Can I sort Downloads automatically every week?",
        a: "Yes. Ask Stella to repeat the same sort every Sunday; it runs on schedule and tells you in the chat what it moved. Storage Sense on Windows only deletes old files; it doesn't sort them.",
      },
    ],
    related: ["photos-files/find-duplicate-photos", "pc-cleanup/find-large-files-taking-up-space", "pdf-excel/bank-statement-pdf-to-excel"],
    lastChecked: "2026-11-10",
    sources: [
      {
        label: "Microsoft: Manage drive space with Storage Sense",
        href: "https://support.microsoft.com/en-us/windows/manage-drive-space-with-storage-sense-654f6ada-7bfc-45e5-966b-e24aded96ad5",
      },
      { label: "Apple: Organize files in folders on Mac", href: "https://support.apple.com/guide/mac-help/organize-files-in-folders-mh26885/mac" },
    ],
  },
  {
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
      "Delete every empty folder, including ones that only hold other empty folders, without touching anything with a file in it: Terminal, PowerShell or Stella (stella.sh).",
    h1: "Delete all empty folders at once",
    short: "Delete empty folders",
    lede: "28 empty folders gone from Documents, every file left where it was.",
    answer:
      "On a Mac, `find ~/Documents -type d -empty -delete` in Terminal removes empty folders from the bottom up, so a folder that held only empty folders goes too. On Windows, a one-line PowerShell command does the same, or a free tool such as Remove Empty Directories. The catch: a folder holding only a hidden `.DS_Store` or `Thumbs.db` isn't empty to these tools. Stella (stella.sh) clears every empty folder level by level and leaves any folder with a file in it.",
    stellaSteps: [
      "Scans every folder in Documents, hidden files included",
      "Deletes folders with nothing in them, like the old “New folder (2)” leftovers, and then the parents they leave empty, such as `Work/Old/Archive`",
      "Keeps every folder with a file in it, including one whose only file is an empty `placeholder.txt`",
      "Leaves four folders whose only contents are hidden system files (`.DS_Store`, `Thumbs.db`), because the prompt said not to touch anything with files, and offers to remove them",
      "Reports how many folders went and that all 31 files are where they were",
    ],
    prompt:
      "My Documents folder is full of empty folders left over from years of moving things around. Delete all the empty ones, but don't touch anything that has files in it.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "28 empty folders deleted in under 30 seconds. Checked afterwards against an answer key written before the run: all 28 are gone, including those that only held other empty folders, all 33 folders with files are still there, and no file was deleted or changed. One optional check missed: the four folders holding only hidden system files were kept. Stella said why and offered to remove them.",
      note: "The Documents folder is a test folder made for this run. The run isn't sped up.",
      video: {
        src: `${PROOFS}/pc-cleanup/delete-empty-folders/proof.mp4`,
        cuts: webCuts("pc-cleanup/delete-empty-folders"),
        poster: `${PROOFS}/pc-cleanup/delete-empty-folders/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 42.8,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Documents is full of empty leftover folders." },
        { at: 2.1, text: "The prompt: delete the empty ones, but don't touch anything with files in it." },
        { at: 12.9, text: "Stella replies: no files moved or deleted, folders holding only empty folders removed too, Documents itself kept." },
        { at: 28.9, text: "Done: 28 empty folders deleted, all 31 files in place, four folders with only hidden system files left for you to decide." },
      ],
    },
    manualTitle: "Delete them yourself",
    manualSteps: [
      {
        title: "Mac: list them first",
        body: "Open Terminal and run `find ~/Documents -type d -empty -print`. Read the list to be sure nothing you want is on it.",
      },
      {
        title: "Mac: delete them",
        body: "Run `find ~/Documents -type d -empty -delete`. It works from the deepest level up, so a folder that only contained empty folders is removed too. They're deleted outright, not moved to the Trash.",
      },
      {
        title: "Mac: folders with only .DS_Store",
        body: "Finder leaves hidden `.DS_Store` files that make a folder look non-empty to `find`. To clear those too, first run `find ~/Documents -name .DS_Store -delete` (Finder recreates them as needed), then the delete command again.",
      },
      {
        title: "Windows: PowerShell",
        body: "Open PowerShell and run `Get-ChildItem $HOME\\Documents -Directory -Recurse | Sort-Object { $_.FullName.Length } -Descending | Where-Object { -not (Get-ChildItem $_.FullName -Force) } | Remove-Item`. Add `-WhatIf` at the end first to see what would go.",
      },
      {
        title: "Windows: a free tool",
        body: "Remove Empty Directories and similar free tools show a list of empty folders before deleting, and can treat `Thumbs.db` and `desktop.ini` as junk. Check the list before you click delete.",
      },
    ],
    limits: [
      "Stella counts any file as a file, hidden system files included, unless you say they're junk. Here it kept four folders holding only `.DS_Store` or `Thumbs.db` and asked; add “ignore .DS_Store and Thumbs.db” to the prompt to clear those too.",
      "Empty folders are deleted outright, not moved to the Trash or Recycle Bin. There was nothing in them, but say so if you'd rather they went to the Trash.",
      "Folder names are seen by the AI model you use in Stella. The work happens on your computer.",
      "Cloud-synced folders (OneDrive, iCloud Drive, Dropbox) may bring placeholders back.",
      "Recorded on Linux. On a Mac Stella can use the same built-in tools; on Windows it uses PowerShell, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Is it safe to delete empty folders?",
        a: "In your own Documents, Desktop or Pictures, yes. Don't clear empty folders inside program folders, game folders or system locations: some apps expect them and recreate errors if they're missing.",
      },
      {
        q: "Why does a folder look empty but won't count as empty?",
        a: "It holds a hidden file, usually `.DS_Store` from a Mac or `Thumbs.db` and `desktop.ini` from Windows. Show hidden files (Cmd-Shift-. on a Mac; View, Show, Hidden items on Windows) to see them.",
      },
      {
        q: "Where do all these empty folders come from?",
        a: "Moving files out of folders, unzipping, and apps that create folders they never use. Flattening a folder tree leaves many: see [move files from subfolders into one folder](/how/files-folders/move-files-from-subfolders-into-one-folder).",
      },
      {
        q: "What else frees up space?",
        a: "Empty folders take almost no space. For real gains, [find the large files taking up space](/how/pc-cleanup/find-large-files-taking-up-space) and [sort out the Downloads folder](/how/pc-cleanup/organize-downloads-folder).",
      },
    ],
    related: ["pc-cleanup/find-large-files-taking-up-space", "files-folders/move-files-from-subfolders-into-one-folder", "pc-cleanup/organize-downloads-folder"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Microsoft Learn: Remove-Item", href: "https://learn.microsoft.com/powershell/module/microsoft.powershell.management/remove-item" },
      { label: "GNU findutils manual: -empty and -delete", href: "https://www.gnu.org/software/findutils/manual/html_mono/find.html" },
    ],
  },
  {
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
      "See which files and folders take the most space, biggest first, without a cleaner app: Storage settings, WinDirStat, Terminal, or Stella (stella.sh) saving you a list.",
    h1: "Find what's taking up space on your computer",
    short: "Find large files taking up space",
    lede: "A saved report of the biggest files and folders, with nothing deleted.",
    answer:
      "Windows: Settings, System, Storage, Cleanup recommendations, Large or unused files; for a folder-by-folder map, the free WinDirStat or WizTree. Mac: System Settings, General, Storage, then the info button next to Documents for Large Files. Both list single files, so a folder of thousands of small files (an old phone backup) can hide. Stella (stella.sh) measures files and folders, saves a report of the biggest, and deletes nothing unless you ask.",
    stellaSteps: [
      "Scans your home folder, hidden folders included, and measures every file and folder",
      "Finds the biggest single files (videos, backups, archives, audio) and folders full of small files, like an old phone backup of 1,200 photos",
      "Checks the whole disk too, and says when your own folders aren't what's filling it",
      "Saves `Disk space report.html` on the Desktop: folders by size, what's usually safe to clear, and the biggest personal files with sizes",
      "Deletes nothing, and offers a read-only scan of the whole drive",
    ],
    prompt:
      "My computer keeps saying it's running out of space. Find what's taking up the most room in my user folders and save me a list of the biggest files and folders on my Desktop. Don't delete anything.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "A report in about 1 minute 10 seconds. Checked afterwards against an answer key written before the run: the report names all 10 large files hidden around the folders and the Old phone backup folder (the biggest folder, made of 1,200 small files), shows sizes, and nothing was deleted or changed. One optional check missed: the report opens with folder totals and cleanup tips that mention some downloads, so the single biggest file isn't the first file it names. Its list of big personal files is biggest first.",
      note: "The test home folder sat on a shared test computer, so the disk totals in Stella's answer (1.3 TB used) and a 1.5 GB set of programming tools are that computer's, not part of the test files. The search is sped up 5×.",
      video: {
        src: `${PROOFS}/pc-cleanup/find-large-files-taking-up-space/proof.mp4`,
        cuts: webCuts("pc-cleanup/find-large-files-taking-up-space"),
        poster: `${PROOFS}/pc-cleanup/find-large-files-taking-up-space/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 43.3,
        realDuration: 106,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer, with large files spread over the user folders." },
        { at: 2, text: "The prompt: find what's taking the most room, save a list on the Desktop, delete nothing." },
        { at: 11.3, text: "Stella replies: it will scan the home folder, hidden caches included, and point out what's usually safe to clear." },
        { at: 17.2, text: "Measuring files and folders, sped up 5×." },
        { at: 29.3, text: "Done: the report on the Desktop, the biggest folders and files listed, nothing deleted, and an offer to scan the whole drive." },
      ],
    },
    manualTitle: "Find them yourself",
    manualSteps: [
      {
        title: "Windows: Cleanup recommendations",
        body: "Open Settings, System, Storage, Cleanup recommendations, and expand Large or unused files. It lists big files with their sizes; tick only what you're sure about.",
      },
      {
        title: "Windows: see folders too",
        body: "Storage settings shows categories, not a ranked list of folders. The free WinDirStat or WizTree scans a drive and shows every folder by size, so a folder of thousands of small files stands out.",
      },
      {
        title: "Mac: Storage settings",
        body: "Apple menu, System Settings, General, Storage. Click the info button next to Documents and open Large Files to see the biggest first.",
      },
      {
        title: "Mac: folder sizes in Terminal",
        body: "Large Files lists files only. For folders, open Terminal and run `du -sh ~/* ~/*/* 2>/dev/null | sort -h | tail -20` to see the 20 biggest folders in your home folder.",
      },
      {
        title: "Decide what goes",
        body: "Copy old videos and backups to an external drive before deleting them. Installers and zips you've already extracted can usually go straight away.",
      },
    ],
    limits: [
      "Stella scanned your user folders, as asked; system files, apps and other users' folders aren't covered unless you ask for the whole drive.",
      "It suggests what's usually safe to clear but deletes nothing until you say which.",
      "File and folder names and sizes go to the AI model you use in Stella. The scan itself runs on your computer.",
      "Recorded on Linux. On a Mac or Windows PC Stella uses their own tools to measure folders, which wasn't recorded, and the system folders worth checking differ.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why is my disk full when my folders look small?",
        a: "The space may be outside your folders: system files, updates, restore points, app caches or other users. Stella said exactly that in the recording and offered a read-only scan of the whole drive.",
      },
      {
        q: "Are disk cleaner apps worth it?",
        a: "Most aren't needed. The built-in Storage settings plus a free size map like WinDirStat show the same thing, and you decide what goes.",
      },
      {
        q: "How do I find duplicate files taking space?",
        a: "See [find duplicate photos](/how/photos-files/find-duplicate-photos), which compares contents rather than names, and [organize the Downloads folder](/how/pc-cleanup/organize-downloads-folder).",
      },
      {
        q: "Can it shrink big files instead of deleting them?",
        a: "Often. [Compress a video](/how/video/compress-video-for-discord) or [compress a PDF](/how/pdf-excel/compress-pdf-too-large-to-email), keeping the originals until you've checked the copies.",
      },
    ],
    related: ["pc-cleanup/organize-downloads-folder", "pc-cleanup/delete-empty-folders", "photos-files/find-duplicate-photos"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Change Storage settings on Mac", href: "https://support.apple.com/guide/mac-help/mchl3d437fbc/mac" },
      { label: "Microsoft: Free up drive space in Windows", href: "https://support.microsoft.com/help/17421" },
      { label: "Pureinfotech: Cleanup recommendations on Windows 11", href: "https://pureinfotech.com/free-up-space-cleanup-recommendations-windows-11/" },
    ],
  },
  {
    slug: "free-up-space-on-c-drive",
    // Held back from stella.sh until there's a recorded run (steps-only).
    draft: true,
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
      "Free up a C drive that's full for no reason: find the hidden space users (updates, restore points, hibernation, caches) and clean safely, or use Stella (stella.sh).",
    h1: "How to free up space on C drive when it's full for no reason",
    short: "Free up space on C drive",
    lede: "Find the hidden gigabytes and get them back, safely.",
    answer:
      "When the C drive fills up “for no reason”, the space is usually in places File Explorer doesn't show: Windows Update leftovers, restore points, the hibernation file, temp folders, old iPhone backups and game caches. Settings › System › Storage and Disk Cleanup's “Clean up system files” recover most of it, and a free tool like WizTree shows the rest. Stella (stella.sh) measures all of it on your PC, explains each item and, because the prompt asks it to, cleans only what you approve.",
    stellaSteps: [
      "Measures every large folder on C, hidden and system areas included, with PowerShell",
      "Explains each big item in plain words: what it is, whether it's safe to remove, and how much you'd get back",
      "Runs Windows' own cleanups: Disk Cleanup's system files, the component store cleanup and temp folders",
      "Points out big personal folders (old iPhone backups, game libraries, videos) and offers to move them to another drive",
      "Waits for your go-ahead before deleting anything or turning hibernation off, because the prompt asks for that",
    ],
    prompt:
      "My C drive is almost full and I don't know why. Find what's using the space, including hidden and system files, explain it, and only clean up what I approve.",
    proof: {
      kind: "steps-only",
      reason: "We haven't recorded this one yet: it needs a Windows PC with a genuinely full C drive.",
    },
    manualSteps: [
      {
        title: "Start with Storage settings",
        body: "Open Settings, System, Storage. Windows shows what's using the drive by category; click “Show more categories” to see all of them. Temporary files often hold several gigabytes, and you can clear them from there with a tick-box list.",
      },
      {
        title: "Clean up system files",
        body: "Search the Start menu for Disk Cleanup, pick C:, then click “Clean up system files”. Tick Windows Update Cleanup, Delivery Optimization Files and Temporary files. “Previous Windows installation(s)” is your way back after an upgrade, so only remove it once you're happy with the new version.",
      },
      {
        title: "See exactly what's big",
        body: "Install the free [WizTree](https://diskanalyzer.com) or [WinDirStat](https://windirstat.net) and scan C:. The usual surprises are `hiberfil.sys` (about the size of your RAM), `pagefile.sys`, old iPhone backups in `%APPDATA%\\Apple Computer\\MobileSync\\Backup`, game shader caches and huge Downloads or Videos folders.",
      },
      {
        title: "Shrink restore points",
        body: "Search for “Create a restore point”, select C:, click Configure, and lower Max Usage to around 5%, or delete older points. Restore points are useful, but some PCs let them grow to tens of gigabytes.",
      },
      {
        title: "Turn hibernation off, if you never use it",
        body: "In Terminal opened as administrator, run `powercfg /h off`. This deletes `hiberfil.sys` straight away. It also switches off Fast Startup, so the PC may take a few seconds longer to boot.",
      },
      {
        title: "Move big personal things off C",
        body: "In Settings, System, Storage, open Advanced storage settings, then “Where new content is saved” to send new files to another drive. Move a Steam library from Steam's Settings, Storage, and move big video or photo folders by hand.",
      },
    ],
    manualTitle: "Do it yourself (about 20 minutes)",
    limits: [
      "Stella won't delete Windows system files by hand. For those it uses Windows' own tools, the ones Microsoft documents.",
      "It won't install “PC cleaner” or registry cleaner apps, and it won't recommend them.",
      "Some drives are simply too small: a 128 GB SSD with Windows and a couple of modern games fills up whatever you do. Stella can tell you that; it can't add space.",
      "If the drive itself is failing, cleaning up isn't the fix. Stella can read the drive's health report and tell you to back up first.",
      "This guide is for Windows. On a Mac the equivalent is “System Data”: ask Stella about local Time Machine snapshots, caches and iPhone backups instead.",
    ],
    platforms: ["windows"],
    faq: [
      {
        q: "Why does my C drive keep filling up by itself?",
        a: "Windows updates download in the background, restore points and temp files grow, OneDrive may keep downloaded copies of cloud files, and games update themselves. None of it is visible as files in your folders, which is why it looks like nothing.",
      },
      {
        q: "Is it safe to delete the WinSxS folder?",
        a: "Not by hand: Windows needs it. To shrink it safely, run `Dism.exe /online /Cleanup-Image /StartComponentCleanup` in an administrator Terminal, or use Disk Cleanup's Windows Update Cleanup.",
      },
      {
        q: "Is it safe to delete Windows.old?",
        a: "Yes, once you're sure you don't want to go back to your previous Windows version. Use Disk Cleanup's “Previous Windows installation(s)” rather than deleting it in File Explorer. Windows removes it by itself after about ten days.",
      },
      {
        q: "How much free space does Windows need?",
        a: "Leave at least 20 GB free so big updates can download and install. Below about 10 GB, updates start failing and the PC slows down.",
      },
    ],
    related: ["pc-cleanup/organize-downloads-folder", "game-mods/find-broken-sims-4-mods"],
    lastChecked: "2026-11-10",
    sources: [
      {
        label: "Microsoft: Manage drive space with Storage Sense",
        href: "https://support.microsoft.com/en-us/windows/manage-drive-space-with-storage-sense-654f6ada-7bfc-45e5-966b-e24aded96ad5",
      },
      {
        label: "Microsoft: Clean up the WinSxS folder",
        href: "https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/clean-up-the-winsxs-folder",
      },
      { label: "WizTree", href: "https://diskanalyzer.com" },
    ],
  },
];
