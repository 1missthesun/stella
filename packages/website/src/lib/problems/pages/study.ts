import { PROOFS, webCuts } from "../media";
import type { ProblemPage } from "../types";

const MODEL = "Claude Code with Opus, on a Claude plan";

export const STUDY_PAGES: ProblemPage[] = [
  {
    slug: "export-kindle-highlights",
    niche: "study",
    searchPhrases: ["export kindle highlights", "kindle highlights", "my clippings txt", "kindle highlights to notion", "kindle highlights to markdown"],
    title: "Export Kindle highlights: one clean file per book, no repeats",
    description:
      "Split Kindle's My Clippings.txt into one tidy file per book, without the repeated and half-finished highlights: by hand, Amazon's notebook, or Stella (stella.sh).",
    h1: "Export your Kindle highlights into one file per book",
    short: "Export Kindle highlights",
    lede: "One messy My Clippings.txt as five tidy files, one per book, every repeat gone.",
    answer:
      "Every highlight you make is saved in `My Clippings.txt` in the Kindle's documents folder: plug it in by USB and copy it off. The file mixes all your books together, and Kindle adds a new entry each time you extend a highlight, so it fills with repeats. Amazon's notebook page at read.amazon.com/notebook shows highlights for books bought from the Kindle store only. Stella (stella.sh) splits the file into one clean file per book on your computer, repeats removed and notes kept.",
    stellaSteps: [
      "Reads `My Clippings.txt` in Documents: five books' highlights, notes and bookmarks mixed together",
      "Drops 10 exact repeats, and 15 cut-off highlights that were later saved again longer, keeping the longer version each time",
      "Leaves out 10 empty bookmarks",
      "Writes one Markdown file per book, highlights in reading order with page and location, each of your 13 notes under the highlight it belongs to",
      "Saves them in a new Kindle Highlights by Book folder and leaves My Clippings.txt untouched",
    ],
    prompt:
      "I copied My Clippings.txt from my Kindle into Documents. Split my highlights into one tidy file per book, without the duplicates, so I can read them back.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "Five files in about a minute. Checked afterwards against an answer key written before the run: one file per book, each with every final highlight of that book once, no repeats or half-finished versions, nothing from other books, no bookmarks, every note kept, in reading order, and My Clippings.txt unchanged.",
      note: "The books and highlights are made up, written in Kindle's real My Clippings.txt format with its repeats on purpose. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/study/export-kindle-highlights/proof.mp4`,
        cuts: webCuts("study/export-kindle-highlights"),
        poster: `${PROOFS}/study/export-kindle-highlights/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 48.4,
        realDuration: 100,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. My Clippings.txt, copied off a Kindle, is in Documents." },
        { at: 2.1, text: "The prompt: one tidy file per book, without the duplicates." },
        { at: 18.1, text: "Stella replies: it will drop repeats, including the longer copies Kindle saves when you re-highlight." },
        { at: 23.9, text: "Splitting the highlights, sped up 4×." },
        { at: 34.4, text: "Done: five files with 11 to 13 highlights each, 25 repeats removed, notes kept under their highlights." },
      ],
    },
    manualTitle: "Export them yourself",
    manualSteps: [
      {
        title: "Copy the file off the Kindle",
        body: "Connect the Kindle with a USB cable. It shows up as a drive; open its `documents` folder and copy `My Clippings.txt` to your computer. Some newer Kindles connect as a media device instead of a drive; on a Mac those need a file-transfer app such as the free OpenMTP.",
      },
      {
        title: "Or use Amazon's notebook",
        body: "Sign in at read.amazon.com/notebook to see highlights for books bought from the Kindle store, one book at a time. Highlights in documents and books you sent to the Kindle yourself aren't there, and some publishers limit how much you can export.",
      },
      {
        title: "Split by book",
        body: "Open the file in a text editor. Each entry is the book title, a line with page, location and date, the highlight, then `==========`. Search for each title and copy its entries into a new document.",
      },
      {
        title: "Remove the repeats",
        body: "Kindle never edits an entry: if you highlight a sentence and then extend it, both are saved. Delete exact repeats, and any highlight that is the start of a longer one at the same location.",
      },
    ],
    limits: [
      "My Clippings.txt is the only source. If you deleted a highlight on the Kindle, the file still has it, so Stella can't tell it was deleted.",
      "If a publisher limits clippings, the Kindle may have saved cut-off highlights; Stella can't restore the missing text.",
      "The highlights go to the AI model you use in Stella while it sorts them. The files are written on your computer.",
      "Recorded on Linux, where Stella used only Python, built in on Mac and Linux. On Windows it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Where is My Clippings.txt on a Kindle?",
        a: "In the `documents` folder at the top of the Kindle's storage when it's connected by USB. It holds highlights, notes and bookmarks from every book on that Kindle.",
      },
      {
        q: "Can I get the highlights into Notion or Obsidian?",
        a: "Stella's files are Markdown, which Obsidian opens as notes and Notion imports (Import, Markdown). Ask for Word or PDF instead if you prefer.",
      },
      {
        q: "Can it make flashcards from my highlights?",
        a: "Yes, in the same chat. See [make Anki flashcards from notes](/how/study/make-anki-flashcards-from-notes) and [print flashcards double-sided](/how/study/print-flashcards-double-sided).",
      },
      {
        q: "What about ebooks that won't open on my Kindle?",
        a: "See [convert EPUB to PDF](/how/pdf-excel/convert-epub-to-pdf) for reading on other devices.",
      },
    ],
    related: ["study/make-anki-flashcards-from-notes", "study/print-flashcards-double-sided", "pdf-excel/convert-epub-to-pdf", "chats-data-exports/see-your-spotify-listening-history"],
    lastChecked: "2026-11-13",
    sources: [{ label: "Amazon Kindle notebook (web)", href: "https://read.amazon.com/notebook" }],
  },
  {
    slug: "make-anki-flashcards-from-notes",
    niche: "study",
    searchPhrases: ["turn notes into flashcards", "how to create anki deck", "convert notes to anki", "anki import csv", "make anki cards from word document"],
    title: "Make Anki flashcards from your notes (a file Anki imports)",
    description:
      "Turn the key terms and definitions in your Word notes into an Anki import file, one card per term: a spreadsheet and Anki's Import, or Stella (stella.sh).",
    h1: "Make Anki flashcards from your notes",
    short: "Anki flashcards from notes",
    lede: "24 terms from a Word document as Anki cards, term on the front, definition behind.",
    answer:
      "Anki imports plain text: put each term in column A and its definition in column B of a spreadsheet, save it as CSV UTF-8, then in Anki use File, Import, map column 1 to Front and column 2 to Back, and import. The slow part is copying the terms out of your notes. Stella (stella.sh) reads your notes on your computer, picks out the terms and definitions, including ones in tables, and writes an Anki import file, without uploading your notes to a flashcard site.",
    stellaSteps: [
      "Finds `Bio 101 notes - Cells.docx` in Documents",
      "Takes 16 terms from the bold “term – definition” lines and 8 from the glossary table",
      "Skips lines that aren't terms: the test-date reminder, the to-do list and the table's header row",
      "Writes `Bio 101 - Cells - Anki flashcards.txt` next to the notes: tab-separated, with header lines telling Anki the note type and a deck called Bio 101::Unit 2 Cells",
      "Flags one thing in the notes that looks misplaced, and says plainly it didn't test the import in Anki itself",
    ],
    prompt: "Turn my biology notes in Documents into Anki flashcards I can import, one card per key term with its definition.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "24 cards in about 40 seconds. Checked afterwards against an answer key written before the run: an Anki-importable text file with cards for all 24 terms, each with its own definition on the back, no cards for the reminder or the table header, and the notes unchanged.",
      note: "The biology notes were written for this run. Anki itself wasn't installed, so importing the file into Anki wasn't part of the check. The work is sped up 2×.",
      video: {
        src: `${PROOFS}/study/make-anki-flashcards-from-notes/proof.mp4`,
        cuts: webCuts("study/make-anki-flashcards-from-notes"),
        poster: `${PROOFS}/study/make-anki-flashcards-from-notes/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 46.5,
        realDuration: 77,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Biology notes in Word are in Documents." },
        { at: 2, text: "The prompt: Anki flashcards, one card per key term with its definition." },
        { at: 14.6, text: "Stella replies: an import file next to the notes, term on the front, definition on the back." },
        { at: 20.5, text: "Reading the notes, sped up 2×." },
        { at: 32.5, text: "Done: 24 cards, 16 from the term lines and 8 from the glossary table, non-terms left out, import steps given." },
      ],
    },
    manualTitle: "Make the cards yourself",
    manualSteps: [
      {
        title: "Copy terms into a spreadsheet",
        body: "Put each term in column A and its definition in column B, one per row, with no header row. Terms in a table in Word can be copied straight into the sheet.",
      },
      {
        title: "Save as CSV UTF-8",
        body: "Excel: File, Save As, CSV UTF-8 (Comma delimited). Numbers: File, Export To, CSV. UTF-8 keeps symbols and accents intact.",
      },
      {
        title: "Import into Anki",
        body: "In Anki on your computer, choose File, Import, pick the CSV, check the field separator is Comma, set the note type to Basic, the deck you want, and map field 1 to Front and field 2 to Back. Click Import.",
      },
      {
        title: "Check a few cards",
        body: "Browse the new deck and fix any card where a definition has split across fields, usually because it contained a comma and wasn't in quotes.",
      },
    ],
    limits: [
      "Stella makes cards from what's in your notes and doesn't add facts. Read through the deck before relying on it.",
      "It made a text file for Anki's Import, not an .apkg deck package; ask for an .apkg if you want one. It didn't open Anki to test the import.",
      "Image cards (labelling a diagram) aren't covered.",
      "Your notes go to the AI model you use in Stella so it can find the terms. Nothing is uploaded to a flashcard site.",
      "Recorded on Linux. On a Mac or Windows PC Stella may install a small Word-reading library first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What file types can Anki import?",
        a: "Plain text (comma- or tab-separated), and Anki's own .apkg and .colpkg packages. A text file with term and definition per line is the simplest.",
      },
      {
        q: "Can it make cards from a PDF or slides?",
        a: "Yes, from any notes it can read: Word, PDF, PowerPoint or text. Scanned pages need text recognition first, which is slower.",
      },
      {
        q: "Can I print the cards instead?",
        a: "Yes: see [print flashcards double-sided](/how/study/print-flashcards-double-sided), where fronts and backs line up.",
      },
      {
        q: "Can it make cards from my Kindle highlights?",
        a: "Yes. First [export the highlights](/how/study/export-kindle-highlights), then ask for cards from the book's file.",
      },
    ],
    related: ["study/print-flashcards-double-sided", "study/export-kindle-highlights", "pdf-excel/make-scanned-pdf-searchable"],
    lastChecked: "2026-11-13",
    sources: [{ label: "Anki Manual: Importing text files", href: "https://docs.ankiweb.net/importing/text-files.html" }],
  },
  {
    slug: "print-flashcards-double-sided",
    niche: "study",
    searchPhrases: ["how to print flashcards double sided", "how to print flashcards front and back", "printable flashcards", "make flashcards from a spreadsheet"],
    title: "Print flashcards double-sided so fronts and backs line up",
    description:
      "Make a printable flashcard PDF from a vocabulary list, with each meaning printed exactly behind its word on two-sided printing: Word tables, or Stella (stella.sh).",
    h1: "Print flashcards double-sided so the backs line up",
    short: "Print double-sided flashcards",
    lede: "30 Spanish words as cut-out cards, each meaning printed right behind its word.",
    answer:
      "Put the words in a table on one page and the meanings on the next, with the columns swapped left to right on the back page, because flipping the sheet on its long edge mirrors it. Print with two-sided on and “flip on long edge”, at 100% scale, and check one sheet against the light first. Stella (stella.sh) builds that PDF from your spreadsheet, with the backs mirrored and a number on both sides of every card.",
    stellaSteps: [
      "Finds `Spanish vocab - Unit 3.xlsx` in Documents: 30 words with their meanings, a header row and a Done? column",
      "Lays the words out 8 cards to a page with dashed cutting lines, on fronts, and the meanings on the following backs",
      "Mirrors each back page left to right, so every meaning lands behind its word when flipped on the long edge",
      "Prints a small matching number on both sides of each card, and checks that each meaning lines up behind its word",
      "Saves `Spanish vocab - Unit 3 - flashcards.pdf` and gives the print settings: two-sided, flip on long edge, 100% scale",
    ],
    prompt:
      "I have a vocabulary list for my Spanish class in a spreadsheet in Documents. Make printable flashcards, word on the front and meaning on the back, that line up when I print double-sided.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "An 8-page PDF in about 2 minutes. Checked afterwards against an answer key written before the run, by measuring positions in the PDF: all 30 words are on front pages, every meaning sits at the mirrored spot behind its word for long-edge two-sided printing, fronts and backs alternate, no meaning is on a word side, and the spreadsheet is unchanged.",
      note: "The vocabulary list was made for this run. The check measured the PDF; nothing was printed on paper. The work is sped up 8×.",
      video: {
        src: `${PROOFS}/study/print-flashcards-double-sided/proof.mp4`,
        cuts: webCuts("study/print-flashcards-double-sided"),
        poster: `${PROOFS}/study/print-flashcards-double-sided/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 51.5,
        realDuration: 154,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A Spanish vocabulary spreadsheet is in Documents." },
        { at: 2.1, text: "The prompt: printable flashcards, word on the front, meaning on the back, lined up for double-sided printing." },
        { at: 18.9, text: "Stella replies: the back pages will be laid out so each meaning prints behind its word." },
        { at: 24.6, text: "Building and checking the PDF, sped up 8×." },
        { at: 37.5, text: "Done: 30 cards on 4 sheets, with the print settings to use and a numbered pair check on each card." },
      ],
    },
    manualTitle: "Make them yourself",
    manualSteps: [
      {
        title: "Make the front page",
        body: "In Word or Pages, insert a table with 2 columns and 4 or 5 rows that fills the page, and set fixed row heights. Type one word per cell.",
      },
      {
        title: "Make the back page, mirrored",
        body: "On the next page, add the same table. Put each meaning in the same row but the opposite column: the meaning for the top-left word goes top-right. That's what long-edge flipping does to the sheet.",
      },
      {
        title: "Print one test sheet",
        body: "Print pages 1–2 with two-sided on, “flip on long edge” (Windows: Print on Both Sides, Flip pages on long edge), at 100% or Actual size. Hold it up to the light to check each meaning sits behind its word.",
      },
      {
        title: "No two-sided printer?",
        body: "Print the odd pages, put the stack back in the tray as your printer's manual shows, then print the even pages. Test with one sheet first, as printers feed differently.",
      },
      {
        title: "Cut along the lines",
        body: "Use a ruler and craft knife or a paper trimmer. Card stock or thicker paper stops the backs showing through.",
      },
    ],
    limits: [
      "Printers differ: some flip the back sheet differently. Print one test sheet before the rest.",
      "Stella makes the PDF; it doesn't print it unless you ask it to send the file to your printer.",
      "The file was set up for A4. Stella said US Letter works at 100%, but the margins differ; ask for Letter if that's your paper.",
      "It made cards for words your list marked as done too, and offered a version without them.",
      "Recorded on Linux. On a Mac or Windows PC Stella may install a small PDF library first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why don't my flashcard backs line up?",
        a: "Usually because the back page isn't mirrored, or because “fit to page” scaled the two sides differently. Mirror the back's columns for long-edge flip and print at 100%.",
      },
      {
        q: "Long edge or short edge?",
        a: "For portrait pages, long edge flips like a book. Stella's PDF is made for long edge; if your printer only flips on the short edge, ask for a short-edge version.",
      },
      {
        q: "Can I study the same words in Anki?",
        a: "Yes: see [make Anki flashcards from notes](/how/study/make-anki-flashcards-from-notes); a spreadsheet works as the source too.",
      },
      {
        q: "Can it combine my class handouts into one PDF to print?",
        a: "Yes. For photos of pages, see [combine photos into one PDF](/how/photos-files/combine-photos-into-one-pdf).",
      },
    ],
    related: ["study/make-anki-flashcards-from-notes", "study/export-kindle-highlights", "photos-files/combine-photos-into-one-pdf", "printing-labels/print-business-cards-at-home"],
    lastChecked: "2026-11-13",
    sources: [
      {
        label: "Microsoft Support: Print on both sides of the paper (duplex) in Word",
        href: "https://support.microsoft.com/office/print-on-both-sides-of-the-paper-duplex-printing-in-word-2cd60d2f-3a57-4210-96ac-9a6ca71ca7a3",
      },
    ],
  },
];
