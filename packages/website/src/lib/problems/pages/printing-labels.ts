import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const PRINTING_LABELS_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "print-address-labels-from-excel",
    niche: "printing-labels",
    searchPhrases: [
      "how to print labels from excel",
      "print address labels from excel",
      "avery 5160 template",
      "print mailing labels from excel",
      "address labels from spreadsheet",
    ],
    title: "Print address labels from Excel on Avery 5160 sheets",
    description:
      "Print address labels from Excel without a mail merge. Stella (stella.sh) lays your list out on Avery 5160 sheets as a PDF, with every ZIP code's leading zero kept.",
    h1: "Print address labels from Excel on Avery 5160 sheets",
    short: "Address labels from Excel",
    lede: "Address labels from your spreadsheet, ready to print on Avery 5160.",
    answer:
      "To print address labels from Excel, ask Stella (stella.sh). It reads your spreadsheet and makes a PDF laid out for Avery 5160 sheets, with ZIP codes kept at five digits.",
    gets: [
      "A print-ready PDF for Avery 5160 sheets",
      "Only the people you pick, in list order",
      "ZIP codes with their leading zeros",
    ],
    prompt:
      "Print address labels for our holiday cards from the spreadsheet in my Documents, for everyone marked Yes, on Avery 5160 sheets in list order.",
    demo: {
      ack: "Happy to. Opening your card list.",
      task: "Making your holiday card labels",
      rows: ["Keeping the 48 people marked Yes", "Putting zeros back on ZIP codes", "Laying out the 5160 sheets"],
      reply:
        "Your labels are ready: **48 addresses**, one full sheet and 18 on a second. ZIPs like 02806 kept their zero. Print at 100% on plain paper first to check the line-up.",
      files: ["Holiday card labels 2026 - Avery 5160.pdf"],
    },
    faq: [
      ["What size is an Avery 5160 label?", "2⅝ × 1 inches, 30 to a US Letter sheet in 3 columns and 10 rows."],
      ["Why did my ZIP codes lose the zero?", "Excel stores 02806 as the number 2806 unless the cell is text, so a mail merge prints four digits."],
    ],
    byHand: [
      "In Word: Mailings, Start Mail Merge, Labels, then Avery US Letter, 5160 Address Labels.",
      "Select Recipients, Use an Existing List, open the spreadsheet, insert Address Block, then Update Labels and Finish & Merge.",
    ],
    related: [
      "printing-labels/print-envelopes-from-excel",
      "printing-labels/make-barcode-labels-from-excel",
      "printing-labels/make-name-tags-from-a-list",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "print-envelopes-from-excel",
    niche: "printing-labels",
    searchPhrases: [
      "how to print envelopes from excel",
      "how to print addresses on envelopes",
      "addressing envelopes",
      "mail merge envelopes",
      "how to print envelopes",
    ],
    title: "Print envelopes from Excel: one per household, return address",
    description:
      "Print envelopes from an Excel guest list, one per household, with your return address. Stella (stella.sh) makes a print-ready PDF in your envelope size.",
    h1: "Print envelopes from an Excel guest list, one per household",
    short: "Envelopes from Excel",
    lede: "Envelopes printed straight from your guest list, one per household.",
    answer:
      "To print envelopes from Excel, ask Stella (stella.sh). It groups your guest list into households, adds your return address in the corner and makes one envelope-sized page for each.",
    gets: [
      "One envelope per household, not per guest",
      "Your return address in the top left",
      "Pages sized to your envelopes",
    ],
    prompt:
      "From the wedding guest list in my Documents, make A7 envelopes I can print, one per household, with our address in the top left: 418 Alder Creek Road, Bellmont, OR 97321.",
    demo: {
      ack: "Lovely. Reading the guest list now.",
      task: "Making your wedding envelopes",
      rows: ["Grouping 68 guests into households", "Fixing ZIP codes that lost a zero"],
      reply:
        "Your envelopes are ready: **31 households**, one A7 page each, with your address in the top left. Two families who share a surname stayed separate. Try one envelope first to see which way it feeds.",
      files: ["Wedding envelopes - A7.pdf"],
    },
    faq: [
      ["What size is an A7 envelope?", "7¼ × 5¼ inches, the usual envelope for 5 × 7 invitations."],
      ["Can the return address go on the back flap?", "Yes. Ask for a separate pass that prints only the return address."],
    ],
    byHand: [
      "Copy the list to a new tab and use Data, Remove Duplicates on name and address, so each household has one row.",
      "In Word: Mailings, Start Mail Merge, Envelopes, pick the size, type your return address and use the household tab as the list.",
    ],
    related: [
      "printing-labels/print-address-labels-from-excel",
      "weddings-events/count-wedding-rsvps",
      "documents/mail-merge-excel-to-word",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-name-tags-from-a-list",
    niche: "printing-labels",
    searchPhrases: [
      "how to make name tags",
      "name badge template",
      "name tag template",
      "conference name badges",
      "name tags from excel",
    ],
    title: "Make name tags from a registration list (Avery 5395)",
    description:
      "Make name tags from a registration list or Excel sheet. Stella (stella.sh) skips cancellations and double sign-ups and lays the badges out for Avery 5395.",
    h1: "Make name tags from a registration list",
    short: "Name tags from a list",
    lede: "Name badges for everyone who's coming, ready to print.",
    answer:
      "To make name tags from a list, ask Stella (stella.sh). It skips cancellations and double sign-ups, then lays out badges with the first name big, ready for Avery 5395 sticker sheets.",
    gets: ["One badge for each person coming", "First names big, company underneath", "Accented names printed right"],
    prompt:
      "Make name badges for everyone coming to our Fall Summit from the sign-up file in my Downloads, on Avery 5395 sheets. First name big, company underneath, skip cancellations.",
    demo: {
      ack: "Sure. Opening the sign-ups.",
      task: "Making Fall Summit badges",
      rows: ["Skipping three cancellations", "Merging three double sign-ups", "Laying out 8 badges a sheet"],
      reply:
        "Your badges are ready: **37 people** on five sheets. Names like Zoë and Łukasz print properly. One person said self-employed, so their badge says Independent; I can change that.",
    },
    faq: [
      ["What size is an Avery 5395 name badge?", "3⅜ × 2⅓ inches, 8 per US Letter sheet in 2 columns and 4 rows."],
      ["Can I make badges for plastic holders instead?", "Yes. Give the card size, like 4 × 3 inches, and they come out on card stock with cut lines."],
    ],
    byHand: [
      "In Excel, delete cancelled rows and use Data, Remove Duplicates on the email column.",
      "In Word: Mailings, Start Mail Merge, Labels, Avery US Letter, 5395 Name Badges, then insert the name fields.",
    ],
    related: [
      "printing-labels/make-certificates-from-excel",
      "printing-labels/print-address-labels-from-excel",
      "pdf-excel/remove-duplicate-rows-in-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-certificates-from-excel",
    niche: "printing-labels",
    searchPhrases: [
      "how to generate certificates from excel",
      "bulk certificate generator",
      "certificate maker",
      "certificate generator",
      "create certificates from excel",
    ],
    title: "Make certificates from Excel: one page per person, in bulk",
    description:
      "Generate certificates from an Excel list in bulk. Stella (stella.sh) makes one page per person with their name, the course and their date, all in a single PDF.",
    h1: "Generate certificates from an Excel list, one per person",
    short: "Certificates from Excel",
    lede: "A certificate for everyone on your list, one per page.",
    answer:
      "To generate certificates from Excel, ask Stella (stella.sh). It reads your list, picks the right people and writes one PDF with a certificate per person, each with their own name and date.",
    gets: ["One certificate per person, in one PDF", "Names the right way round", "Each person's own date"],
    prompt:
      "Make a certificate of completion for everyone who passed the first aid course in the results spreadsheet in my Documents. Landscape, one per page, with name, course and date.",
    demo: {
      ack: "Sure. Reading the results sheet.",
      task: "Making first aid certificates",
      rows: ["Keeping the 22 people who passed", "Turning 'Last, First' names around", "Designing a landscape page"],
      reply:
        "Done. **22 certificates**, one page each, with the name, Community First Aid & CPR (Level 1) and that person's finish date. Three fails and one incomplete are left out.",
      files: ["First aid certificates.pdf"],
    },
    faq: [
      ["Can I use my own certificate template?", "Yes. Give Stella a Word, PowerPoint or PDF template and say where the name and date go."],
      ["Can each person get their own PDF?", "Yes. Ask for one file per person, named after them, ready to email."],
    ],
    byHand: [
      "Design one landscape certificate in Word with lines for the name and date.",
      "Mailings, Start Mail Merge, Letters, use the spreadsheet as the list, filter to Pass, insert the fields, then Finish & Merge.",
    ],
    related: [
      "documents/mail-merge-excel-to-word",
      "printing-labels/make-name-tags-from-a-list",
      "pdf-excel/fix-dates-in-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-qr-codes-in-bulk",
    niche: "printing-labels",
    searchPhrases: [
      "bulk qr code generator",
      "generate multiple qr codes",
      "qr code from excel",
      "print qr codes",
      "qr code generator multiple",
    ],
    title: "Bulk QR code generator: a QR image per link in a spreadsheet",
    description:
      "Bulk QR code generator with no sign-up and no expiring codes. Stella (stella.sh) makes one QR image per link in your spreadsheet, named after each item.",
    h1: "Make a QR code for every link in a spreadsheet, in bulk",
    short: "QR codes in bulk",
    lede: "A QR code for every link on your list, each saved as its own image.",
    answer:
      "To make QR codes in bulk from a spreadsheet, ask Stella (stella.sh). It saves one QR image per link, named after the item, and scans each back to be sure it opens the right page.",
    gets: ["One QR image per link", "Each file named after its item", "Codes that never expire"],
    prompt:
      "Make a QR code for every product link in the spreadsheet in my Documents, each saved as an image named after the product, so I can print them on our tags.",
    demo: {
      ack: "Sure. Reading your product links.",
      task: "Making product QR codes",
      rows: ["Fixing links missing https://", "Making 22 QR images", "Scanning each one back"],
      reply:
        "Done. **22 QR codes** are in a new Product tag QR codes folder, one per product. Two items had no link, so they have no code.",
      files: ["Product tag QR codes"],
    },
    faq: [
      ["Do these QR codes expire?", "No. They hold the link itself, so they work as long as the page exists. Expiring codes come from services that send scans through their own site."],
      ["Can I make QR codes from Excel?", "Yes. Point Stella at the spreadsheet and say which column holds the links."],
    ],
    byHand: [
      "One at a time: in Chrome or Edge, open the page and choose Create QR code from the share menu.",
      "Word for Windows can print codes in a label mail merge with a MERGEBARCODE field.",
    ],
    related: [
      "printing-labels/make-barcode-labels-from-excel",
      "printing-labels/make-name-tags-from-a-list",
      "documents/mail-merge-excel-to-word",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-barcode-labels-from-excel",
    niche: "printing-labels",
    searchPhrases: ["print barcode labels from excel", "barcode labels", "shelf labels", "price labels", "barcode generator"],
    title: "Print barcode labels from Excel that scan (Avery 5160)",
    description:
      "Print barcode labels from Excel with each product's name and price. Stella (stella.sh) lays them out on Avery 5160 sheets and makes sure every barcode scans.",
    h1: "Print barcode labels from Excel with name and price",
    short: "Barcode labels from Excel",
    lede: "Shelf labels with name, price and a barcode that scans.",
    answer:
      "To print barcode labels from Excel, ask Stella (stella.sh). It reads your stock sheet, puts back the leading zeros Excel drops from UPC codes, and makes labels where every barcode scans.",
    gets: [
      "A label per product with name and price",
      "Barcodes that scan as the right product",
      "Ready for Avery 5160 sheets",
    ],
    prompt:
      "Make shelf labels from my stock spreadsheet with each product's name, price and a barcode that scans. Lay them out for Avery 5160 sheets.",
    demo: {
      ack: "Sure. Opening the stock list.",
      task: "Making Pantry & Larder shelf labels",
      rows: ["Putting back 22 lost leading zeros", "Drawing a barcode per product", "Scanning every barcode in the file"],
      reply:
        "Your labels are ready: **36 products** on one full sheet and six on a second. 22 UPCs had lost their leading zero in Excel; I put them back so each scans right.",
      files: ["Pantry & Larder shelf labels (Avery 5160).pdf"],
    },
    faq: [
      ["Why won't my barcode scan as the right product?", "Usually a lost leading zero: 003292694568 stored as 3292694568 makes a different, shorter code."],
      ["Can it use Code 128 for my own SKUs?", "Yes. Say which column and which barcode type."],
    ],
    byHand: [
      "In Excel, =TEXT(C2,\"000000000000\") keeps UPCs at twelve digits; paste the values over the originals.",
      "Word for Windows: start a Labels merge on Avery 5160 and add a MERGEBARCODE field for the UPC. Word for Mac has no barcode field.",
    ],
    related: [
      "printing-labels/print-address-labels-from-excel",
      "printing-labels/make-qr-codes-in-bulk",
      "printing-labels/make-packing-slips-from-orders",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-packing-slips-from-orders",
    niche: "printing-labels",
    searchPhrases: [
      "print packing slips",
      "packing slip template",
      "packing list template",
      "etsy packing slip",
      "packing slips from csv",
    ],
    title: "Print packing slips for unshipped orders from an orders export",
    description:
      "Print packing slips from your orders export, one page per unshipped order. Stella (stella.sh) puts every item and the ship-to address on the right slip.",
    h1: "Print packing slips for unshipped orders from your export",
    short: "Packing slips from orders",
    lede: "A packing slip for every order that still needs to ship.",
    answer:
      "To print packing slips from an orders export, ask Stella (stella.sh). It pulls each order's rows together, keeps only those still to ship and makes one page per order with the address and items.",
    gets: [
      "One slip per unshipped order",
      "Every item and quantity on the right slip",
      "Gift notes shown, prices left off",
    ],
    prompt:
      "Print packing slips from the orders export in my Downloads for everything that hasn't shipped, one page per order with the address and what goes in the box.",
    demo: {
      ack: "On it. Reading the orders export.",
      task: "Making packing slips",
      rows: ["Grouping item rows into orders", "Keeping the 16 still to ship", "Adding gift notes to the slips"],
      reply:
        "Your slips are ready: **16 orders**, one page each, with a checkbox per item and no prices. One unshipped order was cancelled, so I left it out.",
      files: ["packing-slips-unshipped.pdf"],
    },
    faq: [
      ["Can I add my logo and a thank-you note?", "Yes. Point Stella at the logo and give the wording, and it goes on every slip."],
      ["Can it make 4 × 6 slips for a label printer?", "Yes. Ask for 4 × 6 inch pages in black and white."],
    ],
    byHand: [
      "Most shop platforms print packing slips for selected orders from the orders page.",
      "From an export, fill each order's address down to its item rows, filter to unfulfilled, then use a Directory merge grouped by order number.",
    ],
    related: [
      "documents/generate-invoices-from-spreadsheet",
      "printing-labels/make-barcode-labels-from-excel",
      "printing-labels/print-address-labels-from-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "print-business-cards-at-home",
    niche: "printing-labels",
    searchPhrases: [
      "how to print business cards at home",
      "print business cards",
      "business card size",
      "print business cards double sided",
      "avery 8371 template",
    ],
    title: "Print business cards at home, front and back lined up",
    description:
      "Print business cards at home on Avery 8371 sheets, front and back lined up. Stella (stella.sh) lays out your design as a two-page PDF ready for your printer.",
    h1: "Print business cards at home, front and back",
    short: "Business cards at home",
    lede: "Business cards printed at home, the backs lined up behind the fronts.",
    answer:
      "To print business cards at home, ask Stella (stella.sh). It puts ten copies of your front and back on a two-page PDF for Avery 8371 sheets, lined up for double-sided printing.",
    gets: ["Ten cards a sheet, front and back", "Backs that land behind their fronts", "The print settings to use"],
    prompt:
      "My business card design is in Downloads, front and back. Lay it out for Avery 8371 sheets, 10 a page, so the backs line up when I print double-sided.",
    demo: {
      ack: "Sure. Checking your card design.",
      task: "Laying out your business cards",
      rows: ["Checking the design is 3.5 × 2 in", "Placing 10 fronts on page one", "Lining the backs up on page two"],
      reply:
        "Your cards are ready. Print at **Actual size** and **flip on long edge**, and run one plain-paper sheet first to see the backs sit behind the fronts.",
      files: ["business-cards-avery-8371.pdf"],
    },
    faq: [
      ["What size is a business card?", "3.5 × 2 inches in the US and Canada. In Europe it's usually 85 × 55 mm."],
      ["My printer can't do double-sided. What then?", "Print page 1, put the sheet back in turned over, then print page 2."],
    ],
    byHand: [
      "In Word: Mailings, Labels, Options, Avery US Letter, 8371 Business Cards, Full page of the same label.",
      "Put the front image in each card at 3.5 × 2 in, make a second page with the back, and print flipping on the long edge.",
    ],
    related: [
      "study/print-flashcards-double-sided",
      "printing-labels/make-name-tags-from-a-list",
      "printing-labels/print-poster-on-multiple-pages",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "print-passport-photos-at-home",
    niche: "printing-labels",
    searchPhrases: [
      "print passport photo at home",
      "passport photo size",
      "passport photo 4x6",
      "2x2 photo",
      "passport photo template",
    ],
    title: "Print a US passport photo at home: 2x2 copies on one 4x6",
    description:
      "Print a 2x2 passport photo at home or at the drugstore. Stella (stella.sh) crops your photo to the US rules and puts six copies on one 4x6 print.",
    h1: "Print a passport photo at home: 2x2 copies on a 4x6",
    short: "Passport photos on a 4x6",
    lede: "Passport photos at the right size, six to a 4x6 print.",
    answer:
      "A US passport photo is 2 × 2 inches with the head 1 to 1⅜ inches tall. Stella (stella.sh) crops your photo to fit, checks it against the rules and puts six copies on a 4x6 to print.",
    gets: ["Six 2x2 copies on one 4x6 print", "The head sized to the rules"],
    prompt:
      "Make me US passport photos from the selfie in my Pictures: 2x2 inch copies on a 4x6 I can get printed at the drugstore.",
    demo: {
      ack: "Sure. Checking your photo first.",
      task: "Making your passport photos",
      rows: ["Measuring your head in the photo", "Putting six 2x2 copies on a 4x6"],
      reply:
        "Done. Your head is **1.2 inches** from chin to top, inside the rule, with no glasses or shadows. Order it as a standard 4x6 print with cropping turned off.",
    },
    faq: [
      ["How do I print a 2x2 photo?", "Put copies of the 2 × 2 inch photo on a 6 × 4 inch image and order a standard 4x6 print with auto-crop off."],
      ["What size is a US passport photo?", "2 × 2 inches, the head 1 to 1⅜ inches from chin to top, on a plain white or off-white background."],
      ["Can I print a 2x2 photo from my phone?", "Yes. Upload the 4x6 image to a drugstore photo app and order a 4x6 print."],
    ],
    byHand: [
      "Crop the photo square so the head fills 50 to 69% of the height.",
      "For a 4x6 template, make a 1800 × 1200 pixel canvas and paste the square at 600 × 600 pixels six times.",
    ],
    related: [
      "photos-files/combine-photos-into-one-pdf",
      "photos-files/resize-images-in-bulk",
      "printing-labels/print-poster-on-multiple-pages",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "print-poster-on-multiple-pages",
    niche: "printing-labels",
    searchPhrases: [
      "how to print a large image on multiple pages",
      "print poster on multiple pages",
      "print large image on multiple pages",
      "block poster",
      "rasterbator",
    ],
    title: "Print a large image or poster on multiple pages to tape",
    description:
      "Print a large image or poster across multiple letter or A4 pages. Stella (stella.sh) splits it at the size you want, with overlaps and a label on every page.",
    h1: "Print a large image or poster on multiple pages",
    short: "Poster on multiple pages",
    lede: "A big poster printed across ordinary pages, ready to tape together.",
    answer:
      "To print a large image on multiple pages, tell Stella (stella.sh) the final size. It splits the picture across ordinary pages with a little overlap and labels each page so you know where it goes.",
    gets: [
      "Your poster at the exact size you want",
      "Overlaps marked for trimming and taping",
      "Every page labelled with its place",
    ],
    prompt:
      "I want the garden party poster in my Pictures printed 2 feet wide on normal letter paper. Split it over several pages with some overlap for taping.",
    demo: {
      ack: "Fun. Working out the pages now.",
      task: "Tiling your poster",
      rows: ["Scaling it to 24 inches wide", "Splitting it over 15 pages", "Labelling each page"],
      reply:
        "Done. At 24 inches wide your poster is 36 inches tall, on **15 letter pages**, 3 across and 5 down, each labelled like R2C3. Print at Actual size, trim the overlaps and tape.",
      files: ["garden-party-poster - 24in tiled (letter).pdf"],
    },
    faq: [
      ["How many pages does a 24 × 36 inch poster take?", "About 15 letter pages, 3 across and 5 down, with margins and overlap."],
      ["Can it print on A4 instead?", "Yes. Name the paper size and the final width or height."],
    ],
    byHand: [
      "Make a PDF of the image at the final size, open it in the free Acrobat Reader, Print, then Poster.",
      "Set Tile Scale to 100%, Overlap to 0.25 in or more, and tick Cut marks and Labels.",
      "Online splitters like Rasterbator and Block Posters do it too, after you upload the image.",
    ],
    related: [
      "printing-labels/print-business-cards-at-home",
      "printing-labels/print-passport-photos-at-home",
      "photos-files/combine-photos-into-one-pdf",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
