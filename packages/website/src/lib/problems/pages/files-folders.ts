import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const FILES_FOLDERS_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "extract-multiple-zip-files-at-once",
    niche: "files-folders",
    searchPhrases: [
      "extract multiple zip files at once",
      "unzip multiple files at once",
      "extract multiple zip files at once windows 11",
      "extract multiple zip files at once mac",
    ],
    title: "Extract multiple zip files at once, each into its own folder",
    description:
      "Need to extract multiple zip files at once on Windows 11 or Mac? Ask Stella (stella.sh) and every zip opens into its own folder, with no junk folders left behind.",
    h1: "Extract multiple zip files at once, each into its own folder",
    short: "Extract many zip files at once",
    lede: "A whole pile of zip files opened in one go, each in its own folder.",
    answer:
      "Windows 11's Extract All opens one zip at a time. To extract multiple zip files at once, ask Stella (stella.sh): it unzips every one into its own folder and tidies up as it goes.",
    gets: ["Every zip opened into a folder named after it", "No doubled folders or Mac leftovers"],
    prompt:
      "Unzip all the zip files in my Downloads at once, one for each week of my course, each into its own folder.",
    demo: {
      ack: "On it. Unzipping all 12 now.",
      task: "Unzipping your course files",
      rows: ["Finding the 12 zips in Downloads", "Giving each zip its own folder"],
      reply:
        "All 12 are unzipped, each into its own folder from **Week 01** to **Week 12**. The zips are still in Downloads.",
      files: ["Week 01", "Week 02", "Week 03"],
    },
    faq: [
      ["How do I extract multiple zip files at once on Windows 11?", "Install the free 7-Zip, select the zips, right-click, Show more options, 7-Zip, Extract to \"*\\\". Each zip gets its own folder."],
      ["Can I extract multiple zip files into one folder?", "Yes. In 7-Zip, select them all and choose Extract Here."],
      ["How do I extract multiple zip files at once on a Mac?", "Select them all in Finder and double-click one."],
      ["How do I open a zip split into parts with 7-Zip?", "Keep the parts together and open the .001 file. 7-Zip reads the rest."],
    ],
    byHand: [
      "Install the free [7-Zip](https://www.7-zip.org/download.html), select every zip and right-click, 7-Zip, Extract to \"*\\\".",
      "Delete any __MACOSX folders afterwards. They hold Mac leftovers, not your files.",
    ],
    related: ["files-folders/open-rar-file", "files-folders/open-7z-file", "files-folders/zip-file-too-large-to-email"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "find-files-containing-text",
    niche: "files-folders",
    searchPhrases: [
      "find files containing text",
      "search file contents windows 11",
      "search multiple pdf files for text",
      "find all documents that mention a name",
    ],
    title: "Find every file containing a word or name (PDF, Word, Excel)",
    description:
      "Find every PDF, Word and Excel file that mentions a word or name. Ask Stella (stella.sh) to search inside your files and get a list of each match and where it is.",
    h1: "Find files containing text, whatever type of file they are",
    short: "Find files containing text",
    lede: "Every file that mentions a name or phrase, whatever kind of file it is.",
    answer:
      "To find files containing a word or name, inside PDFs, Word and Excel files too, ask Stella (stella.sh). It reads every file in the folders you name and lists each match with its location.",
    gets: ["Every matching file, with its folder", "The line that mentions it", "Look-alike names kept out"],
    prompt:
      "Find every file in Documents and Downloads that mentions Harbourview Lettings, whatever type of file it is, and save the list on my Desktop.",
    demo: {
      ack: "Sure. Searching inside your files now.",
      task: "Searching for Harbourview Lettings",
      rows: ["Reading 123 PDFs, Word and Excel files", "Looking inside tables and footers"],
      reply:
        "I found **9 files** that mention Harbourview Lettings: four PDFs, two Word files, a spreadsheet, a note and an RTF. The list is on your Desktop. A brochure for 'Harbour Lettings' is at the bottom for you to check.",
      files: ["Harbourview Lettings files.txt"],
    },
    faq: [
      ["How do I search inside Excel files?", "On a Mac, type the phrase in quotes in a Finder search. On Windows, File Explorer only looks inside files in indexed folders."],
      ["Why doesn't Windows find text inside my Word files?", "It only searches contents in indexed folders. Add yours under Settings, Privacy & security, Searching Windows."],
    ],
    byHand: [
      "Mac: type the phrase in quotes in a Finder window. Spotlight searches inside PDFs, Word and Excel files.",
      "Windows: type content:\"your phrase\" in File Explorer's search box, in folders Windows indexes.",
    ],
    related: [
      "files-folders/rename-multiple-files-at-once",
      "contacts-calendar-email/convert-eml-to-pdf",
      "pdf-excel/make-scanned-pdf-searchable",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "move-files-from-subfolders-into-one-folder",
    niche: "files-folders",
    searchPhrases: [
      "move all files from subfolders to main folder",
      "flatten folder structure",
      "move files from subfolders into one folder windows 11",
      "move files out of subfolders mac",
    ],
    title: "Move all files from subfolders into one folder, losing none",
    description:
      "Move all files from subfolders into one main folder without losing any to same-name clashes. Stella (stella.sh) does it on Windows or Mac and tidies the empty folders.",
    h1: "Move all files from subfolders into one folder without losing any",
    short: "Move files out of subfolders",
    lede: "Every file pulled out of its subfolders into one place, none lost.",
    answer:
      "To move all files from subfolders into the main folder, ask Stella (stella.sh). It pulls every file up, renames any that share a name so none get replaced, and removes the empty subfolders.",
    gets: ["All your files in one folder", "No file replaced by one with the same name", "Empty subfolders cleared away"],
    prompt:
      "My scans are spread over loads of year and month subfolders inside the Scans folder in Documents. Put every file straight into Scans without losing any.",
    demo: {
      ack: "Got it. Gathering your scans.",
      task: "Pulling scans out of subfolders",
      rows: ["Finding 71 files in the subfolders", "Renaming names that clash", "Removing the empty folders"],
      reply:
        "All **71 files** are now in Scans. Names like scan0001.pdf repeated, so each now starts with its old folder, like '2023 - 04 Apr - scan0005.pdf'. They sort by date too.",
    },
    faq: [
      ["How do I move all files from subfolders to the main folder in Windows?", "Type * in File Explorer's search box, select the files, cut them and paste them into the main folder. Keep both when names clash."],
      ["Why did files disappear when I flattened my folders?", "Two files can't share a name in one folder. Replace overwrote one, and Skip left it behind."],
    ],
    byHand: [
      "Windows: open the folder, type * in the search box, select the files, Ctrl+X, then Ctrl+V in the top folder.",
      "When Windows warns about same names, choose Let me decide and tick both sides to keep both.",
      "Mac: search the folder in Finder, drag the results onto it and Option-click Keep Both.",
    ],
    related: [
      "files-folders/rename-multiple-files-at-once",
      "pc-cleanup/delete-empty-folders",
      "photos-files/sort-photos-into-folders-by-date",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "open-7z-file",
    niche: "files-folders",
    searchPhrases: ["how to open 7z files", "7z file", "open 7z file", "how to open 7z file on mac", "open 7z.001 file"],
    title: "How to open a 7z file, including split .7z.001 parts",
    description:
      "Can't open a .7z or .7z.001 file? Stella (stella.sh) joins the parts, unpacks everything on your Windows PC or Mac and puts the files wherever you want them.",
    h1: "How to open a 7z file, even one split into parts",
    short: "Open a 7z file",
    lede: "A 7z file opened, even one split into .001, .002 and .003 parts.",
    answer:
      "A single 7z file opens in Windows 11 or the free 7-Zip, but parts ending in .7z.001, .002 and so on open only together. Stella (stella.sh) joins them and puts the files where you ask.",
    gets: ["Every part joined and opened", "The files where you want them"],
    prompt:
      "Our school reunion photos came as three files ending in .7z.001, .7z.002 and .7z.003 in my Downloads. Open them and put the photos in Pictures.",
    demo: {
      ack: "Sure. Joining the three parts now.",
      task: "Opening the reunion photos",
      rows: ["Joining the three parts", "Unpacking 28 photos and a note", "Putting them in Pictures"],
      reply:
        "Done. The **28 reunion photos** and a credits note are in a new Westbrook reunion photos folder in Pictures. Want me to delete the three parts?",
      files: ["Westbrook reunion photos"],
    },
    faq: [
      ["What is a .7z.001 file?", "The first part of a 7z archive cut into pieces, often to fit an upload limit. The parts open together, starting from .001."],
      ["Can Windows 11 open 7z files without extra software?", "Recent Windows 11 opens a single .7z. Split parts need 7-Zip."],
    ],
    byHand: [
      "Put every part in one folder with the names unchanged.",
      "Windows: install the free [7-Zip](https://www.7-zip.org/download.html), right-click the .7z.001 file, 7-Zip, Extract files.",
      "Mac: install The Unarchiver from the Mac App Store and double-click the .7z.001 file.",
    ],
    related: [
      "files-folders/open-rar-file",
      "files-folders/extract-multiple-zip-files-at-once",
      "photos-files/find-duplicate-photos",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "open-rar-file",
    niche: "files-folders",
    searchPhrases: [
      "how to open rar files",
      "open rar file",
      "extract rar files",
      "open rar file mac",
      "how to extract rar files",
    ],
    title: "How to open a RAR file on Mac or Windows, keeping its folders",
    description:
      "Can't open a RAR file on your Mac or Windows PC? Ask Stella (stella.sh) and it gets everything out, keeps the folders inside as they were, and puts them where you want.",
    h1: "How to open a RAR file on a Mac or Windows PC",
    short: "Open a RAR file",
    lede: "A RAR file opened on your Mac or PC, with its folders as they were.",
    answer:
      "To open a RAR file on a Mac, use the free The Unarchiver; on Windows 11, right-click it and choose Extract All. Or ask Stella (stella.sh), which unpacks it, folders and all, wherever you want.",
    gets: [
      "Everything out of the RAR, folders kept",
      "Files in the folder you choose",
      "Nothing uploaded to a converter site",
    ],
    prompt:
      "My cousin sent me Nana's recipes as a RAR file and I can't open it. It's in my Downloads. Get everything out into my Documents folder.",
    demo: {
      ack: "No problem. Opening the RAR now.",
      task: "Opening Nana Pearl's recipes",
      rows: ["Reading what's inside", "Extracting into Documents", "Keeping folders and accented names"],
      reply:
        "Everything's out. **Nana Pearl's recipes** is in Documents with its four folders: Baking, Mains, Preserves and Photos. Names like Crème brûlée.txt came through intact.",
      files: ["Nana Pearl's recipes"],
    },
    faq: [
      ["How do I open a RAR file on a Mac?", "Double-clicking fails because Archive Utility can't read RAR. Install the free The Unarchiver from the Mac App Store and double-click the file."],
      ["Do I need WinRAR to open a RAR file?", "No. Windows 11, 7-Zip and The Unarchiver open RAR files for free."],
      ["How do I open RAR files on Windows 10?", "Install the free 7-Zip, right-click the RAR, then 7-Zip, Extract files."],
    ],
    byHand: [
      "Windows 11 (23H2 or later): right-click the .rar, Extract All, pick a folder.",
      "Mac, no install: open Terminal, type tar -xf and a space, drag the .rar onto the window and press Return.",
      "Parts named .part1.rar, .part2.rar go together: keep them in one folder and open part 1.",
    ],
    related: [
      "files-folders/open-7z-file",
      "files-folders/extract-multiple-zip-files-at-once",
      "files-folders/zip-file-too-large-to-email",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "rename-multiple-files-at-once",
    niche: "files-folders",
    searchPhrases: [
      "rename multiple files at once",
      "bulk rename files",
      "bulk rename files windows 11",
      "batch rename files mac",
      "rename files with leading zeros",
    ],
    title: "Rename multiple files at once to one pattern (with numbers)",
    description:
      "Rename multiple files at once to a clean pattern, with numbers that sort right. Describe the names you want to Stella (stella.sh) and it renames the whole folder.",
    h1: "Rename multiple files at once to a clean pattern",
    short: "Rename many files at once",
    lede: "A folder of messy file names, all renamed to one clean pattern.",
    answer:
      "To rename multiple files at once, describe the pattern you want to Stella (stella.sh), like '01 - Topic'. It renames the whole batch, adds leading zeros, and reads inside a file when its name lacks a number.",
    gets: [
      "Every file renamed to your pattern",
      "Numbers that sort in the right order",
      "Leftovers like (final) and v2 gone",
    ],
    prompt:
      "The lecture slides in my Biology 101 folder have messy names and sort wrong. Rename them like '01 - Cells.pdf', with the lecture number then the topic.",
    demo: {
      ack: "Sure. Reading the slides first.",
      task: "Renaming your lecture slides",
      rows: ["Reading the title inside each PDF", "Renaming all 14 to one pattern"],
      reply:
        "Done. All **14 slides** are renamed and in order, like '02 - Membranes.pdf' and '13 - Plant hormones.pdf'. Two had no number in the name, so I read it inside them.",
    },
    faq: [
      ["Why do my files sort 1, 10, 11, 2?", "Some apps sort names letter by letter. Two-digit numbers like 01 and 02 sort right everywhere."],
      ["Can I undo a bulk rename?", "Ask Stella to keep a list of the old names and it saves one beside the files."],
    ],
    byHand: [
      "Mac: select the files in Finder, Control-click, Rename, then Replace Text or Format.",
      "Windows: install the free Microsoft PowerToys and use PowerRename from the right-click menu.",
    ],
    related: [
      "photos-files/rename-pdf-files-based-on-content",
      "files-folders/move-files-from-subfolders-into-one-folder",
      "files-folders/find-files-containing-text",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "zip-file-too-large-to-email",
    niche: "files-folders",
    searchPhrases: [
      "zip file too large to email",
      "compress folder to zip to send in email",
      "split zip file into parts",
      "split folder into multiple zip files",
    ],
    title: "Zip file too large to email? Split it into zips that each open",
    description:
      "Zip file still too large to email? Stella (stella.sh) splits the folder into a few ordinary zips under your email's limit, each one opening with a double-click.",
    h1: "Zip file too large to email? Split it into pieces that each open",
    short: "Zip too large to email",
    lede: "A folder too big to email, split into zips that each open on their own.",
    answer:
      "When a zip is too large to email, zipping it again won't shrink it. Stella (stella.sh) splits the folder into the fewest zips under your limit, each opening on its own.",
    gets: ["Zips that each fit in one email", "Each opens with a double-click"],
    prompt:
      "The House sale folder in Documents is too big to email to my sister. Split it into zips under 20 MB that each open on their own.",
    demo: {
      ack: "Sure. Measuring the folder first.",
      task: "Zipping House sale for email",
      rows: ["Measuring 22 files, about 25 MB", "Packing them into two zips"],
      reply:
        "Done. Two zips, **13.3 MB** and **12.3 MB**, both under 20 MB. Send one per email; opening both puts everything back in one House sale folder.",
      files: ["House sale - zipped for email"],
    },
    faq: [
      ["Why is my zip file still too large to email?", "Photos, videos and PDFs are already compressed, so zipping barely shrinks them. Split them into several zips, or make the photos smaller first."],
      ["Can you compress a zip file further?", "Not by zipping it again. Shrink the photos inside or split it into parts."],
      ["How do I send a zip file that is too large?", "Split it under the limit, 25 MB for Gmail, or share a Google Drive, OneDrive or iCloud link."],
    ],
    byHand: [
      "Split the files into a few folders, each a few MB under your limit, and zip each one.",
      "Use ordinary zips, not 7-Zip's split volumes, which open only when someone has every part.",
    ],
    related: [
      "pdf-excel/compress-pdf-too-large-to-email",
      "files-folders/extract-multiple-zip-files-at-once",
      "photos-files/resize-images-in-bulk",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "combine-gpx-files",
    niche: "files-folders",
    searchPhrases: ["combine gpx files", "merge gpx files", "combine gpx files for strava", "combine gpx files into one"],
    title: "Combine GPX files into one track, in the right order",
    description:
      "Combine GPX files into one track for Strava or Komoot. Stella (stella.sh) merges them in time order, keeps heart rate and elevation, and leaves the originals alone.",
    h1: "Combine GPX files into one track in the right order",
    short: "Combine GPX files",
    lede: "Several GPX recordings joined into one track, in the order you walked it.",
    answer:
      "To combine GPX files into one, join them in time order, not by file name. Stella (stella.sh) merges them on your computer, keeps times, elevation and heart rate, and gives you one GPX to upload.",
    gets: [
      "One GPX for the whole trip",
      "Days in the right order, whatever the file names",
      "Heart rate and elevation kept",
    ],
    prompt:
      "I recorded my 4-day hike as separate GPX files in the West Highland hike folder. Merge them into one GPX in the right order so I can upload the whole trip.",
    demo: {
      ack: "Nice trip. Joining the days now.",
      task: "Combining your hike GPX files",
      rows: ["Finding 5 recordings, not 4", "Ordering them by time", "Joining them into one track"],
      reply:
        "Done. All five recordings are in one GPX, in time order. Day 2 was in two parts, and **Activity_20891.gpx** turned out to be day 4.",
      files: ["West Highland hike - full trip.gpx"],
    },
    faq: [
      ["Will Strava accept one GPX for several days?", "Yes, as one long activity. For one activity per day, upload the day files separately."],
      ["Can I ask in German, like 'GPX Dateien zusammenfügen'?", "Yes. Write to Stella in German or any other language and it answers in the same one."],
    ],
    byHand: [
      "In the browser: open [gpx.studio](https://gpx.studio/), drop the files in, put them in day order and use the merge tool.",
      "Or the free [GPSBabel](https://www.gpsbabel.org/): add every GPX and turn on the Tracks filter with Merge.",
    ],
    related: [
      "files-folders/convert-gpx-to-kml",
      "photos-files/sort-photos-into-folders-by-date",
      "photos-files/remove-location-from-photos",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-gpx-to-kml",
    niche: "files-folders",
    searchPhrases: [
      "gpx to kml",
      "gpx to kml converter",
      "gpx to google earth",
      "gpx to google maps",
      "combine gpx files into one kml",
    ],
    title: "Convert GPX to KML for Google Earth, one dated line per track",
    description:
      "Turn a folder of GPX files into one KML for Google Earth. Stella (stella.sh) makes one line per track, named by its date, and keeps every point of the route.",
    h1: "Convert GPX to KML for Google Earth, one line per track",
    short: "Convert GPX to KML",
    lede: "Your GPX tracks in Google Earth, one named line per ride.",
    answer:
      "To convert GPX to KML for Google Earth, ask Stella (stella.sh). It turns a whole folder of GPX files into one KML, with each track as its own line named by the date it was recorded.",
    gets: [
      "One KML that opens in Google Earth",
      "Each track a separate line, named by date",
      "Distance and time in each line's pop-up",
    ],
    prompt:
      "I have 8 bike rides saved as GPX files in my Rides folder. Make one KML I can open in Google Earth, with each ride as its own line named by date.",
    demo: {
      ack: "Sure. Reading the rides now.",
      task: "Making Rides.kml",
      rows: ["Reading the date inside each GPX", "Drawing one line per ride"],
      reply:
        "Done. Your 8 rides are separate lines, named like **2026-04-05**. One odd thing: they average about 4.5 km/h, walking pace, and four were tagged as hikes.",
      files: ["Rides.kml"],
    },
    faq: [
      ["Can I open a GPX in Google Maps?", "Not directly. Google My Maps imports KML, so convert first and import that."],
      ["What's the difference between GPX and KML?", "GPX is what GPS watches record. KML is Google Earth's format for lines and labels."],
    ],
    byHand: [
      "Install the free Google Earth Pro, then File, Open, set the type to GPS and pick each GPX.",
      "Drag the tracks into one folder under Places, right-click it, Save Place As, KML.",
    ],
    related: [
      "files-folders/combine-gpx-files",
      "photos-files/remove-location-from-photos",
      "files-folders/zip-file-too-large-to-email",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "compare-two-folders",
    niche: "files-folders",
    searchPhrases: [
      "compare two folders",
      "copy missing files from one folder to another",
      "sync two folders",
      "compare two folders and copy differences",
      "compare two folders windows 11",
    ],
    title: "Compare two folders and copy only the missing files",
    description:
      "Compare two folders and copy only the files that are missing. Stella (stella.sh) matches by what's inside each file, so renamed photos aren't copied twice.",
    h1: "Compare two folders and copy what's missing",
    short: "Compare two folders",
    lede: "Two copies of a folder compared, and only what's missing copied across.",
    answer:
      "To compare two folders and copy what's missing, match files by what's inside them, not only their names. Stella (stella.sh) does that, copies just the missing files into the right subfolders and overwrites nothing.",
    gets: [
      "Only the missing files copied across",
      "Renamed copies recognised, not doubled",
      "Same-name photos both kept",
    ],
    prompt:
      "I have our family photos in Pictures and an older copy from my old laptop in Documents. Copy anything that's only in the old copy into the Pictures one, without overwriting.",
    demo: {
      ack: "Okay. Comparing the two copies.",
      task: "Merging your family photos",
      rows: ["Comparing photos by what's inside", "Spotting six that were only renamed", "Copying 11 missing files across"],
      reply:
        "Done. I copied **11 files** only in the old copy, including a whole 2018 Wedding folder. Two different photos shared a name, so the older one now ends in '(old laptop)'.",
    },
    faq: [
      ["How do I compare two folders on Windows 11?", "There's no built-in folder compare. The free WinMerge shows files only on one side."],
      ["Can it keep two folders in sync both ways?", "Yes. Ask for a two-way sync and changes on either side reach the other."],
    ],
    byHand: [
      "Windows: robocopy with /E /XC /XN /XO copies files missing from the other folder and skips the rest.",
      "Mac: rsync -av --ignore-existing does the same. Both go by name, so renamed photos get copied again.",
    ],
    related: [
      "photos-files/find-duplicate-photos",
      "files-folders/move-files-from-subfolders-into-one-folder",
      "photos-files/sort-photos-into-folders-by-date",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
