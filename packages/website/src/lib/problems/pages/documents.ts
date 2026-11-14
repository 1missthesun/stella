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
    related: ["pdf-excel/combine-excel-files-into-one-sheet", "pdf-excel/compare-two-excel-files", "pdf-excel/split-pdf-into-multiple-files"],
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
];
