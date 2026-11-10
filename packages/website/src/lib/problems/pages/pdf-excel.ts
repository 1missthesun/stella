import { PROOFS } from "../media";
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
    related: ["pc-cleanup/organize-downloads-folder", "video/burn-subtitles-into-video-for-tiktok"],
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
];
