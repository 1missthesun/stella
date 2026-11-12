import { PROOFS, webCuts } from "../media";
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
    lede: "Every photo back on the day it was taken, and the JSON files gone.",
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
        cuts: webCuts("photos-files/fix-google-takeout-photo-dates"),
        poster: `${PROOFS}/photos-files/fix-google-takeout-photo-dates/poster.jpg`,
        width: 1280,
        height: 800,
        duration: 93,
        realDuration: 308,
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
    related: ["photos-files/sort-photos-into-folders-by-date", "photos-files/convert-heic-to-jpg", "photos-files/rename-pdf-files-based-on-content"],
    lastChecked: "2026-11-10",
    sources: [
      { label: "Google: Download your Google Photos data (Takeout)", href: "https://support.google.com/accounts/answer/3024190" },
      { label: "Google Photos Takeout Helper (GPTH)", href: "https://github.com/Xentraxx/GooglePhotosTakeoutHelper" },
      { label: "ExifTool", href: "https://exiftool.org" },
    ],
  },
  {
    slug: "rename-pdf-files-based-on-content",
    niche: "photos-files",
    searchPhrases: [
      "rename pdf files based on content",
      "bulk rename pdf files",
      "auto rename pdf files based on content free",
      "ai to rename pdf files",
      "rename scanned pdf files automatically",
    ],
    title: "Rename PDF files based on their content, in bulk",
    description:
      "Turn scan0001.pdf into 2026-03-14_Northwind_Plumbing.pdf: rename PDFs by date and company by hand, with Power Automate, or with Stella (stella.sh) reading each one.",
    h1: "Rename PDF files based on their content",
    short: "Rename PDFs by content",
    lede: "scan0012.pdf becomes 2026-03-14_Northwind_Plumbing.pdf, for every file.",
    answer:
      "Windows and macOS can only rename files by their old names or a counter, not by what's inside. For a few dozen PDFs, open each in the preview pane and rename it by hand; for one repeating layout, a Power Automate Desktop flow can read the text and rename. Scans need OCR first. Stella (stella.sh) reads every PDF, scans included, and renames them to a pattern like date and company.",
    stellaSteps: [
      "Finds the folder and pulls the text out of every PDF; in the recording, `pdftotext` and the OCR tool `tesseract` were already on the computer, so it installed nothing",
      "Spots the scans with no text layer, renders them as images and reads them with OCR",
      "Works out each document's date and company, telling apart look-alikes such as an invoice and a credit note from the same firm",
      "Renames every file through temporary names, so no two files can overwrite each other, and turns characters like “&” and “é” into safe ones",
      "Checks that every file is still there afterwards and mentions any judgement call, such as which date it used for a bank statement",
    ],
    prompt:
      "Rename all these scanned PDFs based on what's in them, like date and company. They're in my Documents/Scans folder.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-10",
      platform: "Linux (Omarchy)",
      model: "Stella’s own models (GPT-6 Luna)",
      result:
        "All 26 PDFs renamed to YYYY-MM-DD_Company.pdf in about a minute, including three image-only scans read with OCR. Checked afterwards by file hash: contents unchanged, nothing overwritten, and 24 names match our answer key exactly. The other two used a different date printed on the document (a statement's start date, a tenancy's agreement date), and Stella mentioned the statement one.",
      note: "The 26 documents are fictitious invoices, bills, payslips, letters and receipts made for this run, named scan0001.pdf and so on. The wait is sped up 6×.",
      video: {
        src: `${PROOFS}/photos-files/rename-pdf-files-based-on-content/proof.mp4`,
        cuts: webCuts("photos-files/rename-pdf-files-based-on-content"),
        poster: `${PROOFS}/photos-files/rename-pdf-files-based-on-content/poster.jpg`,
        width: 1280,
        height: 800,
        duration: 45,
        realDuration: 71,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. The scans are in Documents/Scans with names like scan0012.pdf." },
        { at: 5, text: "The prompt: rename the PDFs by what's in them, like date and company." },
        { at: 11, text: "Stella replies that it will read the PDFs and rename them by the date and company in each." },
        { at: 12, text: "Reading 26 PDFs, running OCR on three scans and renaming, sped up 6×." },
        { at: 26, text: "Done: all 26 renamed to YYYY-MM-DD_Company.pdf, contents unchanged, with a note on the one date it had to choose." },
      ],
      shots: [
        {
          src: `${PROOFS}/photos-files/rename-pdf-files-based-on-content/names.png`,
          alt: "A table of all 26 files: scan0012.pdf became 2025-08-18_Morgan_Lettings.pdf, scan0013.pdf became 2026-03-14_Northwind_Plumbing.pdf, Scanned Document.pdf became 2026-06-18_Hotel_Alfama_Lisboa.pdf, and so on.",
          width: 1400,
          height: 1250,
          caption: "Every file before and after, with what each document is. Three were image-only scans.",
        },
      ],
    },
    manualTitle: "Rename them yourself",
    manualSteps: [
      {
        title: "Pick one naming pattern",
        body: "Date first, in year-month-day order, then who it's from: `2026-03-14 Northwind Plumbing.pdf`. Files then sort by date in any folder. Add the type or number only if you need it (`Invoice 2231`); long names get cut off in some apps.",
      },
      {
        title: "Do a few dozen by hand",
        body: "On Windows, turn on File Explorer's preview pane (Alt+P), click a PDF to see it, press F2 and type the new name. On a Mac, select a file, press Space for Quick Look, close it, press Return and type. It's dull but reliable for up to about 50 files.",
      },
      {
        title: "Make scans readable first",
        body: "A scan is only a picture of text, so nothing can read its date until it has been through OCR. The free OCRmyPDF adds a text layer from the command line (`ocrmypdf scan.pdf scan.pdf`); Adobe Acrobat's paid Scan & OCR tool does the same in a window.",
      },
      {
        title: "Automate one repeating layout",
        body: "Power Automate Desktop is free on Windows. Build a flow with Get files in folder, then Extract text from PDF, pull the date and supplier out with a text or regular-expression action, then Rename file(s). It works well when every PDF comes from the same company, and breaks on mixed documents.",
      },
      {
        title: "Or try a renaming app",
        body: "Apps like renamer.ai read each file with AI and suggest a name. Its free plan covers 25 files a month, paid plans start at $9.95 for 200, and files go to its servers by default. Check a handful of names before you trust a whole batch.",
      },
    ],
    limits: [
      "In the recording Stella renamed straight away, without showing the new names first, and the chat didn't list them. Add “show me the new names before you rename” to the prompt if you want to check them, or ask for a list of old and new names afterwards.",
      "There's no undo file. Renaming is easy to reverse while you have the list, so keep it, or copy the folder first for anything important.",
      "Each document gets one date. Stella used the first date of a bank statement's period and the date a tenancy was signed; say which date you want (issue, due, period end) if it matters.",
      "The OCR tool was already installed on the test computer. On a typical Windows PC, Stella has to install one first or read scans with the AI model, which hasn't been recorded yet.",
      "The text of your documents goes to the AI model you use in Stella. For payslips or bank letters, choose your model accordingly.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can Windows rename PDFs by their content on its own?",
        a: "No. File Explorer and PowerToys PowerRename only change names using the existing name, a counter or file dates. Reading what's inside needs Power Automate, a script, an app or Stella.",
      },
      {
        q: "Will it work on scanned documents?",
        a: "Yes, once they've been through OCR. In the recording, three of the 26 were image-only scans, grey and slightly crooked, and each got the right date and company.",
      },
      {
        q: "Can it put the files into folders too?",
        a: "Yes, ask in the same chat: by year, by company or by type. The same approach is used to [sort a messy Downloads folder](/how/pc-cleanup/organize-downloads-folder), and the numbers inside statements can go into [one Excel sheet](/how/pdf-excel/bank-statement-pdf-to-excel).",
      },
      {
        q: "Is renamer.ai or Stella better for this?",
        a: "renamer.ai is built for renaming and has a desktop app with watched folders. Stella has no per-file limit beyond your plan's usage and runs on your own computer; it's free with the ChatGPT or Claude plan you already have, and it does the next job too.",
      },
    ],
    related: ["pdf-excel/bank-statement-pdf-to-excel", "pc-cleanup/organize-downloads-folder"],
    lastChecked: "2026-11-10",
    sources: [
      { label: "Microsoft: Extract text from PDF (Power Automate Desktop)", href: "https://learn.microsoft.com/en-us/power-automate/desktop-flows/actions-reference/pdf" },
      { label: "OCRmyPDF", href: "https://ocrmypdf.readthedocs.io" },
      { label: "renamer.ai pricing", href: "https://renamer.ai/pricing" },
    ],
  },

  {
    slug: "convert-heic-to-jpg",
    niche: "photos-files",
    searchPhrases: [
      "heic to jpg",
      "convert heic to jpg windows",
      "heic to jpg batch converter windows",
      "convert iphone photos to jpg",
      "heic to jpg bulk free",
    ],
    title: "Convert HEIC to JPG in bulk on Windows (keep the dates)",
    description:
      "Convert a folder of iPhone HEIC photos to JPG so they open on any Windows PC, keeping the date taken: free Microsoft add-ons, a batch converter, or Stella (stella.sh).",
    h1: "Convert HEIC photos to JPG in bulk",
    short: "HEIC to JPG in bulk",
    lede: "Every iPhone photo as a JPG that opens anywhere, with the date taken kept.",
    answer:
      "HEIC is the iPhone's photo format, and many Windows PCs and apps can't open it. To only view them, install Microsoft's HEIF and HEVC extensions; to share or edit them anywhere, convert to JPG with a batch tool such as XnConvert and keep the metadata. Stella (stella.sh) converts a whole folder on your computer, subfolders included, keeps the date taken and leaves the originals in place.",
    stellaSteps: [
      "Finds every HEIC file in the folder you name, including subfolders and odd extensions like a lowercase `.heic`",
      "Checks what the photos hold first: size, rotation, date taken and location, so it knows what has to carry over",
      "Converts each one to a full-size JPG next to the original with the same name; in the recording it used ImageMagick at quality 92, writing each file under a temporary name first",
      "Skips any photo that already has a JPG, and leaves videos and screenshots alone",
      "Checks every new JPG opens and has its date taken, then tells you how many it converted and where they are",
    ],
    prompt:
      "Convert all my iPhone HEIC photos to JPG so they open on my Windows PC. They're in Pictures/iPhone Photos.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-12",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "All 30 HEIC photos converted to full-size JPGs in under two minutes, including four in a subfolder and one with a lowercase extension. Checked afterwards against an answer key: every JPG opens, has the same size and orientation, and keeps the exact date taken (and the camera make and model); the 30 originals, a Live Photo video and two screenshots are byte-for-byte unchanged.",
      note: "The photos are generated images saved as real iPhone-style HEIC files with dates taken from March to October 2026, made for this run. The 99-second wait is sped up 12×. The computer's name is blurred in the file manager at the end.",
      video: {
        src: `${PROOFS}/photos-files/convert-heic-to-jpg/proof.mp4`,
        cuts: webCuts("photos-files/convert-heic-to-jpg"),
        poster: `${PROOFS}/photos-files/convert-heic-to-jpg/poster.jpg`,
        width: 1280,
        height: 800,
        duration: 46.3,
        realDuration: 111,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. 30 iPhone HEIC photos are in Pictures/iPhone Photos, four of them in a subfolder." },
        { at: 3, text: "The prompt: convert them all to JPG so they open on a Windows PC." },
        { at: 11, text: "Stella replies that the JPGs will go next to the originals and the HEIC files stay where they are." },
        { at: 13, text: "Checking the photos' dates and rotation, then converting all 30, sped up 12×." },
        { at: 23, text: "Done: 30 converted, none failed, full resolution with the date taken kept. The video clip and two screenshots were left alone." },
        { at: 38, text: "The folder opened from the chat: each HEIC photo with its new JPG beside it." },
      ],
    },
    manualTitle: "Convert them yourself",
    manualSteps: [
      {
        title: "Only need to view them? Add Microsoft's extensions",
        body: "In the Microsoft Store, install HEIF Image Extensions (free) and HEVC Video Extensions ($0.99). The Photos app and File Explorer thumbnails then show HEIC files. That's enough for viewing on your own PC, but people you send them to still need the same add-ons.",
      },
      {
        title: "Convert one photo in Photos or Paint",
        body: "With the extensions installed, open the photo in Photos, choose the three dots, Save as, and pick JPG; or open it in Paint and use Save as, JPEG picture. Fine for a handful, slow for a camera roll.",
      },
      {
        title: "Convert a whole folder with XnConvert",
        body: "Install the free XnConvert, drag the folder into the Input tab (tick to include subfolders), set Output format to JPG at quality 90 or higher, and check the option to keep metadata is on (in the Output tab's settings) so the date taken survives. Send the output to a new folder so nothing is overwritten.",
      },
      {
        title: "Or from the command line",
        body: "With ImageMagick installed, run `magick mogrify -format jpg -quality 92 *.HEIC` in the folder. It writes a JPG beside each photo and copies the EXIF data. Run it again in each subfolder, and check that lowercase `.heic` files were caught too.",
      },
      {
        title: "Stop it happening next time",
        body: "On the iPhone, Settings, Camera, Formats, Most Compatible makes new photos JPG. Or keep HEIC on the phone and set Settings, Apps, Photos, Transfer to Mac or PC to Automatic, which converts to JPG when you copy photos to a computer over a cable.",
      },
    ],
    limits: [
      "The JPGs take more space: about 38 MB for 30 photos that were 17 MB as HEIC. That's normal for JPG at high quality, and the originals are kept, so the folder roughly triples. Ask Stella to move the HEIC files to the Trash afterwards if you want the space back.",
      "The new files' “Date modified” is the day the photos were copied to the computer, not the day they were taken. Photos apps and Windows' “Date taken” column read the date inside the photo, which is kept; ask Stella to set the file dates too if you sort by Date modified.",
      "The recording is on Linux, where the HEIC converter was already installed. On a Windows PC, Stella has to install a converter first, which hasn't been recorded yet.",
      "Live Photos come as a photo plus a short video. Stella converts the photo and leaves the .MOV alone; the movement part doesn't become a JPG.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Does converting HEIC to JPG lose quality?",
        a: "A little in theory, not visibly at quality 90 or above. In the recording, each JPG measured 46 to 51 dB PSNR against its HEIC, well beyond what eyes can see. The bigger loss is HEIC-only extras like depth data for Portrait mode.",
      },
      {
        q: "Why won't Windows open my HEIC photos?",
        a: "Windows needs two add-ons from the Microsoft Store to read them: HEIF Image Extensions and HEVC Video Extensions. Some PCs come with them; many don't, and the HEVC one costs $0.99.",
      },
      {
        q: "Do online HEIC converters keep the date taken?",
        a: "Some do and some strip all metadata, and you're uploading your photos to someone else's server. Check one converted file's Properties, Details tab before trusting a whole batch.",
      },
      {
        q: "Can Stella also sort the photos into folders by date?",
        a: "Yes, in the same chat: by year and month from the date taken. If the dates themselves are wrong, as they often are after a Google Photos export, see [fixing Google Takeout photo dates](/how/photos-files/fix-google-takeout-photo-dates).",
      },
    ],
    related: ["photos-files/find-duplicate-photos", "photos-files/sort-photos-into-folders-by-date", "photos-files/fix-google-takeout-photo-dates"],
    lastChecked: "2026-11-12",
    sources: [
      { label: "Microsoft Store: HEIF Image Extensions", href: "https://apps.microsoft.com/detail/9pmmsr1cgpwg" },
      { label: "XnConvert", href: "https://www.xnview.com/en/xnconvert/" },
      { label: "ImageMagick: mogrify", href: "https://imagemagick.org/script/mogrify.php" },
    ],
  },
  {
    slug: "find-duplicate-photos",
    niche: "photos-files",
    searchPhrases: [
      "find duplicate photos",
      "duplicate photo finder windows free",
      "find duplicate photos including resized",
      "remove duplicate photos from pc",
      "find similar photos different size",
    ],
    title: "Find duplicate photos, including resized copies (free)",
    description:
      "Find duplicate photos on your PC, including resized WhatsApp copies and re-saved versions, and check before deleting: dupeGuru, Apple Photos, or Stella (stella.sh).",
    h1: "Find duplicate photos, including resized copies",
    short: "Find duplicate photos",
    lede: "Every copy found, the originals kept, and nothing deleted until you say so.",
    answer:
      "Exact copies are easy to find by comparing file contents, but resized or re-saved copies (the ones WhatsApp and old phone backups make) need a tool that compares the pictures themselves, such as the free dupeGuru in Picture mode. Review every group before deleting. Stella (stella.sh) finds both kinds on your computer, shows each group side by side with the copy it would keep, and deletes nothing until you reply.",
    stellaSteps: [
      "Scans the folder you name, subfolders included, and tells you up front that nothing will be deleted",
      "Finds exact copies by their file contents, then resized, re-saved and converted copies by comparing the pictures themselves",
      "Looks at the borderline pairs: in the recording it checked two similar sunset shots and kept both as different photos, and flagged a file named “edited” for you to decide",
      "Makes a review page with each group side by side, the copy it would keep (always the full-size original) and the space you'd get back",
      "Waits for your answer, then moves the copies to the Trash, where Restore puts them back",
    ],
    prompt:
      "Find duplicate photos in my Pictures folder, including resized copies, and show me before deleting anything.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-12",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "All 14 copies among 38 photos found, against an answer key written before the run: 6 exact copies, 5 resized ones down to 800 pixels wide, a lower-quality re-save, a half-size PNG and a copy with its camera data stripped. None of the 12 look-alike pairs (two shots of the same scene) was flagged. Nothing changed until the reply; then the 14 copies went to the Trash and all 24 originals were byte-for-byte unchanged.",
      note: "The photos are generated images made for this run, with copies spread over Old phone backup and WhatsApp Images folders. The first wait is sped up 12×, scrolling the review 2× and the clean-up 6×.",
      video: {
        src: `${PROOFS}/photos-files/find-duplicate-photos/proof.mp4`,
        cuts: webCuts("photos-files/find-duplicate-photos"),
        poster: `${PROOFS}/photos-files/find-duplicate-photos/poster.jpg`,
        width: 1280,
        height: 800,
        duration: 79.9,
        realDuration: 103,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Pictures holds 38 photos: originals, exact copies and smaller WhatsApp-style copies." },
        { at: 3, text: "The prompt: find duplicates, including resized copies, and show me before deleting anything." },
        { at: 9, text: "Stella replies that nothing will be deleted and a side-by-side review comes first." },
        { at: 11, text: "Comparing every photo, then checking the borderline pairs by eye, sped up 12×." },
        { at: 21, text: "The answer: 13 duplicates (12.9 MB), one “edited” copy for you to decide, two similar sunset shots kept. Nothing touched yet; it asks before moving them to the Trash." },
        { at: 39, text: "The review page, opened in Stella: each group side by side with the copy to keep." },
        { at: 47, text: "Scrolling through the groups, sped up 2×." },
        { at: 61, text: "The reply: delete the copies, keep the originals." },
        { at: 65, text: "Moving the 14 copies to the Trash, sped up 6×." },
        { at: 70, text: "Done: 24 originals left, 14 copies in the Trash, all restorable." },
      ],
      shots: [
        {
          src: `${PROOFS}/photos-files/find-duplicate-photos/review.jpg`,
          alt: "Stella's review page: 13 sure duplicates, 12.9 MB would be freed, 1 to check. The first group shows IMG_2105.jpg from Camera Roll marked Keep next to IMG_2105_edited.jpg from Old phone backup marked Remove?, with a note that no visible edit was found.",
          width: 760,
          height: 800,
          caption: "The review page Stella made before deleting anything.",
        },
      ],
    },
    manualTitle: "Find them yourself",
    manualSteps: [
      {
        title: "Back up first",
        body: "Copy the folder to an external drive or cloud storage before deleting anything. Duplicate finders are good, not perfect, and a photo deleted outside the Recycle Bin or Trash is hard to get back.",
      },
      {
        title: "Exact copies: any duplicate finder",
        body: "Free tools like dupeGuru (Standard mode) or Czkawka compare file contents, so they only match byte-identical files: the `IMG_1234 (1).jpg` kind. They're fast and safe, but miss every resized or re-saved copy.",
      },
      {
        title: "Resized copies: dupeGuru Picture mode",
        body: "Switch dupeGuru to Picture mode, add your Pictures folder, and scan. It compares the images themselves, so a 1600-pixel WhatsApp copy matches its 12-megapixel original. Start with the default filter hardness; raise it if different shots get grouped together.",
      },
      {
        title: "Review every group, then delete to the Trash",
        body: "Sort each group by size and keep the biggest, which is usually the original. Look at any pair with different names or dates before you mark it. In dupeGuru, use Send Marked to Trash (it goes to the Recycle Bin on Windows) rather than a permanent delete, so a mistake can be undone.",
      },
      {
        title: "Photos in Apple Photos? Use its Duplicates album",
        body: "On a Mac or iPhone, open Photos, then the Duplicates album under Utilities, and use Merge. It combines each group into the best-quality version and keeps the details. It only covers photos inside the Photos library, not loose folders.",
      },
    ],
    limits: [
      "Stella asked first here because the prompt said “show me before deleting anything”. Keep that sentence in your prompt; the recording doesn't show what it does without it.",
      "The review page was saved in your Pictures folder. Stella moved it to the Trash with the copies afterwards without mentioning it.",
      "It compares photos, not videos. Duplicate videos need a separate ask, and comparing them takes longer.",
      "Comparing pictures took a Python image library that Stella installed in its own folder first; on this Linux computer Python was already there. A Windows run hasn't been recorded yet.",
      "To check borderline pairs, Stella looks at small previews, so a few thumbnails go to the AI model you use in Stella. The full photos stay on your computer.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Will it delete a different photo that just looks similar?",
        a: "Not in the recording. Twelve pairs of near-identical shots (two boat photos, two sunsets) were planted as traps; none was flagged, and the closest pair was listed separately as “similar, not duplicates”.",
      },
      {
        q: "Which copy does it keep?",
        a: "The full-size original: the largest version with the camera data, in your camera or holiday folder. Copies from WhatsApp, backups or edits are the ones it proposes to remove, and you can swap any group before replying.",
      },
      {
        q: "Can I get deleted duplicates back?",
        a: "Yes, when they go to the Trash or Recycle Bin, which is what Stella did here: Restore puts each one back in its original folder. Emptying the Trash makes it permanent.",
      },
      {
        q: "Are duplicate photo cleaner apps safe?",
        a: "The open-source ones (dupeGuru, Czkawka) are. Be wary of “PC cleaner” apps that scan for free and then charge to delete. Whatever you use, review the groups and send deletions to the Trash.",
      },
    ],
    related: ["photos-files/sort-photos-into-folders-by-date", "photos-files/convert-heic-to-jpg", "pc-cleanup/organize-downloads-folder"],
    lastChecked: "2026-11-12",
    sources: [
      { label: "dupeGuru", href: "https://dupeguru.voltaicideas.net" },
      { label: "Apple: Merge duplicate photos and videos on iPhone", href: "https://support.apple.com/guide/iphone/merge-duplicate-photos-and-videos-iph1978d9c23/ios" },
      { label: "Czkawka", href: "https://github.com/qarmin/czkawka" },
    ],
  },
  {
    slug: "sort-photos-into-folders-by-date",
    niche: "photos-files",
    searchPhrases: [
      "sort photos into folders by date",
      "organize photos by date taken",
      "sort photos by year and month",
      "move photos into folders by exif date",
      "organize pictures into folders by date windows",
    ],
    title: "Sort photos into folders by year and month taken",
    description:
      "File photos into year and month folders by the date they were taken, not the file date: with ExifTool, digiKam or Lightroom, or ask Stella (stella.sh) to do it.",
    h1: "Sort photos into folders by the date they were taken",
    short: "Sort photos into folders by date",
    lede: "33 mixed photos filed into year and month folders by when they were taken, none lost.",
    answer:
      "Use the date taken stored inside each photo (EXIF), not the file's modified date, which changes whenever photos are copied. ExifTool does it with one command, and digiKam or Lightroom can file photos into date folders as they import. Stella (stella.sh) reads each photo's date, files it under year and month, keeps clashing names apart and leaves a log so every move can be undone.",
    stellaSteps: [
      "Reads the date taken stored inside every photo, the creation date inside videos, and ignores the misleading file dates and names",
      "Plans every move first, then files them into folders like 2024/03 - March",
      "Dates WhatsApp images and screenshots from the date in their names, which is where those apps keep it, and says so",
      "Puts photos with no date anywhere into an Undated folder instead of guessing",
      "Never overwrites: a second IMG_0001.JPG from the same month becomes IMG_0001 (1).JPG, and a log lists where every file came from",
    ],
    prompt:
      "Sort my photos into folders by year and month using the date they were taken. They're in Pictures/To sort.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-12",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "33 files were sorted into year and month folders from 2019 to 2026 in 47 seconds. Checked afterwards against the answer key written before the run: all 33 are there exactly once and byte-for-byte identical, all 26 photos with a date taken are in the right month (including four with misleading names, a leap day and a month boundary), both IMG_0001.JPG files survived, and the two with no date at all went to an Undated folder.",
      note: "The 33 test files are generated pictures with dates written into them for this run, all with a file date of the day they were copied, plus one short video. The wait is sped up 8×. There was no ExifTool on the test computer, so Stella wrote its own small date reader.",
      video: {
        src: `${PROOFS}/photos-files/sort-photos-into-folders-by-date/proof.mp4`,
        cuts: webCuts("photos-files/sort-photos-into-folders-by-date"),
        poster: `${PROOFS}/photos-files/sort-photos-into-folders-by-date/poster.jpg`,
        width: 1280,
        height: 800,
        duration: 39,
        realDuration: 47,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. 33 photos and a video are in Pictures/To sort, some in subfolders." },
        { at: 3, text: "The prompt: sort my photos into folders by year and month using the date they were taken." },
        { at: 8, text: "Stella replies that it will use each photo's capture date and list any with no date." },
        { at: 9, text: "Reading every file's date, planning the moves, then moving, sped up 8×." },
        { at: 14.8, text: "Done: 33 files sorted, 2019 to 2026. Two undated, four dated by their names, one name clash kept apart." },
        { at: 26.3, text: "The sorting log opened in Stella: where every file was, where it went, and how it was dated." },
      ],
    },
    manualTitle: "Sort them yourself",
    manualSteps: [
      {
        title: "Work on a copy first",
        body: "Copy the folder somewhere else before you start, or make sure it's in your backup. Moving thousands of files by a rule is quick to do and slow to undo by hand.",
      },
      {
        title: "With ExifTool (free, Windows, Mac and Linux)",
        body: "Install ExifTool, open a terminal in the folder and run `exiftool -r -d \"%Y/%m\" \"-Directory<CreateDate\" \"-Directory<DateTimeOriginal\" .` It moves each photo into a year/month folder from its date taken, falls back to the creation date for videos, and leaves files with no date where they are. Add `-o .` to copy them into the new folders instead of moving them.",
      },
      {
        title: "With digiKam or Lightroom",
        body: "digiKam (free) can create date-based albums as it imports from a folder or camera. In Lightroom Classic's Import window, set the Destination panel's Organize option to By Date and pick a year-and-month date format. Both use the date taken, not the file date.",
      },
      {
        title: "Deal with the leftovers",
        body: "Screenshots and WhatsApp images usually carry no date taken, but their names do (`IMG-20240312-WA0007.jpg`, `Screenshot_20250611-142233.png`); file those by hand or with a rename tool. Put anything with no date at all in an Undated folder rather than trusting the file date.",
      },
      {
        title: "Check nothing went missing",
        body: "Compare the file count before and after (right-click > Properties on Windows, Get Info on a Mac), and look out for names that clashed. ExifTool never overwrites a file with the same name; it leaves that photo where it was, so check the old folders for any left behind.",
      },
    ],
    limits: [
      "Files are moved, not copied, because that's what the prompt asks. The log makes every move reversible, but there's no second copy; ask for a copy instead if you want one.",
      "WhatsApp and screenshot dates come from their file names, which is usually right but not guaranteed. Photos with no date anywhere stay unsorted in Undated.",
      "33 files took under a minute. Tens of thousands will take longer, mainly to read each file's date, and photos in a cloud folder that aren't downloaded yet (OneDrive, iCloud) have to download first.",
      "It also deleted the subfolders that were left empty, and said so. Say “keep the old folders” if you'd rather it didn't.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why are my photos sorted by the wrong date?",
        a: "Most tools sort by the file's modified or created date, which changes every time photos are copied, downloaded or restored from a backup. The date the photo was taken is stored inside the file (EXIF DateTimeOriginal), and that's the one to sort by.",
      },
      {
        q: "Can Windows sort photos into folders by date taken?",
        a: "File Explorer can group and sort a view by Date taken, but it can't move files into folders by it. For that you need a tool like ExifTool, digiKam or Lightroom, or Stella.",
      },
      {
        q: "What happens to videos?",
        a: "Videos keep their date in a different place (the QuickTime creation date). Stella read it and filed the test video under July 2024; the ExifTool command above covers it with the CreateDate fallback.",
      },
      {
        q: "Can it also find duplicates or fix wrong dates?",
        a: "Yes, as separate asks: [find duplicate photos](/how/photos-files/find-duplicate-photos), or [fix Google Takeout photo dates](/how/photos-files/fix-google-takeout-photo-dates) if the dates themselves are wrong.",
      },
    ],
    related: ["photos-files/find-duplicate-photos", "photos-files/fix-google-takeout-photo-dates", "pc-cleanup/organize-downloads-folder"],
    lastChecked: "2026-11-12",
    sources: [
      { label: "ExifTool: Writing FileName and Directory tags", href: "https://exiftool.org/filename.html" },
      { label: "digiKam", href: "https://www.digikam.org" },
      { label: "Adobe: Import photos in Lightroom Classic", href: "https://helpx.adobe.com/lightroom-classic/help/photo-video-import-options.html" },
    ],
  },
];
