import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const PLANNING_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "make-a-notion-dashboard",
    niche: "planning",
    searchPhrases: [
      "how to make a notion dashboard",
      "notion life dashboard",
      "notion student dashboard",
      "aesthetic notion dashboard",
      "how to make your own notion dashboard",
    ],
    title: "How to make a Notion dashboard (life, student or aesthetic)",
    description:
      "Want a Notion dashboard that fits your life or your classes? Tell Stella (stella.sh) what you juggle and it builds the page inside your own Notion.",
    h1: "How to make a Notion dashboard",
    short: "Make a Notion dashboard",
    lede: "One home page for your tasks, classes, goals and notes, in your colours.",
    answer:
      "Skip the template hunt. Tell Stella (stella.sh) what you keep track of and it builds the dashboard inside your own Notion: task lists, a calendar, pages for classes or goals, and a cover and icons in your colours.",
    gets: [
      "Built in your own Notion, ready to use",
      "Tasks, calendar and goals linked together",
      "Cover, icons and colours to your taste",
    ],
    prompt:
      "Make me a student dashboard in my Notion with my 5 classes, assignment due dates, a weekly calendar and a soft sage green look.",
    demo: {
      ack: "Love it. Setting up your student dashboard in Notion now.",
      task: "Building your Notion student dashboard",
      rows: [
        "Opening your Notion in the browser",
        "Adding 5 class pages and an assignments list",
        "Linking due dates to a weekly calendar",
        "Setting a sage cover and matching icons",
      ],
      reply:
        "Done. **Student Dashboard** is at the top of your Notion sidebar. Each class has its own page, assignments sort by due date, and this week's calendar sits up top.",
    },
    faq: [
      ["Do I need to pay for Notion?", "No. It's all built with Notion's free plan, in the account you already use."],
      [
        "Can it copy a dashboard I saw on Pinterest?",
        "Yes. Share the picture and say what you like; the layout and colours get rebuilt in your Notion.",
      ],
    ],
    byHand: [
      "Duplicate a free template from the [Notion template gallery](https://www.notion.com/templates).",
      "Type /linked view to pull tasks and classes onto one page, then add a cover and icons.",
    ],
    related: [
      "planning/make-an-aesthetic-notion-widget-page",
      "planning/make-a-notion-habit-tracker",
      "planning/sync-notion-calendar-with-google-calendar",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-notion-habit-tracker",
    niche: "planning",
    searchPhrases: [
      "notion habit tracker",
      "notion habit tracker with progress bar",
      "notion habit tracker template free",
      "notion habit tracker template with graph",
    ],
    title: "Notion habit tracker with progress bars, built for you",
    description:
      "Name the habits you want to keep and Stella (stella.sh) builds a Notion habit tracker with daily tick boxes, weekly progress bars and a monthly view.",
    h1: "A Notion habit tracker with progress bars",
    short: "Notion habit tracker",
    lede: "Tick off each habit daily and watch the weekly bars fill up.",
    answer:
      "List your habits and Stella (stella.sh) sets up a habit tracker in your own Notion: a row for every day, a tick box per habit, a progress bar for each week and a month view.",
    gets: [
      "One tick box per habit, per day",
      "Progress bars that move as you tick",
      "Habits added or dropped any time",
    ],
    prompt:
      "Build me a habit tracker in Notion for water, reading, gym and no phone after 10, with a progress bar for each week.",
    demo: {
      ack: "Great list. Building your habit tracker in Notion.",
      task: "Setting up your Notion habit tracker",
      rows: [
        "Making a daily row with four tick boxes",
        "Adding days through the end of March",
        "Writing the weekly progress bars",
        "Putting today's row on your dashboard",
      ],
      reply:
        "Ready. **Habits** is in your Notion sidebar with a row for every day through March. Tick them off each evening; every week gets a bar like ▓▓▓▓░░ 68%.",
    },
    faq: [
      [
        "Does the progress bar update by itself?",
        "Yes. It's worked out by Notion, so ticking a box moves the bar straight away, in the phone app too.",
      ],
      ["Can I add a habit later?", "Yes. Ask and it's added as a new tick box, and the bars start counting it."],
    ],
    byHand: [
      "Make a Notion database with a Date column and one checkbox per habit.",
      "Add a formula that counts ticked boxes and draws a bar with repeat().",
    ],
    related: ["planning/make-a-notion-dashboard", "apps/make-your-own-habit-tracker", "planning/make-an-aesthetic-notion-widget-page"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-notion-budget-from-your-bank-statement",
    niche: "planning",
    searchPhrases: [
      "notion budget template",
      "notion budget tracker",
      "notion finance tracker",
      "import bank transactions into notion",
    ],
    title: "Notion budget template, filled in from your bank statement",
    description:
      "Skip typing every purchase. Stella (stella.sh) reads your bank statement, sorts each payment into a category and builds a Notion budget with monthly totals.",
    h1: "A Notion budget template already filled with your spending",
    short: "Notion budget from your bank file",
    lede: "Your bank's download, sorted into categories and monthly totals in Notion.",
    answer:
      "Download your bank statement and Stella (stella.sh) reads every transaction, puts each in a category, and brings them into a Notion budget with monthly totals and a limit per category.",
    gets: [
      "Every transaction brought in, nothing typed",
      "Groceries, bills, eating out and more, sorted",
      "Monthly totals against the limits you set",
    ],
    prompt:
      "Make me a Notion budget from the bank statement CSV in my Downloads, with categories, monthly totals and a $400 limit for eating out.",
    demo: {
      ack: "On it. Reading your statement first.",
      task: "Building your Notion budget",
      rows: [
        "Reading 312 transactions from the statement",
        "Sorting them into 11 categories",
        "Bringing them into a Notion budget",
        "Adding monthly totals and limits",
      ],
      reply:
        "Done. **Budget** is in your Notion with 312 transactions across three months. The month view shows each category against its limit; eating out is at $286 of $400 so far. Grab next month's file and ask me to add it.",
    },
    faq: [
      [
        "Does Notion connect to my bank?",
        "It doesn't need to. You download the statement from your bank's website, and only that file is read.",
      ],
      ["What if my bank only gives PDFs?", "That works too. The transactions are pulled out of the PDF first, then sorted the same way."],
    ],
    byHand: [
      "Export a CSV from your online banking, then in Notion open Settings, Import, CSV.",
      "Add a Category select, then group a table by month to see totals.",
    ],
    related: [
      "money-household/make-a-budget-from-bank-statement",
      "pdf-excel/bank-statement-pdf-to-excel",
      "planning/make-a-notion-dashboard",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-notion-reading-list",
    niche: "planning",
    searchPhrases: [
      "notion reading list",
      "notion book tracker",
      "import goodreads to notion",
      "notion reading tracker template",
    ],
    title: "Notion reading list and book tracker, with covers and ratings",
    description:
      "Turn your Goodreads export or a list of titles into a Notion reading list with covers, ratings and shelves. Stella (stella.sh) builds it in your Notion.",
    h1: "A Notion reading list with all your books in it",
    short: "Notion reading list",
    lede: "Every book you've read or want to, with covers, ratings and a shelf view.",
    answer:
      "Send Stella (stella.sh) your Goodreads export, a photo of your shelf or a list of titles. It builds a reading list in your Notion with covers, authors, your ratings and shelves for reading, read and next.",
    gets: [
      "Your Goodreads history brought over",
      "Covers and authors filled in for you",
      "Shelves for reading, finished and next up",
    ],
    prompt:
      "Move my Goodreads books into a Notion reading tracker with covers, my star ratings and a gallery view that looks like a bookshelf.",
    demo: {
      ack: "Fun one. Getting your Goodreads books into Notion.",
      task: "Building your Notion reading list",
      rows: [
        "Reading 248 books from your Goodreads export",
        "Finding covers and page counts",
        "Making shelves and a gallery view",
        "Adding a 2026 reading goal counter",
      ],
      reply:
        "Done. **Reading List** is in your Notion: 248 books with covers, your ratings and dates read. The gallery looks like a shelf, Currently Reading sits at the top, and you're at 31 of 40 books for 2026.",
    },
    faq: [
      [
        "Where do I get my Goodreads export?",
        "On Goodreads, open My Books, then Import and export, and choose Export Library. Or ask, and it's downloaded for you in your browser.",
      ],
      [
        "Can I add books from my phone?",
        "Yes. Type the title in the Notion app, and the cover and author get filled in next time you ask.",
      ],
    ],
    byHand: [
      "Export your library from Goodreads (My Books, Import and export) as a CSV.",
      "Import the CSV into Notion, add a gallery view, and paste a cover image into each book.",
    ],
    related: ["study/export-kindle-highlights", "planning/import-into-notion", "apps/make-a-reading-tracker"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "import-into-notion",
    niche: "planning",
    searchPhrases: [
      "import excel into notion",
      "import trello into notion",
      "import evernote into notion",
      "import csv to notion database",
    ],
    title: "Import Excel, Trello or Evernote into Notion, nothing lost",
    description:
      "Moving to Notion? Stella (stella.sh) brings over your Excel sheets, Trello boards or Evernote notebooks and checks every row, card and note arrived.",
    h1: "Import Excel, Trello or Evernote into Notion",
    short: "Import into Notion",
    lede: "Your sheets, boards and notes moved over, with nothing left behind.",
    answer:
      "Tell Stella (stella.sh) what you're moving. It runs Notion's own Trello and Evernote importers in your browser, turns each Excel tab into a Notion table, and checks every card, note and row made it across.",
    gets: [
      "Each Excel tab as its own Notion table",
      "Trello boards with lists, labels and due dates",
      "Evernote notebooks with their notes and attachments",
    ],
    prompt:
      "Move my Evernote notebooks and the Budget 2026.xlsx file in Documents into Notion, keeping each tab as a separate table.",
    demo: {
      ack: "Sure. Starting with Evernote, then the spreadsheet.",
      task: "Moving your notes and sheets to Notion",
      rows: [
        "Running Notion's Evernote importer",
        "Splitting the spreadsheet into 4 tabs",
        "Setting dates, numbers and tick boxes",
        "Counting notes and rows on both sides",
      ],
      reply:
        "All moved. Your 6 Evernote notebooks are now pages in Notion with all 1,204 notes. **Budget 2026** became 4 tables, one per tab, with dates and amounts set up properly. The counts match on both sides.",
    },
    faq: [
      [
        "Can Notion import an Excel file directly?",
        "Notion takes CSV files, so each Excel tab is saved as one first, then imported with its columns set to dates, numbers or tick boxes.",
      ],
      [
        "Do Trello due dates come across?",
        "Yes. Every card becomes a row that keeps its list, labels and due date.",
      ],
    ],
    byHand: [
      "In Notion, open Settings, then Import, and pick Evernote, Trello or CSV.",
      "For Excel, save each tab as a CSV first, then import them one by one.",
    ],
    related: ["planning/make-a-notion-dashboard", "planning/make-a-notion-reading-list", "pdf-excel/convert-excel-to-csv"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-hyperlinked-digital-planner",
    niche: "planning",
    searchPhrases: [
      "how to make a hyperlinked digital planner",
      "digital planner with hyperlinks",
      "how to make a digital planner for goodnotes",
      "how to make a digital planner for ipad",
    ],
    title: "How to make a hyperlinked digital planner for GoodNotes",
    description:
      "Describe your planner and Stella (stella.sh) makes it as one PDF with tabs and dates that jump to the right page in GoodNotes, Notability or any PDF app.",
    h1: "How to make a hyperlinked digital planner",
    short: "Make a hyperlinked digital planner",
    lede: "Tabs that jump to any month, week or day with one tap.",
    answer:
      "Describe the planner you want and Stella (stella.sh) makes it as one PDF: year, month, week and day pages, with side tabs that jump between them when you tap. It opens in GoodNotes or any PDF app.",
    gets: [
      "Every tab and date linked to its page",
      "Year, month, week and day pages in one file",
      "Your colours, fonts and paper style",
    ],
    prompt:
      "Make me a hyperlinked digital planner for 2027 for GoodNotes, landscape, with month tabs on the side and a cream and terracotta look.",
    demo: {
      ack: "Nice palette. Making your 2027 planner now.",
      task: "Making your hyperlinked 2027 planner",
      rows: [
        "Laying out year, month, week and day pages",
        "Linking 12 month tabs on every page",
        "Linking each date to its own day",
        "Checking every link lands right",
      ],
      reply:
        "Ready. **Planner 2027.pdf** is in Documents, 430 pages. Tap a month tab, then any date, and you're on that day. Open it in GoodNotes and the links work straight away.",
      files: ["Planner 2027.pdf"],
    },
    faq: [
      [
        "Will the links work in GoodNotes?",
        "Yes. They're real PDF links, so tapping a tab in GoodNotes, Notability or Noteshelf jumps to that page.",
      ],
      ["Can I make it undated?", "Yes. Ask for an undated planner and the pages get blank date spaces, so it works for any year."],
    ],
    byHand: [
      "Design the pages in Canva or Keynote, then link each tab to its page.",
      "Export as a PDF with links kept, and tap a few tabs before importing.",
    ],
    related: ["planning/make-a-custom-goodnotes-planner", "planning/import-a-planner-into-goodnotes", "publishing/make-a-printable-planner"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-custom-goodnotes-planner",
    niche: "planning",
    searchPhrases: [
      "how to make a goodnotes planner",
      "custom digital planner",
      "personalized digital planner",
      "notability planner",
      "how to make goodnotes planner with tabs",
    ],
    title: "Make a custom GoodNotes or Notability planner with your dates",
    description:
      "Get a GoodNotes or Notability planner that starts when you want, with your own tabs and your birthdays and term dates already in. Ask Stella (stella.sh).",
    h1: "How to make a GoodNotes planner with your own dates and tabs",
    short: "Custom GoodNotes or Notability planner",
    lede: "Your term dates, birthdays and own sections, already on the pages.",
    answer:
      "Tell Stella (stella.sh) when your year starts and which sections you want. It makes a GoodNotes or Notability planner with your own tabs, with birthdays and term dates from your calendar already written in.",
    gets: [
      "Starts any month, with Monday or Sunday weeks",
      "Your own tabs, like Work, Uni or Gym",
      "Birthdays and term dates already on the pages",
    ],
    prompt:
      "Make me a Notability planner from September to June with tabs for Uni, Work and Gym, and my term dates and friends' birthdays already in.",
    demo: {
      ack: "Sounds good. Pulling your dates in first.",
      task: "Making your September to June planner",
      rows: [
        "Reading term dates and birthdays from your calendar",
        "Adding Uni, Work and Gym tabs",
        "Writing your dates onto the right days",
        "Linking every tab and page",
      ],
      reply:
        "Done. **Planner Sep-Jun.pdf** is in Documents. Month tabs plus Uni, Work and Gym run down the side, and all 3 terms and 14 birthdays are already written in. Open it in Notability and start writing.",
      files: ["Planner Sep-Jun.pdf"],
    },
    faq: [
      [
        "Where do the dates come from?",
        "Your Google, Apple or Outlook calendar, a school term PDF, or a list you type out.",
      ],
      [
        "Can I add pages after I've started writing?",
        "Yes. The new pages come as a separate PDF you add to the end in GoodNotes or Notability, so your notes stay put.",
      ],
    ],
    byHand: [
      "Download or buy a planner template, then write your dates in by hand.",
      "Or design one in Keynote with linked tabs and export it as a PDF.",
    ],
    related: [
      "planning/make-a-hyperlinked-digital-planner",
      "planning/import-a-planner-into-goodnotes",
      "planning/make-a-weekly-planner-from-your-calendar",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "import-a-planner-into-goodnotes",
    niche: "planning",
    searchPhrases: [
      "how to import pdf planner into goodnotes",
      "goodnotes planner hyperlinks not working",
      "hyperlinks not working goodnotes",
      "import digital planner into goodnotes",
    ],
    title: "Import a planner PDF into GoodNotes with the links working",
    description:
      "Planner tabs doing nothing in GoodNotes? Stella (stella.sh) checks and repairs every link in the PDF and puts it in iCloud Drive, ready to import on your iPad.",
    h1: "How to import a PDF planner into GoodNotes with working links",
    short: "Import a planner into GoodNotes",
    lede: "Your planner opens in GoodNotes and every tab jumps where it should.",
    answer:
      "Give Stella (stella.sh) the planner you bought or made. It tests every tab and date link, puts back the broken ones, and saves it to iCloud Drive, ready to open in GoodNotes on your iPad.",
    gets: [
      "Every link tested before it reaches your iPad",
      "Broken or missing tab links put back",
      "Waiting in iCloud Drive for GoodNotes",
    ],
    prompt:
      "The Etsy planner I bought has tabs that do nothing in GoodNotes. Fix the links and put it where my iPad can open it.",
    demo: {
      ack: "Let's sort it. Checking the planner's links now.",
      task: "Fixing your planner's links",
      rows: [
        "Testing 1,860 links in the planner",
        "Putting back 412 tab links lost in export",
        "Saving the fixed copy to iCloud Drive",
      ],
      reply:
        "Fixed. **Planner 2027 (links fixed).pdf** is in iCloud Drive, in the GoodNotes folder. On your iPad, open GoodNotes, tap New, then Import, and pick it. Every month and day tab now jumps to its page.",
      files: ["Planner 2027 (links fixed).pdf"],
    },
    faq: [
      [
        "Why are my hyperlinks not working in GoodNotes?",
        "Usually the PDF lost its hyperlinks when it was exported, or it was imported as pictures instead of as a PDF.",
      ],
      [
        "Does it work for Notability too?",
        "Yes. The fixed PDF opens with working tabs in Notability, Noteshelf and most other iPad note apps.",
      ],
    ],
    byHand: [
      "Click a few tabs in a computer PDF reader to see if the links exist.",
      "If they work there, import it into GoodNotes as a PDF, not as images.",
    ],
    related: ["planning/make-a-hyperlinked-digital-planner", "planning/make-a-custom-goodnotes-planner", "pdf-excel/merge-pdf-files"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "sync-notion-calendar-with-google-calendar",
    niche: "planning",
    searchPhrases: [
      "sync notion calendar with google calendar",
      "how to sync google calendar with notion",
      "embed google calendar in notion",
      "notion google calendar integration",
    ],
    title: "Sync Notion calendar with Google Calendar: tasks and events",
    description:
      "Get your Notion due dates and Google Calendar events in one place. Stella (stella.sh) connects them in your browser and adds the calendar to your Notion page.",
    h1: "Sync your Notion calendar with Google Calendar",
    short: "Sync Notion with Google Calendar",
    lede: "Notion tasks and Google events side by side, in one calendar.",
    answer:
      "Tell Stella (stella.sh) which Notion lists have dates. In your browser it signs Notion Calendar into your Google account, adds those lists beside your Google events, and puts the calendar on your Notion dashboard.",
    gets: [
      "Notion due dates next to Google events",
      "Drag a task to a new day and Notion updates",
      "Your Google calendar shown on your Notion page",
    ],
    prompt:
      "Get my Notion assignments showing in the same calendar as my Google Calendar events, and put my Google Calendar on my Notion dashboard.",
    demo: {
      ack: "Good plan. Connecting your calendars in the browser.",
      task: "Linking Notion and Google Calendar",
      rows: [
        "Signing Notion Calendar into your Google account",
        "Adding your Assignments list by due date",
        "Placing your calendar on the dashboard",
      ],
      reply:
        "Done. Open **Notion Calendar** and your Google events and 23 assignments share one week view, assignments in purple. Drag one to another day and its due date changes in Notion. Your dashboard shows this week's calendar too.",
    },
    faq: [
      [
        "Does Notion Calendar sync with Google Calendar?",
        "Yes. It shows and edits your Google events, and puts Notion lists with dates beside them in the same view.",
      ],
      ["Is Notion Calendar free?", "Yes. It comes free with any Notion account, on the web and as an app for your computer and phone."],
    ],
    byHand: [
      "Open [Notion Calendar](https://www.notion.com/product/calendar), sign in with Google, then add a Notion database from the sidebar.",
      "For a Notion page, copy the embed link from Google Calendar's settings and paste it with /embed.",
    ],
    related: ["planning/make-a-notion-dashboard", "planning/make-a-shared-family-calendar", "contacts-calendar-email/convert-ics-to-excel"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-shared-family-calendar",
    niche: "planning",
    searchPhrases: [
      "how to make a shared family calendar",
      "shared family calendar google",
      "how to make a shared family calendar on iphone",
      "shared family calendar free",
    ],
    title: "How to make a shared family calendar everyone can see",
    description:
      "One calendar on every family phone, with school terms, clubs, birthdays and bin days already in. Stella (stella.sh) sets it up and invites everyone.",
    h1: "How to make a shared family calendar",
    short: "Make a shared family calendar",
    lede: "One calendar on everyone's phone, with school, clubs and bins already in.",
    answer:
      "Tell Stella (stella.sh) who's in the family and what goes in. It makes a shared Google calendar in your browser, invites everyone, and fills it with school terms, clubs, birthdays and bin days.",
    gets: [
      "One family calendar on every phone",
      "School terms and clubs added from the letters",
      "Birthdays every year, bin day every week",
    ],
    prompt:
      "Set up a shared family calendar for me, Sam and the kids with the school term dates from this PDF, swimming on Tuesdays and bin day every Thursday.",
    demo: {
      ack: "Happy to. Setting up your family calendar now.",
      task: "Setting up your family calendar",
      rows: [
        "Making a Family calendar in Google Calendar",
        "Adding term dates from the school letter",
        "Repeating swimming Tuesdays and bins Thursdays",
        "Sending invites to Sam and the kids",
      ],
      reply:
        "Done. **Family** is in your Google Calendar with term dates, half terms, swimming every Tuesday at 5 and bins every Thursday. Sam and the kids each got an invite; once they accept, it's on their phones.",
    },
    faq: [
      [
        "How do I make a shared family calendar on iPhone?",
        "Add the Google account in iPhone Settings and it shows in the Calendar app. Or ask for an iCloud shared calendar instead.",
      ],
      [
        "Can the kids add things themselves?",
        "Yes. Everyone invited can add, move or delete events, and the change shows on all the phones.",
      ],
    ],
    byHand: [
      "In Google Calendar on a computer, click + next to Other calendars, then Create new calendar.",
      "Open its settings, add each person under Share with specific people, and let them make changes.",
    ],
    related: ["planning/sync-notion-calendar-with-google-calendar", "apps/make-a-family-chore-chart-app", "planning/make-a-weekly-planner-from-your-calendar"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-weekly-planner-from-your-calendar",
    niche: "planning",
    searchPhrases: [
      "print google calendar week",
      "print google calendar week view",
      "print google calendar with details",
      "weekly planner printable with time slots",
    ],
    title: "Print your Google Calendar week as a weekly planner",
    description:
      "Google Calendar prints badly. Stella (stella.sh) turns your real week into a printable weekly planner with time slots, event details and space for to-dos.",
    h1: "Print your Google Calendar week as a planner page",
    short: "Weekly planner from your calendar",
    lede: "Your real week on one page, with room to write, ready to print.",
    answer:
      "Ask Stella (stella.sh) for your week and it reads your Google, Apple or Outlook calendar, then lays it out as a printable weekly planner with time slots, event details and room for to-dos.",
    gets: [
      "Every event in its time slot, with details",
      "Space for to-dos, meals and notes",
      "A4 or Letter, one week per page",
    ],
    prompt:
      "Make a printable weekly planner of next week from my Google Calendar, 7am to 9pm, with a to-do column and room for meal plans.",
    demo: {
      ack: "Sure. Reading next week from your calendar.",
      task: "Making next week's planner page",
      rows: [
        "Reading 18 events from Google Calendar",
        "Laying out 7am to 9pm by the hour",
        "Adding to-do and meal columns",
        "Saving an A4 landscape PDF",
      ],
      reply:
        "Ready. **Week of 30 Nov.pdf** is in Documents. All 18 events sit in their time slots with places and notes, with a to-do list and meal grid on the right. Want a fresh one every Sunday evening?",
      files: ["Week of 30 Nov.pdf"],
    },
    faq: [
      [
        "Why does Google Calendar print so badly?",
        "Its print view squeezes short events and cuts off details. A made page gives each day room, so nothing gets cut.",
      ],
      ["Can it do a month instead?", "Yes. Ask for a monthly page, or a whole term of weekly pages in one PDF."],
    ],
    byHand: [
      "In Google Calendar on a computer, switch to Week view and choose Print from the settings menu.",
      "Set the size there, then save it as a PDF.",
    ],
    related: ["planning/make-a-custom-goodnotes-planner", "publishing/make-a-printable-planner", "contacts-calendar-email/convert-ics-to-excel"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-an-aesthetic-notion-widget-page",
    niche: "planning",
    searchPhrases: ["notion widgets", "aesthetic notion widgets", "notion widgets free", "notion widgets countdown"],
    title: "Aesthetic Notion widgets made to match your page",
    description:
      "A clock, weather, countdown and daily quote in your own colours and fonts. Stella (stella.sh) makes the widgets and places them on your Notion page.",
    h1: "Aesthetic Notion widgets for your page",
    short: "Aesthetic Notion widget page",
    lede: "A clock, weather, countdown and quote that match your page's colours.",
    answer:
      "Say the look you want and Stella (stella.sh) makes your own widgets in your colours and fonts, puts them online on a free host you sign in to, and places them on your Notion page.",
    gets: [
      "Clock, weather, countdowns, quotes or a photo slideshow",
      "Your exact colours and fonts, not a preset",
      "No widget site account or watermark",
    ],
    prompt:
      "Make my Notion homepage aesthetic with matching widgets: a clock, the weather in Leeds, a countdown to my exams on 12 May and a daily quote, all beige and soft brown.",
    demo: {
      ack: "Cosy palette. Making your widgets now.",
      task: "Making your Notion widgets",
      rows: [
        "Making clock, weather, countdown and quote",
        "Putting them on your free web space",
        "Placing them in two columns in Notion",
      ],
      reply:
        "Done. Your **Home** page in Notion now has a beige clock and Leeds weather side by side, then your exam countdown and a new quote each morning. They show in the Notion phone app too.",
    },
    faq: [
      [
        "Are these Notion widgets free?",
        "Yes. They're small web pages that belong to you, kept on a free host, so there's no widget subscription.",
      ],
      ["Do widgets show in the Notion phone app?", "Yes. They appear on the page in the app on iPhone and Android, stacked to fit the smaller screen."],
    ],
    byHand: [
      "Pick widgets on [Indify](https://indify.co) or [WidgetBox](https://widgetbox.app), set the colours, and copy each link.",
      "In Notion, type /embed, paste the link, then resize and drag them into columns.",
    ],
    related: ["planning/make-a-notion-dashboard", "planning/make-a-notion-habit-tracker", "websites/host-a-website-for-free"],
    lastChecked: "2026-11-24",
  }),
];
