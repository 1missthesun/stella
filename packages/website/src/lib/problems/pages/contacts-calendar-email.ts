import { PROOFS, webCuts } from "../media";
import type { ProblemPage } from "../types";

const MODEL = "Claude Code with Opus, on a Claude plan";

export const CONTACTS_CALENDAR_EMAIL_PAGES: ProblemPage[] = [
  {
    slug: "convert-csv-to-vcf",
    niche: "contacts-calendar-email",
    searchPhrases: ["csv to vcf", "convert csv to vcard", "convert csv to vcf", "excel to vcf", "import contacts from excel to iphone"],
    title: "Convert CSV to VCF (vCard) with names and accents intact",
    description:
      "Turn a contacts spreadsheet (CSV or Excel) into a .vcf your phone imports, without garbled accents or lost numbers: Google Contacts, or Stella (stella.sh) offline.",
    h1: "Convert a contacts CSV to a VCF file for your phone",
    short: "Convert CSV to VCF",
    lede: "64 contacts from a spreadsheet as one .vcf, with Zoë and José spelled right.",
    answer:
      "The free route is Google Contacts: Import the CSV at contacts.google.com, then Export the contacts as vCard. If names with accents come out as “ZoÃ«”, the CSV was saved in an older Windows encoding: re-save it from Excel as “CSV UTF-8” first. Stella (stella.sh) makes the .vcf on your computer instead, reading the encoding correctly, tidying phone numbers and skipping blank rows, so your address book isn't uploaded anywhere.",
    stellaSteps: [
      "Opens `contacts.csv` in Documents: 64 people and 2 blank rows, saved the way Excel saves “CSV (Comma delimited)”",
      "Spots that it's in the older Windows text encoding, which garbled accented names on a first read, and reads it correctly",
      "Puts every phone number in one format with the +1 country code, mobile and home labelled separately",
      "Carries over emails, birthdays (read as US month/day dates), addresses, workplaces and notes, and leaves out the blank rows",
      "Saves `contacts.vcf` next to the spreadsheet and explains how to import it on an iPhone or Android phone",
    ],
    prompt: "My contacts are in a spreadsheet, contacts.csv in my Documents. Turn it into a contacts file I can import into my new phone.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "One .vcf in under 30 seconds. Checked afterwards against an answer key written before the run: exactly 64 valid contact cards, every person found by name with all 10 accented names intact, every mobile, home number and email on the right card, all 25 birthdays carried over as US dates, and the CSV unchanged.",
      note: "The 64 people are made up, with 555 numbers and example.com emails. The run isn't sped up; a long idle stretch after the answer is cut.",
      video: {
        src: `${PROOFS}/contacts-calendar-email/convert-csv-to-vcf/proof.mp4`,
        cuts: webCuts("contacts-calendar-email/convert-csv-to-vcf"),
        poster: `${PROOFS}/contacts-calendar-email/convert-csv-to-vcf/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 42.8,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. contacts.csv, exported from Excel, is in Documents." },
        { at: 2, text: "The prompt: turn it into a contacts file the new phone can import." },
        { at: 28.8, text: "Done: contacts.vcf with all 64 people, accents fixed, phone numbers tidied, blank rows skipped, plus import steps for iPhone and Android." },
      ],
    },
    manualTitle: "Convert it yourself",
    manualSteps: [
      {
        title: "Save the CSV as UTF-8 first",
        body: "Open it in Excel and choose File, Save As, “CSV UTF-8 (Comma delimited)”. On a Mac, open it in Numbers and use File, Export To, CSV, which saves UTF-8. This stops accented names turning into “Ã«” or “?”.",
      },
      {
        title: "Import into Google Contacts",
        body: "Go to contacts.google.com, click Import, choose the CSV and import. Open a few contacts with accents and a few with two phone numbers to check they look right.",
      },
      {
        title: "Export as vCard",
        body: "Select the imported contacts (they get a label like “Imported on …”), click Export, choose vCard (for iOS Contacts) and save the .vcf.",
      },
      {
        title: "Import on the phone",
        body: "iPhone: email or AirDrop the .vcf to yourself, open it and tap Add All Contacts. Android: in the Contacts app, Fix & manage, Import from file. Or, if the phone syncs with that Google account, the contacts are already there.",
      },
      {
        title: "Outlook instead of Google",
        body: "In classic Outlook on Windows: File, Open & Export, Import/Export, Import from another program or file, Comma Separated Values, then map the columns.",
      },
    ],
    limits: [
      "Contact details go to the AI model you use in Stella as far as it reads the file to understand the columns. The file itself is made on your computer and not uploaded to a converter.",
      "Stella makes the file; importing it on the phone is a few taps you do.",
      "It didn't correct email addresses that had lost their accented letters in the spreadsheet, and pointed them out instead.",
      "Recorded on Linux, where Stella used only Python, built in on Mac and Linux. On Windows it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why do accented names look wrong after converting?",
        a: "Excel's plain “CSV (Comma delimited)” saves in an older Windows encoding, and most converters read it as UTF-8, turning “Zoë” into “ZoÃ«”. Save as CSV UTF-8, or let Stella detect the encoding.",
      },
      {
        q: "Can I import a CSV straight into an iPhone?",
        a: "No. iPhone Contacts imports vCard (.vcf) files, not CSV. Convert first, or import the CSV into iCloud or Google and let it sync.",
      },
      {
        q: "Can it go the other way, VCF to Excel?",
        a: "Yes: see [convert a VCF to Excel](/how/contacts-calendar-email/convert-vcf-to-excel). If you have two lists to combine first, [merge duplicate contacts](/how/contacts-calendar-email/merge-duplicate-contacts).",
      },
      {
        q: "Will my phone numbers keep working?",
        a: "Stella wrote every number with its country code (+1 here), which works on any phone and abroad. Mobile and home numbers stayed labelled as such.",
      },
    ],
    related: ["contacts-calendar-email/convert-vcf-to-excel", "contacts-calendar-email/merge-duplicate-contacts", "pdf-excel/combine-excel-files-into-one-sheet"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Google: Import your contacts into Google Contacts", href: "https://support.google.com/contacts/answer/15147365" },
      { label: "Cisdem: How to convert CSV to vCard", href: "https://cisdem.com/resource/convert-csv-to-vcard.html" },
    ],
  },
  {
    slug: "convert-vcf-to-excel",
    niche: "contacts-calendar-email",
    searchPhrases: ["vcf to excel", "convert vcf to excel", "vcf to csv", "vcard to csv", "how to open vcf file in excel"],
    title: "Convert a VCF to Excel: one row per contact, names readable",
    description:
      "Turn a phone's contacts .vcf into an Excel sheet with one row per person and readable accented names: the Google Contacts route, or Stella (stella.sh) offline.",
    h1: "Convert a VCF contacts file to Excel",
    short: "Convert VCF to Excel",
    lede: "85 contacts from an old phone's .vcf as one tidy row each in Excel.",
    answer:
      "Opening a .vcf in Excel directly gives one line per field, not per person. The free route is to import the .vcf at contacts.google.com and Export as Google CSV, which Excel opens with one row per person (wide, with a column per phone and email). Stella (stella.sh) does it on your computer: it decodes the scrambled accents Android exports use, leaves photo data out of the cells and saves an .xlsx with one row each.",
    stellaSteps: [
      "Opens `Contacts 2026-11-02.vcf` in Downloads: 85 contacts in the vCard 2.1 format Android phones export",
      "Decodes the 11 accented names stored in the phone's encoded form (like `=C3=89`), so they read correctly",
      "Puts each phone type (mobile, home, work, other) in its own column, written the same way, and a second email in an Email 2 column",
      "Leaves the 12 contact photos out of the sheet",
      "Saves `Contacts.xlsx` in Downloads, sorted by last name, and leaves the .vcf unchanged",
    ],
    prompt:
      "My old phone exported my contacts as a .vcf file (it's in my Downloads). Put them in an Excel spreadsheet, one row per person, with their name, phone numbers and email.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "The spreadsheet in about 1 minute 40 seconds. Checked afterwards against an answer key written before the run: 85 rows, one per person, every name present with all 10 encoded accented names decoded correctly, every phone number and email in its person's row, no photo data or garbled characters in any cell, and the .vcf unchanged.",
      note: "The contacts are made up, with 555 numbers and example emails. The work is sped up 7×.",
      video: {
        src: `${PROOFS}/contacts-calendar-email/convert-vcf-to-excel/proof.mp4`,
        cuts: webCuts("contacts-calendar-email/convert-vcf-to-excel"),
        poster: `${PROOFS}/contacts-calendar-email/convert-vcf-to-excel/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 43.6,
        realDuration: 135,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. An old phone's contacts export (.vcf) is in Downloads." },
        { at: 2, text: "The prompt: an Excel sheet, one row per person, with name, phone numbers and email." },
        { at: 10.8, text: "Stella replies: one row per person, saved in Downloads." },
        { at: 16.7, text: "Reading 85 contacts, sped up 7×." },
        { at: 29.5, text: "Done: Contacts.xlsx with 85 rows, accents decoded, a column per phone type, photos left out." },
      ],
    },
    manualTitle: "Convert it yourself",
    manualSteps: [
      {
        title: "Import the .vcf into Google Contacts",
        body: "Go to contacts.google.com, click Import and choose the .vcf. Google decodes the phone's encoded names. This adds the contacts to your Google account; you can delete them afterwards.",
      },
      {
        title: "Export as Google CSV",
        body: "Select the imported contacts (they carry an “Imported on …” label), click Export and choose Google CSV.",
      },
      {
        title: "Open it in Excel",
        body: "Use Data, From Text/CSV, pick the file and click Load, so accented names come through as UTF-8. The sheet is wide: one column per field, like Phone 1 - Value and Phone 2 - Value, but one row per person.",
      },
      {
        title: "Trim the columns",
        body: "Delete the columns you don't need and keep name, phones and emails. Save as .xlsx.",
      },
      {
        title: "On a Mac without Google",
        body: "Import the .vcf into the Contacts app, but note it can't export to CSV or Excel; for that you need Google, a converter, or Stella.",
      },
    ],
    limits: [
      "Contact photos aren't put in the spreadsheet.",
      "Stella left email addresses that the old phone had saved without their accented letters as they were, and pointed them out.",
      "The Google route uploads your contacts to your Google account. Stella's doesn't, but what it reads while working, names and numbers included, goes to the AI model you use in Stella.",
      "Recorded on Linux. On a Mac or Windows PC Stella may install a small spreadsheet library first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why does Excel show my VCF as one long column?",
        a: "A .vcf is a text file with one line per field (name, phone, email), so Excel shows each line as a row. It needs converting to put each person on one row.",
      },
      {
        q: "What are the =C3=89 characters in my contacts file?",
        a: "Android writes accented letters in an encoded form called quoted-printable. `=C3=89` is “É”. A proper converter decodes it; Stella did for all of them.",
      },
      {
        q: "Can I turn the spreadsheet back into contacts later?",
        a: "Yes: see [convert CSV to VCF](/how/contacts-calendar-email/convert-csv-to-vcf). To combine two contact lists, see [merge duplicate contacts](/how/contacts-calendar-email/merge-duplicate-contacts).",
      },
      {
        q: "Can it convert a calendar file to Excel too?",
        a: "Yes: see [convert an .ics calendar to Excel](/how/contacts-calendar-email/convert-ics-to-excel).",
      },
    ],
    related: ["contacts-calendar-email/convert-csv-to-vcf", "contacts-calendar-email/merge-duplicate-contacts", "contacts-calendar-email/convert-ics-to-excel"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Google: Import your contacts into Google Contacts", href: "https://support.google.com/contacts/answer/15147365" },
      { label: "Fone.tips: VCF to CSV", href: "https://fone.tips/vcf-to-csv/" },
    ],
  },
  {
    slug: "merge-duplicate-contacts",
    niche: "contacts-calendar-email",
    searchPhrases: ["merge duplicate contacts", "remove duplicate contacts", "duplicate contacts", "combine two contact lists", "remove duplicate contacts iphone"],
    title: "Merge duplicate contacts from two lists without losing numbers",
    description:
      "Combine an old phone's contacts and an email account's contacts into one list with no duplicates and every number kept: Apple, Google, or Stella (stella.sh).",
    h1: "Merge duplicate contacts from two lists",
    short: "Merge duplicate contacts",
    lede: "Two contact exports, 96 people, each once, with every number and email kept.",
    answer:
      "Inside one account, iPhone's View Duplicates, the Mac's Card, Look for Duplicates and Google Contacts' Merge & fix all merge contacts with the same name. They miss “Bob” and “Robert” with the same email, can wrongly merge two different people with one name, and don't work across two accounts. Stella (stella.sh) merges two exports by matching phone numbers and emails, keeps every number, and lists the matches it wasn't sure of.",
    stellaSteps: [
      "Reads both files in Downloads: 78 cards from the old phone (.vcf) and 65 rows from the email account (.csv)",
      "Spots 6 people saved twice on the phone, and 41 people who are on both lists",
      "Matches people by phone number and email, whatever the formatting or capitals, so Bob and Robert Quayle become one contact with the short name kept as a nickname",
      "Keeps the two Sam Patels apart, since they share no number or email",
      "Saves `Merged contacts.vcf` with 96 people, checks every number and email from both files is in it, and lists the matches worth a look",
    ],
    prompt:
      "I've got two contact lists in my Downloads: an export from my old phone (the .vcf) and one from my email account (the .csv). Combine them into one list with no duplicates, without losing anyone's numbers or emails.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "One merged list in about 1 minute 10 seconds. Checked afterwards against an answer key written before the run: 96 contacts, each of the 96 people exactly once with all their phones and emails, no record mixing two people, both Sam Patels kept separate, and both original files unchanged.",
      note: "Both contact lists are made up, with 555 numbers and example emails. The work is sped up 5×.",
      video: {
        src: `${PROOFS}/contacts-calendar-email/merge-duplicate-contacts/proof.mp4`,
        cuts: webCuts("contacts-calendar-email/merge-duplicate-contacts"),
        poster: `${PROOFS}/contacts-calendar-email/merge-duplicate-contacts/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 43.4,
        realDuration: 103,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A phone export (.vcf) and an email export (.csv) are in Downloads." },
        { at: 2.1, text: "The prompt: combine them with no duplicates and no lost numbers or emails." },
        { at: 12.1, text: "Stella replies: people on both lists become one contact, and it will flag matches it isn't sure of." },
        { at: 17.9, text: "Matching contacts, sped up 5×." },
        { at: 29.5, text: "Done: 96 contacts in Merged contacts.vcf, Bob/Robert-style pairs merged, the two Sam Patels kept apart." },
      ],
    },
    manualTitle: "Merge them yourself",
    manualSteps: [
      {
        title: "Get both lists into one account",
        body: "On a Mac, open Contacts and use File, Import for each file, into the same account (such as iCloud). Or import both at contacts.google.com. The built-in tools only merge within one account.",
      },
      {
        title: "Mac: Look for Duplicates",
        body: "In Contacts, choose Card, Look for Duplicates, then Merge. It matches identical names, so check “Bob” and “Robert”-style pairs by hand.",
      },
      {
        title: "Google: Merge & fix",
        body: "In Google Contacts, click Merge & fix, review each suggestion and merge. Don't click Merge all until you've checked that two people with the same name aren't on the list.",
      },
      {
        title: "iPhone",
        body: "When the iPhone finds duplicates, the top of your contacts list shows Duplicates Found, View Duplicates. Tap Merge All or go through them one by one.",
      },
      {
        title: "Search for the leftovers",
        body: "Search for a few surnames and phone numbers you know were on both lists. Nicknames, maiden names and old work emails are where duplicates hide.",
      },
    ],
    limits: [
      "Stella makes a new merged file; it doesn't change the contacts on your phone or in your account until you import it there and remove the old ones.",
      "Two people with the same name and no shared number or email are kept apart and listed, so you decide. It also merged two pairs on name alone where nothing conflicted, and told you which.",
      "Names, numbers and emails it reads go to the AI model you use in Stella. Nothing is uploaded to a contacts service.",
      "Recorded on Linux, where Stella used only Python, built in on Mac and Linux. On Windows it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why didn't my iPhone find all the duplicates?",
        a: "It matches contacts with the same name. A contact saved as “Liz” on one list and “Elizabeth” on the other, or with a typo, isn't recognised, even if the number is the same.",
      },
      {
        q: "Can I merge contacts from two Google accounts?",
        a: "Not directly; Merge & fix only works within one account. Export both, merge them, then import the result into the account you keep.",
      },
      {
        q: "What file should I import on my phone?",
        a: "A .vcf works on iPhone, Android, Google, iCloud and Outlook. Stella saved one. To review it in a sheet first, [convert the VCF to Excel](/how/contacts-calendar-email/convert-vcf-to-excel).",
      },
      {
        q: "Can it remove duplicates in a spreadsheet instead?",
        a: "Yes. For any spreadsheet, see [compare two Excel files](/how/pdf-excel/compare-two-excel-files) or ask for duplicate rows to be removed.",
      },
    ],
    related: ["contacts-calendar-email/convert-vcf-to-excel", "contacts-calendar-email/convert-csv-to-vcf", "pdf-excel/compare-two-excel-files"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Google: Merge duplicate contacts", href: "https://support.google.com/contacts/answer/7078226" },
      { label: "Apple: Merge contact cards in Contacts on Mac", href: "https://support.apple.com/guide/contacts/adrbk1456/mac" },
      { label: "How-To Geek: Find and merge duplicate contacts on iPhone", href: "https://www.howtogeek.com/837552/how-to-find-and-merge-duplicate-contacts-on-iphone/" },
    ],
  },
  {
    slug: "convert-ics-to-excel",
    niche: "contacts-calendar-email",
    searchPhrases: ["ics to excel", "ics to csv", "export google calendar to excel", "how to open ics file", "export calendar to spreadsheet"],
    title: "Convert an ICS calendar file to Excel, every repeat listed",
    description:
      "Turn an exported calendar (.ics) into a spreadsheet of every appointment in a date range, repeats expanded, in your time zone: Outlook, or Stella (stella.sh).",
    h1: "Convert an ICS calendar file to an Excel spreadsheet",
    short: "Convert ICS to Excel",
    lede: "Six months of a family calendar as 57 rows, weekly lessons and all, in Chicago time.",
    answer:
      "Classic Outlook on Windows can do it: open the .ics to import it, then File, Open & Export, Import/Export, Export to a file, Comma Separated Values, choose the calendar and set a date range. New Outlook, Apple Calendar and Google Calendar can't export to a spreadsheet. Online converters often list a weekly event once instead of every week, and show times in UTC. Stella (stella.sh) lists every occurrence in your range, in your time zone, in an .xlsx.",
    stellaSteps: [
      "Reads `Family calendar export.ics` in Downloads",
      "Expands every repeating event into one row per date: weekly piano lessons, monthly book club, fortnightly bins, a yearly birthday",
      "Leaves out the piano lesson cancelled on 31 March and everything outside January to June 2026",
      "Converts invites stored in universal time to Chicago time, and flags one that lands at 11:30 PM as worth checking",
      "Saves `Family appointments Jan-Jun 2026.xlsx` in Downloads, with multi-day events as one row with an end date, plus a Notes sheet explaining its choices",
    ],
    prompt:
      "I exported my family calendar as an .ics file (in my Downloads). Make me a spreadsheet of every appointment from January to June 2026, one row each, with the date, start and end time, title and location. We're in Chicago.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "The spreadsheet in about 1 minute 20 seconds. Checked afterwards against an answer key written before the run: all 57 appointments are there with the right date and Chicago start time, repeats expanded, nothing from outside January to June, no piano lesson on 31 March, and the .ics unchanged. One optional check missed: it counted 4 extra rows, which are lines on the separate Notes sheet that name appointments while explaining them. The appointments sheet itself has exactly 57 rows.",
      note: "The calendar is made up for this run, with repeating events, a cancelled date and invites stored in universal time on purpose. The work is sped up 6×.",
      video: {
        src: `${PROOFS}/contacts-calendar-email/convert-ics-to-excel/proof.mp4`,
        cuts: webCuts("contacts-calendar-email/convert-ics-to-excel"),
        poster: `${PROOFS}/contacts-calendar-email/convert-ics-to-excel/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 44.2,
        realDuration: 115,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A family calendar export (.ics) is in Downloads." },
        { at: 2, text: "The prompt: every appointment from January to June 2026, one row each, in Chicago time." },
        { at: 12.8, text: "Stella replies: repeating appointments included, all times in Chicago time." },
        { at: 18.7, text: "Reading the calendar, sped up 6×." },
        { at: 30.1, text: "Done: 57 appointments sorted by date, the cancelled lesson left out, four universal-time invites converted, one late-night time flagged." },
      ],
    },
    manualTitle: "Convert it yourself",
    manualSteps: [
      {
        title: "Windows with classic Outlook",
        body: "Double-click the .ics to import it into Outlook. Then File, Open & Export, Import/Export, Export to a file, Comma Separated Values, pick the calendar, and set the date range when asked. Open the CSV in Excel.",
      },
      {
        title: "No classic Outlook",
        body: "New Outlook, Outlook on the web, Apple Calendar and Google Calendar can import an .ics but can't export a spreadsheet. Import it into Google Calendar (Settings, Import & export) and use a third-party export add-on, or print the agenda view to PDF.",
      },
      {
        title: "Check the repeats",
        body: "Make sure a weekly event appears on every date, not just once, and that cancelled dates are gone. Converters that read the file directly often get this wrong.",
      },
      {
        title: "Check the times",
        body: "Invites from other people are often stored in universal time (UTC). If a 10 AM call shows as 4 PM, the converter didn't change it to your time zone.",
      },
    ],
    limits: [
      "Stella reads the file you export; it doesn't connect to your calendar account.",
      "Times are shown in the time zone you name. Say which one, as in the prompt here.",
      "It added a Notes sheet that mentions some appointments by name. If you sort or filter, use the first sheet; delete the Notes sheet if you don't want it.",
      "Event titles, times and places go to the AI model you use in Stella while it works. The spreadsheet is made on your computer.",
      "Recorded on Linux. On a Mac or Windows PC Stella may install a calendar and a spreadsheet library first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I open an .ics file?",
        a: "Double-click it: it opens in Calendar on a Mac or Outlook on Windows and offers to add the events. To just read it, open it in a text editor, but repeating events appear once, as a rule.",
      },
      {
        q: "Why does my weekly event only appear once in the spreadsheet?",
        a: "The .ics stores it once with a repeat rule. A converter has to expand the rule into dates and drop any cancelled ones; many don't.",
      },
      {
        q: "Can I export Google Calendar to Excel?",
        a: "Export it from Google Calendar's Settings, Import & export (you get .ics files in a zip), then convert the .ics as shown here.",
      },
      {
        q: "What else can it convert?",
        a: "Contacts both ways: [VCF to Excel](/how/contacts-calendar-email/convert-vcf-to-excel) and [CSV to VCF](/how/contacts-calendar-email/convert-csv-to-vcf). Saved emails can go into one PDF: see [EML to PDF](/how/contacts-calendar-email/convert-eml-to-pdf).",
      },
    ],
    related: ["contacts-calendar-email/convert-vcf-to-excel", "contacts-calendar-email/convert-eml-to-pdf", "pdf-excel/combine-excel-files-into-one-sheet"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Timetackle: Export Outlook calendar to CSV", href: "https://www.timetackle.com/how-to-export-outlook-calendar-to-csv/" },
      { label: "Google Calendar Help: Import events", href: "https://support.google.com/calendar/answer/37118" },
    ],
  },
  {
    slug: "convert-eml-to-pdf",
    niche: "contacts-calendar-email",
    searchPhrases: ["eml to pdf", "convert eml to pdf", "how to open eml file", "save emails as one pdf", "mbox to pdf"],
    title: "Convert EML to PDF: one person's emails in one PDF, by date",
    description:
      "Put every saved email from one sender into a single PDF, oldest first, with attachments shown: Mail or Outlook one at a time, or Stella (stella.sh) for the whole folder.",
    h1: "Convert EML files to one PDF, oldest first",
    short: "Convert EML to PDF",
    lede: "Eleven emails from a landlord, out of 36, in one dated PDF for a deposit dispute.",
    answer:
      "Open each .eml (Mail on a Mac, Outlook or the Mail app on Windows), save or print it as a PDF, then combine the PDFs in date order: in Preview on a Mac by dragging thumbnails, or with a free PDF tool on Windows. For a few emails that's fine; for a folder it's slow, and Mail's export can cut off the right edge. Stella (stella.sh) picks out one sender's emails from a folder and makes one PDF, oldest first, without uploading them.",
    stellaSteps: [
      "Reads the 36 saved emails in the Flat emails folder, whose file names aren't in date order",
      "Picks the 11 sent by the landlord, including two from his phone address under the same name, and leaves the 22 unrelated ones and your own replies out",
      "Decodes every body type (plain, HTML-only and encoded) and keeps special characters like the em dash",
      "Builds one PDF, oldest first: a contents page listing all 11, then each email on its own page with sender, date and full text, and the carpet-stain photo after the email it came with",
      "Points out gaps worth knowing for a dispute, such as a reply to an email that isn't in the folder, and offers to add your own emails, marked as yours",
    ],
    prompt:
      "For a deposit dispute I need every email my landlord, Gareth Pemberton, sent me in one PDF, oldest first. The emails are saved in the Flat emails folder in my Documents.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "One PDF in about 1 minute 10 seconds. Checked afterwards against an answer key written before the run: it holds all 11 of the landlord's emails from both his addresses, oldest first, none of the 22 unrelated emails, the em dash intact, the photo attachment shown, each email's date and subject, and the .eml files unchanged.",
      note: "The emails, landlord and flat are made up for this run. The test emails nearly all end “Regards, Gareth”, even ones from other senders, which Stella noticed and ignored, going by the actual sender. The work is sped up 5×.",
      video: {
        src: `${PROOFS}/contacts-calendar-email/convert-eml-to-pdf/proof.mp4`,
        cuts: webCuts("contacts-calendar-email/convert-eml-to-pdf"),
        poster: `${PROOFS}/contacts-calendar-email/convert-eml-to-pdf/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 49.4,
        realDuration: 109,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. 36 saved emails (.eml) are in Documents/Flat emails." },
        { at: 2, text: "The prompt: every email from the landlord in one PDF, oldest first." },
        { at: 18.9, text: "Stella replies: it will pull out his emails and report how many went in and anything odd." },
        { at: 24.7, text: "Reading the emails, sped up 5×." },
        { at: 35.4, text: "Done: all 11 of his emails, March 2025 to April 2026, a contents page, the photo attachment, and notes on gaps for the dispute." },
      ],
    },
    manualTitle: "Make the PDF yourself",
    manualSteps: [
      {
        title: "Find the right emails",
        body: "File names rarely sort in date order. Open each .eml (double-click) and note the sender and date. Look out for the same person writing from a second address.",
      },
      {
        title: "Mac: export each as PDF",
        body: "With an email open in Mail, choose File, Export as PDF, and name it starting with the date, like `2025-03-01 Welcome.pdf`, so they sort in order. If the right edge is cut off, use File, Print, PDF, Save as PDF instead.",
      },
      {
        title: "Windows: print each to PDF",
        body: "Open the .eml in classic Outlook or the Mail app, choose Print, pick Microsoft Print to PDF, and save with the date at the front of the name.",
      },
      {
        title: "Combine them",
        body: "Mac: open the first PDF in Preview, show Thumbnails, and drag the others into the sidebar in date order, then save. Windows: use a free PDF tool to merge them in name order.",
      },
      {
        title: "Add attachments",
        body: "Photos and documents attached to the emails aren't included in a printed email. Save them separately and add them after the email they came with.",
      },
    ],
    limits: [
      "Stella works on saved emails (.eml or .mbox files). It doesn't sign in to your email; save the emails from your mail app first.",
      "The email text is read by the AI model you use in Stella so it can tell who sent what. The PDF is made on your computer and nothing is uploaded to a converter.",
      "It includes only what you asked for. Here it left your replies out and offered to add them, marked as yours.",
      "Recorded on Linux. On a Mac or Windows PC Stella may install a small PDF library first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I open an .eml file?",
        a: "Double-click it. It opens in Mail on a Mac and in Outlook or the Mail app on Windows. Without a mail app, rename it to .txt to read the text, though attachments and HTML won't display.",
      },
      {
        q: "How do I save emails as .eml files?",
        a: "In Mail on a Mac, drag an email from the list into a Finder folder. In Gmail, open the email, click the three-dot menu and choose Download message. In Outlook, use File, Save As.",
      },
      {
        q: "Is a PDF of emails accepted as evidence?",
        a: "Often, but ask whoever handles your dispute. Keeping the original .eml files, as Stella did, preserves the full headers if anyone questions the PDF.",
      },
      {
        q: "Can it find the other documents about the same person?",
        a: "Yes: [find every file that mentions a name](/how/files-folders/find-files-containing-text). To blank out details before sending, [redact the PDF](/how/pdf-excel/redact-pdf).",
      },
    ],
    related: ["files-folders/find-files-containing-text", "pdf-excel/redact-pdf", "contacts-calendar-email/convert-ics-to-excel"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Save emails as files or PDFs in Mail on Mac", href: "https://support.apple.com/guide/mail/mlhlp1044/mac" },
      { label: "Apple Community: Mail export as PDF cuts off right side", href: "https://discussions.apple.com/thread/251140151" },
    ],
  },
];
