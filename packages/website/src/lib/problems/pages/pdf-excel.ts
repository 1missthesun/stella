import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const PDF_EXCEL_PAGES: ProblemPage[] = [
  shortGuide({
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
      "Turn bank statement PDFs into one clean Excel sheet. Hand them to Stella (stella.sh) and get every transaction in date order, with each month's totals matched.",
    h1: "Convert bank statement PDFs to Excel",
    short: "Bank statement PDFs to Excel",
    lede: "Every payment from your statements in one tidy sheet, totals matched.",
    answer:
      "To convert bank statement PDFs to Excel, give them to Stella (stella.sh). It puts all the transactions in one sheet by date and matches each month to its printed totals.",
    gets: ["One Excel sheet, for a month or a whole year", "Dates and amounts you can sort and add up"],
    prompt:
      "Turn these bank statement PDFs into one Excel sheet with date, description and amount.",
    demo: {
      ack: "On it. Reading your statements now.",
      task: "Putting your statements in Excel",
      rows: ["Reading three statements", "Listing every payment by date", "Matching each month's totals"],
      reply:
        "Done. **116 transactions** from August to October are in one sheet. Money out is negative and every month matches its statement.",
      files: ["Bank transactions Aug-Oct 2026.xlsx"],
    },
    faq: [
      ["Is there a free bank statement PDF to Excel converter?", "Stella is free with the ChatGPT or Claude plan you already have. If your bank offers a CSV download, that's free too."],
      ["How do I convert TD Bank statements to Excel?", "Save the PDF statements and ask Stella to put them in one sheet, as with any bank."],
    ],
    byHand: [
      "Look in online banking for Export or Download transactions, in CSV or Excel.",
      "Excel on Windows (Microsoft 365): Data, Get Data, From File, From PDF. Pick the tables, then Close & Load.",
      "On a Mac, copy the rows out of Preview.",
      "Scanned statement? Run OCR first, such as the free [OCRmyPDF](https://ocrmypdf.readthedocs.io).",
    ],
    related: [
      "pdf-excel/receipts-to-spreadsheet",
      "pdf-excel/combine-excel-files-into-one-sheet",
      "pc-cleanup/organize-downloads-folder",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "PDF too big to email? Ask Stella (stella.sh) to shrink it. You get a smaller copy that still reads clearly, saved next to the one you already have.",
    h1: "Reduce PDF file size when it's too large to email",
    short: "Compress a PDF to email it",
    lede: "A smaller copy that fits in an email and still reads clearly.",
    answer:
      "When a PDF is too large to email, ask Stella (stella.sh) to shrink it. It makes a smaller copy on your computer and keeps the small print readable.",
    gets: ["A copy small enough to attach", "Small print you can still read", "The size before and after"],
    prompt:
      "The tax documents PDF in my Downloads is too big to email, the limit is 25 MB. Make it smaller but keep it readable.",
    demo: {
      ack: "Sure. Looking at what makes it so big.",
      task: "Shrinking your tax PDF",
      rows: ["Finding what takes up space", "Making a smaller copy", "Comparing the small print"],
      reply:
        "Done. It went from **38.2 MB to 4.96 MB**, and the small print looks the same. Your original is untouched.",
      files: ["Tax documents - compressed.pdf"],
    },
    faq: [
      ["What size PDF can I email?", "Gmail allows 25 MB and Outlook suggests 20 MB. Job and visa sites often stop at 2 to 10 MB."],
    ],
    byHand: [
      "Mac: open it in Preview, choose File, Export, and pick Reduce File Size under Quartz Filter.",
      "Windows: the free Ghostscript shrinks it with its /ebook setting. /screen is smaller and blurrier.",
      "Still too big? Send it in two parts, or upload it to Google Drive or OneDrive and email the link.",
    ],
    related: [
      "pdf-excel/bank-statement-pdf-to-excel",
      "photos-files/rename-pdf-files-based-on-content",
      "pdf-excel/split-pdf-into-multiple-files",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Combine multiple Excel files into one sheet without copying and pasting. Stella (stella.sh) stacks a whole folder, lines up the columns and counts every row.",
    h1: "Combine multiple Excel files into one sheet",
    short: "Combine Excel files into one",
    lede: "A whole folder of spreadsheets, stacked into one.",
    answer:
      "To combine Excel files into one sheet, point Stella (stella.sh) at the folder. It stacks every Excel and CSV file and lines up columns by name, even when their order differs.",
    gets: [
      "One new sheet with every row",
      "A column saying which file each row came from",
      "Odd or repeated rows pointed out",
    ],
    prompt:
      "Combine all these Excel files into one sheet. They're in Documents/Store orders.",
    demo: {
      ack: "Okay, opening all ten files.",
      task: "Combining your store orders",
      rows: ["Reading ten files", "Lining up the columns", "Counting every row"],
      reply:
        "All ten files are in one sheet now, **277 orders** in total. One had its columns in a different order, so I lined them up.",
      files: ["Store orders combined.xlsx"],
    },
    faq: [
      ["How do I combine multiple CSV files into one?", "Ask in the same way. CSV and Excel files can go into the same sheet."],
    ],
    byHand: [
      "Put only the files you want in one folder.",
      "In Excel: Data, Get Data, From File, From Folder, then Combine & Transform Data.",
      "Two or three files: copy the rows under each other, leaving out the heading row. Adding files later? Data, Refresh All.",
    ],
    related: [
      "pdf-excel/bank-statement-pdf-to-excel",
      "pdf-excel/receipts-to-spreadsheet",
      "pdf-excel/compress-pdf-too-large-to-email",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Turn receipt photos and PDFs into a spreadsheet for your expense report. Stella (stella.sh) reads each one and lists the date, shop and total, all added up.",
    h1: "Turn receipts into a spreadsheet for your expense report",
    short: "Receipts into a spreadsheet",
    lede: "Your pile of receipts as one sheet, added up and ready to claim.",
    answer:
      "To turn receipts into a spreadsheet, ask Stella (stella.sh). It reads the photos and PDFs, lists date, shop and amount paid, and adds them up for your expense report.",
    gets: [
      "One row per receipt, with the amount you paid",
      "A grand total that updates itself",
      "Receipts your manager may ask about, marked",
    ],
    prompt:
      "Put all the receipts in Documents/Receipts into one spreadsheet for my expense report, with date, shop and total.",
    demo: {
      ack: "Got it. Reading the receipts.",
      task: "Turning receipts into a spreadsheet",
      rows: ["Reading 14 photos and 6 PDFs", "Picking out the amounts paid", "Adding it all up"],
      reply:
        "Your expense sheet is ready: **20 receipts, £770.05** in total. I marked ones a manager may query, like the wine with dinner.",
      files: ["Expense report.xlsx"],
    },
    faq: [
      ["Can Excel read receipts from photos?", "Yes. In Microsoft 365, Data, From Picture reads one photo at a time and you check it before adding it."],
      ["How do I convert receipt photos to a spreadsheet?", "Put them in one folder and ask Stella. The sheet opens in Excel and Google Sheets."],
    ],
    byHand: [
      "Make columns for Date, Shop, Description, Total and file name, one row per receipt.",
      "Excel for Microsoft 365: Data, From Picture, Picture From File. Check what it read, then Insert Data.",
      "Put =SUM( ) under the Total column and count the rows against your receipts.",
    ],
    related: [
      "pdf-excel/bank-statement-pdf-to-excel",
      "pdf-excel/combine-excel-files-into-one-sheet",
      "photos-files/rename-pdf-files-based-on-content",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Split a PDF into multiple files, one per document. Stella (stella.sh) reads the pages, works out where each letter starts and names every file for you.",
    h1: "Split a PDF into multiple files (one per document)",
    short: "Split a PDF into separate files",
    lede: "One big scan turned into separate files, each with a sensible name.",
    answer:
      "Stella (stella.sh) splits a PDF into multiple files for you. It sees where each document starts and saves every one under a name that says what it is.",
    gets: ["Names that say who it's from", "A list of anything you need to act on"],
    prompt:
      "My scanner put a pile of letters into one PDF in my Downloads. Split it into separate PDFs and name each one.",
    demo: {
      ack: "Sure, reading through the pile.",
      task: "Splitting your scanned pile",
      rows: ["Reading 17 pages", "Finding where each letter starts", "Naming the new files"],
      reply:
        "Your 17-page scan is now **seven PDFs**, including an invoice to pay, a council tax bill, a payslip and your tenancy agreement.",
      files: ["Halden Logistics - payslip October 2026.pdf", "Brightwater Plumbing - invoice.pdf"],
    },
    faq: [
      ["How do I separate PDF pages into different files?", "Ask Stella for single pages instead of documents, or type the page numbers you want."],
    ],
    byHand: [
      "Note which pages belong to each document.",
      "Mac: in Preview choose View, Thumbnails, select the pages and drag them to a Finder folder.",
      "Windows: press Ctrl+P in Edge, choose Microsoft Print to PDF and type the page range.",
      "Many ranges at once: the free PDF24 Creator splits them offline.",
    ],
    related: [
      "photos-files/rename-pdf-files-based-on-content",
      "pdf-excel/add-page-numbers-to-pdf",
      "pdf-excel/compress-pdf-too-large-to-email",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Tired of typing the password every time? Stella (stella.sh) makes copies of your PDFs that open without it, one file or a year of statements at once.",
    h1: "Remove the password from a PDF you already know",
    short: "Remove a password from a PDF",
    lede: "Statements that open straight away, with no password box.",
    answer:
      "To remove a password you know from a PDF, tell it to Stella (stella.sh). It saves a copy that opens without it, for one file or a whole batch, with the contents exactly the same.",
    gets: ["Every statement done in one go", "The locked files kept where they are"],
    prompt:
      "My bank statements keep asking for a password. It's Maple2026. Make copies that open without it.",
    demo: {
      ack: "Will do, finding the statements.",
      task: "Unlocking your statements",
      rows: ["Opening six statements", "Saving copies without the password", "Opening each copy to check"],
      reply:
        "Six statements, **May to October 2026**, now open without a password. Want me to move the locked ones to the Trash?",
      files: ["Statement_2026-05 (unlocked).pdf", "Statement_2026-10 (unlocked).pdf"],
    },
    faq: [
      ["Why is Export as PDF greyed out in Preview?", "On macOS 15 it's off for protected files. Use plain File, Export and keep the format on PDF."],
    ],
    byHand: [
      "Mac: open it in Preview with the password, choose File, Export, and save under a new name.",
      "Windows: open it in Edge, press Ctrl+P, and choose Microsoft Print to PDF.",
      "Many files: the free qpdf program can unlock a folder of them.",
    ],
    related: ["pdf-excel/bank-statement-pdf-to-excel", "pdf-excel/redact-pdf", "pdf-excel/split-pdf-into-multiple-files"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "redact-pdf",
    niche: "pdf-excel",
    searchPhrases: ["redact pdf", "how to redact a pdf", "redact pdf free", "redact pdf mac", "black out text in pdf permanently"],
    title: "Redact a PDF properly, free on Mac and Windows",
    description:
      "Redact a PDF so the text is really gone. Tell Stella (stella.sh) what to hide and get a copy with it blacked out and removed, ready to share with anyone.",
    h1: "How to redact a PDF so the text is really gone",
    short: "Redact a PDF properly",
    lede: "Private numbers gone for good, so the file is safe to share.",
    answer:
      "To redact a PDF properly, the text has to be deleted as well as covered. Tell Stella (stella.sh) what to hide and it removes every one, with nothing left underneath.",
    gets: ["Black boxes where they used to be", "Everything else still readable"],
    prompt:
      "Black out the social security and bank account numbers in the new hires PDF in my Downloads, so I can share it.",
    demo: {
      ack: "Okay, finding every one of them.",
      task: "Blacking out private numbers",
      rows: ["Reading five pages", "Removing the numbers", "Trying to find them again"],
      reply:
        "**36 numbers are gone**, two for each of the 18 people. Names, roles and start dates still show. Shall I hide the bank's routing number too?",
      files: ["New hires - redacted.pdf"],
    },
    faq: [
      ["Why doesn't a black box redact a PDF?", "It sits on top. The text under it can still be selected, copied or searched."],
    ],
    byHand: [
      "Mac: in Preview choose Tools, Redact, drag across each number and save.",
      "Windows: the free PDF24 Creator has an offline Redact tool. Draw boxes over the numbers and save.",
      "Search the saved copy for the last digits of a few numbers to see they're gone.",
    ],
    related: [
      "pdf-excel/remove-password-from-pdf",
      "pdf-excel/add-watermark-to-pdf",
      "pdf-excel/split-pdf-into-multiple-files",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Add page numbers to a PDF on Mac or Windows. Say where you want them and Stella (stella.sh) numbers every page in a matching font, clear of your text.",
    h1: "Add page numbers to a PDF",
    short: "Add page numbers to a PDF",
    lede: "Neat numbers on every page, in the style you want.",
    answer:
      "Stella (stella.sh) can add page numbers to any PDF. Say where you want them and you get a numbered copy in the document's own font.",
    gets: ["The same font as your document", "Any style, such as “Page 3 of 16”"],
    prompt:
      "Add page numbers to the bottom of every page of the annual report PDF in my Downloads.",
    demo: {
      ack: "Sure, numbering it now.",
      task: "Numbering the annual report",
      rows: ["Opening all 16 pages", "Adding a number to each", "Checking nothing is covered"],
      reply:
        "All **16 pages** are numbered, small and centred at the bottom in the report's own font. Want page one left blank as a cover?",
      files: ["Annual report - numbered.pdf"],
    },
    faq: [
      ["Can Preview add page numbers to a PDF?", "Preview has no page number tool. Use the Word or Pages original, PDF24 on Windows, or ask Stella."],
    ],
    byHand: [
      "Still have the original? In Word choose Insert, Page Number, Bottom of Page, then save a new PDF.",
      "Windows: open the Add page numbers tool in the free PDF24 Creator.",
      "Mac: use a free editor such as PDFgear.",
    ],
    related: [
      "pdf-excel/split-pdf-into-multiple-files",
      "pdf-excel/compress-pdf-too-large-to-email",
      "pdf-excel/redact-pdf",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Compare two Excel sheets and see what changed. Stella (stella.sh) matches the items, even when re-sorted, and lists what's new, removed and repriced.",
    h1: "Compare two Excel sheets and list what changed",
    short: "Compare two Excel files",
    lede: "A clear list of what's new, what's gone and what changed price.",
    answer:
      "Give both Excel files to Stella (stella.sh) to compare. It matches items by code, whatever their order, and lists everything added, removed or changed.",
    gets: [
      "New, removed and changed items on separate tabs",
      "Old price, new price and the difference",
      "Anything worth asking about",
    ],
    prompt:
      "Our supplier sent a new price list. Compare it with the March one, both in Downloads, and make a spreadsheet of what changed.",
    demo: {
      ack: "Right, comparing the two lists.",
      task: "Comparing the price lists",
      rows: ["Reading 240 items in each", "Matching them by code", "Listing what's different"],
      reply:
        "I found **19 differences**:\n- 9 price changes\n- 4 new items\n- 3 removed\n- 3 with new wording or pack size",
      files: ["Price list changes.xlsx"],
    },
    faq: [
      ["Why does comparing two sheets show everything as different?", "The rows are in a different order. Match them by a code or name instead of by position."],
    ],
    byHand: [
      "Copy the old list into the new workbook as a second sheet called March.",
      "Next to each item enter =XLOOKUP(A2, March!A:A, March!D:D, \"new\") to fetch its old price.",
      "Do the same from the March sheet to find removed items.",
    ],
    related: [
      "pdf-excel/combine-excel-files-into-one-sheet",
      "pdf-excel/receipts-to-spreadsheet",
      "documents/mail-merge-excel-to-word",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-scanned-pdf-searchable",
    niche: "pdf-excel",
    searchPhrases: ["make scanned pdf searchable", "ocr pdf", "make pdf searchable free", "scanned pdf to text", "ocr pdf mac"],
    title: "Make a scanned PDF searchable (free OCR, no upload)",
    description:
      "Can't search a scanned PDF? Stella (stella.sh) reads the pages on your computer and saves a copy you can search and copy from, looking exactly the same.",
    h1: "Make a scanned PDF searchable",
    short: "Make a scanned PDF searchable",
    lede: "Find any word in a scan, without changing how it looks.",
    answer:
      "A scan is only a picture, so search finds nothing. Stella (stella.sh) reads the words and saves an identical copy you can search.",
    gets: ["A copy where Ctrl+F works", "Text you can select and copy"],
    prompt:
      "The scanned lease in my Downloads isn't searchable, I can't find anything in it. Can you make it searchable?",
    demo: {
      ack: "Yes, reading the pages now.",
      task: "Making the lease searchable",
      rows: ["Reading six scanned pages", "Adding searchable words", "Searching for names and dates"],
      reply:
        "The lease is searchable now, all **6 pages**. Names, the address and dates come up straight away. One tip: the rent is written in words, so search for those instead of “14,200”.",
      files: ["Lease (searchable).pdf"],
    },
    faq: [
      ["Is there a free OCR without uploading my PDF?", "Yes. OCRmyPDF, PDF24 Creator on Windows and Stella all do it on your own computer."],
    ],
    byHand: [
      "Windows: open the OCR tool in the free PDF24 Creator and choose the language.",
      "Mac: the free PDFgear has OCR to Searchable PDF.",
      "Any system: the free [OCRmyPDF](https://ocrmypdf.readthedocs.io) does whole folders.",
    ],
    related: [
      "pdf-excel/compress-pdf-too-large-to-email",
      "pdf-excel/split-pdf-into-multiple-files",
      "pdf-excel/redact-pdf",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Convert an EPUB to PDF so you can print it. Stella (stella.sh) keeps the chapters, cover and pictures, and adds a contents page and page numbers.",
    h1: "Convert an EPUB to PDF so you can print it",
    short: "Convert EPUB to PDF",
    lede: "Your ebook as a PDF, laid out and ready to print.",
    answer:
      "Got an EPUB to print? Stella (stella.sh) converts it to a PDF on your computer, with the cover, every chapter and the pictures.",
    gets: ["A PDF in A4 or US Letter", "A contents page and page numbers"],
    prompt:
      "Convert the lighthouse ebook in my Downloads to a PDF so I can print it.",
    demo: {
      ack: "Sure, laying out the book.",
      task: "Turning your ebook into a PDF",
      rows: ["Reading eight chapters", "Placing the cover and map", "Making printable pages"],
      reply:
        "Your book is a **19-page PDF** with all 8 chapters, the cover and the map. The pages are US Letter. Does your printer use A4? I can make that copy too.",
      files: ["The lighthouse.pdf"],
    },
    faq: [
      ["Can Apple Books save an EPUB as a PDF?", "Apple Books has no PDF export. Calibre or Stella can do it for a DRM-free EPUB."],
    ],
    byHand: [
      "Install the free [Calibre](https://calibre-ebook.com/download) and add the book with Add books.",
      "Click Convert books, set Output format to PDF and choose A4 or Letter under PDF output.",
      "Right-click the book and choose Open containing folder to find the PDF.",
    ],
    related: [
      "pdf-excel/add-page-numbers-to-pdf",
      "pdf-excel/split-pdf-into-multiple-files",
      "pdf-excel/make-scanned-pdf-searchable",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Excel PDF cutting off columns? Stella (stella.sh) makes a PDF where every sheet fits across the page, easy to read and ready to print or send.",
    h1: "Convert Excel to PDF without the columns being cut off",
    short: "Excel to PDF, nothing cut off",
    lede: "Your spreadsheet as a PDF with every column on the page.",
    answer:
      "To convert Excel to PDF without columns cut off, each sheet has to fit one page wide. Stella (stella.sh) does that and gives you one PDF.",
    gets: ["Every sheet in one PDF", "Text still big enough to read"],
    prompt:
      "My staff rota loses its right-hand columns when I save it as a PDF. Make each week fit across one page.",
    demo: {
      ack: "Okay, fitting each week to a page.",
      task: "Making the rota fit the page",
      rows: ["Opening four weeks", "Fitting the columns", "Checking every row and day"],
      reply:
        "Your rota is a **4-page PDF**, one week per page, Monday to Sunday together. All 88 rows are there.",
      files: ["Staff rota November.pdf"],
    },
    faq: [
      ["Why does Excel split columns onto separate pages?", "The sheet is wider than a portrait page, so the rest spills over. Landscape and one page wide fixes it."],
    ],
    byHand: [
      "Page Layout, Orientation, Landscape.",
      "In Scale to Fit, set Width to 1 page and Height to Automatic. Do it on each sheet.",
      "Windows: File, Export, Create PDF/XPS, Options, Entire workbook.",
      "Mac: File, Save As, PDF, Workbook.",
    ],
    related: ["pdf-excel/convert-pdf-to-jpg", "pdf-excel/reorder-pdf-pages", "pdf-excel/fix-dates-in-excel"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Convert MOBI and AZW3 ebooks to EPUB for Kobo, Apple Books and more. Stella (stella.sh) does the whole batch and keeps titles, authors and covers.",
    h1: "Convert MOBI and AZW3 ebooks to EPUB",
    short: "MOBI to EPUB",
    lede: "Old Kindle-format books that open on your new e-reader.",
    answer:
      "Stella (stella.sh) converts MOBI and AZW3 books to EPUB, all in one go, and keeps each title, author and cover for your e-reader.",
    gets: ["An EPUB of each book", "The old files still there"],
    prompt:
      "I've got old Kindle-format ebooks in my Downloads (.mobi and .azw3) that my new e-reader won't open. Convert them to EPUB.",
    demo: {
      ack: "Happy to. Finding the books.",
      task: "Converting your ebooks",
      rows: ["Finding three books", "Converting each one", "Checking chapters and covers"],
      reply:
        "All **three books** are EPUBs now, with their covers and chapters. They're next to the old files in Downloads, ready to copy to your e-reader.",
    },
    faq: [
      ["Can I just rename .mobi to .epub?", "The inside is a different format, so it has to be converted."],
      ["How do I put an EPUB on my Kobo?", "Connect it by USB, tap Connect and copy the files across."],
    ],
    byHand: [
      "Install the free [Calibre](https://calibre-ebook.com/download) and drag in your DRM-free .mobi and .azw3 files.",
      "Select them, click Convert books, set Output format to EPUB and click OK.",
      "Right-click a book, Open containing folder, and copy the EPUB to your reader.",
    ],
    related: ["pdf-excel/convert-epub-to-pdf", "pdf-excel/extract-images-from-pdf", "pdf-excel/convert-pdf-to-jpg"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Convert a PDF to JPG, one picture per page. Stella (stella.sh) saves every page sharp enough to read on a phone, named in order and ready to share.",
    h1: "Convert a PDF to JPG, one sharp picture per page",
    short: "PDF to JPG",
    lede: "Every page as a sharp picture, named in order and easy to share.",
    answer:
      "Ask Stella (stella.sh) to convert your PDF to JPG and every page becomes its own picture, sharp on a phone and numbered in order.",
    gets: ["Sharp text, even zoomed in", "Names that sort correctly"],
    prompt:
      "Turn every page of the Larkfield Village News PDF in my Downloads into a JPG I can share, sharp enough for a phone.",
    demo: {
      ack: "Sure, making the pictures.",
      task: "Turning pages into pictures",
      rows: ["Opening 12 pages", "Saving each as a picture", "Zooming in on small print"],
      reply:
        "There you go: **12 pictures**, page-01 to page-12, in a folder next to the PDF. Each is about 450 KB, 5 MB altogether, so they're easy to send.",
      files: ["Larkfield Village News pictures"],
    },
    faq: [
      ["How do I convert a PDF to JPG in high quality?", "Save at 150 to 300 dpi; the usual 72 is too blurry. Or ask Stella for print quality."],
    ],
    byHand: [
      "Mac: in Preview pick a page, File, Export, JPEG, and set Resolution to 150 or more.",
      "Mac, many pages: in Shortcuts combine Split PDF Into Pages and Convert Image to JPEG.",
      "Windows: PDF to Images in the free PDF24 Creator, set to JPG and 150 dpi or more.",
    ],
    related: [
      "pdf-excel/extract-images-from-pdf",
      "pdf-excel/compress-pdf-too-large-to-email",
      "pdf-excel/rotate-pdf-pages",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Extract images from a PDF at full quality, not screenshots. Stella (stella.sh) saves each photo as its own file, named by caption, and skips the logos.",
    h1: "Extract the images from a PDF at full quality",
    short: "Extract images from a PDF",
    lede: "Every photo from the PDF as its own file, at full size.",
    answer:
      "To extract images from a PDF at full quality, ask Stella (stella.sh). You get the original photos, named after their captions, without the repeats and logos.",
    gets: ["Full-size photos, the way they were stored", "File names taken from the captions"],
    prompt:
      "There's a brochure PDF in my Downloads with photos in it. Get them all out as picture files at full quality, not screenshots.",
    demo: {
      ack: "Okay, taking the photos out.",
      task: "Getting photos out of the brochure",
      rows: ["Finding every picture", "Skipping logos and repeats", "Naming them by caption"],
      reply:
        "I got **8 photos** out at their full size, up to 2000 x 1125. The oval one kept its see-through edge. The logo and a second copy of the cover were left out.",
      files: ["Brochure photos", "p1-1 Harbour at dawn.jpg"],
    },
    faq: [
      ["How do I extract images from a PDF on a Mac?", "Ask Stella, or open the PDF in the free LibreOffice Draw, right-click a picture and choose Save."],
    ],
    byHand: [
      "Windows: the free PDF24 Creator has an Extract images tool. Add the PDF and it saves every picture to a folder, offline.",
      "Any computer: in LibreOffice Draw, right-click a picture and choose Save.",
      "From a command line: pdfimages -all brochure.pdf photo saves the originals.",
      "Sort by size and delete the logos and repeats.",
    ],
    related: [
      "pdf-excel/convert-pdf-to-jpg",
      "photos-files/combine-photos-into-one-pdf",
      "pdf-excel/compress-pdf-too-large-to-email",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Fill in a PDF form for everyone on a spreadsheet. Stella (stella.sh) fills a separate copy for each person, ticks the right boxes and names each file.",
    h1: "Fill in a PDF form for everyone on a spreadsheet",
    short: "Fill PDF forms from a spreadsheet",
    lede: "One completed form per person, straight from your list.",
    answer:
      "To fill a PDF form from a spreadsheet, give both to Stella (stella.sh). It fills in a copy for each person on your list and saves it under their name.",
    gets: ["Dates and tick boxes done correctly", "A note of anything left blank"],
    prompt:
      "Fill in a consent form for each kid on the Lakeside trip. The blank form and the list are in my Downloads.",
    demo: {
      ack: "Sure, starting on the forms.",
      task: "Filling in the consent forms",
      rows: ["Reading the form and the list", "Filling a copy per child", "Ticking the right boxes"],
      reply:
        "All **10 consent forms** are filled in, one per child. Signatures are left blank. For your trip leader: two children are marked as unable to swim 25 m.",
      files: ["Lakeside consent forms"],
    },
    faq: [
      ["Why does my filled PDF form look blank?", "Some apps save the answers without showing them. Save it again in Preview or Edge."],
    ],
    byHand: [
      "Open the blank form in Preview or Edge and click a field to see if you can type.",
      "Fill in one person, tick the boxes and save a copy under their name.",
      "Reopen the blank form for the next person.",
    ],
    related: [
      "documents/mail-merge-excel-to-word",
      "documents/generate-invoices-from-spreadsheet",
      "pdf-excel/fix-dates-in-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Find every subscription in your bank statements. Stella (stella.sh) spots each regular payment, what it costs now and how much it adds up to in a year.",
    h1: "Find every subscription and regular payment in your bank statements",
    short: "Find subscriptions in statements",
    lede: "Everything you're paying for regularly, and what it costs a year.",
    answer:
      "To find subscriptions in your bank statement, give a year of transactions to Stella (stella.sh). It lists each regular payment, how often it's taken and what it costs a year.",
    gets: ["The yearly cost of each", "Price rises and forgotten trials"],
    prompt:
      "Go through my two bank exports in Downloads and find every subscription and regular payment, with the price and what it costs me a year.",
    demo: {
      ack: "Right, going through the year.",
      task: "Finding your subscriptions",
      rows: ["Reading 968 transactions", "Spotting repeat payments", "Working out yearly costs"],
      reply:
        "You have **13 regular payments**. Worth a look:\n- StreamView went up in June\n- a free trial from July started charging in August\n- you pay for two fitness services",
      files: ["Subscriptions and bills.xlsx"],
    },
    faq: [
      ["How do I cancel the ones I don't want?", "Ask Stella to open each cancellation page for you. Phone apps are cancelled in your phone's subscription settings."],
    ],
    byHand: [
      "Download 12 months as CSV from your bank and card, and paste both into one sheet.",
      "Insert a PivotTable: description in Rows, count and average amount in Values.",
      "About 12 charges means monthly, 26 every two weeks, 52 weekly.",
    ],
    related: [
      "pdf-excel/bank-statement-pdf-to-excel",
      "pdf-excel/summarize-spreadsheet-by-category",
      "pdf-excel/split-bills-with-roommates",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Excel dates the wrong way round after an American download? Stella (stella.sh) puts every one in day, month, year order, so they sort and filter properly.",
    h1: "Change dates in Excel from US to UK when they come out wrong",
    short: "Fix US dates in Excel",
    lede: "Dates the right way round, that sort the way they should.",
    answer:
      "American files put the month first, so a UK Excel swaps some dates and leaves others as text. Stella (stella.sh) works out the right order and gives you an Excel file that sorts.",
    gets: ["Columns that sort and filter", "Amounts and reference numbers kept right"],
    prompt:
      "Half the dates in our American bookings download come out wrong in Excel. Make a file with day/month/year dates that sort.",
    demo: {
      ack: "On it, checking the dates.",
      task: "Fixing the booking dates",
      rows: ["Working out the date order", "Correcting every date", "Comparing with the nights booked"],
      reply:
        "Fixed. All **80 bookings** now show day/month/year and sort properly. Each one agrees with its number of nights.",
      files: ["Bookings (dates fixed).xlsx"],
    },
    faq: [
      ["How do I convert text to dates in Excel?", "Select the column, choose Data, Text to Columns, Next, Next, then Date: MDY."],
    ],
    byHand: [
      "Start with a blank workbook instead of double-clicking the CSV.",
      "Windows: Data, From Text/CSV, Transform Data, then Change Type, Using Locale, Date, English (United States).",
      "Mac: File, Import, CSV file, and set the date columns to Date: MDY.",
      "Format the columns as dd/mm/yyyy and save as .xlsx.",
    ],
    related: [
      "pdf-excel/merge-two-spreadsheets-by-matching-column",
      "pdf-excel/remove-duplicate-rows-in-excel",
      "pdf-excel/summarize-spreadsheet-by-category",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Merge two Excel sheets based on one column. Stella (stella.sh) matches the rows, adds the details you want and lists anything without a match.",
    h1: "Merge two Excel sheets based on one matching column",
    short: "Merge sheets by a matching column",
    lede: "Two lists joined up, with the right details on every row.",
    answer:
      "To merge two Excel sheets based on one column, tell Stella (stella.sh) which. It adds the details to every row and marks those with no match.",
    gets: [
      "One sheet with the extra columns added",
      "Matches found despite zeros or spaces",
      "Rows without a match, named",
    ],
    prompt:
      "Add each customer's email and phone from my Customers spreadsheet to every row of October orders, matched on customer number. Write 'not found' if there's none.",
    demo: {
      ack: "Okay, matching the two lists.",
      task: "Adding customer details to orders",
      rows: ["Reading 150 orders, 60 customers", "Matching customer numbers", "Listing the ones missing"],
      reply:
        "All **150 orders** are in the new file. 146 have an email and phone, and four say “not found”.",
      files: ["October orders with contacts.xlsx"],
    },
    faq: [
      ["Why does VLOOKUP show #N/A when the value is there?", "One side is often text with leading zeros, like 001042, and the other the number 1042. Hidden spaces do it too."],
    ],
    byHand: [
      "Copy the second list into a tab called Customers.",
      "Enter =XLOOKUP(C2, Customers!A:A, Customers!C:C, \"not found\") and fill down.",
      "Leading zeros? Use TEXT(TRIM(C2),\"000000\") in place of C2.",
      "Filter for “not found”, then copy the column and Paste Special, Values.",
    ],
    related: [
      "pdf-excel/remove-duplicate-rows-in-excel",
      "pdf-excel/fix-dates-in-excel",
      "pdf-excel/combine-excel-files-into-one-sheet",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Remove duplicate rows in Excel, even when spaces or capitals differ. Stella (stella.sh) keeps each person once and combines the details from every copy.",
    h1: "Remove duplicate rows in Excel, including the ones it misses",
    short: "Remove duplicate rows",
    lede: "A clean list where everybody appears once.",
    answer:
      "Excel's own button misses duplicates with a stray space or capital. Stella (stella.sh) catches them, keeps each entry once and saves the details from every copy.",
    gets: ["Phone numbers from duplicates kept", "People who share a name kept apart"],
    prompt:
      "My mailing list spreadsheet in Documents has lots of people on it twice, some in capitals. Make a clean copy with everyone on it once.",
    demo: {
      ack: "Sure, sorting out the repeats.",
      task: "Cleaning your mailing list",
      rows: ["Reading 229 rows", "Finding the same people", "Keeping their best details"],
      reply:
        "Your list went from 229 rows to **180 people**. Emails are tidied and no phone number was lost. Both Sam Taylors stayed, since their emails differ.",
      files: ["Newsletter mailing list (deduplicated).xlsx"],
    },
    faq: [
      ["Why isn't Remove Duplicates working in Excel?", "It only catches rows that match exactly. A capital letter or a space makes them different."],
    ],
    byHand: [
      "Save a copy first.",
      "Add a column with =LOWER(TRIM(C2)), where C is the email, and fill it down.",
      "Sort so the fullest rows come first, because Excel keeps the first one.",
      "Data, Remove Duplicates, with only the new column ticked.",
    ],
    related: [
      "pdf-excel/merge-two-spreadsheets-by-matching-column",
      "pdf-excel/combine-excel-files-into-one-sheet",
      "pdf-excel/compare-two-excel-files",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Reorder PDF pages after a double-sided scan. Stella (stella.sh) reads the page numbers, puts everything in the right order and takes out the blank backs.",
    h1: "Reorder the pages of a double-sided scan and remove the blanks",
    short: "Reorder PDF pages",
    lede: "A muddled scan put in order, blank pages gone.",
    answer:
      "To reorder PDF pages from a double-sided scan, ask Stella (stella.sh). It reads the page numbers, rearranges them and removes the blank backs.",
    gets: ["Pages in reading order", "Blank sides removed", "A new PDF, with the scan kept"],
    prompt:
      "I scanned a contract, all the fronts then all the backs. Put the PDF in my Downloads in the right order and take out the blank pages.",
    demo: {
      ack: "Okay, reading the page numbers.",
      task: "Putting the contract in order",
      rows: ["Reading 16 sides", "Looking closely at blank ones", "Arranging the pages"],
      reply:
        "The contract now runs from **page 1 to 13** with nothing missing or repeated. Three blank backs are gone.",
      files: ["Kitchen contract (ordered).pdf"],
    },
    faq: [
      ["How do I merge odd and even pages into one PDF?", "Alternate them, with the even pages in reverse. PDF24 and Acrobat have a merge option for it."],
    ],
    byHand: [
      "With 8 sheets the right order is 1, 16, 2, 15, 3, 14 and so on.",
      "Mac: in Preview choose View, Thumbnails and drag the pages into place. File, Export as PDF.",
      "Windows: use Sort pages in the free PDF24 Creator.",
    ],
    related: [
      "pdf-excel/rotate-pdf-pages",
      "pdf-excel/make-scanned-pdf-searchable",
      "pdf-excel/split-pdf-into-multiple-files",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Rotate PDF pages and save them for good. Stella (stella.sh) finds every sideways or upside-down page, turns it upright and saves a copy that stays that way.",
    h1: "Rotate PDF pages and save them so they stay that way",
    short: "Rotate PDF pages",
    lede: "Sideways pages turned upright, and saved that way.",
    answer:
      "Ask Stella (stella.sh) to rotate the pages. It finds every sideways or upside-down one and saves a PDF that opens upright anywhere.",
    gets: ["A file that stays fixed on any device", "The same sharpness as before"],
    prompt:
      "A PDF in my Downloads came out of the scanner with some pages sideways and one upside down. Turn them the right way and save it.",
    demo: {
      ack: "Sure, looking at each page.",
      task: "Turning the pages upright",
      rows: ["Checking ten pages", "Turning the wrong ones", "Saving a fixed copy"],
      reply:
        "Pages **3, 4 and 9** were sideways and **7** was upside down. All ten are upright now, at the same quality. Shall I replace the old file with this one?",
      files: ["Meeting minutes (pages rotated).pdf"],
    },
    faq: [
      ["Why doesn't my PDF stay rotated?", "Browsers and most readers only turn what you see. The change has to be saved into the file."],
    ],
    byHand: [
      "Mac: in Preview choose View, Thumbnails, select the pages, press Cmd+R, then File, Save.",
      "Windows: use Rotate pages in the free PDF24 Creator and save.",
      "Open the saved file on your phone or in a browser to see it stuck.",
    ],
    related: ["pdf-excel/reorder-pdf-pages", "pdf-excel/make-scanned-pdf-searchable", "pdf-excel/convert-pdf-to-jpg"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Split bills with roommates and see who owes who. Stella (stella.sh) reads your shared expenses and works out the fewest payments to settle everything.",
    h1: "Split bills with roommates and settle up in the fewest payments",
    short: "Split bills with roommates",
    lede: "Who owes who, settled in as few payments as possible.",
    answer:
      "Give your shared expenses to Stella (stella.sh). It splits the bills, works out who owes who, and finds the fewest payments that settle it.",
    gets: ["Each person's balance", "Refunds and time away counted"],
    prompt:
      "Four of us share a house and log who paid for what in House expenses 2026. Work out who owes who, with the fewest payments.",
    demo: {
      ack: "Let's settle this. Reading the sheet.",
      task: "Working out who owes who",
      rows: ["Reading 66 expenses", "Working out each share", "Finding the fewest payments"],
      reply:
        "Three payments settle it, all to Ana:\n- Dev pays **$6,222.04**\n- Ben pays **$5,689.60**\n- Chloe pays **$5,131.56**\n\nDev's August away is counted.",
      files: ["House settle up.xlsx"],
    },
    faq: [
      ["What's the fewest number of payments to settle up?", "At most one fewer than the number of people, so four people need three payments or fewer."],
    ],
    byHand: [
      "Give every row an amount, who paid and who shares it. Refunds are negative.",
      "For each person: what they paid minus their shares. The balances should add to zero.",
      "The person who owes most pays the person owed most. Repeat until everyone is at zero.",
    ],
    related: [
      "pdf-excel/summarize-spreadsheet-by-category",
      "pdf-excel/find-subscriptions-in-bank-statement",
      "pdf-excel/receipts-to-spreadsheet",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Summarize a spreadsheet by category and month. Stella (stella.sh) merges messy spellings, adds everything up and gives you clear totals in a new sheet.",
    h1: "Summarize a spreadsheet by category and month, with totals",
    short: "Summarize by category",
    lede: "Where your money went, by category and by month.",
    answer:
      "Stella (stella.sh) turns a long spreadsheet into totals by category and month. It merges misspelled categories and counts amounts that Excel skips.",
    gets: ["A category-by-month table", "Totals for each row, month and the year", "Odd entries pointed out"],
    prompt:
      "My spending spreadsheet for this year is in Documents. Show me how much I spent in each category in each month, with totals.",
    demo: {
      ack: "Sure, adding it up.",
      task: "Summing up your spending",
      rows: ["Reading 314 rows", "Tidying category names", "Adding up every month"],
      reply:
        "You've spent **£21,695.61** so far this year, across 8 categories. I merged 22 spellings and counted 8 amounts typed as text. Broadband looks charged twice.",
      files: ["Spending summary 2026.xlsx"],
    },
    faq: [
      ["Why is my PivotTable total too low?", "Some amounts are text, often with a £ sign, and get skipped."],
    ],
    byHand: [
      "Clean the categories with =PROPER(TRIM(C2)) and fill down.",
      "Turn text amounts into numbers with =VALUE(SUBSTITUTE(D2,\"£\",\"\")).",
      "Insert, PivotTable: category in Rows, date in Columns, amount in Values as Sum.",
      "Dates not grouped by month? Right-click one, Group, Months.",
    ],
    related: [
      "pdf-excel/find-subscriptions-in-bank-statement",
      "pdf-excel/bank-statement-pdf-to-excel",
      "pdf-excel/split-bills-with-roommates",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "merge-pdf-files",
    niche: "pdf-excel",
    searchPhrases: [
      "merge pdf files",
      "merge pdf",
      "combine pdf files into one",
      "combine pdf files into one free",
      "merge pdf files in order",
      "combine pdf and jpg into one pdf",
    ],
    title: "Merge PDF files into one, in the order you need (free)",
    description:
      "Merge PDF files into one in the order you need. Stella (stella.sh) reads each document, follows your checklist, adds photos as pages and saves one PDF.",
    h1: "Merge PDF files into one, in the right order",
    short: "Merge PDF files",
    lede: "All your documents in one PDF, in the right order.",
    answer:
      "Tell Stella (stella.sh) which PDFs to merge and in what order. It turns photos into pages, follows your checklist and saves one file.",
    gets: ["Photos and scans included", "Things that don't belong left out"],
    prompt:
      "The lender wants everything as one PDF. It's all in my Mortgage application folder with their checklist. Combine it in the checklist's order.",
    demo: {
      ack: "Okay, reading the checklist first.",
      task: "Building your mortgage PDF",
      rows: ["Reading the checklist", "Seeing what each file is", "Putting them in order"],
      reply:
        "Your **16-page PDF** follows the checklist. I left out the May 2024 payslip, since they want the last three.",
      files: ["Mortgage application - Northgate.pdf"],
    },
    faq: [
      ["How do I merge PDFs for free without uploading them?", "Preview on a Mac, PDF24 Creator on Windows and Stella all merge on your own computer."],
      ["Can I combine PDF and JPG files into one PDF?", "Yes. Each photo becomes a page."],
    ],
    byHand: [
      "Mac: open the first PDF in Preview, choose View, Thumbnails, and drag the other files into the sidebar.",
      "Save it with File, Export as PDF under a new name.",
      "Windows: drop the files into Merge PDF in the free PDF24 Creator, drag into order and save.",
    ],
    related: [
      "pdf-excel/split-pdf-into-multiple-files",
      "pdf-excel/reorder-pdf-pages",
      "pdf-excel/compress-pdf-too-large-to-email",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "delete-pages-from-pdf",
    niche: "pdf-excel",
    searchPhrases: [
      "delete pages from pdf",
      "remove pages from pdf",
      "delete pages from pdf free",
      "delete pages from pdf mac",
      "remove pages from multiple pdf files",
    ],
    title: "Delete pages from a PDF, or from a whole folder of PDFs",
    description:
      "Delete pages from a PDF or a whole folder of them. Say which ones you don't want and Stella (stella.sh) removes them and saves clean copies for you.",
    h1: "Delete pages from a PDF (or a folder of them)",
    short: "Delete pages from a PDF",
    lede: "The pages you don't want, gone from one PDF or a whole folder.",
    answer:
      "Describe the pages you don't want, such as adverts, and Stella (stella.sh) deletes them from one PDF or a whole folder, saving clean copies.",
    gets: ["Copies without the unwanted pages", "A whole folder done together", "Every original kept"],
    prompt:
      "My phone bills in Documents have adverts and terms mixed in. Make a copy of each with just the bill pages and the call lists.",
    demo: {
      ack: "Sure, going through the bills.",
      task: "Cleaning up your phone bills",
      rows: ["Reading 12 bills", "Sorting bill pages from adverts", "Saving clean copies"],
      reply:
        "All **12 bills** are cleaned up: 30 pages kept and 27 removed. July's summary page has a one-line offer on it, so I kept it as part of the bill.",
      files: ["Phone bills (cleaned)"],
    },
    faq: [
      ["How do I remove pages from multiple PDF files?", "Point Stella at the folder and describe the pages to drop, wherever they are in each file."],
    ],
    byHand: [
      "Mac: select pages in Preview's thumbnails (Command-click for several) and press Delete. Export under a new name.",
      "Windows: Remove pages in the free PDF24 Creator.",
      "Anywhere: print only the pages you want, such as 1-2, 4, to a new PDF.",
    ],
    related: ["pdf-excel/extract-pages-from-pdf", "pdf-excel/split-pdf-into-multiple-files", "pdf-excel/reorder-pdf-pages"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "edit-text-in-pdf",
    niche: "pdf-excel",
    searchPhrases: [
      "edit text in pdf",
      "change text in pdf",
      "edit text in pdf free",
      "edit pdf text mac",
      "fix a typo in a pdf without the original",
    ],
    title: "Edit text in a PDF without the original file (free)",
    description:
      "Edit text in a PDF without the original file. Tell Stella (stella.sh) what's wrong and it changes the words everywhere, in the same font, size and colour.",
    h1: "Edit text in a PDF when you don't have the original",
    short: "Edit text in a PDF",
    lede: "A mistake in your PDF corrected, with everything else the same.",
    answer:
      "You can change text in a PDF without the original. Tell Stella (stella.sh) what it should say and it matches the font, size and colour.",
    gets: ["The same look, no white patches", "Your old version kept as a copy"],
    prompt:
      "The Spring Fair PDF should say 21 March, not 14 March, and the phone number should end 181, not 118. Fix it everywhere.",
    demo: {
      ack: "Okay, finding every mention.",
      task: "Fixing the Spring Fair PDF",
      rows: ["Finding five mentions", "Changing the words", "Comparing before and after"],
      reply:
        "Fixed in all **five places**, and nothing else changed. One thing: 21 March 2027 is a Sunday, and so was 14 March. Which day is the fair?",
      files: ["Spring Fair 2027.pdf", "Spring Fair 2027 (original).pdf"],
    },
    faq: [
      ["Can I edit PDF text in Preview on a Mac?", "Preview adds new text but leaves existing words alone. LibreOffice Draw or Stella can change them."],
    ],
    byHand: [
      "Open the PDF in the free LibreOffice Draw.",
      "Double-click a line and retype it. Do this everywhere the mistake appears.",
      "Choose File, Export as PDF and compare it with the original.",
      "Acrobat (paid) edits text in place too. Online editors often just cover the old words.",
    ],
    related: ["pdf-excel/redact-pdf", "documents/convert-pdf-to-word", "pdf-excel/add-signature-to-pdf"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "extract-pages-from-pdf",
    niche: "pdf-excel",
    searchPhrases: [
      "extract pages from pdf",
      "extract pages from pdf free",
      "extract pages from pdf mac",
      "save certain pages of a pdf as a new file",
    ],
    title: "Extract pages from a PDF into a new file (free)",
    description:
      "Extract pages from a PDF into a new file. Describe what you need and Stella (stella.sh) finds those pages, however long the document, and saves them.",
    h1: "Extract pages from a PDF into their own file",
    short: "Extract pages from a PDF",
    lede: "Just the pages you need, in their own file.",
    answer:
      "To extract pages from a PDF, tell Stella (stella.sh) the page numbers or what's on them. It saves just those as a new file.",
    gets: ["Related pages found for you", "The full document unchanged"],
    prompt:
      "In my Documents there's a PDF of everyone's October expense claims. Pull out Jordan Ellis's claims and receipts into a separate PDF.",
    demo: {
      ack: "Sure, looking for Jordan's pages.",
      task: "Pulling out Jordan's claims",
      rows: ["Reading 28 pages", "Finding claims and receipts", "Saving a new PDF"],
      reply:
        "Jordan's **7 pages** are in a new PDF: three claims, a continuation page and three receipts. I left out Jordan Ellison, who's someone else.",
      files: ["Jordan Ellis expenses October 2026.pdf"],
    },
    faq: [
      ["How do I extract pages from a PDF on Windows without Adobe?", "PDF24 Creator is free and works offline. Or print a page range to Microsoft Print to PDF."],
    ],
    byHand: [
      "Scroll through and note the page numbers, including receipts that belong.",
      "Mac: in Preview's thumbnails, Command-click the pages and drag them to the desktop.",
      "Windows: open Extract pages in the free PDF24 Creator and type a list like 7-10, 18-19, 25.",
    ],
    related: ["pdf-excel/split-pdf-into-multiple-files", "pdf-excel/delete-pages-from-pdf", "pdf-excel/merge-pdf-files"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "add-signature-to-pdf",
    niche: "pdf-excel",
    searchPhrases: [
      "add signature to pdf",
      "sign pdf",
      "add signature to pdf on mac",
      "sign pdf with a photo of my signature",
      "insert signature image into pdf",
    ],
    title: "Add your signature to a PDF from a photo of it (free)",
    description:
      "Add your signature to a PDF from a photo of it. Stella (stella.sh) cuts out the ink, puts it on the right line and saves the signed copy for you.",
    h1: "Add your signature to a PDF, from a photo of it",
    short: "Add a signature to a PDF",
    lede: "Your own signature on the right line, with no printing.",
    answer:
      "Give Stella (stella.sh) a photo of your signature and the PDF. It cuts out the ink, adds it to the right line and saves a signed copy.",
    gets: ["Clean ink with no grey box", "The unsigned copy kept"],
    prompt:
      "Sign the tenancy renewal in my Downloads on the Tenant line. There's a photo of my signature in Pictures.",
    demo: {
      ack: "Sure, getting your signature ready.",
      task: "Signing your tenancy renewal",
      rows: ["Cutting out your signature", "Finding the tenant line", "Placing it on page 4"],
      reply:
        "It's signed on the **Tenant line on page 4**, and the landlord's line is empty. The date is still blank. Shall I fill it in, handwritten or typed?",
      files: ["Tenancy renewal - 14 Linden Row-signed.pdf"],
    },
    faq: [
      ["Can it add the date or my initials too?", "Yes. Ask for the date, or initials on every page."],
    ],
    byHand: [
      "Mac: in Preview use Markup, Sign, create your signature, drag it onto the line, then File, Export as PDF.",
      "Windows: open Sign PDF in the free PDF24 Creator and draw a signature or add a photo.",
      "For the best photo, use dark ink on white paper in even light.",
    ],
    related: ["pdf-excel/fill-pdf-form-from-spreadsheet", "pdf-excel/edit-text-in-pdf", "pdf-excel/merge-pdf-files"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "split-pdf-pages-in-half",
    niche: "pdf-excel",
    searchPhrases: [
      "split pdf pages in half",
      "split pdf pages in half vertically",
      "split scanned book pages into single pages",
      "split two page spread pdf",
    ],
    title: "Split PDF pages in half: scanned spreads to single pages",
    description:
      "Split PDF pages in half when a scan shows two side by side. Stella (stella.sh) makes each one its own page, in order, and leaves the covers whole.",
    h1: "Split PDF pages in half, so each page stands alone",
    short: "Split PDF pages in half",
    lede: "Two-page scans split into single pages, in reading order.",
    answer:
      "When a scan shows two pages side by side, Stella (stella.sh) splits each one in half, in reading order, and leaves single covers whole.",
    gets: ["Every page on its own", "The same scan quality"],
    prompt:
      "My scan of nana's recipe booklet has two pages side by side. Make each one its own page, in order.",
    demo: {
      ack: "Lovely. Opening the booklet.",
      task: "Splitting the recipe booklet",
      rows: ["Looking at eight scans", "Splitting the double pages", "Following the page numbers"],
      reply:
        "Nana's booklet now has **14 single pages** in reading order, with both covers whole.",
      files: ["Nana's recipe booklet - single pages.pdf"],
    },
    faq: [
      ["Why are my split pages in the wrong order?", "A booklet taken apart has its last page beside page 1. Rearrange the halves after splitting."],
    ],
    byHand: [
      "All double pages: the free MuPDF does it with mutool poster -x 2 in.pdf out.pdf.",
      "Take single covers out first, then merge them back in.",
      "Mac: in Preview use Edit, Duplicate on a page, then Tools, Crop for the left and right halves.",
      "Export as a new PDF and look over the order.",
    ],
    related: ["pdf-excel/reorder-pdf-pages", "pdf-excel/make-scanned-pdf-searchable", "pdf-excel/rotate-pdf-pages"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "extract-text-from-pdf",
    niche: "pdf-excel",
    searchPhrases: [
      "extract text from pdf",
      "pdf to text",
      "scanned pdf to text",
      "extract text from multiple pdf files",
      "extract text from pdf image",
    ],
    title: "Extract text from PDFs, scans included, into text files",
    description:
      "Extract text from PDFs, including scanned ones. Stella (stella.sh) reads a whole folder and gives you a text file for each, easy to search and copy.",
    h1: "Extract text from PDFs, including scanned ones",
    short: "Extract text from PDFs",
    lede: "The words out of any PDF, scanned or not.",
    answer:
      "Stella (stella.sh) gets the text out of PDFs, scanned ones included. Give it one file or a whole folder and copy whatever you need.",
    gets: ["A text file beside each PDF", "Columns in the right order"],
    prompt:
      "I've got a folder of planning PDFs in my Downloads, some scanned. Get the text out of all of them into text files.",
    demo: {
      ack: "Sure, starting with the folder.",
      task: "Getting the text out of your PDFs",
      rows: ["Opening nine PDFs", "Reading three scans", "Saving a text file each"],
      reply:
        "All **9 PDFs** have a text file next to them now. Three were scans, so I read those from the page.",
      files: ["Planning documents"],
    },
    faq: [
      ["How do I get text from a scanned PDF?", "Stella reads scans for you. On a Mac, Preview's Live Text lets you select words in the picture."],
    ],
    byHand: [
      "Can you select the words? Press Ctrl+A (Command-A on a Mac), copy and paste into a text editor.",
      "Windows: open the PDF in Word, then File, Save As, Plain Text.",
      "Mac: select words on a scan with Live Text in Preview.",
    ],
    related: [
      "pdf-excel/make-scanned-pdf-searchable",
      "documents/convert-pdf-to-word",
      "pdf-excel/extract-table-from-pdf-to-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "extract-table-from-pdf-to-excel",
    niche: "pdf-excel",
    searchPhrases: [
      "extract table from pdf to excel",
      "pdf table to excel",
      "pdf to excel",
      "extract tables from pdf",
      "pdf table to excel mac",
    ],
    title: "Extract a table from a PDF to Excel, prices as numbers",
    description:
      "Extract a table from a PDF to Excel without retyping. Stella (stella.sh) gives you clean rows and columns, with prices as numbers you can sort and filter.",
    h1: "Extract a table from a PDF to Excel",
    short: "PDF table to Excel",
    lede: "The table from your PDF in Excel, with prices that add up.",
    answer:
      "To extract a table from a PDF to Excel, give the PDF to Stella (stella.sh). You get every row in a clean sheet, with prices as real numbers.",
    gets: [
      "One clean table, across all the pages",
      "Prices you can sort and add up",
      "No repeated headings or stray rows",
    ],
    prompt:
      "Put the table from the PDF price list in my Downloads into Excel, with proper prices I can sort.",
    demo: {
      ack: "Okay, reading the price list.",
      task: "Putting the price list in Excel",
      rows: ["Reading four pages", "Rebuilding the table", "Checking prices against the PDF"],
      reply:
        "All **131 products** are in Excel, with category, pack size, trade price and RRP. Two pairs share a description but have very different prices.",
      files: ["Trade price list.xlsx"],
    },
    faq: [
      ["How do I copy a table from PDF to Excel?", "Copy and paste it into Excel. If it lands in one column, use Data, Text to Columns."],
      ["How do I copy a table from PDF to Word?", "Open the PDF in Word on Windows, or ask Stella for a Word document."],
      ["Can Excel for Mac import a table from PDF?", "On a Mac, use the free Tabula or ask Stella. Excel's own PDF import is on Windows."],
    ],
    byHand: [
      "Windows, Microsoft 365: Data, Get Data, From File, From PDF. Pick the table, Transform Data, then Close & Load.",
      "Mac or anywhere: in the free Tabula, draw a box round the table and export a CSV.",
      "Sort by the code column to gather repeated headings, then delete them.",
      "Prices stuck as text? Remove “£” and commas with Find and Replace.",
    ],
    related: [
      "pdf-excel/bank-statement-pdf-to-excel",
      "pdf-excel/extract-text-from-pdf",
      "pdf-excel/receipts-to-spreadsheet",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-xml-to-excel",
    niche: "pdf-excel",
    searchPhrases: [
      "convert xml to excel",
      "xml to excel",
      "open xml file in excel",
      "how to open xml file",
      "apple health export xml to excel",
    ],
    title: "Convert an XML file to Excel (the iPhone Health export)",
    description:
      "Convert an XML file to Excel, such as an iPhone Health export. Tell Stella (stella.sh) what you want to see and get a clear sheet with daily totals.",
    h1: "Convert an XML file to Excel, totals and all",
    short: "XML to Excel",
    lede: "A file you can't read, turned into a sheet you can.",
    answer:
      "To convert XML to Excel, tell Stella (stella.sh) what you want to see. It makes a sheet of it, like daily steps from an iPhone Health export.",
    gets: ["Only the columns you asked for", "Totals for each day", "A tab for each kind of reading"],
    prompt:
      "I exported my iPhone health data but can't open the XML file. Make a spreadsheet with my steps per day and all my weight readings.",
    demo: {
      ack: "Sure, opening the export.",
      task: "Making your health spreadsheet",
      rows: ["Reading your health data", "Adding up steps per day", "Listing your weights"],
      reply:
        "Your spreadsheet has **92 days of steps**, from 1 July to 30 September, and **15 weight readings**. Your highest and lowest days are noted too.",
      files: ["Apple Health - Steps and Weight.xlsx"],
    },
    faq: [
      ["How do I open an XML file?", "A browser or text editor shows the raw text. For a table, open it through Excel's Get Data or ask Stella."],
    ],
    byHand: [
      "On the iPhone: Health, your picture, Export All Health Data. Unzip it and find export.xml.",
      "Excel on Windows: Data, Get Data, From File, From XML, then the Record table and Transform Data.",
      "Filter the type to HKQuantityTypeIdentifierStepCount.",
      "Keep the first 10 characters of startDate and Group By date with Sum.",
    ],
    related: [
      "pdf-excel/convert-json-to-excel",
      "pdf-excel/convert-text-file-to-excel",
      "pdf-excel/summarize-spreadsheet-by-category",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-numbers-to-excel",
    niche: "pdf-excel",
    searchPhrases: [
      "convert numbers to excel",
      "convert numbers to excel on windows",
      "open numbers file on pc",
      "numbers file to excel free",
    ],
    title: "Convert a Numbers file to Excel without a Mac (free)",
    description:
      "Convert a Numbers file to Excel without a Mac. Stella (stella.sh) turns it into an Excel file on your PC, with every table, amount and date carried over.",
    h1: "Convert a Numbers file to Excel, even without a Mac",
    short: "Numbers to Excel",
    lede: "A Mac Numbers file you can open in Excel on any computer.",
    answer:
      "No Mac needed. Stella (stella.sh) converts a Numbers file to Excel on your own computer, with every table, amount and date included.",
    gets: ["Every table, even several on a sheet", "Totals that update"],
    prompt:
      "My sister sent me our wedding budget as a Numbers file and I can't open it. Turn it into Excel with everything in it.",
    demo: {
      ack: "Of course, opening the file.",
      task: "Converting the wedding budget",
      rows: ["Finding all the tables", "Copying them to Excel", "Checking amounts and dates"],
      reply:
        "Your wedding budget is in Excel: costs, payments made and the **84-row guest list**. I added totals for quoted, paid and still to pay.",
      files: ["Wedding budget.xlsx"],
    },
    faq: [
      ["Can Excel open a .numbers file?", "Excel needs it converted first. Stella, LibreOffice or iCloud.com can do that."],
    ],
    byHand: [
      "With a Mac: open it in Numbers, then File, Export To, Excel.",
      "Windows or Linux: open it in the free LibreOffice Calc and save as Excel 2007-365 (.xlsx).",
      "Any browser: upload it to [iCloud.com](https://www.icloud.com), open it in Numbers and download a copy as Excel.",
    ],
    related: [
      "pdf-excel/convert-excel-to-csv",
      "pdf-excel/split-bills-with-roommates",
      "pdf-excel/combine-excel-files-into-one-sheet",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-word-table-to-excel",
    niche: "pdf-excel",
    searchPhrases: [
      "convert word table to excel",
      "word to excel",
      "extract tables from word document to excel",
      "convert word table to excel without splitting cells",
    ],
    title: "Convert Word tables to Excel without split cells or lost zeros",
    description:
      "Convert Word tables to Excel without split cells or lost zeros. Stella (stella.sh) gathers the tables from all your documents into one tidy spreadsheet.",
    h1: "Convert Word tables to Excel (from one document or many)",
    short: "Word tables to Excel",
    lede: "Tables from your Word documents, together in one spreadsheet.",
    answer:
      "Point Stella (stella.sh) at your Word documents. It puts every table row into one Excel sheet, with phone numbers whole and the source noted.",
    gets: ["All the tables on one sheet", "No blank or broken rows"],
    prompt:
      "I've got five volunteer sign-up sheets in Word. Put everyone into one Excel spreadsheet, with a column for which event it is.",
    demo: {
      ack: "Sure, opening the sign-up sheets.",
      task: "Gathering your volunteer sign-ups",
      rows: ["Reading five documents", "Collecting every name", "Counting each event"],
      reply:
        "All **46 sign-ups** are on one sheet, each with its event and date. Two phone numbers are each listed for two people.",
      files: ["All volunteer sign-ups.xlsx"],
    },
    faq: [
      ["Why does one Word cell become two rows in Excel?", "It has a line break in it. Swap line breaks for a slash in Word before copying."],
    ],
    byHand: [
      "Set the phone column in Excel to Text.",
      "In Word, click the table's top-left handle, copy, and paste into Excel.",
      "Rejoin any cell that split over two rows.",
      "Add an Event column for each document, then delete blank rows and repeated headings.",
    ],
    related: [
      "pdf-excel/extract-table-from-pdf-to-excel",
      "pdf-excel/combine-excel-files-into-one-sheet",
      "pdf-excel/remove-duplicate-rows-in-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-json-to-excel",
    niche: "pdf-excel",
    searchPhrases: ["convert json to excel", "json to excel", "open json file in excel", "json to csv", "how to open json file"],
    title: "Convert a JSON file to Excel, one row per record",
    description:
      "Convert a JSON file to Excel you can read. Tell Stella (stella.sh) which columns you want and get one row per order, with names, dates and totals.",
    h1: "Convert a JSON file to Excel you can actually read",
    short: "JSON to Excel",
    lede: "That unreadable export, as a spreadsheet you can use.",
    answer:
      "To convert JSON to Excel, tell Stella (stella.sh) which columns you want. It makes a sheet with one row per record, such as each order.",
    gets: ["One row per order, or per item", "Just the columns you need", "Dates and totals that match the file"],
    prompt:
      "My shop exported last month's orders as a JSON file. Put it in Excel, one row per order, with date, customer, city, items and total.",
    demo: {
      ack: "No problem, opening the file.",
      task: "Putting your orders in Excel",
      rows: ["Reading 58 orders", "Laying out the columns", "Checking the total"],
      reply:
        "Your **58 orders** are in Excel, coming to **$4,513.00**. Three guests had no customer record, so I used their shipping names.",
      files: ["orders_2026-10.xlsx"],
    },
    faq: [
      ["How do I open a JSON file in Excel?", "Choose Data, Get Data, From File, From JSON, or ask Stella."],
      ["Can I export JSON to multiple Excel sheets?", "Yes. Ask for orders on one sheet and their items on another."],
      ["How do I convert JSON to CSV?", "Ask Stella for a CSV, or save as CSV from Excel."],
    ],
    byHand: [
      "Excel: Data, Get Data, From File, From JSON. Click Into Table, then the double-arrow button to get one row per record.",
      "Open columns like customer and tick the fields you want. Expand line_items for one row per item.",
      "Set dates to Text or Date, then Close & Load. Recent Excel for Mac works the same.",
    ],
    related: [
      "pdf-excel/convert-xml-to-excel",
      "pdf-excel/convert-text-file-to-excel",
      "pdf-excel/summarize-spreadsheet-by-category",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-text-file-to-excel",
    niche: "pdf-excel",
    searchPhrases: [
      "convert text file to excel",
      "convert text file to excel with columns",
      "txt to excel",
      "txt to csv",
      "import fixed width text file into excel",
    ],
    title: "Convert a text file to Excel with proper columns",
    description:
      "Convert a text file to Excel with proper columns. Stella (stella.sh) turns an old printout or .txt file into a clean sheet with names, dates and amounts right.",
    h1: "Convert a text file to Excel, each column in its own column",
    short: "Text file to Excel",
    lede: "A messy text file, in neat columns you can sort.",
    answer:
      "Stella (stella.sh) converts a text file to Excel with each column in its own column, dates and accents right, and no repeated page headings.",
    gets: ["One row per record", "Accents, dates and amounts right", "Totals matched to the printout"],
    prompt:
      "Our rowing club's old system printed the member list to a text file. Make it a proper Excel sheet, one row per member.",
    demo: {
      ack: "Sure, reading the member list.",
      task: "Turning the list into Excel",
      rows: ["Reading five pages", "Separating the columns", "Matching the club's totals"],
      reply:
        "All **212 members** are in Excel, with names, join dates and balances. Money owed shows as negative, and the total agrees with the printout. Shall I split first and last names?",
      files: ["Member list.xlsx"],
    },
    faq: [
      ["How do I convert txt to CSV?", "Import the file into Excel and save as CSV, or ask Stella for a CSV."],
    ],
    byHand: [
      "Windows: Data, Get Data, From File, From Text/CSV. Split Column By Positions for a fixed width file.",
      "Mac: File, Import, Text file, Fixed width, then click where columns start.",
      "Sort by the first column and delete repeated headings.",
      "Change 45.00- to a negative number.",
    ],
    related: [
      "pdf-excel/convert-json-to-excel",
      "pdf-excel/split-csv-file-into-multiple-files",
      "pdf-excel/fix-dates-in-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "split-csv-file-into-multiple-files",
    niche: "pdf-excel",
    searchPhrases: [
      "split csv file into multiple files",
      "csv too large for excel",
      "split csv file",
      "csv file too big to open in excel",
      "split large csv with header",
    ],
    title: "Split a CSV that's too big for Excel, with headers kept",
    description:
      "CSV too large for Excel? Stella (stella.sh) splits it into smaller files that open fully, with the column names at the top of each and no rows lost.",
    h1: "Split a CSV file into multiple files that open in Excel",
    short: "Split a big CSV",
    lede: "A file too big for Excel, in parts that open fully.",
    answer:
      "Excel stops at 1,048,576 rows. Stella (stella.sh) splits a bigger CSV into smaller files, each with the header row and nothing lost.",
    gets: ["Files that open fully in Excel", "Every row kept, in order"],
    prompt:
      "The sales export CSV in my Downloads is too big for Excel. Split it into smaller files with the header row in every one.",
    demo: {
      ack: "Okay, measuring the file first.",
      task: "Splitting your sales file",
      rows: ["Counting the rows", "Writing three smaller files", "Making sure nothing is lost"],
      reply:
        "Your **1,150,000 rows** are now in three files of 500,000, 500,000 and 150,000. Each opens fully in Excel and starts with the column names.",
      files: ["Sales export 2019-2026 parts"],
    },
    faq: [
      ["Can I split a CSV by a column instead?", "Yes. Ask for one file per region, year or anything else."],
    ],
    byHand: [
      "Windows: use a free CSV splitter program with an option to repeat the header.",
      "Mac: in Terminal, split -l 1000000 big.csv part_ cuts it up. Then add the header row to every part after the first.",
      "Only need totals? Data, From Text/CSV, Load To, and tick Add to Data Model for a PivotTable.",
    ],
    related: [
      "pdf-excel/split-excel-sheet-into-multiple-files",
      "pdf-excel/combine-excel-files-into-one-sheet",
      "pdf-excel/convert-text-file-to-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-excel-to-csv",
    niche: "pdf-excel",
    searchPhrases: [
      "convert excel to csv",
      "excel to csv",
      "excel to csv keep leading zeros",
      "convert excel to csv multiple sheets",
    ],
    title: "Convert Excel to CSV: every sheet, leading zeros kept",
    description:
      "Convert Excel to CSV and keep leading zeros and dates. Stella (stella.sh) saves every sheet as its own CSV file, ready to load into a website or app.",
    h1: "Convert Excel to CSV, keeping leading zeros and dates",
    short: "Excel to CSV",
    lede: "Clean CSV files from every sheet, zeros and dates kept.",
    answer:
      "Stella (stella.sh) saves each Excel sheet as its own CSV, keeping leading zeros, dates and accented names just as you see them.",
    gets: ["One CSV for each sheet", "Possible typos pointed out"],
    prompt:
      "The membership website needs our swim club spreadsheet as CSV files, one per sheet. Keep the leading zeros and make the dates proper dates.",
    demo: {
      ack: "Sure, saving each sheet.",
      task: "Making CSV files for the club",
      rows: ["Reading three sheets", "Keeping zeros and dates", "Comparing with the spreadsheet"],
      reply:
        "You have **three CSV files**: 64 members, 40 payments and the notes. Eight payments say $1,250.00; were those meant to be $125.00?",
      files: ["Members.csv", "Payments.csv", "Read me.csv"],
    },
    faq: [
      ["Why does Excel drop leading zeros in a CSV?", "It hides them when it opens the file. Look in Notepad or TextEdit to see what's really there."],
    ],
    byHand: [
      "Fix zeros with =TEXT(A2,\"00000\"), then copy and Paste Values over the column.",
      "Format dates as yyyy-mm-dd.",
      "On each sheet: File, Save As, CSV UTF-8 (Comma delimited).",
      "Open the result in Notepad or TextEdit to look it over.",
    ],
    related: [
      "pdf-excel/convert-numbers-to-excel",
      "pdf-excel/split-csv-file-into-multiple-files",
      "pdf-excel/fix-dates-in-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "split-excel-sheet-into-multiple-files",
    niche: "pdf-excel",
    searchPhrases: [
      "split excel sheet into multiple files",
      "split excel sheet into multiple files based on column value",
      "split excel sheet by column value",
      "split excel sheet into multiple files without vba",
    ],
    title: "Split an Excel sheet into multiple files by column value",
    description:
      "Split an Excel sheet into multiple files by column value. Stella (stella.sh) makes one file per person or region and catches names typed differently.",
    h1: "Split an Excel sheet into multiple files by column value",
    short: "Split an Excel sheet into files",
    lede: "A separate file for each person, region or team.",
    answer:
      "Tell Stella (stella.sh) which column to split by, such as the sales rep. You get a separate Excel file for each, even with messy names.",
    gets: ["Messy names matched up", "Totals equal to the original"],
    prompt:
      "Split our 2026 orders spreadsheet into a separate Excel file for each sales rep, with only their own orders.",
    demo: {
      ack: "On it. Sorting orders by rep.",
      task: "Splitting orders by sales rep",
      rows: ["Reading 620 orders", "Matching names typed differently", "Making a file per rep"],
      reply:
        "**Six files**, one for each rep, all adding up to the original. 44 orders had the name typed differently and went to the right person. Want me to email them out?",
      files: ["Orders 2026 by rep"],
    },
    faq: [
      ["Can I split an Excel sheet without VBA?", "Yes. Stella does it without macros, or you can filter and copy by hand."],
    ],
    byHand: [
      "Tidy the column with =PROPER(TRIM(D2)) so each name has one spelling.",
      "Turn on Data, Filter and choose one name.",
      "Copy the visible rows to a new workbook and save it under that name. Repeat.",
      "Add up the row counts; they should match the original.",
    ],
    related: [
      "pdf-excel/split-csv-file-into-multiple-files",
      "pdf-excel/combine-excel-files-into-one-sheet",
      "pdf-excel/summarize-spreadsheet-by-category",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "fix-garbled-characters-in-csv",
    niche: "pdf-excel",
    searchPhrases: [
      "fix garbled characters in csv",
      "garbled text",
      "csv special characters excel",
      "csv utf 8 excel",
      "excel csv encoding",
    ],
    title: "Fix garbled characters in a CSV (Ã© instead of é) for Excel",
    description:
      "Fix garbled characters in a CSV, like Ã© instead of é. Stella (stella.sh) repairs the names and saves a clean copy that opens properly in Excel.",
    h1: "Fix garbled characters in a CSV file",
    short: "Fix garbled characters in CSV",
    lede: "Names and accents back to normal, in a file that opens properly.",
    answer:
      "Garbled text like JosÃ© means the file was saved or opened the wrong way. Stella (stella.sh) turns it back into José and saves a clean copy.",
    gets: ["A copy Excel opens with a double-click", "Names that were right left alone"],
    prompt:
      "The names in my contacts CSV have gone weird, like 'JosÃ©' instead of 'José'. Fix them and save a copy that opens in Excel.",
    demo: {
      ack: "Sure, putting the names right.",
      task: "Fixing the names in your contacts",
      rows: ["Reading 150 contacts", "Repairing the odd letters", "Looking for any left over"],
      reply:
        "All **150 contacts** read properly now: José, Zoë Brontë-Hale, O’Connor’s, Łódź. A few email addresses are missing accented letters, so look at those.",
      files: ["Contacts export (clean).csv"],
    },
    faq: [
      ["What does â€™ mean?", "It's a curly apostrophe. â€œ is a curly quote and â‚¬ is the euro sign."],
    ],
    byHand: [
      "Open it in Notepad or TextEdit. If names look right there, only Excel misread it.",
      "Windows: Data, From Text/CSV, File origin 65001: Unicode (UTF-8). Mac: File, Import, the same origin.",
      "Still garbled? Replace Ã© with é, Ã¶ with ö, â€™ with ’.",
      "Save as CSV UTF-8 (Comma delimited).",
    ],
    related: [
      "pdf-excel/fix-dates-in-excel",
      "contacts-calendar-email/merge-duplicate-contacts",
      "contacts-calendar-email/convert-csv-to-vcf",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "add-watermark-to-pdf",
    niche: "pdf-excel",
    searchPhrases: [
      "add watermark to pdf",
      "watermark pdf",
      "add watermark to pdf free",
      "watermark id documents for rental application",
      "add watermark to scanned pdf",
    ],
    title: "Add a watermark to a PDF, scanned ID pages included",
    description:
      "Add a watermark to a PDF, scanned ID included. Tell Stella (stella.sh) the wording and it puts it across every page of a copy, so your documents can't be reused.",
    h1: "Add a watermark to a PDF before you send it",
    short: "Add a watermark to a PDF",
    lede: "Your wording across every page before you send your ID.",
    answer:
      "Tell Stella (stella.sh) what the watermark should say. It puts your words across every page, scans and ID photos included, and saves copies to send.",
    gets: ["No clean corner to crop out", "Unmarked originals kept"],
    prompt:
      "I'm sending my passport, payslip and bank statement to rent a flat. Put “Only for Fernhill Lettings rental application” across every page.",
    demo: {
      ack: "Sure, marking all three.",
      task: "Watermarking your documents",
      rows: ["Opening three documents", "Adding your words to each page", "Making sure they show clearly"],
      reply:
        "All three are marked, **five pages** in total, with the wording large and repeated in small rows. It shows over your passport photo too. Your own copies are unmarked.",
      files: [
        "Passport - Fernhill Lettings copy.pdf",
        "Payslip - Fernhill Lettings copy.pdf",
        "Bank statement - Fernhill Lettings copy.pdf",
      ],
    },
    faq: [
      ["How do I watermark a scanned PDF?", "Put the mark in front of the page. Behind a scan, the picture hides it."],
    ],
    byHand: [
      "Windows: the watermark tool in the free PDF24 Creator. Type the wording, set it large, pale and diagonal.",
      "Mac: in Preview use Tools, Annotate, Text on each page, then File, Export as PDF.",
      "Acrobat: choose to place it on top of the page.",
      "Open each copy and look at every page.",
    ],
    related: ["photos-files/add-watermark-to-photos", "pdf-excel/redact-pdf", "pdf-excel/add-signature-to-pdf"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
