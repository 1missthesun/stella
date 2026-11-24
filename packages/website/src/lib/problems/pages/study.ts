import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const STUDY_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "export-kindle-highlights",
    niche: "study",
    searchPhrases: [
      "export kindle highlights",
      "kindle highlights",
      "my clippings txt",
      "kindle highlights to notion",
      "kindle highlights to markdown",
    ],
    title: "Export Kindle highlights: one clean file per book, no repeats",
    description:
      "Export Kindle highlights from My Clippings.txt into one clean file per book, repeats removed and your notes kept. Stella (stella.sh) sorts them out for you.",
    h1: "Export your Kindle highlights into one file per book",
    short: "Export Kindle highlights",
    lede: "All your Kindle highlights, one clean file per book",
    answer:
      "Copy My Clippings.txt off your Kindle and ask Stella (stella.sh) to split it. You get one tidy file per book, highlights in reading order, repeats gone and your notes kept beside them.",
    gets: ["One file per book", "Repeats and half-finished highlights gone", "Files that open in Notion or Obsidian"],
    prompt:
      "I copied My Clippings.txt from my Kindle into Documents. Split my highlights into one tidy file per book, without the duplicates.",
    demo: {
      ack: "Sure. Sorting your highlights by book.",
      task: "Kindle highlights by book",
      rows: ["Reading five books' highlights", "Dropping 25 repeats"],
      reply:
        "Done. Five files are in a new **Kindle Highlights by Book** folder, one per book, with all 13 of your notes kept.",
      files: ["Kindle Highlights by Book"],
    },
    faq: [
      ["Where is My Clippings.txt on a Kindle?", "Plug the Kindle into your computer and open its documents folder. The file holds highlights, notes and bookmarks from every book."],
      ["Can I see my highlights on a computer without the Kindle?", "read.amazon.com/notebook shows them for books bought from the Kindle store, one book at a time."],
    ],
    byHand: [
      "Connect the Kindle by USB, open its documents folder and copy My Clippings.txt to your computer.",
      "Open it in a text editor. Entries end with ==========; copy each book's entries into its own document.",
      "Delete repeats, and any highlight that is the start of a longer one at the same location.",
    ],
    related: [
      "study/make-anki-flashcards-from-notes",
      "study/make-a-bibliography-from-a-list-of-sources",
      "study/print-flashcards-double-sided",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-anki-flashcards-from-notes",
    niche: "study",
    searchPhrases: [
      "turn notes into flashcards",
      "how to create anki deck",
      "convert notes to anki",
      "anki import csv",
      "make anki cards from word document",
    ],
    title: "Make Anki flashcards from your notes (a file Anki imports)",
    description:
      "Turn your notes into Anki flashcards: one card per key term with its definition, in a file Anki imports straight away. Stella (stella.sh) writes it for you.",
    h1: "Make Anki flashcards from your notes",
    short: "Anki flashcards from notes",
    lede: "Turn your class notes into flashcards Anki can import",
    answer:
      "Ask Stella (stella.sh) to make Anki cards from your notes. It picks out each key term and its definition, tables included, and saves a file you import into Anki in one step.",
    gets: [
      "One card per term, definition on the back",
      "Terms from tables picked up too",
      "Reminders and to-do lines left out",
    ],
    prompt:
      "Turn my biology notes in Documents into Anki flashcards I can import, one card per key term with its definition.",
    demo: {
      ack: "Sure. Picking out the key terms.",
      task: "Anki cards from Bio 101 notes",
      rows: ["Finding 16 bold terms", "Adding 8 from the glossary table"],
      reply:
        "Done. **24 cards** are ready next to your notes, in a deck called Bio 101. In Anki, choose File, Import and pick the file.",
      files: ["Bio 101 - Cells - Anki flashcards.txt"],
    },
    faq: [
      ["How do I import flashcards into Anki?", "In Anki on your computer, choose File, Import, pick the file, set the note type to Basic and choose your deck, then click Import."],
      ["Notes in plain text vs cards in plain text in Anki?", "Both are export options. Notes in Plain Text saves each note's fields and imports back cleanly; Cards in Plain Text saves each card as it's shown."],
    ],
    byHand: [
      "Put terms in column A and definitions in column B of a spreadsheet, with no title row.",
      "Save it as CSV UTF-8 (File, Save As in Excel).",
      "In Anki, use File, Import, and match field 1 to Front and field 2 to Back.",
    ],
    related: [
      "study/print-flashcards-double-sided",
      "study/make-a-bibliography-from-a-list-of-sources",
      "study/export-kindle-highlights",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "print-flashcards-double-sided",
    niche: "study",
    searchPhrases: [
      "how to print flashcards double sided",
      "how to print flashcards front and back",
      "printable flashcards",
      "make flashcards from a spreadsheet",
    ],
    title: "Print flashcards double-sided so fronts and backs line up",
    description:
      "Print flashcards double-sided so fronts and backs line up: word on the front, meaning behind it, cutting lines included. Stella (stella.sh) makes the PDF.",
    h1: "Print flashcards double-sided so the backs line up",
    short: "Print double-sided flashcards",
    lede: "Flashcards you print front and back, each answer behind its word",
    answer:
      "Give Stella (stella.sh) your word list. It makes a PDF with words on the fronts and meanings on mirrored backs, so every meaning lands behind its word when you print double-sided.",
    gets: [
      "A PDF ready to print front and back",
      "Each meaning right behind its word",
      "Cutting lines and a number on both sides",
    ],
    prompt:
      "My Spanish vocabulary list is a spreadsheet in Documents. Make printable flashcards, word on the front and meaning on the back, that line up when printed double-sided.",
    demo: {
      ack: "Sure. Laying out your cards.",
      task: "Spanish Unit 3 flashcards",
      rows: ["Placing 30 words, 8 per page", "Mirroring the backs so they line up"],
      reply:
        "Your 8-page PDF is in Documents. Print it two-sided, flip on long edge, at 100% scale.",
      files: ["Spanish vocab - Unit 3 - flashcards.pdf"],
    },
    faq: [
      ["How do I print flashcards front and back from a PDF?", "Turn on two-sided printing, choose flip on long edge, and print at 100% or Actual size rather than fit to page."],
      ["Why don't my flashcard backs line up?", "The back page wasn't mirrored, or fit to page scaled the two sides differently. Mirror the back's columns and print at 100%."],
    ],
    byHand: [
      "In Word, make a table on one page with one word per cell.",
      "On the next page, put each meaning in the same row but the opposite column.",
      "No two-sided printer? Print the odd pages, put the stack back in the tray, then print the even pages.",
    ],
    related: [
      "study/make-anki-flashcards-from-notes",
      "study/export-kindle-highlights",
      "photos-files/combine-photos-into-one-pdf",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-word-search",
    niche: "study",
    searchPhrases: [
      "word search maker",
      "word search generator",
      "make a word search",
      "spelling word search",
      "printable word search with answer key",
    ],
    title: "Make a printable word search from your spelling list",
    description:
      "Make a printable word search from your spelling words, with the answer key on page 2 and a grid that suits the age group. Stella (stella.sh) builds it.",
    h1: "Make a word search from your spelling words",
    short: "Make a word search",
    lede: "A printable word search from this week's spelling list",
    answer:
      "Give Stella (stella.sh) your spelling list. It makes a print-ready word search PDF with every word hidden in the grid, a word bank to tick off, and the answer key on a second page.",
    gets: ["A puzzle with every word hidden", "Directions that suit the age group", "The answer key on page 2"],
    prompt:
      "Make a printable word search for my class from the spelling words in my Documents, with the answer key on a separate page.",
    demo: {
      ack: "Fun. Building the grid now.",
      task: "Week 12 word search",
      rows: ["Picking out the 15 spelling words", "Hiding them across and down"],
      reply:
        "**Week 12 spelling word search.pdf** is in Documents, puzzle on page 1 and answers on page 2. Words run forwards and down only, to suit Year 4.",
    },
    faq: [
      ["How big should a word search grid be?", "At least one square wider than the longest word. A 15×15 grid fits 15 to 20 words of up to 11 letters."],
    ],
    byHand: [
      "Open a free maker such as [Puzzlemaker](https://puzzlemaker.discoveryeducation.com/word-search) and paste the words, one per line.",
      "Pick a grid size. For young children, allow only left to right and top to bottom.",
      "Print the puzzle, then the answer key.",
    ],
    related: ["study/make-a-crossword-puzzle", "study/print-flashcards-double-sided", "study/make-a-study-guide-from-notes"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-crossword-puzzle",
    niche: "study",
    searchPhrases: [
      "crossword maker",
      "crossword puzzle maker",
      "make a crossword puzzle",
      "vocabulary crossword",
      "crossword from vocabulary list",
    ],
    title: "Make a crossword puzzle from a vocabulary list",
    description:
      "Make a crossword puzzle from your vocabulary list, with the definitions as clues and the answers on a separate page. Stella (stella.sh) makes the printable PDF.",
    h1: "Make a crossword puzzle from your vocabulary list",
    short: "Make a crossword puzzle",
    lede: "A printable crossword from your vocabulary list, answers separate",
    answer:
      "Give Stella (stella.sh) your vocabulary list. It fits the words into one crossword, uses the definitions as clues and saves a printable PDF with the answers on page 2.",
    gets: ["Every word in one connected grid", "Numbered Across and Down clues", "Answers on a separate page"],
    prompt:
      "Make a printable crossword puzzle from the vocabulary list in my Documents, using the definitions as clues, with the answers on a separate page.",
    demo: {
      ack: "Sure. Fitting the words together.",
      task: "Earth science crossword",
      rows: ["Reading 12 words and definitions", "Fitting them into one grid", "Numbering the clues"],
      reply:
        "Your crossword is in Documents, blank grid and clues on page 1, answers on page 2. Two clues mention other answers, so you may want to reword them.",
    },
    faq: [
      ["Can I use my own clues instead of definitions?", "Yes. Put them in a column of the spreadsheet, or tell Stella which column to use."],
    ],
    byHand: [
      "Open a free maker such as [Criss-Cross Puzzlemaker](https://puzzlemaker.discoveryeducation.com/criss-cross).",
      "Enter each word and its clue, one per line, in the format the site shows.",
      "Generate it, check every word fitted, then print the puzzle and the key.",
    ],
    related: ["study/make-a-word-search", "study/print-flashcards-double-sided", "study/make-anki-flashcards-from-notes"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-study-guide-from-notes",
    niche: "study",
    searchPhrases: [
      "make a study guide",
      "study guide maker",
      "study guide generator",
      "study guide from notes",
      "how to make a study guide",
    ],
    title: "Make a study guide from your lecture notes",
    description:
      "Make a study guide from your lecture notes: each lecture's main points and every key term defined, from Word, PDF or text files. Stella (stella.sh) drafts it.",
    h1: "Make a study guide from your lecture notes",
    short: "Study guide from notes",
    lede: "One study guide built from all your lecture notes",
    answer:
      "Point Stella (stella.sh) at your lecture notes, in any mix of Word, PDF and text files. It writes one study guide with each lecture's main points and every key term defined.",
    gets: [
      "Main points, lecture by lecture",
      "Every key term with a short definition",
      "Only the course you asked about",
    ],
    prompt:
      "Make me one study guide for my biology midterm from my lecture notes in Documents: key terms with short definitions and the main points of each lecture.",
    demo: {
      ack: "Good luck. Reading your lectures now.",
      task: "BIO 152 midterm study guide",
      rows: ["Reading four lectures", "Pulling out 24 key terms", "Leaving out your history notes"],
      reply:
        "Your study guide is in the BIO 152 folder. The exam date in your notes may be from an old syllabus, so check it.",
      files: ["BIO 152 Midterm Study Guide.html"],
    },
    faq: [
      ["Can it make practice questions too?", "Yes. Ask for multiple-choice or short-answer questions, with the answers on a separate page."],
    ],
    byHand: [
      "Check which lectures the exam covers and open just those.",
      "In a new document, add a heading per lecture and two or three sentences on its main ideas.",
      "List each key term with a one-line definition in your own words.",
    ],
    related: [
      "study/make-anki-flashcards-from-notes",
      "study/make-a-bibliography-from-a-list-of-sources",
      "study/print-flashcards-double-sided",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-class-timetable",
    niche: "study",
    searchPhrases: [
      "class timetable maker",
      "class schedule maker",
      "make a class timetable",
      "weekly class schedule template",
      "college schedule from registration",
    ],
    title: "Make a class timetable from your registration PDF",
    description:
      "Make a class timetable from your registration: Monday to Friday, times down the side, each class in its slot with its room. Stella (stella.sh) builds the spreadsheet.",
    h1: "Make a class timetable from your registration",
    short: "Class timetable",
    lede: "Your weekly class timetable, ready to print",
    answer:
      "Give Stella (stella.sh) your registration PDF. It builds a printable weekly timetable, Monday to Friday with times down the side, each class in the right slot with its room.",
    gets: [
      "Every class on the right day and time",
      "A colour per course, room included",
      "Dropped and online courses kept off the grid",
    ],
    prompt:
      "Turn my class registration in Documents into a weekly timetable spreadsheet I can print, Monday to Friday with the times down the side.",
    demo: {
      ack: "Sure. Reading your registration.",
      task: "Spring 2027 timetable",
      rows: ["Placing 12 weekly class meetings", "Leaving out the dropped HIST 105"],
      reply:
        "Your timetable is in Documents and prints on one page. Online PSY 101 has no set time, so it's listed under the grid.",
      files: ["Spring 2027 timetable - Pellow State.xlsx"],
    },
    faq: [
      ["Can I put the timetable in my calendar?", "Yes. Ask for a calendar file with repeating events for the term. Google Calendar, Outlook and Apple Calendar all import it."],
    ],
    byHand: [
      "In a spreadsheet, put Monday to Friday across the top and times in half-hour steps down the side.",
      "For each class, merge the cells from its start to end time and type the course and room.",
      "Set the page to Landscape and scale it to fit one page.",
    ],
    related: [
      "study/make-a-study-guide-from-notes",
      "contacts-calendar-email/convert-ics-to-excel",
      "study/make-anki-flashcards-from-notes",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-bibliography-from-a-list-of-sources",
    niche: "study",
    searchPhrases: [
      "apa reference list generator",
      "bibliography generator",
      "create bibliography",
      "reference list generator",
      "generate reference list apa 7",
    ],
    title: "Make an APA 7 reference list from your messy notes",
    description:
      "Make an APA 7 reference list from a messy list of sources: formatted, sorted and in Word, with gaps highlighted rather than made up. Stella (stella.sh) does it.",
    h1: "Make an APA reference list from your list of sources",
    short: "APA reference list from notes",
    lede: "A proper APA 7 reference list from your messy source notes",
    answer:
      "Give Stella (stella.sh) your list of sources, in whatever shape it's in. It formats each one in APA 7, sorts them properly and saves a Word document, highlighting any detail your notes lack.",
    gets: ["Every source in APA 7 style", "Sorted by surname, then year", "Missing details highlighted, never guessed"],
    prompt:
      "My essay sources are listed in sources.txt in Documents. Turn them into a proper APA 7 reference list in a Word document, in the right order.",
    demo: {
      ack: "Sure. Formatting your sources.",
      task: "APA list for the sleep essay",
      rows: ["Formatting 12 sources", "Sorting by author and year", "Marking two incomplete entries"],
      reply:
        "Your reference list is saved in Documents. Two entries are highlighted in yellow; one is missing Osei's initials.",
      files: ["APA References - Sleep Essay.docx"],
    },
    faq: [
      ["Can it do MLA or Chicago instead?", "Yes. Name the style and edition in your message."],
    ],
    byHand: [
      "In the free ZoteroBib, paste each DOI to fill in the details, and type in the rest.",
      "Sort by first author's surname. One author alone comes before the same author with co-authors.",
      "Set a 0.5 inch hanging indent (Paragraph, Special: Hanging).",
    ],
    related: [
      "study/make-a-study-guide-from-notes",
      "study/make-anki-flashcards-from-notes",
      "study/export-kindle-highlights",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
