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
];
