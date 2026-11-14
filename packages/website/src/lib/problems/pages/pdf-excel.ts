import { PROOFS, webCuts } from "../media";
import type { ProblemPage } from "../types";

export const PDF_EXCEL_PAGES: ProblemPage[] = [
  {
    slug: "bank-statement-pdf-to-excel",
    niche: "pdf-excel",
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
    lede: "One clean Excel sheet from all your statements, with the totals checked.",
    answer:
      "First check whether your bank lets you download transactions as CSV or Excel; it's the cleanest route. If you only have PDFs, Excel for Microsoft 365 on Windows can import the tables from a PDF, and you tidy the columns by hand. Stella (stella.sh) reads every statement you give it, puts all the transactions into one spreadsheet in date order, and checks each month against the totals printed on the statement.",
    stellaSteps: [
      "Reads each statement PDF you point it to, one month or a whole year",
      "Pulls every transaction into one sheet in date order; in the recording, Date, Description and Amount, with money out as negative numbers (ask for separate in and out or balance columns if you prefer)",
      "Stores dates as real dates and amounts as numbers in your currency, so sorting, filters and SUM work straight away",
      "Checks its work: each month's money in and out, and the running balance, against the summary printed on that statement",
      "Saves an .xlsx file that opens in Excel, Numbers or Google Sheets; in the recording it went to Stella's outputs folder, so say where if you want it next to the PDFs",
    ],
    prompt: "Turn these bank statement PDFs into one Excel sheet with date, description and amount.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-10",
      platform: "Linux (Omarchy)",
      model: "Stella’s own models (GPT-6 Luna)",
      result:
        "116 transactions from three monthly statements (August to October 2026) in one sheet. Checked afterwards against an answer key: every row matches, dates are real Excel dates, amounts are numbers, and each month's money in and out equals the statement's summary (August: £2,685.58 in, £2,106.68 out).",
      note: "The statements are sample PDFs from a fictitious bank, made for this run, with selectable text (not scans). The wait is sped up 15×.",
      video: {
        src: `${PROOFS}/pdf-excel/bank-statement-pdf-to-excel/proof.mp4`,
        cuts: webCuts("pdf-excel/bank-statement-pdf-to-excel"),
        poster: `${PROOFS}/pdf-excel/bank-statement-pdf-to-excel/poster.jpg`,
        width: 1280,
        height: 800,
        duration: 58.6,
        realDuration: 124,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer, before the prompt." },
        { at: 5, text: "The prompt is sent: one Excel sheet with date, description and amount." },
        { at: 14, text: "Stella replies that it's gathering the statement PDFs and combining their transactions into one sheet." },
        { at: 15, text: "Reading three statements, sped up 15×." },
        { at: 22, text: "Done: 116 transactions from August to October 2026 in date order. Money out is negative, money in positive, and the totals and running balances match each month's summary." },
        { at: 42, text: "The spreadsheet open in Stella: real dates, amounts formatted in pounds." },
      ],
      shots: [
        {
          src: `${PROOFS}/pdf-excel/bank-statement-pdf-to-excel/sheet.png`,
          alt: "The spreadsheet Stella made, open in Stella: Date, Description and Amount columns, starting 01 Aug 2026 DD Thames Water (£38.42), with money out in brackets.",
          width: 760,
          height: 500,
          caption: "The first rows of the sheet Stella saved, opened in Stella's own viewer.",
        },
      ],
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
        a: "Yes. In Excel, put the PDFs in one folder and use Get Data, From Folder, then combine. Stella does the same when you point it at the folder, and checks each month's balance. If they're scattered through Downloads, [sort the Downloads folder](/how/pc-cleanup/organize-downloads-folder) first.",
      },
      {
        q: "Does Excel for Mac import PDFs?",
        a: "Not as of November 2026: PDF import is in Excel for Microsoft 365 on Windows. On a Mac, use your bank's CSV, copy tables out of Preview, or have Stella build the sheet.",
      },
    ],
    related: ["pdf-excel/receipts-to-spreadsheet", "pdf-excel/combine-excel-files-into-one-sheet", "pc-cleanup/organize-downloads-folder", "pdf-excel/remove-password-from-pdf", "pdf-excel/find-subscriptions-in-bank-statement"],
    lastChecked: "2026-11-10",
    sources: [
      {
        label: "Microsoft: Import data from a PDF",
        href: "https://support.microsoft.com/en-us/office/import-data-from-a-pdf-file-67e6b7f1-3a44-4fda-a3df-c4b7a5a8ad7a",
      },
      { label: "OCRmyPDF", href: "https://ocrmypdf.readthedocs.io" },
    ],
  },
  {
    slug: "compress-pdf-too-large-to-email",
    niche: "pdf-excel",
    searchPhrases: [
      "reduce pdf file size",
      "compress pdf",
      "pdf too large to email",
      "scanned pdf too large to email",
      "pdf too large to email outlook",
    ],
    title: "Compress a PDF on your computer (too large to email?)",
    description:
      "PDF too large to email? Reduce the file size on your own computer with Preview or Ghostscript, no upload needed, or let Stella (stella.sh) make a smaller, readable copy.",
    h1: "Reduce PDF file size when it's too large to email",
    short: "Compress a PDF to email it",
    lede: "A 38 MB scan down to 5 MB, still sharp, without uploading it anywhere.",
    answer:
      "Most oversized PDFs are scans, where every page is a large photo. Shrink the images and the file drops to a fraction of its size: on a Mac, Preview's Export with the Reduce File Size filter; on Windows, the free Ghostscript with its /ebook setting. Online compressors work too, but they upload your file. Stella (stella.sh) makes a smaller copy on your computer, checks the pages are still readable and leaves the original alone.",
    stellaSteps: [
      "Finds the file (in the recording, “the tax documents one in my Downloads”) and looks at why it's big: here, 14 full-colour page scans at 300 ppi and no text layer",
      "Tries a couple of Ghostscript settings on a copy, never on the original",
      "Renders pages from the original and the copy and looks at them side by side to check the small print is still readable",
      "Saves the smaller copy next to the original with “- compressed” in the name, checks it with `qpdf --check`, and removes its own temporary files",
      "Tells you the before and after sizes, and anything worth knowing about the file, such as that it has no searchable text",
    ],
    prompt:
      "This PDF is too big to email (it says the limit is 25 MB). Make it small enough without making it unreadable. It's the tax documents one in my Downloads.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-10",
      platform: "Linux (Omarchy)",
      model: "Stella’s own models (GPT-6 Luna)",
      result:
        "38.2 MB down to 4.96 MB (13% of the original) on the first try, in about 70 seconds. The original was untouched (same checksum). Checked afterwards: the small print looks the same in a 1:1 crop, OCR reads the same 85 words from a page of both files, and the pages are still full resolution, just compressed harder.",
      note: "The PDF is 14 scanned-looking pages of fictitious invoices, bills and letters, made for this run. The waits are sped up 6× and 4×; the end shows the copy opened in Stella's own PDF viewer.",
      video: {
        src: `${PROOFS}/pdf-excel/compress-pdf-too-large-to-email/proof.mp4`,
        cuts: webCuts("pdf-excel/compress-pdf-too-large-to-email"),
        poster: `${PROOFS}/pdf-excel/compress-pdf-too-large-to-email/poster.jpg`,
        width: 1280,
        height: 800,
        duration: 70.8,
        realDuration: 80,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A 38 MB scanned PDF is in Downloads." },
        { at: 4, text: "The prompt: too big to email, make it small enough without making it unreadable." },
        { at: 7, text: "Stella replies that it will make a smaller copy and leave the original untouched." },
        { at: 8, text: "Inspecting the scans, trying two Ghostscript settings and comparing pages by eye, sped up 6×." },
        { at: 22, text: "Done: about 4.7 MB, down from 36.4 (Stella counts in MiB), original untouched, with a note that it's image-only with no searchable text." },
        { at: 44, text: "The compressed copy opened from the chat in Stella's PDF viewer." },
        { at: 61, text: "Paging through: the invoices and bills are still sharp." },
      ],
      shots: [
        {
          src: `${PROOFS}/pdf-excel/compress-pdf-too-large-to-email/legibility.jpg`,
          alt: "The same crop of page 4 from both files, side by side: a Kirkstall Motors invoice header and address. The original is 36.4 MiB, Stella's copy 4.7 MiB, and the text looks the same.",
          width: 2224,
          height: 803,
          caption: "Our check after the run: the same 1:1 crop from the original and from Stella's copy.",
        },
      ],
    },
    manualTitle: "Shrink it yourself, without uploading it",
    manualSteps: [
      {
        title: "Know the limit you're aiming for",
        body: "Gmail allows 25 MB per email and turns bigger attachments into a Google Drive link; Outlook's own guidance says 20 MB; job and visa portals often stop at 2 to 10 MB. Attachments grow by about a third in transit, so aim well under the limit.",
      },
      {
        title: "On a Mac: Preview's Export",
        body: "Open the PDF in Preview, choose File, Export, and pick Reduce File Size in the Quartz Filter menu (newer versions also offer “Optimize images for screen”). Save under a new name and check the pages: it can blur small print, and a text-only PDF may not shrink at all.",
      },
      {
        title: "On Windows (or anywhere): Ghostscript",
        body: "Install the free Ghostscript, open Command Prompt in the PDF's folder and run `gswin64c -sDEVICE=pdfwrite -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH -sOutputFile=small.pdf big.pdf` (`gs` on Mac and Linux). /ebook keeps images at about 150 dpi; /screen is smaller and blurrier, /printer larger and sharper.",
      },
      {
        title: "Scan smaller next time",
        body: "Most scanner apps default to colour at 300 or 600 dpi. For paperwork, 200 to 300 dpi in greyscale is plenty and makes files several times smaller from the start.",
      },
      {
        title: "Still too big? Split it or send a link",
        body: "Split the file into two emails (in Preview, drag pages out into a new document; or `qpdf --split-pages`), or upload it to OneDrive or Google Drive and send a link. Online compressors like iLovePDF and Smallpdf work, but you're uploading tax papers or IDs to their servers.",
      },
    ],
    limits: [
      "It compressed much harder than it needed to: 4.96 MB for a 25 MB limit. It's clearly readable, but say “keep as much quality as fits under 20 MB” if you'd rather have sharper pages.",
      "It didn't offer to make the scan searchable. Ask for OCR in the same chat if you want to search or copy the text later.",
      "Ghostscript was already installed on the test computer. On Windows, expect Stella to install it or another tool first, which hasn't been recorded yet.",
      "To check readability, Stella looks at rendered pages, so page images go to the AI model you use in Stella. Choose your model accordingly for very sensitive documents.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why is my PDF so big?",
        a: "Usually because each page is a high-resolution colour photo: a scan, a phone capture, or a design export full of images. Text-only PDFs are small already, which is why compressing them barely helps.",
      },
      {
        q: "Will compressing a PDF make it blurry?",
        a: "It can. Strong settings (Ghostscript's /screen, or Preview's filter on some versions) visibly soften small print. Always open the smaller copy and zoom in on the finest text before you send it.",
      },
      {
        q: "Is it safe to use an online PDF compressor?",
        a: "The big ones are reputable, but the file still leaves your computer. For tax returns, payslips, bank statements and passports, compressing locally avoids the question entirely.",
      },
      {
        q: "Can Stella also rename or combine my PDFs?",
        a: "Yes, in the same chat. It can [rename PDFs by what's in them](/how/photos-files/rename-pdf-files-based-on-content), merge several into one, or pull the numbers out of [bank statements into Excel](/how/pdf-excel/bank-statement-pdf-to-excel).",
      },
    ],
    related: ["pdf-excel/bank-statement-pdf-to-excel", "photos-files/rename-pdf-files-based-on-content", "pdf-excel/split-pdf-into-multiple-files", "pdf-excel/make-scanned-pdf-searchable", "files-folders/zip-file-too-large-to-email"],
    lastChecked: "2026-11-10",
    sources: [
      { label: "Apple: Reduce the size of a PDF in Preview", href: "https://support.apple.com/guide/preview/reduce-the-size-of-a-pdf-prvw1509/mac" },
      { label: "Ghostscript: Optimizing PDFs", href: "https://ghostscript.com/blog/optimizing-pdfs.html" },
      { label: "Microsoft: Reduce attachment size to send large files with Outlook", href: "https://support.microsoft.com/en-us/outlook/reduce-attachment-size-to-send-large-files-with-outlook" },
    ],
  },

  {
    slug: "combine-excel-files-into-one-sheet",
    niche: "pdf-excel",
    searchPhrases: [
      "combine multiple excel files into one",
      "merge excel files",
      "combine excel files into one sheet",
      "combine multiple csv files into one",
      "merge excel files with different column order",
    ],
    title: "Combine multiple Excel files into one sheet (free)",
    description:
      "Merge a folder of Excel and CSV files into one sheet, even when the columns are in a different order: Power Query's From Folder, or Stella (stella.sh), checked.",
    h1: "Combine multiple Excel files into one sheet",
    short: "Combine Excel files into one",
    lede: "One sheet with every row, the columns lined up, and one header row.",
    answer:
      "In Excel for Windows or Mac, put the files in one folder and use Data, Get Data, From File, From Folder, then Combine; Power Query stacks them and matches columns by name. Copying and pasting works for two or three files but misaligns columns that are in a different order. Stella (stella.sh) merges a whole folder of Excel and CSV files into one new sheet, matches columns by name and checks the totals.",
    stellaSteps: [
      "Opens every workbook and CSV in the folder and works out where each one's header row is, even below a title line",
      "Matches columns by their names, so a file with its columns in a different order still lands in the right place",
      "Reads dates and amounts as real dates and numbers, including day-first dates like 02/05/2026 in a CSV",
      "Writes one new .xlsx next to the originals, with a Source File column so you can filter by where each row came from",
      "Checks its own work (row counts, duplicate IDs, missing values, quantity × price = total) and tells you what it found",
    ],
    prompt: "Combine all these Excel files into one sheet. They're in Documents/Store orders.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-12",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Ten files (eight .xlsx, two .csv) combined into one sheet of 277 orders in about 90 seconds. Checked afterwards against an answer key: exactly one header row, no blank or repeated header rows, and every field of every row matches its source, including the file with its columns in a different order, the one with a title row above the header, and the CSVs' UK dates. The ten originals were unchanged.",
      note: "The order files are fictitious, made for this run. The wait is sped up 10×; the end shows the combined sheet in Stella's own spreadsheet viewer.",
      video: {
        src: `${PROOFS}/pdf-excel/combine-excel-files-into-one-sheet/proof.mp4`,
        cuts: webCuts("pdf-excel/combine-excel-files-into-one-sheet"),
        poster: `${PROOFS}/pdf-excel/combine-excel-files-into-one-sheet/poster.jpg`,
        width: 1280,
        height: 800,
        duration: 51.3,
        realDuration: 92,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Ten order files, eight Excel and two CSV, are in Documents/Store orders." },
        { at: 3, text: "The prompt: combine all these Excel files into one sheet." },
        { at: 9, text: "Stella replies: a new file in the same folder, with a column for which file each row came from, and the originals left unchanged." },
        { at: 11, text: "Reading every workbook, merging by column name and checking the result, sped up 10×." },
        { at: 20, text: "Done: 277 orders in one sheet. It notes the two CSVs, which months each store covers, and that the data checked out." },
        { at: 35, text: "The combined sheet open in Stella: real dates, prices with two decimals, one header row." },
      ],
      shots: [
        {
          src: `${PROOFS}/pdf-excel/combine-excel-files-into-one-sheet/sheet.png`,
          alt: "The combined sheet in Stella's spreadsheet viewer: columns Order ID, Date, Store, Customer, Product, Qty, Unit Price and Total, starting with SO-10405 on 01/01/2026 from the Leeds store.",
          width: 710,
          height: 392,
          caption: "The first rows of the combined sheet, sorted by date.",
        },
      ],
    },
    manualTitle: "Combine them yourself",
    manualSteps: [
      {
        title: "Put the files in one folder",
        body: "Move every file you want combined into one folder, and nothing else. Power Query takes everything it finds there, so a stray summary workbook or an old copy ends up in your data.",
      },
      {
        title: "Use Get Data, From Folder",
        body: "In Excel, choose Data, Get Data, From File, From Folder, pick the folder, then Combine, Combine & Transform Data. Choose the sheet to use from the first file; Power Query applies the same steps to every file and stacks them, matching columns by their header names.",
      },
      {
        title: "Fix title rows and mixed files",
        body: "If a file has a title line above the headers, it shows up as junk rows: in Power Query, edit the Transform Sample File query to Remove Top Rows and Use First Row as Headers, which then applies to every file. Sheets with different names, or CSVs mixed with workbooks, need one query per kind, then Append Queries.",
      },
      {
        title: "Check dates and totals",
        body: "Set the date column's type with Using Locale (for example English, United Kingdom) so 02/05 isn't read as 5 February. Then Close & Load, and compare the row count and a SUM of the totals with the source files before you trust it.",
      },
      {
        title: "Only two or three files? Copy and paste",
        body: "Open each file, check its columns are in the same order as the first, and paste the rows under each other without the header row. Use Paste Special, Values if the source has formulas.",
      },
    ],
    limits: [
      "It saved a new sheet rather than a Power Query connection, so it won't refresh when you add files next month. Ask Stella again with the new files, or build the From Folder query above if you need a live link.",
      "It didn't tell the user about the file with its columns in a different order or the one with a title row; it handled both correctly but silently. Ask for a summary of what it fixed if you want to see that.",
      "The recording ran on Linux without Excel, using Stella's own spreadsheet tool. The result is an ordinary .xlsx that opens in Excel, Numbers or Google Sheets.",
      "The rows go to the AI model you use in Stella while it reads and checks them. For confidential sheets, choose your model accordingly.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can Excel combine files with different column orders?",
        a: "Yes, Power Query's From Folder matches columns by header name, not position. It breaks when the names differ (Qty vs Quantity); rename them in the files or in the query first. Stella matches them by name too and tells you if a name doesn't fit.",
      },
      {
        q: "How do I combine CSV files into one?",
        a: "The same From Folder route works for CSVs. For a quick join of identical CSVs, `copy *.csv all.csv` in Windows Command Prompt works, but it repeats the header row once per file, so delete those afterwards.",
      },
      {
        q: "Will merging change my original files?",
        a: "Not with Power Query, and not in the recording: Stella wrote a new file next to them, and all ten originals were byte-for-byte unchanged afterwards.",
      },
      {
        q: "Can it also make a summary or chart?",
        a: "Yes, in the same chat, for example totals by store and month on a second sheet. The same approach turns [bank statement PDFs into one Excel sheet](/how/pdf-excel/bank-statement-pdf-to-excel).",
      },
    ],
    related: ["pdf-excel/bank-statement-pdf-to-excel", "pdf-excel/receipts-to-spreadsheet", "pdf-excel/compress-pdf-too-large-to-email", "pdf-excel/compare-two-excel-files", "pdf-excel/merge-two-spreadsheets-by-matching-column"],
    lastChecked: "2026-11-12",
    sources: [
      { label: "Microsoft: Import data from a folder with multiple files (Power Query)", href: "https://support.microsoft.com/en-us/office/import-data-from-a-folder-with-multiple-files-power-query-94b8023c-2e66-4f6b-8c78-6a00041c90e4" },
      { label: "Microsoft: Append queries (Power Query)", href: "https://support.microsoft.com/en-us/excel/append-queries-power-query" },
    ],
  },
  {
    slug: "receipts-to-spreadsheet",
    niche: "pdf-excel",
    searchPhrases: [
      "receipts to spreadsheet",
      "scan receipts into excel",
      "receipts to excel",
      "expense report from receipts",
      "convert receipt photos to spreadsheet",
    ],
    title: "Turn receipts into a spreadsheet for an expense report",
    description:
      "Get a pile of receipt photos and PDFs into one Excel sheet with date, shop and total: by hand, with Excel's Data from Picture, or with Stella (stella.sh).",
    h1: "Turn receipts into a spreadsheet for your expense report",
    short: "Receipts into a spreadsheet",
    lede: "20 receipt photos and PDFs in one sheet, every total right and a grand total that adds up.",
    answer:
      "For a handful, type them in: date, shop, total, one row each, and a SUM at the bottom. For more, Excel's Data from Picture (Microsoft 365) reads one photo at a time, and expense apps scan as you go. Stella (stella.sh) reads every photo and PDF in the folder, builds one sheet with a grand total, and flags anything an expense policy may question.",
    stellaSteps: [
      "Opens every receipt in the folder: in the recording 14 phone photos, 4 PDFs with text and 2 scanned PDFs that are only pictures",
      "Reads the photos itself, zooming in on the faded and angled ones to check the numbers",
      "Takes the amount actually paid, not the subtotal, cash handed over or change, and the order date rather than the delivery date",
      "Builds one sheet: date, shop, what it was, category, payment, total, VAT and the file it came from, with a SUM grand total",
      "Highlights receipts a manager may query, like groceries paid in cash or wine with dinner, and says why",
    ],
    prompt:
      "Put all these receipts into one spreadsheet for my expense report, with date, shop and total. They're in Documents/Receipts.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-12",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "20 receipts became one Excel sheet in 1 minute 32 seconds. Checked afterwards against the answer key written before the run: all 20 rows have the right date, shop and total, none missing or doubled, and the grand total is a live SUM formula that comes to £770.05, exactly right. The receipts themselves were unchanged.",
      note: "The receipts are made up for this test (fictional shops, card ending 4417): computer-printed receipts photographed at an angle with shadows, one faded, plus PDFs. They include traps: a discount, a tip, cash and change lines, a delivery date and a due date. The reading is sped up 12×, and opening the sheet 3× and 2.5×.",
      video: {
        src: `${PROOFS}/pdf-excel/receipts-to-spreadsheet/proof.mp4`,
        cuts: webCuts("pdf-excel/receipts-to-spreadsheet"),
        poster: `${PROOFS}/pdf-excel/receipts-to-spreadsheet/poster.jpg`,
        width: 1280,
        height: 800,
        duration: 57,
        realDuration: 92,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. 20 receipts, photos and PDFs, are in Documents/Receipts." },
        { at: 3, text: "The prompt: put all these receipts into one spreadsheet for my expense report, with date, shop and total." },
        { at: 12, text: "Stella replies that it will add a grand total and point out anything hard to read or duplicated." },
        { at: 13, text: "Reading every photo and PDF, then building and checking the sheet, sped up 12×." },
        { at: 20.2, text: "Done: all 20 receipts, 3 Oct to 3 Nov, adding up to £770.05, with five flagged for the expense policy." },
        { at: 34.7, text: "The spreadsheet opened in Stella's viewer, sped up 2.5×." },
        { at: 44, text: "Expanded: one row per receipt and the grand total at the bottom." },
      ],
      shots: [
        {
          src: `${PROOFS}/pdf-excel/receipts-to-spreadsheet/receipts.jpg`,
          alt: "Three of the test receipt photos: a faded pharmacy receipt on a car seat, a fuel receipt in shadow, and a restaurant bill with wine and an optional service charge, each at a slight angle.",
          width: 1350,
          height: 600,
          caption: "Three of the 20 test receipts Stella read: faded, shadowed, and one with optional service.",
        },
        {
          src: `${PROOFS}/pdf-excel/receipts-to-spreadsheet/sheet.jpg`,
          alt: "The spreadsheet Stella made: 20 rows with date, shop, description, category, payment, currency, total, VAT and source file, and a grand total of 770.05 at the bottom.",
          width: 1308,
          height: 457,
          caption: "The sheet it made, opened in Stella. The Notes column (cut off here) explains each yellow flag.",
        },
      ],
    },
    manualTitle: "Do it yourself",
    manualSteps: [
      {
        title: "Set up the sheet",
        body: "In Excel or Google Sheets, make columns for Date, Shop, Description, Total and the file name, and format the Date column as a date and Total as currency. One row per receipt keeps it easy to sort and check.",
      },
      {
        title: "Read the right number off each receipt",
        body: "Use the TOTAL actually paid, not the subtotal (which can leave out discounts, delivery or tips) and not the cash handed over or the change. For invoices and online orders, use the order or invoice date, not the delivery or due date. Note anything personal or optional, like wine or a service charge, if your policy cares.",
      },
      {
        title: "Let Excel read the photos (Microsoft 365)",
        body: "In Excel choose Data > From Picture > Picture From File, pick a receipt photo, check what it read in the side panel, then Insert Data. On a phone, tap Insert > Data from Picture and point the camera at the receipt. It works one receipt at a time, and you still need to check each number.",
      },
      {
        title: "Copy the PDFs",
        body: "For PDFs with real text, open them and copy the date and total. For scanned PDFs, take a screenshot and use Data from Picture, or open them in Google Drive with Google Docs, which reads the text out of scans.",
      },
      {
        title: "Add the grand total and check it",
        body: "Below the last row, type `=SUM(` and select the Total column, so it updates if you fix a row. Then count the rows against the number of receipts and spot-check a few against the paper. Many expense apps (Expensify, Zoho Expense, your company's own) also scan receipts one by one if you'd rather not keep a sheet.",
      },
    ],
    limits: [
      "The test receipts were computer-printed and photographed clearly, if at an angle. Crumpled, handwritten, foreign-language or very long supermarket receipts are harder and weren't tested; check those rows yourself.",
      "Stella reads the photos with the AI model you use in Stella, so the receipt images are sent to that model (here Claude). The spreadsheet itself is made and kept on your computer.",
      "It made an Excel file in the receipts folder. If your company wants its own template or an upload to its expense system, say so in the prompt or copy the rows across.",
      "It picks a category and flags possible personal items from what's printed. Your company's rules decide what's allowed, so check the yellow rows before you submit.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can Excel read receipts from photos?",
        a: "Yes, Microsoft 365's Data from Picture turns a photo or screenshot into rows, one image at a time, and you check each one before inserting. It's built for tables, so a receipt's total may need moving into the right column by hand.",
      },
      {
        q: "Should I use the subtotal or the total?",
        a: "The total you actually paid, including tips, delivery and fees, unless your policy says otherwise. Two test receipts printed a subtotal that didn't match the amount charged, and Stella used the amount charged and said so.",
      },
      {
        q: "What about receipts in different currencies?",
        a: "Keep the currency in its own column and the amount as printed, then convert at the rate your company uses, usually the one on your card statement. Mixed currencies weren't part of this test.",
      },
      {
        q: "Can Stella put them in Google Sheets instead?",
        a: "Ask for a CSV, which Google Sheets opens directly, or for an .xlsx you upload to Google Drive. If your bank statements need the same treatment, see [bank statement PDF to Excel](/how/pdf-excel/bank-statement-pdf-to-excel).",
      },
    ],
    related: ["pdf-excel/bank-statement-pdf-to-excel", "pdf-excel/combine-excel-files-into-one-sheet", "photos-files/rename-pdf-files-based-on-content", "pdf-excel/summarize-spreadsheet-by-category"],
    lastChecked: "2026-11-12",
    sources: [
      { label: "Microsoft Support: Insert data from picture", href: "https://support.microsoft.com/office/insert-data-from-picture-3c1bb58d-2c59-4bc0-b04a-a671a6868fd7" },
      { label: "Microsoft Support: Use AutoSum to sum numbers", href: "https://support.microsoft.com/office/use-autosum-to-sum-numbers-543941e7-e783-44ef-8317-7d1bb85fe706" },
    ],
  },
  {
    slug: "split-pdf-into-multiple-files",
    niche: "pdf-excel",
    searchPhrases: [
      "split pdf into multiple files",
      "split pdf",
      "split a scanned pdf into separate documents",
      "extract pages from pdf",
      "separate pdf pages into different files",
    ],
    title: "Split a PDF into multiple files, one per document",
    description:
      "Split one big scanned PDF into separate files, one per letter or bill, named for what each is: Preview, print to PDF, or Stella (stella.sh) on your own computer.",
    h1: "Split a PDF into multiple files (one per document)",
    short: "Split a PDF into separate files",
    lede: "A 17-page scan of mixed post turned into 7 named PDFs, the original untouched.",
    answer:
      "If you know the page ranges it's quick: on a Mac, drag a document's page thumbnails out of Preview's sidebar into a folder; on Windows, print the range to Microsoft Print to PDF, or use a free offline splitter such as PDF24 Creator. The slow part is working out where each document starts and naming the files. Stella (stella.sh) reads every page, splits the PDF where each document ends and names each file by sender and what it is.",
    stellaSteps: [
      "Finds the scan you describe (in the recording, “the Scan 2026-11-03 one in Downloads”) and reads all 17 pages",
      "Works out where each document starts and ends from what's printed on the pages: here, a footer on every page naming its document and page number",
      "Writes one PDF per document into a new folder next to the scan, named by sender and what it is, like “Halden Logistics - payslip October 2026”",
      "Leaves dates out of the names when a letter doesn't show one, rather than inventing them, and turns the slash in “2026/27” into a dash so the name is valid",
      "Lists what needs doing: an invoice to pay with its reference, and two letters whose deadlines the scan doesn't show",
    ],
    prompt:
      "My scanner app put a whole pile of letters and bills into one PDF (the Scan 2026-11-03 one in Downloads). Split it into separate PDFs, one per document, with names that say what each one is.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "macOS 15",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Seven PDFs from one 17-page scan in about 2 minutes 20 seconds. Checked afterwards against an answer key written before the run: exactly 7 files, each holding only its own document's pages in the right order (invoice 2 pages, council tax bill 1, insurance renewal 4, payslip 1, tenancy agreement 6, dental receipt 1, gym cancellation 2), each named for what it is, and the original scan unchanged.",
      note: "The scan is a sample PDF of fictitious letters and bills made for this run, with selectable text rather than page images. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/pdf-excel/split-pdf-into-multiple-files/proof.mp4`,
        cuts: webCuts("pdf-excel/split-pdf-into-multiple-files"),
        poster: `${PROOFS}/pdf-excel/split-pdf-into-multiple-files/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 39.8,
        realDuration: 140,
      },
      moments: [
        { at: 0, text: "Stella on a Mac. A 17-page scan of mixed letters and bills is in Downloads." },
        { at: 3.3, text: "The prompt: split it into separate PDFs, one per document, with names that say what each one is." },
        { at: 12, text: "Stella replies: a new folder in Downloads, files named by sender and type, the original scan left alone." },
        { at: 13, text: "Reading the pages and splitting the scan, sped up 4×." },
        { at: 22.7, text: "Done: 7 PDFs listed by sender, dates left out because the letters don't show them, and the three that need action." },
      ],
    },
    manualTitle: "Split it yourself",
    manualSteps: [
      {
        title: "Find where each document starts",
        body: "Scroll through the PDF and note the page range of each letter or bill (for example 1–2, 3, 4–7). A new letterhead or a footer reading “Page 1 of 4” gives it away. Doing this first saves splitting at the wrong page.",
      },
      {
        title: "On a Mac: drag pages out of Preview",
        body: "Open the PDF in Preview and choose View, Thumbnails. Click the first page of a document, Shift-click its last page, and drag the selection to a Finder folder or the desktop: Preview saves those pages as a new PDF. Rename it, then repeat for the next document.",
      },
      {
        title: "On Windows: print a page range to PDF",
        body: "Open the PDF in Microsoft Edge or Chrome, press Ctrl+P, choose Microsoft Print to PDF (Save as PDF in Chrome), type the range under Pages, such as 4-7, and save it under a name that says what it is. Repeat per document. It's a re-print, so links and form fields may not survive.",
      },
      {
        title: "Or use an offline splitter",
        body: "PDF24 Creator (free, Windows) splits by several page ranges in one go without uploading anything, and the free qpdf tool does it from the command line on any system. Online splitters like iLovePDF work too, but a pile of bills and payslips is exactly what you'd rather not upload.",
      },
      {
        title: "Check and name every file",
        body: "Open each new PDF and check its first and last pages belong together. Name it sender, then what it is, then date, for example “Brightwater Plumbing - invoice - 2026-10”. File names can't contain a slash, so write “2026-27”, not “2026/27”.",
      },
    ],
    limits: [
      "The test scan had selectable text and a footer on every page naming its document, which made the split certain. A real scan that's only pictures, with no footers, is harder: Stella has to look at each page image, which is slower and worth checking by eye.",
      "It didn't put dates in the file names, because none of the letters showed one. If yours do, ask for the date in the name.",
      "The pages' text goes to the AI model you use in Stella (here Claude) so it can tell the documents apart. For very private paperwork, choose your model accordingly.",
      "This one was recorded on a Mac (macOS 15). The same job works on Windows and Linux; it just wasn't recorded there for this guide.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can Preview split a PDF into separate files?",
        a: "Yes, by dragging selected page thumbnails out of the sidebar into a folder; each drag makes a new PDF. There's no “split every N pages” button, so a long file means many drags.",
      },
      {
        q: "How do I split a PDF into single pages?",
        a: "With the free qpdf, `qpdf --split-pages scan.pdf page.pdf` writes page-01.pdf, page-02.pdf and so on. PDF24 Creator has the same option. Ask Stella for single pages instead of documents and it does that.",
      },
      {
        q: "Will splitting change the original PDF?",
        a: "Not with Preview's drag method or the print route, and not in the recording: Stella wrote the new files into a separate folder and the scan was byte-for-byte unchanged afterwards.",
      },
      {
        q: "Can it rename or shrink the pieces too?",
        a: "It named them in the same step. To rename PDFs you already have by what's in them, see [rename PDF files by content](/how/photos-files/rename-pdf-files-based-on-content). If one is too big to send, [compress it](/how/pdf-excel/compress-pdf-too-large-to-email) in the same chat.",
      },
    ],
    related: ["photos-files/rename-pdf-files-based-on-content", "pdf-excel/add-page-numbers-to-pdf", "pdf-excel/compress-pdf-too-large-to-email", "pdf-excel/reorder-pdf-pages"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Add, delete and move PDF pages in Preview", href: "https://support.apple.com/guide/preview/prvw11793/mac" },
      { label: "Apple: Combine PDFs and move pages between them in Preview", href: "https://support.apple.com/guide/preview/prvw846b61d3/mac" },
      { label: "PDF24 Creator (free Windows PDF tools)", href: "https://tools.pdf24.org/en/creator" },
      { label: "qpdf command-line options", href: "https://qpdf.readthedocs.io/en/stable/cli.html" },
    ],
  },
  {
    slug: "remove-password-from-pdf",
    niche: "pdf-excel",
    searchPhrases: [
      "remove password from pdf",
      "unlock pdf",
      "remove password from pdf mac",
      "remove password from pdf free",
      "pdf asks for password every time",
    ],
    title: "Remove a password from a PDF you can open (Mac, Windows)",
    description:
      "Make copies of password-protected PDFs, like bank statements, that open without the password: Preview's Export, print to PDF, qpdf, or Stella (stella.sh).",
    h1: "Remove the password from a PDF you already know",
    short: "Remove a password from a PDF",
    lede: "Six statements that open without the password, the locked originals kept.",
    answer:
      "You need the password; removing it just saves an unlocked copy. On a Mac, open the PDF in Preview, type the password and use File, Export (not Export as PDF, which is greyed out for protected files on macOS 15). On Windows, print it to Microsoft Print to PDF from Edge, or use Acrobat's No Security. Stella (stella.sh) unlocks a whole batch with the password you give it, keeps the text exactly and leaves the originals alone.",
    stellaSteps: [
      "Finds the protected statements in Downloads, six months of them in the recording",
      "Opens each with the password from your message and saves a copy without it, next to the original",
      "Names each copy after its original with “(unlocked)” added, so Statement_2026-05 becomes Statement_2026-05 (unlocked)",
      "Opens every copy afterwards to check it needs no password, and confirms the originals are unchanged",
      "Points out that anyone using the computer can now open the copies, and offers to delete the locked originals (it didn't, without being told to)",
    ],
    prompt:
      "My bank statements in Downloads ask for a password every time I open them. The password is Maple2026. Can you make copies that open without it?",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Six unlocked copies (May to October 2026) in about a minute. Checked afterwards against an answer key written before the run: each copy opens without a password and has the same page and exactly the same text as its original, each keeps the month in its name, and all six locked originals were still there, unchanged.",
      note: "The statements are sample PDFs from a fictitious bank, each locked with AES-256 encryption and the password in the prompt, made for this run. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/pdf-excel/remove-password-from-pdf/proof.mp4`,
        cuts: webCuts("pdf-excel/remove-password-from-pdf"),
        poster: `${PROOFS}/pdf-excel/remove-password-from-pdf/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 37,
        realDuration: 64,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Six password-protected bank statements are in Downloads." },
        { at: 1.9, text: "The prompt, with the password: make copies that open without it." },
        { at: 10.7, text: "Stella replies: copies saved next to the originals, which won't be changed." },
        { at: 11.5, text: "Unlocking and checking six files, sped up 3×." },
        { at: 18.2, text: "Done: six unlocked copies, each opened to check, and a reminder that anyone using this computer can now open them." },
      ],
    },
    manualTitle: "Unlock it yourself",
    manualSteps: [
      {
        title: "On a Mac: Preview's Export",
        body: "Open the statement in Preview and type the password. Choose File, Export (the plain Export…, because Export as PDF… is greyed out for protected files on macOS 15), keep Format set to PDF, give it a new name and save. On macOS 15.6 the exported copy opens without a password. Repeat for each file.",
      },
      {
        title: "On Windows: print to PDF",
        body: "Open the PDF in Microsoft Edge or Chrome and enter the password. Press Ctrl+P, choose Microsoft Print to PDF (Save as PDF in Chrome) and save. The new file has no password, but this only works if the PDF allows printing, and links or bookmarks may be lost in the re-print.",
      },
      {
        title: "With Adobe Acrobat",
        body: "In Acrobat (paid), open the file with its password, then choose File, Properties, Security and set Security Method to No Security. If the file also has a permissions password, Acrobat asks for that too. This keeps everything in the file exactly as it was.",
      },
      {
        title: "From the command line, on any system",
        body: "The free qpdf removes it in one line and keeps everything else: `qpdf --password=YOURPASSWORD --decrypt locked.pdf unlocked.pdf`. Run it once per file, or loop over the folder to do a year of statements at once.",
      },
      {
        title: "Or skip the PDF next time",
        body: "If your bank locks every statement, look in its online banking for a transaction download as CSV or Excel. The same numbers arrive without a password and are easier to work with than the PDF anyway.",
      },
    ],
    limits: [
      "Stella needs the password. It won't guess, crack or get around one, and it's only for files you're entitled to open.",
      "The password is part of your message, so it reaches the AI model you use in Stella along with the rest of the chat. Change it afterwards if you use it anywhere else.",
      "Unlocked copies open for anyone with access to the computer or the folder. Stella said so and offered to delete the locked ones; keep the originals if the copies are for a one-off job.",
      "Recorded on Linux, where the PDF tools Stella used were already installed. On a Mac or Windows PC it may install a small PDF tool first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why is “Export as PDF” greyed out in Preview?",
        a: "On macOS 15, Preview disables Export as PDF for password-protected files. File, Export with the format set to PDF still works and, on macOS 15.6, saves a copy without the password.",
      },
      {
        q: "Can I remove a password I don't know?",
        a: "Not with any of these methods: every one starts by opening the file with its password. If it's your own statement, download it again from your bank or ask the bank what the password is built from.",
      },
      {
        q: "Is it OK to remove a PDF password?",
        a: "Saving an unlocked copy of your own document with the password you were given is an everyday thing to do. Breaking into a file you weren't given access to is not, and Stella won't try.",
      },
      {
        q: "What can I do with the unlocked statements?",
        a: "Anything that needs the text: search them, or [turn bank statements into one Excel sheet](/how/pdf-excel/bank-statement-pdf-to-excel). Before sharing one, you can [black out account numbers](/how/pdf-excel/redact-pdf) properly.",
      },
    ],
    related: ["pdf-excel/bank-statement-pdf-to-excel", "pdf-excel/redact-pdf", "pdf-excel/split-pdf-into-multiple-files"],
    lastChecked: "2026-11-13",
    sources: [
      {
        label: "Microsoft Community: removing a PDF password you know on Windows",
        href: "https://techcommunity.microsoft.com/discussions/windows10space/how-do-you-remove-password-protection-from-a-pdf/4536775/replies/4536796",
      },
      { label: "qpdf command-line options", href: "https://qpdf.readthedocs.io/en/stable/cli.html" },
    ],
  },
  {
    slug: "redact-pdf",
    niche: "pdf-excel",
    searchPhrases: [
      "redact pdf",
      "how to redact a pdf",
      "redact pdf free",
      "redact pdf mac",
      "black out text in pdf permanently",
    ],
    title: "Redact a PDF properly, free on Mac and Windows",
    description:
      "Black out SSNs and account numbers in a PDF so they're really gone, not just covered: Preview's Redact, PDF24 or Acrobat, or Stella (stella.sh), checked.",
    h1: "How to redact a PDF so the text is really gone",
    short: "Redact a PDF properly",
    lede: "Every SSN and account number deleted from the file, not just hidden under a box.",
    answer:
      "Use a real redaction tool, not a black rectangle: a drawn box leaves the text underneath, where anyone can copy it out. On a Mac, Preview's Tools, Redact removes the text it covers; on Windows, the free PDF24 Creator or Acrobat's Redact tool does. Then search the saved copy for a number to prove it's gone. Stella (stella.sh) finds every number you name, deletes it from a copy and checks it can't be pulled back out.",
    stellaSteps: [
      "Opens the PDF you describe (“the new hires PDF in my Downloads”) and finds every Social Security and bank account number on all five pages",
      "Deletes them from a copy of the file rather than painting over them, so nobody can copy or search them out from under the black boxes",
      "Keeps everything else readable: names, roles and start dates",
      "Checks its own work: tries to pull the numbers back out of the file, and renders page 1 to see that the boxes sit in the right places",
      "Leaves the bank routing number visible and explains why (it's the same for all 18 people and only identifies the bank), offering to black it out too",
    ],
    prompt:
      "I need to share the new hires PDF in my Downloads with our team leads, but they shouldn't see anyone's social security number or bank account number. Black those out.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "36 numbers removed, a Social Security number and an account number for each of 18 new hires, in about 1 minute 40 seconds. Checked afterwards against an answer key written before the run: none of the numbers can be found in the copy's text or anywhere in the file's bytes, every spot is covered by a black box, all 18 names and the other details are still readable, the page count is the same and the original is unchanged.",
      note: "The payroll PDF is made up for this run: a fictitious company, and SSN-shaped numbers from a range that's never issued. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/pdf-excel/redact-pdf/proof.mp4`,
        cuts: webCuts("pdf-excel/redact-pdf"),
        poster: `${PROOFS}/pdf-excel/redact-pdf/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 46.7,
        realDuration: 98,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A 5-page payroll PDF listing 18 new hires is in Downloads." },
        { at: 2, text: "The prompt: team leads shouldn't see anyone's social security or bank account number. Black those out." },
        { at: 15.6, text: "Stella replies: a blacked-out copy, with the numbers deleted from the file, not just covered with boxes." },
        { at: 21.6, text: "Finding, removing and checking the numbers, sped up 4×." },
        { at: 32.6, text: "Done: 36 numbers gone across 5 pages, names and dates kept, and a preview of page 1 with the black boxes." },
      ],
    },
    manualTitle: "Redact it yourself",
    manualSteps: [
      {
        title: "Work on a copy",
        body: "Duplicate the PDF first (File, Duplicate in Preview, or copy and paste it in File Explorer). Redaction can't be undone in the saved file, so keep the original somewhere safe and only share the copy.",
      },
      {
        title: "On a Mac: Preview's Redact tool",
        body: "Open the copy in Preview (macOS 11 or later), choose Tools, Redact, and drag across each number. Preview marks the areas and, when you save, removes the text under them. Go page by page: there's no way to search and redact every match at once.",
      },
      {
        title: "On Windows: PDF24 or Acrobat",
        body: "The free PDF24 Creator has a Redact tool that works offline: draw boxes over the numbers and save. In Adobe Acrobat (paid), choose Redact, mark each number or use Find text & redact to mark every match of a pattern, then Apply.",
      },
      {
        title: "Never just draw a black box",
        body: "Rectangles, a black highlighter or black text shading only hide the number on screen. The text is still in the file, and select-all, copy and paste reveals it. Printing to an image PDF does flatten it, but every page loses its searchable text.",
      },
      {
        title: "Prove it's gone",
        body: "Open the saved copy, press Cmd-F or Ctrl+F and search for the last four digits of a few numbers. Then select the text around a box and paste it into a note. If any digit turns up, the redaction didn't take.",
      },
    ],
    limits: [
      "The test PDF had real text. Scanned pages are pictures, so Stella would need to read them with OCR before it could find the numbers, which wasn't part of this run; check scanned pages by eye.",
      "It decides what to remove from your description. In the recording it kept the routing number on purpose and said so. Name everything you want gone (dates of birth, home addresses) to be safe.",
      "The PDF's text goes to the AI model you use in Stella so it can find the numbers, which is the very data you're protecting. For highly sensitive files, choose your model accordingly.",
      "Recorded on Linux. Stella installed a PDF library (PyMuPDF) for the redaction, and does the same on a Mac or Windows PC, which adds a little time the first run.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why doesn't a black box redact a PDF?",
        a: "Because the box is a separate layer drawn on top. The text under it is still in the file, so anyone can select, copy or search it. Real redaction deletes the content under the box and then burns the box into the page.",
      },
      {
        q: "Can I redact a PDF for free?",
        a: "Yes. Preview on a Mac and PDF24 Creator on Windows both redact for free and offline. Stella is free with the ChatGPT or Claude plan you already have.",
      },
      {
        q: "Does redaction remove hidden data too?",
        a: "Preview and PDF24 remove the marked text. Acrobat also has Remove Hidden Information for metadata, comments and attachments. In the recording only the numbers were removed; ask if you want the file's metadata cleared as well.",
      },
      {
        q: "What if the PDF has a password?",
        a: "[Remove the password](/how/pdf-excel/remove-password-from-pdf) first with the one you have, then redact the unlocked copy. Photos have their own privacy leak: [remove the location from photos](/how/photos-files/remove-location-from-photos) before you post them.",
      },
    ],
    related: ["pdf-excel/remove-password-from-pdf", "pdf-excel/split-pdf-into-multiple-files", "photos-files/remove-location-from-photos"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Intego: Securely redact text in PDFs with Preview", href: "https://www.intego.com/mac-security-blog/securely-redact-text-in-pdfs-with-apple-preview-on-mac" },
      { label: "PDF24: Redact PDF", href: "https://tools.pdf24.org/en/redact-pdf" },
    ],
  },
  {
    slug: "add-page-numbers-to-pdf",
    niche: "pdf-excel",
    searchPhrases: [
      "add page numbers to pdf",
      "add page numbers to pdf free",
      "add page numbers to pdf mac",
      "add page numbers to pdf in preview",
    ],
    title: "Add page numbers to a PDF, free on Mac and Windows",
    description:
      "Number every page of a PDF at the bottom: Preview can't, so use the original file, a free offline tool, Acrobat's Header & Footer, or Stella (stella.sh).",
    h1: "Add page numbers to a PDF",
    short: "Add page numbers to a PDF",
    lede: "A 16-page report numbered at the bottom of every page, in its own font.",
    answer:
      "Preview on a Mac can't add page numbers, which is where many people get stuck. If you still have the Word or Pages file, add numbers there and export the PDF again. Otherwise use a free offline tool such as PDF24 Creator on Windows, or Acrobat's Header & Footer if you pay for it. Stella (stella.sh) adds the numbers to a copy, matches the document's font and checks that none of them sit on top of text.",
    stellaSteps: [
      "Finds the annual report in Downloads: 16 pages, no numbers yet",
      "Adds a small grey number centred at the bottom of every page, in the report's own font",
      "Numbers the first page too, because this report has no separate cover; say so if yours does and should be skipped",
      "Checks that no number covers any of the report's text",
      "Saves a new file with “- numbered” added to the name and leaves the original as it was",
    ],
    prompt: "Add page numbers to the bottom of every page of the annual report PDF in my Downloads.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "All 16 pages numbered in about 1 minute 40 seconds. Checked afterwards against an answer key written before the run: every page shows its own number in the bottom 15% of the page, the page count is still 16, and all 16 original headings are still there.",
      note: "The report is a fictitious charity's annual report, made for this run. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/pdf-excel/add-page-numbers-to-pdf/proof.mp4`,
        cuts: webCuts("pdf-excel/add-page-numbers-to-pdf"),
        poster: `${PROOFS}/pdf-excel/add-page-numbers-to-pdf/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 45.3,
        realDuration: 99,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A 16-page annual report with no page numbers is in Downloads." },
        { at: 2.1, text: "The prompt: page numbers at the bottom of every page." },
        { at: 13.4, text: "Stella replies: the numbered version will be a new file next to the original." },
        { at: 19.3, text: "Adding and checking the numbers, sped up 4×." },
        { at: 31.4, text: "Done: small grey numbers centred at the bottom of all 16 pages, in the report's font, covering no text." },
      ],
    },
    manualTitle: "Number the pages yourself",
    manualSteps: [
      {
        title: "Start from the original document if you have it",
        body: "In Word, choose Insert, Page Number, Bottom of Page; in Pages, click in the footer and choose Insert, Page Number. Then export a new PDF. The numbers become part of the layout, so they can't collide with text.",
      },
      {
        title: "On Windows: PDF24 Creator",
        body: "Install the free PDF24 Creator, open its Add page numbers tool, drop in the PDF, choose the bottom centre position and the first number, and save. It runs on your computer, so the report isn't uploaded anywhere.",
      },
      {
        title: "With Adobe Acrobat",
        body: "In Acrobat (paid), choose Edit PDF, Header & Footer, Add. Click into the centre footer box, use Insert Page Number, set the font size and bottom margin, and use Page Range Options if the cover should stay unnumbered.",
      },
      {
        title: "On a Mac without Acrobat",
        body: "Preview has no page number tool on any current macOS. Use a free offline PDF editor that has a header and footer or page number feature (PDFgear is one). Online tools like iLovePDF and Smallpdf do it too, but upload the file.",
      },
      {
        title: "Check the bottom of every page",
        body: "Page through the result at full size. Numbers can land on footnotes, table rows or an existing footer; if they do, raise the bottom margin setting or shrink the font and run it again.",
      },
    ],
    limits: [
      "It added plain numbers (1, 2, 3) centred at the bottom. For “Page 3 of 16”, another position, Roman numerals for front matter or an unnumbered cover, say so in the prompt.",
      "The numbers are stamped onto the pages of the PDF. If you later change the original Word file and export again, the new PDF needs numbering again.",
      "The report's text goes to the AI model you use in Stella while it works on the layout. For confidential documents, choose your model accordingly.",
      "Recorded on Linux, where Stella had the PDF tools it needed. On a Mac or Windows PC it may install a small PDF library first; that step wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can Preview add page numbers to a PDF?",
        a: "No. Preview can rotate, reorder, sign and redact pages, but it has no header, footer or page-number tool. Use the original document, a free PDF editor, or Stella.",
      },
      {
        q: "How do I start numbering on page 2?",
        a: "In Acrobat's Header & Footer, use Page Range Options and set the start number. In Word, tick Different First Page in the footer settings. With Stella, ask it to “skip the cover and start at 1 on page 2”.",
      },
      {
        q: "Will adding page numbers change my PDF?",
        a: "Acrobat and PDF24 write the numbers into whichever file you save. In the recording Stella saved a new copy with “- numbered” in the name, and the original was unchanged.",
      },
      {
        q: "Can it also split or combine the PDF?",
        a: "Yes, in the same chat. You can [split a scanned pile into one PDF per document](/how/pdf-excel/split-pdf-into-multiple-files), or number a merged file after combining. If the result is too big to send, [compress it](/how/pdf-excel/compress-pdf-too-large-to-email).",
      },
    ],
    related: ["pdf-excel/split-pdf-into-multiple-files", "pdf-excel/compress-pdf-too-large-to-email", "pdf-excel/redact-pdf", "pdf-excel/convert-epub-to-pdf"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "PDF24: Add page numbers to a PDF", href: "https://tools.pdf24.org/en/add-page-numbers" },
      { label: "Microsoft: Insert page numbers in Word", href: "https://support.microsoft.com/en-us/office/insert-page-numbers-9f366518-0500-4b45-903d-987d3827c007" },
    ],
  },
  {
    slug: "compare-two-excel-files",
    niche: "pdf-excel",
    searchPhrases: [
      "compare two excel sheets",
      "compare two excel files",
      "compare two excel sheets and highlight differences",
      "compare two excel files for differences",
      "compare two price lists in excel",
    ],
    title: "Compare two Excel files for differences, even re-sorted",
    description:
      "Find new, removed and changed rows between two Excel files, even when one was re-sorted: XLOOKUP by ID, Spreadsheet Compare, or Stella (stella.sh), checked.",
    h1: "Compare two Excel sheets and list what changed",
    short: "Compare two Excel files",
    lede: "Every new, removed and repriced item in one workbook, with old and new prices.",
    answer:
      "Match the rows by an ID column, not by position: if the supplier re-sorted the list, a row-by-row compare flags almost everything. In Excel, add an XLOOKUP that fetches each item's old price by its code, then filter for missing and changed values, and repeat the other way round to catch removed items. Stella (stella.sh) compares both files by item code and builds a new spreadsheet of what changed.",
    stellaSteps: [
      "Finds both price lists in Downloads and matches items by their SKU code, so the October list being re-sorted by description doesn't matter",
      "Builds a new workbook that opens on a Summary tab, with separate tabs for price changes, new items, removed items and other changes",
      "Shows the March price, October price, change in pounds and change in percent on every repriced row",
      "Picks out what's worth asking the supplier about: a pack size that doubled at the same price, and two new items with the same name at different prices",
      "Treats renamed items that kept their code as the same product, and says so",
    ],
    prompt:
      "Our supplier sent a new price list. Compare it with the March one (both are in Downloads) and make me a spreadsheet of what changed: new items, removed items and price changes.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "All 19 differences found in about 2 minutes 50 seconds: 9 price changes, 4 new items, 3 removed, two changed descriptions and one changed pack size. Checked afterwards against an answer key written before the run: nothing missed, no unchanged item listed as changed, the old and new price on every price-change row, and both price lists unchanged.",
      note: "The two price lists (240 items each) are fictitious, made for this run, and the October one was re-sorted on purpose. The work is sped up 10×.",
      video: {
        src: `${PROOFS}/pdf-excel/compare-two-excel-files/proof.mp4`,
        cuts: webCuts("pdf-excel/compare-two-excel-files"),
        poster: `${PROOFS}/pdf-excel/compare-two-excel-files/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 45.6,
        realDuration: 169,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Two supplier price lists, March and October, are in Downloads." },
        { at: 2, text: "The prompt: compare them and make a spreadsheet of new items, removed items and price changes." },
        { at: 13.4, text: "Stella replies: old and new prices side by side, with the % difference, and a short summary at the end." },
        { at: 19.2, text: "Comparing 240 items by code, sped up 10×." },
        { at: 31.6, text: "Done: 9 price changes, 4 new items, 3 removed, 225 unchanged, plus three things to ask the supplier about." },
      ],
    },
    manualTitle: "Compare them yourself",
    manualSteps: [
      {
        title: "Put both lists in one workbook",
        body: "Open both files and copy the old list into the new workbook as a second sheet (right-click its tab, Move or Copy, tick Create a copy). Name the sheets March and October so the formulas below read clearly.",
      },
      {
        title: "Look up each item's old price",
        body: "On the October sheet, in a new column E, enter `=XLOOKUP(A2, March!A:A, March!D:D, \"new\")`, where column A holds the item code and D the price, and fill it down. Items that weren't in March show “new”. In column F, `=IF(E2=\"new\", \"new\", IF(D2<>E2, \"changed\", \"\"))` labels each row.",
      },
      {
        title: "Do it the other way round for removed items",
        body: "On the March sheet, the same XLOOKUP pointed at October's codes returns your fallback text, say “removed”, for anything dropped from the new list. Filter both sheets on these columns and copy the results to a new sheet.",
      },
      {
        title: "Or use Spreadsheet Compare (Windows)",
        body: "With Microsoft 365 Apps for enterprise or Office Professional Plus, open Spreadsheet Compare from the Start menu and choose Compare Files. It compares cell by cell, so sort both files by item code first or every row after the first difference shows as changed.",
      },
      {
        title: "Highlight instead of list",
        body: "To see differences in place, select the October prices, choose Conditional Formatting, New Rule, Use a formula, and enter `=D2<>XLOOKUP(A2, March!A:A, March!D:D, D2)` with a fill colour. It only works when both sheets share an ID column.",
      },
    ],
    limits: [
      "Stella matched on the SKU column. If your files have no unique ID, it has to match on names or several columns together; ask it to say which columns it used.",
      "It compared values, not formatting, formulas or comments. Ask separately if a colour or a formula change matters to you.",
      "Recorded on Linux with no Excel installed. The result is an ordinary .xlsx with several tabs, which opens in Excel, Numbers or Google Sheets.",
      "The rows of both lists go to the AI model you use in Stella while it compares them. For commercially sensitive price lists, choose your model accordingly.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why does comparing two sheets show everything as different?",
        a: "The rows aren't in the same order, so row 5 in one file is a different item from row 5 in the other. Compare by an ID column with XLOOKUP, or sort both by that ID first.",
      },
      {
        q: "Is there a built-in way to compare two Excel files?",
        a: "Spreadsheet Compare comes only with Microsoft 365 Apps for enterprise and Office Professional Plus on Windows. Home and Business plans and Excel for Mac don't include it, so the XLOOKUP route is the usual one.",
      },
      {
        q: "Does XLOOKUP work in my version of Excel?",
        a: "It's in Microsoft 365 and Excel 2021 or later on Windows and Mac, and in Google Sheets. In older Excel use `=VLOOKUP(A2, March!A:D, 4, FALSE)`, which shows #N/A for new items.",
      },
      {
        q: "Can it combine the files instead?",
        a: "To stack many files into one sheet, see [combine Excel files into one sheet](/how/pdf-excel/combine-excel-files-into-one-sheet). To turn each row into a letter, see [mail merge from Excel to Word](/how/documents/mail-merge-excel-to-word).",
      },
    ],
    related: ["pdf-excel/combine-excel-files-into-one-sheet", "pdf-excel/receipts-to-spreadsheet", "documents/mail-merge-excel-to-word", "pdf-excel/remove-duplicate-rows-in-excel"],
    lastChecked: "2026-11-13",
    sources: [
      {
        label: "Microsoft: Compare two versions of a workbook by using Spreadsheet Compare",
        href: "https://support.microsoft.com/en-us/office/compare-two-versions-of-a-workbook-by-using-spreadsheet-compare-0e1627fd-ce14-4c33-9ab1-8ea82c6a5a7e",
      },
      { label: "Microsoft: XLOOKUP function", href: "https://support.microsoft.com/en-us/office/xlookup-function-b7fd680e-6d10-43e6-84f9-88eae8bf5929" },
      { label: "Exceldemy: Compare two Excel sheets and highlight differences", href: "https://www.exceldemy.com/compare-two-excel-sheets-and-highlight-differences/" },
    ],
  },
  {
    slug: "make-scanned-pdf-searchable",
    niche: "pdf-excel",
    searchPhrases: [
      "make scanned pdf searchable",
      "ocr pdf",
      "make pdf searchable free",
      "scanned pdf to text",
      "ocr pdf mac",
    ],
    title: "Make a scanned PDF searchable (free OCR, no upload)",
    description:
      "Ctrl+F finds nothing in a scanned PDF? Add a text layer with OCR: OCRmyPDF, PDF24, Acrobat, or Stella (stella.sh) on your own computer, the scan kept as it was.",
    h1: "Make a scanned PDF searchable",
    short: "Make a scanned PDF searchable",
    lede: "A 6-page scanned lease you can search, looking exactly like the scan.",
    answer:
      "A scan is a picture of text, so search finds nothing until OCR (text recognition) adds an invisible text layer. Free routes: OCRmyPDF from the command line on any system, or PDF24 Creator's OCR tool on Windows; Acrobat's Scan & OCR does it if you pay. Preview on a Mac can't. Stella (stella.sh) runs OCR on your computer, saves a searchable copy next to the scan and checks that searches work.",
    stellaSteps: [
      "Finds the scanned lease in Downloads: 6 pages of page images with no text in them",
      "Installs OCRmyPDF, a free text-recognition tool, and runs it on a copy, not the original",
      "Keeps each page looking exactly like the scan, with the recognised text laid invisibly underneath so you can search and select it",
      "Checks the result by searching for the names, the address and the dates",
      "Warns you about a catch it found: the rent is written only in words, so searching “14,200” won't find it",
    ],
    prompt: "The scanned lease in my Downloads isn't searchable. I can't find anything in it with Ctrl+F. Can you make it searchable?",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "A searchable copy of the 6-page lease in about 1 minute 40 seconds. Checked afterwards against an answer key written before the run: every page has a text layer, all 15 key phrases can be found by search, the pages look identical to the scan, the page count is the same and the file (2.6 MB) is no more than three times the original's size.",
      note: "The lease is fictitious, scanned for this run as greyscale page images with slight skew, blur and noise. The prompt says Ctrl+F because it ran on Linux. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/pdf-excel/make-scanned-pdf-searchable/proof.mp4`,
        cuts: webCuts("pdf-excel/make-scanned-pdf-searchable"),
        poster: `${PROOFS}/pdf-excel/make-scanned-pdf-searchable/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 47.1,
        realDuration: 101,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A 6-page scanned lease with no text layer is in Downloads." },
        { at: 2, text: "The prompt: I can't find anything in it with Ctrl+F. Can you make it searchable?" },
        { at: 15.2, text: "Stella replies: it'll run text recognition and save a searchable copy next to the original." },
        { at: 21, text: "Installing an OCR tool and reading six pages, sped up 4×." },
        { at: 33, text: "Done: a searchable copy that looks the same as the scan, and a warning that the rent is only written in words." },
      ],
    },
    manualTitle: "Run OCR yourself",
    manualSteps: [
      {
        title: "Check whether it really is a scan",
        body: "Open the PDF and try to select a line of text. If you can't, or the whole page highlights as one block, it's a picture. A PDF you can select but still can't search may use an odd font encoding; OCR fixes that too.",
      },
      {
        title: "Any system: OCRmyPDF",
        body: "The free [OCRmyPDF](https://ocrmypdf.readthedocs.io) adds a text layer and keeps the page images: `ocrmypdf --language eng scan.pdf searchable.pdf`. Add `--deskew` for crooked pages. On a Mac it usually comes from Homebrew (`brew install ocrmypdf`), on Linux from your package manager.",
      },
      {
        title: "Windows: PDF24 Creator",
        body: "Install the free PDF24 Creator, open its OCR tool, add the PDF, choose the document's language and start. It saves a new searchable PDF and runs on your computer, so the scan isn't uploaded.",
      },
      {
        title: "Mac without Terminal",
        body: "Preview can't add a text layer. A free PDF app with OCR, such as PDFgear (its OCR to Searchable PDF option), does it in a few clicks. Acrobat (paid) has Scan & OCR, Recognize text, In this file.",
      },
      {
        title: "Test the result",
        body: "Search for a name, a date and a number from different pages. OCR misreads small print and smudged figures (1 and 7, 0 and O), so check any amount that matters against the page itself.",
      },
    ],
    limits: [
      "OCR can misread small print, handwriting and smudged numbers. The test scan was clean enough that every search worked, but check figures that matter on your own documents.",
      "Handwritten notes and signatures stay as pictures; they aren't turned into text.",
      "Recorded on Linux, where the Tesseract text-recognition engine was already installed and Stella added OCRmyPDF. A Mac usually has neither, and installing them normally needs Homebrew, so Stella would take a different route there, such as macOS's built-in text recognition; that wasn't recorded.",
      "Recognition runs on your computer, but the recognised text goes to the AI model you use in Stella when it checks the result. For confidential papers, choose your model accordingly.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why can't I search my scanned PDF?",
        a: "A scanner or phone app saves each page as a photo. There's no text in the file for search to find until OCR adds a hidden text layer behind the picture.",
      },
      {
        q: "Can Preview make a PDF searchable?",
        a: "No. Preview can search and copy text that's already in a PDF, but it can't recognise the text in a scan and save it into the file. Use one of the tools above.",
      },
      {
        q: "Is there a free way to OCR a PDF without uploading it?",
        a: "Yes: OCRmyPDF on any system, PDF24 Creator on Windows, or Stella with the plan you already have. Online OCR sites work, but a lease or medical letter is exactly what you'd rather keep on your computer.",
      },
      {
        q: "Will OCR make the file bigger?",
        a: "A little: the text layer is small next to the page images. In the recording the copy stayed within three times the original. If it's too big to send, [compress the PDF](/how/pdf-excel/compress-pdf-too-large-to-email); to pull figures into a sheet, see [bank statement PDF to Excel](/how/pdf-excel/bank-statement-pdf-to-excel).",
      },
    ],
    related: ["pdf-excel/compress-pdf-too-large-to-email", "pdf-excel/split-pdf-into-multiple-files", "pdf-excel/redact-pdf", "pdf-excel/rotate-pdf-pages"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "OCRmyPDF documentation", href: "https://ocrmypdf.readthedocs.io/en/latest/" },
      { label: "PDFgear: Make a PDF searchable on Mac", href: "https://www.pdfgear.com/mac-user-guide/make-pdf-searchable.htm" },
      { label: "PDF24 Creator", href: "https://tools.pdf24.org/en/creator" },
    ],
  },
  {
    slug: "convert-epub-to-pdf",
    niche: "pdf-excel",
    searchPhrases: [
      "convert epub to pdf",
      "epub to pdf",
      "epub to pdf converter",
      "convert epub to pdf free",
      "print an epub book",
    ],
    title: "Convert EPUB to PDF to print it (free, no upload)",
    description:
      "Turn a DRM-free EPUB ebook into a printable PDF with the chapters, cover and pictures kept: Calibre, or Stella (stella.sh) on your own computer, no converter site.",
    h1: "Convert an EPUB to PDF so you can print it",
    short: "Convert EPUB to PDF",
    lede: "A whole ebook as a 19-page printable PDF, with contents, page numbers and pictures.",
    answer:
      "The free Calibre app is the usual route: add the book, choose Convert books, set the output format to PDF and pick your paper size. Online converters work too, but upload the book. Apple Books and most ebook apps can't export a PDF. Stella (stella.sh) converts a DRM-free EPUB on your computer, keeps every chapter, the cover and the illustrations, and adds a contents page and page numbers.",
    stellaSteps: [
      "Finds the ebook in Downloads and reads its chapters, cover, illustrations and styles",
      "Lays the book out as printable pages with a contents page and page numbers, using a browser engine already on the computer",
      "Keeps all 8 chapters, the cover and the map, moving the map to the top of a page instead of splitting it across two",
      "Saves the PDF next to the ebook, with the same name",
      "Says the pages are US Letter and offers an A4 copy if your printer uses A4",
    ],
    prompt: "Convert the lighthouse ebook in my Downloads to a PDF so I can print it.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "A 19-page PDF of the whole book in about 2 minutes 15 seconds. Checked afterwards against an answer key written before the run: the text is real, selectable text, all 8 chapter headings are there in order, all 72 paragraphs are present, and the cover and the map are included. It missed one optional check: the PDF has no chapter bookmarks in the sidebar.",
      note: "The ebook is a short book written for this run by a fictitious author, DRM-free. The work is sped up 7×.",
      video: {
        src: `${PROOFS}/pdf-excel/convert-epub-to-pdf/proof.mp4`,
        cuts: webCuts("pdf-excel/convert-epub-to-pdf"),
        poster: `${PROOFS}/pdf-excel/convert-epub-to-pdf/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 46.4,
        realDuration: 136,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. An EPUB ebook is in Downloads." },
        { at: 2.1, text: "The prompt: convert it to a PDF so I can print it." },
        { at: 14.1, text: "Stella replies that it's converting the book and will mention anything that didn't convert cleanly." },
        { at: 19.8, text: "Laying out and checking the book, sped up 7×." },
        { at: 32.4, text: "Done: 19 pages with all 8 chapters, the cover, the map, a contents page and page numbers, on US Letter with an A4 copy offered." },
      ],
    },
    manualTitle: "Convert it yourself",
    manualSteps: [
      {
        title: "Install Calibre",
        body: "Download the free Calibre from calibre-ebook.com (Windows, Mac and Linux) and add the book with Add books. It works on DRM-free EPUBs; books bought from Kindle, Apple Books or Kobo are usually locked to their apps.",
      },
      {
        title: "Convert to PDF",
        body: "Select the book, click Convert books, and set Output format to PDF in the top right. Under PDF output, choose the paper size (A4 or Letter), and tick the options to add a page-number footer if you want one. Click OK.",
      },
      {
        title: "Find the PDF",
        body: "When the job finishes, click the book, then the PDF link under Formats on the right, or right-click and Open containing folder. Calibre keeps it in its library folder, not next to the EPUB.",
      },
      {
        title: "Check the layout before printing",
        body: "Look at a page with a picture and a chapter start. If the margins or font size are off, change them under Convert books, Page setup and Look & feel, and convert again. Print a single page first.",
      },
      {
        title: "Short book? Print from a reader",
        body: "Some desktop ebook readers can print a chapter at a time, and on a Mac you can choose PDF in the print dialog to save it. It's slower than Calibre for a whole book but needs nothing installed beyond the reader.",
      },
    ],
    limits: [
      "No chapter bookmarks: the PDF has a contents page and page numbers, but no clickable chapter list in the PDF viewer's sidebar. Ask for bookmarks if you'll read it on screen.",
      "It made US Letter pages. Ask for A4 if that's your paper; Stella offered to make an A4 copy.",
      "It only works on DRM-free ebooks. Stella won't remove DRM from books bought on Kindle, Apple Books or Kobo; many shops sell DRM-free EPUBs, and public-domain books are DRM-free.",
      "Recorded on Linux, where a browser engine was already installed for the layout. On a Mac or Windows PC Stella may need to install a converter first, which wasn't recorded.",
      "The book's text goes to the AI model you use in Stella while it lays out and checks the pages.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can Apple Books save an EPUB as PDF?",
        a: "No. Apple Books has no export to PDF, and books bought there are protected. For a DRM-free EPUB, use Calibre or Stella.",
      },
      {
        q: "Will the PDF look like the ebook?",
        a: "Close to it: chapters, headings, italics and pictures carry over, but an EPUB has no fixed pages, so the layout is new. In the recording the map moved to the top of a page rather than being split.",
      },
      {
        q: "Can I convert a Kindle book to PDF?",
        a: "Only if it's DRM-free, which most Kindle purchases aren't. Stella won't strip DRM. Many authors and shops sell DRM-free EPUBs you can convert.",
      },
      {
        q: "What else can I do with the PDF?",
        a: "Anything you'd do with a PDF: [add page numbers](/how/pdf-excel/add-page-numbers-to-pdf) in a different style, or [split it into parts](/how/pdf-excel/split-pdf-into-multiple-files) to print a chapter at a time.",
      },
    ],
    related: ["pdf-excel/add-page-numbers-to-pdf", "pdf-excel/split-pdf-into-multiple-files", "pdf-excel/make-scanned-pdf-searchable", "pdf-excel/convert-mobi-to-epub"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Calibre: E-book conversion", href: "https://manual.calibre-ebook.com/conversion.html" },
      { label: "Calibre download", href: "https://calibre-ebook.com/download" },
    ],
  },
  // ---- batch 3 (writer 2) ----
  {
    slug: "convert-excel-to-pdf-without-cutting-off",
    niche: "pdf-excel",
    searchPhrases: [
      "convert excel to pdf without cutting off",
      "excel to pdf columns on separate pages",
      "excel to pdf fit to one page",
      "convert excel to pdf landscape",
      "excel to pdf",
    ],
    title: "Convert Excel to PDF without cutting off columns",
    description:
      "Excel to PDF spilling columns onto extra pages? Set landscape and fit to one page wide on every sheet, or let Stella (stella.sh) make the PDF with each sheet fitted.",
    h1: "Convert Excel to PDF without the columns being cut off",
    short: "Excel to PDF, nothing cut off",
    lede: "A four-week staff rota as four landscape pages, every day of the week together.",
    answer:
      "Excel prints what fits on a portrait page and moves the rest of the columns to extra pages. On each sheet, set Page Layout, Orientation to Landscape and Scale to Fit to Width 1 page, Height Automatic, then export the entire workbook as PDF. Stella (stella.sh) does that for every sheet on a copy, makes the PDF on your computer, and checks that every row sits on a page with all its columns.",
    stellaSteps: [
      "Finds the rota workbook in Documents: four sheets, one per week, 16 columns from Name and Role to Sun PM",
      "Sets each sheet to landscape and one page wide, working on a copy so your spreadsheet's own print settings stay as they were",
      "Makes one PDF of all four weeks and checks every staff member's row is on a page that also has Monday and Sunday",
      "Saves Staff rota November.pdf next to the spreadsheet",
      "Points out something in the data worth checking: some people's roles change week to week, which may be a typing slip",
    ],
    prompt:
      "When I save my staff rota spreadsheet as a PDF the right-hand columns end up on separate pages. Make a PDF of it where each week fits across one page, with all the days together.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "A 4-page PDF in about a minute and a half. Checked afterwards against an answer key written before the run: all 4 weeks in the PDF, all 88 staff rows each on a page with every day up to Sun PM, one page per week (a plain export makes 12), the smallest text 8.2 pt, and the spreadsheet unchanged.",
      note: "The shop, its staff and the rota are fictitious, made for this run. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/pdf-excel/convert-excel-to-pdf-without-cutting-off/proof.mp4`,
        cuts: webCuts("pdf-excel/convert-excel-to-pdf-without-cutting-off"),
        poster: `${PROOFS}/pdf-excel/convert-excel-to-pdf-without-cutting-off/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 45.8,
        realDuration: 92,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A four-week staff rota workbook is in Documents." },
        { at: 1.6, text: "The prompt: make a PDF where each week fits across one page." },
        { at: 13.6, text: "Stella replies that the spreadsheet won't change and the PDF will go in the same folder." },
        { at: 19.6, text: "Fitting the sheets and making the PDF, sped up 4×." },
        { at: 31.3, text: "Done: four landscape pages, one per week, all seven days and 22 staff on each, plus a note about roles that change between weeks." },
      ],
    },
    manualTitle: "Fit it yourself in Excel",
    manualSteps: [
      {
        title: "Check what's spilling",
        body: "Open File, Print and page through the preview. If the last columns appear on their own pages, the sheet is wider than the paper at 100% scale.",
      },
      {
        title: "Switch to landscape",
        body: "On the Page Layout tab, choose Orientation, Landscape. For wide sheets this alone often brings most columns back.",
      },
      {
        title: "Fit to one page wide",
        body: "Still on Page Layout, in the Scale to Fit group set Width to 1 page and Height to Automatic. Excel shrinks the sheet just enough for every column to fit across, and lets long sheets continue down onto more pages.",
      },
      {
        title: "Repeat on every sheet",
        body: "Page setup is per sheet. Click each tab and set it again, or select all the tabs first (right-click a tab, Select All Sheets) and change them together; ungroup afterwards so later edits don't go to every sheet.",
      },
      {
        title: "Export the whole workbook",
        body: "Windows: File, Export, Create PDF/XPS, Options, Entire workbook. Mac: File, Save As, File Format PDF, and choose Workbook. Open the PDF and check the last column is on every page.",
      },
    ],
    limits: [
      "Very wide sheets shrink a lot when squeezed onto one page. Here the smallest text was 8.2 pt; for something wider, Stella can say a sheet really needs two pages or suggest A3.",
      "Stella left the spreadsheet's own print settings alone. Ask it to change them if you want Excel's Print to come out the same way.",
      "The PDF is made on your computer; nothing goes to a converter site. Stella read the rota to check the PDF, so staff names went to the AI model you use.",
      "Recorded on Linux without Excel: Stella set the page layout on a copy and exported with the free LibreOffice. On Windows or a Mac it may use Excel instead, if you have it.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why does my Excel PDF split columns onto separate pages?",
        a: "At 100% scale on portrait paper, the sheet is wider than the page, so Excel prints the overflow columns on their own pages after the rest. Landscape plus Fit to 1 page wide fixes it.",
      },
      {
        q: "How do I fit an Excel sheet on one page as a PDF?",
        a: "Page Layout, Scale to Fit: Width 1 page, Height 1 page. For long lists, keep Height on Automatic so the rows stay readable over several pages.",
      },
      {
        q: "Why is only one sheet in my PDF?",
        a: "Excel exports the active sheet by default. Choose Entire workbook in the export options, or select all the sheet tabs before saving.",
      },
      {
        q: "Can I combine the rota PDF with other PDFs?",
        a: "Yes, and you can put pages in any order after: see [reorder PDF pages](/how/pdf-excel/reorder-pdf-pages). To send it as pictures instead, [convert the PDF to JPG](/how/pdf-excel/convert-pdf-to-jpg).",
      },
    ],
    related: ["pdf-excel/convert-pdf-to-jpg", "pdf-excel/reorder-pdf-pages", "pdf-excel/fix-dates-in-excel"],
    lastChecked: "2026-11-13",
    sources: [{ label: "Microsoft: Scale a worksheet", href: "https://support.microsoft.com/en-us/Excel/scale-a-worksheet" }],
  },
  {
    slug: "convert-mobi-to-epub",
    niche: "pdf-excel",
    searchPhrases: [
      "mobi to epub",
      "azw3 to epub",
      "convert mobi to epub calibre",
      "convert kindle books to epub",
      "mobi to epub free",
    ],
    title: "Convert MOBI and AZW3 ebooks to EPUB (free)",
    description:
      "Turn old Kindle-format .mobi and .azw3 ebooks into EPUB for Kobo and other e-readers with the free Calibre, or let Stella (stella.sh) install it and convert the batch.",
    h1: "Convert MOBI and AZW3 ebooks to EPUB",
    short: "MOBI to EPUB",
    lede: "Three old Kindle-format books turned into EPUBs, titles and covers kept.",
    answer:
      "Install the free Calibre, drag the .mobi and .azw3 files into it, select them, click Convert books and choose EPUB as the output format. Calibre keeps the title, author and cover. Renaming the file to .epub doesn't work: the inside is a different format. Books bought from Amazon usually carry DRM and won't convert. Stella (stella.sh) installs Calibre's converter if needed and converts the whole batch on your computer.",
    stellaSteps: [
      "Finds the .mobi and .azw3 files in Downloads",
      "Installs Calibre, the free ebook tool, into your home folder because it wasn't on the computer",
      "Converts each book to EPUB with Calibre's converter, keeping title, author and cover",
      "Saves each EPUB next to its original, which stays where it was",
      "Reports that none were DRM-locked or damaged, and that the books still need a check on your e-reader",
    ],
    prompt:
      "I've got some old Kindle-format ebooks in my Downloads (.mobi and .azw3) that my new e-reader won't open. Convert them to EPUB.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Three EPUBs in about a minute and a half, including installing Calibre. Checked afterwards against an answer key written before the run: three valid EPUB files with every chapter's text, title and author kept, covers kept, and the original ebooks unchanged.",
      note: "The three books are fictitious and DRM-free, made for this run and converted to MOBI and AZW3 with Calibre. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/pdf-excel/convert-mobi-to-epub/proof.mp4`,
        cuts: webCuts("pdf-excel/convert-mobi-to-epub"),
        poster: `${PROOFS}/pdf-excel/convert-mobi-to-epub/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 49.3,
        realDuration: 98,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Two .mobi books and one .azw3 are in Downloads." },
        { at: 1.7, text: "The prompt: convert them to EPUB for a new e-reader." },
        { at: 18.7, text: "Stella replies that each EPUB will sit next to its original, and DRM-locked books will be listed separately." },
        { at: 24.5, text: "Installing Calibre and converting, sped up 4×." },
        { at: 35.7, text: "Done: all three are EPUBs with title, author and cover kept; none were locked." },
      ],
    },
    manualTitle: "Convert them yourself with Calibre",
    manualSteps: [
      {
        title: "Install Calibre",
        body: "Download it free from [calibre-ebook.com](https://calibre-ebook.com/download) for Windows, Mac or Linux and run the installer. On first start it asks where to keep its library; the default is fine.",
      },
      {
        title: "Add the books",
        body: "Drag the .mobi and .azw3 files into Calibre's window. They appear in the list with their covers. Check the title and author columns; double-click to fix them before converting if they're wrong.",
      },
      {
        title: "Convert to EPUB",
        body: "Select the books (Ctrl+A or Cmd+A for all), click Convert books, set Output format (top right) to EPUB and click OK. The Jobs counter at the bottom right shows progress.",
      },
      {
        title: "Find the EPUB files",
        body: "Right-click a book, Open containing folder. The EPUB sits in Calibre's library folder next to the original. Copy it to your e-reader, or connect the reader and use Send to device.",
      },
      {
        title: "Command line, for many books",
        body: "Calibre includes `ebook-convert`. In a terminal: `ebook-convert \"book.mobi\" \"book.epub\"`, one line per book, or loop over a folder.",
      },
    ],
    limits: [
      "Books bought from the Kindle store are usually DRM-protected. Stella won't remove DRM, so those can't be converted; it lists them separately.",
      "Comics, picture books and fixed-layout ebooks may not convert well. Ordinary novels and non-fiction convert cleanly.",
      "Stella installed Calibre (about 100 MB) in the home folder to do this. It stays there for next time; ask Stella to remove it if you'd rather.",
      "The conversion runs on your computer. Only file names and the books' metadata go to the AI model you use; it doesn't need to read the books.",
      "Recorded on Linux. On Windows and Mac Stella uses the same Calibre converter from its normal installer.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can I just rename .mobi to .epub?",
        a: "No. The file inside is still MOBI, and the e-reader will reject it or show nothing. It has to be converted.",
      },
      {
        q: "What's the difference between MOBI, AZW3 and EPUB?",
        a: "MOBI and AZW3 are Amazon's Kindle formats (AZW3 is the newer). EPUB is the open format that Kobo, Apple Books, Google Play Books and most other readers use.",
      },
      {
        q: "Why won't my Kindle book convert?",
        a: "It almost certainly has DRM, which locks it to your Amazon account. Calibre won't convert it, and neither will Stella.",
      },
      {
        q: "Can I get a PDF instead?",
        a: "Yes: choose PDF as the output in Calibre, or ask Stella. See [convert EPUB to PDF](/how/pdf-excel/convert-epub-to-pdf) for the settings that matter.",
      },
    ],
    related: ["pdf-excel/convert-epub-to-pdf", "pdf-excel/extract-images-from-pdf", "pdf-excel/convert-pdf-to-jpg"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Calibre download", href: "https://calibre-ebook.com/download" },
      { label: "ebook-convert manual", href: "https://manual.calibre-ebook.com/generated/en/ebook-convert.html" },
    ],
  },
  {
    slug: "convert-pdf-to-jpg",
    niche: "pdf-excel",
    searchPhrases: [
      "pdf to jpg",
      "convert pdf to jpg",
      "convert pdf to images",
      "convert pdf to jpg high quality",
      "convert all pages of pdf to jpg",
    ],
    title: "Convert every PDF page to a JPG, sharp and in order",
    description:
      "Turn each page of a PDF into a JPG sharp enough to read on a phone, without uploading it: Preview, PDF24 Creator, or Stella (stella.sh) doing every page at once.",
    h1: "Convert a PDF to JPG, one sharp picture per page",
    short: "PDF to JPG",
    lede: "A 12-page newsletter as 12 JPGs, readable on a phone and named in page order.",
    answer:
      "On a Mac, Preview exports the page you select as a JPEG (set Resolution to 150 or more), one page at a time. Windows has nothing built in; the free PDF24 Creator converts every page offline. Online converters work but upload the file. Stella (stella.sh) turns every page into a JPG on your computer at a resolution that reads well on a phone, with names that sort in page order.",
    stellaSteps: [
      "Finds the newsletter PDF in Downloads (12 pages)",
      "Renders each page as a JPG large enough to zoom in and read on a phone",
      "Names them page-01 to page-12, so page 10 sorts after page 9 rather than after page 1",
      "Saves them in a new folder next to the PDF and leaves the PDF unchanged",
      "Tells you the size: about 450 KB a picture, 5 MB for the set, easy to send",
    ],
    prompt:
      "Turn every page of the Larkfield Village News PDF in my Downloads into a JPG I can share, one picture per page, sharp enough to read on a phone.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "12 JPGs in about 80 seconds. Checked afterwards against an answer key written before the run: exactly 12 real JPEG files, one matching each page, each at least 1,600 pixels on its long side, file names sorting in page order, and the PDF unchanged.",
      note: "The village newsletter and its pictures are fictitious, made for this run. The work is sped up 2×.",
      video: {
        src: `${PROOFS}/pdf-excel/convert-pdf-to-jpg/proof.mp4`,
        cuts: webCuts("pdf-excel/convert-pdf-to-jpg"),
        poster: `${PROOFS}/pdf-excel/convert-pdf-to-jpg/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 49.1,
        realDuration: 81,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A 12-page newsletter PDF is in Downloads." },
        { at: 1.7, text: "The prompt: one JPG per page, sharp enough to read on a phone." },
        { at: 16.7, text: "Stella replies that it's turning each page into a JPG." },
        { at: 22.6, text: "Rendering the pages, sped up 2×." },
        { at: 34.9, text: "Done: 12 JPGs in page order in a new folder in Downloads, about 5 MB together." },
      ],
    },
    manualTitle: "Convert it yourself",
    manualSteps: [
      {
        title: "On a Mac: Preview",
        body: "Open the PDF in Preview, show thumbnails (View, Thumbnails), click a page, then File, Export. Choose JPEG, set Resolution to 150 or higher, and save. Repeat for each page. 72 is the default and too blurry for small print.",
      },
      {
        title: "On a Mac, many pages: Shortcuts",
        body: "The Shortcuts app can split a PDF into pages and convert each to JPEG in one go. Build it once (Split PDF Into Pages, Convert Image to JPEG, Save File) and run it from the Finder's Quick Actions.",
      },
      {
        title: "On Windows: PDF24 Creator",
        body: "Install the free PDF24 Creator (it works offline), open its PDF to Images tool, add the file, choose JPG and 150 dpi or more, and convert. Every page becomes its own image.",
      },
      {
        title: "Command line: pdftoppm",
        body: "With poppler installed (built into most Linux systems, `brew install poppler` on a Mac): `pdftoppm -jpeg -r 200 newsletter.pdf page` writes page-01.jpg, page-02.jpg and so on.",
      },
      {
        title: "Check names and size",
        body: "Sort the folder by name: page 10 should follow page 9. Open one image on your phone and zoom in on small print. If it's soft, redo it at 200 dpi.",
      },
    ],
    limits: [
      "Large pages at high resolution make big files. Stella aims for phone-readable sizes unless you ask for print quality.",
      "Every page becomes a flat picture: the text is no longer selectable or searchable in the JPGs.",
      "The conversion runs on your computer and nothing is uploaded. Stella may look at a page or two to check sharpness, so page content goes to the AI model you use.",
      "Recorded on Linux with poppler's free tools. On Windows or a Mac Stella uses the same kind of tool, installing it if needed.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I convert a PDF to JPG without losing quality?",
        a: "Export at 150 to 300 dpi rather than the 72 dpi default, and use high JPEG quality. For pictures inside the PDF at their original size, [extract the images](/how/pdf-excel/extract-images-from-pdf) instead.",
      },
      {
        q: "Can I convert only some pages?",
        a: "Yes. In Preview, export just the pages you want; with pdftoppm add `-f 3 -l 5` for pages 3 to 5; or name the pages in your prompt to Stella.",
      },
      {
        q: "Why do my page images sort 1, 10, 11, 2?",
        a: "The numbers aren't padded. Names like page-01, page-02 sort correctly. Stella used padded numbers here.",
      },
      {
        q: "JPG or PNG?",
        a: "JPG is smaller and fine for photos and sharing. PNG keeps text edges crisper and is bigger. Ask for PNG if you'll print or edit the pages.",
      },
    ],
    related: ["pdf-excel/extract-images-from-pdf", "pdf-excel/compress-pdf-too-large-to-email", "pdf-excel/rotate-pdf-pages"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "PDF24 Creator (free, offline, Windows)", href: "https://tools.pdf24.org/en/creator" },
      { label: "pdftoppm manual", href: "https://manpages.debian.org/testing/poppler-utils/pdftoppm.1.en.html" },
    ],
  },
  {
    slug: "extract-images-from-pdf",
    niche: "pdf-excel",
    searchPhrases: [
      "extract images from pdf",
      "extract images from pdf mac",
      "extract images from pdf full resolution",
      "save pictures from pdf",
      "get photos out of a pdf",
    ],
    title: "Extract images from a PDF at full quality",
    description:
      "Get the original photos out of a PDF at full size, not page screenshots, without uploading it: pdfimages, PDF24, or Stella (stella.sh) pulling them out for you.",
    h1: "Extract the images from a PDF at full quality",
    short: "Extract images from a PDF",
    lede: "Eight brochure photos pulled out at their original size, not screenshots.",
    answer:
      "Screenshots and Preview's copy give you the picture at screen size. To get the stored original, use a tool that extracts embedded images: the free `pdfimages -all` command, PDF24's Extract images tool, or LibreOffice Draw (right-click a picture, Save). Stella (stella.sh) pulls every photo out of the PDF on your computer at its full stored size, skips repeats and logos, and names each one after its caption.",
    stellaSteps: [
      "Finds the brochure PDF in Downloads and lists every picture stored inside it",
      "Copies the photos out as their original files, without re-compressing them, at full size (1200×1600 up to 2000×1125 here)",
      "Keeps the transparent oval cut-out of one photo by saving it as a PNG",
      "Leaves out the small logo repeated on every page and a second copy of the cover photo",
      "Names each file by page, position and its caption from the brochure, like “p1-1 Harbour at dawn.jpg”, in a new folder next to the PDF",
    ],
    prompt:
      "There's a brochure PDF in my Downloads with photos in it. Get all the photos out as separate picture files at full quality, not screenshots of the pages.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "8 photos in under 2 minutes. Checked afterwards against an answer key written before the run: each of the 8 photos found at its full original size and matching it, the cut-out picture keeping its transparency, no flood of duplicates or page renders (exactly 8 files), and the brochure unchanged.",
      note: "The walking club, its brochure and photos are fictitious, drawn for this run. The work is sped up 6×.",
      video: {
        src: `${PROOFS}/pdf-excel/extract-images-from-pdf/proof.mp4`,
        cuts: webCuts("pdf-excel/extract-images-from-pdf"),
        poster: `${PROOFS}/pdf-excel/extract-images-from-pdf/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 45.2,
        realDuration: 109,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A six-page brochure PDF is in Downloads." },
        { at: 1.6, text: "The prompt: all the photos as separate files at full quality, not page screenshots." },
        { at: 13.6, text: "Stella replies that it will pull out the original image files into a new folder." },
        { at: 19.6, text: "Finding and extracting the pictures, sped up 6×." },
        { at: 30.8, text: "Done: 8 photos named by caption, seven original JPEGs and one PNG with its see-through corners; the repeated logo left out." },
      ],
    },
    manualTitle: "Extract them yourself",
    manualSteps: [
      {
        title: "Command line: pdfimages",
        body: "With poppler installed (most Linux systems; `brew install poppler` on a Mac; on Windows via the poppler builds or WSL), run `pdfimages -list brochure.pdf` to see every picture and its real size, then `pdfimages -all brochure.pdf photo` to save them in their original format.",
      },
      {
        title: "On Windows: PDF24",
        body: "The free PDF24 Creator has an Extract images tool that runs offline. Add the PDF and it saves every embedded picture to a folder.",
      },
      {
        title: "Any computer: LibreOffice Draw",
        body: "Open the PDF in the free LibreOffice Draw, right-click a picture, choose Save (or Export), and save it as a file. One picture at a time, but at its stored size.",
      },
      {
        title: "Tidy the results",
        body: "Extractors save everything: logos, page decorations, masks as separate black-and-white images, and the same photo twice if it's used twice. Sort by size and delete the small ones and repeats.",
      },
      {
        title: "Avoid screenshots and copy",
        body: "Copying a picture in Preview or Acrobat, or screenshotting it, gives you what's on screen, often a fraction of the stored size. Use those only if nothing above is available.",
      },
    ],
    limits: [
      "This gets the pictures stored in the PDF. In a scanned PDF each whole page is one picture, so the photos would have to be cropped out of the page instead.",
      "Some PDFs store pictures already shrunk; full quality means the size stored in the file, which may be smaller than the original photo.",
      "Extraction runs on your computer, nothing uploaded. Stella reads the brochure's captions to name the files, so that text goes to the AI model you use.",
      "Recorded on Linux with free tools. On a Mac or Windows Stella uses the same kind of tool, installing it if needed.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I extract images from a PDF on a Mac?",
        a: "Preview can't save embedded pictures at full size. Use `pdfimages` after `brew install poppler`, LibreOffice Draw, or Stella.",
      },
      {
        q: "Why are my extracted images black or inside out?",
        a: "Some pictures are stored with a separate mask for transparency, or in CMYK colour. Extractors may save the mask as its own black image; pick the other one, or use a tool that combines them (as Stella did for the oval photo).",
      },
      {
        q: "Can I get every page as a picture instead?",
        a: "Yes, that's a different job: [convert PDF to JPG](/how/pdf-excel/convert-pdf-to-jpg) makes one image per page.",
      },
      {
        q: "Is it legal to extract images from a PDF?",
        a: "Extracting is fine for your own files or with permission. Reusing someone else's photos needs their permission, whichever way you get them out.",
      },
    ],
    related: ["pdf-excel/convert-pdf-to-jpg", "photos-files/combine-photos-into-one-pdf", "pdf-excel/compress-pdf-too-large-to-email"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "pdfimages manual", href: "https://manpages.debian.org/testing/poppler-utils/pdfimages.1.en.html" },
      { label: "PDF24 Creator (free, offline, Windows)", href: "https://tools.pdf24.org/en/creator" },
    ],
  },
  {
    slug: "fill-pdf-form-from-spreadsheet",
    niche: "pdf-excel",
    searchPhrases: [
      "fill pdf form with excel data",
      "fill pdf form from spreadsheet",
      "batch fill pdf forms",
      "fill pdf form",
      "fillable pdf form not saving text",
    ],
    title: "Fill a PDF form for each row of a spreadsheet",
    description:
      "Fill one copy of a fillable PDF form per person from an Excel list, with ticks and dates right: by hand in Preview or Edge, or with Stella (stella.sh).",
    h1: "Fill in a PDF form for everyone on a spreadsheet",
    short: "Fill PDF forms from a spreadsheet",
    lede: "Ten trip consent forms filled from a list of kids, ticks only where the list says yes.",
    answer:
      "By hand, open the blank form in Preview (Mac) or Edge (Windows), type each person's details into the fields, tick the boxes and save a copy under their name; repeat for everyone. Bulk tools exist but are paid or aimed at developers. Stella (stella.sh) reads your list and fills a separate copy of the form for each person on your computer, with dates written properly and the text visible in any PDF reader.",
    stellaSteps: [
      "Finds the blank consent form and the kids' list in Downloads, and reads the form's fields: eight text boxes and two tick boxes",
      "Fills one copy per child with name, date of birth (as day/month/year, not 2014-03-09 00:00:00), parent, phones, allergies and medical needs",
      "Ticks “can swim 25 m” and “photo consent” only for the children the list says Yes for",
      "Saves each as “Consent form - <child>.pdf” in a new folder, including names like O'Donnell and Saint-Clair, opens two to check they look right, and leaves the blank form and list unchanged",
      "Lists what it left blank (signatures; medical needs the list didn't cover) and what a trip leader should know, such as the two children marked as unable to swim 25 m",
    ],
    prompt:
      "The swimming club needs a consent form filled in for each of the kids going on the Lakeside trip. The blank form and the list of kids are in my Downloads. Fill in a separate form for each child.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "10 forms in about a minute and a half. Checked afterwards against an answer key written before the run: one form per child, named after them, every detail filled in correctly, both tick boxes ticked only where the list says Yes, the filled-in text visible when the PDF is opened, and the blank form and list unchanged.",
      note: "The swimming club, the children and their details are fictitious, made for this run. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/pdf-excel/fill-pdf-form-from-spreadsheet/proof.mp4`,
        cuts: webCuts("pdf-excel/fill-pdf-form-from-spreadsheet"),
        poster: `${PROOFS}/pdf-excel/fill-pdf-form-from-spreadsheet/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 41.5,
        realDuration: 92,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A blank fillable consent form and a list of 10 children are in Downloads." },
        { at: 1.7, text: "The prompt: fill in a separate form for each child." },
        { at: 10.7, text: "Stella replies that anything the list doesn't cover, like signatures, will be left blank and listed." },
        { at: 16.6, text: "Filling the forms, sped up 4×." },
        { at: 27.8, text: "Done: 10 forms in a new folder, with what was left blank and the two children who can't swim 25 m." },
      ],
    },
    manualTitle: "Fill them yourself",
    manualSteps: [
      {
        title: "Check the form is fillable",
        body: "Open the blank form and click where a name goes. If a box highlights and you can type, it has real fields. If not, it's a flat form: you'd add text boxes with Preview's Markup or Acrobat's Fill & Sign instead.",
      },
      {
        title: "On a Mac: Preview",
        body: "Open the form in Preview, click each field and type the first person's details, click the tick boxes that apply, then File, Duplicate (or Save As with Option held) and save with their name. Close it and open the blank again for the next person.",
      },
      {
        title: "On Windows: Edge or a free PDF reader",
        body: "Open the form in Microsoft Edge (or Adobe's free reader), fill the fields, tick the boxes, then use Save as to keep a copy named after the person. Reopen the blank for the next one, so you never type over a filled form.",
      },
      {
        title: "Type dates the way the form asks",
        body: "Copying a date from Excel can paste it as 2014-03-09 00:00:00. Type it in the form's format (DD/MM/YYYY here), or in Excel format the date column as text first.",
      },
      {
        title: "Check each saved form",
        body: "Open a few saved copies in a different PDF reader. Some apps save field values without drawing them, so the form looks blank elsewhere. If that happens, print to PDF to flatten it.",
      },
    ],
    limits: [
      "Works on fillable forms with real fields. A flat or scanned form needs text placed onto the page, which Stella can do but takes more checking.",
      "Stella doesn't sign forms. In this run the form said parents sign on paper, so signatures were left blank.",
      "Blank cells stay blank. Stella listed the five children with nothing under medical needs rather than guessing.",
      "The children's details go to the AI model you use in Stella. The forms are filled on your computer and nothing is uploaded to a form service.",
      "Recorded on Linux with a free Python PDF library. On Windows or a Mac Stella uses the same kind of tool.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can Excel fill a PDF form automatically?",
        a: "Not on its own. Acrobat Pro can import data into a form, some paid tools batch it, and Stella does it from your list.",
      },
      {
        q: "Why does my filled PDF form look blank in another app?",
        a: "The values were saved but not drawn into the fields. Re-save in a reader that draws them (Preview, Edge, Adobe's reader) or print to PDF. Stella's forms were checked for visible text.",
      },
      {
        q: "Can I get one PDF with everyone's forms?",
        a: "Yes, ask for a combined PDF as well, which is easier to print. To put pages in a set order after, see [reorder PDF pages](/how/pdf-excel/reorder-pdf-pages).",
      },
      {
        q: "What about letters instead of forms?",
        a: "For one Word letter per person, see [mail merge from Excel to Word](/how/documents/mail-merge-excel-to-word); for invoices grouped by customer, [invoices from a spreadsheet](/how/documents/generate-invoices-from-spreadsheet).",
      },
    ],
    related: ["documents/mail-merge-excel-to-word", "documents/generate-invoices-from-spreadsheet", "pdf-excel/fix-dates-in-excel"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Fill out and sign PDF forms in Preview", href: "https://support.apple.com/guide/preview/fill-out-and-sign-pdf-forms-prvw35725/mac" },
    ],
  },
  {
    slug: "find-subscriptions-in-bank-statement",
    niche: "pdf-excel",
    searchPhrases: [
      "find subscriptions in bank statement",
      "how to find all my subscriptions",
      "track subscriptions free",
      "find recurring payments",
      "cancel subscriptions",
    ],
    title: "Find every subscription in your bank statements",
    description:
      "List every subscription and regular payment in a year of bank and card exports, with its yearly cost, in Excel or with Stella (stella.sh), without linking your bank.",
    h1: "Find every subscription and regular payment in your bank statements",
    short: "Find subscriptions in statements",
    lede: "A year of bank and card exports turned into a list of what comes out, and how often.",
    answer:
      "Download a year of transactions as CSV from your bank and card, open them in Excel, and make a PivotTable with the description in Rows and the count and average amount in Values: names that repeat with steady amounts are your subscriptions. Watch for weekly, fortnightly and yearly ones, and price rises. Stella (stella.sh) reads the exports on your computer and builds a spreadsheet of each subscription and bill with its current price, how often it's charged and its yearly cost, without logging in to your bank.",
    stellaSteps: [
      "Reads both exports in Downloads, a checking account and a credit card with different column layouts, 968 transactions over 12 months",
      "Groups charges by merchant, including ones written two ways on the statement, and looks at how regularly they come out and how much they vary",
      "Finds monthly, weekly, every-two-weeks and yearly charges, plus rent, utilities that vary, and a free trial that turned paid",
      "Uses today's price for each (StreamView after its June rise), and leaves groceries, coffee, fuel, salary and card payments out",
      "Saves a spreadsheet with yearly costs, totals for bills and subscriptions, and a second tab of every matching charge, and points out overlaps such as paying for two fitness services",
    ],
    prompt:
      "Go through my two bank exports in Downloads and find every subscription and regular payment I'm paying. Make me a spreadsheet with what each one is, how much it is, how often it comes out and what it costs me a year.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "About 3 minutes. Checked afterwards against an answer key written before the run: all 13 subscriptions and regular payments listed (including the weekly, every-two-weeks and yearly ones, the trial that turned paid, rent and utilities), the current amount right for each, a yearly cost for each, no everyday spending or salary listed, and both exports unchanged. One optional point was marked missed: see the limits.",
      note: "The bank, card, merchants and transactions are fictitious, made for this run, in US dollars. The work is sped up 11×.",
      video: {
        src: `${PROOFS}/pdf-excel/find-subscriptions-in-bank-statement/proof.mp4`,
        cuts: webCuts("pdf-excel/find-subscriptions-in-bank-statement"),
        poster: `${PROOFS}/pdf-excel/find-subscriptions-in-bank-statement/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 44.2,
        realDuration: 179,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A year of checking-account and credit-card exports are in Downloads." },
        { at: 1.7, text: "The prompt: every subscription and regular payment, what each costs and how often." },
        { at: 11.7, text: "Stella replies that it will send the spreadsheet with a yearly total and anything that looks off." },
        { at: 17.7, text: "Going through 968 transactions, sped up 11×." },
        { at: 30.7, text: "Done: the yearly cost split into bills and subscriptions, a trial that turned paid, a price rise, and a membership that looks cancelled." },
      ],
    },
    manualTitle: "Find them yourself",
    manualSteps: [
      {
        title: "Download a year as CSV",
        body: "In online banking, look for Export or Download transactions on each account and card, and choose CSV for the last 12 months. A full year catches yearly renewals. If you only have PDFs, see [bank statement PDF to Excel](/how/pdf-excel/bank-statement-pdf-to-excel) first.",
      },
      {
        title: "Put everything in one sheet",
        body: "Open the files in Excel or Numbers and paste them under one set of headers: Date, Description, Amount, Account. Make money out one sign (negative) so totals make sense.",
      },
      {
        title: "Make a PivotTable",
        body: "In Excel, select the data, Insert, PivotTable, put Description in Rows and Amount in Values twice, set to Count and Average. Sort by Count. Merchants with 12 charges are probably monthly; 52 weekly; 26 every two weeks.",
      },
      {
        title: "Look for the sneaky ones",
        body: "Search the descriptions for “annual”, “yearly”, “trial” and “renew”. Compare the first and last charge of each subscription to spot price rises. Check your phone's App Store or Google Play subscriptions too, since those appear under the store's name.",
      },
      {
        title: "Work out the yearly cost",
        body: "For each one, multiply the current amount by how often it's charged in a year (12, 52, 26 or 1). Variable bills like utilities: add up the last 12 months instead.",
      },
    ],
    limits: [
      "The answer key had one optional point marked missed: a gaming membership that stopped in February should be left out or marked cancelled. Stella's summary did mark it “Stopped, looks cancelled” and left it out of the totals, but its old charges are listed unmarked on the second tab, which the check counted against it.",
      "Stella finds and lists. Cancelling happens on each service's own site or app; Stella can open the page for you.",
      "Your transactions go to the AI model you use in Stella. Remove account numbers from the exports first if you prefer; Stella never needs your banking login.",
      "Charges billed through someone else (app stores, PayPal) show under that name, so the service behind them may need checking.",
      "Recorded on Linux with free tools. Works the same with exports on Windows or a Mac; the spreadsheet opens in Excel, Numbers or Google Sheets.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I find all my subscriptions?",
        a: "Go through 12 months of bank and card transactions for names that repeat at regular gaps, then check your phone's app store subscriptions and your email for “renewal” receipts.",
      },
      {
        q: "Do I need a subscription tracker app?",
        a: "Not to find them. Tracker apps link to your bank and some charge a fee. A downloaded CSV and a PivotTable, or Stella, finds the same things without sharing your login.",
      },
      {
        q: "How do I spot a free trial that turned into a paid plan?",
        a: "Look for a new merchant with a £0 or tiny first charge followed by regular full charges. Stella flagged one here that started in July and began charging in August.",
      },
      {
        q: "Can I see my spending by category too?",
        a: "Yes: see [summarize a spreadsheet by category](/how/pdf-excel/summarize-spreadsheet-by-category). To split shared bills, [split bills with roommates](/how/pdf-excel/split-bills-with-roommates).",
      },
    ],
    related: ["pdf-excel/bank-statement-pdf-to-excel", "pdf-excel/summarize-spreadsheet-by-category", "pdf-excel/split-bills-with-roommates"],
    lastChecked: "2026-11-13",
    sources: [
      {
        label: "Microsoft: Create a PivotTable to analyze worksheet data",
        href: "https://support.microsoft.com/office/create-a-pivottable-to-analyze-worksheet-data-a9a84538-bfe9-40a9-a8e9-f99134456576",
      },
      { label: "Apple: See or cancel your subscriptions", href: "https://support.apple.com/118428" },
    ],
  },
  {
    slug: "fix-dates-in-excel",
    niche: "pdf-excel",
    searchPhrases: [
      "change dates in excel from us to uk",
      "excel dates wrong format",
      "convert text to date in excel",
      "excel american dates to uk",
      "excel csv dates wrong way round",
    ],
    title: "Fix American dates in Excel (wrong way round or won't sort)",
    description:
      "US-style CSV dates in a UK Excel come out swapped or stuck as text. Import them as MDY and show them as dd/mm/yyyy, or let Stella (stella.sh) make a clean Excel file.",
    h1: "Change dates in Excel from US to UK when they come out wrong",
    short: "Fix US dates in Excel",
    lede: "80 bookings from an American site, every date real, day first, and sorting properly.",
    answer:
      "An American CSV writes dates month first (3/4/2026 is 4 March). A UK-set Excel reads it day first, so dates with a day of 12 or less swap and the rest stay as text that won't sort. Don't double-click the CSV: import it with Data, From Text/CSV, and set the date columns' type Using Locale, English (United States). Then format them as dd/mm/yyyy. Stella (stella.sh) makes the Excel file from the CSV with every date read the right way.",
    stellaSteps: [
      "Reads the bookings CSV and works out that the site writes dates month first",
      "Turns check-in, check-out and booked-on into real Excel dates shown as day/month/year (booked-on with a 24-hour time)",
      "Cross-checks every booking: the number of nights matches the gap between check-in and check-out, so no date was guessed",
      "Keeps booking references' leading zeros and turns “$1,250.00” text into numbers you can add up",
      "Saves an .xlsx next to the CSV and leaves the CSV unchanged",
    ],
    prompt:
      "I downloaded our bookings from an American booking site (the CSV in my Downloads). When I open it in Excel half the dates come out the wrong way round and the rest won't sort. Make me an Excel file with proper dates in day/month/year that sort correctly.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Fixed in about 2 minutes. Checked afterwards against an answer key written before the run: all 80 bookings in a new Excel file, check-in and check-out real dates with the right day and month (none swapped), shown as dd/mm/yyyy, amounts as numbers, booking references with their leading zeros, and the CSV unchanged.",
      note: "The holiday let, its guests and bookings are fictitious, made for this run. The work is sped up 6×.",
      video: {
        src: `${PROOFS}/pdf-excel/fix-dates-in-excel/proof.mp4`,
        cuts: webCuts("pdf-excel/fix-dates-in-excel"),
        poster: `${PROOFS}/pdf-excel/fix-dates-in-excel/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 45.3,
        realDuration: 122,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A bookings CSV from an American site is in Downloads." },
        { at: 1.7, text: "The prompt: an Excel file with proper day/month/year dates that sort." },
        { at: 13.7, text: "Stella replies with the cause: the site writes dates month first, so days of 12 or under get flipped." },
        { at: 19.3, text: "Converting and checking, sped up 6×." },
        { at: 31.3, text: "Done: real dates shown day first, none guessed (nights match every stay), leading zeros kept, amounts as numbers." },
      ],
    },
    manualTitle: "Fix it yourself in Excel",
    manualSteps: [
      {
        title: "Don't open the CSV by double-clicking",
        body: "Double-clicking makes Excel guess with your computer's date settings, which is what swaps the dates and drops leading zeros. Start from a blank workbook instead.",
      },
      {
        title: "Windows: import with the US locale",
        body: "Data, From Text/CSV, pick the file, click Transform Data. Right-click each date column's header, Change Type, Using Locale, choose Date and English (United States). Set the booking reference column to Text. Close & Load.",
      },
      {
        title: "Mac: the import wizard",
        body: "In Excel for Mac choose File, Import, CSV file, Delimited, comma. In the last step click each date column and set Column data format to Date: MDY; set reference columns to Text. Finish.",
      },
      {
        title: "Show them day first",
        body: "Select the date columns, press Ctrl+1 (Cmd+1 on a Mac), choose Custom and type `dd/mm/yyyy`. They now sort as dates. Save as .xlsx so the fix sticks.",
      },
      {
        title: "Already opened it the wrong way?",
        body: "Text dates that won't sort can be turned into dates with Data, Text to Columns, Next, Next, Column data format Date: MDY. Swapped dates are harder: they look like valid dates, so you can't tell which ones flipped. Re-import from the original CSV instead.",
      },
    ],
    limits: [
      "Stella needs to know which order the file uses. Here the nights column proved it for every booking; for a file that mixes both orders, it lists the rows it can't decide.",
      "It makes a new Excel file. Re-exports from the site have the same problem; give Stella the next one too.",
      "The bookings, including guest names, go to the AI model you use in Stella. The conversion runs on your computer.",
      "Recorded on Linux, where Stella wrote the .xlsx with a free Python library. The file opens the same in Excel on Windows or Mac.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why does Excel swap the day and month?",
        a: "It reads the CSV with your computer's regional settings. A UK setting reads 3/4/2026 as 3 April; the American file meant 4 March. Dates like 10/23/2026 can't be a UK date, so they stay as text.",
      },
      {
        q: "How do I convert text to dates in Excel?",
        a: "Re-import with the column type set (above), or use Data, Text to Columns, Next, Next, Date: MDY on the column. Formulas like DATEVALUE also use your regional order, so they repeat the swap.",
      },
      {
        q: "Why are my dates showing as numbers?",
        a: "Excel stores dates as numbers (46000 is a day in 2025). Format the cells as a date to see them; the number means they're real dates, which is good.",
      },
      {
        q: "Can I merge this with another sheet by booking reference?",
        a: "Yes, now that references keep their zeros: see [merge two spreadsheets by a matching column](/how/pdf-excel/merge-two-spreadsheets-by-matching-column).",
      },
    ],
    related: ["pdf-excel/merge-two-spreadsheets-by-matching-column", "pdf-excel/remove-duplicate-rows-in-excel", "pdf-excel/summarize-spreadsheet-by-category"],
    lastChecked: "2026-11-13",
    sources: [
      {
        label: "Microsoft: Import or export text (.txt or .csv) files",
        href: "https://support.microsoft.com/en-us/office/import-or-export-text-txt-or-csv-files-5250ac4c-663c-47ce-937b-339e391393ba",
      },
    ],
  },
  {
    slug: "merge-two-spreadsheets-by-matching-column",
    niche: "pdf-excel",
    searchPhrases: [
      "merge two excel sheets based on one column",
      "join two excel sheets on a column",
      "vlookup two sheets",
      "vlookup not working leading zeros",
      "match data from two spreadsheets",
    ],
    title: "Merge two spreadsheets by a matching column (ID or number)",
    description:
      "Add columns from one sheet to another by a shared ID, even when one side has leading zeros or spaces, with XLOOKUP or Stella (stella.sh), and mark rows that don't match.",
    h1: "Merge two Excel sheets based on one matching column",
    short: "Merge sheets by a matching column",
    lede: "150 orders given each customer's email and phone, and four strays marked not found.",
    answer:
      "In the sheet you're adding to, use XLOOKUP: `=XLOOKUP(C2, Customers!A:A, Customers!C:C, \"not found\")` brings in the matching value, or “not found”. It fails silently when the IDs are stored differently, such as the number 1042 on one side and the text 001042 on the other, or a trailing space; wrap the lookup value in TEXT and TRIM to match them. Stella (stella.sh) matches on the number itself, adds the columns to a copy, and lists the rows with no match.",
    stellaSteps: [
      "Opens both spreadsheets in Downloads: 150 orders, and 60 customers stored in a different order",
      "Notices the customer numbers are written differently on each side: plain numbers in the orders, six-digit text with leading zeros in the customer list, and some with a stray space",
      "Matches on the number itself, so 1042, “1042 ” and 001042 all find the same customer",
      "Adds email and phone to every order in a new file, and writes “not found” on the four orders whose customer number isn't in the list",
      "Names those four orders and their numbers, and leaves both original files unchanged",
    ],
    prompt:
      "I have an October orders spreadsheet and a Customers spreadsheet in Downloads. Add each customer's email and phone number to every order, matching on the customer number, and write 'not found' on any order whose customer number isn't in the customer list.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Merged in under a minute and a half. Checked afterwards against an answer key written before the run: all 150 orders kept, all 146 matched orders with the right email and phone (including customer numbers with leading zeros or spaces), the 4 unknown customer numbers given nobody's details and marked not found, and both original spreadsheets unchanged.",
      note: "The shop, its orders and customers are fictitious, made for this run. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/pdf-excel/merge-two-spreadsheets-by-matching-column/proof.mp4`,
        cuts: webCuts("pdf-excel/merge-two-spreadsheets-by-matching-column"),
        poster: `${PROOFS}/pdf-excel/merge-two-spreadsheets-by-matching-column/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 48.7,
        realDuration: 82,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. An orders spreadsheet and a customer list are in Downloads." },
        { at: 1.7, text: "The prompt: add each customer's email and phone to every order, and write “not found” where there's no match." },
        { at: 16.7, text: "Stella replies that it will report how many matched and how many weren't found." },
        { at: 22.7, text: "Matching the two sheets, sped up 3×." },
        { at: 34.9, text: "Done: 146 matched, 4 not found and named; 47 customer numbers stored as text that a plain lookup would have missed." },
      ],
    },
    manualTitle: "Merge them yourself with XLOOKUP",
    manualSteps: [
      {
        title: "Put both sheets in one workbook",
        body: "Copy the customer list into a new tab of the orders workbook (call it Customers). Lookups across two open files work too, but break if one moves.",
      },
      {
        title: "Check how the IDs are stored",
        body: "Click an ID on each side. If one side shows 001042 or is left-aligned, it's text; 1042 right-aligned is a number. They won't match each other as they are. Also look for spaces at the end.",
      },
      {
        title: "Write the lookup",
        body: "In a new column next to the first order: `=XLOOKUP(TEXT(TRIM(C2),\"000000\"), Customers!A:A, Customers!C:C, \"not found\")` brings in the email. TRIM drops spaces, TEXT pads the number to six digits like the customer list. Make a second column with `Customers!D:D` for the phone.",
      },
      {
        title: "Fill down and check",
        body: "Double-click the fill handle to copy the formulas down. Filter the new column for “not found” and look at those rows: are they test entries or real missing customers? Spot-check a few matches by hand.",
      },
      {
        title: "Freeze the results",
        body: "Copy the new columns and Paste Special, Values, so the file no longer depends on the Customers tab. Older Excel without XLOOKUP: use `=IFERROR(VLOOKUP(…, Customers!A:D, 3, FALSE), \"not found\")`.",
      },
    ],
    limits: [
      "Stella matches on the column you name. If the two sheets use different kinds of IDs (an account number on one, an email on the other), say what to match on.",
      "It added the details to a new file and left both originals alone. It also offered to tidy the ID column; that's your call.",
      "Both spreadsheets' contents, including customer emails and phone numbers, go to the AI model you use in Stella. The merge runs on your computer.",
      "Recorded on Linux with a free Python library. The result is an ordinary .xlsx for Excel on Windows or Mac.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why does VLOOKUP return #N/A when the value is there?",
        a: "Usually a type mismatch (number vs text, often leading zeros) or a hidden space. Use TRIM and TEXT (or VALUE) so both sides are the same kind, as above.",
      },
      {
        q: "XLOOKUP or VLOOKUP?",
        a: "XLOOKUP is simpler: it can look left, has a built-in “not found” value and defaults to exact match. VLOOKUP needs FALSE as the last argument and a column number.",
      },
      {
        q: "Can I merge more than two files?",
        a: "For stacking files with the same columns, see [combine Excel files into one sheet](/how/pdf-excel/combine-excel-files-into-one-sheet). To see what changed between two versions, [compare two Excel files](/how/pdf-excel/compare-two-excel-files).",
      },
      {
        q: "What if a customer appears twice in the list?",
        a: "Lookups take the first match. [Remove duplicate rows](/how/pdf-excel/remove-duplicate-rows-in-excel) from the customer list first.",
      },
    ],
    related: ["pdf-excel/remove-duplicate-rows-in-excel", "pdf-excel/fix-dates-in-excel", "pdf-excel/combine-excel-files-into-one-sheet", "pdf-excel/compare-two-excel-files"],
    lastChecked: "2026-11-13",
    sources: [{ label: "Microsoft: XLOOKUP function", href: "https://support.microsoft.com/en-us/office/xlookup-function-b7fd680e-6d10-43e6-84f9-88eae8bf5929" }],
  },
  {
    slug: "remove-duplicate-rows-in-excel",
    niche: "pdf-excel",
    searchPhrases: [
      "remove duplicates in excel",
      "remove duplicate rows excel",
      "remove duplicates excel not working",
      "remove duplicates ignoring case and spaces",
      "remove duplicates in csv",
    ],
    title: "Remove duplicate rows in Excel, even near-duplicates",
    description:
      "Remove Duplicates misses copies that differ by capitals or spaces. Normalise first with LOWER and TRIM, or let Stella (stella.sh) make a clean copy, one row per person.",
    h1: "Remove duplicate rows in Excel, including the ones it misses",
    short: "Remove duplicate rows",
    lede: "A 229-row mailing list down to its 180 real people, phone numbers kept.",
    answer:
      "Data, Remove Duplicates only removes rows that match exactly, so “Jo@Mail.com ” and “jo@mail.com” both stay. Add a helper column with `=LOWER(TRIM(C2))` on the email, then run Remove Duplicates on that column only, on a copy of the file. Stella (stella.sh) makes a clean copy where each email appears once, keeps the details from whichever duplicate had them, and keeps different people who share a name.",
    stellaSteps: [
      "Opens the mailing list in Documents (229 rows) and treats emails that differ only by capitals or spaces as the same person",
      "Merges each person's copies into one row, keeping the phone number from whichever copy had it and the name that isn't in all capitals",
      "Keeps each person's earliest sign-up date, which also dropped five dates set in the future",
      "Keeps people who share a name but have different emails, such as two Sam Taylors, as separate people",
      "Saves “Newsletter mailing list (deduplicated).xlsx” next to the original, with emails tidied to lower case, and lists names worth a human look",
    ],
    prompt:
      "My newsletter mailing list spreadsheet in Documents has loads of people on it twice, sometimes with their email in capitals or with a space in it. Make me a clean copy where everyone is only on it once.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "180 people from 229 rows in under 2 minutes. Checked afterwards against an answer key written before the run: exactly 180 people, everyone still there, nobody twice, both Sam Taylors kept, no phone number lost when only a duplicate had it, emails tidied, and the original list unchanged.",
      note: "The newsletter, its subscribers and their details are fictitious, made for this run. The work is sped up 5×.",
      video: {
        src: `${PROOFS}/pdf-excel/remove-duplicate-rows-in-excel/proof.mp4`,
        cuts: webCuts("pdf-excel/remove-duplicate-rows-in-excel"),
        poster: `${PROOFS}/pdf-excel/remove-duplicate-rows-in-excel/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 47.5,
        realDuration: 109,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A newsletter mailing list with many people on it twice is in Documents." },
        { at: 1.7, text: "The prompt: a clean copy with everyone on it once." },
        { at: 15.7, text: "Stella replies that it will treat emails differing only by capitals or spaces as one person and leave the original alone." },
        { at: 21.7, text: "Finding and merging duplicates, sped up 5×." },
        { at: 33.2, text: "Done: 180 people, down from 229, emails tidied, phone numbers kept, and names to check." },
      ],
    },
    manualTitle: "Remove them yourself in Excel",
    manualSteps: [
      {
        title: "Work on a copy",
        body: "Save the file under a new name first. Remove Duplicates deletes rows, and once you save there's no undo.",
      },
      {
        title: "Decide what makes a duplicate",
        body: "For a mailing list, the email address. Names aren't safe: two different people can share one. Dates and phone formats vary between copies of the same person.",
      },
      {
        title: "Add a clean key column",
        body: "Next to the data, add a column with `=LOWER(TRIM(C2))` (C being the email) and fill it down. This removes leading and trailing spaces and capitals. For spaces inside an email, wrap it in `SUBSTITUTE(…,\" \",\"\")`.",
      },
      {
        title: "Keep the best copy",
        body: "Sort so the most complete copy of each person comes first (for example, sort the Phone column so filled cells come before blanks). Remove Duplicates keeps the first row it meets.",
      },
      {
        title: "Remove Duplicates on the key",
        body: "Select the data, Data, Remove Duplicates, untick every column except the key, and click OK. Excel says how many it removed. Delete the key column after, or keep it to check.",
      },
    ],
    limits: [
      "Stella decided who is the same person by email address. People with no email, or one person with two addresses, need a rule from you; it listed eight same-name, different-email pairs rather than guess.",
      "It made a copy and left the original as it was. Ask for the duplicates on a separate tab if you want to see what was merged.",
      "The list's names, emails and phone numbers go to the AI model you use in Stella. The clean-up runs on your computer.",
      "Recorded on Linux with a free Python library; the clean copy is a normal .xlsx for Excel or Numbers. The same works for CSV files.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why isn't Remove Duplicates removing my duplicates?",
        a: "The rows aren't exactly the same: a capital letter, a space or a different phone format makes Excel treat them as different. Normalise a key column first (above).",
      },
      {
        q: "How do I remove duplicates based on one column?",
        a: "In the Remove Duplicates box, untick every column except that one. Excel keeps the first row for each value and deletes the rest of the row.",
      },
      {
        q: "How do I just highlight duplicates instead?",
        a: "Home, Conditional Formatting, Highlight Cells Rules, Duplicate Values. It has the same exact-match limit, so use the clean key column.",
      },
      {
        q: "Can I combine two lists and then de-duplicate?",
        a: "Yes: [combine the files into one sheet](/how/pdf-excel/combine-excel-files-into-one-sheet) first.",
      },
    ],
    related: ["pdf-excel/merge-two-spreadsheets-by-matching-column", "pdf-excel/combine-excel-files-into-one-sheet", "pdf-excel/compare-two-excel-files"],
    lastChecked: "2026-11-13",
    sources: [
      {
        label: "Microsoft: Filter for unique values or remove duplicate values",
        href: "https://support.microsoft.com/en-us/topic/ccf664b0-81d6-449b-bbe1-8daaec1e83c2",
      },
    ],
  },
  {
    slug: "reorder-pdf-pages",
    niche: "pdf-excel",
    searchPhrases: [
      "reorder pdf pages",
      "fix double sided scan order pdf",
      "merge odd and even pages pdf",
      "remove blank pages from pdf",
      "rearrange pdf pages free",
    ],
    title: "Reorder PDF pages from a double-sided scan, blanks removed",
    description:
      "Scanned fronts, then backs? Interleave them, reverse the backs and drop blank pages in Preview or PDF24, or let Stella (stella.sh) fix the order by the page numbers.",
    h1: "Reorder the pages of a double-sided scan and remove the blanks",
    short: "Reorder PDF pages",
    lede: "A 16-page jumbled contract scan put back as 13 pages in order, blank backs gone.",
    answer:
      "Scan all the fronts and then the pile flipped over, and the PDF runs fronts 1, 3, 5 … then backs in reverse. To fix it, interleave: front 1, last page, front 2, second-to-last, and so on, then delete the blank backs. In Preview (Mac) drag thumbnails into place; on Windows, the free PDF24 Creator sorts pages offline. Stella (stella.sh) works out the order from the page numbers printed on each page, removes blanks even when they have scanner grain, and saves a new PDF.",
    stellaSteps: [
      "Finds the contract scan in Downloads: 16 sides, image only, with no text to select",
      "Reads the page numbers and headings on each scanned page to set the order, instead of relying only on how the pile was flipped",
      "Finds three blank backs that aren't pure white (scanner grain, an edge shadow, a dust speck) and checks them closely for writing, stamps or initials before removing them",
      "Saves “Kitchen contract (ordered).pdf” next to the original, which is unchanged",
      "Reports the result: Page 1 of 13 through Page 13 of 13, nothing missing or repeated, sections running in order",
    ],
    prompt:
      "I scanned a double-sided contract on a scanner that only does one side, so I did all the fronts and then turned the pile over and did the backs. Now the PDF in my Downloads has the pages all out of order and some blank ones. Put the pages in the right order, take out the blank pages, and save it as a new PDF.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Fixed in about 4½ minutes. Checked afterwards against an answer key written before the run: a new PDF with exactly 13 pages (the 3 blank backs removed), every page in reading order 1 to 13, and the original scan unchanged.",
      note: "The kitchen-refit contract is fictitious, printed and “scanned” as images for this run. The work is sped up 19×.",
      video: {
        src: `${PROOFS}/pdf-excel/reorder-pdf-pages/proof.mp4`,
        cuts: webCuts("pdf-excel/reorder-pdf-pages"),
        poster: `${PROOFS}/pdf-excel/reorder-pdf-pages/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 45.8,
        realDuration: 278,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A 16-page contract scan, fronts then backs, is in Downloads." },
        { at: 1.6, text: "The prompt: put the pages in order, take out the blanks, save a new PDF." },
        { at: 13.6, text: "Stella replies that the backs probably came out reversed, and it will check the order against the page numbers before saving." },
        { at: 19.3, text: "Reading each page and rebuilding the order, sped up 19×." },
        { at: 32, text: "Done: 13 pages, Page 1 of 13 to Page 13 of 13, three blank backs removed, the original unchanged." },
      ],
    },
    manualTitle: "Put them in order yourself",
    manualSteps: [
      {
        title: "Work out the pattern",
        body: "With 8 sheets, the file runs F1 F2 … F8 then B8 B7 … B1 (the pile was flipped). The right order is F1, B1, F2, B2 … So pages go 1, 16, 2, 15, 3, 14 and so on. Write that list down.",
      },
      {
        title: "On a Mac: Preview",
        body: "Open the PDF, View, Thumbnails. Drag pages in the sidebar into the order above. Click a blank page and press Delete. Then File, Export as PDF under a new name, so the scan stays as it was.",
      },
      {
        title: "On Windows: PDF24 Creator",
        body: "Install the free PDF24 Creator (it works offline) and open its Sort pages tool. Drag thumbnails into order, delete blanks, and save. Its Merge tool can also interleave two separate scans of fronts and backs.",
      },
      {
        title: "Check blank pages before deleting",
        body: "Zoom in on each “blank” back. Scanner shadows and dust are fine to remove; initials, a stamp or “this page intentionally left blank” on a contract may matter.",
      },
      {
        title: "Next time: scan as two files",
        body: "Scan fronts and backs as separate PDFs. Many tools (PDF24, Acrobat) have a merge that alternates pages and reverses the second file in one step.",
      },
    ],
    limits: [
      "Here the order came from page numbers printed on each page. Pages without numbers are put back by the fronts-then-backs pattern, which assumes the pile went through in one go.",
      "A blank page with faint marks is a judgement call. Stella checked each one up close; for legal documents, look at what was removed yourself.",
      "Stella looked at the scanned pages to read their numbers, so page images go to the AI model you use. The new PDF is made on your computer.",
      "Recorded on Linux with free PDF tools. On Windows or a Mac Stella uses the same kind of tool.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I merge odd and even scanned pages into one PDF?",
        a: "Interleave them with the even pages reversed: Acrobat's Combine and PDF24's merge have an option for it, or put them in order by hand in Preview.",
      },
      {
        q: "How do I remove blank pages from a scanned PDF?",
        a: "Delete them in Preview or PDF24 one by one. Automatic blank-page removal in scanner software often misses grainy pages or removes faint ones, so check.",
      },
      {
        q: "Some pages are sideways too. Can that be fixed?",
        a: "Yes: see [rotate PDF pages](/how/pdf-excel/rotate-pdf-pages). To make the scan's text searchable afterwards, [make a scanned PDF searchable](/how/pdf-excel/make-scanned-pdf-searchable).",
      },
      {
        q: "Can I split the PDF into separate documents afterwards?",
        a: "Yes: [split a PDF into multiple files](/how/pdf-excel/split-pdf-into-multiple-files).",
      },
    ],
    related: ["pdf-excel/rotate-pdf-pages", "pdf-excel/make-scanned-pdf-searchable", "pdf-excel/split-pdf-into-multiple-files", "pdf-excel/convert-excel-to-pdf-without-cutting-off"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Add, delete and move PDF pages in Preview", href: "https://support.apple.com/guide/preview/prvw11793/mac" },
      { label: "PDF24 Creator (free, offline, Windows)", href: "https://tools.pdf24.org/en/creator" },
    ],
  },
  {
    slug: "rotate-pdf-pages",
    niche: "pdf-excel",
    searchPhrases: [
      "rotate pdf pages and save",
      "rotate pdf",
      "rotate pdf pages permanently",
      "fix sideways pdf",
      "scanned pdf pages upside down",
    ],
    title: "Rotate PDF pages and save them that way",
    description:
      "Turn sideways and upside-down pages of a scanned PDF upright so the fix sticks: Preview on a Mac, PDF24 on Windows, or Stella (stella.sh) finding the wrong pages for you.",
    h1: "Rotate PDF pages and save them so they stay that way",
    short: "Rotate PDF pages",
    lede: "A 10-page scan with pages sideways and upside down, all upright in a saved copy.",
    answer:
      "Rotating in a browser or a reader's view only turns your view, not the file. On a Mac, Preview's Rotate button followed by File, Save keeps the change; on Windows, the free PDF24 Creator's rotate tool saves a fixed copy. You still have to find each wrong page. Stella (stella.sh) checks every page itself, turns the sideways and upside-down ones, and saves a copy that opens upright in any viewer.",
    stellaSteps: [
      "Finds the scan in Downloads: 10 image-only pages of meeting minutes",
      "Checks the orientation of every page, including one that looks fine as a picture but carries a wrong rotation setting, so viewers show it sideways",
      "Turns pages 3, 4 and 9 (sideways) and 7 (upside down), without re-compressing the pages, so quality and size don't change",
      "Saves a copy named “(pages rotated)” next to the original, which is unchanged",
      "Offers to replace the original with the fixed copy if you'd rather keep one file",
    ],
    prompt:
      "A PDF in my Downloads came out of the scanner with some pages sideways and one upside down. Turn the pages the right way up and save it so they stay that way.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Fixed in about 2½ minutes. Checked afterwards against an answer key written before the run: a fixed PDF with all 10 pages in the same order, every page upright (including the sideways, upside-down and wrongly flagged pages), and the scan still there.",
      note: "The residents' association minutes are fictitious, “scanned” as images for this run. The work is sped up 9×.",
      video: {
        src: `${PROOFS}/pdf-excel/rotate-pdf-pages/proof.mp4`,
        cuts: webCuts("pdf-excel/rotate-pdf-pages"),
        poster: `${PROOFS}/pdf-excel/rotate-pdf-pages/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 46.6,
        realDuration: 157,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A 10-page scan with sideways and upside-down pages is in Downloads." },
        { at: 1.7, text: "The prompt: turn the pages the right way up and save it so they stay that way." },
        { at: 14.7, text: "Stella replies that it will check each page and leave the original as it is." },
        { at: 20.7, text: "Checking and turning pages, sped up 9×." },
        { at: 32.1, text: "Done: pages 3, 4 and 9 turned from sideways, page 7 from upside down, quality and size unchanged." },
      ],
    },
    manualTitle: "Rotate them yourself",
    manualSteps: [
      {
        title: "On a Mac: Preview",
        body: "Open the PDF, View, Thumbnails. Click a wrong page (Cmd-click to pick several) and press the Rotate button in the toolbar, or Cmd+R; Option-click turns the other way. File, Save keeps the rotation in the file.",
      },
      {
        title: "On Windows: PDF24 Creator",
        body: "Install the free PDF24 Creator, open its Rotate pages tool, add the file, click the rotate arrows on each wrong page and save. Rotating in Edge or a reader's View menu doesn't change the file.",
      },
      {
        title: "Find every wrong page",
        body: "Scroll through the thumbnails at a size where you can read headings. Upside-down pages are easy to miss at a glance in a long scan.",
      },
      {
        title: "Check in another viewer",
        body: "Open the saved PDF in a different app (a browser, your phone). If a page is sideways only there, the page has a rotation setting that one app ignores; rotate it again and re-save.",
      },
      {
        title: "Command line, for many files",
        body: "The free qpdf can rotate given pages: `qpdf in.pdf --rotate=+90:3,9 --rotate=180:7 -- out.pdf` turns pages 3 and 9 a quarter turn clockwise and page 7 upside down.",
      },
    ],
    limits: [
      "Stella turns whole pages by quarter turns. It doesn't straighten pages that were scanned slightly crooked; that needs a deskew tool.",
      "It saved a fixed copy. It can replace the original instead, if you say so.",
      "To decide which way is up, Stella looks at the pages, so page images go to the AI model you use. The rotation runs on your computer.",
      "Recorded on Linux with free PDF tools. On Windows or a Mac Stella uses the same kind of tool; the fixed PDF opens upright everywhere.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why doesn't my PDF stay rotated?",
        a: "Most viewers (Edge, Chrome, Adobe's reader) rotate the view only. Use a tool that saves the change: Preview, PDF24, Acrobat, or Stella.",
      },
      {
        q: "Can I rotate just one page?",
        a: "Yes. Select only that page's thumbnail before rotating. Rotating with nothing selected may turn every page.",
      },
      {
        q: "The pages are also out of order. What now?",
        a: "See [reorder PDF pages](/how/pdf-excel/reorder-pdf-pages), which also removes blank backs from a double-sided scan.",
      },
      {
        q: "Will rotating reduce the quality?",
        a: "No, if the tool just changes the page's rotation setting, which Stella did here. Tools that re-render pages can soften them.",
      },
    ],
    related: ["pdf-excel/reorder-pdf-pages", "pdf-excel/make-scanned-pdf-searchable", "pdf-excel/convert-pdf-to-jpg"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Rotate a PDF in Preview", href: "https://support.apple.com/guide/preview/prvw11567/mac" },
      { label: "PDF24 Creator (free, offline, Windows)", href: "https://tools.pdf24.org/en/creator" },
      { label: "qpdf manual: page rotation", href: "https://qpdf.readthedocs.io/en/stable/cli.html" },
    ],
  },
  {
    slug: "split-bills-with-roommates",
    niche: "pdf-excel",
    searchPhrases: [
      "split bills with roommates",
      "bill splitter",
      "who owes who spreadsheet",
      "settle up shared expenses fewest payments",
      "house expenses spreadsheet split",
    ],
    title: "Split bills with roommates: who owes who, in fewest payments",
    description:
      "Work out who owes who from a shared house expenses spreadsheet, uneven splits and refunds included, with SUMIF or Stella (stella.sh), settled in the fewest payments.",
    h1: "Split bills with roommates and settle up in the fewest payments",
    short: "Split bills with roommates",
    lede: "Ten months of house expenses settled in three payments, uneven splits included.",
    answer:
      "For each person, add up what they paid and subtract their share of every cost they were part of; positive means they're owed, negative means they owe. Then have each person who owes pay someone who's owed, biggest first, which keeps the payments to a minimum. Stella (stella.sh) does this from the sheet you already keep, following the “split between” column, notes, refunds and repayments, and saves the payments in a file.",
    stellaSteps: [
      "Reads House expenses 2026 in Documents: 66 rows from January to October, with names typed inconsistently (“ben”, “Ana ”)",
      "Splits each cost only between the people named in its “Split between” column, and follows the note under the table that Dev was away in August for electric and water",
      "Counts Ben's $200 to Ana as a repayment and cancels the vacuum purchase against its refund",
      "Works out each person's balance and settles them in three payments, all to Ana, who paid the rent",
      "Saves a settle-up spreadsheet with the payments, balances and a line-by-line ledger, and flags two things to check: no November entries yet, and concert tickets that look personal",
    ],
    prompt:
      "Four of us share a house and we log who paid for what in House expenses 2026 in my Documents. Work out who owes who, with the fewest payments to settle up, and save it as a file.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Settled in about 2½ minutes: Dev pays Ana $6,222.04, Ben pays Ana $5,689.60, Chloe pays Ana $5,131.56. Checked afterwards against an answer key written before the run: the payments settle every balance exactly in no more than 3 payments, each person's balance is shown, and the expenses spreadsheet is unchanged.",
      note: "The house, its four sharers and their expenses are fictitious, made for this run, in US dollars. The work is sped up 8×.",
      video: {
        src: `${PROOFS}/pdf-excel/split-bills-with-roommates/proof.mp4`,
        cuts: webCuts("pdf-excel/split-bills-with-roommates"),
        poster: `${PROOFS}/pdf-excel/split-bills-with-roommates/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 48.3,
        realDuration: 147,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A shared house expenses spreadsheet is in Documents." },
        { at: 1.7, text: "The prompt: who owes who, with the fewest payments, saved as a file." },
        { at: 16.7, text: "Stella replies that it will work out balances and save the result next to the original." },
        { at: 22.5, text: "Going through the expenses, sped up 8×." },
        { at: 34.2, text: "Done: three payments to Ana, with how uneven splits, August, a repayment and a refund were handled." },
      ],
    },
    manualTitle: "Work it out yourself",
    manualSteps: [
      {
        title: "Tidy the sheet",
        body: "Make sure every row has Amount, Paid by and Split between, with names spelled the same every time (Find and Replace “ben” with “Ben”). Refunds go in as negative amounts. Write “All” where everyone shares.",
      },
      {
        title: "Add a share column per person",
        body: "For Ana: `=IF(OR($E2=\"All\",ISNUMBER(SEARCH(\"Ana\",$E2))),$C2/IF($E2=\"All\",4,LEN($E2)-LEN(SUBSTITUTE($E2,\",\",\"\"))+1),0)`, where C is the amount and E the split. Copy it for each person, changing the name, and fill down.",
      },
      {
        title: "Work out each balance",
        body: "For each person: `=SUMIF(D:D,\"Ana\",C:C) - SUM(F:F)`, what they paid minus their share column. The four balances should add up to zero (within a cent or two).",
      },
      {
        title: "Settle with as few payments as possible",
        body: "List who owes (negative) and who's owed (positive). Have the biggest debtor pay the biggest creditor as much as one of them needs, cross off whoever reaches zero, and repeat. That never takes more payments than people minus one.",
      },
      {
        title: "Handle the exceptions",
        body: "Money one sharer paid another directly (a repayment) is a row paid by the payer, split to the receiver only. Months when someone was away need the split column changed for those rows.",
      },
    ],
    limits: [
      "Stella works out the payments; it doesn't send money or request it.",
      "It follows the “Split between” column and notes as written, and says how it read anything ambiguous. Here it counted concert tickets because they were logged, and showed what changes if they shouldn't count.",
      "The expenses and names go to the AI model you use in Stella. The sums are worked out on your computer.",
      "Recorded on Linux with a free Python library; the settle-up file is an ordinary .xlsx that opens in Excel, Numbers or Google Sheets.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What's the fewest number of payments to settle up?",
        a: "At most one fewer than the number of people. Often fewer: here everyone owed the same person, so three payments settled four people.",
      },
      {
        q: "Do I need a bill-splitting app?",
        a: "Not if you already log expenses in a sheet. Apps need everyone to sign up. A spreadsheet with SUMIF, or Stella reading your sheet, gives the same answer.",
      },
      {
        q: "How do I split a bill when someone was away?",
        a: "Change that row's split to the people who were there. Stella followed a note saying exactly that for August.",
      },
      {
        q: "Can I see spending by category as well?",
        a: "Yes: [summarize a spreadsheet by category](/how/pdf-excel/summarize-spreadsheet-by-category). For bills that come out every month, [find subscriptions in your statements](/how/pdf-excel/find-subscriptions-in-bank-statement).",
      },
    ],
    related: ["pdf-excel/summarize-spreadsheet-by-category", "pdf-excel/find-subscriptions-in-bank-statement", "pdf-excel/receipts-to-spreadsheet"],
    lastChecked: "2026-11-13",
    sources: [{ label: "Microsoft: SUMIF function", href: "https://support.microsoft.com/office/sumif-function-169b8c99-c05c-4483-a712-1697a653039b" }],
  },
  {
    slug: "summarize-spreadsheet-by-category",
    niche: "pdf-excel",
    searchPhrases: [
      "summarize excel data by category",
      "pivot table by category and month",
      "monthly spending by category excel",
      "pivot table",
      "summarize excel data without pivot table",
    ],
    title: "Summarize a spreadsheet by category and month",
    description:
      "Total spending per category per month with a PivotTable, after fixing the categories and text amounts that make it wrong, or let Stella (stella.sh) build the summary.",
    h1: "Summarize a spreadsheet by category and month, with totals",
    short: "Summarize by category",
    lede: "314 spending rows turned into a category-by-month table, every total to the penny.",
    answer:
      "A PivotTable does it: Insert, PivotTable, Category in Rows, Date in Columns grouped by month, Amount in Values as Sum. It goes wrong on messy data: “groceries” and “Groceries ” become separate rows, and amounts typed as “£12.50” are silently left out. Clean those first. Stella (stella.sh) merges the category spellings, counts text amounts, and saves a summary with totals per category, per month and for the year.",
    stellaSteps: [
      "Finds the spending spreadsheet in Documents: 314 rows from January to 28 October",
      "Merges 22 spellings of categories (capitals, stray spaces) into the 8 real ones",
      "Counts 8 amounts typed as text with a £ sign, which a PivotTable would skip, and takes refunds off the month and category they're in",
      "Saves “Spending summary 2026.xlsx” next to the original with a category-by-month grid, category totals, month totals and the year total",
      "Sums it up in plain words (biggest categories, dearest month) and flags a possible double broadband charge and some very low bills",
    ],
    prompt:
      "My spending spreadsheet for this year is in Documents. Make me a summary of how much I spent in each category in each month, with totals.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "A summary in about 3 minutes. Checked afterwards against an answer key written before the run: all 80 category-by-month totals correct to the penny, exactly the 8 real categories, the year's total (£21,695.61) and a total per category shown, and the original data still there.",
      note: "The household and its spending are fictitious, made for this run. The work is sped up 11×.",
      video: {
        src: `${PROOFS}/pdf-excel/summarize-spreadsheet-by-category/proof.mp4`,
        cuts: webCuts("pdf-excel/summarize-spreadsheet-by-category"),
        poster: `${PROOFS}/pdf-excel/summarize-spreadsheet-by-category/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 46.6,
        realDuration: 177,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A year of household spending is in a spreadsheet in Documents." },
        { at: 1.7, text: "The prompt: how much I spent in each category each month, with totals." },
        { at: 14.7, text: "Stella replies that it will make the summary and leave the original alone." },
        { at: 20.7, text: "Cleaning categories and adding up, sped up 11×." },
        { at: 32.3, text: "Done: £21,695.61 so far this year, 22 category spellings merged into 8, text amounts counted, and two bills to check." },
      ],
    },
    manualTitle: "Build it yourself",
    manualSteps: [
      {
        title: "Clean the categories",
        body: "Add a column with `=PROPER(TRIM(C2))` and fill down: it removes stray spaces and fixes capitals, so “groceries” and “Groceries ” become one. Use this column instead of the original in the PivotTable.",
      },
      {
        title: "Make every amount a number",
        body: "Amounts typed with a £ sign or as text are left-aligned. Add `=VALUE(SUBSTITUTE(D2,\"£\",\"\"))` and fill down, or select the column and use Data, Text to Columns, Finish. Check the column's SUM matches what you expect.",
      },
      {
        title: "Insert the PivotTable",
        body: "Select the data, Insert, PivotTable, New Worksheet. Drag the clean category to Rows, Date to Columns, the clean amount to Values (it should say Sum of). Excel groups dates by month; if not, right-click a date, Group, Months.",
      },
      {
        title: "Add totals",
        body: "PivotTables show row and column grand totals by default (Design, Grand Totals). Format the values as currency with Ctrl+1.",
      },
      {
        title: "Without a PivotTable",
        body: "Type the categories down the side and months across the top, then use `=SUMIFS(Amount, Category, $A2, Date, \">=\"&B$1, Date, \"<\"&EDATE(B$1,1))` with the first of each month in row 1.",
      },
    ],
    limits: [
      "Stella summarises the categories in your sheet. It can suggest new ones but won't invent them.",
      "Refunds reduce the category in the month they happened, so a month can show a negative total (Fun was −£32 in October here).",
      "The spending data goes to the AI model you use in Stella. The summary is built on your computer.",
      "Recorded on Linux with a free Python library; the summary is an ordinary .xlsx for Excel, Numbers or Google Sheets.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why does my PivotTable show the same category twice?",
        a: "The two aren't identical: a trailing space or different capitals. Clean the column with TRIM and PROPER first.",
      },
      {
        q: "Why is my PivotTable total too low?",
        a: "Some amounts are text, which Sum skips. Convert them to numbers. Stella counted 8 such amounts here.",
      },
      {
        q: "Can I get a chart too?",
        a: "Yes: in Excel, select the PivotTable and Insert, PivotChart. Or ask Stella for a chart sheet in the same file.",
      },
      {
        q: "My data is still in bank PDFs. Where do I start?",
        a: "Get it into a sheet first: [bank statement PDFs to Excel](/how/pdf-excel/bank-statement-pdf-to-excel) or [receipts to a spreadsheet](/how/pdf-excel/receipts-to-spreadsheet). Then [find your subscriptions](/how/pdf-excel/find-subscriptions-in-bank-statement).",
      },
    ],
    related: ["pdf-excel/find-subscriptions-in-bank-statement", "pdf-excel/bank-statement-pdf-to-excel", "pdf-excel/split-bills-with-roommates"],
    lastChecked: "2026-11-13",
    sources: [
      {
        label: "Microsoft: Create a PivotTable to analyze worksheet data",
        href: "https://support.microsoft.com/en-us/office/create-a-pivottable-to-analyze-worksheet-data-a9a84538-bfe9-40a9-a8e9-f99134456576",
      },
      { label: "Microsoft: SUMIFS function", href: "https://support.microsoft.com/en-us/office/sumifs-function-c9e748f5-7ea7-455d-9406-611cebce642b" },
    ],
  },
];
