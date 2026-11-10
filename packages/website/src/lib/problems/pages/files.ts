import type { ProblemPage } from "../types";

export const FILES_PAGES: ProblemPage[] = [
  {
    slug: "organize-downloads-folder",
    niche: "files",
    searchPhrases: [
      "organize downloads folder",
      "how to clean up my downloads folder windows",
      "sort downloads folder by file type automatically",
      "delete duplicate files in downloads",
      "what can i delete from my downloads folder",
    ],
    title: "Organize a messy Downloads folder (Windows and Mac)",
    description:
      "Sort a cluttered Downloads folder into tidy folders, find duplicates and old installers, and clear space safely, by hand or with Stella (stella.sh) asking first.",
    h1: "Organize a messy Downloads folder",
    short: "Sort a messy Downloads folder",
    answer:
      "Sort the folder by type, move documents, pictures, videos and archives into their own folders, then delete installers you've already used and the duplicate copies with “(1)” in the name. Windows and macOS can also clear old downloads automatically. Stella (stella.sh) does the sorting on your computer, finds true duplicates by content rather than name, and asks before it deletes a single file.",
    stellaSteps: [
      "Lists everything in Downloads by type, size and age, and tells you what's taking the space",
      "Proposes a folder plan (Documents, Images, Video, Installers, Archives and so on) and waits for your OK",
      "Moves files into place, and spots real duplicates by comparing their contents, not just their names",
      "Shows old installers and duplicates it thinks can go, and deletes only the ones you approve",
      "Leaves a short note of what moved where, so nothing is lost",
    ],
    prompt:
      "Organize my Downloads folder. Sort files into folders by type, find duplicates by content, and list old installers. Show me the plan first, and don't delete anything without asking me.",
    proof: {
      kind: "steps-only",
      reason: "The recorded run on a real Downloads folder is being prepared; until then these are the steps Stella follows.",
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
      "Stella never deletes without asking. It shows the list first, and it can send files to the Recycle Bin or Trash instead of deleting them outright.",
      "It won't open or run installers it finds. It only reports what they are.",
      "If Downloads syncs with OneDrive or iCloud, moving files also moves them in the cloud copy. Stella checks and tells you before it starts.",
      "It can't know which files matter to you sentimentally. Anything personal and unclear stays put until you decide.",
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
        q: "Can I sort Downloads automatically every week?",
        a: "Yes. Ask Stella to repeat the same sort every Sunday; it runs on schedule and tells you in the chat what it moved. Storage Sense on Windows only deletes old files; it doesn't sort them.",
      },
    ],
    related: ["excel/bank-statement-pdf-to-excel", "video/cut-silences-from-video"],
    lastChecked: "2026-11-10",
    sources: [
      {
        label: "Microsoft: Manage drive space with Storage Sense",
        href: "https://support.microsoft.com/en-us/windows/manage-drive-space-with-storage-sense-654f6ada-7bfc-45e5-966b-e24aded96ad5",
      },
      { label: "Apple: Organize files in folders on Mac", href: "https://support.apple.com/guide/mac-help/organize-files-in-folders-mh26885/mac" },
    ],
  },
];
