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
  shortGuide({
    slug: "syllabus-to-google-calendar",
    niche: "study",
    searchPhrases: [
      "syllabus to google calendar",
      "add syllabus to google calendar",
      "syllabus to calendar converter",
      "import syllabus into google calendar",
      "syllabus to calendar ai",
    ],
    title: "Put every syllabus deadline into Google Calendar",
    description:
      "Put every due date, quiz and exam from your syllabus PDFs into Google Calendar, with a reminder days before each. Stella (stella.sh) reads them and adds them.",
    h1: "Put my syllabus deadlines into Google Calendar",
    short: "Syllabus deadlines to Google Calendar",
    lede: "Every due date from every syllabus, in your calendar",
    answer:
      "Drop your syllabus PDFs in a folder and ask Stella (stella.sh). It adds every due date, quiz and exam to Google Calendar with a reminder, and lists anything without a clear date.",
    gets: [
      "Every essay, quiz and exam on its date",
      "A colour per course and a reminder days ahead",
      "A calendar file for Outlook or Apple Calendar",
    ],
    prompt:
      "My four syllabi for this semester are PDFs in Documents/Spring. Put every assignment, quiz and exam into my Google Calendar with a reminder 3 days before.",
    demo: {
      ack: "On it. Reading all four syllabi.",
      task: "Spring syllabi to Google Calendar",
      rows: ["Finding 41 dated deadlines", "Turning “Week 6, Friday” into Feb 26", "Giving each course its own colour"],
      reply:
        "Done. **41 deadlines** are in Google Calendar, one colour per course, each with a reminder 3 days ahead. The CHEM 201 final has no date yet, so it waits at the top of **Spring deadlines.xlsx**.",
      files: ["Spring deadlines.xlsx", "Spring deadlines.ics"],
    },
    faq: [
      ["Can I upload a syllabus to Google Calendar?", "Not as a PDF. Stella turns it into events and adds them for you."],
      ["What if my professor moves a date?", "Tell Stella the new date. It moves that event and its reminder."],
    ],
    byHand: [
      "Copy each dated item into a spreadsheet with the columns Subject, Start Date, All Day Event.",
      "Save it as CSV, then in Google Calendar open Settings, Import & export, Import.",
    ],
    related: [
      "study/canvas-assignments-to-google-calendar",
      "study/make-a-class-timetable",
      "contacts-calendar-email/convert-ics-to-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "canvas-assignments-to-google-calendar",
    niche: "study",
    searchPhrases: [
      "canvas assignments to google calendar",
      "canvas calendar to google calendar",
      "sync canvas assignments to google calendar",
      "canvas calendar to apple calendar",
      "assignment tracker for college",
    ],
    title: "Get Canvas assignments into Google Calendar and a planner",
    description:
      "Get every Canvas assignment into Google Calendar, kept up to date by itself, plus a weekly planner of what's due. Stella (stella.sh) links them for you.",
    h1: "Get my Canvas assignments into Google Calendar",
    short: "Canvas assignments to Google Calendar",
    lede: "Canvas due dates in your own calendar, plus a weekly planner",
    answer:
      "Stella (stella.sh) links your Canvas calendar to Google Calendar or Apple Calendar, so new assignments show up there by themselves, and builds a planner sheet of everything due, week by week.",
    gets: [
      "Canvas due dates in the calendar you already use",
      "New assignments appear without you lifting a finger",
      "A weekly planner with a column to tick off",
    ],
    prompt:
      "Get all my Canvas assignments into my Google Calendar so new ones show up by themselves, and make me a weekly planner of what's due.",
    demo: {
      ack: "Sure. Opening Canvas in your browser.",
      task: "Canvas into Google Calendar",
      rows: ["Copying your Canvas calendar link", "Adding it to Google Calendar", "Listing 37 assignments by week"],
      reply:
        "Done. A **Canvas** calendar now sits in your Google Calendar with all 37 due dates, and new ones appear as your teachers post them. **Weekly planner.xlsx** is in Documents, soonest first.",
      files: ["Weekly planner.xlsx"],
    },
    faq: [
      ["Why are new Canvas assignments slow to show in Google Calendar?", "Google refreshes linked calendars on its own timetable, usually every few hours."],
      ["Where is the Canvas calendar feed?", "Open Calendar in Canvas and click Calendar Feed at the bottom right. That one link covers all your courses."],
    ],
    byHand: [
      "In Canvas, open Calendar and copy the Calendar Feed link.",
      "In Google Calendar, click + next to Other calendars, choose From URL and paste it.",
    ],
    related: [
      "study/syllabus-to-google-calendar",
      "study/make-a-class-timetable",
      "study/make-a-study-guide-from-notes",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "lecture-slides-to-anki-deck",
    niche: "study",
    searchPhrases: [
      "lecture slides to anki",
      "powerpoint to anki",
      "pdf to anki",
      "lecture to anki cards",
      "anki apkg",
    ],
    title: "Turn lecture slides and recordings into an Anki deck",
    description:
      "Turn lecture slides and recordings into a ready Anki deck, diagrams kept and one subdeck per lecture, as a file you double-click. Stella (stella.sh) makes it.",
    h1: "Turn my lecture slides into an Anki deck",
    short: "Anki deck from lecture slides",
    lede: "Lecture slides and recordings, made into cards you can review",
    answer:
      "Give Stella (stella.sh) the slides, as PowerPoint or PDF, plus the recordings if you have them. It writes cards from what was taught, puts diagrams on the right cards and saves one Anki deck you double-click.",
    gets: [
      "Cards from the slides and from what the lecturer said",
      "Diagrams on the cards they belong to",
      "A subdeck per lecture",
    ],
    prompt:
      "Make an Anki deck from my pharmacology lectures in Documents/PHAR 301, the slides and the recordings. Include what the professor stressed out loud too.",
    demo: {
      ack: "Sure. Reading the slides and listening to the lectures.",
      task: "PHAR 301 Anki deck",
      rows: ["Reading 6 slide decks", "Turning 6 recordings into text", "Writing 180 cards with 22 diagrams"],
      reply:
        "Done. **PHAR 301.apkg** is in your PHAR 301 folder, one subdeck per lecture. 31 cards come from things said aloud but missing from the slides. Double-click it to open in Anki.",
      files: ["PHAR 301.apkg"],
    },
    costNote: "Yes. A free speech tool on your computer writes out the recordings.",
    faq: [
      ["What is an Anki apkg file?", "A packed Anki deck with its cards and pictures. Double-click it, or use File, Import in Anki, and it joins your collection."],
      ["Can I add next week's lecture later?", "Yes. Import the new file and Anki adds the new cards, keeping your progress."],
    ],
    byHand: [
      "Type each key point from the slides as a question and answer in two spreadsheet columns, then use File, Import in Anki.",
      "For diagrams, Anki's built-in Image Occlusion hides labels on a picture for you to recall.",
    ],
    related: [
      "study/make-anki-flashcards-from-notes",
      "study/lecture-recording-to-notes",
      "study/make-a-study-guide-from-notes",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "lecture-recording-to-notes",
    niche: "study",
    searchPhrases: [
      "lecture recording to notes",
      "transcribe lecture to text",
      "lecture video to notes",
      "transcribe lectures to text free",
      "how to transcribe lecture recordings",
    ],
    title: "Turn lecture recordings into clean, searchable notes",
    description:
      "Turn lecture recordings into clean notes: a heading per topic, key terms in bold and the full transcript to search. Stella (stella.sh) does it free on your computer.",
    h1: "Turn each lecture recording into proper notes",
    short: "Notes from lecture recordings",
    lede: "Proper notes from every lecture you recorded",
    answer:
      "Point Stella (stella.sh) at your lecture recordings, audio or video. It writes out what was said on your own computer, then turns each lecture into tidy notes by topic, with the transcript kept beside them.",
    gets: [
      "A heading per topic, key terms in bold",
      "Exam hints and deadlines the lecturer mentioned, pulled out",
      "The full transcript with times, so you can jump back",
    ],
    prompt:
      "Turn this semester's recorded psych lectures in Videos/PSY 210 into proper notes, one document per lecture, and flag anything she said will be on the exam.",
    demo: {
      ack: "Sure. Starting with lecture 1.",
      task: "PSY 210 lecture notes",
      rows: ["Writing out 9 recordings", "Organising each lecture by topic", "Flagging 6 exam hints"],
      reply:
        "Done. Nine note documents are in **PSY 210 Notes**, each with its transcript. The exam hints are gathered on one page at the front, with the minute in the recording where she said each.",
      files: ["PSY 210 Notes"],
    },
    costNote: "Yes. The lectures are written out by a free speech tool on your computer.",
    faq: [
      ["Can I transcribe lectures to text for free?", "Yes. The speech is turned into text on your own computer, so hours of lectures cost nothing extra."],
      ["Does it work with Zoom or Panopto recordings?", "Yes. Download the recording first; video works the same as audio."],
    ],
    byHand: [
      "Panopto and Zoom often offer captions you can download from the recording's page.",
      "Free Whisper apps such as Buzz or MacWhisper turn audio into text on your computer.",
    ],
    related: [
      "study/lecture-slides-to-anki-deck",
      "study/make-a-study-guide-from-notes",
      "audio/transcribe-voice-memos-to-text",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "split-textbook-pdf-into-chapters",
    niche: "study",
    searchPhrases: [
      "split textbook pdf into chapters",
      "split pdf into chapters",
      "split pdf by bookmarks",
      "split pdf book into chapters",
      "divide pdf into chapters",
    ],
    title: "Split a textbook PDF into chapters you can search",
    description:
      "Split a huge textbook PDF into one file per chapter, named in order, and make scanned pages searchable on the way. Stella (stella.sh) does it on your computer.",
    h1: "Split my textbook PDF into chapters",
    short: "Split a textbook PDF into chapters",
    lede: "One searchable file per chapter, not one 1,000-page PDF",
    answer:
      "Stella (stella.sh) finds where each chapter starts, from the contents page or the book's own bookmarks, and saves one PDF per chapter. If the pages are scans, it makes the text searchable first.",
    gets: [
      "One file per chapter, numbered and named",
      "Scanned pages you can search and copy from",
    ],
    prompt:
      "My biology textbook is one huge scanned PDF in Downloads. Split it into a file per chapter and make the text searchable so I can find words.",
    demo: {
      ack: "Sure. Looking at the contents page first.",
      task: "Biology textbook by chapter",
      rows: ["Making 1,184 scanned pages searchable", "Finding where 56 chapters start", "Saving one file per chapter"],
      reply:
        "Done. **56 chapter files** are in Downloads/Biology by chapter, named like “07 - Membrane Structure.pdf”. Every page is searchable now, and the index and appendices have a file of their own.",
      files: ["Biology by chapter"],
    },
    faq: [
      ["How do I split a PDF into chapters automatically?", "Bookmarks mark chapters in many PDFs, and tools can cut there. Without them, Stella reads the contents page to find each chapter's first page."],
      ["Can I search a scanned textbook?", "Yes, once text is added behind the page pictures. Stella does that first, so search and copy work in any PDF reader."],
    ],
    byHand: [
      "Adobe Acrobat Pro: Organize Pages, Split, then split by top-level bookmarks.",
      "Free: [PDFsam Basic](https://pdfsam.org) has Split by bookmarks.",
      "For a scanned book, run OCR first, for example with OCRmyPDF or Acrobat's Scan & OCR.",
    ],
    related: [
      "pdf-excel/make-scanned-pdf-searchable",
      "pdf-excel/split-pdf-into-multiple-files",
      "study/make-a-study-guide-from-notes",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "format-a-paper-in-apa-7",
    niche: "study",
    searchPhrases: [
      "format paper in apa 7",
      "how to format a paper in apa 7th edition in word",
      "apa format paper title page",
      "how to format a paper in mla",
      "mla format paper google docs",
    ],
    title: "Format a paper in APA 7 or MLA 9, title page to references",
    description:
      "Format your paper in APA 7 or MLA 9: title page, page numbers, spacing, headings and references, fixed in your own Word or Google Docs file. Stella (stella.sh) does it.",
    h1: "Format my paper in APA 7 or MLA 9",
    short: "Format a paper in APA 7 or MLA 9",
    lede: "Your essay in proper APA or MLA format, without hunting menus",
    answer:
      "Give Stella (stella.sh) your draft in Word or Google Docs and name the style. It sets the title page, page numbers, spacing, font and headings, then matches your in-text citations to the reference list.",
    gets: [
      "A student title page or MLA heading, filled in",
      "Double spacing, margins and page numbers set",
      "References in order with hanging indents",
    ],
    prompt:
      "Format my psychology paper in Documents in APA 7 student style. Title page with my name, Dr. Reyes, PSY 220 and the due date, December 4.",
    demo: {
      ack: "Sure. Opening your paper.",
      task: "APA 7 format for the PSY 220 paper",
      rows: ["Building the student title page", "Setting spacing and page numbers", "Fixing three heading levels", "Sorting 14 references"],
      reply:
        "Done. The formatted copy sits next to your original. Two citations in the text, Kim (2021) and Lowe (2019), have no reference yet, so they're highlighted for you to add.",
      files: ["Sleep and Memory - APA 7.docx"],
    },
    faq: [
      ["Does an APA 7 student paper need a running head?", "No. Student papers need just a page number top right, unless your instructor asks for more."],
      ["How is MLA 9 different?", "No title page. Your name, instructor, course and date go top left, the title is centred, and your surname and page number sit top right."],
    ],
    byHand: [
      "APA 7: 1 inch margins, double spacing, a 0.5 inch first-line indent and a page number top right.",
      "Title page: bold title, then your name, university, course, instructor and due date, all centred.",
    ],
    related: [
      "study/make-a-bibliography-from-a-list-of-sources",
      "study/set-up-zotero-citations-in-word",
      "documents/accept-tracked-changes-in-word",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "set-up-zotero-citations-in-word",
    niche: "study",
    searchPhrases: [
      "how to use zotero in word",
      "zotero google docs",
      "zotero insert citation in word",
      "how to use zotero in google docs",
      "zotero word plugin not working",
    ],
    title: "Set up Zotero and add citations in Word or Google Docs",
    description:
      "Set up Zotero with all your sources in it and the Zotero tab working in Word or Google Docs, so citations and references build themselves. Stella (stella.sh) does it.",
    h1: "Use Zotero in Word and Google Docs for citations",
    short: "Zotero citations in Word or Google Docs",
    lede: "Your sources in one library, citations a click away",
    answer:
      "Stella (stella.sh) installs Zotero and its browser button, adds the sources you've gathered to a folder for your paper, sets your citation style and gets the Zotero tab working in Word or Google Docs.",
    gets: [
      "Every source you found, authors and dates filled in",
      "Your style set: APA 7, MLA 9 or Chicago",
      "A bibliography that updates as you cite",
    ],
    prompt:
      "Set up Zotero for my history thesis. Add the articles in my Thesis/Sources folder and the links in my notes, and get it working in Word with Chicago style.",
    demo: {
      ack: "Sure. Installing Zotero first.",
      task: "Zotero for the history thesis",
      rows: ["Installing Zotero and its browser button", "Adding 23 PDFs and 9 web links", "Switching on the Zotero tab in Word"],
      reply:
        "Done. All 32 sources are in a **Thesis** folder in Zotero, details read from the articles. In Word, click Zotero, then Add/Edit Citation, and type an author's name.",
    },
    faq: [
      ["How do I use Zotero in Google Docs?", "Once the Zotero browser button is installed, Google Docs gets a Zotero menu. Choose Add/edit citation and search your library."],
      ["Zotero word plugin not working?", "Usually Word was open while Zotero installed, or Word turned the add-in off. Stella reinstalls it from Zotero's settings and switches it back on."],
    ],
    byHand: [
      "Install Zotero and the Zotero Connector from [zotero.org](https://www.zotero.org/download/).",
      "In Word, open the Zotero tab, click Add/Edit Citation and pick your style the first time.",
    ],
    related: [
      "study/format-a-paper-in-apa-7",
      "study/make-a-bibliography-from-a-list-of-sources",
      "study/split-textbook-pdf-into-chapters",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "graph-lab-data-in-excel",
    niche: "study",
    searchPhrases: [
      "how to make a graph for a lab report",
      "graph for lab report",
      "scatter plot with error bars",
      "line of best fit excel",
      "error bars excel standard deviation",
    ],
    title: "Make a graph for a lab report in Excel or Google Sheets",
    description:
      "Make a lab report graph from your raw readings: averages, error bars, a line of best fit with its equation and labelled axes with units. Stella (stella.sh) builds it.",
    h1: "Make a graph for my lab report from my data",
    short: "Lab report graph in Excel",
    lede: "A proper lab graph from your readings, error bars and all",
    answer:
      "Give Stella (stella.sh) your readings, typed up or exported from the lab computer. It averages repeat trials, draws a labelled graph with error bars and a line of best fit in Excel or Google Sheets, and saves a picture for your report.",
    gets: [
      "Axis titles with units and a figure caption",
      "Error bars from your repeat trials",
      "Line of best fit with its equation and R²",
    ],
    prompt:
      "My pendulum lab data is in Documents, three trials per string length. Make the graph for my lab report with error bars and a line of best fit.",
    demo: {
      ack: "Sure. Reading your trials.",
      task: "Pendulum lab graph",
      rows: ["Averaging 3 trials at 8 lengths", "Adding standard deviation error bars", "Plotting period squared against length"],
      reply:
        "Done. **Pendulum lab.xlsx** holds your averages and the graph, line of best fit y = 4.02x + 0.01, R² = 0.998. Squaring the period puts the points on a straight line. **Figure 1.png** is ready for the report.",
      files: ["Pendulum lab.xlsx", "Figure 1.png"],
    },
    faq: [
      ["How do I add error bars in Excel with standard deviation?", "Put each point's standard deviation in a column, then choose Error Bars, More Options, Custom, and pick that column."],
      ["Can it do this in Google Sheets?", "Yes. Stella builds the same chart in your Google Sheet, where error bars and trendlines sit under Customize, Series."],
    ],
    byHand: [
      "Use AVERAGE and STDEV.S across each row.",
      "Insert a scatter chart, add a trendline with Display Equation and R-squared, then add axis titles with units.",
    ],
    related: [
      "study/lab-report-statistics-in-r-or-matlab",
      "study/format-a-paper-in-apa-7",
      "pdf-excel/summarize-spreadsheet-by-category",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "lab-report-statistics-in-r-or-matlab",
    niche: "study",
    searchPhrases: [
      "data analysis for lab report",
      "lab report statistics",
      "ggplot error bars",
      "t test in r studio",
      "matlab plot data from excel",
    ],
    title: "Do the statistics and plots for a lab report in R or MATLAB",
    description:
      "Run the statistics and make the figures for your lab report in R or MATLAB, with the code to hand in and a results paragraph. Stella (stella.sh) does both.",
    h1: "Do the data analysis for my lab report in R or MATLAB",
    short: "Lab report stats in R or MATLAB",
    lede: "The right test, clean figures and the numbers for your results",
    answer:
      "Tell Stella (stella.sh) what your experiment compared. It picks the right test, writes and runs the R or MATLAB code on your data, saves clean figures and drafts your results sentences with the real numbers.",
    gets: [
      "The right test for your design, explained in a line",
      "Figures with error bars, ready for the report",
      "A results paragraph with the test numbers",
    ],
    prompt:
      "My plant growth data is in Documents/BIO lab.xlsx, three fertiliser groups. Do the stats in R, make a bar chart with error bars, and write my results paragraph.",
    demo: {
      ack: "Sure. Looking at your groups first.",
      task: "Plant growth stats in R",
      rows: ["Installing R", "Comparing 3 groups with a one-way ANOVA", "Saving Figure 1 and Figure 2"],
      reply:
        "Done. Group B grew more than A and the control, F(2, 27) = 9.84, p < .001, while A and the control didn't differ. The figures, your results paragraph and **analysis.R** are in Documents/BIO lab.",
      files: ["analysis.R", "Results paragraph.docx"],
    },
    faq: [
      ["Should I use a t test or ANOVA?", "A t test compares two groups. Three or more need an ANOVA, then a follow-up test that shows which pairs differ."],
      ["Can it use MATLAB instead of R?", "Yes. It writes a MATLAB file and runs it with the MATLAB your university gives you."],
    ],
    byHand: [
      "Run t.test() for two groups, or aov() then TukeyHSD() for three or more.",
      "Plot the means with ggplot2 and geom_errorbar(), then save with ggsave().",
    ],
    related: [
      "study/graph-lab-data-in-excel",
      "study/format-a-paper-in-apa-7",
      "pdf-excel/summarize-spreadsheet-by-category",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "group-project-slides-from-notes",
    niche: "study",
    searchPhrases: [
      "group project presentation",
      "how to make ppt from notes",
      "google slides group project",
      "group presentation outline example",
    ],
    title: "Make one group project presentation from everyone's notes",
    description:
      "Turn everyone's notes into one group project presentation: one look, a fair split of slides, each presenter named and speaker notes. Stella (stella.sh) builds it.",
    h1: "Make our group project presentation from everyone's notes",
    short: "Group project slides from notes",
    lede: "One slide deck that looks like one person made it",
    answer:
      "Put everyone's notes in one folder, in any format, and ask Stella (stella.sh). It builds one PowerPoint with a single look, splits the slides fairly, names who presents each part and adds speaker notes.",
    gets: [
      "Each person's section with their name on it",
      "Speaker notes from what each of you wrote",
      "A file that opens in PowerPoint or Google Slides",
    ],
    prompt:
      "Our marketing group notes are in Documents/MKT 300 group: four people's docs and screenshots. Make one 12-minute PowerPoint, split fairly, with speaker notes for each of us.",
    demo: {
      ack: "Sure. Reading all four sets of notes.",
      task: "MKT 300 group presentation",
      rows: ["Merging four people's notes into one outline", "Giving each of you 3 minutes", "Laying out 16 slides with your charts"],
      reply:
        "Done. **MKT 300 - Oat Milk Launch.pptx** is in the group folder: 16 slides, four each, the presenter named where each part starts. Jordan and Priya both covered pricing, so it sits in Priya's part.",
      files: ["MKT 300 - Oat Milk Launch.pptx"],
    },
    faq: [
      ["Can we all edit it in Google Slides?", "Yes. Upload the file to Google Drive and open it with Google Slides, then share it with the group."],
      ["Can it use our school's template?", "Yes. Put the template in the folder and every slide is built on it."],
    ],
    byHand: [
      "In Google Slides, give each person a block of slides to fill.",
      "Have one person go through at the end, matching fonts, colours and picture sizes.",
    ],
    related: [
      "documents/merge-powerpoint-presentations",
      "documents/convert-powerpoint-to-pdf-with-notes",
      "study/make-a-study-guide-from-notes",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "find-scholarships-and-track-applications",
    niche: "study",
    searchPhrases: [
      "scholarship tracker",
      "scholarship tracker google sheets template",
      "find scholarships for college students",
      "spreadsheet to track scholarship applications",
      "scholarship search free",
    ],
    title: "Find scholarships you qualify for and track every deadline",
    description:
      "Find scholarships that fit your major, state and story, in one tracker with amounts, deadlines, essays and links, checked weekly for new ones. Stella (stella.sh) does it.",
    h1: "Find scholarships and keep them in a scholarship tracker",
    short: "Find and track scholarships",
    lede: "Scholarships you actually qualify for, every deadline in one sheet",
    answer:
      "Tell Stella (stella.sh) about yourself: school, major, state, grades and what sets you apart. It searches scholarship sites and local foundations, keeps only the ones you qualify for and builds a tracker, soonest deadline first.",
    gets: [
      "Only scholarships you qualify for",
      "Amount, deadline, essay prompt and link for each",
      "New finds added weekly, deadlines in your calendar",
    ],
    prompt:
      "Find scholarships for me: nursing major at Ohio State, from Ohio, 3.6 GPA, first in my family at college. Put them in a tracker with deadlines and essay prompts.",
    demo: {
      ack: "Sure. Looking past the big sites too.",
      task: "Nursing scholarship search",
      rows: ["Searching 6 sites and local foundations", "Dropping 40 that don't fit you", "Grouping ones that ask the same essay"],
      reply:
        "Done. **Scholarship tracker.xlsx** in Documents lists 27 matches worth about $96,000, soonest deadline first. Nine ask for nearly the same “why nursing” essay, so one strong draft covers them. I'll look for new ones every Monday.",
      files: ["Scholarship tracker.xlsx"],
    },
    faq: [
      ["Is there a free scholarship tracker template for Google Sheets?", "Stella makes you one in Google Sheets or Excel, already filled with scholarships that fit, instead of an empty template."],
      ["Where do the scholarships come from?", "Free sites like Bold.org, Fastweb and Scholarships.com, your college's own list, and local foundations and employers the big sites miss."],
    ],
    byHand: [
      "Make a free profile on [BigFuture](https://bigfuture.collegeboard.org) or [Fastweb](https://www.fastweb.com) and save your matches.",
      "List each one in a sheet: name, amount, deadline, requirements, status.",
    ],
    related: [
      "study/internship-application-tracker",
      "study/syllabus-to-google-calendar",
      "watches/company-job-alerts",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "roommate-agreement",
    niche: "study",
    searchPhrases: [
      "roommate agreement template",
      "rental agreement between roommates",
      "roommate lease agreement",
      "college roommate agreement template free",
      "what to include in a roommate agreement",
    ],
    title: "Make a roommate agreement with rent, bills and house rules",
    description:
      "Make a filled-in roommate agreement: each person's rent share, deposit, bills, chores, guests and moving out, ready for everyone to sign. Stella (stella.sh) writes it.",
    h1: "Make a roommate agreement for our place",
    short: "Roommate agreement",
    lede: "Rent, bills and house rules agreed and written down",
    answer:
      "Tell Stella (stella.sh) who's moving in, the rent and what matters to you. It writes a roommate agreement with everyone's share, the deposit, bills, chores, guests and what happens if someone leaves, ready to sign.",
    gets: [
      "Rent shares worked out, bigger rooms paying more if you like",
      "Bills, deposit and due dates spelled out",
      "Signature lines for everyone, as Word and PDF",
    ],
    prompt:
      "Write a roommate agreement for me, Sam and Leah. Our lease is in Downloads; rent is $2,400 and my room has its own bathroom, so I pay more. Cover bills, guests and cleaning.",
    demo: {
      ack: "Sure. Working out the rent split first.",
      task: "Roommate agreement for Elm St",
      rows: ["Splitting $2,400 by room and bathroom", "Taking move-out terms from your lease"],
      reply:
        "Done. You pay **$900**, Sam and Leah **$750** each. **Roommate agreement - Elm St.docx** and a PDF are in Documents, with your lease's 60-day notice rule. Everyone signs the last page.",
      files: ["Roommate agreement - Elm St.docx", "Roommate agreement - Elm St.pdf"],
    },
    faq: [
      ["What should a roommate agreement include?", "Rent shares and the due date, how bills are split, the deposit, chores, guests and quiet hours, and what happens when someone moves out early."],
      ["Does a roommate agreement need to be notarized?", "Usually not. Most are simply signed and dated by everyone, with a copy each."],
    ],
    byHand: [
      "Start from your lease: rent, due date, deposit and notice period.",
      "Agree each person's share; a rent-by-room-size calculator helps when rooms differ.",
    ],
    related: [
      "pdf-excel/split-bills-with-roommates",
      "watches/rental-listing-alerts",
      "study/find-scholarships-and-track-applications",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "tailor-resume-for-internship",
    niche: "study",
    searchPhrases: [
      "tailor resume to job description",
      "internship resume for college students",
      "resume for internship with no experience",
      "tailor resume to job description ai free",
      "internship resume template",
    ],
    title: "Tailor your resume to an internship job description",
    description:
      "Tailor your resume to each internship posting: the right projects up front, the posting's words used honestly, one page, as Word and PDF. Stella (stella.sh) rewrites it.",
    h1: "Tailor my resume to an internship job description",
    short: "Tailor a resume for an internship",
    lede: "Your resume rewritten for the internship you want",
    answer:
      "Give Stella (stella.sh) your resume and the posting. It moves your most relevant classes, projects and jobs up, rewrites bullets in the posting's words, keeps it to one page and uses only what you really did.",
    gets: [
      "Class projects and part-time jobs that count, up front",
      "Bullets that match the skills the posting asks for",
      "One page, as Word and PDF",
    ],
    prompt:
      "Tailor my resume in Documents for this data analyst internship at Target. I've only had a barista job, but I did a big Excel project in my stats class.",
    demo: {
      ack: "Sure. Reading the posting and your resume.",
      task: "Resume for the Target internship",
      rows: ["Matching the posting's 8 skills to yours", "Turning your stats project into strong bullets", "Fitting everything on one page"],
      reply:
        "Done. **Resume - Target Data Analyst Intern.pdf** and a Word copy are in Documents. Your stats project now leads, under Projects. The posting asks for SQL, which you haven't listed, so it's left off.",
      files: ["Resume - Target Data Analyst Intern.pdf"],
    },
    faq: [
      ["How do I write an internship resume with no experience?", "Lead with education, then class projects, clubs, volunteering and part-time work, each with a result. A strong project counts as experience."],
      ["Do I need a new resume for every internship?", "A tailored copy, yes. Stella keeps your main resume and names each copy after its posting."],
    ],
    byHand: [
      "Reorder your sections and bullets so the matching ones come first.",
      "Rewrite each bullet as what you did and what came of it, and keep it to one page.",
    ],
    related: [
      "study/internship-application-tracker",
      "watches/company-job-alerts",
      "documents/convert-pdf-to-word",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "internship-application-tracker",
    niche: "study",
    searchPhrases: [
      "internship application tracker",
      "internship tracker google sheets",
      "job application tracker spreadsheet",
      "internship tracker excel template",
      "job application tracker template",
    ],
    title: "Make an internship application tracker from your inbox",
    description:
      "Make an internship application tracker from your inbox: every company, role, date applied and status, kept up to date as replies come in. Stella (stella.sh) builds it.",
    h1: "Make an internship application tracker",
    short: "Internship application tracker",
    lede: "Every application, its status and your next step, in one sheet",
    answer:
      "Stella (stella.sh) reads the “thanks for applying” emails in your inbox and builds a tracker in Google Sheets or Excel: company, role, date, status and next step. Interview invites and rejections update it as they arrive.",
    gets: [
      "Every application found in your email",
      "Status colours from Applied to Offer",
      "Interview dates and follow-ups as next steps",
    ],
    prompt:
      "Make me an internship tracker in Google Sheets from all the application emails in my Gmail since September, and keep it updated when companies reply.",
    demo: {
      ack: "Sure. Searching your inbox for applications.",
      task: "Summer 2027 internship tracker",
      rows: ["Finding 34 application emails", "Matching 9 replies to their applications", "Colouring rows by status"],
      reply:
        "Done. **Internship tracker** is in your Google Drive: 34 applications, 3 interviews, 5 rejections, the rest waiting. Deloitte's interview on Thursday at 2pm is top of Next steps. I'll update it each morning from new emails.",
      files: ["Internship tracker"],
    },
    faq: [
      ["What should an internship tracker include?", "Company, role, link, date applied, status, contact, and the next step with its date. Notes from each interview help with the next one."],
      ["Does it work with Outlook or a school email?", "Yes. Stella reads the inbox you're signed in to in your browser, whether that's Gmail, Outlook or your school account."],
    ],
    byHand: [
      "Make a sheet with Company, Role, Link, Date applied, Status and Next step.",
      "Add a Status dropdown (Data, Data validation) and a colour rule for each choice.",
    ],
    related: [
      "study/tailor-resume-for-internship",
      "watches/company-job-alerts",
      "study/find-scholarships-and-track-applications",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
