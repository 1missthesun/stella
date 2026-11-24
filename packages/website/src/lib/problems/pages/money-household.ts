import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const MONEY_HOUSEHOLD_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "make-a-budget-from-bank-statement",
    niche: "money-household",
    searchPhrases: [
      "make a budget from bank statement",
      "budget spreadsheet",
      "spending tracker spreadsheet",
      "categorize bank transactions in excel",
      "create budget from bank statement",
    ],
    title: "Make a budget from your bank statement (without double counting)",
    description:
      "Make a budget from your bank and card statements: monthly averages per category, with card payments and transfers never counted twice. Stella (stella.sh) builds it.",
    h1: "Make a budget from your bank statements",
    short: "Budget from bank statements",
    lede: "See what you really spend each month, from your bank downloads",
    answer:
      "Give Stella (stella.sh) your bank and card downloads. It sorts every purchase into categories, leaves out pay, transfers and card payments so nothing counts twice, and saves a budget spreadsheet of monthly averages.",
    gets: [
      "Monthly average for each category",
      "Card payments and transfers kept out",
      "Refunds taken off what you spent",
    ],
    prompt:
      "Use my bank and credit card downloads to make me a simple budget: what I spend a month on average on rent, groceries, eating out, transport, bills, shopping and everything else.",
    demo: {
      ack: "Sure. Going through three months now.",
      task: "Budget from July to September",
      rows: ["Reading the bank and card files", "Leaving out card payments and savings"],
      reply:
        "You spend about **$3,671 a month**. Rent is $1,650, groceries $722, bills $327. The full budget is in Documents.",
      files: ["Budget Jul-Sep 2026.xlsx"],
    },
    faq: [
      ["Why does my budget count some spending twice?", "The card payment from your bank account is the same money as the purchases on the card. Count the purchases and drop the payment."],
    ],
    byHand: [
      "Download three full months from each account and card as CSV, and paste them onto one sheet.",
      "Delete card payments, transfers to savings and pay. Leave refunds in as negative spending.",
      "Add a Category column, total it with a PivotTable, and divide by the number of months.",
    ],
    related: [
      "pdf-excel/find-subscriptions-in-bank-statement",
      "money-household/find-duplicate-charges-on-credit-card",
      "money-household/convert-ofx-to-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "find-duplicate-charges-on-credit-card",
    niche: "money-household",
    searchPhrases: [
      "find duplicate charges on credit card",
      "double charged on credit card",
      "duplicate transactions",
      "duplicate charges on bank statement",
    ],
    title: "Find duplicate charges on your credit card statement",
    description:
      "Find duplicate charges on your credit card statement, telling real doubles from normal repeats and skipping ones already refunded. Stella (stella.sh) makes the list.",
    h1: "Find duplicate charges on your credit card",
    short: "Find duplicate card charges",
    lede: "Spot the things you were charged for twice",
    answer:
      "Ask Stella (stella.sh) to check your card download. It finds charges billed twice, leaves out normal repeats like parking and ones already refunded, and saves a list you can send to the card company.",
    gets: [
      "Every double charge with date and amount",
      "Doubles under two merchant names caught",
      "Refunded ones and normal repeats left out",
    ],
    prompt:
      "I think I've been charged twice for some things. Go through my credit card download, find any double charges, and save a list I can send to the bank.",
    demo: {
      ack: "Let's find them. Reading your charges.",
      task: "Double charges, Aug to Oct",
      rows: ["Reading 312 transactions", "Matching same amount, same day"],
      reply:
        "Two charges were clearly billed twice, a hotel and a dentist, **$309** in all. Two more pairs need you to confirm. The list is in Downloads.",
    },
    faq: [
      ["How do I know if I was really charged twice?", "Same merchant, same amount, within a day or so, and no refund later. A pending charge next to the final one usually drops off by itself."],
    ],
    byHand: [
      "Download your card activity as CSV once the charges have posted.",
      "Sort by description, then amount, and look for the same amount on the same or next day.",
      "Check each pair for a later refund, then contact the merchant or card issuer about the rest.",
    ],
    related: [
      "pdf-excel/find-subscriptions-in-bank-statement",
      "money-household/make-a-budget-from-bank-statement",
      "money-household/convert-ofx-to-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-ofx-to-excel",
    niche: "money-household",
    searchPhrases: [
      "convert ofx to excel",
      "ofx file",
      "qif file",
      "ofx to csv",
      "qfx to csv",
      "qif to excel",
      "how to open ofx file",
    ],
    title: "Convert OFX, QFX and QIF bank files to Excel",
    description:
      "Convert OFX, QFX and QIF bank files to Excel with date, payee, amount and memo on every row. Stella (stella.sh) does it on your computer, nothing uploaded.",
    h1: "Convert OFX, QFX and QIF files to Excel",
    short: "OFX, QFX and QIF to Excel",
    lede: "Open your bank's OFX, QFX or QIF files as normal spreadsheets",
    answer:
      "Excel can't open OFX, QFX or QIF files properly. Stella (stella.sh) turns each one into a spreadsheet with the date, payee, amount and memo of every transaction, spending shown as negative numbers.",
    gets: ["One spreadsheet per bank file", "Date, payee, amount and memo on each row", "Works for old QIF files too"],
    prompt:
      "My bank only lets me download QFX, OFX and QIF files and I can't open them. Turn each one into an Excel spreadsheet with the date, payee, amount and memo.",
    demo: {
      ack: "Sure. Opening the three bank files.",
      task: "Bank files to Excel",
      rows: ["Reading the checking, savings and joint files", "Sorting every transaction by date"],
      reply:
        "Done. Three spreadsheets are next to the originals: 40, 21 and 25 transactions. One check number is used twice, worth asking the bank about.",
      files: ["Checking_Oct2026.xlsx", "Savings_2026.xlsx", "Old joint account 2019.xlsx"],
    },
    faq: [
      ["OFX vs QFX: what's the difference?", "QFX is OFX with a few extra fields for Quicken. QIF is Quicken's older format. All three hold bank transactions."],
      ["How do I open an OFX or QFX file in Excel?", "Excel shows it as a jumble of codes, not rows. Convert it first, or ask your bank for a CSV."],
      ["Can I convert OFX to CSV or PDF instead?", "Yes. Ask for CSV, or a PDF to print."],
    ],
    byHand: [
      "Check your bank for a CSV or Excel download first; it may be labelled Spreadsheet or Comma delimited.",
      "Otherwise install the free GnuCash and use File, Import, Import OFX/QFX (or Import QIF).",
      "Then File, Export, Export Transactions to CSV, and open that in Excel.",
    ],
    related: [
      "pdf-excel/bank-statement-pdf-to-excel",
      "money-household/make-a-budget-from-bank-statement",
      "money-household/find-duplicate-charges-on-credit-card",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "how-much-have-i-spent-on-amazon",
    niche: "money-household",
    searchPhrases: [
      "how much have i spent on amazon",
      "amazon order history report",
      "amazon order history export",
      "how much have i spent on amazon last year",
    ],
    title: "How much have I spent on Amazon? Yearly totals after refunds",
    description:
      "See how much you've spent on Amazon each year, after refunds and cancelled orders, from your Amazon data download. Stella (stella.sh) adds it up for you.",
    h1: "How much have I spent on Amazon each year?",
    short: "How much I've spent on Amazon",
    lede: "Your Amazon spending for each year, after refunds",
    answer:
      "Request your order data from Amazon, then give the zip to Stella (stella.sh). It adds up each year's orders, leaves out cancelled ones, takes off refunds and saves a spreadsheet you can check line by line.",
    gets: ["What you spent each year, after refunds", "Cancelled orders left out", "Every order line there to check"],
    prompt:
      "I requested my data from Amazon and got a zip in my Downloads. How much have I spent on Amazon each year, after refunds? Save it as a spreadsheet.",
    demo: {
      ack: "Sure. Adding up your orders.",
      task: "Amazon spending by year",
      rows: ["Reading every order line", "Leaving out cancelled orders"],
      reply:
        "After refunds you spent **$4,581.67** in 2025 and **$2,894.15** so far in 2026. Every year from 2022 is in the spreadsheet next to the zip.",
      files: ["Amazon spend by year.xlsx"],
    },
    faq: [
      ["Where did Amazon's order history report go?", "Amazon removed it. Your full history now comes from the Request Your Data page, as a zip sent by email."],
    ],
    byHand: [
      "On amazon.com, open Request Your Data, choose Your Orders and confirm the email.",
      "Open Retail.OrderHistory.1.csv, filter out Cancelled, and total Total Owed by year with a PivotTable.",
      "Do the same with the refunds file and subtract it from each year.",
    ],
    related: [
      "money-household/make-a-budget-from-bank-statement",
      "pdf-excel/receipts-to-spreadsheet",
      "pdf-excel/find-subscriptions-in-bank-statement",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "mileage-log-for-taxes",
    niche: "money-household",
    searchPhrases: [
      "mileage log for taxes",
      "mileage log",
      "mileage reimbursement calculator",
      "mileage tracker spreadsheet",
      "irs mileage rate 2026",
    ],
    title: "Mileage log for taxes: business miles and the 2026 IRS rates",
    description:
      "Total your mileage log for taxes: business miles by month and the claim at the 2026 IRS rates, personal trips left out. Stella (stella.sh) works it out.",
    h1: "Total your mileage log for taxes",
    short: "Mileage log for taxes",
    lede: "Your business miles and what you can claim, from the log you kept",
    answer:
      "Give Stella (stella.sh) your car log. It totals business miles by month, fills gaps from odometer readings, leaves out personal trips and works out your claim at this year's IRS rate.",
    gets: [
      "Business miles for each month and the year",
      "Your claim at both 2026 rates",
      "Missing miles worked out from the odometer",
    ],
    prompt:
      "My car log for this year is in my Documents. Work out my business miles for each month and the year so far, and what I can claim at this year's IRS rate.",
    demo: {
      ack: "Sure. Going through your trips.",
      task: "Business mileage for 2026",
      rows: ["Reading 113 trips", "Leaving out personal driving"],
      reply:
        "You drove **2,799 business miles** from January to October. At 72.5¢ to June and 76¢ from July, that's **$2,071.77**.",
      files: ["Business mileage 2026.xlsx"],
    },
    faq: [
      ["What is the IRS mileage rate for 2026?", "72.5¢ a mile from 1 January to 30 June 2026, and 76¢ from 1 July, after a mid-year rise."],
    ],
    byHand: [
      "Where miles are blank, take the start odometer reading from the end one.",
      "Mark each trip business or personal, and total business miles per month.",
      "Multiply January to June by $0.725 and July to December by $0.76, then add them.",
    ],
    related: [
      "money-household/calculate-hours-worked-from-timesheet",
      "pdf-excel/receipts-to-spreadsheet",
      "money-household/make-a-budget-from-bank-statement",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "calculate-hours-worked-from-timesheet",
    niche: "money-household",
    searchPhrases: [
      "calculate hours worked",
      "timesheet calculator",
      "time card calculator",
      "how to calculate hours worked in excel with lunch break",
      "calculate hours worked in excel",
    ],
    title: "Calculate hours worked from a timesheet, with breaks and overtime",
    description:
      "Calculate hours worked from a timesheet: unpaid breaks off, overnight shifts counted right, and overtime past 40 a week. Stella (stella.sh) does everyone at once.",
    h1: "Calculate hours worked from a timesheet",
    short: "Hours worked from a timesheet",
    lede: "Everyone's weekly hours and overtime, breaks taken off",
    answer:
      "Give Stella (stella.sh) your time clock export. It works out every shift minus unpaid breaks, overnight ones too, totals each person's week and splits out overtime past 40 hours.",
    gets: [
      "Weekly hours for each person",
      "Overtime past 40 shown separately",
      "Missed clock-outs pointed out, not guessed",
    ],
    prompt:
      "Add up the hours everyone worked from the time clock export in my Documents, for each of the two weeks starting Monday, minus unpaid breaks, with overtime over 40.",
    demo: {
      ack: "Sure. Working through the shifts.",
      task: "Two weeks of payroll hours",
      rows: ["Reading 60 shifts for six people", "Taking off unpaid breaks"],
      reply:
        "Everyone's hours and overtime are in a new spreadsheet in Documents. One shift has no clock-out, so I left it at zero. What time did she leave?",
    },
    faq: [
      ["How do I calculate hours worked in Excel with a lunch break?", "Clock-out minus clock-in, minus the unpaid break. With the break in minutes: =MOD(out-in,1)*24-break/60. This works for overnight shifts too."],
    ],
    byHand: [
      "Make sure clock times show as times; convert text with =TIMEVALUE(B2).",
      "Work out each shift with =MOD(out-in,1)*24-break/60.",
      "Total per person and week with a PivotTable. Overtime is =MAX(0,hours-40).",
    ],
    related: [
      "money-household/mileage-log-for-taxes",
      "documents/generate-invoices-from-spreadsheet",
      "pdf-excel/summarize-spreadsheet-by-category",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "find-subscriptions-in-gmail",
    niche: "money-household",
    searchPhrases: [
      "find subscriptions in gmail",
      "find my subscriptions in gmail",
      "find subscriptions i forgot about",
      "how to find subscriptions in email",
      "subscription receipts in email",
    ],
    title: "Find every paid subscription hiding in your Gmail",
    description:
      "Find every paid subscription in your Gmail: renewal receipts, free trials that turned paid and app store charges, each with its price. Stella (stella.sh) lists them.",
    h1: "Find all my subscriptions in Gmail",
    short: "Subscriptions in your Gmail",
    lede: "Every paid plan in your inbox, with what it costs you",
    answer:
      "Ask Stella (stella.sh) to go through your Gmail. It finds renewal receipts, trials that turned paid and app store charges, and saves one list with each service, its price, how often it bills and the next date.",
    gets: [
      "Every service that billed you this year",
      "Monthly and yearly cost side by side",
      "Free trials that quietly became paid",
    ],
    prompt:
      "I feel like I'm paying for stuff I forgot about. Go through my Gmail receipts from the last year and list every subscription with what it costs.",
    demo: {
      ack: "On it. Searching your Gmail for receipts.",
      task: "Subscriptions in your Gmail",
      rows: ["Searching a year of receipts", "Grouping charges by service", "Spotting trials that turned paid"],
      reply:
        "You have **14 subscriptions** costing **$187 a month**. Three look forgotten: a meditation app, a photo storage plan and a news site you stopped reading in spring. The list is in Documents.",
      files: ["Subscriptions from Gmail.xlsx"],
    },
    faq: [
      ["Why doesn't Gmail's Manage subscriptions show what I pay for?", "That page lists mailing lists that email you, not paid plans. Paid ones show up as receipts and renewal notices instead."],
      ["What about subscriptions that never email me?", "Some only appear on your card. Add your bank download and Stella checks both."],
    ],
    byHand: [
      "In Gmail, search: receipt OR renewal OR \"your subscription\" newer_than:1y.",
      "Open each result and note the service, price and billing date in a sheet.",
      "For phone apps, check Subscriptions in your iPhone settings or Payments and subscriptions in Google Play.",
    ],
    related: [
      "money-household/cancel-forgotten-subscriptions",
      "pdf-excel/find-subscriptions-in-bank-statement",
      "money-household/bulk-unsubscribe-from-emails",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "cancel-forgotten-subscriptions",
    niche: "money-household",
    searchPhrases: [
      "cancel forgotten subscriptions",
      "how to cancel subscriptions you forgot about",
      "cancel unwanted subscriptions",
      "how do i cancel all subscriptions on my card",
      "find and cancel forgotten subscriptions",
    ],
    title: "Cancel forgotten subscriptions, one cancel page at a time",
    description:
      "Cancel the subscriptions you forgot about: Stella (stella.sh) finds how each one cancels, opens the cancel page in your browser and goes through the steps with you.",
    h1: "Cancel forgotten subscriptions you still pay for",
    short: "Cancel forgotten subscriptions",
    lede: "Stop paying for the things you stopped using",
    answer:
      "Tell Stella (stella.sh) which subscriptions to drop. It finds how each one cancels, opens the cancel page in your browser where you're already signed in, goes through the steps with you and saves each confirmation.",
    gets: [
      "The right cancel page for each service",
      "Phone app plans sent to Apple or Google Play",
      "A screenshot of every confirmation",
    ],
    prompt:
      "Cancel the meditation app, the photo storage plan and the news site from my subscription list. I don't want any of them anymore.",
    demo: {
      ack: "Sure. Finding how each one cancels.",
      task: "Cancelling three subscriptions",
      rows: ["Opening the news site's account page", "Meditation app is billed through Apple", "Saving each confirmation"],
      reply:
        "All three are cancelled. The news site and photo plan stop at the end of this month; the meditation app runs to **Dec 14**. Confirmations are in Documents, Cancelled 2026.",
      files: ["News site cancelled.png", "Photo plan cancelled.png", "Meditation app cancelled.png"],
    },
    faq: [
      ["How do I cancel a subscription I pay for through my phone?", "Plans bought inside an app are cancelled with Apple or Google, not the company. On iPhone: Settings, your name, Subscriptions. On Android: Play Store, Payments and subscriptions."],
      ["Can my bank stop a subscription?", "Many banks can block a company from charging your card again. Cancel with the company too, so the account closes cleanly."],
    ],
    byHand: [
      "Search the service's help pages for cancel, or look under Account, Billing or Plan.",
      "Turn down the discount offers until you reach the final confirmation.",
      "Screenshot the confirmation and write down the date your access ends.",
    ],
    related: [
      "money-household/find-subscriptions-in-gmail",
      "pdf-excel/find-subscriptions-in-bank-statement",
      "money-household/find-duplicate-charges-on-credit-card",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "bulk-unsubscribe-from-emails",
    niche: "money-household",
    searchPhrases: [
      "bulk unsubscribe gmail",
      "how to mass unsubscribe from emails",
      "unsubscribe from all emails at once",
      "bulk unsubscribe outlook",
      "unsubscribe from multiple emails gmail",
    ],
    title: "Bulk unsubscribe from emails in Gmail and Outlook",
    description:
      "Bulk unsubscribe from the mailing lists flooding your Gmail or Outlook, keeping the ones you read and clearing out their old emails. Stella (stella.sh) does the lot.",
    h1: "Bulk unsubscribe from emails in Gmail and Outlook",
    short: "Bulk unsubscribe from emails",
    lede: "Stop the newsletters and shop emails you never open",
    answer:
      "Ask Stella (stella.sh) to clean up who emails you. It ranks every sender by how much they send and whether you open it, unsubscribes from the ones you ignore, and moves their old emails to the bin.",
    gets: [
      "Senders ranked by how often they email",
      "The ones you actually read, kept",
      "Old emails from dropped senders binned",
    ],
    prompt:
      "My Gmail is full of store emails and newsletters I never read. Unsubscribe me from all of them except my bank, school and the two cooking newsletters I like.",
    demo: {
      ack: "Happy to. Looking at who emails you most.",
      task: "Unsubscribing from mailing lists",
      rows: ["Ranking 212 senders", "Keeping bank, school and cooking", "Unsubscribing from 87 lists", "Moving their emails to the bin"],
      reply:
        "Done. You're off **87 mailing lists**, and 9,412 of their emails sit in the bin for 30 days. The full list is in Documents.",
    },
    faq: [
      ["Does Gmail have a bulk unsubscribe button?", "Gmail's Manage subscriptions page unsubscribes one sender per click. It doesn't clear their old emails or know which ones you read."],
      ["Does it work for Outlook and Yahoo too?", "Yes. Stella does the same in Outlook.com and Yahoo Mail, in the browser where you're signed in."],
    ],
    byHand: [
      "In Gmail on the web, open Manage subscriptions in the left menu and click Unsubscribe beside each sender.",
      "In Outlook.com, open an email from the sender and use the Unsubscribe link at the top.",
      "Search for each sender's address and delete their old emails.",
    ],
    related: [
      "money-household/gmail-storage-full",
      "money-household/find-subscriptions-in-gmail",
      "contacts-calendar-email/open-mbox-file",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "gmail-storage-full",
    niche: "money-household",
    searchPhrases: [
      "gmail storage full",
      "clean up gmail storage",
      "delete all promotions gmail",
      "delete emails with large attachments gmail",
      "gmail storage full but nothing to delete",
    ],
    title: "Gmail storage full? Free up space and keep what matters",
    description:
      "Gmail storage full? Stella (stella.sh) clears old promotions and social updates, finds the biggest attachments and saves the files you want to your computer first.",
    h1: "Gmail storage full? Free up space",
    short: "Gmail storage full",
    lede: "Room in your inbox again, with the important stuff kept",
    answer:
      "Ask Stella (stella.sh) to free up your Google storage. It deletes old promotions and social updates, saves the files from emails with the largest attachments to your computer, then clears those emails and the bin.",
    gets: [
      "Old promotions and social emails cleared",
      "Biggest attachments saved to a folder first",
      "Space used by Drive and Photos shown too",
    ],
    prompt:
      "My Gmail says storage is full and I'm not getting emails. Delete old promotions and anything with huge attachments, but save the photos and PDFs to my computer first.",
    demo: {
      ack: "Sure. Checking what's filling it up.",
      task: "Freeing up Gmail space",
      rows: ["Deleting 14,920 promotions over a year old", "Saving attachments over 10 MB", "Emptying the bin"],
      reply:
        "You've gone from **15 GB to 9.2 GB**. 312 photos and PDFs from big emails are saved in Downloads, Gmail attachments. Most of the rest is Google Photos.",
    },
    faq: [
      ["Why is my Gmail storage full when I have few emails?", "Your 15 GB is shared by Gmail, Google Drive and Google Photos. Photo backups or big Drive files often take most of it."],
      ["Does deleting emails free space right away?", "Only once they leave the bin, which Gmail empties after 30 days. Empty it yourself to get the space now."],
    ],
    byHand: [
      "Search category:promotions older_than:1y, select all, click Select all conversations that match, and delete.",
      "Search larger:10M to find the heaviest emails, download what you need, then delete them.",
      "Empty the Bin, then check one.google.com/storage for Drive and Photos.",
    ],
    related: [
      "money-household/bulk-unsubscribe-from-emails",
      "pc-cleanup/find-large-files-taking-up-space",
      "contacts-calendar-email/open-mbox-file",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "email-receipts-to-spreadsheet",
    niche: "money-household",
    searchPhrases: [
      "email receipts to spreadsheet",
      "export receipts from gmail to excel",
      "how to find receipts in email",
      "track online purchases from email",
      "gmail receipts to google sheets",
    ],
    title: "Turn the receipts in your email into one spreadsheet",
    description:
      "Turn the order confirmations and receipts in your Gmail or Outlook into one spreadsheet: store, date, items and total for each. Stella (stella.sh) builds it.",
    h1: "Get my email receipts into a spreadsheet",
    short: "Email receipts to a spreadsheet",
    lede: "Every online purchase in one sheet, from the receipts in your inbox",
    answer:
      "Ask Stella (stella.sh) to gather your receipts. It searches your inbox for order confirmations and invoices, pulls out the store, date, items, tax and total, adds any receipt photos from a folder, and saves one spreadsheet.",
    gets: [
      "Store, date, items, tax and total per receipt",
      "Refunds and cancelled orders marked",
      "PDF receipts saved beside the sheet",
    ],
    prompt:
      "Find every receipt and order confirmation in my Gmail from this year and put them in one spreadsheet with the store, date, what I bought and the total.",
    demo: {
      ack: "Sure. Searching your inbox for receipts.",
      task: "2026 receipts from Gmail",
      rows: ["Finding 241 receipts and invoices", "Reading store, items and totals", "Saving PDF receipts to a folder"],
      reply:
        "Done. **241 purchases** from January to now, **$8,906** in all, with 12 refunds marked. The sheet and a folder of PDF receipts are in Documents, Receipts 2026.",
      files: ["Receipts 2026.xlsx"],
    },
    faq: [
      ["How do I find all my receipts in email?", "Search for receipt, order, invoice or \"thank you for your order\". Many land in the Updates or Promotions tab, so search all mail, not just the inbox."],
      ["Can it sort them for an expense report?", "Yes. Ask for categories or a business and personal column, and it fills them in."],
    ],
    byHand: [
      "Search Gmail for receipt OR invoice OR \"order confirmation\" with a date range.",
      "Open each one and type the store, date and total into a sheet.",
      "Print each to PDF into one folder so you can find it later.",
    ],
    related: [
      "pdf-excel/receipts-to-spreadsheet",
      "money-household/organize-tax-documents",
      "money-household/how-much-have-i-spent-on-amazon",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "splitwise-alternative",
    niche: "money-household",
    searchPhrases: [
      "splitwise alternative",
      "splitwise alternative free",
      "splitwise alternative excel",
      "shared expenses google sheet",
      "shared expense tracker for roommates",
    ],
    title: "A free Splitwise alternative: a shared sheet that does the math",
    description:
      "A free Splitwise alternative: a shared Google Sheet where everyone adds what they paid and a balance tab shows who owes who. Stella (stella.sh) sets it up for you.",
    h1: "A free Splitwise alternative for roommates",
    short: "Free Splitwise alternative",
    lede: "Everyone logs what they paid; the sheet keeps the running balance",
    answer:
      "Ask Stella (stella.sh) for a shared expenses sheet. It builds a Google Sheet with a simple form for adding costs, splits each one evenly or by share, and keeps a balance tab showing who owes who right now.",
    gets: [
      "A form anyone can fill in from their phone",
      "Even, percentage or item by item splits",
      "A live balance of who owes who",
    ],
    prompt:
      "My roommates and I keep losing track of who paid for groceries and bills. Make us a shared Google Sheet like Splitwise that anyone can add to.",
    demo: {
      ack: "Good idea. Building it in your Google account.",
      task: "Shared house expenses sheet",
      rows: ["Creating the sheet and an add-expense form", "Adding a Balances tab", "Making a link the house can use"],
      reply:
        "Ready. **House expenses** is in your Google Drive. Drop the form link in the house chat; the Balances tab always shows who owes who.",
    },
    faq: [
      ["Is there a free Splitwise alternative?", "Yes. A shared Google Sheet does the same job at no cost, with no ads and no daily cap on entries."],
      ["Can rent be split unevenly?", "Yes. Give each person a share, like 30% for the bigger room, and every bill uses those shares unless you say otherwise."],
    ],
    byHand: [
      "Make a Google Sheet with columns for date, item, amount, who paid and who shares it.",
      "Add a Google Form that writes into it, and share the form link.",
      "On a second tab, total what each person paid minus their share.",
    ],
    related: [
      "pdf-excel/split-bills-with-roommates",
      "money-household/split-bill-by-item",
      "apps/turn-a-spreadsheet-into-an-app",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "split-bill-by-item",
    niche: "money-household",
    searchPhrases: [
      "split bill by item",
      "split bill by item calculator",
      "split bill from receipt",
      "how to split a bill with tax and tip",
      "split the check calculator",
    ],
    title: "Split the bill by item, with tax and tip shared fairly",
    description:
      "Split a group dinner bill by what each person had, with shared plates, tax and tip divided fairly. Send Stella (stella.sh) a photo of the receipt and who ate what.",
    h1: "Split the bill by item after a group dinner",
    short: "Split the bill by item",
    lede: "Everyone pays for what they had, from one photo of the receipt",
    answer:
      "Send Stella (stella.sh) a photo of the receipt and say who had what. It reads every line, splits shared plates between the people who ate them, spreads tax and tip by each share, and tells everyone what to send.",
    gets: [
      "Each person's total, down to the cent",
      "Shared starters and bottles split between who had them",
      "Tax and tip in proportion to what you ordered",
    ],
    prompt:
      "I paid our dinner bill, photo attached. Sam had the steak, Priya and Leo shared the pasta and wine, I had the fish. Add 20% tip. What does everyone owe me?",
    demo: {
      ack: "Sure. Reading the receipt now.",
      task: "Splitting the dinner bill",
      rows: ["Reading 11 lines from the photo", "Splitting the pasta and wine two ways", "Adding tax and a 20% tip"],
      reply:
        "The bill comes to **$248.40** with tip. Sam owes you **$71.10**, Priya **$58.25** and Leo **$58.25**. Your share is $60.80. Here's a message to paste in the group chat.",
    },
    faq: [
      ["How do you split a bill with tax and tip fairly?", "Work out each person's share of the food before tax, then give them the same share of the tax and tip. Big orders pay more of both."],
    ],
    byHand: [
      "Write each item next to the person who had it; divide shared ones by how many shared.",
      "Divide each person's subtotal by the bill's subtotal to get their share.",
      "Multiply the full total, with tax and tip, by each share.",
    ],
    related: [
      "pdf-excel/split-bills-with-roommates",
      "money-household/splitwise-alternative",
      "money-household/email-receipts-to-spreadsheet",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "bill-due-date-tracker",
    niche: "money-household",
    searchPhrases: [
      "bill due date tracker",
      "bill tracker spreadsheet",
      "bill reminder app free",
      "bills calendar",
      "bill due date calendar",
    ],
    title: "Bill due date tracker with a reminder before each one",
    description:
      "A bill due date tracker made from your bank downloads and email: every bill, amount and due date in a sheet and calendar, with reminders. Stella (stella.sh) sets it up.",
    h1: "A bill due date tracker that reminds me",
    short: "Bill due date tracker",
    lede: "Every bill and its due date in one place, with a nudge before each",
    answer:
      "Ask Stella (stella.sh) to round up your bills. It finds them in your bank downloads and email, lists each amount and due date, adds them to your calendar, and reminds you on your phone before each.",
    gets: [
      "Every bill with amount, due date and how it's paid",
      "Due dates added to your calendar",
      "A reminder two days before each",
    ],
    prompt:
      "I keep missing due dates. Find my monthly bills from my bank download and emails, list the amounts and dates, and remind me two days before each.",
    demo: {
      ack: "Sure. Finding your regular bills.",
      task: "Bills and due dates",
      rows: ["Reading three months of bank activity", "Matching bills to their emails", "Adding due dates to your calendar"],
      reply:
        "You have **11 bills**, $2,486 a month. Seven are on autopay, so I'll remind you two days before the other four, starting with electric on **Dec 3**. The list is in Documents.",
      files: ["Bills and due dates.xlsx"],
    },
    faq: [
      ["Is there a free bill reminder app?", "Your phone's calendar works, with an alert before each due date. Stella also sends the reminder itself, in the chat and in the Stella phone app."],
      ["What if a bill's amount changes each month?", "Each reminder uses the latest amount from that bill's email."],
    ],
    byHand: [
      "Go through two months of statements and note every regular bill, amount and due date.",
      "Add each as a repeating event in your phone's calendar with an alert two days early.",
      "Mark which are on autopay so you know which to pay yourself.",
    ],
    related: [
      "money-household/make-a-budget-from-bank-statement",
      "money-household/find-subscriptions-in-gmail",
      "money-household/net-worth-spreadsheet",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "return-deadline-tracker",
    niche: "money-household",
    searchPhrases: [
      "return deadline tracker",
      "return date tracker",
      "when does my amazon return window close",
      "track return deadlines from order emails",
      "holiday return deadlines",
    ],
    title: "Return deadline tracker: never miss a return window again",
    description:
      "Track the return deadline of everything you buy online. Stella (stella.sh) reads your order emails, works out each last return day and reminds you before it closes.",
    h1: "A return deadline tracker for my online orders",
    short: "Return deadline tracker",
    lede: "The last day to send back each thing you ordered, with a nudge",
    answer:
      "Ask Stella (stella.sh) to keep an eye on your returns. It reads your order and delivery emails, works out each item's last return day from the store's policy, saves the list, and reminds you a few days before each window closes.",
    gets: [
      "Last return day for every recent order",
      "Holiday return extensions counted",
      "A reminder before each window closes",
    ],
    prompt:
      "I bought a lot of stuff online this month and always miss the return window. Go through my order emails and remind me before each return deadline.",
    demo: {
      ack: "Sure. Reading your order emails.",
      task: "Return deadlines for November",
      rows: ["Finding 23 orders and delivery dates", "Looking up each store's return policy", "Setting reminders three days before"],
      reply:
        "Your first deadline is the **Zara jacket on Dec 9**. Your Amazon orders have their holiday return dates from the order emails. All 23 are listed in Documents, and I'll remind you before each.",
    },
    faq: [
      ["Does the return window start when I order or when it arrives?", "Most stores count from delivery, some from the order date. Stella follows each store's own rule."],
      ["Can it start a return for me?", "Yes. It opens the store's return page with the order picked, fills in the reason and gets the label ready to print."],
    ],
    byHand: [
      "Search your email for shipped or delivered and note each item's delivery date.",
      "Look up each store's return days and add them to that date.",
      "Put each last day in your calendar with an alert a few days before.",
    ],
    related: [
      "money-household/email-receipts-to-spreadsheet",
      "watches/price-drop-alert",
      "money-household/find-unclaimed-money",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "find-unclaimed-money",
    niche: "money-household",
    searchPhrases: [
      "find unclaimed money in my name",
      "money owed to me",
      "unclaimed money free search",
      "find unused gift cards in email",
    ],
    title: "Find money owed to you: unclaimed funds, gift cards, refunds",
    description:
      "Find money owed to you: unclaimed funds in your name on state sites, forgotten gift cards and store credit in your email, and refunds that never came. Stella (stella.sh).",
    h1: "Find unclaimed money in my name",
    short: "Find money owed to you",
    lede: "Old deposits, gift cards and refunds you forgot, found and listed",
    answer:
      "Ask Stella (stella.sh) to look for money you're owed. It searches the free state unclaimed money sites for your name, digs gift cards, store credit and missing refunds out of your email, and lists what to claim.",
    gets: [
      "Unclaimed funds in every state you've lived in",
      "Gift card codes and store credit with balances",
      "Refunds promised but never paid",
    ],
    prompt:
      "Check if there's any unclaimed money in my name. I've lived in Ohio and Texas. Also find any gift cards, store credit or refunds in my email I never used.",
    demo: {
      ack: "Let's look. Starting with the state sites.",
      task: "Money owed to you",
      rows: ["Searching Ohio and Texas unclaimed funds", "Finding gift cards and store credit", "Checking refunds against your bank"],
      reply:
        "Found **$612**: an old utility deposit in Ohio, two gift cards never used and a $38 refund that never arrived. The Ohio claim form is filled in for you to sign. Everything is listed in Documents.",
    },
    faq: [
      ["Is MissingMoney.com legit?", "Yes. It's run by the state unclaimed property offices' association and searches most states at once, for free."],
      ["How do I check a gift card balance?", "Most stores have a gift card balance page that needs the card number and PIN. Stella checks each card it finds."],
    ],
    byHand: [
      "Search your name on MissingMoney.com, then on each state's own site, listed at unclaimed.org.",
      "Search your email for gift card, store credit and refund.",
      "Check each card on the store's gift card balance page.",
    ],
    related: [
      "money-household/return-deadline-tracker",
      "money-household/find-duplicate-charges-on-credit-card",
      "money-household/email-receipts-to-spreadsheet",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "net-worth-spreadsheet",
    niche: "money-household",
    searchPhrases: [
      "net worth spreadsheet",
      "net worth tracker spreadsheet",
      "how to calculate net worth",
      "net worth spreadsheet google sheets",
    ],
    title: "Make a simple net worth spreadsheet you update each month",
    description:
      "Make a simple net worth spreadsheet: what you own minus what you owe, from your account statements, with a monthly chart. Stella (stella.sh) builds and fills it in.",
    h1: "Make a simple net worth spreadsheet",
    short: "Net worth spreadsheet",
    lede: "What you own minus what you owe, on one page, month by month",
    answer:
      "Give Stella (stella.sh) your latest statements or just the numbers. It builds a net worth spreadsheet of savings, investments, home and car against loans and cards, adds a chart over time, and updates it whenever you send new balances.",
    gets: [
      "Everything you own and owe on one page",
      "A chart of how it changes each month",
      "Home and car at sensible estimates",
    ],
    prompt:
      "Make me a simple net worth spreadsheet. My statements are in Documents/Finances. Include my 401k, savings, the house and car, minus the mortgage, car loan and credit card.",
    demo: {
      ack: "Sure. Reading your latest statements.",
      task: "Net worth as of November",
      rows: ["Reading eight statements", "Valuing the car from similar ones for sale", "Adding a monthly chart"],
      reply:
        "Your net worth is **$186,400**: $512,900 you own and $326,500 you owe. Send new balances each month and I'll add a row. It's in Documents/Finances.",
      files: ["Net worth.xlsx"],
    },
    faq: [
      ["How do you calculate net worth?", "Add up what you own: cash, investments, retirement accounts, your home and car. Take away everything you owe. What's left is your net worth."],
      ["Should I count my house?", "Most people do, at a realistic sale price, with the mortgage on the owe side."],
    ],
    byHand: [
      "List every account and asset with its balance, and every loan and card with what's owed.",
      "Total each side and subtract what you owe from what you own.",
      "Add a dated row each month and chart the total.",
    ],
    related: [
      "money-household/make-a-budget-from-bank-statement",
      "apps/make-your-own-budget-app",
      "money-household/bill-due-date-tracker",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "organize-tax-documents",
    niche: "money-household",
    searchPhrases: [
      "organize tax documents",
      "tax documents checklist",
      "organizing tax documents for accountant",
      "how to find my 1099 online",
      "organize tax receipts",
    ],
    title: "Organize tax documents: 1099s, receipts and forms in folders",
    description:
      "Organize your tax documents: Stella (stella.sh) gathers W-2s, 1099s and receipts from your email and downloads into labelled folders, with a list of what's missing.",
    h1: "Organize my tax documents for this year",
    short: "Organize tax documents",
    lede: "Every form and receipt for this year's taxes, in labelled folders",
    answer:
      "Ask Stella (stella.sh) to get your taxes ready. It gathers W-2s, 1099s, mortgage and tuition forms and deductible receipts from your email and downloads, files them in labelled folders, and lists what's still missing.",
    gets: [
      "Income, deductions and receipts in separate folders",
      "Files renamed so you can tell them apart",
      "A checklist matched against last year's return",
    ],
    prompt:
      "Get my tax stuff together for this year. Find my W-2, any 1099s, the mortgage interest form and receipts for donations and childcare in my email and Downloads, and put them in folders.",
    demo: {
      ack: "Sure. Gathering this year's tax papers.",
      task: "Tax documents for this year",
      rows: ["Searching email and Downloads for tax forms", "Sorting into income, deductions and receipts", "Checking against last year's return"],
      reply:
        "Your **Taxes 2026** folder has 23 files in four folders. Still missing: the 1099-B from your brokerage and the childcare provider's tax ID. The checklist is inside.",
      files: ["Taxes 2026 checklist.pdf"],
    },
    faq: [
      ["How do I find my 1099 online?", "Sign in to the payer's site and look under Tax documents or Statements. Your IRS online account also lists reported 1099s in the wage and income transcript."],
      ["When do 1099s arrive?", "Most by January 31. Brokerage 1099s often come by mid February."],
    ],
    byHand: [
      "Make folders for income, deductions, receipts and last year's return.",
      "Search your email for W-2, 1099, 1098 and tax document, and download each.",
      "Tick each form off against last year's return so nothing is missed.",
    ],
    related: [
      "money-household/mileage-log-for-taxes",
      "money-household/email-receipts-to-spreadsheet",
      "pdf-excel/receipts-to-spreadsheet",
    ],
    lastChecked: "2026-11-24",
  }),
];
