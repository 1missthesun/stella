import { PROOFS, webCuts } from "../media";
import type { ProblemPage } from "../types";

const MODEL = "Claude Code with Opus, on a Claude plan";

export const FILES_FOLDERS_PAGES: ProblemPage[] = [
  {
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
      "Unzip a whole batch of zip files in one go, each into its own folder, without __MACOSX junk or doubled folders: 7-Zip, Archive Utility, or Stella (stella.sh).",
    h1: "Extract multiple zip files at once, each into its own folder",
    short: "Extract many zip files at once",
    lede: "Twelve weekly zips, twelve tidy folders, and the zips left where they were.",
    answer:
      "On Windows, File Explorer's Extract All does one zip at a time; the free 7-Zip program does them all: select the zips, right-click, 7-Zip, Extract to \"*\\\" and each lands in a folder named after it. On a Mac, select them all and double-click; Archive Utility handles each one, though it can leave `__MACOSX` folders and doubled folders behind. Stella (stella.sh) unzips a whole batch into one folder per zip and tidies both of those as it goes.",
    stellaSteps: [
      "Finds the 12 course zips in Downloads, Week 01 to Week 12",
      "Unzips each one into its own folder named after the zip, so the `notes.pdf` and `readme.txt` that every week shares can't overwrite each other",
      "Notices that weeks 3, 6 and 9 already had a wrapper folder inside, and moves those files up so there's no `Week 03/Week 03` level",
      "Skips the hidden `__MACOSX` folders of Mac leftovers in weeks 4 and 8, which held no course material",
      "Leaves every zip in place and reports that none were damaged or password-protected",
    ],
    prompt:
      "I've got a load of zip files in my Downloads from my evening course, one for each week. Unzip all of them at once, each into its own folder.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "12 zips unzipped in about 40 seconds. Checked afterwards against an answer key written before the run: every zip's files are in their own folder, byte-for-byte the same as inside the zip, no week mixed with another, no `__MACOSX` folders, no doubled wrapper folders, and all 12 zips still in Downloads, unchanged.",
      note: "The 12 zips and everything in them were made for this run, with the same file names in every week and Mac-made zips among them on purpose. The work is sped up 2×.",
      video: {
        src: `${PROOFS}/files-folders/extract-multiple-zip-files-at-once/proof.mp4`,
        cuts: webCuts("files-folders/extract-multiple-zip-files-at-once"),
        poster: `${PROOFS}/files-folders/extract-multiple-zip-files-at-once/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 43.1,
        realDuration: 75,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Twelve weekly course zips are in Downloads." },
        { at: 2, text: "The prompt: unzip all of them at once, each into its own folder." },
        { at: 11.2, text: "Stella replies: one folder per zip, named after the file, with the zips left where they are." },
        { at: 17.1, text: "Unzipping 12 files, sped up 2×." },
        { at: 29.1, text: "Done: 12 folders, wrapper folders flattened for weeks 3, 6 and 9, Mac leftovers skipped for weeks 4 and 8." },
      ],
    },
    manualTitle: "Unzip them yourself",
    manualSteps: [
      {
        title: "Windows: install 7-Zip",
        body: "Windows' own Extract All only works on one zip at a time. Install the free [7-Zip](https://www.7-zip.org/download.html), select all the zips in File Explorer, right-click, choose 7-Zip (under Show more options on Windows 11), then Extract to \"*\\\". Each zip goes into a folder with its own name.",
      },
      {
        title: "Mac: select them all and double-click",
        body: "In Finder, select every zip and double-click any one of them. Archive Utility opens each into a folder next to it. Nothing to install.",
      },
      {
        title: "Delete the junk folders",
        body: "Zips made on a Mac often contain a `__MACOSX` folder full of `._` files. They're useless on another computer and safe to delete. Mac's Archive Utility hides them, but Windows shows them.",
      },
      {
        title: "Fix doubled folders",
        body: "If a zip already had a folder inside it, you'll end up with `Week 03/Week 03/…`. Open the inner folder, select everything, drag it up one level, then delete the empty inner folder.",
      },
      {
        title: "Keep the zips until you've checked",
        body: "Open a few folders and make sure the files open before deleting the zips. A zip that says it's damaged or asks for a password needs a fresh download or the password from whoever sent it.",
      },
    ],
    limits: [
      "Password-protected zips need the password; Stella reports them instead of skipping silently.",
      "If a zip holds another zip, the inner one stays zipped unless you ask Stella to open those too.",
      "Folder and file names are seen by the AI model you use in Stella. The unzipping itself happens on your computer; nothing is uploaded.",
      "Recorded on Linux, where Stella used the unzip tools already there. On a Mac it can use the built-in tools too; on Windows it uses what's available, such as PowerShell's Expand-Archive, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why does Windows only extract one zip at a time?",
        a: "Extract All is built for a single archive. Selecting several zips greys it out or only handles the one you right-clicked. 7-Zip or a short PowerShell loop handles a batch.",
      },
      {
        q: "What is the __MACOSX folder in a zip?",
        a: "Hidden Mac file details (the `._` files) that the Mac's Compress command adds. They aren't part of your files and can be deleted. Stella left them out when unzipping.",
      },
      {
        q: "Can it open RAR or 7z files the same way?",
        a: "Yes. See [open a RAR file](/how/files-folders/open-rar-file) and [open a split 7z file](/how/files-folders/open-7z-file). To go the other way, see [split a folder into zips small enough to email](/how/files-folders/zip-file-too-large-to-email).",
      },
      {
        q: "Will it delete the zip files afterwards?",
        a: "Not unless you ask. In the recording all 12 zips stayed in Downloads, unchanged.",
      },
    ],
    related: ["files-folders/open-rar-file", "files-folders/open-7z-file", "files-folders/zip-file-too-large-to-email"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "7-Zip download page", href: "https://www.7-zip.org/download.html" },
      { label: "Pureinfotech: How to extract Zip, TAR, 7z and RAR files on Windows 11", href: "https://pureinfotech.com/extract-zip-rar-7z-tar-windows-11/" },
    ],
  },
  {
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
      "Search inside PDFs, Word, Excel, RTF and text files for a name or phrase and get one list of every match, with Windows search, Spotlight, or Stella (stella.sh).",
    h1: "Find files containing text, whatever type of file they are",
    short: "Find files containing text",
    lede: "Every document that mentions one name, whatever its type, in one saved list.",
    answer:
      "On a Mac, Spotlight already searches inside PDFs, Word and Excel files: type the phrase in quotes in a Finder window. On Windows, File Explorer's `content:\"phrase\"` search works only in folders whose contents are indexed, so check the indexing settings first. Command-line `grep` can't see inside Word, Excel or most PDFs. Stella (stella.sh) reads every type, lists each matching file with where it is and the line that mentions it, and saves the list for you.",
    stellaSteps: [
      "Searches Documents and Downloads, subfolders included: 123 files of PDF, Word, Excel, text and RTF",
      "Reads inside each file, including Word tables, Excel cells and small print in PDF footers, and matches the name whatever its capitals",
      "Leaves out near-misses such as a hotel called Harbour View and a Harbourview Road parking permit",
      "Saves `Harbourview Lettings files.txt` on the Desktop: each match with its folder, file type and the line that mentions the name",
      "Flags one possible match (a brochure for “Harbour Lettings”) at the bottom, outside the main list, for you to decide",
    ],
    prompt:
      "I need every file in my Documents and Downloads that mentions Harbourview Lettings, our old letting agent, whatever type of file it is. Save the list as a file on my Desktop.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "The list was saved in about 1 minute 25 seconds. Checked afterwards against an answer key written before the run: it names all 9 files that mention the name (four PDFs, two Word files, an Excel sheet, a text note and an RTF), lists none of the look-alike files, says where each one is, and no file was changed or moved.",
      note: "The 123 documents, the letting agent and the look-alike names were made up for this run. The search is sped up 6×.",
      video: {
        src: `${PROOFS}/files-folders/find-files-containing-text/proof.mp4`,
        cuts: webCuts("files-folders/find-files-containing-text"),
        poster: `${PROOFS}/files-folders/find-files-containing-text/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 45,
        realDuration: 122,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer, with 123 documents spread over Documents and Downloads." },
        { at: 2, text: "The prompt: every file that mentions Harbourview Lettings, whatever its type, listed on the Desktop." },
        { at: 12.8, text: "Stella replies: it will look inside PDFs, Office files and scans, and note each file's location and the matching line." },
        { at: 18.7, text: "Reading every file, sped up 6×." },
        { at: 31, text: "Done: 9 matches out of 123 files, with a similar-looking brochure listed separately for you to decide on." },
      ],
    },
    manualTitle: "Search inside files yourself",
    manualSteps: [
      {
        title: "Mac: Finder search",
        body: "Open a Finder window, click the search field and type the phrase in quotes, like `\"Harbourview Lettings\"`. Choose This Mac or the folder you're in. Spotlight reads the text inside PDFs, Word, Excel and text files. Click Save to keep the search as a smart folder.",
      },
      {
        title: "Windows: turn on content indexing",
        body: "Open Settings, Privacy & security, Searching Windows, Advanced indexing options. Make sure Documents and Downloads are in the indexed locations, then under Advanced, File Types, set the types you need to “Index Properties and File Contents”. Indexing can take a while.",
      },
      {
        title: "Windows: search contents",
        body: "In File Explorer, open Documents and type `content:\"Harbourview Lettings\"` in the search box. Repeat in Downloads. Only indexed folders are searched this way.",
      },
      {
        title: "Write the list down",
        body: "Neither search saves a list you can send. Select the results, and on Windows use Copy path (Ctrl+Shift+C) and paste into a note; on a Mac, select them and use Copy, then paste into TextEdit to get the names.",
      },
      {
        title: "Check scanned PDFs separately",
        body: "A scanned letter is a picture of text, so no search finds words in it until it has been through text recognition (OCR). If you expect scans, see [make a scanned PDF searchable](/how/pdf-excel/make-scanned-pdf-searchable).",
      },
    ],
    limits: [
      "Scanned PDFs need text recognition first. Stella can do that, but it's slower; in this run every file already had text.",
      "Stella reads the files to search them, and the matching lines go to the AI model you use in Stella so it can report them. Files are not uploaded anywhere else.",
      "It left the possible match out of the main list and asked. If you want spelling variants counted, say so in the prompt.",
      "Recorded on Linux, where Stella used Python libraries to read PDF, Word and Excel files. On a Mac or Windows PC it may install those first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why doesn't Windows find text inside my Word files?",
        a: "Windows only searches file contents in indexed folders, and only for file types set to index contents. Add the folder in Searching Windows and set the file type to “Index Properties and File Contents”.",
      },
      {
        q: "Can grep or findstr search Word and Excel files?",
        a: "Not reliably. .docx and .xlsx are compressed zips inside, so the words aren't stored as plain text, and most PDFs are compressed too. You need a tool that opens each format.",
      },
      {
        q: "Does it change or move the files it finds?",
        a: "No. It only read them; the check confirmed every file was unchanged. Ask separately if you want the matches copied into one folder.",
      },
      {
        q: "Can it put the matching emails in one PDF too?",
        a: "Yes, if they're saved as files: see [put a person's emails into one PDF](/how/contacts-calendar-email/convert-eml-to-pdf). To tidy the files you found, [rename them in bulk](/how/files-folders/rename-multiple-files-at-once).",
      },
    ],
    related: ["files-folders/rename-multiple-files-at-once", "contacts-calendar-email/convert-eml-to-pdf", "pdf-excel/make-scanned-pdf-searchable"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Microsoft: Search indexing in Windows FAQ", href: "https://support.microsoft.com/windows/indexing-in-windows-faq-da061c83-af6b-095c-0f7a-4dfecda4d15a" },
      { label: "Apple: Search for files on Mac", href: "https://support.apple.com/guide/mac-help/mchlp1236/mac" },
    ],
  },
  {
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
      "Flatten a folder of year and month subfolders into one folder without files overwriting each other: the search trick on Windows and Mac, or Stella (stella.sh).",
    h1: "Move all files from subfolders into one folder without losing any",
    short: "Move files out of subfolders",
    lede: "71 scans out of their year and month folders, none lost to a clashing name.",
    answer:
      "The usual trick is to search for `*` inside the top folder in File Explorer or Finder, select every file, cut and paste them into the top folder. The catch is names that repeat, like `scan0001.pdf` in every month: choose Keep Both on a Mac, or tick both sides in Windows' conflict box, or files get replaced or skipped. Stella (stella.sh) moves everything up, gives clashing files names that can't collide, and removes the emptied subfolders.",
    stellaSteps: [
      "Finds 71 files in the Scans folder's year, month, Receipts and Phone photos subfolders",
      "Sees that names like `scan0001.pdf` repeat in most months, so moving them as they are would overwrite files",
      "Puts each file's old folder path at the front of its name, like `2023 - 04 Apr - Receipts - scan0005.pdf`, which also sorts them by date",
      "Moves every file straight into Scans and checks each arrived at the same size",
      "Removes the emptied year and month folders and a hidden Mac `.DS_Store` file",
    ],
    prompt:
      "My scans in the Scans folder in Documents are spread over loads of subfolders by year and month. Move every file out into the Scans folder itself so they're all in one place, without losing any.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "All 71 files moved in about 20 seconds. Checked afterwards against an answer key written before the run, by file contents rather than names: all 70 different files are directly in Scans (file names clashed 62 times), nothing was left in the subfolders, and the emptied subfolders are gone.",
      note: "The scans and photos are test files made for this run, with clashing names on purpose. The run isn't sped up; a long idle stretch after the answer is cut.",
      video: {
        src: `${PROOFS}/files-folders/move-files-from-subfolders-into-one-folder/proof.mp4`,
        cuts: webCuts("files-folders/move-files-from-subfolders-into-one-folder"),
        poster: `${PROOFS}/files-folders/move-files-from-subfolders-into-one-folder/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 37.4,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Documents/Scans holds year and month subfolders full of scans." },
        { at: 2.1, text: "The prompt: move every file into the Scans folder itself, without losing any." },
        { at: 23.4, text: "Done: 71 files moved, each renamed with its old folder path in front so no name clashes, and the empty folders removed." },
      ],
    },
    manualTitle: "Flatten the folder yourself",
    manualSteps: [
      {
        title: "Back up first",
        body: "Copy the whole Scans folder somewhere else before you start. If a name clash goes wrong, you can start again.",
      },
      {
        title: "Windows: search, cut, paste",
        body: "Open Scans in File Explorer and type `*` in the search box. Sort by Type, select all the files (not the folders), press Ctrl+X, go back to Scans itself and press Ctrl+V.",
      },
      {
        title: "Windows: handle the clashes",
        body: "When Windows says files with the same name already exist, choose “Let me decide for each file”, tick both the source and destination boxes at the top, and continue. Windows keeps both and adds “(2)” to the name. Choosing Replace or Skip loses files.",
      },
      {
        title: "Mac: search, drag, Keep Both",
        body: "In Finder, open Scans, search for `kind:document` (or `kind:image` for photos), set the search to Scans rather than This Mac, select all results and drag them onto Scans in the path bar. When Finder asks about names that exist, hold Option and click Keep Both so it applies to all.",
      },
      {
        title: "Remove the empty subfolders",
        body: "Once the files are out, the year and month folders are empty. Delete them, or see [delete empty folders](/how/pc-cleanup/delete-empty-folders) for a way to clear every empty folder at once.",
      },
    ],
    limits: [
      "Stella chose to rename clashing files with their old folder path in front. If you'd rather keep names as they are with “(2)” added, or keep exact copies only once, say so in the prompt.",
      "One file was an exact copy of another; Stella kept both, which the answer key allows. Ask it to drop identical copies if you want.",
      "It deleted a hidden `.DS_Store` file (Mac folder settings, not a scan) without asking, and told you afterwards.",
      "Recorded on Linux. The move works the same on a Mac or Windows PC with their own built-in tools; that wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why did some files disappear when I flattened my folders?",
        a: "Two files with the same name can't sit in one folder. If you chose Replace, the older one was overwritten; if you chose Skip, it stayed in the subfolder. Check the Recycle Bin or Trash and the subfolders.",
      },
      {
        q: "Can I keep the year and month in the file names?",
        a: "Yes. That's what Stella did here: `2023 - 01 Jan - scan0001.pdf`. To rename by a pattern of your own, see [rename multiple files at once](/how/files-folders/rename-multiple-files-at-once).",
      },
      {
        q: "Does moving files change their dates?",
        a: "Moving within the same drive keeps the modified date. Photos keep their date taken, which is stored inside the file. To go the other way, [sort photos into folders by date](/how/photos-files/sort-photos-into-folders-by-date).",
      },
    ],
    related: ["files-folders/rename-multiple-files-at-once", "pc-cleanup/delete-empty-folders", "photos-files/sort-photos-into-folders-by-date", "files-folders/compare-two-folders"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Search for files on Mac", href: "https://support.apple.com/guide/mac-help/mchlp1236/mac" },
      { label: "Microsoft Learn: Move-Item", href: "https://learn.microsoft.com/powershell/module/microsoft.powershell.management/move-item" },
    ],
  },
  {
    slug: "open-7z-file",
    niche: "files-folders",
    searchPhrases: [
      "how to open 7z files",
      "7z file",
      "open 7z file",
      "how to open 7z file on mac",
      "open 7z.001 file",
    ],
    title: "How to open a 7z file, including split .7z.001 parts",
    description:
      "Open a .7z file, or one split into .7z.001, .002 and .003 parts, on Windows or Mac: the free 7-Zip or The Unarchiver, the Terminal, or Stella (stella.sh).",
    h1: "How to open a 7z file, even one split into parts",
    short: "Open a 7z file",
    lede: "Three .7z.001-style parts joined, and 28 photos in Pictures.",
    answer:
      "A single .7z opens in Windows 11's File Explorer, in the free 7-Zip program on any Windows, and in The Unarchiver or Keka on a Mac. Files ending in .7z.001, .002 and so on are one archive cut into parts: keep them together and open the .001 file in 7-Zip or The Unarchiver, which read the rest automatically. Stella (stella.sh) joins the parts, unpacks them and puts the files where you ask.",
    stellaSteps: [
      "Finds the three parts in Downloads: `Westbrook reunion photos.7z.001`, `.002` and `.003`",
      "Joins them back into one archive and unpacks it",
      "Puts the 28 photos and a credits note in a new Westbrook reunion photos folder in Pictures",
      "Checks the archive opened without errors and nothing was overwritten",
      "Leaves the three parts in Downloads and offers to delete them",
    ],
    prompt:
      "I downloaded our school reunion photos and they came as three files ending in .7z.001, .7z.002 and .7z.003 (in my Downloads). Open them and put the photos in my Pictures folder.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "The photos were in Pictures in under 40 seconds. Checked afterwards against an answer key written before the run: all 29 files from the archive (28 photos and a text note) came out byte-for-byte identical, they're in Pictures, and the three parts are unchanged.",
      note: "The photos are generated test images, and the split archive was made for this run. The work is sped up 2×.",
      video: {
        src: `${PROOFS}/files-folders/open-7z-file/proof.mp4`,
        cuts: webCuts("files-folders/open-7z-file"),
        poster: `${PROOFS}/files-folders/open-7z-file/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 45.4,
        realDuration: 66,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A 7z archive split into three parts is in Downloads." },
        { at: 2, text: "The prompt: open the three .7z parts and put the photos in Pictures." },
        { at: 16.8, text: "Stella replies: it will join the parts, unpack them and move the photos into Pictures." },
        { at: 22.7, text: "Joining and unpacking, sped up 2×." },
        { at: 31.4, text: "Done: 28 photos in a new folder in Pictures, plus the credits note. The parts are still in Downloads." },
      ],
    },
    manualTitle: "Open it yourself",
    manualSteps: [
      {
        title: "Keep all the parts together",
        body: "Put every part (.7z.001, .7z.002, .7z.003…) in the same folder with their names unchanged. One part on its own can't be opened, and a missing part means some files can't be recovered.",
      },
      {
        title: "Windows: 7-Zip",
        body: "Install the free [7-Zip](https://www.7-zip.org/download.html). Right-click the .7z.001 file, choose 7-Zip, Extract files…, and pick a destination such as Pictures. It reads the other parts by itself. Windows 11's built-in support opens a single .7z, but not split parts.",
      },
      {
        title: "Mac: The Unarchiver",
        body: "Install The Unarchiver (free, in the Mac App Store) and double-click the .7z.001 file. It extracts the whole archive next to the parts; drag the folder into Pictures.",
      },
      {
        title: "Mac without installing anything",
        body: "In Terminal, join the parts and extract with the built-in tar: `cd ~/Downloads && cat \"Westbrook reunion photos.7z.\"0* > reunion.7z && tar -xf reunion.7z -C ~/Pictures`. Delete `reunion.7z` afterwards.",
      },
      {
        title: "Check, then tidy up",
        body: "Open a few photos to make sure they're whole. Then delete the parts and any joined copy if you don't need them.",
      },
    ],
    limits: [
      "Every part must be there and complete; a missing or half-downloaded part can't be worked around.",
      "Password-protected archives need the password.",
      "File names are seen by the AI model you use in Stella. The photos are unpacked on your computer and aren't uploaded.",
      "Recorded on Linux. On a Mac or Windows PC Stella may download the free 7-Zip command-line tool or a small Python library first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What is a .7z.001 file?",
        a: "The first part of a 7z archive split into pieces, usually so each fits an upload or email limit. The pieces only open together, starting from .001.",
      },
      {
        q: "Can Windows 11 open 7z files without extra software?",
        a: "Recent Windows 11 versions open a single .7z in File Explorer. Split parts and password-protected archives still need 7-Zip.",
      },
      {
        q: "Is a 7z file safe to open?",
        a: "Opening it only unpacks files; it doesn't run anything. Be careful with programs (.exe, .app, scripts) that come out of an archive from someone you don't know.",
      },
      {
        q: "What about RAR and zip files?",
        a: "See [open a RAR file](/how/files-folders/open-rar-file) and [extract many zip files at once](/how/files-folders/extract-multiple-zip-files-at-once).",
      },
    ],
    related: ["files-folders/open-rar-file", "files-folders/extract-multiple-zip-files-at-once", "photos-files/find-duplicate-photos"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "7-Zip download page", href: "https://www.7-zip.org/download.html" },
      { label: "The Unarchiver", href: "https://theunarchiver.com/" },
      { label: "Pureinfotech: How to extract Zip, TAR, 7z and RAR files on Windows 11", href: "https://pureinfotech.com/extract-zip-rar-7z-tar-windows-11/" },
    ],
  },
  {
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
      "Open a .rar file on a Mac or Windows PC with tools already there (Terminal's tar, Windows 11 File Explorer), a free app, or Stella (stella.sh), folders intact.",
    h1: "How to open a RAR file on a Mac or Windows PC",
    short: "Open a RAR file",
    lede: "A RAR of family recipes opened into Documents, every folder as it was.",
    answer:
      "On Windows 11 (version 23H2 or later), right-click the .rar and choose Extract All; older Windows needs the free 7-Zip program. A Mac's Archive Utility can't open RAR, but The Unarchiver (free) can, and so can the Terminal's built-in `tar -xf file.rar`. Stella (stella.sh) opens it on your computer, keeps the folders inside as they are and puts them where you ask, with nothing uploaded to a converter site.",
    stellaSteps: [
      "Finds `Nana Pearl's recipes.rar` in Downloads",
      "Extracts it into Documents with its folders as they were: Baking, Mains, Preserves and Photos",
      "Keeps names with accents, like `Crème brûlée.txt`, intact",
      "Avoids a doubled `Nana Pearl's recipes/Nana Pearl's recipes` folder",
      "Reports what's in each folder and leaves the RAR in Downloads",
    ],
    prompt:
      "My cousin sent me Nana's recipes as a RAR file (it's in my Downloads) and I can't open it. Get everything out of it into my Documents folder, keeping the folders as they are.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "Everything was out in about 35 seconds. Checked afterwards against an answer key written before the run: all 17 files are byte-for-byte identical to the archive's, every one is in its original subfolder with its name intact, they're inside Documents with no doubled folder, and the RAR is still in Downloads, unchanged.",
      note: "The recipes, photos and RAR 5 archive were made for this run. The work is sped up 2×.",
      video: {
        src: `${PROOFS}/files-folders/open-rar-file/proof.mp4`,
        cuts: webCuts("files-folders/open-rar-file"),
        poster: `${PROOFS}/files-folders/open-rar-file/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 40.8,
        realDuration: 69,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A RAR of recipes is in Downloads." },
        { at: 2, text: "The prompt: get everything out into Documents, keeping the folders as they are." },
        { at: 11.6, text: "Stella replies: it will extract into Documents and leave the original in Downloads." },
        { at: 17.6, text: "Extracting, sped up 2×." },
        { at: 26.8, text: "Done: 17 files in Documents, in Baking, Mains, Preserves and Photos, nothing failed or overwritten." },
      ],
    },
    manualTitle: "Open it yourself",
    manualSteps: [
      {
        title: "Windows 11: File Explorer",
        body: "On Windows 11 version 23H2 or later, right-click the .rar, choose Extract All…, pick Documents and click Extract. Password-protected RARs don't work here.",
      },
      {
        title: "Windows 10: 7-Zip",
        body: "Install the free [7-Zip](https://www.7-zip.org/download.html). Right-click the .rar, choose 7-Zip, Extract files…, and pick Documents.",
      },
      {
        title: "Mac: The Unarchiver",
        body: "Archive Utility (double-click) doesn't open RAR. Install The Unarchiver from the Mac App Store, then double-click the .rar; it extracts next to the file, and you drag the folder into Documents.",
      },
      {
        title: "Mac without installing anything",
        body: "Open Terminal, type `cd ~/Documents` and press Return. Then type `tar -xf ` (with a space), drag the .rar onto the window and press Return. The Mac's built-in tar reads RAR files.",
      },
      {
        title: "Multi-part RARs",
        body: "Files named `.part1.rar`, `.part2.rar` belong together. Put them all in one folder and open part 1; the others are read automatically.",
      },
    ],
    limits: [
      "Stella can't open a password-protected RAR unless you give it the password.",
      "A multi-part RAR needs every part in the same folder.",
      "It extracts on your computer and nothing is uploaded, but file names are seen by the AI model you use in Stella.",
      "Recorded on Linux, where a RAR-reading tool was already installed. The Mac's tar reads RAR too; on Windows 10 Stella may install 7-Zip's command-line tool first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Do I need WinRAR to open a RAR file?",
        a: "No. Windows 11's File Explorer, 7-Zip, The Unarchiver and the Mac's Terminal all open RAR files for free. WinRAR is only needed to make new RAR files.",
      },
      {
        q: "Why won't my Mac open a RAR file?",
        a: "Archive Utility, which opens zips when you double-click, doesn't support RAR. Use The Unarchiver or `tar -xf` in Terminal.",
      },
      {
        q: "Is it safe to use an online RAR extractor?",
        a: "It means uploading the archive to someone else's server. For family photos or documents, opening it on your own computer is the safer choice.",
      },
      {
        q: "What about 7z or many zip files?",
        a: "See [open a 7z file, even in parts](/how/files-folders/open-7z-file) and [extract many zips at once](/how/files-folders/extract-multiple-zip-files-at-once).",
      },
    ],
    related: ["files-folders/open-7z-file", "files-folders/extract-multiple-zip-files-at-once", "files-folders/zip-file-too-large-to-email"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Pureinfotech: How to extract Zip, TAR, 7z and RAR files on Windows 11", href: "https://pureinfotech.com/extract-zip-rar-7z-tar-windows-11/" },
      { label: "Neowin: Windows 11 gets native RAR support", href: "https://www.neowin.net/news/windows-11-gets-native-rar-support-here-is-how-it-compares-to-winrar-and-other-apps/" },
      { label: "The Unarchiver", href: "https://theunarchiver.com/" },
    ],
  },
  {
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
      "Bulk rename messy files to one pattern like “01 - Cells.pdf” so they sort right: Finder's Rename, PowerToys PowerRename, or Stella (stella.sh) reading each file.",
    h1: "Rename multiple files at once to a clean pattern",
    short: "Rename many files at once",
    lede: "14 messy lecture files renamed “01 - Cells.pdf” to “14 - Revision.pdf”, in order.",
    answer:
      "On a Mac, select the files, Control-click and choose Rename to replace text or add numbers. On Windows, the free Microsoft PowerToys adds PowerRename, which takes find-and-replace patterns. Neither can add a leading zero to a number that's already in the name, or read a file to find the number that's missing from its name. Stella (stella.sh) renames to the pattern you describe in words, reading inside the files when the name isn't enough.",
    stellaSteps: [
      "Opens the Biology 101 folder: 14 PDFs named like `Lec 2 Membranes (final).pdf`, `lecture10_genetics.PDF` and `Plant hormones.pdf`",
      "Reads the title inside each PDF, such as “Lecture 13: Plant hormones”, and checks it against the number in the file name",
      "Uses the inside title for the two files with no number in their names",
      "Renames all 14 to `NN - Topic.pdf`, dropping leftovers like “v2”, “(final)” and “(1)” and making `.PDF` lower case",
      "Lists the new names in order",
    ],
    prompt:
      "The lecture slides in the Biology 101 folder in my Documents have messy names and sort in the wrong order. Rename them all like '01 - Cells.pdf': the two-digit lecture number, a dash, then the topic.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "All 14 renamed in about 15 seconds. Checked afterwards against an answer key written before the run, by file contents: every file is named `NN - Topic.pdf` with its correct lecture number (including 09, not 101, for `BIO101 L9 Inheritance.pdf`, and 13 and 14 for the two without numbers), renamed not copied, with lower-case `.pdf` and nothing else added to the folder.",
      note: "The lecture PDFs were made for this run. Stella's first message is a terse working note (“Titles match filenames and are clean; renaming.”) rather than its usual plan. The run isn't sped up.",
      video: {
        src: `${PROOFS}/files-folders/rename-multiple-files-at-once/proof.mp4`,
        cuts: webCuts("files-folders/rename-multiple-files-at-once"),
        poster: `${PROOFS}/files-folders/rename-multiple-files-at-once/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 32.4,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. 14 lecture PDFs with messy names are in Documents/Biology 101." },
        { at: 2, text: "The prompt: rename them like '01 - Cells.pdf', two-digit number, dash, topic." },
        { at: 15.2, text: "A short working note: the titles inside match the file names." },
        { at: 18.4, text: "Done: 01 - Cells to 14 - Revision, with lectures 13 and 14 numbered from the titles inside the files." },
      ],
    },
    manualTitle: "Rename them yourself",
    manualSteps: [
      {
        title: "Mac: Finder's Rename",
        body: "Select the files, Control-click and choose Rename… Use Replace Text to remove words like `Lecture `, `_` and ` v2` one at a time. Format can number files, but only in the order Finder shows them, not by the number in the name.",
      },
      {
        title: "Windows: PowerToys PowerRename",
        body: "Install Microsoft PowerToys (free), turn on PowerRename, select the files, right-click and choose Rename with PowerRename. Tick “Use regular expressions” to pull out the number and topic, and preview the new names before applying.",
      },
      {
        title: "Add the leading zeros",
        body: "`2` sorts after `10` unless it's written `02`. In PowerRename, do a second pass on the single-digit names (search `^(\\d) - ` and replace with `0$1 - `). In Finder, fix those few by hand.",
      },
      {
        title: "Open the files with no number",
        body: "A file called `Plant hormones.pdf` gives no clue to its lecture number. Open it, read the title, and rename it by hand.",
      },
      {
        title: "Keep a list of old names",
        body: "Before renaming a big batch, take a screenshot of the folder or copy the names into a note. Neither tool keeps an undo list once you close it.",
      },
    ],
    limits: [
      "When names depend on what's inside, Stella opens each file. For scans, that means text recognition, which is slower.",
      "It doesn't keep a list of old and new names unless you ask; add “keep a list of the old names” to the prompt if you want an undo record.",
      "The first lines of each PDF go to the AI model you use in Stella so it can read the titles. The renaming happens on your computer.",
      "Recorded on Linux. On a Mac or Windows PC Stella may install a small PDF-reading library first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why do my files sort 1, 10, 11, 2?",
        a: "Some apps sort names letter by letter, so `10` comes before `2`. Two-digit numbers (`01`, `02` … `10`) sort right everywhere.",
      },
      {
        q: "Can it rename files based on what's inside them?",
        a: "Yes. Here it read lecture titles; for invoices, statements and letters see [rename PDFs by their content](/how/photos-files/rename-pdf-files-based-on-content).",
      },
      {
        q: "Can I undo a bulk rename?",
        a: "Windows' Ctrl+Z undoes a PowerRename batch right after. Otherwise you need a list of old names, so ask Stella to save one next to the files.",
      },
      {
        q: "Can it rename and gather files from subfolders at once?",
        a: "Yes, in one prompt. See [move files from subfolders into one folder](/how/files-folders/move-files-from-subfolders-into-one-folder), where Stella put each old folder name into the new file name.",
      },
    ],
    related: ["photos-files/rename-pdf-files-based-on-content", "files-folders/move-files-from-subfolders-into-one-folder", "files-folders/find-files-containing-text"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Rename files, folders and disks on Mac", href: "https://support.apple.com/guide/mac-help/mchlp1144/mac" },
      { label: "Microsoft Learn: PowerToys PowerRename", href: "https://learn.microsoft.com/windows/powertoys/powerrename" },
    ],
  },
  {
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
      "Too big to attach? Split a folder into several ordinary zips, each under the email limit and each opening on its own, by hand or with Stella (stella.sh).",
    h1: "Zip file too large to email? Split it into pieces that each open",
    short: "Zip too large to email",
    lede: "A 25 MB folder as two zips under 20 MB, each opening on its own.",
    answer:
      "Group the files into two or three folders of about 18 MB each and zip each one: Compress on a Mac, Send to, Compressed (zipped) folder on Windows. Avoid “split to volumes” in 7-Zip or WinRAR for email: those .001 or .z01 parts only open when the person has every one. Photos barely shrink when zipped, so count on their full size. Stella (stella.sh) packs the folder into the fewest ordinary zips under your limit and checks that each one opens alone.",
    stellaSteps: [
      "Measures the House sale folder: 22 files, about 25 MB, mostly photos that won't compress much",
      "Packs them into two ordinary zips under 20 MB, leaving room under the limit: all the documents and photos 1–8 in one, photos 9–16 in the other",
      "Keeps the folder layout inside, so opening both puts everything back in one House sale folder with Photos inside",
      "Opens each zip on its own and checks every file comes out the same as the original",
      "Saves them in a new House sale - zipped for email folder in Documents and leaves the original folder unchanged",
    ],
    prompt:
      "I need to email my sister the House sale folder in my Documents, but it's too big to attach. Zip it into pieces that are each under 20 MB so I can send them in separate emails, and make sure each piece opens on its own.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "Two zips (13.3 MB and 12.3 MB) in about 35 seconds. Checked afterwards against an answer key written before the run: both are under 20 MB even counted as 20,000,000 bytes, each opens on its own with no split parts, together they hold all 22 files intact with none packed twice and the Photos subfolder kept, and the original folder is unchanged.",
      note: "The photos, survey and documents were made for this run. The work is sped up 2×.",
      video: {
        src: `${PROOFS}/files-folders/zip-file-too-large-to-email/proof.mp4`,
        cuts: webCuts("files-folders/zip-file-too-large-to-email"),
        poster: `${PROOFS}/files-folders/zip-file-too-large-to-email/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 43.7,
        realDuration: 64,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Documents/House sale is about 25 MB, too big to attach." },
        { at: 2, text: "The prompt: zip it into pieces under 20 MB that each open on their own." },
        { at: 14.6, text: "Stella replies: separate zips with room under 20 MB, and it will say if any single file is too big." },
        { at: 20.6, text: "Packing and checking the zips, sped up 2×." },
        { at: 29.7, text: "Done: two zips, documents and photos 1–8 in one, photos 9–16 in the other, each checked on its own." },
      ],
    },
    manualTitle: "Split it yourself",
    manualSteps: [
      {
        title: "Check your email's limit",
        body: "Gmail allows 25 MB per email, Outlook.com about 20 MB, and many work accounts less. The recipient's limit matters too, so aim a few MB under the smaller one.",
      },
      {
        title: "Group the files into folders",
        body: "Make two or three folders inside the main one and drag files in until each is about 18 MB (Get Info on a Mac, Properties on Windows). Photos and videos are already compressed, so a zip of them is nearly the same size.",
      },
      {
        title: "Zip each group",
        body: "Mac: Control-click each folder and choose Compress. Windows 11: right-click, Compress to, ZIP File (on Windows 10, Send to, Compressed (zipped) folder). Check each zip's size before attaching.",
      },
      {
        title: "Don't use split volumes for email",
        body: "7-Zip's “Split to volumes” and WinRAR's parts (.001, .z01, .part1.rar) only open when the recipient has every part and a tool that joins them. Ordinary zips open with a double-click on any computer.",
      },
      {
        title: "Or send a link instead",
        body: "For anything much over 50 MB, a shared link from Google Drive, OneDrive or iCloud Drive is easier than several emails. Gmail does this for you when an attachment is too big.",
      },
    ],
    limits: [
      "Photos and videos are already compressed, so zipping barely shrinks them. Stella can also make smaller copies of photos if you say so; it didn't here, as you didn't ask.",
      "A single file bigger than the limit can't fit in an ordinary zip. Stella says so instead of cutting it into parts that won't open.",
      "Stella makes the zips; it doesn't send the emails unless you connect your email account and ask it to.",
      "Recorded on Linux. On a Mac or Windows PC Stella uses their own zip tools, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why is my zip file almost the same size as the folder?",
        a: "Photos, videos, music and PDFs with pictures are compressed already. Zipping squeezes text and Office files, not those. To shrink photos, [resize them in bulk](/how/photos-files/resize-images-in-bulk).",
      },
      {
        q: "Can the recipient open just one of the zips?",
        a: "Yes. Each is an ordinary zip with whole files inside. That's the difference from split volumes, which open only all together.",
      },
      {
        q: "What if it's one big PDF that's too large?",
        a: "Zipping won't help much. [Compress the PDF](/how/pdf-excel/compress-pdf-too-large-to-email) or [split it into several files](/how/pdf-excel/split-pdf-into-multiple-files) instead.",
      },
      {
        q: "How do they put it back together?",
        a: "Open both zips into the same place. Stella kept the same folder name in each, so the files land together in one House sale folder. To open many at once, see [extract several zips](/how/files-folders/extract-multiple-zip-files-at-once).",
      },
    ],
    related: ["pdf-excel/compress-pdf-too-large-to-email", "files-folders/extract-multiple-zip-files-at-once", "photos-files/resize-images-in-bulk"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Google: Attach files in Gmail (size limits)", href: "https://support.google.com/mail/answer/6584" },
      { label: "Pureinfotech: Create ZIP, TAR and 7z archives on Windows 11", href: "https://pureinfotech.com/windows-11-create-7-zip-tar-archive-files/" },
    ],
  },
  {
    slug: "combine-gpx-files",
    niche: "files-folders",
    searchPhrases: [
      "combine gpx files",
      "merge gpx files",
      "combine gpx files for strava",
      "combine gpx files into one",
    ],
    title: "Combine GPX files into one track, in the right order",
    description:
      "Merge several GPX recordings of a multi-day hike or ride into one GPX in time order, keeping times, elevation and heart rate: GPSBabel, gpx.studio, or Stella (stella.sh).",
    h1: "Combine GPX files into one track in the right order",
    short: "Combine GPX files",
    lede: "Five recordings of a four-day hike as one GPX, in time order, heart rate kept.",
    answer:
      "The free GPSBabel can merge GPX files and sort the points by time; gpx.studio in the browser lets you drop the files in and merge them by hand. Both work, but watch for two things: files merged in file-name order instead of time order, and times dropped in the merge. Stella (stella.sh) combines them on your computer in time order, keeps times, elevation and heart rate, and tells you which recording is which.",
    stellaSteps: [
      "Finds five GPX files in the West Highland hike folder, not four: day 2 was recorded in two parts, one from a phone app with a different layout",
      "Orders them by their timestamps, not their file names (`Activity_20891.gpx` turned out to be day 4)",
      "Checks each piece starts within about 50 m of where the last one ended",
      "Writes one GPX track with each recording as its own section, so the overnight stops don't draw straight lines across the map",
      "Keeps the watch's heart-rate data and leaves the five originals unchanged",
    ],
    prompt:
      "I recorded my 4-day hike as separate GPX files, in the West Highland hike folder in Downloads. Combine them into one GPX in the right order so I can upload the whole trip.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "One GPX in about 35 seconds. Checked afterwards against an answer key written before the run: `West Highland hike - full trip.gpx` parses as GPX, holds all 1,970 points from the five files in time order from day 1's first point to day 4's last, every point keeps its time and elevation, heart rate is kept, and the originals are unchanged.",
      note: "The route and recordings are made up for this run; the place names are fictional. The run isn't sped up; a long idle stretch after the answer is cut.",
      video: {
        src: `${PROOFS}/files-folders/combine-gpx-files/proof.mp4`,
        cuts: webCuts("files-folders/combine-gpx-files"),
        poster: `${PROOFS}/files-folders/combine-gpx-files/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 48.8,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Five GPX recordings of a four-day hike are in Downloads." },
        { at: 2.1, text: "The prompt: combine them into one GPX in the right order." },
        { at: 34.9, text: "Done: one track with 1,970 points in time order, day 2 rebuilt from two recordings, heart rate kept." },
      ],
    },
    manualTitle: "Combine them yourself",
    manualSteps: [
      {
        title: "Check which file is which day",
        body: "Open each GPX in a text editor and look at the first `<time>`: file names from watches and apps often don't sort by date. Note any day recorded in two parts.",
      },
      {
        title: "Merge with GPSBabel",
        body: "Install the free [GPSBabel](https://www.gpsbabel.org/). Add every file as input with the format GPX, set the output to GPX, and under Filters turn on Tracks with Merge, which joins the tracks and sorts the points by time. Save.",
      },
      {
        title: "Or merge in the browser",
        body: "Open [gpx.studio](https://gpx.studio/), drop all the files in, put them in day order in the file list, and use its merge tool. Export as GPX. The files are loaded into a web page to do this.",
      },
      {
        title: "Check before uploading",
        body: "Open the merged file in a map viewer or gpx.studio. Look for straight lines between days, a missing piece, or times shown as missing. Then upload it to Strava, Garmin Connect or Komoot.",
      },
    ],
    limits: [
      "Gaps stay as gaps: if a watch was off for a stretch, Stella doesn't invent the missing path.",
      "It doesn't upload to Strava or Garmin for you unless you ask and are signed in there in your browser.",
      "The merge runs on your computer and nothing is uploaded, but what Stella reads while working, such as file names, times and place names, goes to the AI model you use in Stella.",
      "Recorded on Linux, where Stella used only Python, which is built in on Mac and Linux. On Windows it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Will Strava accept one GPX for several days?",
        a: "It takes it as one long activity covering the whole trip. If you'd rather have one activity per day, upload the original day files separately instead.",
      },
      {
        q: "Why does my merged track have straight lines across the map?",
        a: "The merge joined the end of one day to the start of the next as one line. Keeping each recording as its own track segment, as Stella did, stops that.",
      },
      {
        q: "Can it convert GPX to another format?",
        a: "Yes: see [convert GPX to KML for Google Earth](/how/files-folders/convert-gpx-to-kml). CSV and other formats work the same way; ask in the same chat.",
      },
      {
        q: "What else can it tidy in a trip folder?",
        a: "Photos, for a start: [sort them into folders by date](/how/photos-files/sort-photos-into-folders-by-date) and [remove their location](/how/photos-files/remove-location-from-photos) before sharing.",
      },
    ],
    related: ["files-folders/convert-gpx-to-kml", "photos-files/sort-photos-into-folders-by-date", "photos-files/remove-location-from-photos"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "GPSBabel", href: "https://www.gpsbabel.org/" },
      { label: "gpx.studio", href: "https://gpx.studio/" },
    ],
  },
  {
    slug: "convert-gpx-to-kml",
    niche: "files-folders",
    searchPhrases: ["gpx to kml", "gpx to kml converter", "gpx to google earth", "gpx to google maps", "combine gpx files into one kml"],
    title: "Convert GPX to KML for Google Earth, one dated line per track",
    description:
      "Turn a folder of GPX tracks into one KML for Google Earth, each track its own line named by its date: Google Earth Pro, GPSBabel, or Stella (stella.sh).",
    h1: "Convert GPX to KML for Google Earth, one line per track",
    short: "Convert GPX to KML",
    lede: "Eight GPX tracks as one KML, each its own line, named by its date.",
    answer:
      "Google Earth Pro (free) opens GPX files itself: open each one, drag the tracks into one folder under Places, rename them, then right-click the folder and Save Place As KML. GPSBabel converts GPX to KML in one step, and converter sites do one file at a time. Stella (stella.sh) turns a whole folder into one KML on your computer, one line per track named by the date inside the file, and checks the data as it goes.",
    stellaSteps: [
      "Reads the 8 GPX files in Downloads/Rides, whose export-style names (`Morning_Ride_48213977.gpx`) don't say when they were recorded",
      "Takes each track's date from the times inside the file, whichever of two GPX layouts it uses",
      "Writes `Rides.kml` next to the folder: 8 separate lines in date order, each named like 2026-04-05, with every point kept",
      "Adds the original file name, distance and time to each line's pop-up, and timestamps so Google Earth's time slider can show them one by one",
      "Checks the numbers and flags something odd: the tracks average about 4.5 km/h, walking pace rather than cycling, and four were tagged as hiking by the recording device",
    ],
    prompt:
      "I have 8 bike rides as GPX files in the Rides folder in Downloads. Make one KML file I can open in Google Earth, with each ride as its own line named by its date.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "One KML in about 30 seconds. Checked afterwards against an answer key written before the run: 8 separate lines, one per track, each keeping all its points with coordinates in the right order, each labelled with its date, and the GPX files unchanged.",
      note: "The eight tracks are synthetic test files made for this run, generated at a walking pace, so Stella's remark that they don't look like bike rides is it checking the data and flagging an oddity, not a comment on anyone's real rides. The run isn't sped up; a long idle stretch after the answer is cut.",
      video: {
        src: `${PROOFS}/files-folders/convert-gpx-to-kml/proof.mp4`,
        cuts: webCuts("files-folders/convert-gpx-to-kml"),
        poster: `${PROOFS}/files-folders/convert-gpx-to-kml/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 44.8,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Eight GPX tracks with export-style names are in Downloads/Rides." },
        { at: 2, text: "The prompt: one KML for Google Earth, each ride its own line named by its date." },
        { at: 30.8, text: "Done: Rides.kml with 8 dated lines, plus a note that the speeds look like walking, not cycling." },
      ],
    },
    manualTitle: "Convert them yourself",
    manualSteps: [
      {
        title: "Install Google Earth Pro",
        body: "Google Earth Pro for Mac and Windows is free and reads GPX directly. The web version of Google Earth imports KML files but not a folder of GPX.",
      },
      {
        title: "Open each GPX",
        body: "Choose File, Open, set the file type to GPS, and pick a GPX. In the import box choose to create KML line strings for tracks. Repeat for each file.",
      },
      {
        title: "Gather and rename",
        body: "In the Places panel, right-click My Places, Add, Folder. Drag each imported track into it, then right-click each one, Properties, and give it the ride's date as its name.",
      },
      {
        title: "Save as one KML",
        body: "Right-click the folder, choose Save Place As, and pick KML (or KMZ, which is smaller). That single file opens anywhere Google Earth runs.",
      },
      {
        title: "Or use GPSBabel",
        body: "In [GPSBabel](https://www.gpsbabel.org/), add the GPX files as input, choose Google Earth (Keyhole) Markup Language as output, and convert. Track names come from the GPX files, so you may still need to rename them by date.",
      },
    ],
    limits: [
      "Google My Maps limits how much you can import per layer. For a big archive, Google Earth Pro or a KMZ works better.",
      "Stella kept full detail here. If you need a smaller file, ask and it simplifies the lines.",
      "It flagged that the tracks looked like walks but still made the file as asked. Check the remarks it adds; they come from the data, not from guesswork about you.",
      "What Stella reads while working, such as dates, distances and file names, goes to the AI model you use in Stella. The conversion runs on your computer.",
      "Recorded on Linux, where Stella used only Python, built in on Mac and Linux. On Windows it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What's the difference between GPX and KML?",
        a: "GPX is what GPS watches and apps record: points with times. KML is Google Earth's format for drawing lines, places and labels. Converting keeps the route and lets you style and name it.",
      },
      {
        q: "Can I open a GPX in Google Maps?",
        a: "Not directly. Google My Maps imports KML (and GPX via some routes), then shows it on a map you can share. Convert to KML first for the most reliable import.",
      },
      {
        q: "Can it go back from KML to GPX?",
        a: "Yes, ask for GPX. For several recordings of one trip, see [combine GPX files into one track](/how/files-folders/combine-gpx-files).",
      },
      {
        q: "Will it upload my tracks anywhere?",
        a: "No. The KML is written on your computer; opening it in Google Earth is up to you. Before sharing photos from the same trips, [remove their location](/how/photos-files/remove-location-from-photos).",
      },
    ],
    related: ["files-folders/combine-gpx-files", "photos-files/remove-location-from-photos", "files-folders/zip-file-too-large-to-email"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Google Earth Help: Import GPS data", href: "https://support.google.com/earth/answer/148095" },
      { label: "GPSBabel", href: "https://www.gpsbabel.org/" },
    ],
  },
  {
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
      "Compare an old and a new copy of a folder and copy across only what's missing, without overwriting anything: robocopy, rsync, or Stella (stella.sh) by file content.",
    h1: "Compare two folders and copy what's missing",
    short: "Compare two folders",
    lede: "Two copies of the family photos merged: 11 missing files copied in, nothing overwritten.",
    answer:
      "Free tools compare folders by file name: robocopy on Windows or rsync on a Mac copies files that aren't there yet without overwriting, and WinMerge shows the differences side by side. Names mislead, though: a photo renamed in one copy gets copied again, and two different photos with the same name get skipped. Stella (stella.sh) compares by what's inside the files, copies only what's truly missing into the matching subfolders, keeps both photos when names clash, and never overwrites.",
    stellaSteps: [
      "Compares Family photos in Pictures with the older copy in Documents by file content, not names",
      "Recognises six photos that were only renamed or moved in the newer copy, so they aren't copied twice",
      "Copies the 11 files only in the old copy into the matching subfolders, including a whole 2018 Wedding folder and a video",
      "Keeps both versions where two different photos share a name, adding “(old laptop)” to the older one's name",
      "Skips two Windows and Mac system files, leaves the old copy untouched and saves a list of what was added",
    ],
    prompt:
      "I have two copies of our family photos: the Family photos folder in my Pictures, and an older copy from my old laptop in my Documents called 'Family photos (old laptop)'. Compare them and copy anything that's only in the old copy into the Pictures one, so nothing gets lost. Don't overwrite anything.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "About a minute. Checked afterwards against an answer key written before the run: all 11 files only in the old copy now in the Pictures folder, in their matching subfolders, both same-name-but-different photos kept, every photo already there unchanged, renamed photos not copied again, no Thumbs.db copied, and the old copy untouched.",
      note: "The photos are made up for this run, in two folders laid out like an old and a new copy. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/files-folders/compare-two-folders/proof.mp4`,
        cuts: webCuts("files-folders/compare-two-folders"),
        poster: `${PROOFS}/files-folders/compare-two-folders/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 44.2,
        realDuration: 90,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Family photos in Pictures, and an older copy from an old laptop in Documents." },
        { at: 2, text: "The prompt: copy anything only in the old copy into Pictures, and don't overwrite anything." },
        { at: 14, text: "Stella replies: it will compare by what's in the files, so renamed photos don't count as new." },
        { at: 19.9, text: "Comparing the two folders, sped up 4×." },
        { at: 30.2, text: "Done: 11 files added, two name clashes kept side by side, 36 already there under other names." },
      ],
    },
    manualTitle: "Compare them yourself",
    manualSteps: [
      {
        title: "Back up first",
        body: "Before merging, copy the newer folder somewhere safe, or make sure it's in your backup. A wrong copy command can overwrite photos, and an overwritten file doesn't go to the Trash.",
      },
      {
        title: "Windows: robocopy",
        body: "In Command Prompt: `robocopy \"%USERPROFILE%\\Documents\\Family photos (old laptop)\" \"%USERPROFILE%\\Pictures\\Family photos\" /E /XC /XN /XO` copies files whose name isn't there yet, with subfolders, and skips any that exist. Add `/L` first to only list what it would do.",
      },
      {
        title: "Mac: rsync",
        body: "In Terminal: `rsync -av --ignore-existing ~/Documents/'Family photos (old laptop)'/ ~/Pictures/'Family photos'/`. Add `-n` to try it without copying. It also matches by name, so renamed photos come across again.",
      },
      {
        title: "Or see the differences side by side",
        body: "WinMerge (free, Windows) compares two folders and shows files only on the left, only on the right, or different. Filter to left-only and copy those across. Turn on content comparison to catch same-name files that differ.",
      },
      {
        title: "Check the same-name files",
        body: "Name-based tools skip a file that exists in both places even if the photos are different. Look at those by eye and copy any different ones across with a new name.",
      },
    ],
    limits: [
      "It copies one way, as asked. Two-way syncing, where deletions are mirrored too, is a different job; say so if that's what you want.",
      "A photo that was edited in one copy (rotated, cropped) counts as different, so both versions are kept.",
      "File names and folder structure go to the AI model you use in Stella; the photos themselves are compared on your computer.",
      "Recorded on Linux, where Stella used Python, built in on Mac and Linux. On Windows it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I compare two folders on Windows 11?",
        a: "Windows has no built-in folder compare. Use robocopy with `/L` to list differences without copying, or the free WinMerge to see them side by side.",
      },
      {
        q: "How do I compare two folders on a Mac?",
        a: "`diff -rq folder1 folder2` in Terminal lists files only in one or different in both. Apple's FileMerge does it with windows but comes with Xcode.",
      },
      {
        q: "Will it delete the old copy?",
        a: "No. It copies and leaves the old copy alone, and says when it looks safe to delete. For duplicates within one folder, see [find duplicate photos](/how/photos-files/find-duplicate-photos).",
      },
      {
        q: "Can it put everything from many subfolders into one?",
        a: "Yes: see [move files from subfolders into one folder](/how/files-folders/move-files-from-subfolders-into-one-folder).",
      },
    ],
    related: [
      "photos-files/find-duplicate-photos",
      "files-folders/move-files-from-subfolders-into-one-folder",
      "photos-files/sort-photos-into-folders-by-date",
    ],
    lastChecked: "2026-11-14",
    sources: [
      {
        label: "Microsoft Learn: robocopy",
        href: "https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/robocopy",
      },
      { label: "WinMerge (free folder and file compare)", href: "https://winmerge.org/" },
    ],
  },
];
