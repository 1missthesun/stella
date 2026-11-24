import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const READING_WRITING_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "convert-pdf-to-epub",
    niche: "reading-writing",
    searchPhrases: [
      "pdf to epub",
      "convert pdf to epub",
      "calibre convert pdf to epub",
      "pdf to kindle",
      "pdf to epub without page numbers",
    ],
    title: "Convert a PDF to EPUB that reads properly on an e-reader",
    description:
      "Convert a PDF to EPUB that reads properly on an e-reader: no page numbers mid-sentence, chapters you can tap to. Stella (stella.sh) makes the ebook for you.",
    h1: "Convert a PDF to an EPUB that reads properly",
    short: "PDF to EPUB",
    lede: "Turn a PDF book into an ebook that reads properly on your e-reader",
    answer:
      "Ask Stella (stella.sh) to convert the PDF. You get an EPUB where the text flows to your font size, page numbers and running heads are gone, and every chapter is in the contents.",
    gets: ["Text that fits any screen", "No stray page numbers mid-sentence", "A contents page with every chapter"],
    prompt:
      "Convert the novel PDF in my Downloads to an EPUB so it reads properly on my e-reader.",
    demo: {
      ack: "Sure. Turning it into an ebook now.",
      task: "Novel PDF to EPUB",
      rows: ["Removing page numbers and running heads", "Joining words split across lines", "Listing all 8 chapters"],
      reply:
        "Done. **The Lantern Keeper's Daughter** by Wren Alder is next to the PDF as an EPUB, all 8 chapters in its contents.",
    },
    faq: [
      ["Can I put the EPUB on a Kindle?", "Yes. Amazon's Send to Kindle accepts EPUB and converts it for the Kindle."],
    ],
    byHand: [
      "Install the free [Calibre](https://calibre-ebook.com/download) and drag the PDF in. Fix the title and author if they look wrong.",
      "Click Convert books, choose EPUB, and use Search & replace to remove the running head and page numbers.",
      "Open the result in Calibre's viewer and page through a few chapters before copying it to your reader.",
    ],
    related: ["pdf-excel/convert-epub-to-pdf", "pdf-excel/convert-mobi-to-epub", "reading-writing/convert-word-to-epub"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-markdown-to-pdf",
    niche: "reading-writing",
    searchPhrases: [
      "markdown to pdf",
      "md to pdf",
      "convert markdown to pdf",
      "markdown to pdf with images",
      "markdown to pdf vscode",
    ],
    title: "Convert Markdown to PDF: neat pages with tables and images",
    description:
      "Convert Markdown to PDF with neat pages where headings, tables, pictures and tick boxes come out properly. Stella (stella.sh) does a whole folder of notes at once.",
    h1: "Convert Markdown to PDF, nicely formatted",
    short: "Markdown to PDF",
    lede: "Turn your notes into neat PDFs with tables and pictures",
    answer:
      "Ask Stella (stella.sh) to turn your Markdown notes into PDFs. Every note in the folder comes out as neat pages with real headings, tables, pictures and tick boxes, and no stray symbols.",
    gets: ["One tidy PDF per note", "Tables, pictures and links kept", "Pictures never split across pages"],
    prompt:
      "Turn the Markdown notes in my Documents into nicely formatted PDFs.",
    demo: {
      ack: "Sure. Laying out your notes now.",
      task: "Notes into PDFs",
      rows: ["Finding the three notes", "Checking every page looks right"],
      reply:
        "Done. Each of your 3 notes has a PDF beside it with the same name. The trip map stays with its caption on page 2.",
    },
    faq: [
      ["Why are my images missing from the PDF?", "Notes point to pictures by where they sit in the folder. A converter run from somewhere else can't find them, so convert from the note's own folder."],
    ],
    byHand: [
      "In VS Code, add the free Markdown PDF extension.",
      "Open a note, press Ctrl+Shift+P (Cmd+Shift+P on a Mac) and run Markdown PDF: Export (pdf).",
      "Or open the note in Typora or Obsidian, print it and choose Save as PDF.",
    ],
    related: [
      "reading-writing/convert-markdown-to-word",
      "pdf-excel/add-page-numbers-to-pdf",
      "documents/convert-word-documents-to-pdf-in-bulk",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-word-to-epub",
    niche: "reading-writing",
    searchPhrases: [
      "convert word to epub",
      "docx to epub",
      "word to epub for kindle",
      "word to epub with cover",
      "word to kindle",
    ],
    title: "Convert a Word document to EPUB with a cover and contents",
    description:
      "Convert a Word document to EPUB with your cover and a contents page that lists every chapter, even ones not styled as headings. Stella (stella.sh) builds it.",
    h1: "Convert a Word document to EPUB, cover and contents included",
    short: "Word to EPUB",
    lede: "Make your Word manuscript an ebook with its cover and contents",
    answer:
      "Ask Stella (stella.sh) to make your Word file an EPUB. It sets your cover picture, lists every chapter in the contents, even ones you only made bold, and leaves the Word file alone.",
    gets: ["An EPUB with your own cover", "Every chapter in the contents", "Italics and scene breaks kept"],
    prompt:
      "Turn my novel in Documents into an EPUB ebook with a table of contents, and use the cover picture next to it as the cover.",
    demo: {
      ack: "Lovely. Building your ebook.",
      task: "Saltwater Hymns as an EPUB",
      rows: ["Finding all 10 chapters", "Adding cover.jpg as the cover"],
      reply:
        "**Saltwater Hymns.epub** by Juniper Vale is next to your Word file. Chapters 9 and 10 were only bold text in Word, but they're in the contents too.",
    },
    faq: [
      ["Why are some chapters missing from my EPUB's table of contents?", "They aren't styled as headings in Word. Give them Heading 1, or let Stella find them."],
    ],
    byHand: [
      "Style every chapter title as Heading 1 in Word; View, Navigation Pane should list them all.",
      "Drag the .docx into the free Calibre, double-click it, and set the title, author and cover.",
      "Click Convert books, choose EPUB, then check it in Calibre's viewer.",
    ],
    related: ["reading-writing/convert-pdf-to-epub", "reading-writing/merge-epub-files", "pdf-excel/convert-mobi-to-epub"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "merge-epub-files",
    niche: "reading-writing",
    searchPhrases: ["merge epub files", "merge epub", "combine epub files", "combine ebooks into one", "epubmerge"],
    title: "Merge EPUB files into one book, in the right reading order",
    description:
      "Merge EPUB files into one book in the right reading order, with every book's pictures kept and chapters nested by title. Stella (stella.sh) combines them for you.",
    h1: "Merge EPUB files into one book in reading order",
    short: "Merge EPUB files",
    lede: "Join a series of ebooks into one, in reading order",
    answer:
      "Ask Stella (stella.sh) to combine the books. It works out the reading order from inside each book, not the file names, and makes one EPUB with every chapter and picture kept.",
    gets: ["One EPUB with the whole series", "Books in reading order", "Each book's chapters under its title"],
    prompt:
      "Combine the three Saltmarsh Chronicles books in my Downloads into one EPUB, in the right reading order.",
    demo: {
      ack: "Sure. Working out the order first.",
      task: "Saltmarsh Chronicles in one book",
      rows: ["Checking each book's series number", "Keeping all three maps", "Building one contents list"],
      reply:
        "Done. **The Saltmarsh Chronicles (Books 1-3).epub** is in Downloads with all 15 chapters in order. Your three books are as they were.",
    },
    faq: [
      ["Why is one picture repeated in my merged ebook?", "The books saved their pictures under the same name, and the merge kept only one. Stella keeps each book's pictures apart."],
    ],
    byHand: [
      "Install the free Calibre, then Preferences, Plugins, Get new plugins, and add EpubMerge.",
      "Add the books and check each one's series number, since file names often sort wrong.",
      "Select them, click EpubMerge, drag them into order and click OK.",
    ],
    related: ["reading-writing/convert-word-to-epub", "pdf-excel/convert-epub-to-pdf", "pdf-excel/convert-mobi-to-epub"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-cbr-to-pdf",
    niche: "reading-writing",
    searchPhrases: ["cbr to pdf", "cbz to pdf", "convert cbr to pdf", "convert comic book files to pdf", "open cbr file"],
    title: "Convert CBR and CBZ comics to PDF, pages in the right order",
    description:
      "Convert CBR and CBZ comics to PDF with pages in true order at full picture quality, double-page spreads kept whole. Stella (stella.sh) does it for you.",
    h1: "Convert CBR and CBZ comics to PDF",
    short: "CBR and CBZ to PDF",
    lede: "Read your comic files as PDFs, every page in order",
    answer:
      "Ask Stella (stella.sh) to convert the comics. Each CBR or CBZ becomes a PDF with the pages in true order, page 10 after page 9, at full quality, so any tablet can open it.",
    gets: ["One PDF per comic", "Pages in the right order", "Full-quality pages, spreads kept wide"],
    prompt:
      "Convert the two comic files in my Downloads to PDFs so I can read them on my tablet.",
    demo: {
      ack: "Sure. Opening both comics.",
      task: "Comics to PDF",
      rows: ["Putting the pages in order", "Leaving out the junk files"],
      reply:
        "Both PDFs are in Downloads: issue 1 has 14 pages, issue 2 a cover and 11. I left out a scanner's credit page; say if you want it back.",
    },
    faq: [
      ["What's the difference between CBR and CBZ?", "Only the packaging. A CBZ is a zip of the page pictures and a CBR is a RAR of them."],
      ["How do I open a CBR file?", "A comic reader app or the free Calibre opens it. Stella can also turn it into a PDF that anything opens."],
    ],
    byHand: [
      "In the free Calibre, drag the comic in, click Convert books and choose PDF.",
      "Or unpack it: rename a .cbz to .zip, or open a .cbr with [7-Zip](https://www.7-zip.org/).",
      "Check page 10 sorts after page 9, then print the pictures to PDF.",
    ],
    related: ["files-folders/open-rar-file", "pdf-excel/convert-epub-to-pdf", "photos-files/combine-photos-into-one-pdf"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-markdown-to-word",
    niche: "reading-writing",
    searchPhrases: ["markdown to word", "convert markdown to word", "md to docx", "markdown to docx", "markdown table to word"],
    title: "Convert Markdown to Word with headings, tables and images",
    description:
      "Convert Markdown to Word documents with real headings, lists, tables and pictures, and none of the ## symbols left. Stella (stella.sh) converts a folder of notes.",
    h1: "Convert Markdown to Word documents",
    short: "Markdown to Word",
    lede: "Turn your notes into Word documents, headings and tables intact",
    answer:
      "Ask Stella (stella.sh) to convert your Markdown notes. Each becomes a Word document with Word's own heading styles, real lists and tables, and pictures in place, with no stray symbols.",
    gets: ["One Word document per note", "Word's own heading styles", "Tables as real Word tables"],
    prompt:
      "Convert the Markdown notes in my Documents to Word documents, keeping the headings, tables and pictures.",
    demo: {
      ack: "Sure. Converting your notes.",
      task: "Notes into Word documents",
      rows: ["Reading the three notes", "Turning tables into Word tables"],
      reply:
        "Done. Each note has a Word document beside it with the same name, and your tick boxes show as ☐ and ☒.",
    },
    faq: [
      ["Can I paste Markdown into Word?", "Word keeps the ## and ** symbols as text, and tables and pictures rarely come across properly."],
    ],
    byHand: [
      "Install the free [pandoc](https://pandoc.org/installing.html).",
      "Open a terminal in the notes folder and run: pandoc note.md -o note.docx",
      "Run it from the note's own folder so linked pictures are found.",
    ],
    related: [
      "documents/convert-word-documents-to-pdf-in-bulk",
      "documents/merge-word-documents",
      "reading-writing/convert-word-to-epub",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "format-a-manuscript",
    niche: "reading-writing",
    searchPhrases: [
      "standard manuscript format",
      "manuscript format",
      "novel manuscript format",
      "shunn manuscript format",
      "format manuscript for literary agents",
    ],
    title: "Put a novel in standard manuscript format in Word",
    description:
      "Put your novel in standard manuscript format: 12 pt Times New Roman, double-spaced, a proper header and title page. Stella (stella.sh) formats a copy in Word.",
    h1: "Put your novel in standard manuscript format",
    short: "Standard manuscript format",
    lede: "Get your novel ready to submit, in standard manuscript format",
    answer:
      "Standard manuscript format is 12 pt Times New Roman, double-spaced, 1-inch margins, indented paragraphs, and surname, title and page number at the top. Stella (stella.sh) formats a copy without changing a word.",
    gets: ["A new Word file, every word as written", "Each chapter on a new page", "A title page with the word count"],
    prompt:
      "Format my novel in Documents in standard manuscript format so I can send it to literary agents. Save it as a new Word file.",
    demo: {
      ack: "Happy to. Formatting a copy now.",
      task: "Manuscript format for The Glass Orchard",
      rows: ["Setting font, spacing and margins", "Clearing blank lines and stray tabs"],
      reply:
        "Done. **The Glass Orchard - manuscript format.docx** is next to your draft. The email on the title page looks like a placeholder, so check it.",
    },
    faq: [
      ["Is standard manuscript format still Courier?", "Times New Roman 12 pt is now usual for novels. Some short-fiction markets still ask for Courier; ask Stella for that instead."],
    ],
    byHand: [
      "In Word, select all and set Times New Roman 12 pt. In Paragraph, choose Double spacing and First line 0.5\".",
      "Set Layout, Margins, Normal for 1-inch margins. Replace ^p^p with ^p to clear blank lines.",
      "Insert, Header: Surname / Title / page number. Add a page break before each chapter.",
    ],
    related: [
      "reading-writing/convert-word-to-epub",
      "documents/find-and-replace-in-multiple-word-documents",
      "documents/merge-word-documents",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
