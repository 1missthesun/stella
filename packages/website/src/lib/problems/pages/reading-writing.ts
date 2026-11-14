import { PROOFS, webCuts } from "../media";
import type { ProblemPage } from "../types";

const MODEL = "Claude Code with Opus, on a Claude plan";

export const READING_WRITING_PAGES: ProblemPage[] = [
  {
    slug: "convert-pdf-to-epub",
    niche: "reading-writing",
    searchPhrases: ["pdf to epub", "convert pdf to epub", "calibre convert pdf to epub", "pdf to kindle", "pdf to epub without page numbers"],
    title: "Convert a PDF to EPUB that reads properly on an e-reader",
    description:
      "Turn a novel PDF into a reflowable EPUB with real chapters, no page numbers or running heads in the text: with the free Calibre, or Stella (stella.sh).",
    h1: "Convert a PDF to an EPUB that reads properly",
    short: "PDF to EPUB",
    lede: "A 20-page novel PDF as a reflowable ebook with 8 chapters, no stray page numbers.",
    answer:
      "Open the PDF in the free Calibre, fix the title and author, then Convert books with EPUB as the output and turn on header and footer removal, or the book's page numbers and running heads end up mid-sentence. Check the result in Calibre's viewer before copying it to your e-reader. Stella (stella.sh) does the conversion on your computer: it strips page furniture, rejoins split words, builds a chapter list and checks the file with the standard EPUB validator.",
    stellaSteps: [
      "Finds `The Lantern Keeper's Daughter - Wren Alder.pdf` in Downloads and reads its text and layout, noticing the file's title is the leftover `Microsoft Word - LKD_final_v3.docx`",
      "Looks at a few page images to see where the running heads, page numbers and chapter openings sit",
      "Writes a small converter of its own that drops the heads and page numbers, joins words split across lines and starts a new section at each chapter",
      "Builds the EPUB with the real title and author, a contents page for all 8 chapters, and the PDF's title page as the cover",
      "Downloads the W3C's EPUBCheck validator (and a Java runtime to run it) into a work folder, checks the book passes with no errors, and previews chapters in a browser",
      "Saves the EPUB next to the PDF, which it leaves untouched",
    ],
    prompt: "Convert the novel PDF in my Downloads to an EPUB so it reads properly on my e-reader.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "An EPUB in about 4 minutes. Checked afterwards against an answer key written before the run: a valid, reflowable EPUB (text, not page pictures) titled The Lantern Keeper's Daughter by Wren Alder, a contents list of all 8 chapters in order, every sampled sentence intact, no running heads or page numbers left in the text, words split at line ends joined back up, and the PDF unchanged.",
      note: "The novel is made up and was typeset for this run with running heads, page numbers and hyphenation on purpose. The work is sped up 15×.",
      video: {
        src: `${PROOFS}/reading-writing/convert-pdf-to-epub/proof.mp4`,
        cuts: webCuts("reading-writing/convert-pdf-to-epub"),
        poster: `${PROOFS}/reading-writing/convert-pdf-to-epub/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 50.0,
        speed: 15,
        realDuration: 236,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A novel PDF is in Downloads." },
        { at: 2, text: "The prompt: convert it to an EPUB that reads properly on an e-reader." },
        { at: 17.3, text: "Stella replies: a reflowable EPUB with chapters, a contents list and a cover, saved next to the PDF." },
        { at: 23, text: "Converting and validating the book, sped up 15×." },
        { at: 35.9, text: "Done: all eight chapters in the contents, page numbers and headers gone, split words rejoined, no validator errors." },
      ],
    },
    manualTitle: "Convert it yourself with Calibre",
    manualSteps: [
      {
        title: "Add the PDF to Calibre",
        body: "Install the free Calibre from [calibre-ebook.com](https://calibre-ebook.com/download) and drag the PDF into its window. If the title column shows something like “Microsoft Word - final.docx”, double-click the book and type the real title and author.",
      },
      {
        title: "Remove the page furniture",
        body: "Click Convert books and set the output format to EPUB. Under Search & replace, add a regular expression that matches the running head line (the book or author name) and one that matches lone page numbers, so they don't land in the middle of sentences.",
      },
      {
        title: "Mark the chapters",
        body: "Under Structure detection, set the chapter expression to match lines that start with “Chapter”. That gives the e-reader a table of contents you can tap through.",
      },
      {
        title: "Check it in the viewer",
        body: "Open the new EPUB in Calibre's viewer and page through two or three chapters. Look for numbers or headers inside paragraphs and for words broken with a hyphen. Fix the expressions and convert again if needed.",
      },
      {
        title: "Copy it to the reader",
        body: "Connect the e-reader and use Send to device, or copy the file across. Kindles take EPUB through Amazon's Send to Kindle, which converts it on their side.",
      },
    ],
    limits: [
      "This works for PDFs with real text. A scanned book (pictures of pages) needs text recognition first, which is slower and introduces typos.",
      "Pictures, footnotes, tables and two-column layouts don't reflow as cleanly as plain novel text. Check those pages yourself.",
      "The book's text goes to the AI model you use in Stella while it works out the layout, along with a few page images. The EPUB is built on your computer.",
      "Recorded on Linux, where PDF text tools were already installed. On a Mac or Windows PC Stella may install a PDF library or Calibre first, which wasn't recorded. It also fetched a Java runtime and the EPUBCheck validator, about 200 MB, into its work folder.",
      "Stella won't convert DRM-protected store books.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why does my converted EPUB have page numbers in the middle of sentences?",
        a: "The converter copied the PDF's page headers and numbers into the text. Calibre can remove them with header and footer expressions; Stella removes them by recognising the repeated lines on every page.",
      },
      {
        q: "Can I put the EPUB on a Kindle?",
        a: "Yes. Send it with Amazon's Send to Kindle (app, web page or email), which accepts EPUB and converts it for the Kindle.",
      },
      {
        q: "Should I convert a PDF to EPUB or just read the PDF?",
        a: "Read the PDF if it's a comic, a manual with diagrams or anything laid out page by page. Novels and plain text read far better as EPUB on a small screen, because the text reflows to your font size.",
      },
      {
        q: "Can it go the other way?",
        a: "Yes: see [convert EPUB to PDF](/how/pdf-excel/convert-epub-to-pdf). For old Kindle files, see [convert MOBI to EPUB](/how/pdf-excel/convert-mobi-to-epub).",
      },
    ],
    related: ["pdf-excel/convert-epub-to-pdf", "pdf-excel/convert-mobi-to-epub", "reading-writing/convert-word-to-epub", "pdf-excel/make-scanned-pdf-searchable"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "calibre manual: Ebook conversion (PDF input)", href: "https://manual.calibre-ebook.com/conversion.html" },
      { label: "W3C EPUBCheck", href: "https://www.w3.org/publishing/epubcheck/" },
    ],
  },
  {
    slug: "convert-markdown-to-pdf",
    niche: "reading-writing",
    searchPhrases: ["markdown to pdf", "md to pdf", "convert markdown to pdf", "markdown to pdf with images", "markdown to pdf vscode"],
    title: "Convert Markdown to PDF: neat pages with tables and images",
    description:
      "Turn .md notes into tidy PDFs with real headings, tables, code and pictures, no ## or ** left: VS Code or a browser preview, or Stella (stella.sh) on a whole folder.",
    h1: "Convert Markdown to PDF, nicely formatted",
    short: "Markdown to PDF",
    lede: "Three Markdown notes as clean PDFs, tables, code, tick boxes and the map included.",
    answer:
      "Open the note in VS Code, install the free Markdown PDF extension and run its Export (pdf) command, or open any Markdown preview and print it to PDF. Run it on the note in its own folder so linked pictures are found. Stella (stella.sh) turns every note in a folder into a styled PDF on your computer, checks each page and keeps pictures from splitting awkwardly across pages.",
    stellaSteps: [
      "Finds the three notes in `Documents/Notes` and the trip note's map picture in its `images` folder",
      "Installs a small Markdown library into a work folder and writes a converter that lays each note out as a styled page",
      "Prints each page to PDF with the browser already on the computer, so tables, code blocks, links and tick boxes come out properly",
      "Renders every page to an image to check it, then adjusts how the tick boxes look and keeps the map and its caption together on page 2 of the trip note",
      "Saves each PDF next to its note under the same name and leaves the notes unchanged",
    ],
    prompt: "Turn the Markdown notes in my Documents into nicely formatted PDFs.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "Three PDFs in under 2 minutes. Checked afterwards against an answer key written before the run: one PDF per note with all the text there, no Markdown symbols left, headings larger than body text, bold and italic in bold and italic fonts, tables laid out in rows and columns, the map picture embedded, the link clickable, code in a monospace font, and the notes unchanged.",
      note: "The notes were written for this run. The trip note runs to 2 pages because Stella moved the map to the top of page 2 rather than split it. The work is sped up 7×.",
      video: {
        src: `${PROOFS}/reading-writing/convert-markdown-to-pdf/proof.mp4`,
        cuts: webCuts("reading-writing/convert-markdown-to-pdf"),
        poster: `${PROOFS}/reading-writing/convert-markdown-to-pdf/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 49.2,
        speed: 7,
        realDuration: 135,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Three Markdown notes are in Documents/Notes." },
        { at: 2, text: "The prompt: turn them into nicely formatted PDFs." },
        { at: 17.6, text: "Stella replies each PDF will sit next to its note, which won't be touched." },
        { at: 23.4, text: "Converting and checking every page, sped up 7×." },
        { at: 35.2, text: "Done: tables, checklists, code and links come out right, and the map starts page 2 of the trip note with its caption." },
      ],
    },
    manualTitle: "Convert them yourself",
    manualSteps: [
      {
        title: "In VS Code",
        body: "Install the free [VS Code](https://code.visualstudio.com/docs/languages/markdown), open the notes folder, and add the Markdown PDF extension from the Extensions panel. Open a note, press Ctrl+Shift+P (Cmd+Shift+P on a Mac) and run Markdown PDF: Export (pdf). The PDF lands next to the note.",
      },
      {
        title: "Or print a preview",
        body: "Any Markdown preview can be printed: in VS Code press Ctrl+Shift+V (Cmd+Shift+V) to preview, or open the note in an app such as Typora or Obsidian, then print and choose Save as PDF. Turn on background graphics so table shading and code backgrounds print.",
      },
      {
        title: "Or use pandoc",
        body: "With [pandoc](https://pandoc.org/MANUAL.html) installed, `pandoc note.md -o note.pdf` makes a PDF, but it needs a LaTeX engine as well. A lighter route is `pandoc note.md -o note.html` and printing the HTML from a browser.",
      },
      {
        title: "Check the pages",
        body: "Look for tables cut off at the right edge, pictures split across pages and code lines running off the page. Landscape pages or a smaller font fix wide tables.",
      },
    ],
    limits: [
      "Very wide tables may wrap or need landscape pages on a portrait PDF.",
      "The PDF follows Stella's own clean styling. Ask for a font, page size or margins you prefer and it redoes them.",
      "The notes' text goes to the AI model you use in Stella while it converts them, along with page images it checks. The PDFs are made on your computer.",
      "Recorded on Linux, where a browser for printing was already installed. Stella added a small Markdown library to its own work folder. On a Mac or Windows PC it would use the browser you have, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why are my images missing from the PDF?",
        a: "Markdown links pictures by path, such as `images/map.png`. If the converter runs from another folder, it can't find them. Convert from the note's own folder.",
      },
      {
        q: "Can I convert a whole folder of notes at once?",
        a: "With pandoc you run one command per note (or a loop). Stella converts every note it finds in the folder in one go.",
      },
      {
        q: "Do tick-box lists work in a PDF?",
        a: "They print as ticked and empty boxes; they aren't clickable in the PDF.",
      },
      {
        q: "I need a Word file instead.",
        a: "See [convert Markdown to Word](/how/reading-writing/convert-markdown-to-word). To number the pages of a long note, see [add page numbers to a PDF](/how/pdf-excel/add-page-numbers-to-pdf).",
      },
    ],
    related: ["reading-writing/convert-markdown-to-word", "pdf-excel/add-page-numbers-to-pdf", "documents/convert-word-documents-to-pdf-in-bulk", "pdf-excel/compress-pdf-too-large-to-email"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "VS Code: Markdown", href: "https://code.visualstudio.com/docs/languages/markdown" },
      { label: "pandoc User's Guide", href: "https://pandoc.org/MANUAL.html" },
    ],
  },
  {
    slug: "convert-word-to-epub",
    niche: "reading-writing",
    searchPhrases: ["convert word to epub", "docx to epub", "word to epub for kindle", "word to epub with cover", "word to kindle"],
    title: "Convert a Word document to EPUB with a cover and contents",
    description:
      "Turn your manuscript in Word into an EPUB ebook with your cover and every chapter in the table of contents, even unstyled ones: Calibre, or Stella (stella.sh).",
    h1: "Convert a Word document to EPUB, cover and contents included",
    short: "Word to EPUB",
    lede: "A 10-chapter novel in Word as an ebook with its cover and every chapter listed.",
    answer:
      "Give every chapter title Word's Heading 1 style first, because converters build the table of contents from headings and skip chapters typed as plain bold text. Then add the .docx to the free Calibre, set the title, author and cover image under Edit metadata, and convert to EPUB. Stella (stella.sh) does it on your computer and catches chapters that aren't styled as headings, without changing your Word file.",
    stellaSteps: [
      "Finds `Saltwater Hymns - final.docx` and `cover.jpg` in Documents",
      "Unpacks the Word file and notices chapters 9 and 10 are bold text, not Heading 1 like chapters 1–8, and that the file's author field just says “Writer”",
      "Writes its own EPUB builder that treats all 10 chapter lines as chapters and keeps the italics, scene breaks, title page and dedication",
      "Sets cover.jpg as the book's cover and takes the title and author, Juniper Vale, from the title page",
      "Downloads the W3C's EPUBCheck validator and runs it (no errors), then screenshots the cover, contents and chapter 9 to check them",
      "Saves `Saltwater Hymns.epub` next to the Word file and tells you which two headings to fix in Word if you export it elsewhere",
    ],
    prompt:
      "Turn my novel in Documents into an EPUB ebook with a table of contents, and use the cover picture that's next to it as the cover.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "An EPUB in about 2½ minutes. Checked afterwards against an answer key written before the run: a valid EPUB titled Saltwater Hymns by Juniper Vale, with cover.jpg as its cover, a table of contents listing all 10 chapters in order (including the two that are only bold text in Word), every chapter's text present, italics kept, and the Word file and cover unchanged.",
      note: "The novel and cover were made for this run, with two chapter titles left unstyled on purpose. The work is sped up 9×.",
      video: {
        src: `${PROOFS}/reading-writing/convert-word-to-epub/proof.mp4`,
        cuts: webCuts("reading-writing/convert-word-to-epub"),
        poster: `${PROOFS}/reading-writing/convert-word-to-epub/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 45.4,
        speed: 9,
        realDuration: 156,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A novel in Word and its cover picture are in Documents." },
        { at: 2, text: "The prompt: an EPUB with a table of contents, using the cover picture." },
        { at: 13.2, text: "Stella replies that it has started the ebook." },
        { at: 19, text: "Building and validating the EPUB, sped up 9×." },
        { at: 31.4, text: "Done: cover set, all 10 chapters in the contents, and a note that chapters 9 and 10 aren't headings in the Word file." },
      ],
    },
    manualTitle: "Convert it yourself",
    manualSteps: [
      {
        title: "Style every chapter title as Heading 1",
        body: "In Word, click each chapter title and choose Heading 1 on the Home tab. Open View, Navigation Pane: every chapter should be listed there. Any that's missing will be missing from the ebook's contents too.",
      },
      {
        title: "Add the file to Calibre",
        body: "Install the free [Calibre](https://calibre-ebook.com/download) and drag the .docx into it. Double-click the book to edit its metadata: type the title and author, and click Browse next to the cover to pick your cover image.",
      },
      {
        title: "Convert to EPUB",
        body: "Click Convert books and set the output format to EPUB. If you couldn't fix the styles, open Structure detection and set the chapter expression to match lines starting with “Chapter”. Click OK and wait for the Jobs counter to finish.",
      },
      {
        title: "Check the contents and cover",
        body: "Open the EPUB in Calibre's viewer. Check the table of contents lists every chapter, the cover shows in the library, and italics and scene breaks survived. Copy it to your reader or send it to a Kindle with Send to Kindle.",
      },
    ],
    limits: [
      "Text boxes, columns, tracked changes and complicated tables don't carry over well to an ebook, which has no fixed pages.",
      "Stella built the book's code itself rather than using Calibre. It passed the standard validator, but check it on your own reader before publishing.",
      "It doesn't add an ISBN, publisher or publication date unless you give them; it offered to.",
      "The manuscript's text goes to the AI model you use in Stella while it builds the book. The EPUB is written on your computer.",
      "Recorded on Linux, using Python (built in on Mac and Linux). On Windows Stella may install Python first. To validate the book it downloaded EPUBCheck, which needs Java, into its work folder.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why are some chapters missing from my EPUB's table of contents?",
        a: "They aren't styled as headings in Word. A bold, large line looks like a heading to you but not to a converter. Apply Heading 1, or ask Stella, which spots chapter lines without styles.",
      },
      {
        q: "Can I upload the EPUB to Kindle Direct Publishing?",
        a: "KDP accepts EPUB and Word files. Check the result in Kindle Previewer before publishing, and add your ISBN and publisher details if you have them.",
      },
      {
        q: "Does the cover need a particular size?",
        a: "A tall picture around 1600×2560 pixels suits most stores and readers. The test cover was 800×1280, which displays fine on e-readers.",
      },
      {
        q: "What if the book is a PDF, not a Word file?",
        a: "See [convert PDF to EPUB](/how/reading-writing/convert-pdf-to-epub), which also removes page numbers and running heads.",
      },
    ],
    related: ["reading-writing/convert-pdf-to-epub", "reading-writing/merge-epub-files", "pdf-excel/convert-mobi-to-epub", "documents/merge-word-documents"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "calibre manual: Ebook conversion", href: "https://manual.calibre-ebook.com/conversion.html" },
      { label: "calibre download", href: "https://calibre-ebook.com/download" },
    ],
  },
  {
    slug: "merge-epub-files",
    niche: "reading-writing",
    searchPhrases: ["merge epub files", "merge epub", "combine epub files", "combine ebooks into one", "epubmerge"],
    title: "Merge EPUB files into one book, in the right reading order",
    description:
      "Combine a series of EPUB books into one ebook with every chapter in reading order and each book's pictures kept: Calibre's EpubMerge, or Stella (stella.sh).",
    h1: "Merge EPUB files into one book in reading order",
    short: "Merge EPUB files",
    lede: "Three books of a series as one ebook, in reading order, every map kept.",
    answer:
      "Install the free Calibre and its EpubMerge plugin, add the books, select them, click EpubMerge and drag them into reading order before merging. File names are often a poor guide to order, so check the series number or title page. Stella (stella.sh) works out the order from inside the books and merges them on your computer, keeping each book's images even when they share a file name.",
    stellaSteps: [
      "Finds the three Saltmarsh Chronicles EPUBs in Downloads, whose file names (`first-tide.epub`, `Book 2 - The Turning Tide.epub`, `saltmarsh-chronicles-3.epub`) sort in the wrong order",
      "Unpacks each and confirms the order three ways: the series number saved in each book, the “Book One/Two/Three” title pages and the reading-order note beside them",
      "Notices each book has its own map saved under the same file name, and keeps all three by giving each book its own folder inside the merged file",
      "Builds one EPUB with a contents list that nests each book's chapters under its title",
      "Runs the W3C's EPUBCheck validator on the result (no problems) and saves `The Saltmarsh Chronicles (Books 1-3).epub` in Downloads, leaving the three originals as they were",
    ],
    prompt: "Combine the three Saltmarsh Chronicles books in my Downloads into one EPUB, in the right reading order.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "One EPUB in under 2 minutes. Checked afterwards against an answer key written before the run: a sound EPUB package holding all 15 chapters in reading order (Book One, Two, Three), all three different maps kept, a contents list with every chapter and the book titles, and the three original files unchanged.",
      note: "The three books are made up and were built for this run, with misleading file names and same-named map images on purpose. The work is sped up 5×.",
      video: {
        src: `${PROOFS}/reading-writing/merge-epub-files/proof.mp4`,
        cuts: webCuts("reading-writing/merge-epub-files"),
        poster: `${PROOFS}/reading-writing/merge-epub-files/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 43.5,
        speed: 5,
        realDuration: 107,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Three books of a series are in Downloads, with file names that sort out of order." },
        { at: 2, text: "The prompt: combine them into one EPUB in the right reading order." },
        { at: 11.2, text: "Stella replies it will work out the order from the books themselves, not the file names." },
        { at: 17, text: "Merging and validating, sped up 5×." },
        { at: 29.5, text: "Done: one EPUB in series order, each book's chapters under its title, every map and style kept." },
      ],
    },
    manualTitle: "Merge them yourself",
    manualSteps: [
      {
        title: "Install Calibre and EpubMerge",
        body: "Install the free [Calibre](https://calibre-ebook.com/download). Open Preferences, Plugins, Get new plugins, search for EpubMerge, install it and restart Calibre.",
      },
      {
        title: "Work out the reading order",
        body: "Add the books and open each one's details or first pages. The series number (Calibre shows it in the Series column) or the title page tells you the order; file names often don't.",
      },
      {
        title: "Merge",
        body: "Select the books, click the EpubMerge button, and drag them into reading order in its window. Give the new book a title such as the series name, then click OK. The merged book appears in your library.",
      },
      {
        title: "Check the result",
        body: "Open it in Calibre's viewer, check the contents list starts with book one, and look at a picture or map from each book to make sure the right one shows in each.",
      },
    ],
    limits: [
      "Only DRM-free books can be merged. Most books bought from big ebook stores are locked to your account and Stella won't remove that.",
      "A merged file is for your own reading. Sharing it is still sharing the books.",
      "Stella reads the books' titles, metadata and chapter openings through the AI model you use to work out the order. The merging runs on your computer.",
      "Recorded on Linux, using Python (built in on Mac and Linux). On Windows Stella may install Python first. It used a Java runtime and the EPUBCheck validator to check the result.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why is one picture repeated in my merged ebook?",
        a: "The books stored their pictures under the same file name, and the merge kept only one. A careful merge gives each book its own folder, which is what Stella did here.",
      },
      {
        q: "Can I merge EPUBs on a phone?",
        a: "Not easily. Do it on a computer, then copy the merged book to the phone or e-reader.",
      },
      {
        q: "Can I split a big EPUB back into books?",
        a: "Calibre's EpubSplit plugin does that, and Stella can too: ask for one file per book.",
      },
      {
        q: "Can it turn the merged book into a PDF?",
        a: "Yes: see [convert EPUB to PDF](/how/pdf-excel/convert-epub-to-pdf).",
      },
    ],
    related: ["reading-writing/convert-word-to-epub", "pdf-excel/convert-epub-to-pdf", "pdf-excel/convert-mobi-to-epub", "audio/make-audiobook-with-chapters"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "MobileRead forums: EpubMerge plugin", href: "https://www.mobileread.com/forums/showthread.php?t=169744" },
      { label: "calibre download", href: "https://calibre-ebook.com/download" },
    ],
  },
  {
    slug: "convert-cbr-to-pdf",
    niche: "reading-writing",
    searchPhrases: ["cbr to pdf", "cbz to pdf", "convert cbr to pdf", "convert comic book files to pdf", "open cbr file"],
    title: "Convert CBR and CBZ comics to PDF, pages in the right order",
    description:
      "Turn .cbr and .cbz comic files into PDFs for a tablet, with pages in true order, no junk pages and full image quality: Calibre or 7-Zip, or Stella (stella.sh).",
    h1: "Convert CBR and CBZ comics to PDF",
    short: "CBR and CBZ to PDF",
    lede: "Two comic files as PDFs, every page in order and the double-page spread kept whole.",
    answer:
      "A .cbz is a zip of page images and a .cbr is a RAR of them. The free Calibre converts both to PDF (Add books, Convert books, output PDF), or you can open the archive with 7-Zip and print the pages to PDF. Watch for page 10 sorting before page 2 and for junk files becoming pages. Stella (stella.sh) does both comics on your computer, in true page order, without shrinking the pictures.",
    stellaSteps: [
      "Finds `Moth & Lantern 001 (2026).cbz` and `Moth & Lantern 002 (2026).cbr` in Downloads and opens both with the archive tool already on the computer, which reads RAR",
      "Sorts issue 1's pages by their number (p1, p2 … p10, not p1, p10, p2) and leaves out the `__MACOSX` and `Thumbs.db` leftovers",
      "Looks at a contact sheet of each comic's pages to check the order, and finds the double-page spread and a scanner's credit page in issue 2",
      "Places each original page picture into the PDF as it is, without re-compressing it, and keeps the spread as one wide page",
      "Checks both PDFs open cleanly and saves them in Downloads next to the comics, which it leaves untouched; it left out the credit page and offered to put it back",
    ],
    prompt: "Convert the two comic files in my Downloads to PDFs so I can read them on my tablet.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "Two PDFs in about a minute and a half. Checked afterwards against an answer key written before the run: one PDF per comic, issue 1's 14 pages and issue 2's cover and 11 pages in true reading order with no junk pages, the double-page spread kept as one wide page, every page at full resolution, and the comic files unchanged.",
      note: "The two comics were drawn for this run, one as a zip-based .cbz and one as a real RAR-based .cbr, with junk files and misleading page names on purpose. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/reading-writing/convert-cbr-to-pdf/proof.mp4`,
        cuts: webCuts("reading-writing/convert-cbr-to-pdf"),
        poster: `${PROOFS}/reading-writing/convert-cbr-to-pdf/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 48.9,
        speed: 4,
        realDuration: 92,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A .cbz and a .cbr comic are in Downloads." },
        { at: 2, text: "The prompt: convert both to PDFs for a tablet." },
        { at: 17.5, text: "Stella replies the PDFs will go next to the originals, which won't be touched." },
        { at: 23.5, text: "Unpacking, checking page order and building the PDFs, sped up 4×." },
        { at: 34.9, text: "Done: 14 and 12 pages, the spread kept as one wide page, junk and the scanner's credit page left out." },
      ],
    },
    manualTitle: "Convert them yourself",
    manualSteps: [
      {
        title: "With Calibre (both formats)",
        body: "Install the free [Calibre](https://calibre-ebook.com/download), drag the .cbr or .cbz in, click Convert books and set the output format to PDF. Flip through the result: Calibre's comic input settings control image size and whether spreads are split.",
      },
      {
        title: "Or unpack the pages",
        body: "A .cbz is a zip: rename it to .zip and open it. A .cbr is a RAR: on Windows open it with the free [7-Zip](https://www.7-zip.org/), on a Mac with a free unarchiver app. Extract the pages to a folder.",
      },
      {
        title: "Put the pages in order",
        body: "Sort the folder by name and check page 10 comes after page 9, not after page 1. If it doesn't, rename the early pages with a leading zero (p01, p02). Delete anything that isn't a page: `__MACOSX` folders, `Thumbs.db`, scanner credit images.",
      },
      {
        title: "Make the PDF",
        body: "On a Mac, select the pages in Finder, open them in Preview, select all thumbnails and choose File, Print, Save as PDF. On Windows, select the images, right-click, Print, choose Microsoft Print to PDF and untick “Fit picture to frame” so pages aren't cropped.",
      },
    ],
    limits: [
      "Comics bought from stores with DRM can't be converted. These were DRM-free files.",
      "The PDF is only as sharp as the scans inside the comic file; Stella keeps them at full quality but can't add detail.",
      "Thumbnails of the pages go to the AI model you use in Stella so it can check the order. The PDFs are built on your computer.",
      "Recorded on Linux, where a tool that opens RAR files was already installed. On a Mac or Windows PC Stella may install one first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What's the difference between CBR and CBZ?",
        a: "Only the packaging: CBZ is a zip of images, CBR is a RAR of images. Both hold the pages as ordinary JPG or PNG pictures.",
      },
      {
        q: "Why are my comic's pages out of order in the PDF?",
        a: "The converter sorted the file names as text, so page 10 came before page 2. Number pages with leading zeros, or use a tool that sorts by number.",
      },
      {
        q: "Should I keep the comic as CBZ instead?",
        a: "If your tablet has a comic reader app, CBZ works fine and pages turn faster. PDF is better when you want any PDF reader to open it.",
      },
      {
        q: "Can Stella open other RAR files too?",
        a: "Yes: see [open a RAR file](/how/files-folders/open-rar-file). For page pictures from a PDF, see [convert PDF to JPG](/how/pdf-excel/convert-pdf-to-jpg).",
      },
    ],
    related: ["files-folders/open-rar-file", "pdf-excel/convert-epub-to-pdf", "photos-files/combine-photos-into-one-pdf", "reading-writing/convert-pdf-to-epub"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "calibre download", href: "https://calibre-ebook.com/download" },
      { label: "7-Zip", href: "https://www.7-zip.org/" },
    ],
  },
  {
    slug: "convert-markdown-to-word",
    niche: "reading-writing",
    searchPhrases: ["markdown to word", "convert markdown to word", "md to docx", "markdown to docx", "markdown table to word"],
    title: "Convert Markdown to Word with headings, tables and images",
    description:
      "Turn .md notes into Word documents with real headings, lists, tables and pictures, no ## or ** left in the text: pandoc, or Stella (stella.sh) on a whole folder.",
    h1: "Convert Markdown to Word documents",
    short: "Markdown to Word",
    lede: "Three Markdown notes as Word files with real headings, lists, tables and the map.",
    answer:
      "The free pandoc converts a note with one command, `pandoc note.md -o note.docx`, run from the note's folder so its pictures are found. Headings become Word heading styles, lists real lists and tables Word tables. Pasting Markdown into Word leaves the ## and ** symbols in. Stella (stella.sh) converts every note in a folder on your computer, pictures included, without you opening a terminal.",
    stellaSteps: [
      "Finds the three notes in `Documents/Notes`, including the trip note's map picture in an `images` folder",
      "Reads each note: three heading levels, bold and italic, nested and numbered lists, two tables, a quote, tick boxes, code and a link",
      "Writes a converter on top of Stella's built-in Office document tool, so headings use Word's own Heading styles and lists and tables are the real thing",
      "Renders each new document to a page image to check how it looks",
      "Saves each .docx next to its note under the same name, checking nothing would be overwritten, and leaves the notes unchanged",
    ],
    prompt: "Convert the Markdown notes in my Documents to Word documents.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "Three Word documents in about 5 minutes. Checked afterwards against an answer key written before the run: one .docx per note, headings in Word heading styles at the right levels, no Markdown symbols left, bold and italic kept, bullet and numbered lists as real Word lists, tables as Word tables with the right cells, the map picture embedded, the link clickable, code in a monospace font, and the notes unchanged.",
      note: "The notes were written for this run. Stella spent most of the 5 minutes building and checking its converter; the recording is sped up 22×.",
      video: {
        src: `${PROOFS}/reading-writing/convert-markdown-to-word/proof.mp4`,
        cuts: webCuts("reading-writing/convert-markdown-to-word"),
        poster: `${PROOFS}/reading-writing/convert-markdown-to-word/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 47.7,
        speed: 22,
        realDuration: 316,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Three Markdown notes are in Documents/Notes." },
        { at: 2, text: "The prompt: convert them to Word documents." },
        { at: 15.2, text: "Stella replies each Word file will sit next to its note, and the notes stay as they are." },
        { at: 21.1, text: "Converting and checking the documents, sped up 22×." },
        { at: 33.8, text: "Done: headings, lists, links, tables, code and the map came across; tick boxes became printed symbols." },
      ],
    },
    manualTitle: "Convert them yourself with pandoc",
    manualSteps: [
      {
        title: "Install pandoc",
        body: "Download the installer from [pandoc.org](https://pandoc.org/installing.html): the .msi on Windows, the .pkg on a Mac. It's free and runs from the command line.",
      },
      {
        title: "Open a terminal in the notes folder",
        body: "On Windows, open the folder in File Explorer, right-click an empty space and choose Open in Terminal. On a Mac, right-click the folder in Finder and choose New Terminal at Folder (turn it on under Services if it's missing).",
      },
      {
        title: "Convert each note",
        body: "Run `pandoc \"Book club - March.md\" -o \"Book club - March.docx\"` for each note. Running it from the note's own folder lets pandoc find pictures linked with relative paths like `images/map.png`.",
      },
      {
        title: "Match your own styles (optional)",
        body: "Make a Word file with the fonts and heading styles you want and add `--reference-doc=mystyle.docx` to the command. Every converted note then uses those styles.",
      },
      {
        title: "Check the result",
        body: "Open each document and look at tables, nested lists and pictures. Tick-box lists become ☐ and ☒ symbols, because Word has no Markdown-style checklist.",
      },
    ],
    limits: [
      "Word has no checklist like Markdown's `- [ ]`. Stella's documents show ☒ and ☐ symbols you can't click.",
      "The documents use Calibri, with Consolas for code. Previews on a computer without those fonts look slightly off; in Word they look normal.",
      "The notes' text goes to the AI model you use in Stella while it converts them. The documents are written on your computer.",
      "Recorded on Linux. Stella used its own built-in Office tool, which works the same on Mac and Windows, and checked the pages with LibreOffice, which was already on the test computer.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can I paste Markdown into Word?",
        a: "Word doesn't convert it: you get the ## and ** symbols as text. Some apps can copy Markdown as formatted text, but tables and pictures rarely survive.",
      },
      {
        q: "Will my Markdown tables become Word tables?",
        a: "Yes, with pandoc or Stella. Each row and cell carries over; very wide tables may need landscape pages afterwards.",
      },
      {
        q: "Can I convert Obsidian notes?",
        a: "Yes. Standard Markdown converts directly. Obsidian's `[[wiki links]]` and embeds aren't standard, so tell Stella to turn them into plain links or text.",
      },
      {
        q: "What about Word to Markdown, or an ebook?",
        a: "pandoc and Stella go the other way too. For an ebook, see [convert Word to EPUB](/how/reading-writing/convert-word-to-epub). For many Word files to PDF, see [convert Word documents to PDF in bulk](/how/documents/convert-word-documents-to-pdf-in-bulk).",
      },
    ],
    related: ["documents/convert-word-documents-to-pdf-in-bulk", "documents/merge-word-documents", "reading-writing/convert-word-to-epub", "documents/convert-pdf-to-word"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "pandoc: Installing", href: "https://pandoc.org/installing.html" },
      { label: "pandoc User's Guide", href: "https://pandoc.org/MANUAL.html" },
    ],
  },
  {
    slug: "format-a-manuscript",
    niche: "reading-writing",
    searchPhrases: ["standard manuscript format", "manuscript format", "novel manuscript format", "shunn manuscript format", "format manuscript for literary agents"],
    title: "Put a novel in standard manuscript format in Word",
    description:
      "Reformat a novel for literary agents: 12 pt Times, double spacing, half-inch indents, a name/title/page header, chapters on new pages. In Word, or Stella (stella.sh).",
    h1: "Put your novel in standard manuscript format",
    short: "Standard manuscript format",
    lede: "A messy draft reformatted for submission as a new Word file, every word unchanged.",
    answer:
      "Standard manuscript format is 12 pt Times New Roman (or Courier), double-spaced, 1-inch margins, first lines indented half an inch with no blank lines between paragraphs, a header with your surname, a title keyword and the page number, each chapter on a new page and centred scene breaks. Word's Paragraph and Header settings do all of it. Stella (stella.sh) reformats a copy of your draft on your computer without changing a word.",
    stellaSteps: [
      "Finds `The Glass Orchard - draft.docx` in Documents: 11 pt Calibri, single-spaced, blank lines between paragraphs, indents made three different ways and chapter titles as bold text",
      "Builds a new Word file with its built-in Office document tool: 12 pt Times New Roman, double spacing, 1-inch margins and a half-inch first-line indent on every paragraph",
      "Removes the blank lines and stray tabs and spaces, starts each chapter on a new page and turns the `***` scene breaks into a centred #",
      "Adds a title page with the contact details and a rounded word count, and a “Lindqvist / Glass Orchard / page” header on the following pages",
      "Renders the pages to images to check them, and saves `The Glass Orchard - manuscript format.docx` next to the draft, which it leaves untouched",
      "Points out what it didn't change: the draft is only about 2,200 words, the email looks like a placeholder, and about ten sentences start with a lowercase letter",
    ],
    prompt:
      "Format my novel in Documents in standard manuscript format so I can send it to literary agents. Save it as a new Word file.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "A formatted manuscript in about 4 minutes. Checked afterwards against an answer key written before the run: a new Word file with all 40 paragraphs of the story in order, 12 pt Times New Roman, double-spaced, 1-inch margins, half-inch first-line indents, no blank lines between paragraphs, a header with surname, title keyword and page number, each chapter on a new page, scene breaks as centred markers, the word count and contact details on the first page, and the draft unchanged.",
      note: "The draft and its author are made up, written for this run with inconsistent formatting on purpose. The work is sped up 17×.",
      video: {
        src: `${PROOFS}/reading-writing/format-a-manuscript/proof.mp4`,
        cuts: webCuts("reading-writing/format-a-manuscript"),
        poster: `${PROOFS}/reading-writing/format-a-manuscript/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 46.0,
        speed: 17,
        realDuration: 252,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A novel draft in Word is in Documents." },
        { at: 2, text: "The prompt: standard manuscript format for literary agents, as a new Word file." },
        { at: 13.3, text: "Stella replies with what that means: 12 pt Times New Roman, double spacing, 1-inch margins, a header, a title page and chapters on new pages." },
        { at: 19, text: "Reformatting a copy, sped up 17×." },
        { at: 31.9, text: "Done: the words unchanged, only the layout. Stella flags the short length, a placeholder email and lowercase sentence starts." },
      ],
    },
    manualTitle: "Format it yourself in Word",
    manualSteps: [
      {
        title: "Font, spacing and indents",
        body: "Save a copy of the draft first. Select all (Ctrl+A or Cmd+A), set Times New Roman 12 pt, then open Paragraph settings: line spacing Double, spacing before and after 0, Special: First line 0.5\". Set Layout, Margins, Normal for 1-inch margins.",
      },
      {
        title: "Clear the blank lines and old indents",
        body: "Use Find and Replace with More, Special: replace two paragraph marks (`^p^p`) with one, repeating until none are left. Replace a paragraph mark followed by a tab (`^p^t`) with a paragraph mark, so the half-inch indent comes from the paragraph setting alone.",
      },
      {
        title: "Chapters and scene breaks",
        body: "Click before each chapter title and choose Insert, Page Break (or set Page break before in Paragraph, Line and Page Breaks). Centre each chapter title. Replace `***` scene breaks with a single centred #.",
      },
      {
        title: "Header and title page",
        body: "Insert, Header: type Surname / Title keyword / and then Insert, Page Number, Current Position. On the first page put your name, email and phone at the top left and the approximate word count at the top right, with the title halfway down; tick Different First Page so the header doesn't show there.",
      },
      {
        title: "Check each literary agent's guidelines",
        body: "Some literary agents want no header, a different font or a particular file name. Their own submission page wins over any general format.",
      },
    ],
    limits: [
      "Each literary agent's own guidelines win where they differ. Stella followed the common standard; ask it for Courier, all-caps chapter titles or no header if someone wants that.",
      "Stella changed the layout only and left typos alone, flagging them instead. Ask if you want them fixed.",
      "The manuscript's text goes to the AI model you use in Stella while it reformats it. The new file is written on your computer.",
      "Recorded on Linux. Stella used its built-in Office document tool, which works the same on Mac and Windows; it checked the pages with LibreOffice, which was on the test computer.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Is standard manuscript format still Courier?",
        a: "Times New Roman 12 pt is now the usual choice for novels. Courier is still accepted by many literary agents and some short-fiction markets ask for it.",
      },
      {
        q: "What goes in a manuscript header?",
        a: "Your surname, a keyword from the title and the page number, for example Lindqvist / Glass Orchard / 7. It usually starts after the title page.",
      },
      {
        q: "Do I need a title page?",
        a: "For a novel submission, usually yes: contact details at the top left, approximate word count at the top right, then the title and your name centred. Some literary agents only want the first page of chapter one; check their guidelines.",
      },
      {
        q: "Can it make an ebook of the same book?",
        a: "Yes: see [convert Word to EPUB](/how/reading-writing/convert-word-to-epub). To apply one change across several files, see [find and replace in multiple Word documents](/how/documents/find-and-replace-in-multiple-word-documents).",
      },
    ],
    related: ["reading-writing/convert-word-to-epub", "documents/find-and-replace-in-multiple-word-documents", "documents/merge-word-documents", "reading-writing/convert-markdown-to-word"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Shunn: Proper Manuscript Format (novel)", href: "https://www.shunn.net/format/novel/" },
      { label: "Microsoft Support: Insert page numbers", href: "https://support.microsoft.com/en-us/office/insert-page-numbers-9f366518-0500-4b45-903d-987d3827c007" },
    ],
  },
];
