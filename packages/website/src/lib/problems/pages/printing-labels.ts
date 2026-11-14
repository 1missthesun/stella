import { PROOFS, webCuts } from "../media";
import type { ProblemPage } from "../types";

const MODEL = "Claude Code with Opus, on a Claude plan";

const MS_LABELS = { label: "Microsoft Support: Create and print mailing labels for an address list in Excel", href: "https://support.microsoft.com/topic/d9484315-5123-48ae-bc58-2e8dcf271252" };
const MS_PRINT_LABELS = { label: "Microsoft Support: Print labels for your mailing list", href: "https://support.microsoft.com/kb/294684" };

export const PRINTING_LABELS_PAGES: ProblemPage[] = [
  {
    slug: "print-address-labels-from-excel",
    niche: "printing-labels",
    searchPhrases: ["how to print labels from excel", "print address labels from excel", "avery 5160 template", "print mailing labels from excel", "address labels from spreadsheet"],
    title: "Print address labels from Excel on Avery 5160 sheets",
    description:
      "Turn an address spreadsheet into labels that line up on Avery 5160 sheets, ZIP codes and all: Word's mail merge step by step, or Stella (stella.sh) on your computer.",
    h1: "Print address labels from Excel on Avery 5160 sheets",
    short: "Address labels from Excel",
    lede: "48 addresses from a card list on two label sheets, in list order, every ZIP intact.",
    answer:
      "The usual route is a mail merge: in Word choose Mailings, Start Mail Merge, Labels, pick Avery US Letter 5160, use your spreadsheet as the recipient list, untick anyone you're skipping, insert an address block and finish the merge. Format the ZIP column as text first, or East Coast ZIPs lose their leading zero. Stella (stella.sh) reads the spreadsheet on your computer and writes a print-ready PDF laid out on the 5160 grid, with the zeros put back.",
    stellaSteps: [
      "Finds `Holiday card list 2026.xlsx` in Documents and keeps the 48 rows marked Yes, in the list's own order",
      "Leaves out the four people marked No and names them",
      "Spots New England and New Jersey ZIP codes that Excel was showing with a leading zero only through cell formatting, and prints them as five digits (2806 becomes 02806)",
      "Lays the addresses out on the 5160 grid (3 across, 10 down, 2⅝ × 1 in labels): one full sheet and 18 labels on a second",
      "Saves `Holiday card labels 2026 - Avery 5160.pdf` next to the spreadsheet and says to print at 100% with a plain-paper test sheet first",
    ],
    prompt:
      "I need to print address labels for our holiday cards from the spreadsheet in my Documents, for everyone marked Yes. Make them for Avery 5160 label sheets, in the same order as the list.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "Two label sheets in about a minute and a half. Checked afterwards against an answer key written before the run: US Letter pages, all 48 Yes addresses each on exactly one label, every line (name, street, apartment, city, state, ZIP) inside its 5160 label, list order kept, leading zeros kept, no blank-apartment junk like “None”, nobody marked No, and the spreadsheet unchanged.",
      note: "The names and addresses are made up for this run. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/printing-labels/print-address-labels-from-excel/proof.mp4`,
        cuts: webCuts("printing-labels/print-address-labels-from-excel"),
        poster: `${PROOFS}/printing-labels/print-address-labels-from-excel/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 42.63,
        realDuration: 94.5,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. The holiday card list spreadsheet is in Documents." },
        { at: 2, text: "The prompt: labels for everyone marked Yes, on Avery 5160 sheets, in list order." },
        { at: 10.4, text: "Stella replies: a print-ready PDF in list order, and it will point out anything odd in the addresses." },
        { at: 16.3, text: "Reading the list and laying out the labels, sped up 4×." },
        { at: 28.6, text: "Done: 48 labels on two sheets, leading zeros put back on ZIP codes, four No rows left out." },
      ],
    },
    manualTitle: "Print them yourself",
    manualSteps: [
      {
        title: "Fix the ZIP column first",
        body: "In Excel, select the ZIP column and look at what's really in a cell: if 02806 shows in the sheet but 2806 in the formula bar, the zero is only formatting and a merge will drop it. Add a column with `=TEXT(F2,\"00000\")`, fill it down, then copy and Paste Values over the ZIPs.",
      },
      {
        title: "Start a label merge in Word",
        body: "Word on Windows or Mac: Mailings, Start Mail Merge, Labels. Under Label vendors choose Avery US Letter and pick 5160 Address Labels. Then Select Recipients, Use an Existing List, and open the spreadsheet.",
      },
      {
        title: "Pick who gets a label",
        body: "Edit Recipient List and untick the rows marked No, or use Filter on the Send card column. Keep the sort as it is if you want the labels in list order; Word fills each sheet across, then down.",
      },
      {
        title: "Insert the address and merge",
        body: "Click Address Block (or insert the Name, Street, City, State and ZIP fields yourself), then Update Labels so every label gets the same layout. Finish & Merge, Edit Individual Documents, and check that apartments and ZIPs look right.",
      },
      {
        title: "Test on plain paper",
        body: "Print the first page at 100% (no Fit to page) on plain paper, hold it against a label sheet up to a light, and only then load the labels. Printers can shift a millimetre or two.",
      },
    ],
    limits: [
      "Stella makes the PDF. It doesn't print it unless you ask it to send the file to your printer.",
      "Printers shift slightly. Print one sheet on plain paper and hold it over a label sheet before using the real labels.",
      "The names and addresses go to the AI model you use in Stella while it reads the list. The PDF is written on your computer and nothing is uploaded to a label website.",
      "It works from what's in the sheet: a misspelled street or a wrong ZIP is printed as typed. Stella flags blanks and duplicates but doesn't check addresses against the postal service.",
      "Recorded on Linux, where Stella used Python and small spreadsheet and PDF libraries it installed. On a Mac or Windows PC it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What size is an Avery 5160 label?",
        a: "2⅝ × 1 inches, 30 to a US Letter sheet in 3 columns and 10 rows, with a ½ inch top margin. Many other brands sell the same layout as “5160 compatible”.",
      },
      {
        q: "Why did my ZIP codes lose the zero?",
        a: "Excel stores 02806 as the number 2806 unless the cell is text. A custom 00000 format only hides that, so mail merges and exports print four digits. Convert the column to text first, or let Stella put the zeros back.",
      },
      {
        q: "Can I print envelopes instead?",
        a: "Yes: see [print envelopes from Excel](/how/printing-labels/print-envelopes-from-excel), one per household with your return address. For letters to everyone on the list, see [mail merge from Excel to Word](/how/documents/mail-merge-excel-to-word).",
      },
      {
        q: "Can it do return address labels or other sheet sizes?",
        a: "Yes: name the sheet's product number (5160, 5163, 8160 and so on) or its measurements. For product labels with barcodes, see [barcode labels from Excel](/how/printing-labels/make-barcode-labels-from-excel).",
      },
    ],
    related: ["printing-labels/print-envelopes-from-excel", "printing-labels/make-barcode-labels-from-excel", "printing-labels/make-name-tags-from-a-list", "documents/mail-merge-excel-to-word"],
    lastChecked: "2026-11-14",
    sources: [
      MS_LABELS,
      MS_PRINT_LABELS,
      { label: "Apple Support: Print mailing labels, envelopes, and contact lists in Contacts on Mac", href: "https://support.apple.com/guide/contacts/adrbab40ca1d/mac" },
    ],
  },
  {
    slug: "print-envelopes-from-excel",
    niche: "printing-labels",
    searchPhrases: ["how to print envelopes from excel", "how to print addresses on envelopes", "addressing envelopes", "mail merge envelopes", "how to print envelopes"],
    title: "Print envelopes from Excel: one per household, return address",
    description:
      "Print wedding or holiday envelopes straight from a guest list, one per household, return address top left: Word's envelope merge step by step, or Stella (stella.sh).",
    h1: "Print envelopes from an Excel guest list, one per household",
    short: "Envelopes from Excel",
    lede: "68 guests on a list as 31 A7 envelopes, one per household, return address on each.",
    answer:
      "Make a copy of the guest list with one row per household (Data, Remove Duplicates on the envelope name and address), then in Word use Mailings, Start Mail Merge, Envelopes, pick the envelope size, type your return address, use the spreadsheet as the list, insert the address and finish the merge. Stella (stella.sh) does it from the guest list on your computer and writes a PDF with one envelope-sized page per household.",
    stellaSteps: [
      "Finds `Wedding guest list.xlsx` in Documents: 68 guests, one row each, with the household's envelope name and address repeated on every row",
      "Groups the guests into 31 households, keeping two families who share a surname but live at different addresses apart, and counting a guest listed twice once",
      "Puts back the leading zero on Massachusetts, Vermont and Connecticut ZIP codes that the spreadsheet had dropped",
      "Makes one 7.25 × 5.25 in (A7) landscape page per household, in list order, with the name and address centred and the couple's return address in the top left",
      "Saves `Wedding envelopes - A7.pdf` in Documents, suggests dropping “and Guest” from six outer envelopes, and says to print at actual size with one test envelope first",
    ],
    prompt:
      "We're mailing our wedding invitations in A7 envelopes. From the guest list in my Documents, make a file I can print straight onto the envelopes, one per household, with our return address in the top left: Priya Nandakumar & Theo Marsh, 418 Alder Creek Road, Bellmont, OR 97321.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "31 envelopes in under two minutes. Checked afterwards against an answer key written before the run: every page A7 size in landscape, exactly one envelope for each of the 31 households and none per guest, name, street and city, state and ZIP (leading zero kept) on each, the address in the middle, the return address in the top-left corner of every envelope, the list's order kept, and the guest list unchanged.",
      note: "The couple, guests and addresses are made up for this run. No envelopes were printed, so how a particular printer feeds them wasn't tested. The work is sped up 5×.",
      video: {
        src: `${PROOFS}/printing-labels/print-envelopes-from-excel/proof.mp4`,
        cuts: webCuts("printing-labels/print-envelopes-from-excel"),
        poster: `${PROOFS}/printing-labels/print-envelopes-from-excel/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 42.57,
        realDuration: 105.0,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. The wedding guest list is in Documents." },
        { at: 2, text: "The prompt: A7 envelopes, one per household, with the couple's return address top left." },
        { at: 11.2, text: "Stella replies: it will combine guests into households and make a print-ready A7 file." },
        { at: 17, text: "Grouping households and laying out the envelopes, sped up 5×." },
        { at: 28.6, text: "Done: 31 envelopes, ZIP zeros put back, with a note on six “and Guest” envelopes." },
      ],
    },
    manualTitle: "Print them yourself",
    manualSteps: [
      {
        title: "One row per household",
        body: "Copy the guest sheet to a new tab. Select it and use Data, Remove Duplicates, ticking the envelope name and street columns, so a family of four becomes one row. Check families with the same surname at different addresses are still separate.",
      },
      {
        title: "Keep ZIP codes as five digits",
        body: "If a ZIP like 02134 shows as 2134 in the formula bar, add a column with `=TEXT(F2,\"00000\")`, fill it down and Paste Values over the ZIPs, or the merge prints four digits.",
      },
      {
        title: "Set up the envelope merge in Word",
        body: "Mailings, Start Mail Merge, Envelopes. Choose the size (A7 is 7¼ × 5¼ in; a #10 business envelope is 9½ × 4⅛ in) and type your return address. Then Select Recipients, Use an Existing List, open the household tab, and insert the name and address fields in the middle box.",
      },
      {
        title: "Test one envelope, then print",
        body: "Finish & Merge, Edit Individual Documents. Print the first page on one envelope, or on paper cut to size, to learn which way up and which flap side your printer wants. Print the rest at 100%, a few at a time.",
      },
    ],
    limits: [
      "Printers feed envelopes differently (face up or down, flap left or right) and some can't take thick ones. Test with one envelope first.",
      "Stella decides what a household is from the names and addresses in the list and says how it grouped them; check its notes before printing 31 envelopes.",
      "Names and addresses go to the AI model you use in Stella while it reads the list. The PDF is made on your computer.",
      "It makes the file; it doesn't print it unless you ask. It also doesn't change etiquette like “and Guest” unless you tell it to.",
      "Recorded on Linux, where Stella used Python and a browser already on the computer to write the PDF. On a Mac or Windows PC it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What size is an A7 envelope?",
        a: "7¼ × 5¼ inches, the usual envelope for 5 × 7 invitations. Name your envelope's size or give its measurements and the pages are made to match.",
      },
      {
        q: "Should the return address be on the front or the back flap?",
        a: "Either is accepted for mail in the US; top left on the front is easiest to print. For the back flap, ask for a separate pass that prints only the return address.",
      },
      {
        q: "Can I print address labels instead?",
        a: "Yes: see [address labels from Excel](/how/printing-labels/print-address-labels-from-excel) for Avery 5160 sheets.",
      },
      {
        q: "What else can it make from the guest list?",
        a: "The headcount, seating chart and place cards: see [count wedding RSVPs](/how/weddings-events/count-wedding-rsvps) and [make a wedding seating chart](/how/weddings-events/make-wedding-seating-chart).",
      },
    ],
    related: ["printing-labels/print-address-labels-from-excel", "weddings-events/count-wedding-rsvps", "documents/mail-merge-excel-to-word"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Microsoft Support: Mail merge with envelopes", href: "https://support.microsoft.com/en-us/word/mail-merge-with-envelopes" },
      { label: "Microsoft Support: Filter for unique values or remove duplicate values", href: "https://support.microsoft.com/en-us/office/filter-for-unique-values-or-remove-duplicate-values-ccf664b0-81d6-449b-bbe1-8daaec1e83c2" },
    ],
  },
  {
    slug: "make-name-tags-from-a-list",
    niche: "printing-labels",
    searchPhrases: ["how to make name tags", "name badge template", "name tag template", "conference name badges", "name tags from excel"],
    title: "Make name tags from a registration list (Avery 5395)",
    description:
      "Turn an event sign-up export into name badges for Avery 5395 sheets: duplicates merged, cancellations out, accents right. Word's merge, or Stella (stella.sh).",
    h1: "Make name tags from a registration list",
    short: "Name tags from a list",
    lede: "43 sign-ups, duplicates and cancellations among them, as 37 badges on five sheets.",
    answer:
      "Clean the list first: delete cancellations and remove duplicate sign-ups by email, then run a label mail merge in Word with Avery US Letter 5395 Name Badges, the first name in a big font and the last name and company below. Check accented names in the preview. Stella (stella.sh) does the cleaning and the layout from the export on your computer and writes a print-ready PDF on the 5395 grid.",
    stellaSteps: [
      "Reads `Fall Summit registrations.csv` in Downloads: 43 sign-ups",
      "Leaves out three cancellations and merges three people who signed up twice, keeping the properly capitalised entry when one copy was typed in lower case",
      "Keeps people who share a first or last name apart, since each has their own email and company",
      "Lays 37 badges on five Avery 5395 sheets (8 per sheet, 2 across and 4 down), first name large, last name and company underneath, with a font that prints Zoë, Siobhán, Łukasz and Thảo correctly",
      "Prints “Independent” where the sheet said “self-employed”, says so, and offers to change it or add a Speaker tag",
    ],
    prompt:
      "Make name badges for everyone coming to our Fall Summit from the registrations file in my Downloads, to print on Avery 5395 sticker sheets. First name big, with their last name and company underneath. Skip anyone who cancelled, and a few people signed up twice.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "37 badges on five sheets in about two and a half minutes. Checked afterwards against an answer key written before the run: US Letter pages, every confirmed person on exactly one badge inside a 5395 position, company on each, first name bigger than the company line, accented names spelled right, no cancellations, nothing printed outside the badges, names capitalised, and the CSV unchanged.",
      note: "The attendees and companies are made up for this run. On seven badges the company line reads “Independent” where the list said “self-employed”; Stella said so and offered to switch it back. The work is sped up 8×.",
      video: {
        src: `${PROOFS}/printing-labels/make-name-tags-from-a-list/proof.mp4`,
        cuts: webCuts("printing-labels/make-name-tags-from-a-list"),
        poster: `${PROOFS}/printing-labels/make-name-tags-from-a-list/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 45.63,
        realDuration: 148,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. The Fall Summit registrations export is in Downloads." },
        { at: 2, text: "The prompt: badges for Avery 5395, first name big, skip cancellations and double sign-ups." },
        { at: 12.8, text: "Stella replies: it will lay the badges out for 5395 sheets and list who was dropped." },
        { at: 18.7, text: "Cleaning the list and laying out the sheets, sped up 8×." },
        { at: 31.6, text: "Done: 37 badges on 5 sheets, 3 cancellations and 3 double sign-ups left out, print at 100%." },
      ],
    },
    manualTitle: "Make the badges yourself",
    manualSteps: [
      {
        title: "Clean the sign-up list",
        body: "Open the export in Excel. Filter the Status column and delete the cancelled rows. Then select the table and use Data, Remove Duplicates, ticking only Email, so someone who registered twice keeps one row. Fix any names typed in lower case.",
      },
      {
        title: "Save it so accents survive",
        body: "If the list is a CSV, save it as an Excel workbook (.xlsx) before merging. Word sometimes reads CSV files in the wrong encoding, which turns Zoë into ZoÃ«.",
      },
      {
        title: "Merge onto badge labels",
        body: "In Word: Mailings, Start Mail Merge, Labels, Avery US Letter, 5395 Name Badges. Select Recipients, Use an Existing List, open the workbook. In the first badge insert First name on its own line in a large size, then Last name and Company smaller, and click Update Labels.",
      },
      {
        title: "Preview, merge and test",
        body: "Preview Results and page through looking for long company names that wrap and for broken accents. Finish & Merge, then print page one on plain paper at 100% and hold it against a badge sheet before printing the rest.",
      },
    ],
    limits: [
      "Stella decides what counts as a duplicate (same email here) and says who it merged. If two people share one email, check its list before printing.",
      "Very long names or company names are made smaller to fit, so a few badges may have smaller text than the rest.",
      "Attendee names, emails and companies go to the AI model you use in Stella while it reads the export. The badge file is made on your computer.",
      "It makes the PDF; it doesn't print it unless you ask. Print one plain-paper test sheet first.",
      "Recorded on Linux, where Stella installed a small PDF library for Python and used a font that has the accented letters. On a Mac or Windows PC it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What size is an Avery 5395 name badge?",
        a: "3⅜ × 2⅓ inches, 8 per US Letter sheet in 2 columns and 4 rows. Other brands sell sticker badges in the same layout.",
      },
      {
        q: "Can it make badges for insert holders instead of stickers?",
        a: "Yes: give the holder's card size (4 × 3 in is common) and it lays them out on plain card stock with cut lines.",
      },
      {
        q: "Can it add a role, ticket type or QR code to each badge?",
        a: "Yes, from any column in the list: ask for a Speaker tag, a coloured band per ticket type, or a QR code. See [make QR codes in bulk](/how/printing-labels/make-qr-codes-in-bulk).",
      },
      {
        q: "What about certificates for the same people afterwards?",
        a: "See [certificates from Excel](/how/printing-labels/make-certificates-from-excel): one page per person, from the same kind of list.",
      },
    ],
    related: ["printing-labels/make-certificates-from-excel", "printing-labels/print-address-labels-from-excel", "pdf-excel/remove-duplicate-rows-in-excel"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Microsoft Support: Filter for unique values or remove duplicate values", href: "https://support.microsoft.com/en-us/office/filter-for-unique-values-or-remove-duplicate-values-ccf664b0-81d6-449b-bbe1-8daaec1e83c2" },
      MS_PRINT_LABELS,
    ],
  },
  {
    slug: "make-certificates-from-excel",
    niche: "printing-labels",
    searchPhrases: ["how to generate certificates from excel", "bulk certificate generator", "certificate maker", "certificate generator", "create certificates from excel"],
    title: "Make certificates from Excel: one page per person, in bulk",
    description:
      "Make a certificate for everyone who passed, each with their own name and completion date, from your results spreadsheet: Word's mail merge, or Stella (stella.sh).",
    h1: "Generate certificates from an Excel list, one per person",
    short: "Certificates from Excel",
    lede: "A results sheet of 26 people as 22 landscape certificates, only the ones who passed.",
    answer:
      "In Word, design one landscape certificate, start a Letters mail merge with your spreadsheet as the recipient list, filter it to the people who passed, insert the name and date fields, and finish the merge into one document. Names stored as “Last, First” and Excel dates need fixing first. Stella (stella.sh) reads the results sheet on your computer and writes one PDF with a certificate per person who passed.",
    stellaSteps: [
      "Finds `First aid course results.xlsx` in Documents, with the course name and instructor in rows above the table",
      "Keeps the 22 people marked Pass, and leaves out three fails and one Incomplete, naming each and why",
      "Turns names stored as “Last, First” round, and reads each person's own completion date from the Excel dates",
      "Designs a landscape certificate with the name as the largest text, the course “Community First Aid & CPR (Level 1)”, the date, the session line and a signature space for the instructor",
      "Writes all 22 into `First aid certificates.pdf` next to the spreadsheet, one per page",
    ],
    prompt:
      "Make a certificate of completion for everyone who passed the first aid course, using the results spreadsheet in my Documents. Landscape, one per page, with their name, the course name and the date they finished.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "22 certificates in about 75 seconds. Checked afterwards against an answer key written before the run: one landscape page for each person who passed, nobody else, the name as the main text written First Last, the course name and each person's own completion date on every page, no extra pages, and the spreadsheet unchanged.",
      note: "The course, people and scores are made up for this run. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/printing-labels/make-certificates-from-excel/proof.mp4`,
        cuts: webCuts("printing-labels/make-certificates-from-excel"),
        poster: `${PROOFS}/printing-labels/make-certificates-from-excel/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 41.37,
        realDuration: 73,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. The first aid course results spreadsheet is in Documents." },
        { at: 2, text: "The prompt: a landscape certificate for everyone who passed, with name, course and date." },
        { at: 10, text: "Stella replies: one page per person who passed, in a single PDF next to the spreadsheet." },
        { at: 15.9, text: "Reading the results and making the certificates, sped up 3×." },
        { at: 27.4, text: "Done: 22 certificates; three fails and one incomplete left out, each named." },
      ],
    },
    manualTitle: "Make them yourself",
    manualSteps: [
      {
        title: "Tidy the spreadsheet",
        body: "Put the table's headers in row 1 (delete title rows above it). If names are “Last, First”, add a column with `=TRIM(MID(A2,FIND(\",\",A2)+1,99))&\" \"&LEFT(A2,FIND(\",\",A2)-1)` and fill it down. Filter the Result column to Pass.",
      },
      {
        title: "Design one certificate in Word",
        body: "New document, Layout, Orientation, Landscape. Lay out the title, a placeholder line for the name in a large font, the course name, a date line and a signature line. Keep it to one page.",
      },
      {
        title: "Merge the names and dates",
        body: "Mailings, Start Mail Merge, Letters. Select Recipients, Use an Existing List, pick the spreadsheet, and in Edit Recipient List filter to Pass. Insert the name field and the date field. To stop dates showing as 10/17/2026 0:00, press Alt+F9 and add `\\@ \"MMMM d, yyyy\"` inside the date field.",
      },
      {
        title: "Finish and save as PDF",
        body: "Finish & Merge, Edit Individual Documents, All. Page through to check long names fit, then save as PDF. Each record lands on its own page.",
      },
    ],
    limits: [
      "The design is clean and simple. For your organisation's look, give Stella a template, a logo file or a description of the style.",
      "It follows the sheet: if someone's result or date is wrong there, the certificate is wrong too. Stella lists who was left out and why so you can check.",
      "Names, results and dates go to the AI model you use in Stella while it reads the sheet. The certificates are made on your computer.",
      "It doesn't sign or print them unless asked. The signature line is left blank for the instructor.",
      "Recorded on Linux, where Stella used Python, a small spreadsheet library it installed, and a browser already on the computer to write the PDF. On a Mac or Windows PC it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can I use my own certificate template?",
        a: "Yes. Give Stella a Word, PowerPoint or PDF template and say where the name and date go; it fills in a copy per person.",
      },
      {
        q: "Can it make a separate PDF for each person to email?",
        a: "Yes, ask for one file per person named after them. Stella doesn't send emails unless you ask it to with your own email set up.",
      },
      {
        q: "Can it add a certificate number or QR code?",
        a: "Yes, numbered in order or from a column. For QR codes on their own, see [make QR codes in bulk](/how/printing-labels/make-qr-codes-in-bulk).",
      },
      {
        q: "Is this the same as a mail merge?",
        a: "It gives the same result as a Word mail merge without the setup. For letters, see [mail merge from Excel to Word](/how/documents/mail-merge-excel-to-word).",
      },
    ],
    related: ["documents/mail-merge-excel-to-word", "printing-labels/make-name-tags-from-a-list", "pdf-excel/fix-dates-in-excel"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Microsoft Support: Use mail merge to send bulk email, letters, labels and envelopes", href: "https://support.microsoft.com/en-us/word/use-mail-merge-for-bulk-email-letters-labels-and-envelopes" },
      MS_LABELS,
    ],
  },
  {
    slug: "make-qr-codes-in-bulk",
    niche: "printing-labels",
    searchPhrases: ["bulk qr code generator", "generate multiple qr codes", "qr code from excel", "print qr codes", "qr code generator multiple"],
    title: "Bulk QR code generator: a QR image per link in a spreadsheet",
    description:
      "Make a QR code image for every link in a spreadsheet, each named after its item, with no sign-up and no expiring codes: by hand, Word, or Stella (stella.sh).",
    h1: "Make a QR code for every link in a spreadsheet, in bulk",
    short: "QR codes in bulk",
    lede: "22 product links as 22 QR images named after their items, every link fixed first.",
    answer:
      "There's no bulk QR maker built into Windows or macOS: browsers make one code for the page you're on, Word for Windows can put codes in a mail merge, and online bulk generators often want an account or make “dynamic” codes that stop working when a subscription ends. Stella (stella.sh) reads the spreadsheet on your computer and saves a plain QR image per link, named after the item, checking each one scans to the right address.",
    stellaSteps: [
      "Finds `Shop product links.xlsx` in Documents: 24 items with names, SKUs and product page links",
      "Adds https:// to two links that lacked it and trims trailing spaces from another, so phones open the page instead of showing text",
      "Skips two items with no link and names them",
      "Saves 22 QR images in a new `Product tag QR codes` folder, each named after its item, with characters that file names can't hold replaced (Planter 6\" becomes Planter 6 in)",
      "Scans every image back to confirm it gives the exact link, writes a list of item, SKU, link and file name, and points out two items that may not need tags",
    ],
    prompt:
      "Make a QR code for every product link in the spreadsheet in my Documents, each saved as its own image named after the item, so I can print them on our product tags.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "22 QR images in about 85 seconds. Checked afterwards against an answer key written before the run: one image for each of the 22 links, each decoding to exactly that link with https:// and no stray spaces, each file named after its item, no codes for the two items without a link, and the spreadsheet unchanged.",
      note: "The shop, items and links are made up for this run, so the pages behind the links don't exist; the check scanned the codes, not the pages. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/printing-labels/make-qr-codes-in-bulk/proof.mp4`,
        cuts: webCuts("printing-labels/make-qr-codes-in-bulk"),
        poster: `${PROOFS}/printing-labels/make-qr-codes-in-bulk/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 43.77,
        realDuration: 84.5,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A spreadsheet of product links is in Documents." },
        { at: 2, text: "The prompt: a QR code per product link, each image named after its item." },
        { at: 11.2, text: "Stella replies: print-ready codes in a folder, with any skipped rows listed." },
        { at: 17.1, text: "Fixing the links, making and test-scanning the codes, sped up 3×." },
        { at: 29.8, text: "Done: 22 codes, two items without links skipped, two links given https://." },
      ],
    },
    manualTitle: "Make them yourself",
    manualSteps: [
      {
        title: "Clean the links",
        body: "In the spreadsheet, check every link starts with https:// and has no spaces at either end (`=TRIM(C2)` in a spare column, then paste values). A code made from a link without https:// may show as plain text instead of opening.",
      },
      {
        title: "One code at a time in a browser",
        body: "In Chrome or Edge, open the page, then use the share or address-bar menu and choose Create QR code, and download the image. Safari on a Mac and iPhone has a similar option under Share. Rename each download after its item.",
      },
      {
        title: "Or a mail merge in Word for Windows",
        body: "Start a Labels merge on your tag sheet, open the spreadsheet as recipients, press Ctrl+F9 in the first label and type `MERGEBARCODE Link QR` inside the braces (with your column's name), then Update Labels and finish. This prints codes on a sheet but doesn't save separate images.",
      },
      {
        title: "Test before printing a batch",
        body: "Print one code at the size you'll use and scan it with a phone camera from a normal distance. Around 2 cm (¾ in) square is a safe minimum on a home printer.",
      },
    ],
    limits: [
      "The codes are plain, static links: they never expire, but they can't be redirected later. If a page moves, make and print a new code.",
      "Stella checks each code scans to the link in the sheet. It doesn't check that the web page itself loads.",
      "It makes codes for every row with a link, so rows like gift cards get one too; Stella flags those, and you delete what you don't need.",
      "The links and item names go to the AI model you use in Stella. The images are made on your computer, with no QR website involved.",
      "Recorded on Linux, where Stella installed small Python libraries to read the spreadsheet and draw the codes. On a Mac or Windows PC it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Do these QR codes expire?",
        a: "No. They hold the link itself, so they work as long as the page exists. Codes that expire are “dynamic” codes from services that route the scan through their own server.",
      },
      {
        q: "What file type and size are the images?",
        a: "PNG images, large enough to print cleanly at a few centimetres. Ask for SVG if a print shop or design program wants vector files.",
      },
      {
        q: "Can I get them on a printable sheet of labels?",
        a: "Yes, ask for them laid out on your label sheet with the item name under each code, as in [barcode labels from Excel](/how/printing-labels/make-barcode-labels-from-excel).",
      },
      {
        q: "Can a QR code hold something other than a web link?",
        a: "Yes: Wi-Fi details, a contact card, a phone number or plain text. Say what each row should hold.",
      },
    ],
    related: ["printing-labels/make-barcode-labels-from-excel", "printing-labels/make-name-tags-from-a-list", "documents/mail-merge-excel-to-word"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Microsoft Support: Field codes: MergeBarcode", href: "https://support.microsoft.com/en-us/word/field-codes-mergebarcode" },
    ],
  },
  {
    slug: "make-barcode-labels-from-excel",
    niche: "printing-labels",
    searchPhrases: ["print barcode labels from excel", "barcode labels", "shelf labels", "price labels", "barcode generator"],
    title: "Print barcode labels from Excel that scan (Avery 5160)",
    description:
      "Make shelf labels with product name, price and a UPC barcode that scans, from a stock spreadsheet, leading zeros kept: Word's barcode field, or Stella (stella.sh).",
    h1: "Print barcode labels from Excel with name and price",
    short: "Barcode labels from Excel",
    lede: "36 products as shelf labels with name, price and a barcode that scans, zeros kept.",
    answer:
      "Word for Windows can draw barcodes in a label mail merge with its MERGEBARCODE field; Word for Mac can't, so Mac users need a barcode font or a label program. Either way, set the UPC column to text first: Excel drops the leading zero, and a barcode of the shorter number scans as a different product. Stella (stella.sh) reads the stock sheet on your computer, restores the zeros, and writes a label PDF with each barcode test-scanned.",
    stellaSteps: [
      "Finds `Pantry & Larder stock list.xlsx` in Documents: 36 products with SKU, name, UPC and price",
      "Notices 22 UPCs that had lost their leading zero because Excel stored them as numbers, and puts the zeros back before making barcodes",
      "Lays out one label per product on Avery 5160 sheets: product name, price, and a UPC barcode",
      "Scans every barcode in the finished file to confirm it reads as the right code",
      "Saves `Pantry & Larder shelf labels (Avery 5160).pdf` next to the stock list: one full sheet of 30 and six labels on a second",
    ],
    prompt:
      "Make shelf labels for every product in my stock spreadsheet in Documents, with the product name, the price and a barcode that scans, laid out for Avery 5160 label sheets.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "36 labels on two sheets in about two minutes. Checked afterwards against an answer key written before the run: US Letter pages, every product's barcode scanning as its 12-digit UPC with the leading zero inside its 5160 label, name and price on the same label, one label per product, nothing outside the labels, and the spreadsheet unchanged.",
      note: "The shop and products are made up for this run, with valid UPC check digits. The barcodes were scanned from the PDF by software, not with a handheld scanner. The work is sped up 6×.",
      video: {
        src: `${PROOFS}/printing-labels/make-barcode-labels-from-excel/proof.mp4`,
        cuts: webCuts("printing-labels/make-barcode-labels-from-excel"),
        poster: `${PROOFS}/printing-labels/make-barcode-labels-from-excel/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 45,
        realDuration: 124.6,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A stock spreadsheet is in Documents." },
        { at: 2, text: "The prompt: shelf labels with name, price and a barcode that scans, for Avery 5160." },
        { at: 12, text: "Stella replies: it will use the sheet's UPCs and test that every barcode scans." },
        { at: 17.8, text: "Reading the stock list, making and checking the labels, sped up 6×." },
        { at: 31, text: "Done: 36 labels on two pages, leading zeros restored on 22 codes, every barcode test-scanned." },
      ],
    },
    manualTitle: "Make them yourself",
    manualSteps: [
      {
        title: "Turn the UPCs into text",
        body: "In Excel, add a column with `=TEXT(C2,\"000000000000\")` (twelve zeros for UPC-A), fill it down, then copy and Paste Values over the UPC column. A UPC like 003292694568 must stay twelve digits.",
      },
      {
        title: "Windows: merge with a barcode field",
        body: "In Word: Mailings, Start Mail Merge, Labels, Avery US Letter 5160. Open the stock sheet as recipients. In the first label insert the product name and price fields, then Ctrl+F9 and type `MERGEBARCODE UPC UPCA` inside the braces. Update Labels and Finish & Merge.",
      },
      {
        title: "Mac: use a barcode font or label program",
        body: "Word for Mac has no barcode field. Install a UPC barcode font and format the merged UPC field with it (most UPC fonts need the digits encoded first), or use the label maker's own online designer, which reads a spreadsheet.",
      },
      {
        title: "Scan one before printing all",
        body: "Print a test sheet at 100% on plain paper and scan a few labels with your actual scanner or point-of-sale app. Small barcodes from inkjet printers sometimes need to be printed larger.",
      },
    ],
    limits: [
      "Stella makes barcodes from the codes you already have. It doesn't assign new UPCs; those come from GS1 if you sell through retailers.",
      "The barcodes were checked by scanning the PDF with software. Scan a printed label with your own scanner before printing them all.",
      "Product names, prices and codes go to the AI model you use in Stella. The labels are made on your computer.",
      "It makes the PDF; it doesn't print it unless you ask. Print at Actual size, not Fit to page, or the labels won't line up.",
      "Recorded on Linux, where Stella installed small Python libraries for the PDF and barcodes. On a Mac or Windows PC it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why won't my barcode scan as the right product?",
        a: "Usually a lost leading zero: 003292694568 stored as 3292694568 makes a different, shorter code. The other common cause is a barcode printed too small or squashed.",
      },
      {
        q: "Can it use Code 128 or my own SKUs instead of UPCs?",
        a: "Yes. Say which column and which barcode type; Code 128 suits internal SKUs with letters in them.",
      },
      {
        q: "Can I use other label sizes?",
        a: "Yes: name the sheet (5160, 5163, 5167) or give the measurements. For address labels from a list, see [address labels from Excel](/how/printing-labels/print-address-labels-from-excel).",
      },
      {
        q: "What about QR codes for product pages?",
        a: "See [make QR codes in bulk](/how/printing-labels/make-qr-codes-in-bulk), one image per link.",
      },
    ],
    related: ["printing-labels/print-address-labels-from-excel", "printing-labels/make-qr-codes-in-bulk", "printing-labels/make-packing-slips-from-orders"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Microsoft Support: Add barcodes to labels", href: "https://support.microsoft.com/en-us/word/add-barcodes-to-labels" },
      { label: "Microsoft Support: Field codes: MergeBarcode", href: "https://support.microsoft.com/en-us/word/field-codes-mergebarcode" },
    ],
  },
  {
    slug: "make-packing-slips-from-orders",
    niche: "printing-labels",
    searchPhrases: ["print packing slips", "packing slip template", "packing list template", "etsy packing slip", "packing slips from csv"],
    title: "Print packing slips for unshipped orders from an orders export",
    description:
      "Turn a shop's orders CSV into one packing slip per unshipped order, every item listed, no prices: by hand in Excel and Word, or Stella (stella.sh) on your computer.",
    h1: "Print packing slips for unshipped orders from your export",
    short: "Packing slips from orders",
    lede: "An orders export of 22 orders as 16 packing slips, one page each, ready to pack.",
    answer:
      "Your shop's admin usually prints packing slips for selected orders. From an exported CSV it's harder: each order spans one row per item and only the first row has the address, so you fill the order details down, filter to unfulfilled orders, and merge one page per order. Stella (stella.sh) reads the export on your computer and writes a PDF with a slip per unshipped order, every item and quantity on the right page.",
    stellaSteps: [
      "Finds `orders_export_1.csv` in Downloads: 22 orders spread over one row per line item, with the address only on each order's first row",
      "Groups the rows back into orders and keeps the 16 that haven't shipped, leaving out five already fulfilled",
      "Leaves out one unshipped order that was cancelled, and says so in case it should still go out",
      "Makes one page per order: the ship-to address in large type with ZIP codes cleaned of the export's stray apostrophe, and every item with a checkbox, quantity and product code, no prices",
      "Puts customer notes, such as a gift order asking for no receipt, in a box on that order's slip, and saves `packing-slips-unshipped.pdf` in Downloads",
    ],
    prompt:
      "Make packing slips for the orders in my Downloads that haven't shipped yet, one page per order, with the ship-to address and what to pack.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "16 packing slips in about a minute and a half. Checked afterwards against an answer key written before the run: a slip for each unshipped order with order number, name, street, city and ZIP with its leading zero, every item and quantity on the right slip and no other order's items, none for fulfilled or cancelled orders, no prices, the gift note shown, and the export unchanged.",
      note: "The shop, customers and orders are made up for this run, in the layout of a typical online-shop export. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/printing-labels/make-packing-slips-from-orders/proof.mp4`,
        cuts: webCuts("printing-labels/make-packing-slips-from-orders"),
        poster: `${PROOFS}/printing-labels/make-packing-slips-from-orders/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 42.87,
        realDuration: 93.5,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A shop's orders export is in Downloads." },
        { at: 2, text: "The prompt: packing slips for orders that haven't shipped, one page each." },
        { at: 11.2, text: "Stella replies: it will pick out the unshipped orders and put each on its own page." },
        { at: 17, text: "Grouping the rows into orders and laying out the slips, sped up 4×." },
        { at: 28.8, text: "Done: 16 slips; shipped orders and one cancelled order left out; customer notes boxed." },
      ],
    },
    manualTitle: "Make them yourself",
    manualSteps: [
      {
        title: "Try your shop's own print button",
        body: "Most shop platforms can print packing slips for selected orders from the orders page. If that works for you, use it; the export route is for custom layouts, several shops at once, or when the built-in slip shows prices you don't want.",
      },
      {
        title: "Fill the order details down",
        body: "In Excel, select the order columns (name, address, status), Home, Find & Select, Go To Special, Blanks. Type `=` and press the up arrow, then Ctrl+Enter, so every item row carries its order's details. Copy and Paste Values to keep them.",
      },
      {
        title: "Keep the unshipped orders",
        body: "Filter the fulfilment status column to unfulfilled and the order status to exclude cancelled. Strip any apostrophe in front of ZIP codes with Find and Replace.",
      },
      {
        title: "One page per order",
        body: "Word's mail merge makes one page per row, not per order, so either use a Directory merge grouped by order number or make a pivot table of items per order and print with a page break per order (PivotTable Options, Print, page breaks between items).",
      },
    ],
    limits: [
      "Stella works from the export. It doesn't mark orders as shipped or buy shipping labels in your shop.",
      "Customer names, addresses and order lines go to the AI model you use in Stella while it reads the export. The slips are made on your computer.",
      "It follows the export's status columns. An order fulfilled after you exported still gets a slip, so export just before you pack.",
      "It makes the PDF; it doesn't print it unless you ask.",
      "Recorded on Linux, where Stella used Python and a browser already on the computer to write the PDF. On a Mac or Windows PC it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can I add my logo and a thank-you note?",
        a: "Yes, point Stella at the logo file and give the wording; it goes on every slip.",
      },
      {
        q: "Can it make 4 × 6 slips for a label printer?",
        a: "Yes, ask for 4 × 6 inch pages instead of Letter. Thermal printers want black and white with no shading, so say so.",
      },
      {
        q: "Can it also make labels for the shelves or address labels?",
        a: "Yes: see [barcode labels from Excel](/how/printing-labels/make-barcode-labels-from-excel) and [address labels from Excel](/how/printing-labels/print-address-labels-from-excel).",
      },
      {
        q: "Can it make invoices instead of packing slips?",
        a: "Yes, with prices and totals. See [generate invoices from a spreadsheet](/how/documents/generate-invoices-from-spreadsheet).",
      },
    ],
    related: ["documents/generate-invoices-from-spreadsheet", "printing-labels/make-barcode-labels-from-excel", "printing-labels/print-address-labels-from-excel"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Microsoft Support: Fill data automatically in worksheet cells", href: "https://support.microsoft.com/en-us/excel/get-started/fill-data-automatically-in-worksheet-cells" },
      MS_LABELS,
    ],
  },
  {
    slug: "print-business-cards-at-home",
    niche: "printing-labels",
    searchPhrases: ["how to print business cards at home", "print business cards", "business card size", "print business cards double sided", "avery 8371 template"],
    title: "Print business cards at home, front and back lined up",
    description:
      "Lay out a card design 10 to a page on Avery 8371 sheets, backs on the next page so they line up double-sided: Word's label tool, or Stella (stella.sh).",
    h1: "Print business cards at home, front and back",
    short: "Business cards at home",
    lede: "One card design, front and back, laid out 10-up on perforated sheets that line up.",
    answer:
      "A business card is 3.5 × 2 inches. Perforated card sheets such as Avery 8371 hold ten on a Letter page; in Word, Mailings, Labels, Options, pick 8371, put your front image in the first card and choose Full page of the same label, then do the back as a second page. Print at Actual size and flip on the long edge. Stella (stella.sh) lays your front and back images onto the 8371 grid in one two-page PDF on your computer.",
    stellaSteps: [
      "Finds `card-front.png` and `card-back.png` in Downloads and checks they're 3.5 × 2 in at 300 dpi, so nothing needs resizing or cropping",
      "Places 10 fronts on page 1 on the 8371 grid, 0.75 in from the sides and 0.5 in from the top, with no gaps between cards",
      "Places 10 backs on page 2, swapped left to right so each lands behind its own front when printed double-sided",
      "Checks its layout against the card outlines from the sheet maker's template, and the backs against the fronts with page 2 flipped",
      "Saves `business-cards-avery-8371.pdf` in Downloads, with print settings: Actual size, flip on long edge, plain-paper test first",
    ],
    prompt:
      "My business card design is in Downloads, front and back. Lay it out on letter paper for Avery 8371 card sheets, 10 per page, with the backs on the next page so they line up when I print double-sided.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "A two-page print file in about two minutes. Checked afterwards against an answer key written before the run: a US Letter front page and back page in one PDF, 10 copies on each, every card exactly 3.5 × 2 in and not stretched, all 20 on the 8371 grid, and the design files unchanged.",
      note: "The card design is a made-up bookkeeping firm drawn for this run. Nothing was printed, so how well a particular printer lines up the two sides wasn't tested. The work is sped up 7×.",
      video: {
        src: `${PROOFS}/printing-labels/print-business-cards-at-home/proof.mp4`,
        cuts: webCuts("printing-labels/print-business-cards-at-home"),
        poster: `${PROOFS}/printing-labels/print-business-cards-at-home/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 44.43,
        realDuration: 126,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A business card front and back are in Downloads." },
        { at: 2.1, text: "The prompt: 10 per page on Avery 8371 sheets, backs on the next page, lined up for double-sided." },
        { at: 12.9, text: "Stella replies: fronts on page 1, matching backs on page 2, for flip on long edge." },
        { at: 18.7, text: "Laying out and checking the sheets, sped up 7×." },
        { at: 30.5, text: "Done: a two-page PDF, cards at full size on the 8371 grid, print at Actual size." },
      ],
    },
    manualTitle: "Lay them out yourself",
    manualSteps: [
      {
        title: "Get the design at the right size",
        body: "Export the front and back from your design program as 3.5 × 2 in images at 300 dpi (1050 × 600 pixels) or as PDFs at that size. A design with colour to the edge needs no bleed for these sheets, but keep text ⅛ in in from the edges.",
      },
      {
        title: "Set up the sheet in Word",
        body: "Mailings, Labels, Options. Choose Avery US Letter and 8371 Business Cards, click OK, choose Full page of the same label, then New Document. Click into the first card and insert the front image, sized to 3.5 × 2 in, and copy it into the other nine.",
      },
      {
        title: "Add the backs",
        body: "Make a second page the same way with the back image. On an 8371 sheet the cards sit symmetrically, so the same positions line up when the sheet is flipped on its long edge.",
      },
      {
        title: "Print a test, then the cards",
        body: "Print both pages double-sided on plain paper at Actual size or 100%, flip on long edge. Hold it to a light to see the backs behind the fronts, and over a card sheet to check the perforations, then print on the card stock.",
      },
    ],
    limits: [
      "Printers vary in how well they line the two sides up. Stella's layout is exact, but a sheet fed slightly off-centre shows a thin white sliver along one side of designs coloured to the edge.",
      "Stella lays out the design you give it; it doesn't design the card unless you ask, and then it's a simple layout, not a designer's work.",
      "The AI model you use in Stella sees the file names and sizes, and may look at the card images and the finished pages to check the layout. The PDF is made on your computer.",
      "It makes the PDF; it doesn't print it unless you ask. Choose the card stock or heavy paper setting on your printer.",
      "Recorded on Linux. Stella placed the images with tools already on the computer; on a Mac or Windows PC it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What size is a business card?",
        a: "3.5 × 2 inches in the US and Canada (88.9 × 50.8 mm). In Europe it's usually 85 × 55 mm; say which size and sheet you're using.",
      },
      {
        q: "Can I use a design from Canva or a PDF?",
        a: "Yes. Download the front and back at card size as PNG or PDF and put them in a folder Stella can see.",
      },
      {
        q: "My printer can't do double-sided. What then?",
        a: "Print page 1, put the sheet back in the paper tray turned over (your printer's manual shows which way), and print page 2. Test with plain paper first.",
      },
      {
        q: "Can it make flashcards the same way?",
        a: "Yes, fronts and backs that line up: see [print flashcards double-sided](/how/study/print-flashcards-double-sided).",
      },
    ],
    related: ["study/print-flashcards-double-sided", "printing-labels/make-name-tags-from-a-list", "printing-labels/print-poster-on-multiple-pages"],
    lastChecked: "2026-11-14",
    sources: [MS_PRINT_LABELS],
  },
  {
    slug: "print-passport-photos-at-home",
    niche: "printing-labels",
    searchPhrases: ["print passport photo at home", "passport photo size", "passport photo 4x6", "2x2 photo", "passport photo template"],
    title: "Print a US passport photo at home: 2x2 copies on one 4x6",
    description:
      "Size your own photo to the US 2 x 2 inch rules, head 1 to 1⅜ in, and lay copies on a 4x6 print for the drugstore. What the rules say, and Stella (stella.sh).",
    h1: "Print a passport photo at home: 2x2 copies on a 4x6",
    short: "Passport photos on a 4x6",
    lede: "A phone photo cropped to the US 2 × 2 inch rules, six copies on a 4 × 6 print.",
    answer:
      "A US passport photo is 2 × 2 inches with the head 1 to 1⅜ inches from chin to top of head, on a plain white or off-white background, taken in the last 6 months, unedited. Crop your photo to a square with the head that size, put copies on a 6 × 4 inch image and order it as a 4 × 6 print at a photo counter. Stella (stella.sh) does the crop and layout on your computer; it doesn't fix a photo that breaks the other rules.",
    stellaSteps: [
      "Uses `IMG_4471.jpg`, the only photo in Pictures, and says which file it used",
      "Measures the head and crops and scales the photo so the head is 1.2 in from chin to top of hair on a 2 × 2 in square, without stretching it or touching the background",
      "Looks for problems the State Department lists, such as glasses, shadows or a busy background, and finds none",
      "Lays six 2 × 2 in copies edge to edge on a 6 × 4 in, 600 dpi image with thin grey cut lines, and saves a single 2 × 2 copy as well",
      "Says to order a standard 4 × 6 print with no cropping, and that the 6-month and no-filters rules can't be checked from the file",
    ],
    prompt:
      "I need US passport photos. Use the photo in my Pictures and make a 4x6 print with 2x2 inch passport photos on it, sized correctly, so I can get it printed at the drugstore.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "A 4 × 6 print file with six copies in under two minutes. Checked afterwards against an answer key written before the run: a 6 × 4 in image, six copies, not stretched and fully on the print, the head 1.20 in from chin to top of hair (the rule is 1 to 1⅜ in), and the original photo unchanged. One optional check was missed: the size of each square on the sheet couldn't be measured automatically, because the photo's off-white wall runs right to the cut lines. The sheet is 3600 × 2400 pixels at 600 dpi in a 3 × 2 grid, so each copy works out to 2 in, and the separate single copy is exactly 1200 × 1200 pixels at 600 dpi.",
      note: "The portrait is a made-up person generated for this run, not a real applicant, so nothing was submitted to the State Department. Stella's reply said an application needs two photos; the State Department page asks for one with a paper application. The work is sped up 5×.",
      video: {
        src: `${PROOFS}/printing-labels/print-passport-photos-at-home/proof.mp4`,
        cuts: webCuts("printing-labels/print-passport-photos-at-home"),
        poster: `${PROOFS}/printing-labels/print-passport-photos-at-home/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 46.03,
        realDuration: 109,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. One portrait photo is in Pictures." },
        { at: 2, text: "The prompt: a 4x6 print of correctly sized 2x2 inch US passport photos." },
        { at: 13.6, text: "Stella replies: it will follow the State Department's head-size rules and look for common rejection reasons." },
        { at: 19.6, text: "Measuring the head, cropping and laying out the sheet, sped up 5×." },
        { at: 32, text: "Done: six 2x2 copies on a 4x6 sheet, plus a single copy; order with no cropping." },
      ],
    },
    manualTitle: "Make the print yourself",
    manualSteps: [
      {
        title: "Take a photo that meets the rules",
        body: "Stand several feet in front of a plain white or off-white wall, facing the camera, neutral expression, both eyes open, no glasses, even light with no shadows. Have someone else take it from 4 to 5 feet away, with no filters or beauty mode.",
      },
      {
        title: "Crop to a square with the right head size",
        body: "In Preview on a Mac (Tools, Adjust Size and the selection tool) or Photos on Windows, crop to a square so the head from chin to top of hair fills a bit over half the height: 1 to 1⅜ in of the 2 in square, so 50 to 69%. Keep the head centred.",
      },
      {
        title: "Put copies on a 6 × 4 image",
        body: "Make a 6 × 4 in canvas (1800 × 1200 pixels at 300 dpi) and paste the square at 2 × 2 in (600 × 600 pixels), as many times as fit. A free editor such as GIMP does this; Windows' Print Pictures wizard has a wallet layout but may crop.",
      },
      {
        title: "Order the print and check it",
        body: "Upload the 6 × 4 image to a drugstore photo counter as a 4 × 6 print, with auto-crop or fill turned off. When you collect it, measure one square with a ruler: exactly 2 in, head 1 to 1⅜ in. Cut carefully on the lines.",
      },
    ],
    limits: [
      "Stella only sizes and lays out the photo. The State Department also checks things a crop can't change: lighting, shadows, expression, a white or off-white background, no glasses, and a photo taken in the last 6 months.",
      "It doesn't retouch or replace the background, and you shouldn't: the State Department rejects photos changed with software, apps or filters. If the background or lighting is wrong, take a new photo.",
      "Printing on plain paper at home won't do: the photo must be on matte or glossy photo-quality paper with no visible printer dots. Order a 4 × 6 photo print, or use photo paper on a good photo printer.",
      "Online passport renewal uses an uploaded digital photo with its own requirements, which this run didn't check.",
      "Stella reads the photo to measure it, so the image goes to the AI model you use in Stella. The print file is made on your computer.",
      "Recorded on Linux, where Stella used Python tools already on the computer. On a Mac or Windows PC it may install Python and an image library first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What size is a US passport photo?",
        a: "2 × 2 inches (51 × 51 mm), with the head 1 to 1⅜ inches (25 to 35 mm) from the bottom of the chin to the top of the head, according to the State Department.",
      },
      {
        q: "How many photos do I need?",
        a: "One colour photo for a paper passport application or renewal, per the State Department. The extra copies on a 4 × 6 are spares.",
      },
      {
        q: "Can it make photos for other countries or visas?",
        a: "Yes, if you give the size and head rules, for example 35 × 45 mm for many European documents. Check the issuing country's official rules.",
      },
      {
        q: "Can I fit other photos on one print the same way?",
        a: "Yes: ask for any mix of sizes on one print. For several photos on letter pages, see [combine photos into one PDF](/how/photos-files/combine-photos-into-one-pdf).",
      },
    ],
    related: ["photos-files/combine-photos-into-one-pdf", "photos-files/resize-images-in-bulk", "printing-labels/print-poster-on-multiple-pages"],
    lastChecked: "2026-11-14",
    sources: [{ label: "U.S. Department of State: Passport Photos", href: "https://travel.state.gov/en/passports/apply/help/photos.html" }],
  },
  {
    slug: "print-poster-on-multiple-pages",
    niche: "printing-labels",
    searchPhrases: ["how to print a large image on multiple pages", "print poster on multiple pages", "print large image on multiple pages", "block poster", "rasterbator"],
    title: "Print a large image or poster on multiple pages to tape",
    description:
      "Print a poster at an exact size, like 24 inches wide, across letter pages with overlap to tape: Acrobat Reader's Poster option, or Stella (stella.sh) on your computer.",
    h1: "Print a large image or poster on multiple pages",
    short: "Poster on multiple pages",
    lede: "One image as a 24 × 36 inch poster on 15 letter pages that overlap for taping.",
    answer:
      "The free Acrobat Reader can tile a large PDF across ordinary pages: put the image in a PDF at the final size, then Print, Poster, with Tile Scale 100% and an overlap. Online poster splitters do it too, but you upload your image. Stella (stella.sh) makes the tiled PDF on your computer at the exact size you ask for, with overlaps, trim lines and a label on every page saying where it goes.",
    stellaSteps: [
      "Finds `garden-party-poster.png` in Pictures and scales it to 24 in wide, which makes it 36 in tall",
      "Splits it across 15 landscape letter pages, 3 across and 5 down, with about ½ in of overlap marked by a faint dashed line",
      "Labels every page with its row and column (R2C3 and so on) so they go together in order",
      "Tries to send it to the printer, as it said it would, finds no printer set up on this computer, and leaves the PDF ready instead",
      "Saves `garden-party-poster - 24in tiled (letter).pdf` in Pictures, with taping steps and a reminder to print at Actual size",
    ],
    prompt: "Print the poster in my Pictures 2 feet wide across regular letter-size pages, with a bit of overlap so I can tape them together.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "A 15-page tiled PDF in about a minute and a half. Checked afterwards against an answer key written before the run: US Letter pages that together print the whole poster 24.1 in wide (the key allows 3%), 99.8% of the image covered, every page a real piece of it with nothing stretched or blank, neighbouring pages overlapping by about 0.4 to 0.5 in, and the image unchanged.",
      note: "The poster was drawn for this run. The test computer had no printer, so nothing was printed; with a printer set up, Stella would have sent the file to it, because the prompt says “print”. The work is sped up 5×.",
      video: {
        src: `${PROOFS}/printing-labels/print-poster-on-multiple-pages/proof.mp4`,
        cuts: webCuts("printing-labels/print-poster-on-multiple-pages"),
        poster: `${PROOFS}/printing-labels/print-poster-on-multiple-pages/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 42.97,
        realDuration: 95.1,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A poster image is in Pictures." },
        { at: 2, text: "The prompt: print it 2 feet wide across letter pages, with overlap for taping." },
        { at: 12, text: "Stella replies: 24 inches wide, about ½ inch overlap, sent to the printer at actual size." },
        { at: 17.8, text: "Scaling and splitting the poster, sped up 5×." },
        { at: 28.9, text: "Done: no printer is set up, so the 15-page tiled PDF is left ready to print." },
      ],
    },
    manualTitle: "Tile it yourself",
    manualSteps: [
      {
        title: "Make a PDF at the final size",
        body: "The poster's shape decides its height: a 2:3 image 24 in wide is 36 in tall. Open the image in an editor, set the print size to 24 in wide (keep proportions), and export or print to PDF at that size. Many PDF printers let you choose a custom 24 × 36 in page.",
      },
      {
        title: "Use Acrobat Reader's Poster option",
        body: "Open the PDF in the free Acrobat Reader, Print, and under Page Sizing & Handling choose Poster. Set Tile Scale to 100%, Overlap to 0.25 in or more, and tick Cut marks and Labels. The preview shows how many pages it will use.",
      },
      {
        title: "Print at full size",
        body: "Print on Letter paper with no Fit to page anywhere else in the print settings. Home printers leave a blank margin round each page; the overlap is what hides it.",
      },
      {
        title: "Trim and tape",
        body: "Lay the pages out in order face down, trim the margin off one edge of each overlapping pair, line the pictures up face up, and tape along the back. Work row by row, then join the rows.",
      },
    ],
    limits: [
      "If you say “print” and a printer is set up, Stella may send the pages straight to it. Ask for “a PDF to print” if you want to check it first.",
      "Home printers can't print to the edge of the page, so you trim and overlap; a print shop can print the poster on one large sheet from the same image if you'd rather.",
      "A small or low-resolution image looks soft or blocky at poster size. Stella says how sharp it will be, but can't add detail that isn't there.",
      "The image stays on your computer for the tiling; the AI model sees file names and sizes, and the picture itself if Stella looks at it to check the result.",
      "Recorded on Linux, where Stella installed small Python libraries for the images and PDF. On a Mac or Windows PC it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How many pages does a 24 × 36 inch poster take?",
        a: "With home-printer margins and overlap, about 15 letter pages (3 × 5) landscape. A smaller overlap or portrait pages can change the count a little.",
      },
      {
        q: "Can it print on A4 instead?",
        a: "Yes, name the paper size and the final width or height in inches or centimetres.",
      },
      {
        q: "Can it make the image larger without it looking blurry?",
        a: "Not really: printing larger spreads the same pixels further. For sharp posters start from the largest original you have.",
      },
      {
        q: "What else can it print to exact sizes?",
        a: "Cards and photos: see [business cards at home](/how/printing-labels/print-business-cards-at-home) and [passport photos on a 4x6](/how/printing-labels/print-passport-photos-at-home).",
      },
    ],
    related: ["printing-labels/print-business-cards-at-home", "printing-labels/print-passport-photos-at-home", "photos-files/combine-photos-into-one-pdf"],
    lastChecked: "2026-11-14",
    sources: [{ label: "Adobe Help: Print large-sized documents as posters in Acrobat", href: "https://helpx.adobe.com/acrobat/desktop/print-documents/booklets-posters-banners/posters-banners.html" }],
  },
];
