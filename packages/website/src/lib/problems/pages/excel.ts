import type { ProblemPage } from "../types";

export const EXCEL_PAGES: ProblemPage[] = [
  {
    slug: "bank-statement-pdf-to-excel",
    niche: "excel",
    searchPhrases: [
      "convert bank statement pdf to excel",
      "bank statement pdf to excel free",
      "how to get transactions from pdf statement into spreadsheet",
      "combine several bank statements into one excel",
      "pdf to excel converter bank statement",
    ],
    title: "Convert bank statement PDFs to Excel (free)",
    description:
      "Turn bank statement PDFs into one clean Excel sheet of transactions: download a CSV, use Excel's PDF import, or let Stella (stella.sh) do it and check the totals.",
    h1: "Convert bank statement PDFs to Excel",
    short: "Bank statement PDFs to Excel",
    answer:
      "First check whether your bank lets you download transactions as CSV or Excel; it's the cleanest route. If you only have PDFs, Excel for Microsoft 365 on Windows can import the tables from a PDF, and you tidy the columns by hand. Stella (stella.sh) reads every statement you give it, puts all the transactions into one spreadsheet with date, description, amount and balance columns, and checks each month against the statement's own totals.",
    stellaSteps: [
      "Reads each statement PDF you point it to, one month or a whole year",
      "Pulls every transaction into one sheet: date, description, money in, money out and balance",
      "Adds up each statement and checks it against the opening and closing balance printed on the PDF",
      "Flags any row or month that doesn't reconcile, instead of quietly guessing",
      "Saves an .xlsx file next to your statements that opens in Excel, Numbers or Google Sheets",
    ],
    prompt:
      "Turn the bank statement PDFs in my Statements folder into one Excel file with date, description, money in, money out and balance columns. Check each month adds up to the closing balance and flag anything that doesn't.",
    proof: {
      kind: "steps-only",
      reason: "The recorded run on sample statements is being prepared; until then these are the steps Stella follows.",
    },
    manualSteps: [
      {
        title: "Look for a CSV download first",
        body: "Sign in to online banking on your computer and look for Export, Download transactions or similar next to your account history. Most banks offer CSV or Excel for at least the last 12 to 24 months, which skips the PDF problem entirely.",
      },
      {
        title: "Import a PDF with Excel (Windows, Microsoft 365)",
        body: "In Excel, choose Data, Get Data, From File, From PDF, and pick the statement. The Navigator lists every table it found; pick the transaction tables (often one per page) and click Transform Data to open Power Query.",
      },
      {
        title: "Clean up in Power Query",
        body: "Remove the header and footer rows that repeat on every page, set the date column's type to Date and the amount columns to Decimal Number, then Close and Load. Use Append Queries if each page came in as its own table.",
      },
      {
        title: "Check the totals yourself",
        body: "Add a SUM of money in and money out, and check that opening balance plus money in minus money out equals the closing balance printed on the statement. If it's off, a row was split across two lines or a page was skipped.",
      },
      {
        title: "Scanned statement? Run OCR first",
        body: "If you can't select the text in the PDF, it's a picture. Run it through OCR (Adobe Acrobat's Scan & OCR, or the free [OCRmyPDF](https://ocrmypdf.readthedocs.io)) before importing, then check the numbers carefully: OCR misreads 1s, 7s and decimal points.",
      },
    ],
    limits: [
      "Stella works from the statements you give it. It doesn't need, and won't ask for, your online banking password.",
      "The statement text goes to the AI model you use in Stella (your ChatGPT or Claude plan, or a local model if you'd rather it stayed on your computer). Choose accordingly for sensitive files.",
      "Scanned or photographed statements are harder to read accurately. Stella flags the months that don't add up, but check those by eye.",
      "It isn't tax or accounting advice. It gets the numbers into a sheet; categorising them for a tax return is still your call or your accountant's.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Is there a free way to convert bank statement PDFs to Excel?",
        a: "Yes. Your bank's own CSV download is free, Excel's PDF import is included in Microsoft 365, and Stella is free with the ChatGPT or Claude plan you already have. Online converters work too, but you're uploading your statement to a stranger's server.",
      },
      {
        q: "Why do my amounts come out as text in Excel?",
        a: "Currency symbols, spaces or a trailing “CR” or “DR” stop Excel reading them as numbers. Remove those with Find and Replace, or set the column type to Decimal Number in Power Query.",
      },
      {
        q: "Can I combine a whole year of statements into one sheet?",
        a: "Yes. In Excel, put the PDFs in one folder and use Get Data, From Folder, then combine. Stella does the same when you point it at the folder, and checks each month's balance.",
      },
      {
        q: "Does Excel for Mac import PDFs?",
        a: "Not as of November 2026: PDF import is in Excel for Microsoft 365 on Windows. On a Mac, use your bank's CSV, copy tables out of Preview, or have Stella build the sheet.",
      },
    ],
    related: ["files/organize-downloads-folder", "video/burn-subtitles-into-video-for-tiktok"],
    lastChecked: "2026-11-10",
    sources: [
      {
        label: "Microsoft: Import data from a PDF",
        href: "https://support.microsoft.com/en-us/office/import-data-from-a-pdf-file-67e6b7f1-3a44-4fda-a3df-c4b7a5a8ad7a",
      },
      { label: "OCRmyPDF", href: "https://ocrmypdf.readthedocs.io" },
    ],
  },
];
