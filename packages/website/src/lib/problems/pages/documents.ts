import { PROOFS, webCuts } from "../media";
import type { ProblemPage } from "../types";

export const DOCUMENT_PAGES: ProblemPage[] = [
  {
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
      "Make one Word letter per row of an Excel sheet: Word's Mailings merge makes one big file, here's how to get separate ones, or let Stella (stella.sh) do both.",
    h1: "Mail merge from Excel to Word, with a separate file for each person",
    short: "Mail merge Excel to Word",
    lede: "16 renewal letters, one Word file per member, with fees and dates written properly.",
    answer:
      "In Word, open your letter and use Mailings, Select Recipients, Use an Existing List to pick the Excel file, insert the merge fields, then Finish & Merge. Word puts every letter into one big document; separate files per person need a macro, a paid add-in or splitting it by hand. Stella (stella.sh) fills your template once per row and saves each letter as its own Word file named after the person.",
    stellaSteps: [
      "Opens your letter template and the members spreadsheet in the folder you name, including Word merge fields like «First_Name» and «Renewal_Fee»",
      "Fills a copy of the template for each of the 16 rows, keeping the template's layout",
      "Writes fees as money with pence (£22.50, not 22.5) and dates the way people read them, not 2027-01-01 00:00:00",
      "Saves each letter as a Word document named after the member, in a new Renewal letters 2027 folder, without changing the template or the spreadsheet",
      "Shows one letter as it looks on the page, and points out a quirk: the membership type is capitalised mid-sentence because that's how the spreadsheet has it",
    ],
    prompt:
      "Make a separate renewal letter for each member using my letter template and the members spreadsheet (they're in my Allotment society folder). Save each one as a Word document named after the member.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "16 letters in about 3 minutes 15 seconds. Checked afterwards against an answer key written before the run: one file per member, each named after them, every letter complete and correct (name, greeting, address, membership type, fee and renewal date) with no merge codes left, fees shown with pence, and the template and spreadsheet unchanged.",
      note: "The allotment society, its members and their addresses are fictitious, made for this run; the template uses real Word merge fields. The work is sped up 12×.",
      video: {
        src: `${PROOFS}/documents/mail-merge-excel-to-word/proof.mp4`,
        cuts: webCuts("documents/mail-merge-excel-to-word"),
        poster: `${PROOFS}/documents/mail-merge-excel-to-word/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 52.7,
        realDuration: 195,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A Word letter template and a members spreadsheet are in Documents/Allotment society." },
        { at: 2, text: "The prompt: a separate renewal letter for each member, saved as a Word document named after them." },
        { at: 20.8, text: "Stella replies: one letter per member, the originals left unchanged, and it'll flag missing or odd details." },
        { at: 26.7, text: "Filling in 16 letters and checking them, sped up 12×." },
        { at: 38.7, text: "Done: 16 Word letters in a new folder, a preview of one, and a note about the capital letter in “Full plot”." },
      ],
    },
    manualTitle: "Merge them yourself in Word",
    manualSteps: [
      {
        title: "Prepare the spreadsheet",
        body: "One header row, one row per person, no blank rows or merged cells. Give each column a plain name (First Name, Renewal Fee). Word reads the stored value, not the cell's formatting, so check fees and dates in the preview later.",
      },
      {
        title: "Connect the letter to Excel",
        body: "Open the letter in Word, choose Mailings, Select Recipients, Use an Existing List, and pick the workbook and sheet. Put the cursor where each detail goes and use Insert Merge Field. Preview Results shows a real filled-in letter.",
      },
      {
        title: "Fix fees and dates",
        body: "If a fee shows as 22.5 or a date as a long number, press Alt+F9 (Option+F9 on a Mac) to show field codes and add a format switch, such as `{ MERGEFIELD Renewal_Fee \\# £0.00 }` or `{ MERGEFIELD Renewal_Date \\@ \"d MMMM yyyy\" }`, then press it again to hide them.",
      },
      {
        title: "Finish & Merge",
        body: "Choose Finish & Merge, Edit Individual Documents, All. Word makes one new document holding every letter, separated by section breaks. Save it; this is the version you'd print in one go.",
      },
      {
        title: "Split it into one file per person",
        body: "Word has no button for this. Copy each letter into its own document and save it under the person's name, or save the merged document as a PDF and split that by page range. For dozens of people, a VBA macro or a paid add-in automates it.",
      },
    ],
    limits: [
      "Stella fills the template it's given and keeps its layout. Word IF fields, a different picture per person or optional paragraphs weren't part of this test; describe the rule in your prompt.",
      "It copied values exactly as typed, so “Full plot” kept its capital letter mid-sentence. It pointed this out and offered to fix it; tidy the spreadsheet first if the wording matters.",
      "It makes the letters. It doesn't print, email or post them.",
      "Names and addresses from the spreadsheet go to the AI model you use in Stella. For member or customer data, choose your model accordingly.",
      "Recorded on Linux without Word installed. The letters are ordinary .docx files that open in Word, Pages or Google Docs.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can Word mail merge into separate documents?",
        a: "Not by itself. Finish & Merge makes one document holding every letter. Separate files take a macro, an add-in, splitting by hand, or a tool that writes each file directly, as Stella did here.",
      },
      {
        q: "Why does my mail merge show 22.5 instead of £22.50?",
        a: "Word merges the raw number from Excel, not how the cell is formatted. Add a number switch to the field, `\\# £0.00`, or store the fee as text in the spreadsheet.",
      },
      {
        q: "Can I get a PDF per person instead?",
        a: "Yes. Ask Stella for PDFs, or in Word save the merged document as a PDF and [split it into one file per letter](/how/pdf-excel/split-pdf-into-multiple-files) by page range.",
      },
      {
        q: "Does it work with Google Sheets or a CSV?",
        a: "Yes, download the sheet as .xlsx or .csv; Word's merge reads both, and so does Stella. If your list is spread over several files, [combine them into one sheet](/how/pdf-excel/combine-excel-files-into-one-sheet) first.",
      },
    ],
    related: ["pdf-excel/combine-excel-files-into-one-sheet", "pdf-excel/compare-two-excel-files", "pdf-excel/split-pdf-into-multiple-files", "documents/generate-invoices-from-spreadsheet"],
    lastChecked: "2026-11-13",
    sources: [
      {
        label: "Microsoft: Use mail merge for bulk email, letters, labels and envelopes",
        href: "https://support.microsoft.com/en-us/office/use-mail-merge-for-bulk-email-letters-labels-and-envelopes-f488ed5b-b849-4c11-9cff-932c49474705",
      },
      { label: "Microsoft: Format field results (field switches)", href: "https://support.microsoft.com/en-us/office/format-field-results-baa61f5a-5636-4f11-ab4f-6c36ae43508c" },
      { label: "Ablebits: Mail merge from Excel to Word", href: "https://www.ablebits.com/office-addins-blog/mail-merge-excel-word/" },
    ],
  },
  // ---- batch 3 (writer 2) ----
  {
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
      "Combine separate Word files, such as one per chapter, into one document in story order with each part on a new page, with Word's Text from File or Stella (stella.sh).",
    h1: "Merge Word documents into one file, in the right order",
    short: "Merge Word documents",
    lede: "Fourteen chapter files joined into one manuscript, Chapter 10 after Chapter 9.",
    answer:
      "In Word, open the first file, put the cursor at the end, add a page break, then use Insert, Object, Text from File to pull in the next one. Do it one file at a time: picking several at once inserts them in file-list order, which puts Chapter 10 before Chapter 2. Stella (stella.sh) joins the files on your computer by chapter number, starts each one on a new page, and keeps headings, italics and pictures.",
    stellaSteps: [
      "Finds the chapter files in the folder you name (here, 14 files in Documents/My Novel)",
      "Orders them by what they are, not by file name: Prologue, Chapters 1 to 12, then Epilogue, so Chapter 10 doesn't land after Chapter 1",
      "Builds one new Word document with a page break before every chapter, carrying over each chapter's heading style, italic lines and the map picture in Chapter 5",
      "Saves it as My Novel - Full Manuscript.docx next to the chapters and leaves every chapter file as it was",
      "Reports the order it used and that nothing was missing or duplicated",
    ],
    prompt:
      "I wrote my book as separate Word files, one per chapter, in the My Novel folder in Documents. Put them all together into one Word document in the right order, with each chapter starting on a new page.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "One 14-chapter manuscript in under 4 minutes. Checked afterwards against an answer key written before the run: all 14 chapter headings in story order (Chapter 10 after Chapter 9, Epilogue last), all 84 paragraphs present and in order, every chapter after the first on a new page, the Chapter 5 picture kept, italics and Heading styles kept, and the chapter files unchanged.",
      note: "The novel, its chapters and the map picture are fictitious, made for this run. The work is sped up 14×.",
      video: {
        src: `${PROOFS}/documents/merge-word-documents/proof.mp4`,
        cuts: webCuts("documents/merge-word-documents"),
        poster: `${PROOFS}/documents/merge-word-documents/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 50.6,
        realDuration: 225,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Fourteen chapter files are in Documents/My Novel." },
        { at: 1.7, text: "The prompt: put them into one Word document in the right order, each chapter on a new page." },
        { at: 17.7, text: "Stella replies that it's combining the chapters, the originals won't change, and it will flag gaps or stray drafts." },
        { at: 23.7, text: "Joining the chapters, sped up 14×." },
        { at: 36.7, text: "Done: one manuscript running Prologue, Chapters 1 to 12, Epilogue, ordered by chapter number rather than file name." },
      ],
    },
    manualTitle: "Join them yourself in Word",
    manualSteps: [
      {
        title: "Check the order before you start",
        body: "Sorted by name, files run Chapter 1, Chapter 10, Chapter 11, Chapter 12, Chapter 2, and Epilogue sorts before Prologue. Write down the real order, or rename the files with two-digit numbers (01, 02 … 12) so the folder sorts correctly.",
      },
      {
        title: "On Windows: Text from File",
        body: "Open the first file and save it under a new name, such as Full manuscript.docx. Press Ctrl+End, choose Insert, Page Break, then Insert, Object (the small arrow), Text from File, and pick the next chapter. Repeat for each file in order.",
      },
      {
        title: "On a Mac: Insert, File",
        body: "In Word for Mac, open the first chapter, save a copy under a new name, go to the end, choose Insert, Break, Page Break, then Insert, File (called Text from File in some versions) and pick the next chapter. Repeat in order.",
      },
      {
        title: "Check headings and pictures",
        body: "Open the Navigation Pane (View, Navigation Pane) and check every chapter title is listed once, in order. Scroll to any chapter with a picture to make sure it came across, and check that page and section breaks didn't change your margins.",
      },
      {
        title: "Free alternative: LibreOffice Writer",
        body: "The free LibreOffice Writer has Insert, Text from File too. Open the first chapter, add a page break with Ctrl+Enter, insert the next file, and save the result as a .docx.",
      },
    ],
    limits: [
      "Every chapter's text and formatting came through here, but page setup that differs per file (different margins or headers per chapter) follows the first file unless each chapter keeps its own section.",
      "Comments and tracked changes come across as they are. Stella doesn't accept or reject them unless you ask.",
      "Stella decides the order from chapter numbers and names like Prologue and Epilogue. If your files are called things like “The storm” and “Arrival”, say the order in the prompt.",
      "The joining runs on your computer. The AI model you use in Stella sees file names and whatever chapter text it reads to check the result.",
      "Recorded on Linux without Word installed. The manuscript is an ordinary .docx that opens in Word, Pages or Google Docs.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why did Word merge my chapters in the wrong order?",
        a: "Selecting several files in Text from File inserts them in the order the dialog lists them, which is alphabetical: Chapter 10 comes before Chapter 2. Insert one file at a time, or rename them 01, 02 and so on first.",
      },
      {
        q: "How do I start each chapter on a new page?",
        a: "Put a page break (Ctrl+Enter, or Cmd+Enter on a Mac) before each inserted file. If your chapter titles use the Heading 1 style, you can instead set that style's paragraph option to Page break before, which does it everywhere at once.",
      },
      {
        q: "Will the merged document keep my headings for a table of contents?",
        a: "Yes, when the chapter titles use Word's Heading styles. Stella kept them here, so References, Table of Contents works on the manuscript straight away.",
      },
      {
        q: "Can I get a PDF of the whole book instead?",
        a: "Yes. Save the merged document as a PDF from Word (File, Save As, PDF), or ask Stella for a PDF alongside the .docx. If you only have a PDF and need to edit it, [convert the PDF to Word](/how/documents/convert-pdf-to-word) first.",
      },
    ],
    related: ["documents/find-and-replace-in-multiple-word-documents", "documents/convert-pdf-to-word", "documents/mail-merge-excel-to-word"],
    lastChecked: "2026-11-13",
    sources: [{ label: "Microsoft: Insert a document in Word", href: "https://support.microsoft.com/en-us/word/insert-a-document-in-word" }],
  },
  {
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
      "Save a PowerPoint as a PDF with your speaker notes under each slide: the Notes Pages print setting on Windows and Mac, or Stella (stella.sh) doing several decks at once.",
    h1: "Convert PowerPoint to PDF with the speaker notes",
    short: "PowerPoint to PDF with notes",
    lede: "Three decks turned into handouts, each slide with its notes underneath.",
    answer:
      "Save As PDF leaves your notes out. Use File, Print instead: on Windows choose Notes Pages under the layout and print to Microsoft Print to PDF; on a Mac set Layout to Notes and choose Save as PDF. Repeat for each presentation. Stella (stella.sh) exports every deck you point it to as a notes-page PDF on your computer and checks each slide's notes are printed with it.",
    stellaSteps: [
      "Finds the three presentations in Downloads, including one in the older 4:3 shape",
      "Exports each one as notes pages: one slide per page with that slide's speaker notes underneath",
      "Checks every handout has all its slides in order with the right notes on each page",
      "Saves them next to the decks as “<deck> - handout with notes.pdf” and leaves the .pptx files unchanged",
      "Points out anything odd: here, that the notes looked like placeholder text, quoting one so you can judge before printing",
    ],
    prompt:
      "There are three PowerPoint presentations in my Downloads for next week's volunteer training. Make a PDF handout of each one with my speaker notes under each slide.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Three handouts in under a minute and a half: 9, 6 and 11 slides. Checked afterwards against an answer key written before the run: one PDF per presentation, every slide title in order, every slide's speaker notes on the same page as the slide, and the presentations unchanged.",
      note: "The three training decks and their notes are fictitious, made for this run, which is why Stella called the notes placeholder text. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/documents/convert-powerpoint-to-pdf-with-notes/proof.mp4`,
        cuts: webCuts("documents/convert-powerpoint-to-pdf-with-notes"),
        poster: `${PROOFS}/documents/convert-powerpoint-to-pdf-with-notes/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 43.3,
        realDuration: 86,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Three PowerPoint decks are in Downloads." },
        { at: 1.6, text: "The prompt: a PDF handout of each, with the speaker notes under every slide." },
        { at: 11.6, text: "Stella replies that it has started a task and the original files won't change." },
        { at: 17.4, text: "Exporting and checking the three decks, sped up 3×." },
        { at: 29.4, text: "Done: three handouts in Downloads, one slide per page with notes, and a warning that the notes look like placeholder text." },
      ],
    },
    manualTitle: "Make the handouts yourself",
    manualSteps: [
      {
        title: "On Windows: print to PDF as Notes Pages",
        body: "Open the deck in PowerPoint, choose File, Print. Under Settings, click the layout box (it says Full Page Slides) and pick Notes Pages. Set the printer to Microsoft Print to PDF and click Print, then name the file.",
      },
      {
        title: "On a Mac: Layout, Notes",
        body: "In PowerPoint for Mac, choose File, Print, click Show Details if the panel is small, set Layout to Notes, then open the PDF menu at the bottom and choose Save as PDF. File, Save As, PDF drops the notes on a Mac.",
      },
      {
        title: "Free route: LibreOffice Impress",
        body: "Open the deck in the free LibreOffice Impress, choose File, Export as PDF, and on the General tab tick Export notes pages (and Export only notes pages, if you don't want a slides-only section in front). Click Export.",
      },
      {
        title: "Do the next deck",
        body: "These settings don't carry over between files, so repeat for each presentation. With several decks, LibreOffice can do them from a terminal in one go: `soffice --headless --convert-to 'pdf:impress_pdf_Export:{\"ExportOnlyNotesPages\":{\"type\":\"boolean\",\"value\":\"true\"}}' *.pptx`.",
      },
      {
        title: "Check before printing",
        body: "Open each PDF and scroll through: every slide should have its own notes underneath. Hidden slides are usually skipped; unhide them first if the handout needs them.",
      },
    ],
    limits: [
      "The handout is the notes-page layout: one slide per page, notes below. Three slides per page with lines for writing is a different handout setting; ask for it by name.",
      "Hidden slides are normally left out. Say so if you want them in.",
      "Stella reads the notes to check the handouts, so slide text and notes go to the AI model you use. The export itself runs on your computer.",
      "Recorded on Linux, where Stella used LibreOffice for the export. On Windows or a Mac it may use PowerPoint or install LibreOffice; fonts the deck uses but your computer lacks are swapped for similar ones.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why are my notes missing when I save PowerPoint as PDF?",
        a: "Save As and Export save slides only. Notes come out through Print with the Notes Pages layout (Windows) or Layout: Notes (Mac), saved as a PDF from the print dialog.",
      },
      {
        q: "Can I fit more than one slide per page with notes?",
        a: "Not with PowerPoint's own Notes Pages, which is one slide per page. Export to Word (File, Export, Create Handouts on Windows) gives a table of small slides with notes beside them that you can print as a PDF.",
      },
      {
        q: "Does this work for Google Slides or Keynote?",
        a: "Google Slides: File, Download, PDF, then tick Include speaker notes in Print settings and preview. Keynote: File, Print, choose Slide with notes. Or download the deck as .pptx and give it to Stella.",
      },
      {
        q: "Can Stella combine the handouts into one PDF?",
        a: "Yes, ask for that in the prompt. To put pages in a different order afterwards, see [reorder PDF pages](/how/pdf-excel/reorder-pdf-pages).",
      },
    ],
    related: ["documents/convert-pdf-to-word", "pdf-excel/reorder-pdf-pages", "documents/merge-word-documents"],
    lastChecked: "2026-11-13",
    sources: [
      {
        label: "Microsoft Q&A: Save PowerPoint as PDF with notes",
        href: "https://learn.microsoft.com/en-us/answers/questions/4920996/save-powerpoint-as-pdf-with-notes",
      },
      { label: "LibreOffice Help: PDF export options", href: "https://help.libreoffice.org/latest/en-US/text/shared/01/ref_pdf_export_general.html" },
    ],
  },
  {
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
      "Change a name or address in every Word file in a folder, headers and footers included, without breaking formatting: by hand, with a macro, or with Stella (stella.sh).",
    h1: "Find and replace across multiple Word documents at once",
    short: "Find and replace in many Word files",
    lede: "A new charity name and address in ten templates, headers and footers included.",
    answer:
      "Word's Replace (Ctrl+H) works on one open document at a time, and headers, footers and text boxes sometimes need their own pass. For a folder of files, open each one and run Replace All, use a VBA macro, or a paid add-in. Stella (stella.sh) changes every document in the folder on your computer, catches the name even where part of it is bold, leaves look-alike text alone and keeps a backup of the originals.",
    stellaSteps: [
      "Copies the Templates folder to a dated backup before changing anything",
      "Replaces the old name, street and postcode in the body, tables, headers and footers of all 10 files, including where “Trust” was in bold inside the name",
      "Leaves text that only looks similar: “Ashcombe Riverside Walk car park” is a place, so it stayed",
      "Searches every part of every file afterwards and finds none of the old name, street or postcode left",
      "Lists what it didn't touch, like the charity number, and that each file's small preview image still shows the old details until Word next saves it",
    ],
    prompt:
      "Our charity changed its name from Ashcombe Riverside Trust to Riverside Community Trust, and our address changed from 27 Weir Lane, Ashcombe AB5 2RA to 4 Mill Yard, Ashcombe AB1 2MY. Update every Word document in the Templates folder in Documents with the new name and address, including the headers and footers.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "All 10 templates updated in about 2½ minutes. Checked afterwards against an answer key written before the run: the old name and address are gone from every file, headers and footers included; every paragraph reads exactly as expected with nothing else changed (Ashcombe Riverside Walk kept); and the bold “Trust” stayed bold.",
      note: "The charity, its address and the ten templates are fictitious, made for this run. The work is sped up 9×.",
      video: {
        src: `${PROOFS}/documents/find-and-replace-in-multiple-word-documents/proof.mp4`,
        cuts: webCuts("documents/find-and-replace-in-multiple-word-documents"),
        poster: `${PROOFS}/documents/find-and-replace-in-multiple-word-documents/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 50.8,
        realDuration: 157,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Ten Word templates are in Documents/Templates." },
        { at: 1.7, text: "The prompt: the charity's new name and address, in every template, headers and footers included." },
        { at: 18.7, text: "Stella replies that it will back up the originals first, then check nothing old is left." },
        { at: 24.7, text: "Updating and checking the ten files, sped up 9×." },
        { at: 36.7, text: "Done: all 10 updated, the car park name left alone, formatting kept, and the originals in a dated backup folder." },
      ],
    },
    manualTitle: "Replace it yourself in Word",
    manualSteps: [
      {
        title: "Back up the folder",
        body: "Copy the whole folder first. Replace All has no undo once you've saved and closed a file.",
      },
      {
        title: "Replace in each file (Windows)",
        body: "Open a document, press Ctrl+H, type the old text and the new, and click Replace All. Then double-click the header and footer and check them; if the old text is still there, run Replace All again while the cursor is in the header. Save and move to the next file.",
      },
      {
        title: "Replace in each file (Mac)",
        body: "In Word for Mac, choose Edit, Find, Advanced Find and Replace, open the Replace tab and click Replace All. Check headers, footers and text boxes the same way, then save.",
      },
      {
        title: "Use whole phrases, not fragments",
        body: "Replace the full old name, not part of it. Replacing just “Ashcombe Riverside” would also change unrelated text like a street or car park with the same words. Run a separate replacement for the street line and for the postcode if they're split over several lines.",
      },
      {
        title: "Many files: a macro or add-in",
        body: "For dozens of documents, a VBA macro that loops through a folder and runs the replacement in every story (body, headers, footers, text boxes) saves the clicking. Search “Word VBA find replace all files in folder”, test it on a copy, and keep the backup.",
      },
    ],
    limits: [
      "Text inside pictures, logos and embedded PDFs isn't changed. A letterhead image with the old address needs a new image.",
      "Stella replaces the exact wording you give. Abbreviations or spellings you don't list (“ART”, “Ashcombe Riverside Tst”) stay as they are, so name every variant.",
      "Files are changed in place, with a backup made first in this run. Ask for updated copies instead if you'd rather keep the originals where they are.",
      "Each Word file's small preview picture still showed the old details until the file is next saved in Word. The document itself was fully updated.",
      "Document text goes to the AI model you use in Stella as it checks the files. Recorded on Linux without Word; Stella edited the .docx files directly.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why doesn't Replace All find text I can see in the document?",
        a: "Usually it's in a header, footer or text box that a body search skipped, or there's a different space or line break between the words. Search from inside the header, or search a shorter part of the phrase to find the odd character.",
      },
      {
        q: "Will find and replace mess up my formatting?",
        a: "Word keeps the formatting of the text it replaces when Format is left blank. Stella kept it too, including a bold word inside the name, so the new name looked like the old one.",
      },
      {
        q: "Can I replace text in PDFs the same way?",
        a: "Not reliably: a PDF isn't made to be edited. Turn it into a Word file first ([convert PDF to Word](/how/documents/convert-pdf-to-word)), change it, and save a new PDF.",
      },
      {
        q: "Can Stella rename the files as well?",
        a: "Yes, ask for it. File names, folder names and the text inside are separate jobs, so say which you want changed.",
      },
    ],
    related: ["documents/merge-word-documents", "documents/convert-pdf-to-word", "documents/mail-merge-excel-to-word"],
    lastChecked: "2026-11-13",
    sources: [{ label: "Microsoft: Find and replace text", href: "https://support.microsoft.com/en-US/Word/replace-text" }],
  },
  {
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
      "Turn a PDF into an editable Word document with real paragraphs and tables, on your own computer: Word's own conversion, or Stella (stella.sh) converting and checking it.",
    h1: "Convert a PDF to a Word document you can actually edit",
    short: "PDF to Word",
    lede: "A two-page hire agreement back in Word, with its table of charges as a real table.",
    answer:
      "Word for Microsoft 365 converts PDFs itself: File, Open, pick the PDF and click OK when it says it will convert it. Check the table and paragraph breaks before you save it as .docx. Online converters work too, but upload your file. Stella (stella.sh) converts it on your computer, rebuilds the text as normal paragraphs and the table as a Word table, then checks the wording against the PDF.",
    stellaSteps: [
      "Finds the agreement PDF in Downloads",
      "Converts it to Word with a tool that rebuilds paragraphs and tables, rather than one that turns each line into a floating text box",
      "Checks the result: every clause there word for word, the table of charges a real Word table with every price matching the PDF, the blank signature lines still in place",
      "Saves the .docx next to the PDF and leaves the PDF unchanged",
      "Warns about what won't behave like a normal Word document: the clause numbers are typed text, so they won't renumber themselves",
    ],
    prompt:
      "I only have our village hall hire agreement as a PDF (it's in Downloads) and I need to edit it. Turn it into a Word document I can change, keeping the table of charges as a proper table.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "An editable Word version in about 2½ minutes. Checked afterwards against an answer key written before the run: a new .docx with all 8 clauses as normal editable text, in full and in order, each clause one paragraph rather than broken at every line end, the table of charges a real Word table with every price in its row, the title kept, and the PDF unchanged.",
      note: "The village hall and its agreement are fictitious, made for this run as a text PDF (not a scan). The work is sped up 9×.",
      video: {
        src: `${PROOFS}/documents/convert-pdf-to-word/proof.mp4`,
        cuts: webCuts("documents/convert-pdf-to-word"),
        poster: `${PROOFS}/documents/convert-pdf-to-word/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 44.2,
        realDuration: 153,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. The hire agreement PDF is in Downloads." },
        { at: 1.7, text: "The prompt: turn it into a Word document I can change, with the table of charges as a proper table." },
        { at: 11.7, text: "Stella replies that the Word file will sit next to the PDF and the PDF stays as it is." },
        { at: 17.7, text: "Converting and checking, sped up 9×." },
        { at: 30.5, text: "Done: the agreement as a Word document, the table a real Word table, wording checked, with a note that clause numbers are typed in." },
      ],
    },
    manualTitle: "Convert it yourself",
    manualSteps: [
      {
        title: "Check what kind of PDF it is",
        body: "Open the PDF and try to select a sentence. If you can, it has real text and converts well. If you can't, it's a scan (a picture of a page) and needs OCR first: see [make a scanned PDF searchable](/how/pdf-excel/make-scanned-pdf-searchable).",
      },
      {
        title: "On Windows: open it in Word",
        body: "In Word, choose File, Open, pick the PDF and click OK when Word says it will make an editable copy. Turn on Show/Hide (¶) to see where paragraphs really end, and check tables are tables (click inside one: the Table tab should appear).",
      },
      {
        title: "On a Mac: Word for Mac (Microsoft 365)",
        body: "Current Word for Mac opens PDFs the same way: File, Open, pick the PDF, confirm the conversion. Older versions can't; use Word on the web or the free LibreOffice route below with care.",
      },
      {
        title: "Fix lines that broke in the wrong places",
        body: "Converted text often ends every line with a paragraph mark. Select a clause, open Replace, find `^p` and replace with a space, then put back the real paragraph breaks. Retype the clause numbers as a numbered list if you want them to renumber.",
      },
      {
        title: "Save as a new .docx",
        body: "File, Save As, Word Document, with a new name. The PDF stays as it was. LibreOffice opens PDFs in its Draw program, where every line is a separate box: fine for small fixes, poor for editing paragraphs.",
      },
    ],
    limits: [
      "Best for PDFs made from documents. Scanned PDFs need OCR first, and complex layouts (columns, text over pictures, forms) can shift.",
      "Fonts the PDF uses may be swapped for similar ones on your computer.",
      "Typed-in clause numbers stay typed in. Stella pointed this out; ask it to make them a numbered list if you'll be adding clauses.",
      "The conversion runs on your computer and nothing is uploaded to a converter site. Stella reads the text to check the result, so the agreement's wording goes to the AI model you use.",
      "Recorded on Linux, where Stella installed a free Python conversion tool. On Windows or a Mac it may use Word, if you have it, or install the same tool.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I convert a PDF to Word without losing formatting?",
        a: "Use a converter that rebuilds paragraphs and tables (Word's own, or the one Stella used) rather than one that places every line in a text box. Then check tables and line breaks; some cleanup is normal for complex layouts.",
      },
      {
        q: "Is there a free PDF to Word converter that doesn't upload my file?",
        a: "Word's built-in conversion runs on your computer if you already have Word. Stella is free with the ChatGPT or Claude plan you have and converts locally. Online converters upload the file to their servers.",
      },
      {
        q: "Why is my converted document full of text boxes?",
        a: "Some tools (including LibreOffice's PDF import) recreate the page's look by placing each line in its own box. It looks right but is painful to edit. Convert with Word, or ask Stella for normal paragraphs.",
      },
      {
        q: "Can I go the other way, Word to PDF?",
        a: "Yes: File, Save As, PDF in Word. For speaker notes from slides, see [PowerPoint to PDF with notes](/how/documents/convert-powerpoint-to-pdf-with-notes).",
      },
    ],
    related: ["pdf-excel/make-scanned-pdf-searchable", "documents/find-and-replace-in-multiple-word-documents", "documents/merge-word-documents"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Microsoft: Opening PDFs in Word", href: "https://support.microsoft.com/office/opening-pdfs-in-word-1d1d2acc-afa0-46ef-891d-b76bcd83d9c8" },
      { label: "pdf2docx (the open-source converter)", href: "https://github.com/ArtifexSoftware/pdf2docx" },
    ],
  },
  {
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
      "Turn a list of jobs in Excel into one numbered PDF invoice per customer with every job and the total: by hand with a template, or with Stella (stella.sh).",
    h1: "Generate invoices from a spreadsheet, one per customer",
    short: "Invoices from a spreadsheet",
    lede: "30 window-cleaning jobs became 11 numbered PDF invoices, one per customer.",
    answer:
      "Mail merge makes one document per row, so a customer with three jobs would get three invoices. By hand: filter the job list by customer, copy their rows into an invoice template, set the number and total, and save as PDF; repeat for each customer. Stella (stella.sh) groups the jobs by customer, numbers the invoices, adds your business and bank details from the sheet and saves one PDF each, without sending anything.",
    stellaSteps: [
      "Finds the October jobs spreadsheet in Documents and reads both sheets: 30 jobs, and your business details on a separate “My details” sheet",
      "Groups the jobs by customer (11 customers, two to four jobs each) instead of making one invoice per row",
      "Makes one PDF per customer numbered INV-1041 to INV-1051, with your business name and address at the top, their jobs listed, the total due and your bank details for payment",
      "Saves them in a new “October 2026 invoices” folder with the number and customer in each file name, including awkward names like “Mr & Mrs Tran” and “Mrs J O'Hara”",
      "Flags entries worth a second look before sending: a possible double booking and two homes billed at the shop-front rate",
    ],
    prompt:
      "My window cleaning jobs for October are in a spreadsheet in Documents. Make a PDF invoice for each customer, numbered from INV-1041, with my business details at the top, their jobs listed and the total due.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "11 invoices for 30 jobs (£1,158 in all) in about 2 minutes. Checked afterwards against an answer key written before the run: one invoice per customer, each with the right customer, all of their jobs and no one else's, the correct total, an invoice number, the business name and bank details; numbers INV-1041 to INV-1051 each used once; file names include the number; the spreadsheet unchanged.",
      note: "The window-cleaning business, its customers and jobs are fictitious, made for this run. The work is sped up 7×.",
      video: {
        src: `${PROOFS}/documents/generate-invoices-from-spreadsheet/proof.mp4`,
        cuts: webCuts("documents/generate-invoices-from-spreadsheet"),
        poster: `${PROOFS}/documents/generate-invoices-from-spreadsheet/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 49.2,
        realDuration: 139,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. October's window-cleaning jobs are in a spreadsheet in Documents." },
        { at: 1.6, text: "The prompt: one PDF invoice per customer, numbered from INV-1041, with business details and the total due." },
        { at: 16.6, text: "Stella replies that it will make one PDF per customer and won't send anything." },
        { at: 22.6, text: "Grouping jobs and making the invoices, sped up 7×." },
        { at: 35, text: "Done: 11 invoices, INV-1041 to INV-1051, £1,158 in all, with three entries flagged to check before sending." },
      ],
    },
    manualTitle: "Make them yourself",
    manualSteps: [
      {
        title: "Set up one invoice template",
        body: "In Excel or Word, make an invoice with your business name, address and contact details at the top, a box for the customer, a table for date, job and price, a total, your payment terms and your bank details. Excel's File, New has invoice templates to start from.",
      },
      {
        title: "Sort the jobs by customer",
        body: "In the job list, select the data and choose Data, Sort by Customer, then Date. Each customer's jobs now sit together. A PivotTable (Insert, PivotTable, Customer in Rows, Price in Values) gives each customer's total to check against.",
      },
      {
        title: "Fill the template for the first customer",
        body: "Copy that customer's rows into the invoice table, type their name and address, set the invoice number (INV-1041) and today's date, and check the total adds up.",
      },
      {
        title: "Save as PDF and repeat",
        body: "File, Save As (or Export), choose PDF, and name it with the number and customer, such as `INV-1041 Ashcombe Dental Practice.pdf`. Clear the rows, move to the next customer and the next number. Keep a list of which number went to whom.",
      },
      {
        title: "Check before you send",
        body: "Add up the invoice totals and compare them with the sum of the price column. If they don't match, a job was missed or copied twice.",
      },
    ],
    limits: [
      "Stella makes the PDFs. It doesn't email them, send reminders or track who has paid.",
      "VAT is only added when you say so and give the rate. This run's business was “Not VAT registered”, so no VAT was shown.",
      "It invoices what's in the sheet. It flagged a likely double entry and two odd prices here but didn't change them; you decide.",
      "Customer names, addresses and prices go to the AI model you use in Stella. The PDFs are made on your computer.",
      "Recorded on Linux, where Stella made the PDFs with free Python tools it set up. On Windows or a Mac it works the same way; the PDFs open anywhere.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can mail merge make one invoice per customer?",
        a: "Not easily. Mail merge makes one document per row, so a customer with three jobs gets three invoices. You'd need a summary sheet with one row per customer first, and job lines still won't list nicely. Grouping by customer is what Stella did here.",
      },
      {
        q: "Where did Stella get my business details?",
        a: "From the “My details” sheet in the same spreadsheet. If they're somewhere else, such as an old invoice, say where in the prompt.",
      },
      {
        q: "Can I use my own invoice design?",
        a: "Yes. Point Stella at a Word or Excel invoice you already use and ask it to fill that in for each customer. For one letter per row instead, see [mail merge from Excel to Word](/how/documents/mail-merge-excel-to-word).",
      },
      {
        q: "Can it total what each customer owes across the month?",
        a: "Yes, that's each invoice's total. For a summary sheet by customer or job type, see [summarize a spreadsheet by category](/how/pdf-excel/summarize-spreadsheet-by-category).",
      },
    ],
    related: ["documents/mail-merge-excel-to-word", "pdf-excel/summarize-spreadsheet-by-category", "pdf-excel/fill-pdf-form-from-spreadsheet"],
    lastChecked: "2026-11-13",
    sources: [
      {
        label: "Microsoft: Use mail merge (one document per data row)",
        href: "https://support.microsoft.com/en-us/office/use-mail-merge-for-bulk-email-letters-labels-and-envelopes-f488ed5b-b849-4c11-9cff-932c49474705",
      },
      { label: "Microsoft: Create a PivotTable", href: "https://support.microsoft.com/en-us/office/create-a-pivottable-to-analyze-worksheet-data-a9a84538-bfe9-40a9-a8e9-f99134456576" },
    ],
  },
  {
    slug: "convert-word-documents-to-pdf-in-bulk",
    draft: true,
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
      "Turn every Word file in a folder (old .doc, .odt and .rtf too) into PDFs with the same names, in one go, without uploading: LibreOffice, or Stella (stella.sh).",
    h1: "Convert many Word documents to PDF at once",
    short: "Word to PDF in bulk",
    lede: "Twelve policy documents, old formats included, turned into PDFs in a new folder.",
    answer:
      "Word saves one document at a time as PDF (File, Save As, PDF). For a whole folder, the free LibreOffice converts them all with one command: `soffice --headless --convert-to pdf --outdir PDFs *.docx *.doc *.odt *.rtf`. Online converters work too but upload every file. Stella (stella.sh) converts every document in the folder on your computer, keeps the names, puts the PDFs in a new folder and skips files that aren't documents.",
    stellaSteps: [
      "Looks through Documents/Policies: nine .docx files, an old Word 97 .doc, an .odt and an .rtf, plus a spreadsheet and one of Word's hidden ~$ lock files",
      "Converts all 12 documents to PDF with the same names, keeping a landscape price list landscape and pictures in place",
      "Skips the spreadsheet and the lock file, and says what each is",
      "Puts the PDFs in a new Policies PDFs folder next to the original, which is unchanged",
      "Points out one layout detail: the last row of the price table spills onto page 2",
    ],
    prompt:
      "I've got a folder called Policies in my Documents full of Word documents. Make a PDF of every one of them with the same names, and put the PDFs together in a new folder.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "12 PDFs in under 2 minutes. Checked afterwards against an answer key written before the run: exactly 12 PDFs with the same names as their documents, each holding the whole document, page counts matching, the landscape price list still landscape, pictures kept, nothing made from the lock file or spreadsheet, all in one new folder, and the originals unchanged.",
      note: "The community centre and its policies are fictitious, made for this run. This was the second attempt at this guide; the work is sped up 0×.",
      video: {
        src: `${PROOFS}/documents/convert-word-documents-to-pdf-in-bulk/proof.mp4`,
        cuts: webCuts("documents/convert-word-documents-to-pdf-in-bulk"),
        poster: `${PROOFS}/documents/convert-word-documents-to-pdf-in-bulk/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 0,
        realDuration: 101,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A Policies folder of Word and other documents is in Documents." },
        { at: 0, text: "The prompt: a PDF of every document, same names, in a new folder." },
        { at: 0, text: "Stella replies that the PDFs will go in a new Policies PDFs folder and the Word files won't change." },
        { at: 0, text: "Converting the documents, sped up 0×." },
        { at: 0, text: "Done: 12 PDFs, none failed; the spreadsheet and Word's leftover lock file skipped." },
      ],
    },
    manualTitle: "Convert them yourself",
    manualSteps: [
      {
        title: "One or two files: Word",
        body: "Open the document, File, Save As (or Export), choose PDF, keep the name. On a Mac, File, Save As, File Format PDF. Fine for a few files; tedious for a folder.",
      },
      {
        title: "A whole folder: install LibreOffice",
        body: "Install the free LibreOffice from libreoffice.org. It reads .docx, old .doc, .odt and .rtf, and has a command-line converter.",
      },
      {
        title: "Run the conversion",
        body: "Open a terminal in the folder. Mac: `/Applications/LibreOffice.app/Contents/MacOS/soffice --headless --convert-to pdf --outdir PDFs *.docx *.doc *.odt *.rtf`. Windows (PowerShell): the same with `& \"C:\\Program Files\\LibreOffice\\program\\soffice.exe\"` at the start. Linux: `soffice` on its own. Close LibreOffice first if it's open.",
      },
      {
        title: "Ignore the ~$ files",
        body: "Files starting with `~$` are Word's temporary lock files, left behind when a document was open. They aren't documents and won't convert; delete them once Word is closed.",
      },
      {
        title: "Check a few PDFs",
        body: "Open the longest document, one with pictures and any landscape page. Fonts you don't have installed are swapped for similar ones, which can move a line or a table row to the next page.",
      },
    ],
    limits: [
      "The PDFs follow LibreOffice's layout, which is very close to Word's. A document using fonts the computer lacks can shift slightly; here one table's last row moved to page 2.",
      "Password-protected documents need the password first.",
      "The conversion runs on your computer and nothing is uploaded. Only file names, and whatever text Stella reads to check the PDFs, go to the AI model you use.",
      "Recorded on Linux with LibreOffice. On Windows or a Mac Stella may use Word if you have it, or LibreOffice.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can Word convert multiple documents to PDF at once?",
        a: "Not from its menus. It needs a VBA macro (Windows) or an Automator workflow (Mac). LibreOffice's command or Stella does the folder in one go.",
      },
      {
        q: "Is there a free bulk Word to PDF converter that doesn't upload files?",
        a: "LibreOffice is free and works offline. Stella is free with the ChatGPT or Claude plan you already have and converts on your computer.",
      },
      {
        q: "Will old .doc files convert?",
        a: "Yes. LibreOffice reads Word 97 to 2003 .doc files, as well as .odt and .rtf. Stella converted one of each here.",
      },
      {
        q: "Can I combine all the PDFs into one?",
        a: "Yes, ask for one combined PDF, or [merge the Word documents](/how/documents/merge-word-documents) first and save that as a PDF.",
      },
    ],
    related: ["documents/merge-word-documents", "documents/convert-pdf-to-word", "documents/find-and-replace-in-multiple-word-documents"],
    lastChecked: "2026-11-14",
    sources: [
      {
        label: "LibreOffice Help: command-line parameters",
        href: "https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html",
      },
    ],
  },
  {
    slug: "make-a-cookbook-from-your-recipes",
    draft: true,
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
      "Gather recipes from Word files, notes and saved web pages into one cookbook PDF with sections and a contents page, by hand in Word or Pages, or with Stella (stella.sh).",
    h1: "Make a family cookbook from recipes scattered across files",
    short: "Make a cookbook",
    lede: "Sixteen recipes in four formats, gathered into one PDF with sections and contents.",
    answer:
      "Copy each recipe's title, ingredients and method into one Word or Pages document, leaving out the ads and life stories of saved web pages. Style section names (Soups, Mains, Desserts) as Heading 1 and recipe titles as Heading 2, insert a table of contents, and export as PDF. Stella (stella.sh) reads every recipe file in the folder, strips the web clutter, groups them into sections and makes the cookbook PDF with a contents page.",
    stellaSteps: [
      "Reads all 16 recipes in Documents/Recipes: Word files, all-caps text notes, Markdown files and three saved web pages",
      "Keeps only the recipe from each web page, dropping menus, ads, newsletter boxes and intro stories",
      "Groups them into Soups, Mains and Desserts, and says where it made a call (the red lentil dal went under Mains)",
      "Builds a 21-page PDF with a cover, a clickable table of contents and one page per recipe, saved in the Recipes folder; the recipe files are unchanged",
      "Lists things to check in the recipes themselves, like vague steps and an oven temperature that looks copied wrongly",
    ],
    prompt:
      "My family recipes are scattered in the Recipes folder in Documents (Word files, text files and a couple of saved web pages). Put them all into one cookbook PDF with a table of contents, grouped into sections like soups, mains and desserts.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "A 21-page cookbook in about 2 minutes. Checked afterwards against an answer key written before the run: one new PDF with all 16 recipes and their ingredients, a table of contents near the front listing every recipe, soups, mains and desserts each grouped under a heading, no web-page clutter, and the recipe files unchanged. One optional point was missed: the contents page numbers were right for 13 of the 16 recipes.",
      note: "The family recipes are fictitious, made for this run. This was the second attempt at this guide; the work is sped up 0×. Stella's reply said the files added up to 17 when there were 16; that was its own miscount, and the book holds all 16.",
      video: {
        src: `${PROOFS}/documents/make-a-cookbook-from-your-recipes/proof.mp4`,
        cuts: webCuts("documents/make-a-cookbook-from-your-recipes"),
        poster: `${PROOFS}/documents/make-a-cookbook-from-your-recipes/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 0,
        realDuration: 120,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Recipes in four formats are in Documents/Recipes." },
        { at: 0, text: "The prompt: one cookbook PDF with a table of contents, grouped into sections." },
        { at: 0, text: "Stella replies that it will build the book from what's in the folder and leave the files alone." },
        { at: 0, text: "Reading, cleaning and laying out the recipes, sped up 0×." },
        { at: 0, text: "Done: a 21-page cookbook with a clickable contents page, three sections, and notes on recipes worth checking." },
      ],
    },
    manualTitle: "Make it yourself",
    manualSteps: [
      {
        title: "Gather everything in one document",
        body: "Open a new Word or Pages document. For each recipe, copy the title, ingredients and method. From saved web pages, copy only the recipe card, not the story, ads or comments.",
      },
      {
        title: "Use headings for structure",
        body: "Type a section name (Soups) and style it Heading 1; style each recipe title Heading 2. Put the recipes under their section. Add a page break before each recipe so each starts on a fresh page.",
      },
      {
        title: "Insert the contents page",
        body: "Put the cursor after the title page. In Word: References, Table of Contents. In Pages: Insert, Table of Contents. It lists your headings with page numbers.",
      },
      {
        title: "Update and export",
        body: "After any edit, update the table (right-click it, Update Field, Update entire table in Word) so page numbers are right. Then File, Save As (Word) or Export To (Pages), PDF.",
      },
      {
        title: "Printing it",
        body: "For a printed book, check the print shop's page size and margins before laying out. Most print-on-demand services take a PDF at their size.",
      },
    ],
    limits: [
      "The contents page numbers were right for 13 of the 16 recipes; three pointed to the wrong page. The contents links are clickable, but check the printed numbers before you print.",
      "Recipes are copied as written. Stella flagged vague steps and an odd oven temperature but didn't change them.",
      "Photos of handwritten cards need reading first. Stella can do that, but check the quantities.",
      "Print layout for a print shop (trim size, bleed) is a separate step; give Stella the shop's size.",
      "The recipe text goes to the AI model you use in Stella; the PDF is made on your computer. Recorded on Linux with free Python tools.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What's the easiest way to make a family cookbook?",
        a: "Collect the recipes in one document with headings, add a table of contents and export a PDF. A print-on-demand service can then print it as a book.",
      },
      {
        q: "Can I add photos of the dishes?",
        a: "Yes. Put them in the recipes folder named after each recipe and ask Stella to add them, or insert them in Word.",
      },
      {
        q: "How do I get recipes off websites without the ads?",
        a: "Many recipe sites have a Print or Jump to recipe button that shows just the card. Stella strips the rest from saved pages.",
      },
      {
        q: "Can I get it as a Word file to edit?",
        a: "Yes, ask for a .docx as well. To join several Word files yourself, see [merge Word documents](/how/documents/merge-word-documents).",
      },
    ],
    related: ["documents/merge-word-documents", "documents/convert-word-documents-to-pdf-in-bulk", "pdf-excel/convert-mobi-to-epub"],
    lastChecked: "2026-11-14",
    sources: [
      {
        label: "Microsoft: Insert a table of contents",
        href: "https://support.microsoft.com/en-us/office/insert-a-table-of-contents-882e8564-0edb-435e-84b5-1d8552ccf0c0",
      },
    ],
  },
];
