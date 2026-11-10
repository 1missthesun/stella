import { PROOFS } from "../media";
import type { ProblemPage } from "../types";

export const PHOTOS_FILES_PAGES: ProblemPage[] = [
  {
    slug: "fix-google-takeout-photo-dates",
    niche: "photos-files",
    searchPhrases: [
      "google takeout photos wrong date",
      "google takeout photos json",
      "google takeout json fixer",
      "what to do with json files from google takeout",
      "google takeout photos metadata",
    ],
    title: "Google Takeout photos have the wrong date? Fix them",
    description:
      "Why photos from Google Takeout show the download date, what the JSON files are for, and how to put the real dates back with free tools or Stella (stella.sh).",
    h1: "Google Takeout photos have the wrong date? Put the real dates back",
    short: "Google Takeout photo dates",
    answer:
      "Takeout keeps each photo's real date in a JSON file next to it, not inside the photo, so most apps show the day you downloaded it. Copy the date from each JSON's photoTakenTime into the photo with a free tool such as GPTH or ExifTool, then delete the JSON files. Stella (stella.sh) does that matching on your computer, including the odd cut-off names, and backs up the folder first.",
    stellaSteps: [
      "Finds the Takeout folder (in the recording it looked in Downloads by itself) and reads every JSON file",
      "Matches each JSON to its photo or video, including cut-off names like `…supplemental-metada.json` and numbered copies, where `IMG_0042(1).jpg` belongs to `IMG_0042.jpg(1).json`",
      "Uses photoTakenTime, the date Google Photos shows, and ignores creationTime, which is only when the file was uploaded",
      "Tries the change on copies first, backs up the whole export, then writes the date into each photo's EXIF, each video's creation time and each file's modified date",
      "Checks every file afterwards, deletes only the JSON files whose date it applied, and tells you what it skipped",
    ],
    prompt:
      "I downloaded my Google Photos with Takeout and all the dates are wrong and there are json files everywhere. Fix the dates and get rid of the json mess.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-10",
      platform: "Linux (Omarchy)",
      model: "Stella’s own models (GPT-6 Luna)",
      result:
        "56 of 59 photos and videos got their real date on the first pass, and their 56 JSON files were deleted after a full backup. Stella left three “-edited” copies alone because they have no JSON of their own; one follow-up message gave them the same date as their originals. Checked afterwards, file by file: 59 of 59 match Google's photoTakenTime.",
      note: "The Takeout folder is a test export made for this run, with the naming quirks of real exports (cut-off names, numbered copies, edited copies, an album). Stella worked about 3½ minutes, then under a minute on the follow-up; those waits are sped up 15× and 10×.",
      video: {
        src: `${PROOFS}/photos-files/fix-google-takeout-photo-dates/proof.mp4`,
        poster: `${PROOFS}/photos-files/fix-google-takeout-photo-dates/poster.jpg`,
        width: 1280,
        height: 800,
        duration: 93,
        realDuration: 322,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. The Takeout export is already unzipped in Downloads." },
        { at: 8, text: "The prompt is sent. It doesn't say where the photos are." },
        { at: 19, text: "Stella replies with its plan: fix the dates from the JSON files, remove a JSON only once its date is applied, and delete no photos or videos." },
        { at: 21, text: "Reading the JSON files, testing on copies, backing up and writing dates, sped up 15×." },
        { at: 36, text: "Done: dates fixed on 56 photos and videos, their JSON files removed, a backup linked, three edited copies left unchanged and the album's own metadata.json kept." },
        { at: 59, text: "The follow-up, typed in the chat: the -edited photos are copies of the photo next to them, so give them the same date." },
        { at: 74, text: "Stella says it will match each edited copy to its original and change nothing else." },
        { at: 80, text: "Done: all three edited copies now carry their original's date, and their old versions are in the backup." },
      ],
      shots: [
        {
          src: `${PROOFS}/photos-files/fix-google-takeout-photo-dates/dates.png`,
          alt: "A table of twelve sample files from the export: every file date was the download day, 10 November 2026, and is now the date the photo was taken, such as 18 November 2023 for IMG_3675.JPG.",
          width: 1400,
          height: 690,
          caption: "Our check after the run, for 12 of the 59 files: the date before (the download day) and after (Google's photoTakenTime).",
        },
      ],
    },
    manualTitle: "Fix the dates yourself (free)",
    manualSteps: [
      {
        title: "Unzip every part into one folder",
        body: "Big Takeout exports come as several zip files, and a photo and its JSON can land in different parts. Extract all of them into the same folder, keep the original zips until you've checked the result, and don't delete any JSON yet: it's the only copy of the dates.",
      },
      {
        title: "Run Google Photos Takeout Helper (GPTH)",
        body: "Download GPTH from its GitHub releases page and install ExifTool too, or GPTH can only write dates into JPEG files. On Windows, double-click gpth.exe and answer its questions; on a Mac or Linux, run it from Terminal. Point it at the zips or your extracted folder and an empty output folder.",
      },
      {
        title: "Or copy the dates with ExifTool",
        body: "For new-style exports, `exiftool -r -d %s -tagsfromfile \"%d/%F.supplemental-metadata.json\" \"-DateTimeOriginal<PhotoTakenTimeTimestamp\" -ext jpg -overwrite_original Takeout` copies each date into its JPEG photo. Run it again with `%d/%F.json` for older names. Cut-off names and numbered copies won't match, so rename or fix those by hand.",
      },
      {
        title: "Fix the file dates and the edited copies",
        body: "`exiftool \"-FileModifyDate<DateTimeOriginal\" -r Takeout` sets each file's date to the photo's date, which is what Explorer and Finder sort by. Files ending in -edited have no JSON of their own; give them their original's date, or skip them.",
      },
      {
        title: "Check a few, then remove the JSON files",
        body: "Open a handful of photos from different years in your photo app and check the dates. Once they're right, delete the .json files (on Windows, search the folder for *.json and delete the results), or move them to a folder of their own if you'd rather keep the GPS and descriptions.",
      },
    ],
    limits: [
      "The recording was on Linux, where the tools it needed were already installed. On Windows or a Mac the same job needs a metadata tool such as ExifTool, so expect Stella to install one first.",
      "It deleted the JSON files without asking, because the prompt said to get rid of them. It made a full backup first and linked it in the chat, but the backup sits in Stella's own outputs folder, not next to your photos. Say “move the JSON files to a folder” if you'd rather keep them.",
      "It fixed dates only. It didn't sort photos into year folders, remove the copies that albums duplicate, or write GPS locations, because the prompt didn't ask; ask for those by name.",
      "It skipped the -edited copies on the first pass and needed a one-line follow-up for them. Check the list of skipped files it gives you.",
      "Your photos stay on your computer, but file names and the JSON text go to the AI model you use in Stella while it works.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What are the JSON files in Google Takeout?",
        a: "One per photo or video, holding what Google knew about it: the date it was taken (photoTakenTime), the upload date, GPS, the description and people tags. Google writes them beside the photos instead of into them, so most apps ignore them.",
      },
      {
        q: "Can I delete the JSON files?",
        a: "Only after the dates are in the photos. Before that, they're the only record of when each photo was taken. Afterwards they're safe to delete, unless you want the descriptions or GPS that a date-only fix leaves out.",
      },
      {
        q: "Why do some JSON names look cut off?",
        a: "Google shortens long names, so you'll see `.supplemental-metada.json`, `.sup.json` or a shortened photo name. Numbered copies are swapped too: `photo(1).jpg` goes with `photo.jpg(1).json`. That's why simple one-line scripts miss some files.",
      },
      {
        q: "Is there a paid tool that does this?",
        a: "Yes. MetadataFixer is a paid app built for exactly this, and GPTH is free and open source. Stella is free with the ChatGPT or Claude plan you already have, and does the same matching. It also handles the next job, like sorting the photos by year or [tidying the Downloads folder](/how/pc-cleanup/organize-downloads-folder) they arrived in.",
      },
    ],
    related: ["pc-cleanup/organize-downloads-folder", "pc-cleanup/c-drive-full-for-no-reason"],
    lastChecked: "2026-11-10",
    sources: [
      { label: "Google: Download your Google Photos data (Takeout)", href: "https://support.google.com/accounts/answer/3024190" },
      { label: "Google Photos Takeout Helper (GPTH)", href: "https://github.com/Xentraxx/GooglePhotosTakeoutHelper" },
      { label: "ExifTool", href: "https://exiftool.org" },
    ],
  },
];
