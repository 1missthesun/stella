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
    related: ["study/print-flashcards-double-sided", "study/export-kindle-highlights", "pdf-excel/make-scanned-pdf-searchable", "study/make-a-study-guide-from-notes"],
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
    related: ["study/make-anki-flashcards-from-notes", "study/export-kindle-highlights", "photos-files/combine-photos-into-one-pdf", "printing-labels/print-business-cards-at-home", "study/make-a-word-search"],
    lastChecked: "2026-11-13",
    sources: [
      {
        label: "Microsoft Support: Print on both sides of the paper (duplex) in Word",
        href: "https://support.microsoft.com/office/print-on-both-sides-of-the-paper-duplex-printing-in-word-2cd60d2f-3a57-4210-96ac-9a6ca71ca7a3",
      },
    ],
  },
  {
    slug: "make-a-word-search",
    niche: "study",
    searchPhrases: ["word search maker", "word search generator", "make a word search", "spelling word search", "printable word search with answer key"],
    title: "Make a printable word search from your spelling list",
    description:
      "Turn a class spelling list into a printable word search with a word bank and a separate answer key: a free puzzle-maker site, or Stella (stella.sh) from your own file.",
    h1: "Make a word search from your spelling words",
    short: "Make a word search",
    lede: "A week's spelling list as a 15×15 puzzle, with the answer key on its own page.",
    answer:
      "Free puzzle-maker sites build one if you paste in the words, pick a grid size and print the puzzle and its answer key. For young children, keep words running forwards and down only. Stella (stella.sh) reads the spelling list straight from your Word file, skips the lines that aren't words, and makes a print-ready PDF with the answer key on page 2, without retyping or ads.",
    stellaSteps: [
      "Finds `Week 12 spelling words.docx` in Documents and picks out the 15 spelling words and the two optional challenge words, leaving out the test-day line and the note to parents",
      "Fits them into a 15×15 grid, running across, down or diagonally down-right only, never backwards, to suit Year 4 as the sheet says",
      "Fills the gaps with random letters and adds Name and Date lines and a word bank with tick boxes",
      "Draws the answer key on page 2 with every word highlighted",
      "Saves `Week 12 spelling word search.pdf` in Documents next to the list, and offers an A4 version since the list uses UK spelling",
    ],
    prompt: "Make a printable word search for my class from the spelling words in my Documents, with the answer key on a separate page.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "A two-page puzzle PDF in about a minute and a half. Checked afterwards against an answer key written before the run, by reading the letters back out of the PDF: a 15×15 grid in which every one of the 15 spelling words can be found, the word list printed with the puzzle, the answer key on a separate page, and the spelling list unchanged.",
      note: "The spelling list was written for this run, with non-word lines mixed in on purpose. Nothing was printed on paper. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/study/make-a-word-search/proof.mp4`,
        cuts: webCuts("study/make-a-word-search"),
        poster: `${PROOFS}/study/make-a-word-search/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 47.2,
        speed: 4,
        realDuration: 91,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A Week 12 spelling list in Word is in Documents." },
        { at: 2.1, text: "The prompt: a printable word search with the answer key on a separate page." },
        { at: 15.8, text: "Stella replies: a PDF with the puzzle on page 1 and the key on page 2." },
        { at: 21.7, text: "Building the puzzle, sped up 4×." },
        { at: 33.2, text: "Done: a 15×15 grid with all 15 words and two challenge words, no backwards words, and the key highlighted." },
      ],
    },
    manualTitle: "Make one yourself",
    manualSteps: [
      {
        title: "Use a free puzzle maker",
        body: "Open a free word-search maker such as Discovery Education's [Puzzlemaker](https://puzzlemaker.discoveryeducation.com/word-search). Type a title and paste the words, one per line.",
      },
      {
        title: "Pick the size and directions",
        body: "A 15×15 grid suits 15 words of up to 11 letters. For younger children, allow only left-to-right and top-to-bottom; for older ones, add diagonals and backwards words.",
      },
      {
        title: "Print the puzzle and the key",
        body: "Generate the puzzle, print it, then print or save the answer key separately. Print to PDF if you want to keep a copy for next year.",
      },
      {
        title: "Or make it by hand",
        body: "Insert a 15×15 table in Word with square cells. Write the words in first, in pencil on a printout if easier, then fill every empty square with a random letter. Copy the table to a second page and shade the words for the key.",
      },
    ],
    limits: [
      "Stella makes a standard rectangular grid. Shaped puzzles (a heart, a pumpkin) weren't covered.",
      "It set US Letter paper and offered A4; ask for A4 up front if that's your paper.",
      "The spelling sheet's text goes to the AI model you use in Stella while it picks out the words. The PDF is made on your computer.",
      "Recorded on Linux, using Python (built in on Mac and Linux) with a PDF library that was already installed. On a Mac or Windows PC Stella may install one first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How big should a word search grid be?",
        a: "At least one square wider than the longest word. 10×10 suits 8–10 short words; 15×15 fits 15 to 20 words of up to 11 letters.",
      },
      {
        q: "Can it make one a week from each new list?",
        a: "Yes. Ask in the same chat each week and Stella uses the same layout with the new list.",
      },
      {
        q: "Can it leave out the hardest directions?",
        a: "Yes: it chose forwards, down and down-right only for Year 4. Ask for backwards and upward words for older pupils.",
      },
      {
        q: "What about a crossword from the same words?",
        a: "See [make a crossword puzzle](/how/study/make-a-crossword-puzzle), or [print double-sided flashcards](/how/study/print-flashcards-double-sided) for the same list.",
      },
    ],
    related: ["study/make-a-crossword-puzzle", "study/print-flashcards-double-sided", "study/make-a-study-guide-from-notes"],
    lastChecked: "2026-11-14",
    sources: [{ label: "Discovery Education Puzzlemaker: Word Search", href: "https://puzzlemaker.discoveryeducation.com/word-search" }],
  },
  {
    slug: "make-a-crossword-puzzle",
    niche: "study",
    searchPhrases: ["crossword maker", "crossword puzzle maker", "make a crossword puzzle", "vocabulary crossword", "crossword from vocabulary list"],
    title: "Make a crossword puzzle from a vocabulary list",
    description:
      "Turn a vocabulary spreadsheet into a printable crossword, definitions as numbered clues and answers on a separate page: a free maker site, or Stella (stella.sh).",
    h1: "Make a crossword puzzle from your vocabulary list",
    short: "Make a crossword puzzle",
    lede: "12 earth science words in one interlocking crossword, definitions as the clues.",
    answer:
      "Free crossword makers build an interlocking grid from words and clues you type in, then print a blank puzzle and an answer sheet. Copying a long list in one word at a time is the slow part. Stella (stella.sh) reads your vocabulary spreadsheet, uses the definitions as clues and makes a printable PDF with the answers on page 2, on your computer.",
    stellaSteps: [
      "Finds `Unit 5 vocabulary - Earth science.xlsx` in Documents: 12 words with their definitions",
      "Installs a spreadsheet reader and a PDF library into its own work folder",
      "Fits all 12 words into one interlocking grid where every crossing spells real words, with no stray letter runs",
      "Numbers the squares and lists Across and Down clues, each the definition word for word with the answer's length",
      "Saves `Unit 5 vocabulary - Earth science crossword.pdf`: the blank grid with name and date lines and the clues on page 1, the filled-in answers on page 2",
    ],
    prompt:
      "Make a printable crossword puzzle from the vocabulary list in my Documents, using the definitions as clues, with the answers on a separate page.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "A two-page crossword PDF in under 2 minutes. Checked afterwards against an answer key written before the run, by reading the grid back out of the PDF: all 12 words placed, every across and down run is one of the words, the words interlock in one connected grid, the puzzle page has numbered Across and Down clues from the definitions and an empty grid, the answers are on a separate page, and the vocabulary list is unchanged.",
      note: "The vocabulary list was made for this run. Nothing was printed on paper. The work is sped up 5×.",
      video: {
        src: `${PROOFS}/study/make-a-crossword-puzzle/proof.mp4`,
        cuts: webCuts("study/make-a-crossword-puzzle"),
        poster: `${PROOFS}/study/make-a-crossword-puzzle/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 50.7,
        speed: 5,
        realDuration: 113,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. An earth science vocabulary spreadsheet is in Documents." },
        { at: 2.1, text: "The prompt: a printable crossword using the definitions as clues, answers on a separate page." },
        { at: 18.9, text: "Stella replies: a PDF with the puzzle and clues first and the answer key on its own page." },
        { at: 24.7, text: "Building the grid, sped up 5×." },
        { at: 36.7, text: "Done: all 12 words fit, clues are the definitions word for word, answers on page 2." },
      ],
    },
    manualTitle: "Make one yourself",
    manualSteps: [
      {
        title: "Use a free crossword maker",
        body: "Open a free maker such as Discovery Education's [Criss-Cross Puzzlemaker](https://puzzlemaker.discoveryeducation.com/criss-cross). Enter each word followed by its clue, one per line, in the format the site shows.",
      },
      {
        title: "Copy from the spreadsheet",
        body: "If the words are in column A and definitions in column B, add a column that joins them in the site's format, such as `=A2&\" \"&B2`, fill it down and paste that column into the maker.",
      },
      {
        title: "Generate and check",
        body: "Generate the puzzle. If a word won't fit, the maker leaves it out or warns you; regenerate or swap a word. Read the clues for any that give away another answer.",
      },
      {
        title: "Print both pages",
        body: "Print the blank puzzle with its clues, then the answer key separately. Save each as PDF if you'll reuse it.",
      },
    ],
    limits: [
      "With some word lists one or two words won't interlock with the rest. Here all 12 fitted; with a longer or awkward list Stella may leave one out and say so.",
      "Clues are your definitions as written. Stella pointed out two clues that mention other answers but left them, since neither gives away its own answer.",
      "The vocabulary list goes to the AI model you use in Stella while it builds the puzzle. The PDF is made on your computer.",
      "Recorded on Linux, using Python (built in on Mac and Linux); Stella installed two small libraries into its own work folder. On Windows it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can I use my own clues instead of definitions?",
        a: "Yes. Put the clues in a column of the spreadsheet, or tell Stella which column to use.",
      },
      {
        q: "Will the answers show on the puzzle page?",
        a: "No. Page 1 has the empty grid and the clues; the filled-in grid is on page 2, so you can print them separately.",
      },
      {
        q: "Can it make a version for each class with different words?",
        a: "Yes. Point it at each list in turn, or at one spreadsheet with a sheet per class.",
      },
      {
        q: "What else can I make from the same list?",
        a: "A [word search](/how/study/make-a-word-search), [printable flashcards](/how/study/print-flashcards-double-sided) or [Anki cards](/how/study/make-anki-flashcards-from-notes).",
      },
    ],
    related: ["study/make-a-word-search", "study/print-flashcards-double-sided", "study/make-anki-flashcards-from-notes"],
    lastChecked: "2026-11-14",
    sources: [{ label: "Discovery Education Puzzlemaker: Criss-Cross", href: "https://puzzlemaker.discoveryeducation.com/criss-cross" }],
  },
  {
    slug: "make-a-study-guide-from-notes",
    niche: "study",
    searchPhrases: ["make a study guide", "study guide maker", "study guide generator", "study guide from notes", "how to make a study guide"],
    title: "Make a study guide from your lecture notes",
    description:
      "Turn lecture notes in Word, PDF, Markdown and text into one study guide: key terms with short definitions and each lecture's main points. By hand, or Stella (stella.sh).",
    h1: "Make a study guide from your lecture notes",
    short: "Study guide from notes",
    lede: "Four lectures in four file types as one guide: 24 terms and each lecture's main points.",
    answer:
      "Open your notes lecture by lecture and, in one new document, write a heading per lecture, its two or three main points, and each key term with a one-line definition in your own words. Doing it yourself is also good revision. Stella (stella.sh) drafts the guide on your computer from notes in any mix of Word, PDF, Markdown and text files, keeping other courses out.",
    stellaSteps: [
      "Finds the four BIO 152 lectures in Documents, each in a different format (Word, PDF, Markdown and plain text), plus the midterm info sheet",
      "Leaves out the history notes in another folder, and checks the info sheet to confirm the midterm covers all four lectures",
      "Writes the guide lecture by lecture: main points first, then the key terms with short definitions, 24 terms in all",
      "Saves it as a web page, `BIO 152 Midterm Study Guide.html`, in the BIO 152 folder, which opens in any browser and prints",
      "Flags that the exam date in the notes may be from an old syllabus, and that a quiz deadline has no date",
    ],
    prompt:
      "Make me one study guide for my biology midterm from my lecture notes in Documents: the key terms with short definitions and the main points of each lecture.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "A study guide in about a minute and a half. Checked afterwards against an answer key written before the run: one guide with all 24 key terms, each defined as in the notes, 11 of the 12 main points the key listed, nothing from the history notes, lectures in order 1–4, and the notes unchanged.",
      note: "The lecture notes were written for this run. The guide came out about as long as the notes themselves (496 words against 465), because these notes were already short. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/study/make-a-study-guide-from-notes/proof.mp4`,
        cuts: webCuts("study/make-a-study-guide-from-notes"),
        poster: `${PROOFS}/study/make-a-study-guide-from-notes/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 47.4,
        speed: 3,
        realDuration: 92,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Four biology lectures in different file types are in Documents." },
        { at: 2.1, text: "The prompt: one study guide with key terms, short definitions and each lecture's main points." },
        { at: 15.3, text: "Stella replies it has started going through the notes." },
        { at: 21.1, text: "Reading the notes and writing the guide, sped up 3×." },
        { at: 33.4, text: "Done: all four lectures, 24 terms, history notes left out, and a warning that the exam date may be old." },
      ],
    },
    manualTitle: "Make it yourself",
    manualSteps: [
      {
        title: "Gather the right notes",
        body: "Check the syllabus or exam sheet for which lectures are covered, and open only those. Notes in PDF can be copied from; scanned pages need retyping or text recognition.",
      },
      {
        title: "One heading per lecture",
        body: "In a new Word or Google Docs document, add a heading for each lecture in order. Under each, write two or three sentences on the main ideas.",
      },
      {
        title: "Terms and definitions",
        body: "List every bold or defined term with a one-line definition in your own words. A two-column table (term, definition) makes it easy to cover one side and test yourself.",
      },
      {
        title: "Keep it short",
        body: "A guide should be shorter than the notes. If a section runs long, cut examples and keep the definitions. The [UNC Learning Center](https://learningcenter.unc.edu/tips-and-tools/studying-101-study-smarter-not-harder/) suggests turning it into practice questions too.",
      },
    ],
    limits: [
      "The guide is only as complete as the notes. Stella doesn't add material from the textbook or the web unless you ask.",
      "It covered 11 of the 12 main points the answer key listed; read it against your notes before relying on it.",
      "Your notes go to the AI model you use in Stella while it writes the guide. Nothing is uploaded to a study site.",
      "It saved a web page; ask for Word or PDF if you prefer. Recorded on Linux, where Stella read the notes with tools already installed; on a Mac or Windows PC it may install a PDF or Word reader first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can it make practice questions too?",
        a: "Yes, from the same notes, in the same chat. Ask for multiple-choice or short-answer questions with an answer key on a separate page.",
      },
      {
        q: "Does it work with handwritten or scanned notes?",
        a: "Scans need text recognition first, which Stella can do, but handwriting is read less reliably. Typed notes work best.",
      },
      {
        q: "Can I get the terms as flashcards?",
        a: "Yes: see [make Anki flashcards from notes](/how/study/make-anki-flashcards-from-notes) or [print double-sided flashcards](/how/study/print-flashcards-double-sided).",
      },
      {
        q: "Can it put my class times in a timetable?",
        a: "Yes: see [make a class timetable](/how/study/make-a-class-timetable) from your registration PDF.",
      },
    ],
    related: ["study/make-anki-flashcards-from-notes", "study/print-flashcards-double-sided", "study/make-a-class-timetable", "pdf-excel/make-scanned-pdf-searchable"],
    lastChecked: "2026-11-14",
    sources: [{ label: "UNC Learning Center: Studying 101", href: "https://learningcenter.unc.edu/tips-and-tools/studying-101-study-smarter-not-harder/" }],
  },
  {
    slug: "make-a-class-timetable",
    niche: "study",
    searchPhrases: ["class timetable maker", "class schedule maker", "make a class timetable", "weekly class schedule template", "college schedule from registration"],
    title: "Make a class timetable from your registration PDF",
    description:
      "Turn a college registration summary into a printable weekly timetable spreadsheet, Monday to Friday with times down the side: by hand in Excel, or Stella (stella.sh).",
    h1: "Make a class timetable from your registration",
    short: "Class timetable",
    lede: "A registration PDF as a one-page weekly timetable, each class in its own colour.",
    answer:
      "Put Monday to Friday across the top of a spreadsheet and times in half-hour steps down the side, then for each class merge the cells from its start to its end time on each day it meets and type the course and room. Leave out dropped courses and list online ones underneath. Stella (stella.sh) builds that timetable from the registration PDF your college gives you, on your computer.",
    stellaSteps: [
      "Finds `Spring 2027 registration - Pellow State.pdf` in Documents and reads its course table: 12 weekly meetings across six in-person courses, including a Thursday lab",
      "Leaves out HIST 105, marked Dropped, and keeps the online PSY 101 off the grid because it has no meeting time",
      "Builds a spreadsheet with its built-in Office document tool: Monday to Friday across, 8 AM to 5 PM down the side, each class a colour-coded block with course, time and room",
      "Notes the online course and the dropped one under the grid, and sets it to print on one landscape page",
      "Saves `Spring 2027 timetable - Pellow State.xlsx` in Documents with a print preview image, and flags a likely credit typo in the registration",
    ],
    prompt:
      "Turn my class registration in Documents into a weekly timetable spreadsheet I can print, Monday to Friday with the times down the side.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "A printable timetable in about 3 minutes. Checked afterwards against an answer key written before the run: a new spreadsheet with Monday to Friday across and times down the side, all 12 weekly class meetings in the right day and time slot, no class on a day or time it doesn't meet, the dropped HIST 105 left out, the online PSY 101 not given a time slot, and the registration PDF unchanged.",
      note: "The college, courses and registration are made up for this run, with a dropped course and an online one on purpose. The work is sped up 11×.",
      video: {
        src: `${PROOFS}/study/make-a-class-timetable/proof.mp4`,
        cuts: webCuts("study/make-a-class-timetable"),
        poster: `${PROOFS}/study/make-a-class-timetable/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 48.2,
        speed: 11,
        realDuration: 177,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A class registration PDF is in Documents." },
        { at: 2.1, text: "The prompt: a printable weekly timetable spreadsheet, Monday to Friday with times down the side." },
        { at: 16.5, text: "Stella replies it is building the timetable to print on one landscape page." },
        { at: 22.3, text: "Reading the registration and building the spreadsheet, sped up 11×." },
        { at: 34.2, text: "Done: colour-coded blocks from 8 AM to 5 PM, the online and dropped courses noted, and a possible credit typo flagged." },
      ],
    },
    manualTitle: "Make it yourself",
    manualSteps: [
      {
        title: "Set up the grid",
        body: "In Excel, Numbers or Google Sheets, type Monday to Friday across row 1 from column B, and times down column A in half-hour steps (8:00, 8:30 … 17:00) from row 2.",
      },
      {
        title: "Add each class",
        body: "For each meeting, select the cells in that day's column from the start time to the end time, merge them (Excel: Home, [Merge & Center](https://support.microsoft.com/en-us/office/merge-and-unmerge-cells-5cbd15d5-9375-4540-907f-c673a93fcedf)) and type the course code, time and room. Give each course its own fill colour.",
      },
      {
        title: "Handle the odd ones",
        body: "Leave out anything marked Dropped or Withdrawn. Online courses with no meeting time go in a note under the grid, not in a time slot.",
      },
      {
        title: "Fit it to one page",
        body: "In Excel choose Page Layout, Orientation, Landscape, and under Scale to Fit set Width and Height to 1 page. Check File, Print preview before printing.",
      },
    ],
    limits: [
      "Stella reads what the registration says. Room or time changes made after it was printed won't be in it; tell Stella and it updates the sheet.",
      "Classes that meet on alternate weeks or only some weeks need a note; a weekly grid can't show them on its own.",
      "The registration's contents go to the AI model you use in Stella while it reads them. The spreadsheet is made on your computer.",
      "Recorded on Linux. Stella used its built-in Office document tool, which works the same on Mac and Windows, and a PDF text tool that was already installed; on a Mac or Windows PC it may install one first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can I put the timetable in my calendar instead?",
        a: "Yes. Ask Stella for a calendar file (.ics) with repeating events for the term, which Google Calendar, Outlook and Apple Calendar import.",
      },
      {
        q: "Will it work with my college's registration format?",
        a: "Any registration summary or schedule with course, days and times works: a PDF, a screenshot, or text copied from the student portal.",
      },
      {
        q: "Can I change the colours or the time range?",
        a: "It's an ordinary spreadsheet, so edit it directly, or ask Stella to change colours, hours or paper size.",
      },
      {
        q: "Can it help with studying for those classes?",
        a: "Yes: see [make a study guide from notes](/how/study/make-a-study-guide-from-notes) and [make Anki flashcards](/how/study/make-anki-flashcards-from-notes).",
      },
    ],
    related: ["study/make-a-study-guide-from-notes", "contacts-calendar-email/convert-ics-to-excel", "study/make-anki-flashcards-from-notes"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Microsoft Support: Merge and unmerge cells", href: "https://support.microsoft.com/en-us/office/merge-and-unmerge-cells-5cbd15d5-9375-4540-907f-c673a93fcedf" },
    ],
  },
];
