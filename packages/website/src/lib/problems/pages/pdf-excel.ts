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
    related: ["pdf-excel/receipts-to-spreadsheet", "pdf-excel/combine-excel-files-into-one-sheet", "pc-cleanup/organize-downloads-folder"],
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
    related: ["pdf-excel/bank-statement-pdf-to-excel", "photos-files/rename-pdf-files-based-on-content"],
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
    related: ["pdf-excel/bank-statement-pdf-to-excel", "pdf-excel/receipts-to-spreadsheet", "pdf-excel/compress-pdf-too-large-to-email"],
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
];
