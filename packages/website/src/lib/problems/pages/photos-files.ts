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
      "google takeout photos all have the same date",
      "google takeout supplemental-metadata.json",
      "google takeout json to exif mac",
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
        title: "Export only Google Photos",
        body: "At takeout.google.com, select \u201cDeselect all\u201d, tick Google Photos, and choose .zip with the largest file size (50 GB) so the export is split into as few parts as possible. Google emails the download links when the export is ready; they work for about 7 days, and each part can be downloaded up to 5 times.",
      },
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
        body: "Open a handful of photos from different years in your photo app and check the dates, including a screenshot and a photo saved from a chat app, since those never had a camera date of their own. Once they're right, delete the .json files (on Windows, search the folder for *.json; in Finder, search for .json with the folder selected), or move them to a folder of their own if you'd rather keep the GPS and descriptions.",
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
        q: "Why do all my Takeout photos have the same date?",
        a: "The date your computer shows is the file's date, which becomes the day you unzipped the export. Camera photos usually still carry their own date taken inside the file, so a photo app that reads it looks fine. Screenshots, photos saved from chats, scans and some edited copies never had one, and for those the JSON is the only record.",
      },
      {
        q: "Does Google Takeout remove metadata from my photos?",
        a: "It doesn't strip what's already in the file, but anything you changed inside Google Photos, like a corrected date, a location you added or a description, lives only in the JSON. That's why the fix copies from the JSON rather than trusting the file.",
      },
      {
        q: "Is the date in the JSON in my time zone?",
        a: "No. photoTakenTime is a timestamp in UTC, while the date-taken field inside a photo has no time zone. Tools convert it to your computer's local time, so photos taken while travelling can come out a few hours off. That rarely moves a photo to a different day, but check any taken near midnight.",
      },
      {
        q: "Why are some photos in two folders?",
        a: "A photo that's in an album can appear twice: once in its \u201cPhotos from\u201d year folder and once in the album's folder. Fix the dates in both, then remove the extra copies with [a duplicate finder](/how/photos-files/find-duplicate-photos) if you only want one.",
      },
      {
        q: "Will Apple Photos or Windows Photos show the right dates afterwards?",
        a: "Yes. Both sort by the date taken inside each file, so import the folder after the fix, not before. Videos use their own creation time, which the fix sets too. To file everything by year and month as well, see [sorting photos into folders by date](/how/photos-files/sort-photos-into-folders-by-date).",
      },
      {
        q: "Is there a paid tool that does this?",
        a: "Yes. MetadataFixer is a paid app built for exactly this, and GPTH is free and open source. Stella is free with the ChatGPT or Claude plan you already have, and does the same matching. It also handles the next job, like sorting the photos by year or [tidying the Downloads folder](/how/pc-cleanup/organize-downloads-folder) they arrived in.",
      },
    ],
    related: ["photos-files/sort-photos-into-folders-by-date", "photos-files/convert-heic-to-jpg", "photos-files/rename-pdf-files-based-on-content", "photos-files/fix-wrong-date-on-photos"],
    lastChecked: "2026-11-13",
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
    related: ["pdf-excel/bank-statement-pdf-to-excel", "pc-cleanup/organize-downloads-folder", "files-folders/rename-multiple-files-at-once"],
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
    related: ["photos-files/find-duplicate-photos", "photos-files/sort-photos-into-folders-by-date", "photos-files/fix-google-takeout-photo-dates", "photos-files/resize-images-in-bulk", "photos-files/combine-photos-into-one-pdf", "photos-files/convert-webp-to-jpg"],
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
    related: ["photos-files/sort-photos-into-folders-by-date", "photos-files/convert-heic-to-jpg", "pc-cleanup/organize-downloads-folder", "photos-files/separate-screenshots-from-photos"],
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
  {
    slug: "resize-images-in-bulk",
    niche: "photos-files",
    searchPhrases: [
      "resize images in bulk",
      "batch resize images",
      "batch resize images mac",
      "reduce image size for website",
      "resize photos to under 300kb",
    ],
    title: "Resize images in bulk to a set size and file size",
    description:
      "Batch resize product photos to 1600 px and under 300 KB each with Preview, PowerToys Image Resizer, or Stella (stella.sh), keeping the originals as they were.",
    h1: "Resize images in bulk for your website",
    short: "Resize images in bulk",
    lede: "40 camera photos at 1600 px and about 100 KB each, the right way up.",
    answer:
      "On a Mac, open the photos in Preview, select them all and use Tools, Adjust Size to fit 1600 × 1600; on Windows, the free PowerToys Image Resizer does a whole selection from the right-click menu. Neither aims at a file size, so check a few and lower the JPEG quality if they're over your limit. Stella (stella.sh) makes resized copies at the size and weight you ask for, turned upright, and keeps the originals.",
    stellaSteps: [
      "Finds the Shop photos folder on the Desktop: 40 camera photos at 6000 × 4000, about 4 MB each",
      "Makes copies in a new Web 1600px folder inside it, 1600 px on the longest side",
      "Picks a JPEG quality that lands every file well under the 300 KB you asked for; they came out at about 100 KB",
      "Spots three photos stored sideways with a rotate tag, which some websites ignore, and turns those copies upright",
      "Removes camera and location details from the copies to keep them small, and tells you the originals still have them",
    ],
    prompt:
      "Make the product photos in the Shop photos folder on my Desktop smaller for my website: 1600 pixels on the longest side and under 300 KB each. Keep the originals.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "40 resized copies in about 2 minutes. Checked afterwards against an answer key written before the run: all 40 are 1600 px on the long side, every one is under 300 KB (the largest is 105 KB), the three sideways photos come out portrait, and the 40 originals are unchanged.",
      note: "The product photos are generated test images with camera-like texture and noise, made for this run. The work is sped up 6×.",
      video: {
        src: `${PROOFS}/photos-files/resize-images-in-bulk/proof.mp4`,
        cuts: webCuts("photos-files/resize-images-in-bulk"),
        poster: `${PROOFS}/photos-files/resize-images-in-bulk/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 45.4,
        realDuration: 121,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. 40 full-size product photos are in Shop photos on the Desktop." },
        { at: 2.1, text: "The prompt: 1600 pixels on the longest side, under 300 KB each, keep the originals." },
        { at: 13.7, text: "Stella replies: resized copies at that size and weight, originals unchanged." },
        { at: 19.6, text: "Resizing 40 photos and checking each one, sped up 6×." },
        { at: 31.4, text: "Done: all 40 in Web 1600px at about 100 KB each, three sideways photos turned upright, camera and location details removed from the copies." },
      ],
    },
    manualTitle: "Resize them yourself",
    manualSteps: [
      {
        title: "Copy the folder first",
        body: "Duplicate the folder (Option-drag on a Mac, copy and paste on Windows) and work on the copies. Preview saves over the files you open, so resizing the originals by mistake is easy.",
      },
      {
        title: "On a Mac: Preview",
        body: "Open all the copies in Preview, click a thumbnail in the sidebar and press Cmd-A to select every one, then choose Tools, Adjust Size. Pick Fit into, 1600 × 1600 pixels, keep Scale proportionally and Resample image ticked, click OK and save.",
      },
      {
        title: "On Windows: PowerToys Image Resizer",
        body: "Install Microsoft PowerToys (free), select the photos in File Explorer, right-click and choose Resize with Image Resizer (under Show more options on Windows 11). Set a custom 1600 × 1600 size with Fit, and tick the option to make copies instead of replacing the originals.",
      },
      {
        title: "Get under the file-size limit",
        body: "Neither tool aims at a number of KB. In PowerToys, lower the JPEG quality under Settings, Image Resizer, Encoding and run it again; in Preview, use File, Export with a lower Quality slider, one photo at a time. At 1600 px, a quality around 80 usually lands well under 300 KB.",
      },
      {
        title: "Check for sideways photos",
        body: "Cameras and phones often store photos sideways with a tag telling viewers to turn them. If a resized copy shows sideways on your site, rotate it in Preview or the Photos app and save, so the pixels themselves are upright.",
      },
    ],
    limits: [
      "JPEGs are re-saved, so a little quality is lost. Stella aimed well under the limit (about 100 KB each); ask for “as close to 300 KB as possible” if you'd rather keep more detail.",
      "It removed camera and location details from the copies without being asked. That's usually what you want on a website, but say so if you need them kept.",
      "The resizing runs on your computer with ordinary image tools, so the photos aren't uploaded to a resizing site.",
      "Recorded on Linux, where Stella used image tools that were already installed. A Mac has the built-in sips tool for this; on Windows it may install a small image library first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I resize many photos at once on a Mac?",
        a: "Open them all in Preview, select every thumbnail, then Tools, Adjust Size. It applies the same size to each, keeping proportions. For a target file size you still need to lower the quality per photo, or ask Stella.",
      },
      {
        q: "What size should product photos be for a website?",
        a: "Most shop platforms suggest somewhere between 1600 and 2048 px on the long side; check yours. Keeping each under about 300 KB helps pages load fast. Square crops are a separate step, so ask if your theme needs them.",
      },
      {
        q: "Will resizing remove the location from my photos?",
        a: "Some tools keep it, some don't. Stella's copies had camera and location details removed. To remove only the location and keep the date taken, see [remove location from photos](/how/photos-files/remove-location-from-photos).",
      },
      {
        q: "Can it convert iPhone HEIC photos too?",
        a: "Yes, in the same chat: [convert HEIC to JPG in bulk](/how/photos-files/convert-heic-to-jpg) and resize them in one go. Clear out repeats first with [find duplicate photos](/how/photos-files/find-duplicate-photos).",
      },
    ],
    related: ["photos-files/remove-location-from-photos", "photos-files/convert-heic-to-jpg", "photos-files/find-duplicate-photos", "photos-files/add-watermark-to-photos"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Microsoft: PowerToys Image Resizer", href: "https://learn.microsoft.com/en-us/windows/powertoys/image-resizer" },
      { label: "Apple: Resize, rotate or flip an image in Preview", href: "https://support.apple.com/guide/preview/prvw2015/mac" },
    ],
  },
  {
    slug: "remove-location-from-photos",
    niche: "photos-files",
    searchPhrases: [
      "remove location from photos",
      "remove exif data",
      "remove metadata from photos",
      "remove location from photo before posting",
      "remove gps from photos but keep date",
    ],
    title: "Remove location from photos but keep the date taken",
    description:
      "Strip the GPS location from a batch of photos before you post them, keeping the date taken: Photos, Preview, ExifTool, or Stella (stella.sh) on your computer.",
    h1: "Remove location from photos before you post them",
    short: "Remove location from photos",
    lede: "24 photos with no location left, the same dates, and the same pixels.",
    answer:
      "On a Mac, Photos can leave the location out when you share (Options, untick Location), and Preview's Inspector removes it one photo at a time. Windows' Remove Properties strips location in a copy but takes the dates with it. The free ExifTool does exactly the job: `exiftool -gps:all= *.jpg` removes location only. Stella (stella.sh) makes location-free copies of a whole folder, keeps the date taken and leaves the pictures untouched.",
    stellaSteps: [
      "Finds the garden party photos (24 in Pictures/Garden party) and reads their details: date taken, camera and GPS position",
      "Makes copies in a new Garden party (no location) folder with the GPS removed and the date and time taken kept",
      "Rewrites only the details, not the pictures, so nothing is re-compressed",
      "Checks that no copy has any location left and every date is intact",
      "Reminds you the originals still contain your home location, and that the copies still name the camera",
    ],
    prompt:
      "I want to post the garden party photos online, but they have my home location in them. Remove the location but keep the dates they were taken.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "24 clean copies in about 1 minute 30 seconds. Checked afterwards against an answer key written before the run: none of the 24 has any location data, each keeps its date taken and orientation, and the pictures are pixel-for-pixel identical to the originals.",
      note: "The photos are generated test images with made-up camera details and a test location, made for this run. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/photos-files/remove-location-from-photos/proof.mp4`,
        cuts: webCuts("photos-files/remove-location-from-photos"),
        poster: `${PROOFS}/photos-files/remove-location-from-photos/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 47.7,
        realDuration: 90,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. 24 garden party photos with a home location saved in them are in Pictures." },
        { at: 2, text: "The prompt: remove the location but keep the dates they were taken." },
        { at: 15.2, text: "Stella replies: cleaned copies in a new folder next to the originals, which stay unchanged." },
        { at: 21.1, text: "Removing GPS from 24 photos and checking them, sped up 3×." },
        { at: 33.6, text: "Done: 24 copies with no location and the same dates, and a reminder to post from the new folder." },
      ],
    },
    manualTitle: "Remove it yourself",
    manualSteps: [
      {
        title: "Share without location from Photos (Mac and iPhone)",
        body: "When you share from the Photos app, click or tap Options and turn off Location before sending. To hide it on photos in your library, select them and choose Image, Location, Hide Location. Files you exported earlier still carry it.",
      },
      {
        title: "Preview, one photo at a time (Mac)",
        body: "Open the photo in Preview, choose Tools, Show Inspector, click the info tab and then GPS, and click Remove Location Info. Save. It's reliable, but slow for a whole album.",
      },
      {
        title: "Windows: Remove Properties",
        body: "Select the photos in File Explorer, right-click, Properties, Details, Remove Properties and Personal Information, and choose Create a copy with all possible properties removed. This takes the date taken too; open one copy's Details afterwards to be sure the location is gone.",
      },
      {
        title: "ExifTool for exactly this job",
        body: "The free [ExifTool](https://exiftool.org/) removes only the location and keeps everything else: `exiftool -gps:all= -xmp:geotag= -o cleaned/ *.jpg` writes cleaned copies into a folder called cleaned. Without `-o` it edits in place and keeps backups ending in _original.",
      },
      {
        title: "Check before you post",
        body: "Open a cleaned copy's info (Preview's Inspector, or Properties, Details on Windows) and look for latitude and longitude. Some sites strip location when you upload, but email, messaging apps and your own website usually pass the file on as it is.",
      },
    ],
    limits: [
      "It only changes files on your computer. Photos already posted, or still in a cloud library with their location, keep it there.",
      "The originals still have the location. Post from the cleaned folder; Stella left the originals alone for you to keep or delete.",
      "It kept the camera model, because it was only asked to remove location. Ask if you also want camera details or all metadata removed.",
      "The details Stella reads while working, which include the coordinates, go to the AI model you use in Stella. The photos are cleaned on your computer.",
      "Recorded on Linux. On a Mac or Windows PC Stella may install ExifTool or a small Python library first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Do social networks remove location from photos?",
        a: "The big ones generally strip it from the image when you upload, but email, messaging apps, forums and personal websites often pass the original file on. Cleaning the files yourself means you don't have to know which is which.",
      },
      {
        q: "Can I remove the location but keep the date taken?",
        a: "Yes. Location and date are separate fields. ExifTool's `-gps:all=` and Stella both remove location only, while Windows' Remove Properties and many online strippers remove both.",
      },
      {
        q: "Does removing metadata reduce photo quality?",
        a: "Not if only the metadata is rewritten: in the recording the pictures were pixel-for-pixel identical. Tools that re-save the JPEG lose a little quality. To make web-sized copies anyway, [resize them in bulk](/how/photos-files/resize-images-in-bulk).",
      },
      {
        q: "How do I stop my iPhone adding location?",
        a: "Go to Settings, Privacy & Security, Location Services, Camera and choose Never. New photos then have no location; older ones still do. For documents, [redact a PDF](/how/pdf-excel/redact-pdf) before you share it.",
      },
    ],
    related: ["photos-files/resize-images-in-bulk", "photos-files/sort-photos-into-folders-by-date", "pdf-excel/redact-pdf"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Change and view location information in Photos on Mac", href: "https://support.apple.com/guide/photos/phta4e5a733f/mac" },
      { label: "Apple Personal Safety: Manage location metadata in Photos", href: "https://support.apple.com/guide/personal-safety/ips0d7a5df82/web" },
      { label: "ExifTool", href: "https://exiftool.org/" },
    ],
  },
  {
    slug: "combine-photos-into-one-pdf",
    niche: "photos-files",
    searchPhrases: [
      "combine photos into one pdf",
      "convert images to pdf",
      "combine jpg into one pdf",
      "photos of document pages to pdf",
      "combine photos into one pdf small enough to email",
    ],
    title: "Combine photos into one PDF, in order and small enough to email",
    description:
      "Turn phone photos of a document's pages into one PDF in page order, upright and small enough to email: Finder's Create PDF, print to PDF, or Stella (stella.sh).",
    h1: "Combine photos into one PDF, in page order",
    short: "Combine photos into one PDF",
    lede: "12 phone photos of a contract as one 2.5 MB PDF, every page upright and in order.",
    answer:
      "On a Mac, select the photos in Finder in page order, right-click and choose Quick Actions, Create PDF. On Windows, select them, right-click, Print, and choose Microsoft Print to PDF. Watch for sideways photos, iPhone HEIC files some tools reject, and a PDF too big to email. Stella (stella.sh) reads the page numbers to get the order right, turns sideways pages upright and makes one small PDF.",
    stellaSteps: [
      "Finds the 12 page photos in Downloads, including two iPhone HEIC files mixed in with the JPGs",
      "Puts them in order by reading the “Page N of 12” printed on each page, rather than trusting the file names, and checks none are missing or repeated",
      "Turns the two photos that were taken sideways the right way up",
      "Compresses the pages so the PDF is 2.5 MB while the small print stays readable",
      "Names the PDF after the document (“Rental Agreement - 12 Orchard Row”), leaves the photos unchanged, and offers to crop and straighten the slightly tilted pages",
    ],
    prompt:
      "I photographed every page of my rental agreement with my phone. The photos are in Downloads. Make them into one PDF, in page order, small enough to email.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "One 12-page PDF of 2.6 MB in about 1 minute 30 seconds. Checked afterwards against an answer key written before the run: page n is photo n with none missing or repeated, every page is upright including the two sideways photos, the file is well under the 20 MB email limit, and the photos are unchanged.",
      note: "The photos are generated pictures of a fictitious tenancy agreement on a desk, at phone resolution; two are stored sideways and two are HEIC, on purpose. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/photos-files/combine-photos-into-one-pdf/proof.mp4`,
        cuts: webCuts("photos-files/combine-photos-into-one-pdf"),
        poster: `${PROOFS}/photos-files/combine-photos-into-one-pdf/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 42.3,
        realDuration: 93,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. 12 phone photos of a rental agreement's pages are in Downloads." },
        { at: 2.1, text: "The prompt: one PDF, in page order, small enough to email." },
        { at: 11.3, text: "Stella replies: it'll put the pages in order by reading them and make one compressed PDF that's easy to read." },
        { at: 17.1, text: "Ordering, rotating and combining the photos, sped up 4×." },
        { at: 28.4, text: "Done: 12 pages in order, 2.5 MB, two sideways photos turned upright, the photos unchanged." },
      ],
    },
    manualTitle: "Combine them yourself",
    manualSteps: [
      {
        title: "Get the order right first",
        body: "Rename the photos or sort them so they're in page order: phone file names usually follow the order you took them, but a retaken page lands at the end. Check the page numbers on the paper if there are any.",
      },
      {
        title: "On a Mac: Create PDF in Finder",
        body: "Select the photos in Finder (click the first, Shift-click the last), right-click and choose Quick Actions, Create PDF. Finder makes one PDF in the same folder and respects the rotation stored in each photo. HEIC files work too.",
      },
      {
        title: "On Windows: print to PDF",
        body: "Select the photos in File Explorer, right-click and choose Print (under Show more options on Windows 11), pick Microsoft Print to PDF and a full-page layout, and untick Fit picture to frame if edges get cut off. HEIC photos need the HEIF Image Extensions from the Microsoft Store.",
      },
      {
        title: "Shrink it to email",
        body: "Phone photos make big PDFs, often 30 MB or more. On a Mac, open the PDF in Preview, File, Export, and choose Reduce File Size in Quartz Filter; on Windows, PDF24 Creator's Compress tool works offline. Check the small print afterwards.",
      },
      {
        title: "Scanning next time",
        body: "The Notes app on iPhone (Scan Documents) and Google Drive on Android scan pages straight into one PDF, cropped and flattened, which saves this whole job.",
      },
    ],
    limits: [
      "It didn't crop or straighten the pages, so a bit of desk shows at the edges and some pages are slightly tilted. It said so and offered to fix it; ask for it in the prompt if you want a clean scan look.",
      "Stella read each page to find its page number, so the page images or their text go to the AI model you use in Stella (here Claude). For very private documents, choose your model accordingly.",
      "Recorded on Linux, where the image tools it needed, including HEIC support, were available. A Mac has the built-in sips tool for HEIC; on Windows Stella may install an image library first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I combine photos into one PDF on iPhone?",
        a: "Select the photos in the Photos app, tap Share, then Print, and pinch out on the preview to get a PDF you can save to Files. Or scan the pages from the start with Notes, Scan Documents.",
      },
      {
        q: "Why are some pages sideways in my PDF?",
        a: "Phones often save photos sideways with a tag telling viewers to turn them. Tools that ignore the tag put those pages sideways. Finder's Create PDF and Stella both read it.",
      },
      {
        q: "How small does the PDF need to be for email?",
        a: "Under about 20 MB to be safe: Gmail allows 25 MB and Outlook suggests 20. For forms and portals with a 2 to 5 MB limit, see [compress a PDF](/how/pdf-excel/compress-pdf-too-large-to-email).",
      },
      {
        q: "Can I make the PDF searchable?",
        a: "Yes. The pages are photos, so search finds nothing until OCR runs: [make a scanned PDF searchable](/how/pdf-excel/make-scanned-pdf-searchable). If the photos are HEIC and you need JPGs too, [convert HEIC to JPG](/how/photos-files/convert-heic-to-jpg).",
      },
    ],
    related: ["pdf-excel/compress-pdf-too-large-to-email", "pdf-excel/make-scanned-pdf-searchable", "photos-files/convert-heic-to-jpg", "photos-files/make-a-contact-sheet", "pdf-excel/merge-pdf-files"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Perform quick actions in Finder on Mac", href: "https://support.apple.com/guide/mac-help/mchl97ff9142/mac" },
      { label: "PDF24 Creator", href: "https://tools.pdf24.org/en/creator" },
    ],
  },
  {
    slug: "add-watermark-to-photos",
    niche: "photos-files",
    searchPhrases: [
      "add watermark to photos",
      "watermark photos",
      "batch watermark photos",
      "add watermark to photos in bulk",
      "add text watermark to multiple photos",
    ],
    title: "Add a watermark to photos in bulk, in the right corner",
    description:
      "Put your shop name in the bottom-right corner of every photo, upright ones included, as new copies: XnConvert, Preview, or Stella (stella.sh) on your own computer.",
    h1: "Add a watermark to all your photos at once",
    short: "Add a watermark to photos",
    lede: "Sixteen shop photos with your name in the bottom-right corner, originals untouched.",
    answer:
      "For a whole folder, the free XnConvert (Windows, Mac, Linux) adds a Text action in a chosen corner to every photo and saves copies. Preview on a Mac does one photo at a time. Watch portrait phone photos: many tools draw on the sideways-stored picture, so the mark lands in the wrong corner. Stella (stella.sh) watermarked sixteen product photos in the bottom-right as you see them, sized to each photo, and saved copies in a new folder.",
    stellaSteps: [
      "Finds the Shop photos folder in Pictures: 16 product photos, three of them stored sideways with a flag that turns them upright when shown",
      "Turns each photo upright first, so the watermark lands bottom-right as you see the picture",
      "Writes “Fernhollow Ceramics” in soft white serif text with a light shadow, sized to each photo, in the bottom-right corner",
      "Saves the copies with the same file names in a new Shop photos (watermarked) folder, then looks at a few to check placement",
      "Confirms the originals are unchanged and keeps the watermark recipe so new shop photos can get the same mark later",
    ],
    prompt:
      "Put 'Fernhollow Ceramics' as a watermark in the bottom right corner of every photo in my Shop photos folder in Pictures. Save them as new copies and leave the originals alone.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "16 watermarked copies in about 1 minute 30 seconds. Checked afterwards against an answer key written before the run: one copy per photo, the same size and right way up, a watermark in the bottom-right corner of each photo as displayed (the three sideways-stored ones included), the rest of each photo unchanged, and the originals untouched.",
      note: "The shop and its photos are fictitious, drawn for this run; three were saved sideways with a rotation flag, the way phones store portrait shots. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/photos-files/add-watermark-to-photos/proof.mp4`,
        cuts: webCuts("photos-files/add-watermark-to-photos"),
        poster: `${PROOFS}/photos-files/add-watermark-to-photos/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 46.9,
        realDuration: 92,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A Shop photos folder in Pictures holds 16 product photos." },
        { at: 1.63, text: "The prompt: “Fernhollow Ceramics” in the bottom-right corner of every photo, as new copies." },
        { at: 14.63, text: "Stella replies it's saving watermarked copies and leaving the originals alone." },
        { at: 20.63, text: "Turning photos upright, adding the watermark and checking a few." },
        { at: 32.63, text: "Done: all 16 in Shop photos (watermarked); three stored sideways were saved upright so the mark sits bottom-right." },
      ],
    },
    manualTitle: "Watermark them yourself",
    manualSteps: [
      {
        title: "XnConvert (Windows, Mac, Linux)",
        body: "Install the free XnConvert and add the folder on the Input tab. On Actions, add Image, Text: type the name, choose the font and size, set the position to bottom-right and the opacity to about 60%. On Output, choose a new folder and keep the original names, then Convert.",
      },
      {
        title: "Turn portrait photos upright first",
        body: "Phones save upright photos sideways with an orientation flag. In XnConvert, add Image, Rotate, Auto (or tick the option to use the EXIF orientation) before the Text action, so the mark lands in the corner you see.",
      },
      {
        title: "Mac: Preview, one at a time",
        body: "Open a photo in Preview, show the Markup toolbar, click the Text tool, type the name and drag it into the corner. Set the colour and font with the text style button, then File, Export to save a copy.",
      },
      {
        title: "Size it to the photo",
        body: "A fixed font size looks huge on small photos and tiny on large ones. Aim for text about 4% of the shorter side, with a margin of about 3%. White text with a soft dark shadow reads on both light and dark backgrounds.",
      },
      {
        title: "Keep the originals",
        body: "Always write to a new folder. You'll want clean photos later for print, a marketplace that forbids watermarks, or a new logo.",
      },
    ],
    limits: [
      "A visible watermark deters casual reuse, but it can be cropped or edited out.",
      "This run used text. A logo image works the same way, but wasn't part of the test.",
      "To check placement, Stella looked at a few of the watermarked copies, so those images went to the AI model you use in Stella, along with file names. The watermarking itself ran on your computer.",
      "Recorded on Linux, where ImageMagick and the font were already installed. On a Mac or Windows PC Stella would usually install ImageMagick or use Python first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I watermark many photos at once for free?",
        a: "XnConvert's Text action, applied to a folder, is the free desktop route. Stella did sixteen in one go and saved them as copies.",
      },
      {
        q: "Why did my watermark end up in the wrong corner on some photos?",
        a: "Those photos are stored sideways with a rotation flag. The tool drew on the stored picture, and when the photo turns upright the mark moves. Turning photos upright first fixes it.",
      },
      {
        q: "Will the watermarked copy lose quality?",
        a: "JPG copies are re-saved once. At high quality (Stella used 92) the difference isn't visible; the check found the rest of each photo unchanged.",
      },
      {
        q: "What else can it do before I upload them?",
        a: "Resize them for the shop: see [resize images in bulk](/how/photos-files/resize-images-in-bulk). And [remove the location from photos](/how/photos-files/remove-location-from-photos) before posting.",
      },
    ],
    related: ["photos-files/resize-images-in-bulk", "photos-files/remove-location-from-photos", "photos-files/convert-webp-to-jpg", "photos-files/remove-background-from-photos"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "XnConvert", href: "https://www.xnview.com/en/xnconvert/" },
      { label: "Apple: Annotate an image in Preview on Mac", href: "https://support.apple.com/guide/preview/prvw1501/mac" },
    ],
  },
  {
    slug: "convert-webp-to-jpg",
    niche: "photos-files",
    searchPhrases: [
      "convert webp to jpg",
      "webp to jpg",
      "avif to jpg",
      "png to jpg",
      "webp to jpg bulk",
    ],
    title: "Convert WebP, AVIF and PNG to JPG in bulk, no black backgrounds",
    description:
      "Turn pictures saved from websites (WebP, AVIF, PNG) into JPGs a printing site accepts, with see-through areas white: Preview, XnConvert, or Stella (stella.sh).",
    h1: "Convert WebP (and AVIF, PNG) to JPG",
    short: "Convert WebP to JPG",
    lede: "Fifteen WebP, AVIF and PNG pictures as full-size JPGs, transparent bits made white.",
    answer:
      "On a Mac, open the pictures in Preview, select them all and use File, Export Selected Images as JPEG. On Windows, Paint saves one WebP as JPG; for many files and AVIF, use the free XnConvert. The usual snag is transparency: stickers and logos often come out on black. Stella (stella.sh) converted fifteen WebP, AVIF and PNG files to full-size JPGs in a new folder, with transparent areas white, and warned which would only print small.",
    stellaSteps: [
      "Finds the pictures in Downloads: 8 WebP, 3 AVIF and 4 PNG files, plus a JPG and a PDF that don't need converting",
      "Checks each one's size and whether it has transparency or animation",
      "Converts each to a high-quality JPG at the same width and height, putting a white background behind see-through areas",
      "Saves them with the same names in a new JPG for printing folder in Downloads, then looks at a contact sheet of all fifteen to check them",
      "Leaves the originals, the JPG and the PDF alone, and says they're website-sized, so the biggest is sharp only up to about a 6×4 print",
    ],
    prompt:
      "I saved a bunch of pictures from websites into my Downloads and they're WebP, AVIF and PNG files. The photo printing site I use only takes JPG. Can you make JPG versions of all of them?",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "15 JPGs in about 1 minute 20 seconds. Checked afterwards against an answer key written before the run: all 15 converted with the same names, really JPEG inside, the same width and height, looking the same as the originals, the three transparent pictures on white rather than black, the JPG and PDF left alone, and the originals unchanged.",
      note: "The pictures were drawn for this run; three have see-through backgrounds with soft edges. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/photos-files/convert-webp-to-jpg/proof.mp4`,
        cuts: webCuts("photos-files/convert-webp-to-jpg"),
        poster: `${PROOFS}/photos-files/convert-webp-to-jpg/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 42.7,
        realDuration: 79,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Downloads holds WebP, AVIF and PNG pictures saved from websites." },
        { at: 1.63, text: "The prompt: make JPG versions of all of them for a photo printing site." },
        { at: 12.63, text: "Stella replies: full-resolution JPGs in a new folder, see-through areas white, originals unchanged." },
        { at: 18.63, text: "Converting fifteen pictures and checking a contact sheet." },
        { at: 28.7, text: "Done: 15 JPGs in JPG for printing, with a note that they're website-sized and will only print small." },
      ],
    },
    manualTitle: "Convert them yourself",
    manualSteps: [
      {
        title: "Mac: Preview",
        body: "Select the pictures in Finder and open them together in Preview. In the sidebar press Cmd+A, then File, Export Selected Images. Click Options, choose JPEG and a folder. Recent macOS reads WebP and AVIF; check one transparent picture comes out white.",
      },
      {
        title: "Windows: Paint for one file",
        body: "Open the WebP in Paint and choose File, Save as, JPEG picture. Paint fills transparent areas with white when it saves. Older Windows versions may need the free WebP or AVIF extensions from the Microsoft Store to open them.",
      },
      {
        title: "Many files: XnConvert",
        body: "In the free XnConvert, add the files, set Output format to JPG at quality 90 or more, and add Actions, Image, Flatten (or set a white background) so transparency doesn't turn black. Choose an output folder and Convert.",
      },
      {
        title: "Command line: ImageMagick",
        body: "`magick sticker.webp -background white -alpha remove -quality 92 sticker.jpg` converts one with a white background. Without `-background white -alpha remove`, transparent areas often come out black.",
      },
      {
        title: "Check the print size",
        body: "For a sharp print you need about 300 pixels per inch: a 1800×1200 picture prints well at 6×4 inches. Pictures saved from websites are often smaller, so look for a larger original before ordering big prints.",
      },
    ],
    limits: [
      "JPG has no transparency, so stickers and logos get a solid white background.",
      "JPG is lossy. Keep the originals if you might edit the pictures again.",
      "File names, picture sizes and a small contact sheet of the results went to the AI model you use in Stella; the conversion ran on your computer, not on a converter website.",
      "Recorded on Linux, where ImageMagick was already installed. On a Mac or Windows PC Stella would usually install a converter first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why do my converted PNGs have a black background?",
        a: "The converter dropped the transparency without filling it, and empty pixels became black. Flatten onto white first, as Stella did for the two stickers and the logo.",
      },
      {
        q: "How do I convert AVIF to JPG?",
        a: "Preview on recent macOS, XnConvert, or ImageMagick all read AVIF. Paint on Windows needs the AV1 extension from the Microsoft Store.",
      },
      {
        q: "Will converting reduce quality?",
        a: "Slightly, as JPG compresses. At quality 90 to 95 the difference isn't visible; the check found every JPG matching its original closely.",
      },
      {
        q: "What about iPhone HEIC photos?",
        a: "See [convert HEIC to JPG](/how/photos-files/convert-heic-to-jpg). To make them smaller for upload, see [resize images in bulk](/how/photos-files/resize-images-in-bulk).",
      },
    ],
    related: ["photos-files/convert-heic-to-jpg", "photos-files/resize-images-in-bulk", "photos-files/add-watermark-to-photos", "photos-files/convert-tiff-to-jpg"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Convert image file types using Preview on Mac", href: "https://support.apple.com/guide/preview/prvw1012/mac" },
      { label: "XnConvert", href: "https://www.xnview.com/en/xnconvert/" },
      { label: "ImageMagick command-line options", href: "https://imagemagick.org/script/command-line-options.php" },
    ],
  },
  {
    slug: "fix-wrong-date-on-photos",
    niche: "photos-files",
    searchPhrases: [
      "change date taken on photos",
      "how to change date on photos",
      "change photo date",
      "change date taken on photos batch",
      "camera clock wrong photo dates",
    ],
    title: "Fix the wrong date on camera photos (shift date taken)",
    description:
      "Camera clock reset? Shift every photo's date taken by the same amount so they sort with your phone photos: Photos on Mac, ExifTool, or Stella (stella.sh).",
    h1: "Change the date taken on photos with a wrong camera clock",
    short: "Fix the wrong date on photos",
    lede: "24 camera photos moved from 2019 to the right afternoon, gaps between them kept.",
    answer:
      "Don't set every photo to the same time: shift them all by the camera's clock error, using one photo whose real time you know. On a Mac, select the photos in Photos and choose Image, Adjust Date and Time, which shifts the rest by the same amount. ExifTool does it to the files on any computer. Stella (stella.sh) shifted 24 wedding photos from a camera stuck in 2019 to the right afternoon, left the phone photos alone and kept backups.",
    stellaSteps: [
      "Finds the wedding folder in Pictures: 24 camera photos dated 1 January 2019 and 8 phone photos with the right dates",
      "Tells them apart by the camera that took them, and works out the clock error from the first camera photo and the real time you gave, 2:15 pm on 5 September 2026",
      "Copies the camera photos into a backup folder, then shifts each one's date taken, date digitised and date modified by that same amount, so gaps between shots stay the same",
      "Writes a list of every old and new time beside the backup, and doesn't re-save the pictures themselves",
      "Checks the camera shots now run 2:15 to 4:51 pm among the phone shots, and notes they still group apart when sorted by name rather than date",
    ],
    prompt:
      "My camera's clock reset after the battery died, so all my camera photos from Ana and Tomas's wedding in Pictures say 1 January 2019. The first one was actually taken at 2:15 pm on 5 September 2026. Fix the dates so they sort properly with the phone photos in the same folder.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "24 photos fixed in about 1 minute 20 seconds. Checked afterwards against an answer key written before the run: every camera photo's date taken shifted by exactly the clock error, its date digitised too, the pictures themselves unchanged, the 8 phone photos left with their dates, and no stray copies with the wrong date mixed in.",
      note: "The wedding, the couple and the photos are fictitious, drawn for this run with a camera clock set wrong on purpose. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/photos-files/fix-wrong-date-on-photos/proof.mp4`,
        cuts: webCuts("photos-files/fix-wrong-date-on-photos"),
        poster: `${PROOFS}/photos-files/fix-wrong-date-on-photos/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 46.43,
        realDuration: 80,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A wedding folder in Pictures mixes camera photos dated 2019 with phone photos." },
        { at: 1.63, text: "The prompt: the first camera photo was really 2:15 pm on 5 September 2026; fix the dates." },
        { at: 13.63, text: "Stella replies every camera shot moves by the same amount, phone photos untouched, originals backed up first." },
        { at: 19.63, text: "Backing up and shifting 24 photos' dates." },
        { at: 31.83, text: "Done: the camera photos run 2:15 to 4:51 pm among the phone photos; sort by date, not name." },
      ],
    },
    manualTitle: "Fix the dates yourself",
    manualSteps: [
      {
        title: "Work out the clock error",
        body: "Pick one camera photo whose real time you know, or one taken at the same moment as a phone photo. The difference between its wrong time and the real time is the shift for every photo from that camera.",
      },
      {
        title: "Mac: Photos",
        body: "Import the folder into Photos, select only the camera photos, and choose Image, Adjust Date and Time. Set the first selected photo's real date and time; Photos shifts the rest by the same amount. To get files with the new date, use File, Export, Export Unmodified Original with the metadata option ticked.",
      },
      {
        title: "Any computer: ExifTool",
        body: "With the free ExifTool, in the photo folder, `exiftool \"-AllDates+=7:8:4 14:10:23\" -if '$Make eq \"Halvorsen\"' .` adds 7 years, 8 months, 4 days, 14 hours, 10 minutes and 23 seconds to that camera's photos only. It keeps `_original` backups. Swap in your own camera's make and shift.",
      },
      {
        title: "Windows: one photo at a time",
        body: "File Explorer's Properties, Details, Date taken lets you type a date for one photo. It doesn't shift by an amount, so for more than a handful use ExifTool.",
      },
      {
        title: "Fix the camera for next time",
        body: "Set the date and time in the camera's menu after a battery change, ideally from your phone's clock to the minute. Some cameras sync time from a phone app.",
      },
    ],
    limits: [
      "It needs one photo whose real time you know; everything else shifts by the same amount.",
      "Videos from the same camera need the same shift in their own date fields; there were none in this test.",
      "File names, camera details and dates went to the AI model you use in Stella; the photos weren't opened as pictures and their dates were changed on your computer.",
      "Recorded on Linux, where the exiv2 photo-data tool was already installed. On a Mac or Windows PC Stella would usually install ExifTool or a similar tool first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can I change the date taken on many photos at once?",
        a: "Yes, by shifting them. Photos on a Mac does it inside its library; ExifTool changes the files on any computer. Stella shifted 24 in one go and kept backups.",
      },
      {
        q: "Will changing the date affect photo quality?",
        a: "No. The date lives in the photo's metadata. Stella rewrote only those fields, and the check confirmed the pictures themselves were unchanged.",
      },
      {
        q: "Why do my photos still not line up when sorted by name?",
        a: "Camera files (DSC_…) and phone files (PXL_…) have different names, so name order groups them. Sort by date taken, or ask Stella to rename them all to start with the date.",
      },
      {
        q: "My Google Photos download has wrong dates. Is that the same?",
        a: "It's a different cause: see [fix Google Takeout photo dates](/how/photos-files/fix-google-takeout-photo-dates). To file photos by month, see [sort photos into folders by date](/how/photos-files/sort-photos-into-folders-by-date).",
      },
    ],
    related: ["photos-files/fix-google-takeout-photo-dates", "photos-files/sort-photos-into-folders-by-date", "photos-files/separate-screenshots-from-photos"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Photos on Mac, titles, captions and date and time", href: "https://support.apple.com/guide/photos/phta4e5a733f/mac" },
      { label: "ExifTool: Date/Time Shift", href: "https://exiftool.org/Shift.html" },
    ],
  },
  {
    slug: "separate-screenshots-from-photos",
    niche: "photos-files",
    searchPhrases: [
      "separate screenshots from photos",
      "move screenshots to folder",
      "how to separate screenshots from photos",
      "screenshots folder",
      "delete screenshots",
    ],
    title: "Separate screenshots from photos into their own folder",
    description:
      "Move screenshots out of a photo folder, including iPhone ones named like photos, without touching the real photos: Finder, File Explorer, or Stella (stella.sh).",
    h1: "Separate screenshots from your photos",
    short: "Separate screenshots from photos",
    lede: "Fourteen screenshots moved to their own folder, 26 real photos left where they were.",
    answer:
      "Searching for “Screenshot” in file names misses iPhone screenshots, which are named IMG_1234.PNG like photos. On a Mac, Finder can find them with a search for Is Screen Capture; on Windows, sorting by type and dimensions helps. Stella (stella.sh) told 14 screenshots from 26 photos by screen-sized dimensions and missing camera details, moved them to a Screenshots folder, and left a list to undo it.",
    stellaSteps: [
      "Lists the 40 pictures in Pictures with each one's size, format and camera details",
      "Finds 14 screenshots: Android, Mac and Windows ones named “Screenshot…”, plus 5 iPhone ones named like photos (IMG_2204.PNG) that are exactly a phone screen's size with no camera details",
      "Looks at one of the iPhone ones to confirm it's a screenshot",
      "Moves the 14 into a new Screenshots folder inside Pictures without deleting anything, keeping real photos that share a number (IMG_2204.JPG) where they were",
      "Writes moved-files.txt in the Screenshots folder listing everything it moved, so you can put any back",
    ],
    prompt:
      "My Pictures folder is a mess of real photos and screenshots all mixed together. Move the screenshots into their own folder so only the real photos are left.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Sorted in about 1 minute 15 seconds. Checked afterwards against an answer key written before the run: all 26 photos still in Pictures and unchanged, all 14 screenshots moved out (including the 5 iPhone ones named like photos), none deleted, and all of them in one folder with no photos in it.",
      note: "The photos and screenshots were made for this run, with real-looking names, sizes and camera details. The work is sped up 2×.",
      video: {
        src: `${PROOFS}/photos-files/separate-screenshots-from-photos/proof.mp4`,
        cuts: webCuts("photos-files/separate-screenshots-from-photos"),
        poster: `${PROOFS}/photos-files/separate-screenshots-from-photos/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 43.5,
        realDuration: 75,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Pictures holds 40 files: photos and screenshots mixed together." },
        { at: 1.63, text: "The prompt: move the screenshots into their own folder so only real photos are left." },
        { at: 10.63, text: "Stella replies it's moving screenshots to a new Screenshots folder, deleting nothing." },
        { at: 16.63, text: "Checking each file's size and camera details, then moving the screenshots." },
        { at: 29.37, text: "Done: 14 screenshots moved, 26 photos left, including five iPhone screenshots with photo-style names." },
      ],
    },
    manualTitle: "Sort them yourself",
    manualSteps: [
      {
        title: "Mac: Finder search",
        body: "Open Pictures and press Cmd+F. Click the first criterion menu, choose Other and tick Is Screen Capture, then set it to Yes. Select the results, make a new folder and drag them into it. This finds Mac screenshots; iPhone ones copied over may need the next steps.",
      },
      {
        title: "Spot iPhone screenshots",
        body: "iPhone screenshots are PNG files named IMG_xxxx.PNG at exactly the phone's screen size (for example 1179×2556), while photos are HEIC or JPG with a camera model in their details. In Finder's list view, add the Kind and Dimensions columns and sort by them.",
      },
      {
        title: "Windows: File Explorer",
        body: "New screenshots from Print Screen or the Snipping Tool already go to Pictures, Screenshots. For older mixed ones, switch to Details view, right-click the column header to add Dimensions and Camera model, sort, and move the screen-sized PNGs without a camera model into a new folder.",
      },
      {
        title: "On the phone",
        body: "iPhone and Android Photos apps keep a Screenshots album automatically. Delete or export screenshots there before syncing, so they don't mix into your photo folders.",
      },
      {
        title: "Move, don't delete",
        body: "Put screenshots in their own folder first and look through them later. Some hold receipts, tickets or confirmation numbers you may still need.",
      },
    ],
    limits: [
      "A photo of a screen taken with a camera counts as a photo, and a screenshot that somehow carries camera details can't be told apart.",
      "Pictures sent through chat apps lose their camera details and may look like screenshots; check the moved list if you save a lot from chats.",
      "File names, sizes and camera details went to the AI model you use in Stella, plus the one screenshot it opened to check. It moved files only; nothing was deleted.",
      "Recorded on Linux, where ImageMagick was already installed to read the picture details. On a Mac or Windows PC Stella would usually install a similar tool first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I separate screenshots from photos on iPhone?",
        a: "On the phone, the Photos app's Screenshots album already does it. On a computer, after importing, screenshots mix in with photos, which is what this guide sorts out.",
      },
      {
        q: "Why didn't searching for “Screenshot” find them all?",
        a: "iPhone screenshots are named IMG_xxxx.PNG, just like photos. Stella found five of them by their screen-sized dimensions and missing camera details.",
      },
      {
        q: "Can I undo the move?",
        a: "Yes. The Screenshots folder has moved-files.txt listing every file; move them back to Pictures, or ask Stella to.",
      },
      {
        q: "Can it tidy the rest of my pictures too?",
        a: "Yes: [find duplicate photos](/how/photos-files/find-duplicate-photos) or [sort photos into folders by date](/how/photos-files/sort-photos-into-folders-by-date). For Downloads, see [organize your Downloads folder](/how/pc-cleanup/organize-downloads-folder).",
      },
    ],
    related: ["photos-files/find-duplicate-photos", "photos-files/sort-photos-into-folders-by-date", "pc-cleanup/organize-downloads-folder"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Microsoft: Use Snipping Tool to capture screenshots", href: "https://support.microsoft.com/en-us/windows/use-snipping-tool-to-capture-screenshots-00246869-1843-655f-f220-97299b865f6b" },
      { label: "Apple: Take a screenshot on iPhone", href: "https://support.apple.com/en-us/102616" },
    ],
  },
  {
    slug: "convert-tiff-to-jpg",
    niche: "photos-files",
    searchPhrases: [
      "tiff to jpg",
      "convert tiff to jpg",
      "convert multi page tiff to jpg",
      "tiff to jpg without losing quality",
      "convert tiff to jpg on mac",
    ],
    title: "Convert TIFF scans to JPG, every page, colours kept",
    description:
      "Make JPG copies of TIFF scans for a website, including every page of multi-page TIFFs and CMYK or 16-bit files: Preview, XnConvert, ImageMagick or Stella (stella.sh).",
    h1: "Convert TIFF to JPG, including multi-page scans",
    short: "Convert TIFF to JPG",
    lede: "Six scanner TIFFs, one of them three pages long, turned into eight web-ready JPGs.",
    answer:
      "Open the TIFFs in Preview on a Mac and use File, Export Selected Images as JPEG, or use the free XnConvert on Windows for a whole folder. The traps are scanner extras: multi-page TIFFs where most converters keep only page 1, print-shop CMYK colours and 16-bit files. Stella (stella.sh) made JPGs of six scans, one JPG per page of a three-page letter, turned a sideways slide upright and fixed a CMYK postcard's colours for the web.",
    stellaSteps: [
      "Finds the six TIFFs in Documents/Scans and reads each one's pages, colour type and rotation flag",
      "Spots a three-page letter, a CMYK postcard, a 16-bit photo, a black-and-white certificate and a slide stored sideways",
      "Converts each page to its own high-quality JPG next to its TIFF, upright and in normal web colours",
      "Puts the JPGs on one sheet and looks at it to check every picture came out right",
      "Confirms the TIFFs are unchanged by comparing checksums before and after, and reports 8 JPGs from 6 files",
    ],
    prompt:
      "My scanner saved everything in the Scans folder in my Documents as TIFF files, and the family website only takes JPGs. Make JPG copies of all of them.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Eight JPGs in under a minute. Checked afterwards against an answer key written before the run: one JPG for each single-page scan and for each page of the three-page letter, each a real JPEG at full size, the right way up and with the same colours (CMYK and 16-bit files included), no stray extras, and the TIFFs unchanged.",
      note: "The scans are pictures and letters made for this run in the TIFF types scanners write: LZW, 16-bit, CMYK, 1-bit fax-style and multi-page, plus one stored sideways. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/photos-files/convert-tiff-to-jpg/proof.mp4`,
        cuts: webCuts("photos-files/convert-tiff-to-jpg"),
        poster: `${PROOFS}/photos-files/convert-tiff-to-jpg/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 46.03,
        realDuration: 86,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Six TIFF scans are in Documents/Scans." },
        { at: 1.57, text: "The prompt: make JPG copies of all of them for the family website." },
        { at: 14.07, text: "Stella replies it's making high-quality JPGs next to the originals, leaving the TIFFs alone." },
        { at: 20.07, text: "Reading each TIFF's pages and colours, converting, and checking a sheet of the results." },
        { at: 31.6, text: "Done: 8 JPGs from 6 scans (the letter has 3 pages); the sideways slide is upright and the postcard's colours fixed." },
      ],
    },
    manualTitle: "Convert them yourself",
    manualSteps: [
      {
        title: "Mac: Preview",
        body: "Select the TIFFs in Finder and open them in Preview. In the sidebar, select all the thumbnails (each page of a multi-page TIFF has its own), then File, Export Selected Images, click Options and set Format to JPEG.",
      },
      {
        title: "Windows or Mac: XnConvert",
        body: "In the free XnConvert, add the Scans folder on the Input tab, choose JPG on the Output tab with quality around 90, and click Convert. Check that a multi-page TIFF came out as one JPG per page.",
      },
      {
        title: "Windows: one at a time",
        body: "The Photos app opens a TIFF; choose the … menu, Save as, and pick JPG. It only saves the page you're looking at, so it's slow for multi-page scans.",
      },
      {
        title: "ImageMagick",
        body: "`magick \"Letter.tif\" -auto-orient -colorspace sRGB -depth 8 -quality 92 \"Letter.jpg\"` writes Letter-0.jpg, Letter-1.jpg and so on for each page, turns sideways scans upright and converts CMYK to screen colours.",
      },
      {
        title: "Keep the TIFFs",
        body: "JPG is smaller because it throws away detail. Keep the TIFFs as your archive copies and upload the JPGs.",
      },
    ],
    limits: [
      "JPG is lossy and 8-bit. The copies look the same on screen, but the TIFFs remain the better archive.",
      "CMYK scans are converted with a generic colour profile, so colours can differ slightly from the printed original.",
      "File names, the scans' technical details and a small sheet of thumbnails went to the AI model you use in Stella. The scans were converted on your computer.",
      "Recorded on Linux with ImageMagick already installed. On a Mac or Windows PC Stella would usually download a converter first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why did only the first page of my TIFF convert?",
        a: "Many converters read just page 1 of a multi-page TIFF. Preview shows every page as a thumbnail; Stella made one JPG per page.",
      },
      {
        q: "Does converting TIFF to JPG lose quality?",
        a: "A little, but at quality 90 or so you won't see it on a website. Keep the TIFFs for reprints.",
      },
      {
        q: "Why do my colours look wrong after converting?",
        a: "The TIFF is probably CMYK, made for printing. Converting to sRGB, as Stella did with the postcard, fixes it.",
      },
      {
        q: "What about WebP or HEIC pictures?",
        a: "See [convert WebP to JPG](/how/photos-files/convert-webp-to-jpg) and [convert HEIC to JPG](/how/photos-files/convert-heic-to-jpg).",
      },
    ],
    related: ["photos-files/convert-webp-to-jpg", "photos-files/convert-heic-to-jpg", "photos-files/make-a-contact-sheet"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Apple: Convert image file types using Preview on Mac", href: "https://support.apple.com/guide/preview/prvw1012/mac" },
      { label: "XnConvert (free batch image converter)", href: "https://www.xnview.com/en/xnconvert/" },
      { label: "ImageMagick command-line options", href: "https://imagemagick.org/script/command-line-options.php" },
    ],
  },
  {
    slug: "make-a-contact-sheet",
    niche: "photos-files",
    searchPhrases: [
      "contact sheet",
      "make a contact sheet",
      "print contact sheet of photos",
      "contact sheet with file names",
      "contact sheet maker",
    ],
    title: "Make a printable contact sheet of photos with file names",
    description:
      "Print all your photos as thumbnails with each file name underneath, to circle the ones to order: Apple Photos, XnView MP, ImageMagick or Stella (stella.sh).",
    h1: "Make a contact sheet of photos with file names",
    short: "Make a contact sheet",
    lede: "Thirty photos from a family shoot on three printable pages, each with its file name.",
    answer:
      "On a Mac, select the photos in Photos, choose File, Print, pick Contact Sheet and tick Filename under captions. Windows' own contact sheet print layout shows no names, so use the free XnView MP's Create, Contact sheet. Stella (stella.sh) laid 30 photos out on three Letter pages in shooting order, each name in bold underneath with room to circle it, and turned the photos stored sideways upright.",
    stellaSteps: [
      "Finds the 30 photos in “Ellis family shoot”, reads their sizes and rotation flags, and checks none are duplicates",
      "Looks at a preview of them all, and at the ones stored sideways to see which way they belong",
      "Lays them out 12 to a Letter page in shooting order, about 2.3 inches wide, with each file name in bold underneath and space to circle",
      "Saves “Ellis family shoot - contact sheet.pdf” in the same folder and renders the pages to check them",
      "Points out the photos look like drawings rather than real photos, in case the real shoot is in another folder",
    ],
    prompt:
      "I've got 30 photos from a family photo shoot in the Ellis family shoot folder in my Pictures. Make a contact sheet I can print, with each photo's file name under it, so we can circle the ones we want to order.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "A 3-page PDF in about 1 minute 10 seconds. Checked afterwards against an answer key written before the run: all 30 photos on it, every one the right way up (including those stored sideways with a rotation flag), every file name readable, on three printable pages, and the photos unchanged.",
      note: "The 30 photos are simple drawings of people with camera-style file names, made for this run. Stella noticed and said so, which is why its reply suggests the real photos might be elsewhere. The work is sped up 5×.",
      video: {
        src: `${PROOFS}/photos-files/make-a-contact-sheet/proof.mp4`,
        cuts: webCuts("photos-files/make-a-contact-sheet"),
        poster: `${PROOFS}/photos-files/make-a-contact-sheet/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 42.87,
        realDuration: 104,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Thirty photos are in Pictures/Ellis family shoot." },
        { at: 1.63, text: "The prompt: a printable contact sheet with each file name under its photo." },
        { at: 10.83, text: "Stella replies it's making a PDF with names under each photo and room to circle." },
        { at: 16.83, text: "Checking the photos and rotations, laying out the pages and rendering them (sped up)." },
        { at: 28.43, text: "Done: 3 Letter pages, 30 photos in shooting order, sideways ones turned upright; print at 100%." },
      ],
    },
    manualTitle: "Make one yourself",
    manualSteps: [
      {
        title: "Mac: Photos",
        body: "Select the photos, choose File, Print, and pick Contact Sheet on the right. Set the number of columns, tick Filename under Captions, then print, or choose PDF, Save as PDF to keep a copy.",
      },
      {
        title: "Windows: XnView MP",
        body: "In the free XnView MP (free for private use), select the photos and choose Create, Contact sheet. Turn on the file-name label, set the page size and layout, then save it as an image or print it.",
      },
      {
        title: "Windows: Print Pictures",
        body: "Select the photos in File Explorer, right-click, Print, and pick the Contact sheet layout (35 per page). It's quick, but it shows no file names, so you can't tell which photo to order.",
      },
      {
        title: "ImageMagick",
        body: "`magick montage -label '%f' *.jpg -auto-orient -thumbnail 400x400 -geometry +10+30 -tile 4x5 sheet.jpg`. Put `-label` before the file names or montage draws none, and keep `-auto-orient` or phone photos lie on their side.",
      },
      {
        title: "Print at actual size",
        body: "Print at 100% or Actual size, not Fit to page, so the thumbnails stay the size you chose and names stay readable.",
      },
    ],
    limits: [
      "Thumbnails are small by design. Check sharpness and closed eyes on the full photo before ordering.",
      "It shows file names only. Dates or captions under each photo would be a follow-up request.",
      "A low-resolution preview of the photos went to the AI model you use in Stella so it could check them. The PDF was made on your computer.",
      "Recorded on Linux with ImageMagick and Python's picture libraries already installed. On a Mac or Windows PC Stella would usually install them first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What is a contact sheet?",
        a: "A page of small prints of many photos, each labelled, used to choose which ones to print or order. Photographers made them from film; now they're a PDF.",
      },
      {
        q: "How many photos fit on a page?",
        a: "Up to about 35 if you only need to recognise them; 12 per Letter page, as Stella chose, leaves faces big enough to judge and room to circle.",
      },
      {
        q: "Why are some thumbnails sideways?",
        a: "Phones and cameras often store photos sideways with a flag to turn them. Tools that ignore the flag print them on their side; Stella turned them upright.",
      },
      {
        q: "Can I put all the full-size photos in one PDF instead?",
        a: "Yes: see [combine photos into one PDF](/how/photos-files/combine-photos-into-one-pdf).",
      },
    ],
    related: ["photos-files/combine-photos-into-one-pdf", "photos-files/find-duplicate-photos", "photos-files/put-photos-side-by-side"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Apple: Print your own photos on Mac (Contact Sheet)", href: "https://support.apple.com/guide/photos/pht6e15dbdb/mac" },
      { label: "XnView MP (free for private use)", href: "https://www.xnview.com/en/xnviewmp/" },
      { label: "ImageMagick: montage", href: "https://imagemagick.org/script/montage.php" },
    ],
  },
  {
    slug: "put-photos-side-by-side",
    niche: "photos-files",
    searchPhrases: [
      "put two photos side by side",
      "combine two photos into one",
      "before and after photo side by side",
      "put pictures side by side",
      "merge two pictures together side by side",
    ],
    title: "Put two photos side by side in one picture (before/after)",
    description:
      "Join a before and after photo side by side in one picture, the same height and nothing stretched: Paint, Preview, ImageMagick, or Stella (stella.sh) on your computer.",
    h1: "Put two photos side by side in one picture",
    short: "Put two photos side by side",
    lede: "Garden before and after photos joined side by side, both the right way up.",
    answer:
      "Make both photos the same height, then place them next to each other on one canvas. Paint on Windows and Preview on a Mac can do it by hand, and collage apps do it with a template. Watch for a stretched photo, and a phone photo that shows upside down because its rotation flag was ignored. Stella (stella.sh) joined a garden's before and after photos, before on the left, at the same height with nothing stretched, and turned the upside-down after photo the right way up.",
    stellaSteps: [
      "Finds the two photos in Pictures/Garden makeover: Garden before (3264×2448) and Garden after (4032×3024)",
      "Notices the after photo carries a flag saying it's stored upside down, and looks at both to confirm which way is up",
      "Scales both to the same height, puts them side by side with a thin white line between, before on the left",
      "Removes the hidden camera details, like location, from the new picture so they don't go out when it's posted",
      "Saves “Garden before and after.jpg” next to the originals, looks at it, and confirms the originals are unchanged",
    ],
    prompt:
      "Put my garden before and after photos (they're in my Pictures folder) side by side in one picture, before on the left and after on the right, so I can post it.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "The combined picture in about 40 seconds. Checked afterwards against an answer key written before the run: both photos in it unstretched, the after photo the right way up (its camera stored it upside down), before on the left and after on the right, both large (2,753 pixels wide each) and the same size, and the originals unchanged.",
      note: "The garden photos are drawings made for this run at two different camera sizes, with the after photo stored upside down with a rotation flag. The work is sped up 2×.",
      video: {
        src: `${PROOFS}/photos-files/put-photos-side-by-side/proof.mp4`,
        cuts: webCuts("photos-files/put-photos-side-by-side"),
        poster: `${PROOFS}/photos-files/put-photos-side-by-side/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 42.77,
        realDuration: 74,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Garden before and after photos are in Pictures." },
        { at: 1.63, text: "The prompt: put them side by side, before on the left, to post." },
        { at: 10.43, text: "Stella replies it's making the picture next to the originals and leaving them unchanged." },
        { at: 16.43, text: "Turning the upside-down after photo upright and joining the two." },
        { at: 28.4, text: "Done: same height, thin white line between, nothing stretched, location details removed." },
      ],
    },
    manualTitle: "Do it yourself",
    manualSteps: [
      {
        title: "Windows: Paint",
        body: "Open the before photo and drag the small handle on the right edge of the canvas to make it about twice as wide. Open the after photo in a second Paint window, Select all, Copy, then Paste into the first and drag it into the empty half. If the heights differ, Resize the after photo first.",
      },
      {
        title: "Mac: Keynote",
        body: "Preview can resize a photo (Tools, Adjust Size) but can't widen the canvas. Instead, drop both photos onto a blank Keynote slide, set them to the same height in the Format panel, line them up, then File, Export To, Images.",
      },
      {
        title: "Free editors",
        body: "In GIMP, open the before photo, use Image, Canvas Size to double the width, then File, Open as Layers for the after photo and move it to the right. Export as JPG.",
      },
      {
        title: "ImageMagick",
        body: "`magick before.jpg after.jpg -auto-orient -resize x2000 +append out.jpg` scales both to 2,000 pixels tall and joins them left to right. Without `-auto-orient`, a phone photo can come out sideways or upside down.",
      },
      {
        title: "Check before posting",
        body: "Look at the result at full size: neither photo should look squashed, the order should read before then after, and if the photos carry location data you may want to remove it.",
      },
    ],
    limits: [
      "The photos are matched in height. A portrait next to a landscape leaves very different widths; making them match means cropping one, which Stella didn't need to do here.",
      "No “Before” and “After” labels unless you ask; Stella can add them.",
      "Small previews of both photos went to the AI model you use in Stella so it could check which way was up. The picture was made on your computer.",
      "Recorded on Linux with ImageMagick already installed. On a Mac or Windows PC Stella would usually download it first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I put two photos side by side without stretching them?",
        a: "Resize both to the same height while keeping their proportions, then join them. Changing only the width is what stretches a photo.",
      },
      {
        q: "Why is one of my photos upside down when I combine them?",
        a: "Phones often save the picture rotated with a flag telling apps to turn it. Tools that ignore the flag show it as stored. Stella applied the flag.",
      },
      {
        q: "Can I put more than two photos together?",
        a: "Yes, ask for a grid. For many photos with names, see [make a contact sheet](/how/photos-files/make-a-contact-sheet).",
      },
      {
        q: "Should I remove location data before posting?",
        a: "It's wise for photos taken at home. Stella stripped it from the new picture; see [remove location from photos](/how/photos-files/remove-location-from-photos) for the originals.",
      },
    ],
    related: ["photos-files/make-a-contact-sheet", "photos-files/remove-location-from-photos", "photos-files/add-watermark-to-photos"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "GIMP (free image editor)", href: "https://www.gimp.org/" },
      { label: "ImageMagick: appending images", href: "https://imagemagick.org/script/command-line-options.php#append" },
    ],
  },
  {
    slug: "remove-background-from-photos",
    niche: "photos-files",
    searchPhrases: [
      "remove background from image",
      "remove background from multiple images",
      "remove background from product photos",
      "remove background from image free no sign up",
      "transparent background product photo",
    ],
    title: "Remove the background from many photos at once, offline",
    description:
      "Cut product photos out onto a transparent background, a whole folder at full size, without uploading: Preview, Paint, rembg, or Stella (stella.sh) on your computer.",
    h1: "Remove the background from multiple images at once",
    short: "Remove background from photos",
    lede: "Eight ceramics photos cut out onto transparent backgrounds, handle holes included.",
    answer:
      "For one photo, recent Macs have Remove Background in Preview and Windows 11's Paint has a Remove background button. For a folder, the free rembg tool runs a background-removal model on your own computer, so nothing is uploaded and there are no credits. Stella (stella.sh) set rembg up, cut out eight product photos as transparent PNGs, checked the edges up close and confirmed the gaps inside mug and teapot handles were see-through.",
    stellaSteps: [
      "Finds the eight photos in Pictures/Shop photos and looks at them: soft studio backdrop, drop shadows, and handles with gaps",
      "Installs the free rembg tool in its own separate Python environment, which downloads a background-removal model of about 170 MB",
      "Cuts out every photo onto a transparent background at full size, on this computer",
      "Checks the cut-outs on a bright magenta background and zooms in on handles, spouts and rims, then counts stray specks and holes",
      "Saves the PNGs in a new Transparent background folder with the same names, confirms the originals are unchanged, and flags that most file names don't match the colours shown",
    ],
    prompt:
      "I sell ceramics online. Remove the background from the product photos in the Shop photos folder in my Pictures so each one is on a transparent background, and keep the originals.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Eight transparent PNGs in about 2½ minutes, including the model download. Checked afterwards against an answer key written before the run: a real transparent cut-out of every photo at the same size, the outline matching each product (99–100% overlap with the true shape), the gaps inside the mug and teapot handles see-through, the products' own colours untouched, and the originals unchanged.",
      note: "The product photos are rendered ceramics on a studio backdrop, made for this run. Their colours didn't match their file names, which Stella pointed out. The work is sped up 12×.",
      video: {
        src: `${PROOFS}/photos-files/remove-background-from-photos/proof.mp4`,
        cuts: webCuts("photos-files/remove-background-from-photos"),
        poster: `${PROOFS}/photos-files/remove-background-from-photos/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 47.3,
        realDuration: 196,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Eight ceramics product photos are in Pictures/Shop photos." },
        { at: 1.63, text: "The prompt: remove the backgrounds onto transparent, keeping the originals." },
        { at: 14.43, text: "Stella replies the PNGs will go in a subfolder and it will check handles and rims." },
        { at: 20.43, text: "Installing a background-removal tool, cutting out the photos and checking the edges (sped up)." },
        { at: 32.87, text: "Done: 8 transparent PNGs, shadows gone, handle holes clear; most file names don't match the colours." },
      ],
    },
    manualTitle: "Remove it yourself",
    manualSteps: [
      {
        title: "Mac: Preview or Finder",
        body: "On recent macOS (Sonoma or later), open a photo in Preview and choose Tools, Remove Background, then File, Export as PNG. For several at once, select them in Finder, right-click, Quick Actions, Remove Background; it makes PNG copies.",
      },
      {
        title: "Windows 11: Paint",
        body: "Open the photo in Paint, click Remove background in the Image group on the toolbar, then File, Save as, PNG picture. One photo at a time, and it needs an up-to-date Paint.",
      },
      {
        title: "A whole folder: rembg",
        body: "With Python installed, `pip install \"rembg[cpu,cli]\"` then `rembg p \"Shop photos\" \"Transparent background\"` cuts out every photo in the folder. The first run downloads the model; after that it works offline.",
      },
      {
        title: "Check the hard parts",
        body: "View each cut-out on a bright colour, not white. Look at handles, gaps between arms, glass and fur: holes that should be see-through can stay filled, and shiny edges can be nibbled.",
      },
      {
        title: "Save as PNG or WebP",
        body: "JPG has no transparency, so a JPG “cut-out” comes back with a white or black box. Save as PNG, or WebP if your shop accepts it.",
      },
    ],
    limits: [
      "Edges came out crisp rather than softened. Stella said that looks right at full size, but small thumbnails on a dark background may show a slightly jagged outline, and offered to soften them.",
      "Hair, fur, glass and very fine detail are harder than ceramics; expect to touch some of those up.",
      "The drop shadow goes with the background. Add one back in your shop's editor if you want it.",
      "Stella downloaded and ran a background-removal model (about 170 MB) on your computer, so the photos weren't uploaded. A small preview sheet and close-ups did go to the AI model you use in Stella so it could check the edges.",
      "Recorded on Linux. On a Mac or Windows PC the same tool runs, after Stella installs Python and it, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can I remove backgrounds from multiple images at once for free?",
        a: "Yes. Finder's Remove Background quick action on a Mac handles a selection, and rembg handles a whole folder on any computer. Neither uploads your photos.",
      },
      {
        q: "Why is the gap in my mug's handle still filled in?",
        a: "Some tools only find the outer outline. Check holes on a coloured background; Stella confirmed each handle gap was see-through.",
      },
      {
        q: "Will the photos lose quality?",
        a: "No. The cut-outs are full size, and the product pixels are unchanged; only the background became transparent.",
      },
      {
        q: "Can I watermark the product photos too?",
        a: "Yes, see [add a watermark to photos](/how/photos-files/add-watermark-to-photos), or [resize images in bulk](/how/photos-files/resize-images-in-bulk) for your shop's size.",
      },
    ],
    related: ["photos-files/add-watermark-to-photos", "photos-files/resize-images-in-bulk", "photos-files/convert-webp-to-jpg"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Apple: Remove a background or extract an image in Preview on Mac", href: "https://support.apple.com/guide/preview/prvw15636/mac" },
      { label: "Windows Insider blog: Background removal in Paint", href: "https://blogs.windows.com/windows-insider/2023/09/07/background-removal-in-paint-begins-rolling-out-to-windows-insiders/" },
      { label: "rembg (free, local background removal)", href: "https://github.com/danielgatis/rembg" },
    ],
  },
];
