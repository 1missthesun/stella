import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const CONTACTS_CALENDAR_EMAIL_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "convert-csv-to-vcf",
    niche: "contacts-calendar-email",
    searchPhrases: [
      "csv to vcf",
      "convert csv to vcard",
      "convert csv to vcf",
      "excel to vcf",
      "import contacts from excel to iphone",
    ],
    title: "Convert CSV to VCF (vCard) with names and accents intact",
    description:
      "Convert a contacts CSV to a VCF file for your phone, with accented names intact and phone numbers tidied. Stella (stella.sh) makes it, nothing uploaded anywhere.",
    h1: "Convert a contacts CSV to a VCF file for your phone",
    short: "Convert CSV to VCF",
    lede: "Turn a contacts spreadsheet into a file your phone imports",
    answer:
      "Give Stella (stella.sh) your contacts spreadsheet and it makes a VCF file any iPhone or Android phone imports, with accented names intact, numbers tidied and blank rows left out.",
    gets: ["One contacts file for any phone", "Names like Zoë spelled right", "Mobile and home numbers labelled"],
    prompt:
      "My contacts are in a spreadsheet, contacts.csv in my Documents. Turn it into a contacts file I can import into my new phone.",
    demo: {
      ack: "Sure. Reading your contacts.",
      task: "Contacts file for your new phone",
      rows: ["Reading 64 people", "Fixing the accented names"],
      reply:
        "**contacts.vcf** is next to your spreadsheet, with all 64 people. On an iPhone, open it and tap Add All Contacts.",
      files: ["contacts.vcf"],
    },
    faq: [
      ["Why do accented names look wrong after converting?", "Excel's plain CSV option saves in an older text format, so Zoë turns into ZoÃ«. Save as CSV UTF-8, or let Stella read it."],
      ["Can I import a CSV straight into an iPhone?", "No. iPhone Contacts takes VCF files, not CSV, so convert it first."],
    ],
    byHand: [
      "In Excel, File, Save As, CSV UTF-8 (Comma delimited).",
      "At contacts.google.com, click Import and choose the CSV.",
      "Select the imported contacts, click Export and choose vCard. Open the .vcf on your phone.",
    ],
    related: [
      "contacts-calendar-email/convert-vcf-to-excel",
      "contacts-calendar-email/merge-duplicate-contacts",
      "pdf-excel/combine-excel-files-into-one-sheet",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-vcf-to-excel",
    niche: "contacts-calendar-email",
    searchPhrases: ["vcf to excel", "convert vcf to excel", "vcf to csv", "vcard to csv", "how to open vcf file in excel"],
    title: "Convert a VCF to Excel: one row per contact, names readable",
    description:
      "Convert a VCF contacts file to Excel with one row per person, readable names, and every phone number and email in its own column. Stella (stella.sh) does it.",
    h1: "Convert a VCF contacts file to Excel",
    short: "Convert VCF to Excel",
    lede: "See your phone's contacts in a spreadsheet, one row per person",
    answer:
      "Give Stella (stella.sh) the VCF your phone exported. It makes an Excel sheet with one row per person, names readable, each phone number and email in its own column.",
    gets: ["One row per person, sorted by last name", "A column for each kind of number", "Scrambled accents fixed"],
    prompt:
      "My old phone exported my contacts as a .vcf file in my Downloads. Put them in an Excel spreadsheet, one row per person, with name, phone numbers and email.",
    demo: {
      ack: "Sure. Opening your contacts file.",
      task: "Contacts into Excel",
      rows: ["Reading 85 contacts", "Fixing 11 scrambled names", "Leaving the photos out"],
      reply:
        "**Contacts.xlsx** is in Downloads, 85 people sorted by last name, with mobile, home and work numbers in their own columns.",
      files: ["Contacts.xlsx"],
    },
    faq: [
      ["How do I open a VCF file in Excel?", "Opened directly, Excel shows one line per detail, not per person. Convert it first, through Google Contacts or Stella."],
    ],
    byHand: [
      "At contacts.google.com, click Import and choose the .vcf.",
      "Select the imported contacts, click Export and choose Google CSV.",
      "In Excel, use Data, From Text/CSV to open it, then delete the columns you don't need.",
    ],
    related: [
      "contacts-calendar-email/convert-csv-to-vcf",
      "contacts-calendar-email/merge-duplicate-contacts",
      "contacts-calendar-email/convert-ics-to-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "merge-duplicate-contacts",
    niche: "contacts-calendar-email",
    searchPhrases: [
      "merge duplicate contacts",
      "remove duplicate contacts",
      "duplicate contacts",
      "combine two contact lists",
      "remove duplicate contacts iphone",
    ],
    title: "Merge duplicate contacts from two lists without losing numbers",
    description:
      "Merge duplicate contacts from two lists into one, matching by phone and email so Bob and Robert become one and no number is lost. Stella (stella.sh) does it.",
    h1: "Merge duplicate contacts from two lists",
    short: "Merge duplicate contacts",
    lede: "Combine two contact lists into one, every number kept",
    answer:
      "Give Stella (stella.sh) both contact lists. It matches people by phone number and email, not just name, merges the doubles into one card each and keeps every number and email.",
    gets: ["One list with everyone once", "Bob and Robert matched by number", "Two people with one name kept apart"],
    prompt:
      "I've got two contact lists in my Downloads, one from my old phone and one from my email account. Combine them into one list with no duplicates, keeping every number and email.",
    demo: {
      ack: "Sure. Comparing both lists.",
      task: "Merging your two contact lists",
      rows: ["Reading 78 phone and 65 email contacts", "Matching by number and email"],
      reply:
        "Done. **Merged contacts.vcf** has 96 people, each once, with every number and email from both lists. Two matches made on name alone are listed to check.",
      files: ["Merged contacts.vcf"],
    },
    faq: [
      ["How do I merge two contacts on an iPhone?", "Open one contact, tap Edit, scroll to Link Contacts and pick the other. For many at once, use View Duplicates at the top of your contacts."],
    ],
    byHand: [
      "Import both files into one account, such as iCloud or contacts.google.com.",
      "Google: click Merge & fix and review each suggestion. Mac Contacts: Card, Look for Duplicates.",
      "Search a few surnames and numbers you know were on both lists to catch leftovers.",
    ],
    related: [
      "contacts-calendar-email/convert-vcf-to-excel",
      "contacts-calendar-email/convert-csv-to-vcf",
      "pdf-excel/compare-two-excel-files",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-ics-to-excel",
    niche: "contacts-calendar-email",
    searchPhrases: [
      "ics to excel",
      "ics to csv",
      "export google calendar to excel",
      "how to open ics file",
      "export calendar to spreadsheet",
    ],
    title: "Convert an ICS calendar file to Excel, every repeat listed",
    description:
      "Convert an ICS calendar file to an Excel spreadsheet with every repeat listed and times in your own time zone. Stella (stella.sh) makes the sheet for you.",
    h1: "Convert an ICS calendar file to an Excel spreadsheet",
    short: "Convert ICS to Excel",
    lede: "Every appointment in your calendar file, one row each in Excel",
    answer:
      "Give Stella (stella.sh) the .ics file and the dates you want. It lists every appointment in Excel, one row each, with weekly and monthly repeats spelled out and times in your own time zone.",
    gets: [
      "One row per appointment, ready to sort",
      "Every repeat listed, cancelled ones gone",
      "Times in your own time zone",
    ],
    prompt:
      "I exported my family calendar as an .ics file. Make me a spreadsheet of every appointment from January to June 2026 with date, times, title and location. We're in Chicago.",
    demo: {
      ack: "Sure. Reading your calendar.",
      task: "Family appointments, Jan to Jun",
      rows: ["Listing every weekly and monthly repeat", "Dropping the cancelled piano lesson"],
      reply:
        "Done. **57 appointments** are in a spreadsheet in Downloads, one row each. One invite lands at 11:30 PM, worth checking.",
      files: ["Family appointments Jan-Jun 2026.xlsx"],
    },
    faq: [
      ["How do I open an ICS file in Excel?", "Excel can't read it as rows. Convert it to xlsx first, with classic Outlook or Stella."],
      ["Why does my weekly event only appear once?", "The file stores it once with a repeat rule. A good converter lists every date and drops cancelled ones."],
    ],
    byHand: [
      "In classic Outlook on Windows, double-click the .ics to import it.",
      "Then File, Open & Export, Import/Export, Export to a file, Comma Separated Values, and pick a date range.",
      "Open the CSV in Excel. Google Calendar and Apple Calendar can't export to a spreadsheet.",
    ],
    related: [
      "contacts-calendar-email/convert-vcf-to-excel",
      "contacts-calendar-email/convert-eml-to-pdf",
      "pdf-excel/combine-excel-files-into-one-sheet",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-eml-to-pdf",
    niche: "contacts-calendar-email",
    searchPhrases: ["eml to pdf", "convert eml to pdf", "how to open eml file", "save emails as one pdf", "mbox to pdf"],
    title: "Convert EML to PDF: one person's emails in one PDF, by date",
    description:
      "Convert EML files to one PDF, oldest first: every email from one sender, with dates and photos in place. Stella (stella.sh) picks them out of your saved emails.",
    h1: "Convert EML files to one PDF, oldest first",
    short: "Convert EML to PDF",
    lede: "One person's emails in a single PDF, oldest first",
    answer:
      "Tell Stella (stella.sh) whose emails you need and where they're saved. It picks out every email from that person and makes one PDF, oldest first, with dates, full text and attached photos.",
    gets: [
      "One PDF of everything they sent",
      "Oldest first, with a contents page",
      "Photos after the email they came with",
    ],
    prompt:
      "For a deposit dispute I need every email my landlord Gareth Pemberton sent me in one PDF, oldest first. They're saved in the Flat emails folder in Documents.",
    demo: {
      ack: "Sure. Finding Gareth's emails.",
      task: "Landlord's emails as one PDF",
      rows: ["Reading 36 saved emails", "Picking out 11 from Gareth"],
      reply:
        "Done. All 11 of Gareth's emails, from both his addresses, are in one PDF, oldest first. One of them replies to an email that isn't in the folder.",
    },
    faq: [
      ["How do I open an .eml file?", "Double-click it. It opens in Mail on a Mac and in Outlook or the Mail app on Windows."],
    ],
    byHand: [
      "Open each .eml and note the sender and date.",
      "Mac: File, Export as PDF. Windows: Print, Microsoft Print to PDF. Start each name with the date.",
      "Combine them in date order, in Preview on a Mac or a free PDF tool on Windows.",
    ],
    related: [
      "files-folders/find-files-containing-text",
      "pdf-excel/redact-pdf",
      "contacts-calendar-email/convert-ics-to-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "open-mbox-file",
    niche: "contacts-calendar-email",
    searchPhrases: [
      "how to open mbox file",
      "mbox viewer",
      "open mbox file google takeout",
      "mbox to csv",
      "extract attachments from mbox",
      "thunderbird export emails",
    ],
    title: "Open an mbox file: every email listed, every attachment saved",
    description:
      "Open an mbox file from Google Takeout without a mail program: a list of every email and a folder of all the attachments. Stella (stella.sh) sorts it out.",
    h1: "How to open an mbox file",
    short: "Open an mbox file",
    lede: "Read an old mailbox download and get every attachment out",
    answer:
      "An mbox holds a whole mailbox in one file, like the Gmail download from Google Takeout. Stella (stella.sh) opens it for you: a spreadsheet of every email and a folder with all the attachments.",
    gets: [
      "A list of every email: date, sender, subject",
      "Every attachment saved in one folder",
      "Two files with one name both kept",
    ],
    prompt:
      "I downloaded my old email from Google and got a zip with an mbox file I can't open. List every email with date, sender and subject, and save all the attachments in one folder.",
    demo: {
      ack: "Sure. Opening your old mailbox.",
      task: "Old Gmail, listed and unpacked",
      rows: ["Finding the mbox in the zip", "Listing all 45 emails"],
      reply:
        "Done. Your email list and an Attachments folder are in a new **Old Gmail export** folder. The two different invoice.pdf files are both there.",
      files: ["Old Gmail export"],
    },
    faq: [
      ["What is an mbox file?", "One text file holding a whole mail folder, email after email. Google Takeout, Thunderbird and Apple Mail use it for exports."],
    ],
    byHand: [
      "Unzip the Takeout download; Gmail is in Takeout/Mail as a .mbox file.",
      "Mac: in Mail, File, Import Mailboxes, Files in mbox format.",
      "Anywhere: install the free Thunderbird and its ImportExportTools NG add-on, then right-click Local Folders to import the mbox.",
    ],
    related: [
      "contacts-calendar-email/convert-eml-to-pdf",
      "chats-data-exports/read-facebook-messages-from-data-download",
      "files-folders/find-files-containing-text",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
