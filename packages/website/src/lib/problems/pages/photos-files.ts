import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const PHOTOS_FILES_PAGES: ProblemPage[] = [
  shortGuide({
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
      "Google Takeout photos all showing the wrong date? Stella (stella.sh) puts each photo's real date back from Google's JSON files, then clears those files away.",
    h1: "Google Takeout photos have the wrong date? Put the real dates back",
    short: "Google Takeout photo dates",
    lede: "Every photo back on the day it was taken, and the json clutter gone.",
    answer:
      "Google Takeout keeps each photo's real date in a JSON file beside it, so most apps show the download day. Stella (stella.sh) copies the real date into every photo and video, then removes the JSON files.",
    gets: ["Every photo and video on its real date", "The JSON files cleared away"],
    prompt:
      "My Google Takeout photos all show the wrong date and there are json files everywhere. Put the real dates back and clear out the json.",
    demo: {
      ack: "On it. Backing up the export first.",
      task: "Fixing your Takeout photo dates",
      rows: ["Matching each JSON file to its photo", "Writing the real date into each one"],
      reply:
        "Done. All **59 photos and videos** show the day they were taken, and their JSON files are gone. Three edited copies had no JSON, so they got their original's date.",
    },
    faq: [
      ["What are the JSON files in Google Takeout?", "One per photo or video, holding what Google knew about it, like the date taken (photoTakenTime), location and description. Most apps ignore them."],
      ["Why do all my Takeout photos have the same date?", "Your computer shows the day you unzipped the export. The real date is in each photo's JSON file."],
      ["What is supplemental-metadata.json?", "The newer name for Takeout's JSON files. Long names get cut short, to .supplemental-metada.json or .sup.json."],
    ],
    byHand: [
      "Unzip every Takeout part into one folder, since a photo and its JSON can land in different zips.",
      "Run the free [Google Photos Takeout Helper](https://github.com/Xentraxx/GooglePhotosTakeoutHelper) with ExifTool installed, pointing it at that folder.",
      "Check a few photos, then search the folder for .json and delete the results.",
    ],
    related: [
      "photos-files/sort-photos-into-folders-by-date",
      "photos-files/convert-heic-to-jpg",
      "photos-files/rename-pdf-files-based-on-content",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Rename PDF files based on their content, scans included. Stella (stella.sh) reads each PDF and renames the whole folder to a pattern like date and company.",
    h1: "Rename PDF files based on their content",
    short: "Rename PDFs by content",
    lede: "A folder of PDFs, each renamed by what's inside, like date and company.",
    answer:
      "Windows and Mac can only rename files by their old names or a number. To rename PDF files based on their content, ask Stella (stella.sh): it reads every PDF, scans too, and renames them your way.",
    gets: ["Every PDF named by its date and sender", "Scanned PDFs read too", "No file overwritten by another"],
    prompt:
      "Rename all the scanned PDFs in my Scans folder based on what's in them, like the date and the company, so I can find things.",
    demo: {
      ack: "Sure. Reading every PDF now.",
      task: "Renaming your scanned PDFs",
      rows: ["Reading the text in 26 PDFs", "Reading three image-only scans", "Renaming to date and company"],
      reply:
        "All **26 PDFs** are renamed like 2026-03-14_Northwind Plumbing.pdf. For a bank statement I used the date the period starts; say if you'd rather have the end.",
    },
    faq: [
      ["Is there a PDF renamer that reads the content?", "Stella reads each PDF and names it from what it finds. Apps like renamer.ai do it too, with a monthly cap on free use."],
      ["Can I rename PDFs online?", "Yes, but online renamers upload your documents. Stella renames the whole folder on your own computer."],
    ],
    byHand: [
      "Pick one pattern, date first as year-month-day, then the sender, so files sort by date.",
      "Windows: turn on the preview pane (Alt+P), click a PDF, press F2 and type the name. Mac: press Space to look, then Return to rename.",
      "Scans need text recognition first; the free OCRmyPDF or Adobe Acrobat adds it.",
    ],
    related: [
      "pdf-excel/bank-statement-pdf-to-excel",
      "pc-cleanup/organize-downloads-folder",
      "files-folders/rename-multiple-files-at-once",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Convert HEIC to JPG in bulk on Windows or Mac. Stella (stella.sh) converts a whole folder of iPhone photos, keeps the date taken and leaves the originals.",
    h1: "Convert HEIC photos to JPG in bulk",
    short: "HEIC to JPG in bulk",
    lede: "All your iPhone photos as JPGs that open anywhere, dates kept.",
    answer:
      "HEIC is the iPhone's photo format, and many Windows PCs can't open it. To convert HEIC to JPG in bulk, ask Stella (stella.sh): it converts the whole folder at full size and keeps each date taken.",
    gets: ["Full-size JPGs next to the originals", "The date taken kept on every photo", "Subfolders included"],
    prompt:
      "Convert all my iPhone HEIC photos in the iPhone Photos folder to JPG so they open on my Windows PC.",
    demo: {
      ack: "Sure. Converting them now.",
      task: "Converting HEIC photos to JPG",
      rows: ["Finding 30 HEIC photos, subfolders too", "Making a full-size JPG of each"],
      reply:
        "Done. All **30 photos** have a JPG beside them with the same date taken. Want me to move the HEIC originals to the Trash to free up space?",
    },
    faq: [
      ["How do I mass convert HEIC to JPG on Windows?", "Ask Stella to convert the folder, or use the free XnConvert: drag the folder in, pick JPG at quality 90 and keep the photo details on."],
      ["Why won't Windows open my HEIC photos?", "It needs two Microsoft Store add-ons: HEIF Image Extensions (free) and HEVC Video Extensions ($0.99)."],
      ["Can Claude convert HEIC to JPG?", "Yes, through Stella. It runs on your Claude or ChatGPT plan and converts the photos on your own computer."],
    ],
    byHand: [
      "For a few, open each in Photos and choose Save as, JPG.",
      "On the iPhone, Settings, Camera, Formats, Most Compatible saves new photos as JPG.",
    ],
    related: [
      "photos-files/find-duplicate-photos",
      "photos-files/convert-raw-to-jpg",
      "photos-files/sort-photos-into-folders-by-date",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Find duplicate photos, including resized copies from WhatsApp and old backups. Stella (stella.sh) shows each group, keeps the original and moves copies to the Trash.",
    h1: "Find duplicate photos, including resized copies",
    short: "Find duplicate photos",
    lede: "One copy of every photo, resized and re-saved copies caught too.",
    answer:
      "Resized or re-saved photos don't match file for file, so most duplicate finders miss them. Stella (stella.sh) compares the pictures themselves, keeps the full-size original and moves the copies to the Trash.",
    gets: ["Exact and resized copies found", "The full-size original kept each time", "A side-by-side page to look over"],
    prompt:
      "Find duplicate photos in my Pictures folder, smaller copies included, and show me what you'd remove before deleting anything.",
    demo: {
      ack: "Sure. Looking through Pictures now.",
      task: "Finding duplicate photos",
      rows: ["Comparing 38 photos", "Catching resized and re-saved copies"],
      reply:
        "I found **14 copies**: 6 exact, 5 resized and 3 re-saved or converted. Similar shots, like your two sunsets, stay as different photos. Have a look and say go, and they'll go to the Trash.",
    },
    faq: [
      ["What's a good free duplicate photo finder for Windows?", "dupeGuru in Picture mode catches resized copies, and Czkawka is another free choice."],
      ["Can I get deleted duplicates back?", "Yes, from the Trash or Recycle Bin: Restore puts each one back in its folder."],
    ],
    byHand: [
      "In dupeGuru, switch to Picture mode, add Pictures and scan, then keep the biggest file in each group.",
      "Apple Photos: the Duplicates album under Utilities merges copies inside your library.",
    ],
    related: [
      "photos-files/sort-photos-into-folders-by-date",
      "photos-files/convert-heic-to-jpg",
      "pc-cleanup/organize-downloads-folder",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Sort photos into folders by year and month using the date taken. Stella (stella.sh) files every photo and video, so finding last March's pictures takes a click.",
    h1: "Sort photos into folders by the date they were taken",
    short: "Sort photos into folders by date",
    lede: "Your photos filed into year and month folders by the day they were taken.",
    answer:
      "To sort photos into folders by date, use the date taken saved inside each photo, not the file date, which changes when photos are copied. Stella (stella.sh) reads it and files everything by year and month.",
    gets: [
      "Folders like 2024/03 - March",
      "Screenshots and chat photos dated by their names",
      "No photo ever overwritten",
    ],
    prompt:
      "Sort the photos in my To sort folder into folders by year and month, using the date each one was taken.",
    demo: {
      ack: "Sure. Reading each photo's date.",
      task: "Sorting photos by date",
      rows: ["Reading the date taken inside each photo", "Making year and month folders", "Moving 33 files into place"],
      reply:
        "Done. Your **33 photos and videos** are in folders from 2019 to 2026. Two had no date anywhere, so they're in an Undated folder.",
    },
    faq: [
      ["Why are my photos sorted by the wrong date?", "Most tools use the file's date, which changes every time photos are copied. The date taken is saved inside the photo."],
      ["Can Windows sort photos into folders by date taken?", "File Explorer can sort a view by Date taken but can't move photos into folders by it."],
      ["Can it copy the photos instead of moving them?", "Yes. Ask for copies and the originals stay put."],
    ],
    byHand: [
      "The free [ExifTool](https://exiftool.org) moves photos into year/month folders: exiftool -r -d \"%Y/%m\" \"-Directory<DateTimeOriginal\" .",
      "digiKam (free) and Lightroom Classic can file photos into date folders as they import.",
      "WhatsApp images often carry the date in their name instead, like IMG-20240312-WA0007.jpg.",
    ],
    related: [
      "photos-files/find-duplicate-photos",
      "photos-files/fix-google-takeout-photo-dates",
      "pc-cleanup/organize-downloads-folder",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Batch resize images on Mac or Windows to a set size and under a file-size limit. Stella (stella.sh) makes the smaller copies and keeps your originals.",
    h1: "Resize images in bulk for your website",
    short: "Resize images in bulk",
    lede: "Smaller copies of every photo, at the size and file size you need.",
    answer:
      "To resize images in bulk, tell Stella (stella.sh) the size and file size you need, like 1600 pixels and under 300 KB. It makes smaller copies of the whole folder, turned the right way up.",
    gets: ["Copies at the size you ask for", "Every file under your limit", "Originals left as they were"],
    prompt:
      "Make the product photos in the Shop photos folder on my Desktop smaller for my website: 1600 pixels on the long side and under 300 KB each.",
    demo: {
      ack: "Sure. Making smaller copies now.",
      task: "Resizing your shop photos",
      rows: ["Resizing 40 photos to 1600 pixels", "Keeping each under 300 KB"],
      reply:
        "Done. **40 copies** are in a new Web 1600px folder, about 100 KB each. Three were stored sideways, so I turned them upright.",
      files: ["Web 1600px"],
    },
    faq: [
      ["How do I batch resize images on a Mac?", "Open them all in Preview, select every thumbnail, then Tools, Adjust Size."],
      ["How do I resize photos to under 300 KB?", "Resize to about 1600 pixels and save at JPEG quality around 80, or tell Stella the limit."],
    ],
    byHand: [
      "Windows: install the free Microsoft PowerToys, select the photos, right-click, Resize with Image Resizer.",
      "To get under a file-size limit, lower the JPEG quality and run it again.",
    ],
    related: [
      "photos-files/remove-location-from-photos",
      "photos-files/convert-heic-to-jpg",
      "photos-files/find-duplicate-photos",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Remove the location from photos before you post them, and keep the date taken. Stella (stella.sh) makes clean copies of a whole folder on your computer.",
    h1: "Remove location from photos before you post them",
    short: "Remove location from photos",
    lede: "Photos ready to post, with your home location out and the dates kept.",
    answer:
      "To remove location from photos but keep the date, ask Stella (stella.sh). It copies the whole folder without the GPS position, keeps the date taken and leaves the pictures themselves untouched.",
    gets: ["Copies with no location left", "Date and time taken kept", "Picture quality unchanged"],
    prompt:
      "I want to post the garden party photos online but they have my home location in them. Take the location out but keep the dates.",
    demo: {
      ack: "Sure. Making clean copies.",
      task: "Removing location from photos",
      rows: ["Reading the details in 24 photos", "Removing the location from copies"],
      reply:
        "Done. **24 copies** with no location are in a new Garden party (no location) folder, each with its date taken. Post those; the originals still have it.",
      files: ["Garden party (no location)"],
    },
    faq: [
      ["How do I remove EXIF data from photos?", "Ask Stella to remove all metadata, or only the location. On Windows, Remove Properties strips it, dates included."],
      ["Do social networks remove location from photos?", "The big ones generally do, but email, chat apps and websites often pass the original file on."],
    ],
    byHand: [
      "Mac and iPhone: when sharing from Photos, tap Options and turn off Location.",
      "Windows: Properties, Details, Remove Properties and Personal Information, Create a copy. It takes the date too.",
      "The free [ExifTool](https://exiftool.org) removes only location: exiftool -gps:all= *.jpg",
    ],
    related: ["photos-files/resize-images-in-bulk", "photos-files/sort-photos-into-folders-by-date", "pdf-excel/redact-pdf"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Combine photos into one PDF in the right page order, small enough to email. Stella (stella.sh) reads the page numbers, turns sideways pages upright and shrinks it.",
    h1: "Combine photos into one PDF, in page order",
    short: "Combine photos into one PDF",
    lede: "Photos of a document turned into one PDF, in order and easy to email.",
    answer:
      "To combine photos into one PDF, ask Stella (stella.sh). It puts the pages in order by reading their page numbers, turns sideways ones upright and makes one PDF small enough to email.",
    gets: ["One PDF, every page in order", "Sideways pages turned upright", "A file small enough to email"],
    prompt:
      "I took photos of every page of my rental agreement with my phone. They're in Downloads. Put them into one PDF, in page order, small enough to email.",
    demo: {
      ack: "Sure. Putting the pages in order.",
      task: "Making your rental agreement PDF",
      rows: ["Reading the page number on each photo", "Turning two sideways pages upright", "Shrinking the file for email"],
      reply:
        "Done. All 12 pages are in order in one **2.6 MB** PDF. Some pages are slightly tilted; I can crop and straighten them if you like.",
      files: ["Rental Agreement - 12 Orchard Row.pdf"],
    },
    faq: [
      ["How do I combine photos into one PDF on iPhone?", "Select them in Photos, tap Share, then Print, and pinch out on the preview to get a PDF."],
      ["How small does a PDF need to be for email?", "Under about 20 MB. Gmail allows 25 MB."],
    ],
    byHand: [
      "Mac: select the photos in Finder in page order, right-click, Quick Actions, Create PDF.",
      "Windows: select them, right-click, Print, and choose Microsoft Print to PDF.",
    ],
    related: [
      "pdf-excel/compress-pdf-too-large-to-email",
      "pdf-excel/make-scanned-pdf-searchable",
      "photos-files/convert-heic-to-jpg",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Add a watermark to photos in bulk, in the corner you want. Stella (stella.sh) marks the whole folder, sized to each photo, and saves new copies.",
    h1: "Add a watermark to all your photos at once",
    short: "Add a watermark to photos",
    lede: "Your name in the corner of every photo, on copies, in one go.",
    answer:
      "To add a watermark to photos in bulk, tell Stella (stella.sh) the text and the corner. It marks every photo in the folder, sized to fit each one, and saves copies so your originals stay clean.",
    gets: ["Every photo marked in the same corner", "Text sized to fit each photo", "Clean originals kept"],
    prompt:
      "Put 'Fernhollow Ceramics' in the bottom right corner of every photo in my Shop photos folder as a watermark, on new copies.",
    demo: {
      ack: "Sure. Adding your watermark.",
      task: "Watermarking your shop photos",
      rows: ["Turning 3 sideways photos upright", "Adding the name bottom right"],
      reply:
        "Done. **16 watermarked copies** are in Shop photos (watermarked), each with Fernhollow Ceramics in soft white at the bottom right. New shop photos can get the same mark any time.",
      files: ["Shop photos (watermarked)"],
    },
    faq: [
      ["Why did my watermark land in the wrong corner on some photos?", "Phones store some photos sideways with a flag to turn them. Tools that ignore the flag put the mark in another corner."],
      ["Can I use my logo instead of text?", "Yes. Give Stella a PNG of your logo and say where it goes."],
    ],
    byHand: [
      "In the free XnConvert, add the folder, then Actions, Image, Text, set bottom-right and about 60% opacity.",
      "Add Image, Rotate, Auto before the text so phone photos are upright first.",
    ],
    related: [
      "photos-files/resize-images-in-bulk",
      "pdf-excel/add-watermark-to-pdf",
      "photos-files/remove-location-from-photos",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-webp-to-jpg",
    niche: "photos-files",
    searchPhrases: ["convert webp to jpg", "webp to jpg", "avif to jpg", "png to jpg", "webp to jpg bulk"],
    title: "Convert WebP, AVIF and PNG to JPG in bulk, no black backgrounds",
    description:
      "Convert WebP, AVIF and PNG to JPG in bulk with no black backgrounds. Stella (stella.sh) makes full-size JPG copies with the see-through areas turned white.",
    h1: "Convert WebP (and AVIF, PNG) to JPG",
    short: "Convert WebP to JPG",
    lede: "WebP, AVIF and PNG pictures turned into JPGs any site will take.",
    answer:
      "To convert WebP to JPG, along with AVIF and PNG, ask Stella (stella.sh). It makes a full-size JPG of each in a new folder and puts white, not black, behind any see-through parts.",
    gets: ["A JPG of every WebP, AVIF and PNG", "White backgrounds, not black", "Which pictures will print sharp"],
    prompt:
      "I saved a bunch of pictures from websites into Downloads and they're WebP, AVIF and PNG. My photo printing site only takes JPG. Make JPG versions of all of them.",
    demo: {
      ack: "Sure. Converting them now.",
      task: "Converting pictures to JPG",
      rows: ["Finding 8 WebP, 3 AVIF, 4 PNG", "Putting white behind see-through parts"],
      reply:
        "Done. **15 JPGs** are in a new JPG for printing folder. They're website-sized, so the biggest prints sharp up to about 6 × 4 inches.",
      files: ["JPG for printing"],
    },
    faq: [
      ["Why does my converted PNG have a black background?", "The converter dropped the see-through parts without filling them. Putting white behind them first fixes it."],
      ["How do I convert AVIF to JPG?", "Preview on a recent Mac or the free XnConvert reads AVIF. Paint on Windows needs the AV1 extension."],
    ],
    byHand: [
      "Mac: open them in Preview, select all in the sidebar, File, Export Selected Images, JPEG.",
      "Windows: open a WebP in Paint, File, Save as, JPEG picture.",
    ],
    related: [
      "photos-files/convert-heic-to-jpg",
      "photos-files/resize-images-in-bulk",
      "photos-files/add-watermark-to-photos",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Camera clock wrong? Change the date taken on a whole batch of photos at once. Stella (stella.sh) shifts them all by the right amount so they sort in order.",
    h1: "Change the date taken on photos with a wrong camera clock",
    short: "Fix the wrong date on photos",
    lede: "Camera photos back on the right date and time, in order with your phone shots.",
    answer:
      "To change the date taken on photos from a camera with the wrong clock, shift them all by the same amount. Tell Stella (stella.sh) the real time of one photo and it fixes the rest.",
    gets: ["Every camera photo on the right date and time", "Gaps between shots kept", "Phone photos left alone"],
    prompt:
      "My camera's clock reset, so all my wedding photos from it say 1 January 2019. The first was really taken at 2:15 pm on 5 September 2026. Fix the dates.",
    demo: {
      ack: "Got it. Working out the clock error.",
      task: "Fixing your camera photo dates",
      rows: ["Telling camera photos from phone ones", "Shifting 24 photos by the same amount"],
      reply:
        "Done. Your **24 camera photos** now run from 2:15 to 4:51 pm on 5 September 2026, among the phone shots. I kept a backup and a list of every old and new time.",
    },
    faq: [
      ["Can I change the date taken on many photos at once?", "Yes, by shifting them together. Photos on a Mac does it with Image, Adjust Date and Time."],
      ["Will changing the date affect photo quality?", "No. The date is stored apart from the picture, so the picture is untouched."],
    ],
    byHand: [
      "Work out the clock error from one photo whose real time you know.",
      "Windows: Properties, Details, Date taken changes one photo at a time.",
      "The free [ExifTool](https://exiftool.org) shifts a whole folder with its AllDates option.",
    ],
    related: [
      "photos-files/fix-google-takeout-photo-dates",
      "photos-files/sort-photos-into-folders-by-date",
      "photos-files/separate-screenshots-from-photos",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Separate screenshots from your photos, including iPhone ones named like photos. Stella (stella.sh) moves them all into a Screenshots folder and deletes nothing.",
    h1: "Separate screenshots from your photos",
    short: "Separate screenshots from photos",
    lede: "Screenshots moved into their own folder, real photos left in place.",
    answer:
      "Searching for 'Screenshot' misses iPhone screenshots, which are named like photos. Stella (stella.sh) spots every screenshot by its screen-sized shape and missing camera details, and moves them to their own folder.",
    gets: ["Every screenshot in one folder", "iPhone screenshots caught too", "A list so any can go back"],
    prompt:
      "My Pictures folder is real photos and screenshots all mixed up. Move the screenshots into a folder of their own so only real photos are left.",
    demo: {
      ack: "Sure. Sorting them out now.",
      task: "Separating your screenshots",
      rows: ["Checking 40 pictures' size and camera", "Spotting 5 iPhone screenshots named like photos"],
      reply:
        "Done. **14 screenshots** are in a new Screenshots folder in Pictures, and your 26 photos stayed put. moved-files.txt lists what moved.",
      files: ["Screenshots", "moved-files.txt"],
    },
    faq: [
      ["How do I put screenshots into a folder?", "On a Mac, search Finder for Is Screen Capture and drag the results into a new folder. Or ask Stella, which catches iPhone ones too."],
      ["Why didn't searching for Screenshot find them all?", "iPhone screenshots are named IMG_1234.PNG, like photos. Their exact screen size gives them away."],
    ],
    byHand: [
      "Mac: press Cmd+F in Pictures, choose Other, tick Is Screen Capture and set it to Yes.",
      "Windows: in Details view, add the Dimensions and Camera model columns, then sort by them.",
    ],
    related: [
      "photos-files/find-duplicate-photos",
      "photos-files/sort-photos-into-folders-by-date",
      "pc-cleanup/organize-downloads-folder",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Convert TIFF to JPG, including multi-page scans and print colours. Stella (stella.sh) makes a JPG of every page, upright and in normal screen colours.",
    h1: "Convert TIFF to JPG, including multi-page scans",
    short: "Convert TIFF to JPG",
    lede: "Scanned TIFFs as JPGs, every page and the right colours.",
    answer:
      "Most converters keep only page 1 of a multi-page TIFF. To convert TIFF to JPG properly, ask Stella (stella.sh): it makes one JPG per page, turns sideways scans upright and fixes print colours for screens.",
    gets: ["A JPG of every page", "Colours that look right on screen", "TIFFs kept as they are"],
    prompt:
      "My scanner saved everything in the Scans folder as TIFF files and our family website only takes JPGs. Make JPG copies of them all.",
    demo: {
      ack: "Sure. Looking at the scans first.",
      task: "Converting your scans to JPG",
      rows: ["Finding a three-page letter", "Fixing a postcard's print colours", "Turning a sideways slide upright"],
      reply:
        "Done. Your **6 TIFF scans** became 8 JPGs, one for each page of the three-page letter. They sit next to the TIFFs.",
    },
    faq: [
      ["Why did only the first page of my TIFF convert?", "Many converters read just page 1. Stella makes one JPG per page."],
      ["Why do my colours look wrong after converting?", "The TIFF is probably in print colours (CMYK). Converting to screen colours fixes it."],
    ],
    byHand: [
      "Mac: open the TIFFs in Preview, select every page thumbnail, File, Export Selected Images, JPEG.",
      "Windows: the free XnConvert converts a whole folder; check multi-page TIFFs came out page by page.",
    ],
    related: ["photos-files/convert-webp-to-jpg", "photos-files/convert-raw-to-jpg", "photos-files/convert-heic-to-jpg"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Make a printable contact sheet of photos with each file name underneath. Stella (stella.sh) lays them out as a PDF so you can circle the ones you want.",
    h1: "Make a contact sheet of photos with file names",
    short: "Make a contact sheet",
    lede: "A printable page of all your photos, each with its file name.",
    answer:
      "To make a contact sheet with file names, ask Stella (stella.sh). It lays your photos out on printable pages in shooting order, each name underneath with room to circle it.",
    gets: ["A PDF with every photo, in order", "Each file name in bold underneath", "Sideways photos turned upright"],
    prompt:
      "Make a contact sheet I can print of the 30 photos in my Ellis family shoot folder, with each file name under its photo, so we can circle the ones to order.",
    demo: {
      ack: "Sure. Laying them out now.",
      task: "Making your contact sheet",
      rows: ["Turning sideways photos upright", "Putting 12 photos on each page"],
      reply:
        "Done. All **30 photos** fit on three Letter pages, each name in bold with room to circle it.",
      files: ["Ellis family shoot - contact sheet.pdf"],
    },
    faq: [
      ["What is a contact sheet?", "A page of small prints of many photos, each labelled, used to pick which ones to print or order."],
      ["How many photos fit on a page?", "Up to about 35, but 12 per page keeps faces big enough to judge."],
    ],
    byHand: [
      "Mac: select the photos in Photos, File, Print, and pick Contact Sheet.",
      "Windows: the free XnView MP has Create, Contact sheet, with file names turned on.",
      "Windows' own Print Pictures has a 35-per-page contact sheet, but shows no names.",
    ],
    related: [
      "photos-files/combine-photos-into-one-pdf",
      "photos-files/find-duplicate-photos",
      "photos-files/put-photos-side-by-side",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Put two photos side by side in one picture, like a before and after. Stella (stella.sh) matches their height, turns them upright and saves one image to post.",
    h1: "Put two photos side by side in one picture",
    short: "Put two photos side by side",
    lede: "Two photos joined into one picture, before on the left, after on the right.",
    answer:
      "To put two photos side by side, make them the same height and join them on one canvas. Stella (stella.sh) does it without stretching either and turns phone photos the right way up.",
    gets: ["One picture with both photos", "Nothing stretched or squashed", "Location taken out before you post"],
    prompt:
      "Put my garden before and after photos side by side in one picture, before on the left and after on the right, so I can post it.",
    demo: {
      ack: "Sure. Joining them now.",
      task: "Making your before and after",
      rows: ["Turning the after photo right way up", "Matching both to the same height"],
      reply:
        "Done. Before is on the left, after on the right. The after photo was stored upside down, so I turned it, and I took the location out for posting.",
      files: ["Garden before and after.jpg"],
    },
    faq: [
      ["How do I put two photos side by side without stretching them?", "Resize both to the same height, keeping their proportions, then join them. Changing only the width is what stretches a photo."],
      ["Can I add Before and After labels?", "Yes. Ask Stella and it writes them on each half."],
    ],
    byHand: [
      "Windows: in Paint, widen the canvas of the first photo, then paste the second into the empty half.",
      "Mac: drop both on a blank Keynote slide, set the same height, then File, Export To, Images.",
    ],
    related: [
      "photos-files/make-a-contact-sheet",
      "photos-files/remove-location-from-photos",
      "photos-files/add-watermark-to-photos",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Remove the background from many images at once, offline and with no sign-up. Stella (stella.sh) cuts out each photo as a transparent PNG on your own computer.",
    h1: "Remove the background from multiple images at once",
    short: "Remove background from photos",
    lede: "Product photos cut out onto clear backgrounds, a whole folder at once.",
    answer:
      "To remove the background from multiple images at once, ask Stella (stella.sh). It cuts out every photo in the folder on your own computer, offline, and saves each as a PNG with a clear background.",
    gets: ["A transparent PNG of every photo", "Gaps like mug handles see-through", "No uploads, credits or sign-ups"],
    prompt:
      "I sell ceramics online. Take the background off every product photo in my Shop photos folder so each one sits on a clear background, and keep the originals.",
    demo: {
      ack: "Sure. Cutting them out now.",
      task: "Removing photo backgrounds",
      rows: ["Cutting out 8 product photos", "Checking handles and spouts up close"],
      reply:
        "Done. **8 cut-outs** are in a new Transparent background folder at full size, with the gaps in the mug and teapot handles see-through.",
      files: ["Transparent background"],
    },
    faq: [
      ["Can I remove backgrounds offline for free?", "Yes. Stella does it on your own computer, and on a Mac, Finder's Remove Background quick action handles a selection."],
      ["Why is the gap in my mug handle still filled in?", "Some tools find only the outer outline. Look at the cut-out on a bright colour to spot it."],
    ],
    byHand: [
      "Mac: select photos in Finder, right-click, Quick Actions, Remove Background.",
      "Windows 11: open the photo in Paint and click Remove background, then save as PNG.",
      "For a whole folder offline, the free rembg tool runs on your own computer.",
    ],
    related: [
      "photos-files/add-watermark-to-photos",
      "photos-files/resize-images-in-bulk",
      "photos-files/convert-webp-to-jpg",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "split-scanned-photos",
    niche: "photos-files",
    searchPhrases: [
      "split scanned photos",
      "separate scanned photos",
      "auto split scanned photos",
      "crop and straighten scanned photos",
      "scan multiple photos at once and separate",
    ],
    title: "Split a scan of several photos into separate pictures",
    description:
      "Split a scan of several photos into separate pictures, each straightened and cropped. Stella (stella.sh) does a whole folder of scans at full resolution.",
    h1: "Split scanned photos into separate pictures",
    short: "Split scanned photos",
    lede: "A scan of several prints cut into separate, straight photos.",
    answer:
      "To split scanned photos into separate pictures, ask Stella (stella.sh). It finds each print on the scan, straightens it, trims off the scanner bed and saves it as its own photo.",
    gets: ["Every print saved as its own photo", "Crooked prints straightened", "Full scan resolution kept"],
    prompt:
      "I scanned my mum's old photos three or four at a time on the flatbed. Cut each scan in my Mum's old photos - scans folder into the separate photos.",
    demo: {
      ack: "Lovely. Finding each print now.",
      task: "Splitting your scanned photos",
      rows: ["Finding 16 prints on 5 scans", "Straightening the crooked ones", "Trimming off the scanner bed"],
      reply:
        "Done. **16 photos** are in a new Mum's old photos - cut out folder, named like Scan 1 - photo 2. Even the pale snow scene kept its edges.",
      files: ["Mum's old photos - cut out"],
    },
    faq: [
      ["Can I scan several photos at once and have them separated?", "Yes. On a Mac, Image Capture's Detect Separate Images does it while scanning. Stella splits scans you already have."],
      ["Do I lose resolution?", "No. Each photo is cut from the full scan."],
    ],
    byHand: [
      "Mac, while scanning: in Image Capture, Show Details, set Size to Detect Separate Images.",
      "Windows: the free GIMP with the gimp-scan-cutter add-on splits scans in a batch.",
    ],
    related: [
      "photos-files/fix-wrong-date-on-photos",
      "photos-files/convert-tiff-to-jpg",
      "photos-files/make-a-contact-sheet",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "add-date-stamp-to-photos",
    niche: "photos-files",
    searchPhrases: [
      "add date stamp to photos",
      "add date to photos",
      "date stamp photos like film camera",
      "add date taken to photos",
      "print date on photos",
    ],
    title: "Add the date taken to photos, film-camera style",
    description:
      "Add a date stamp to photos like old film cameras did, using the real date taken. Stella (stella.sh) stamps a whole folder and saves the stamped copies.",
    h1: "Add a date stamp to photos, like old film cameras",
    short: "Add a date stamp to photos",
    lede: "The date each photo was taken, printed in the corner like a film camera.",
    answer:
      "To add the date to photos, use the date taken saved by the camera, not the file date. Stella (stella.sh) stamps it in the corner of every photo in glowing orange film-camera digits, on copies.",
    gets: ["The real date taken on every photo", "Film-camera digits, or your own format", "Originals left unstamped"],
    prompt:
      "Stamp the date each holiday photo was taken in the bottom right, film camera style, on copies of everything in my Holiday 2026 folder.",
    demo: {
      ack: "Fun. Stamping them now.",
      task: "Date-stamping your holiday photos",
      rows: ["Reading each photo's date taken", "Drawing orange digits bottom right"],
      reply:
        "Done. **12 stamped copies** are in Holiday 2026 (dated), each showing the day it was taken, like ’26 8 14.",
      files: ["Holiday 2026 (dated)"],
    },
    faq: [
      ["Why does my date stamp show the wrong day?", "The tool used the file's date, which changes when photos are copied, instead of the date the camera saved."],
      ["Can I choose the date format?", "Yes. Name a format, like 14 Aug 2026, plus a colour or corner."],
    ],
    byHand: [
      "In the free XnConvert, add the folder, then Actions, Image, Text, and insert the EXIF date-taken variable.",
      "Set the position to bottom-right and send the output to a new folder.",
    ],
    related: [
      "photos-files/fix-wrong-date-on-photos",
      "photos-files/add-watermark-to-photos",
      "photos-files/sort-photos-into-folders-by-date",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-raw-to-jpg",
    niche: "photos-files",
    searchPhrases: [
      "convert raw to jpg",
      "cr2 to jpg",
      "nef to jpg",
      "arw to jpg",
      "dng to jpg",
      "convert raw to jpg free",
      "cr2 to jpg bulk converter",
    ],
    title: "Convert RAW photos to JPG at full size, in bulk",
    description:
      "Convert RAW photos like CR2, NEF, ARW and DNG to full-size JPGs in bulk. Stella (stella.sh) develops each one on your computer with the camera's colours.",
    h1: "Convert RAW photos to JPG at full size",
    short: "Convert RAW to JPG",
    lede: "Your camera's RAW files as full-size JPGs that open anywhere.",
    answer:
      "To convert RAW to JPG at full size, the whole RAW file has to be developed, not the small preview inside it. Stella (stella.sh) does that for a whole folder, with the camera's colours.",
    gets: ["Full-size JPGs, not small previews", "The camera's own colours", "Sideways shots turned upright"],
    prompt:
      "I can't open the RAW files from our lake trip in Pictures. Turn them into full-size JPGs I can share.",
    demo: {
      ack: "Sure. Developing them now.",
      task: "Converting your RAW photos",
      rows: ["Finding 6 RAW files from the trip", "Developing each at full size"],
      reply:
        "Done. **6 full-size JPGs** are next to your RAW files, with the camera's colours and the portrait shot upright. A preview sheet of all six is there too.",
    },
    faq: [
      ["Does it work with Canon CR2, Nikon NEF and Sony ARW?", "Yes, along with DNG and most other camera RAW formats."],
      ["Why are my converted JPGs small?", "Many quick converters save the small preview stored inside the RAW file instead of developing the full one."],
    ],
    byHand: [
      "Mac: open the RAW files in Preview, select all in the sidebar, File, Export Selected Images, JPEG.",
      "Windows: install Microsoft's free Raw Image Extension and save from Photos, or batch-export with the free darktable.",
    ],
    related: ["photos-files/convert-heic-to-jpg", "photos-files/convert-tiff-to-jpg", "photos-files/resize-images-in-bulk"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
