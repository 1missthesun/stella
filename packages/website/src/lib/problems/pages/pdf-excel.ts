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
    related: ["pdf-excel/receipts-to-spreadsheet", "pdf-excel/combine-excel-files-into-one-sheet", "pc-cleanup/organize-downloads-folder", "pdf-excel/remove-password-from-pdf"],
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
    related: ["pdf-excel/bank-statement-pdf-to-excel", "photos-files/rename-pdf-files-based-on-content", "pdf-excel/split-pdf-into-multiple-files"],
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
    related: ["pdf-excel/bank-statement-pdf-to-excel", "pdf-excel/receipts-to-spreadsheet", "pdf-excel/compress-pdf-too-large-to-email", "pdf-excel/compare-two-excel-files"],
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
    related: ["pdf-excel/bank-statement-pdf-to-excel", "pdf-excel/combine-excel-files-into-one-sheet", "photos-files/rename-pdf-files-based-on-content"],
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
    related: ["photos-files/rename-pdf-files-based-on-content", "pdf-excel/add-page-numbers-to-pdf", "pdf-excel/compress-pdf-too-large-to-email"],
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
    related: ["pdf-excel/split-pdf-into-multiple-files", "pdf-excel/compress-pdf-too-large-to-email", "pdf-excel/redact-pdf"],
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
    related: ["pdf-excel/combine-excel-files-into-one-sheet", "pdf-excel/receipts-to-spreadsheet", "documents/mail-merge-excel-to-word"],
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
];
