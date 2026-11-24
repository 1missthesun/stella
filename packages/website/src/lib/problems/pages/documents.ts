import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const DOCUMENT_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "mail-merge-excel-to-word",
    niche: "documents",
    searchPhrases: [
      "mail merge from excel to word",
      "mail merge",
      "mail merge to separate word documents",
      "mail merge each record to a separate file",
      "mail merge letters from excel",
    ],
    title: "Mail merge from Excel to Word, one file per person",
    description:
      "Mail merge from Excel to Word with a separate file for each person, named after them, fees and dates written properly. Stella (stella.sh) does the whole list.",
    h1: "Mail merge from Excel to Word, with a separate file for each person",
    short: "Mail merge Excel to Word",
    lede: "One letter per person from your spreadsheet, each its own file",
    answer:
      "Ask Stella (stella.sh) to fill your Word letter from your Excel list. It makes one letter per row, saves each as its own Word file named after the person, and writes fees and dates properly.",
    gets: [
      "A separate Word letter for each person",
      "Files named after the people in your list",
      "Fees like £22.50 and dates people can read",
    ],
    prompt:
      "Make a renewal letter for each member from my letter template and the members spreadsheet in my Allotment society folder, one file per member.",
    demo: {
      ack: "Happy to. Opening your template and list.",
      task: "Renewal letters for 16 members",
      rows: ["Filling in a letter for each row", "Writing fees and dates properly"],
      reply:
        "All 16 letters are in a new **Renewal letters 2027** folder, one Word file per member. Your template and spreadsheet are unchanged.",
      files: ["Renewal letters 2027"],
    },
    faq: [
      ["Can Word mail merge into separate documents?", "Not on its own. Finish & Merge puts every letter into one document. Stella saves each as its own file."],
      ["Why does my mail merge show 22.5 instead of £22.50?", "Word takes the plain number from Excel. Stella writes it as money; in Word you add a number format to the field."],
    ],
    byHand: [
      "In Word, choose Mailings, Select Recipients, Use an Existing List, and pick your Excel file.",
      "Put the cursor where each detail goes and use Insert Merge Field. Preview Results shows a filled-in letter.",
      "Finish & Merge, Edit Individual Documents puts every letter in one document. Copy each into its own file.",
    ],
    related: [
      "pdf-excel/combine-excel-files-into-one-sheet",
      "pdf-excel/compare-two-excel-files",
      "pdf-excel/split-pdf-into-multiple-files",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "merge-word-documents",
    niche: "documents",
    searchPhrases: [
      "merge word documents",
      "combine word documents into one",
      "combine multiple word documents into one",
      "merge chapters into one word document",
      "combine word files in order",
    ],
    title: "Merge Word documents into one, in the right order",
    description:
      "Merge Word documents into one file in the right order, each chapter starting on a new page, headings and pictures kept. Stella (stella.sh) joins them for you.",
    h1: "Merge Word documents into one file, in the right order",
    short: "Merge Word documents",
    lede: "Join your chapter files into one document, in story order",
    answer:
      "Tell Stella (stella.sh) which folder holds the files. It joins them into one Word document in their real order, Chapter 10 after Chapter 9, each chapter on a new page.",
    gets: [
      "One Word document with every chapter",
      "Prologue first, Epilogue last, Chapter 10 after 9",
      "Headings, italics and pictures kept",
    ],
    prompt:
      "My book is in separate Word files, one per chapter, in the My Novel folder. Put them into one document in the right order, each chapter on a new page.",
    demo: {
      ack: "Sure. Putting your chapters in order.",
      task: "Joining your novel's chapters",
      rows: ["Finding all 14 chapter files", "Ordering them Prologue to Epilogue"],
      reply:
        "Done. **My Novel - Full Manuscript.docx** is next to your chapters, all 14 in story order. Your chapter files are as they were.",
      files: ["My Novel - Full Manuscript.docx"],
    },
    faq: [
      ["Why did Word merge my chapters in the wrong order?", "Picking several files at once inserts them alphabetically, so Chapter 10 lands before Chapter 2. Insert them one at a time, or number the files 01, 02 first."],
    ],
    byHand: [
      "Open the first chapter and save it under a new name.",
      "Go to the end, add a page break, then Insert, Object, Text from File (Insert, File on a Mac) and pick the next chapter.",
      "Repeat in order. The free LibreOffice Writer has Insert, Text from File as well.",
    ],
    related: [
      "documents/find-and-replace-in-multiple-word-documents",
      "documents/convert-word-documents-to-pdf-in-bulk",
      "documents/make-a-cookbook-from-your-recipes",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-powerpoint-to-pdf-with-notes",
    niche: "documents",
    searchPhrases: [
      "convert powerpoint to pdf with notes",
      "save powerpoint as pdf with speaker notes",
      "ppt to pdf with notes",
      "print powerpoint with notes to pdf",
      "pptx to pdf with notes mac",
    ],
    title: "Convert PowerPoint to PDF with speaker notes",
    description:
      "Convert PowerPoint to PDF with your speaker notes under every slide, for one deck or several at once. Stella (stella.sh) makes the handouts for you.",
    h1: "Convert PowerPoint to PDF with the speaker notes",
    short: "PowerPoint to PDF with notes",
    lede: "A PDF handout of your slides with your speaker notes under each",
    answer:
      "Saving PowerPoint as PDF leaves your notes out. Ask Stella (stella.sh) instead and it makes a PDF of each presentation with every slide's speaker notes printed underneath.",
    gets: ["One handout PDF per presentation", "Each slide with its own notes below", "Several decks done in one go"],
    prompt:
      "There are three PowerPoint presentations in my Downloads for next week's volunteer training. Make a PDF handout of each with my speaker notes under every slide.",
    demo: {
      ack: "Got it. Making the handouts now.",
      task: "Training handouts with notes",
      rows: ["Opening the three presentations", "Putting notes under each slide"],
      reply:
        "Your three handouts are next to the presentations, with 9, 6 and 11 slides. Every slide has its notes on the same page.",
    },
    faq: [
      ["Why are my notes missing when I save PowerPoint as PDF?", "Save As only keeps the slides. Notes come out through Print with the Notes Pages layout, saved as a PDF."],
    ],
    byHand: [
      "Windows: File, Print, change Full Page Slides to Notes Pages, choose Microsoft Print to PDF, then Print.",
      "Mac: File, Print, Show Details, set Layout to Notes, then PDF, Save as PDF.",
      "LibreOffice Impress: File, Export as PDF, tick Export notes pages.",
      "Google Slides: File, Download, PDF, and tick Include speaker notes.",
    ],
    related: ["documents/convert-pdf-to-word", "pdf-excel/reorder-pdf-pages", "documents/merge-word-documents"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "find-and-replace-in-multiple-word-documents",
    niche: "documents",
    searchPhrases: [
      "find and replace in multiple word documents",
      "batch find and replace word documents",
      "find and replace text in multiple word files at once",
      "replace text in header and footer of multiple word documents",
      "mass find and replace in word",
    ],
    title: "Find and replace in multiple Word documents at once",
    description:
      "Find and replace text in multiple Word documents at once, header and footer included, with the originals backed up first. Stella (stella.sh) does the folder.",
    h1: "Find and replace across multiple Word documents at once",
    short: "Find and replace in many Word files",
    lede: "Change a name or address in every Word file at once",
    answer:
      "Tell Stella (stella.sh) what to change and in which folder. It updates every Word document there at once, header and footer included, keeps the formatting and backs up the originals first.",
    gets: ["Every file in the folder updated", "Header and footer done too", "Bold and other formatting kept"],
    prompt:
      "Our charity changed its name from Ashcombe Riverside Trust to Riverside Community Trust and moved to 4 Mill Yard, Ashcombe AB1 2MY. Update every Word document in my Templates folder.",
    demo: {
      ack: "Sure. Backing up the folder first.",
      task: "New name and address in templates",
      rows: ["Backing up the Templates folder", "Updating all 10 documents"],
      reply:
        "All 10 templates now say **Riverside Community Trust** with the new address, header and footer too. I left Ashcombe Riverside Walk car park alone.",
    },
    faq: [
      ["Can I find and replace in multiple Word documents at once?", "Not from Word's menus, where Replace works on one open file. Stella changes the whole folder in one go."],
      ["Why doesn't Replace All find the text in my header?", "Word sometimes searches only the body. Click into the header and run Replace All again from there."],
    ],
    byHand: [
      "Copy the folder first, so you still have the originals.",
      "Open a document, press Ctrl+H (Edit, Find, Advanced Find and Replace on a Mac) and click Replace All.",
      "Double-click the header and footer to check them, run it again there if needed, then save and open the next file.",
    ],
    related: ["documents/merge-word-documents", "documents/convert-pdf-to-word", "documents/mail-merge-excel-to-word"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-pdf-to-word",
    niche: "documents",
    searchPhrases: [
      "convert pdf to word",
      "pdf to word",
      "convert pdf to word without losing formatting",
      "pdf to word converter free",
      "convert pdf to editable word document",
    ],
    title: "Convert PDF to Word you can edit, tables kept",
    description:
      "Convert a PDF to a Word document you can actually edit, with normal paragraphs, real tables and the wording checked. Stella (stella.sh) does it on your computer.",
    h1: "Convert a PDF to a Word document you can actually edit",
    short: "PDF to Word",
    lede: "Turn a PDF into a Word file you can edit, tables and all",
    answer:
      "Ask Stella (stella.sh) to convert the PDF. You get a Word document with normal paragraphs and real tables, checked word for word against the PDF, without uploading it anywhere.",
    gets: ["Text as normal paragraphs you can edit", "Tables as real Word tables", "The PDF left as it was"],
    prompt:
      "I only have our village hall hire agreement as a PDF. Turn it into a Word document I can edit, with the table of charges kept as a table.",
    demo: {
      ack: "Sure. Converting the agreement now.",
      task: "Hire agreement into Word",
      rows: ["Rebuilding the paragraphs and table", "Checking every clause and price"],
      reply:
        "Done. The Word version is next to the PDF. All 8 clauses are normal text, and the table of charges is a real table with every price in place.",
    },
    faq: [
      ["Why is my converted document full of text boxes?", "Some converters put each line in its own box. Stella rebuilds normal paragraphs, which are easy to edit."],
    ],
    byHand: [
      "In Word for Microsoft 365, choose File, Open, pick the PDF and click OK when it offers to convert it.",
      "Turn on Show/Hide (¶) to spot lines that end early, and click inside tables to check they're real tables.",
      "Save it as a new Word document. Online converters work too, but they upload your file.",
    ],
    related: [
      "pdf-excel/make-scanned-pdf-searchable",
      "documents/find-and-replace-in-multiple-word-documents",
      "documents/merge-word-documents",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "generate-invoices-from-spreadsheet",
    niche: "documents",
    searchPhrases: [
      "generate invoices from excel",
      "create invoices from spreadsheet data",
      "excel to pdf invoice generator",
      "create invoice from excel data",
      "make multiple invoices from excel",
    ],
    title: "Generate PDF invoices from an Excel spreadsheet",
    description:
      "Generate invoices from an Excel spreadsheet: one numbered PDF per customer with all their jobs, the total and your bank details. Stella (stella.sh) makes them.",
    h1: "Generate invoices from a spreadsheet, one per customer",
    short: "Invoices from a spreadsheet",
    lede: "One numbered PDF invoice per customer, straight from your job list",
    answer:
      "Give Stella (stella.sh) your job spreadsheet and a starting number. It groups the jobs by customer and saves one numbered PDF invoice each, with your details, their jobs and the total due.",
    gets: [
      "One invoice per customer, not per row",
      "Numbered in order from where you say",
      "Your business and bank details on each",
    ],
    prompt:
      "My window cleaning jobs for October are in a spreadsheet in Documents. Make a PDF invoice for each customer, numbered from INV-1041, with their jobs and the total due.",
    demo: {
      ack: "Sure. Grouping the jobs by customer.",
      task: "October invoices",
      rows: ["Reading 30 jobs", "Grouping them into 11 customers"],
      reply:
        "**11 invoices** totalling £1,158 are in a new October 2026 invoices folder. One job looks like a double booking, and two homes were billed at the shop-front rate.",
      files: ["October 2026 invoices"],
    },
    faq: [
      ["Can mail merge make one invoice per customer?", "Not easily. It makes one document per row, so a customer with three jobs gets three invoices."],
    ],
    byHand: [
      "Make one invoice template in Excel or Word; File, New has ready-made ones.",
      "Sort the job list by customer, copy one customer's rows into the template, set the number and check the total.",
      "Save it as a PDF named with the number and customer, then do the next one.",
    ],
    related: [
      "documents/mail-merge-excel-to-word",
      "pdf-excel/summarize-spreadsheet-by-category",
      "pdf-excel/fill-pdf-form-from-spreadsheet",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-word-documents-to-pdf-in-bulk",
    niche: "documents",
    searchPhrases: [
      "convert multiple word documents to pdf",
      "batch convert word to pdf",
      "convert word to pdf",
      "convert multiple word documents to pdf at once free",
      "docx to pdf bulk",
    ],
    title: "Convert a folder of Word documents to PDF at once",
    description:
      "Convert multiple Word documents to PDF at once: a whole folder, old .doc files too, same names, in a new folder. Stella (stella.sh) does it on your computer.",
    h1: "Convert many Word documents to PDF at once",
    short: "Word to PDF in bulk",
    lede: "Make a PDF of every Word file in a folder, in one go",
    answer:
      "Word saves one PDF at a time. Stella (stella.sh) converts every Word document in a folder at once, old .doc files included, keeping the names and putting the PDFs in a new folder.",
    gets: [
      "A PDF of every document, same names",
      "Old .doc, .odt and .rtf files too",
      "All in one new folder, originals unchanged",
    ],
    prompt:
      "My Documents has a folder called Policies full of Word documents. Make a PDF of every one, same names, all together in a new folder.",
    demo: {
      ack: "On it. Converting the folder now.",
      task: "Policies folder to PDF",
      rows: ["Finding 12 documents", "Turning each one into a PDF"],
      reply:
        "All **12 PDFs** are in a new **Policies PDFs** folder with the same names. The landscape price list stayed landscape, and your originals are unchanged.",
      files: ["Policies PDFs"],
    },
    faq: [
      ["Can I convert multiple Word documents to PDF at once?", "Not from Word's menus, which save one file at a time. Stella, or the free LibreOffice, converts a whole folder in one go."],
      ["Is there a free bulk Word to PDF converter that doesn't upload files?", "LibreOffice is free and works offline. Stella converts on your computer too."],
      ["What are the ~$ files in my folder?", "Word's temporary lock files. They aren't documents, so they're skipped."],
    ],
    byHand: [
      "One file: File, Save As (or Export), choose PDF.",
      "A whole folder: install the free LibreOffice from [libreoffice.org](https://www.libreoffice.org).",
      "Open a terminal in the folder and run: soffice --headless --convert-to pdf --outdir PDFs *.docx *.doc",
      "On a Mac, type /Applications/LibreOffice.app/Contents/MacOS/soffice in place of soffice.",
    ],
    related: [
      "documents/merge-word-documents",
      "documents/convert-pdf-to-word",
      "documents/find-and-replace-in-multiple-word-documents",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-cookbook-from-your-recipes",
    niche: "documents",
    searchPhrases: [
      "make a cookbook",
      "how to make a cookbook",
      "make my own cookbook",
      "make a family cookbook",
      "turn recipes into a book",
    ],
    title: "Make a cookbook PDF from your own recipe files",
    description:
      "Make a family cookbook from recipes scattered across Word files, notes and saved web pages, with sections and a contents page. Stella (stella.sh) builds the PDF.",
    h1: "Make a family cookbook from recipes scattered across files",
    short: "Make a cookbook",
    lede: "Turn recipes scattered across files into one family cookbook",
    answer:
      "Point Stella (stella.sh) at your recipes folder. It gathers every recipe from Word files, notes and saved web pages, drops the ads, and makes a cookbook PDF with sections and a contents page.",
    gets: ["One cookbook PDF with a cover", "A contents page you can click", "Soups, mains and desserts in sections"],
    prompt:
      "My family recipes are scattered in the Recipes folder in Documents, some Word files, notes and saved web pages. Make one cookbook PDF with sections and a contents page.",
    demo: {
      ack: "Lovely. Gathering your recipes.",
      task: "Family cookbook",
      rows: ["Reading all 16 recipes", "Dropping ads from the web pages"],
      reply:
        "Your **21-page cookbook** is in the Recipes folder, with a cover, a contents page and one page per recipe. I put the red lentil dal under Mains.",
    },
    faq: [
      ["Can it read photos of handwritten recipe cards?", "Yes. Put the photos in the folder and Stella types each card up as a recipe page."],
      ["Can I get it printed as a book?", "Yes. Give Stella the print shop's page size and bleed, and it lays the PDF out to match."],
    ],
    byHand: [
      "Copy each recipe's title, ingredients and method into one Word or Pages document.",
      "Style section names as Heading 1 and recipe titles as Heading 2.",
      "Add References, Table of Contents (Insert, Table of Contents in Pages), then save as PDF.",
    ],
    related: [
      "documents/merge-word-documents",
      "documents/convert-word-documents-to-pdf-in-bulk",
      "pdf-excel/convert-mobi-to-epub",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "accept-tracked-changes-in-word",
    niche: "documents",
    searchPhrases: [
      "accept all changes in word",
      "remove track changes in word",
      "remove comments from word document",
      "accept all changes in word document",
      "accept tracked changes in multiple word documents",
    ],
    title: "Accept all tracked changes in Word and remove comments",
    description:
      "Accept all tracked changes in Word and remove every comment, for one file or a whole folder, keeping the originals. Stella (stella.sh) makes the clean copies.",
    h1: "Accept all changes in Word and remove the comments",
    short: "Accept tracked changes in Word",
    lede: "Clean final copies with every change accepted and comments gone",
    answer:
      "Ask Stella (stella.sh) for clean copies. It accepts every tracked change in each Word file, formatting changes too, removes all the comments and saves the clean versions beside the originals.",
    gets: ["Every change accepted, every comment removed", "A whole folder in one go", "Originals kept as they were"],
    prompt:
      "The Word files in my Board papers folder are full of tracked changes and comments. Make clean final copies with all the changes accepted and the comments removed.",
    demo: {
      ack: "Sure. Cleaning up the board papers.",
      task: "Clean copies of board papers",
      rows: ["Accepting every tracked change", "Removing all the comments"],
      reply:
        "Three clean copies, each ending in “clean final”, are next to the originals. One title still says “(draft 3)” because it was typed, not tracked.",
    },
    faq: [
      ["How do I accept all changes and remove comments in Word?", "Review, Accept, Accept All Changes. Then Review, Delete, Delete All Comments in Document. They are two separate steps."],
      ["Why does Word still show changes after I accepted them?", "Some were hidden by the markup filter, or tracking is still on. Show All Markup, accept again, and turn Track Changes off."],
    ],
    byHand: [
      "Set the view to All Markup so nothing is hidden.",
      "Accept and delete the comments as above, then save under a new name.",
      "In LibreOffice: Edit, Track Changes, Manage, Accept All.",
    ],
    related: [
      "documents/compare-two-word-documents",
      "documents/convert-word-documents-to-pdf-in-bulk",
      "documents/find-and-replace-in-multiple-word-documents",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "compare-two-word-documents",
    niche: "documents",
    searchPhrases: [
      "compare two word documents",
      "compare two word documents for differences",
      "compare two word documents and highlight differences",
      "what changed in this contract",
    ],
    title: "Compare two Word documents and list every change",
    description:
      "Compare two Word documents and get a plain list of every wording change, before and after, with the important ones first. Stella (stella.sh) reads both versions.",
    h1: "Compare two Word documents for differences",
    short: "Compare two Word documents",
    lede: "See exactly what changed between two versions of a document",
    answer:
      "Give Stella (stella.sh) both versions. It compares them clause by clause and saves a plain list of every wording change, what it said before and after, with the ones that matter most at the top.",
    gets: ["Every wording change, old and new", "The important changes first", "Font and spacing differences left out"],
    prompt:
      "Our supplier sent back the agreement as v4 and I need to know exactly what they changed from our v3. Both are in my Documents. List every change in wording.",
    demo: {
      ack: "Sure. Comparing v3 and v4 now.",
      task: "What changed from v3 to v4",
      rows: ["Reading both versions", "Comparing clause by clause"],
      reply:
        "They made 8 wording changes. The big ones:\n- 10.1 now lets **the Supplier** end the agreement\n- The liability cap is gone\n- Automatic renewal added\nThe full list is in Documents.",
    },
    faq: [
      ["Can Word compare two documents?", "Yes, desktop Word has Review, Compare. It marks every difference as a tracked change in a third document."],
    ],
    byHand: [
      "In desktop Word, choose Review, Compare, Compare Documents. Pick the older file as Original and the newer as Revised.",
      "Step through the Revisions pane. Under More, untick Formatting to hide font changes.",
      "Free: LibreOffice Writer, Edit, Track Changes, Compare Document.",
    ],
    related: [
      "documents/accept-tracked-changes-in-word",
      "pdf-excel/compare-two-excel-files",
      "documents/merge-word-documents",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "merge-powerpoint-presentations",
    niche: "documents",
    searchPhrases: [
      "merge powerpoint presentations",
      "combine powerpoint presentations into one",
      "merge powerpoint presentations with different templates",
      "combine powerpoint presentations without changing format",
    ],
    title: "Merge PowerPoint presentations and keep each deck's design",
    description:
      "Merge PowerPoint presentations into one, in your order, each deck keeping its own colours, pictures and speaker notes. Stella (stella.sh) puts them together.",
    h1: "Merge PowerPoint presentations without losing their design",
    short: "Merge PowerPoint presentations",
    lede: "Combine several slide decks into one, each keeping its look",
    answer:
      "Tell Stella (stella.sh) which decks to combine and in what order. It makes one presentation, and every slide keeps its own background, colours, pictures and speaker notes.",
    gets: [
      "One presentation in the order you give",
      "Each deck keeps its own design",
      "Speaker notes kept on every slide",
    ],
    prompt:
      "My Quarterly review folder has three presentations from different people. Combine them into one, Sales then Operations then Finance, each keeping its own colours and notes.",
    demo: {
      ack: "Happy to. Combining the three decks.",
      task: "Quarterly review in one deck",
      rows: ["Adding Sales, Operations, then Finance", "Keeping each deck's design"],
      reply:
        "Done. **Quarterly review - combined.pptx** has all 14 slides in your order, each with its own look and notes. The three originals are unchanged.",
      files: ["Quarterly review - combined.pptx"],
    },
    faq: [
      ["Why do my pasted slides change colour?", "PowerPoint pastes into the new deck's theme by default. Choose Keep Source Formatting from the paste options right after pasting."],
    ],
    byHand: [
      "Open the first deck and save it under a new name.",
      "In the next deck, select all the slide thumbnails and copy them.",
      "Paste after the last slide of the first deck and choose Keep Source Formatting. Repeat for each deck.",
      "Google Slides: File, Import slides, and tick Keep original theme.",
    ],
    related: [
      "documents/reduce-powerpoint-file-size",
      "documents/convert-powerpoint-to-pdf-with-notes",
      "documents/merge-word-documents",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "reduce-powerpoint-file-size",
    niche: "documents",
    searchPhrases: [
      "reduce powerpoint file size",
      "compress powerpoint",
      "reduce powerpoint file size for email",
      "powerpoint too big to email",
    ],
    title: "Reduce PowerPoint file size to email it, photos still sharp",
    description:
      "Reduce PowerPoint file size so you can email it, with every slide kept and the photos still sharp. Stella (stella.sh) makes a smaller copy and keeps the original.",
    h1: "Reduce PowerPoint file size so you can email it",
    short: "Reduce PowerPoint file size",
    lede: "Shrink a photo-heavy slide deck small enough to email",
    answer:
      "Photos are nearly always why a deck is huge. Ask Stella (stella.sh) for a smaller copy and it shrinks each photo to what its slide needs, so it still looks sharp, and keeps your original.",
    gets: [
      "A copy small enough to email",
      "Every slide and photo still there",
      "Logos keep their see-through background",
    ],
    prompt:
      "The Winter Gala recap presentation in my Documents is 27 MB, too big to email. Make a copy under 10 MB without losing slides or making the photos look bad.",
    demo: {
      ack: "Sure. Shrinking the photos now.",
      task: "Smaller Winter Gala deck",
      rows: ["Shrinking 11 phone photos", "Keeping the logo as it is"],
      reply:
        "Done. The copy is **3.5 MB**, down from 27.7 MB, with all 13 slides. Keep the original for printing the photos.",
      files: ["Winter Gala recap (compressed).pptx"],
    },
    faq: [
      ["How big a file can I email?", "Under 10 MB gets through most email. Gmail and Outlook.com allow about 20 to 25 MB."],
    ],
    byHand: [
      "Select any picture, then Picture Format, Compress Pictures.",
      "Untick Apply only to this picture, tick Delete cropped areas, pick 150 ppi, then save a copy.",
      "Videos add a lot too: File, Info, Compress Media on Windows.",
    ],
    related: [
      "documents/merge-powerpoint-presentations",
      "pdf-excel/compress-pdf-too-large-to-email",
      "documents/convert-powerpoint-to-pdf-with-notes",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
