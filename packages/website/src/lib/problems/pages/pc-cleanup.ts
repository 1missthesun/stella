import { PROOFS } from "../media";
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
      "Sort a cluttered Downloads folder into tidy folders, find duplicates and old installers, and clear space safely, by hand or with Stella (stella.sh) waiting for your OK.",
    h1: "Organize a messy Downloads folder",
    short: "Sort a messy Downloads folder",
    answer:
      "Sort the folder by type, move documents, pictures, videos and archives into their own folders, then delete installers you've already used and the duplicate copies with “(1)” in the name. Windows can also clear old downloads automatically. Stella (stella.sh) does the sorting on your computer, finds true duplicates by their contents rather than their names, and deletes nothing until you say so.",
    stellaSteps: [
      "Sorts every file into a handful of folders by name and type: Documents (split into Finance, Personal, Travel and so on), Images, Installers, Archives, Audio & Video",
      "Leaves anything unclear where it is; in the recording, two half-finished downloads stayed in Downloads for you to check",
      "Finds true duplicates by comparing contents (SHA-256), and flags files with similar names but different contents as possible revisions, not duplicates",
      "Writes a report and a log of every move, and deletes nothing until you say so",
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
    related: ["pc-cleanup/c-drive-full-for-no-reason", "photos-files/fix-google-takeout-photo-dates", "pdf-excel/bank-statement-pdf-to-excel"],
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
    slug: "c-drive-full-for-no-reason",
    niche: "pc-cleanup",
    searchPhrases: [
      "c drive full for no reason",
      "c drive full but nothing to delete",
      "what is taking up space on my c drive",
      "c drive full after windows update",
      "c drive getting full automatically",
    ],
    title: "C drive full for no reason? Find what's taking the space",
    description:
      "C drive full and you can't see why? Find the hidden space users (updates, restore points, hibernation, caches), clean up safely, or let Stella (stella.sh) do it.",
    h1: "C drive full for no reason? Find what's using the space",
    short: "C drive full for no reason",
    answer:
      "When the C drive fills up “for no reason”, the space is usually in places File Explorer doesn't show: Windows Update leftovers, restore points, the hibernation file, temp folders, old iPhone backups and game caches. Settings › System › Storage and Disk Cleanup's “Clean up system files” recover most of it, and a free tool like WizTree shows the rest. Stella (stella.sh) measures all of it on your PC, explains each item and cleans only what you approve.",
    stellaSteps: [
      "Measures every large folder on C, hidden and system areas included, with PowerShell",
      "Explains each big item in plain words: what it is, whether it's safe to remove, and how much you'd get back",
      "Runs Windows' own cleanups with your OK: Disk Cleanup's system files, the component store cleanup and temp folders",
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
    related: ["pc-cleanup/organize-downloads-folder", "game-mods/sims-4-mods-not-working-after-update"],
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
