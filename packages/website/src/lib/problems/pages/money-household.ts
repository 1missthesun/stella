import { PROOFS, webCuts } from "../media";
import type { ProblemPage } from "../types";

const MODEL = "Claude Code with Opus, on a Claude plan";

export const MONEY_HOUSEHOLD_PAGES: ProblemPage[] = [
  {
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
      "Turn bank and credit card downloads into a monthly budget by category, with card payments and transfers left out: a PivotTable, or Stella (stella.sh).",
    h1: "Make a budget from your bank statements",
    short: "Budget from bank statements",
    lede: "Three months of bank and card downloads as a monthly average for each category.",
    answer:
      "Download the last few months from your bank and card as CSV, put them on one sheet, delete the card payments and transfers between your own accounts (they'd count the same spending twice), add a Category column and total it with a PivotTable, divided by the number of months. Stella (stella.sh) does that from the downloads on your computer: it sorts every purchase, leaves out paychecks, transfers and card payments, nets off refunds, and saves a spreadsheet whose totals update when you move something.",
    stellaSteps: [
      "Finds two downloads in Downloads: a checking account and a credit card, July to September",
      "Leaves out paychecks, money in from a friend, the $500 moved to savings each month and the card payments that show up in both files",
      "Counts each card purchase once on its own, and takes a clothing refund off shopping",
      "Sorts every purchase into rent, groceries, eating out, transport, bills and utilities, shopping or everything else",
      "Saves `Budget Jul-Sep 2026.xlsx` in Documents with a Budget tab of monthly averages and a Transactions tab where changing a category updates the totals",
      "Points out the calls you might make differently: streaming and the gym under Bills, a big July online order, cash withdrawals under everything else",
    ],
    prompt:
      "Use my bank and credit card downloads in Downloads to make me a simple budget spreadsheet: how much I spend a month on average on rent, groceries, eating out, transport, bills and utilities, shopping, and everything else.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "About a minute and a half. Checked afterwards against an answer key written before the run: the monthly average right for all seven categories (rent $1,650, groceries $722, eating out $274, transport $223, bills $327 with streaming and the gym, shopping $273, everything else $203) and a monthly total of $3,671, so card payments and the savings transfer weren't counted as spending.",
      note: "The accounts, merchants and amounts are fictitious, made for this run, in US dollars. Stella's spreadsheet works its figures out with live formulas, so the check recalculated a copy to read them. The work is sped up 6×.",
      video: {
        src: `${PROOFS}/money-household/make-a-budget-from-bank-statement/proof.mp4`,
        cuts: webCuts("money-household/make-a-budget-from-bank-statement"),
        poster: `${PROOFS}/money-household/make-a-budget-from-bank-statement/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 47.3,
        realDuration: 121,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Checking-account and credit-card downloads for July to September are in Downloads." },
        { at: 2, text: "The prompt: a simple budget, average monthly spending in seven categories." },
        { at: 15.2, text: "Stella replies: card payments, transfers, refunds and income will be left out so nothing is counted twice." },
        { at: 21, text: "Sorting the transactions, sped up 6×." },
        { at: 33.3, text: "Done: about $3,671 a month, rent first, with the sorting choices you might want to change." },
      ],
    },
    manualTitle: "Build the budget yourself",
    manualSteps: [
      {
        title: "Download a few months as CSV",
        body: "In online banking, look for Download or Export on each account and card, and choose CSV (or Excel) for the same full months. Three months evens out bills that come quarterly. Only have PDF statements? See [bank statement PDF to Excel](/how/pdf-excel/bank-statement-pdf-to-excel) first.",
      },
      {
        title: "Stack them on one sheet",
        body: "Paste every file under one set of headers: Date, Description, Amount, Account. Make spending the same sign in all of them, since banks and card companies often use opposite signs.",
      },
      {
        title: "Delete what isn't spending",
        body: "Filter the descriptions for PAYMENT, TRANSFER, payroll and money from friends, and delete those rows. The payment to your card is the same purchases you already have on the card file. Leave refunds in as negative spending.",
      },
      {
        title: "Add a Category column",
        body: "Type a category on each row, or sort by Description and fill a merchant's rows at once. Decide up front where subscriptions, the gym and cash withdrawals go, and stick to it.",
      },
      {
        title: "Total it with a PivotTable",
        body: "Excel: Insert, PivotTable, Category in Rows, Sum of Amount in Values. Numbers 13 and later has Pivot Tables too, or use SUMIF per category. Divide each total by the number of months for the monthly average.",
      },
    ],
    limits: [
      "Categories are Stella's reading of merchant names. It listed the choices you might want to change, but read the Transactions tab before you trust the totals.",
      "Your transactions go to the AI model you use in Stella while it sorts them. Delete account numbers from the downloads first if you like; it never needs your banking login.",
      "A budget from three months is an average, not a plan: yearly bills, holidays and one-off purchases need adding by hand.",
      "Not financial advice. Stella adds up what you spent; what to cut is your call.",
      "Recorded on Linux. On a Mac or Windows PC Stella may first install Python or a small spreadsheet library, which wasn't recorded. The file opens in Excel, Numbers or Google Sheets.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why does my budget count some spending twice?",
        a: "When you add both a bank account and the card you pay from it, the card payment on the bank side is the same money as the purchases on the card. Count the purchases and drop the payment. Transfers to your own savings aren't spending either.",
      },
      {
        q: "Do I need a budgeting app that links to my bank?",
        a: "Not to see where the money goes. The CSV downloads you already get hold the same transactions, and nothing has to be connected. An app is handier only if you want it updated every day.",
      },
      {
        q: "Can it find the subscriptions I forgot about?",
        a: "Yes: see [find subscriptions in your bank statement](/how/pdf-excel/find-subscriptions-in-bank-statement). To spot a merchant that billed you twice, see [find duplicate charges on your credit card](/how/money-household/find-duplicate-charges-on-credit-card).",
      },
      {
        q: "My bank gives me OFX or QIF files instead of CSV. Will that work?",
        a: "Yes. Stella reads them directly, or see [convert OFX to Excel](/how/money-household/convert-ofx-to-excel) to get a spreadsheet first.",
      },
    ],
    related: [
      "pdf-excel/find-subscriptions-in-bank-statement",
      "money-household/find-duplicate-charges-on-credit-card",
      "money-household/convert-ofx-to-excel",
      "pdf-excel/split-bills-with-roommates",
    ],
    lastChecked: "2026-11-14",
    sources: [
      {
        label: "Microsoft Support: Create a PivotTable to analyze worksheet data",
        href: "https://support.microsoft.com/en-us/office/create-a-pivottable-to-analyze-worksheet-data-a9a84538-bfe9-40a9-a8e9-f99134456576",
      },
    ],
  },
  {
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
      "Find the real double charges in a card download (not parking, fares or subscriptions), skip ones already refunded, and save a list for the bank, with Stella (stella.sh).",
    h1: "Find duplicate charges on your credit card",
    short: "Find duplicate card charges",
    lede: "312 card transactions checked, and a list of the four real doubles to take to the bank.",
    answer:
      "Download your card activity as CSV, sort it by description and then amount, and look for the same merchant and amount on the same day or the next. Then check each pair against the refunds before you dispute it: daily parking, transit fares and monthly subscriptions repeat on purpose. Stella (stella.sh) goes through the download on your computer, tells real doubles from normal repeats, leaves out any already refunded, and saves a list you can send to the card company.",
    stellaSteps: [
      "Reads `Credit card activity Aug-Oct 2026.csv` in Downloads: 312 transactions over three months",
      "Finds two charges billed twice on the same day, a hotel and a dentist, $309 in total",
      "Sets two pairs aside for you to confirm: a ticket charged under two different merchant names on the same day, and an electronics store on two days running",
      "Leaves out an outfitter's double charge that was already refunded, and the parking, fares, subscriptions and gym that repeat normally",
      "Saves `Possible double charges - Aug-Oct 2026.html` in Downloads, with dates and amounts, a section to dispute and one to check, and blanks for your name and card number",
    ],
    prompt:
      "I think I've been charged twice for some things. Go through my credit card download in Downloads, find any double charges, and save a list I can send to the bank.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "A little over a minute. Checked afterwards against an answer key written before the run: all four double charges listed with merchant, amount and date, including the one billed under two names, the already-refunded double not listed to dispute, and no parking, fares, subscriptions or split order in the list.",
      note: "The card, merchants and transactions are fictitious, made for this run, in US dollars. Stella put two of the four doubles under “need your call” rather than “to dispute”; the check accepted both sections. The work is sped up 5×.",
      video: {
        src: `${PROOFS}/money-household/find-duplicate-charges-on-credit-card/proof.mp4`,
        cuts: webCuts("money-household/find-duplicate-charges-on-credit-card"),
        poster: `${PROOFS}/money-household/find-duplicate-charges-on-credit-card/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 43,
        realDuration: 103,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Three months of credit card activity is in Downloads." },
        { at: 2, text: "The prompt: find any double charges and save a list to send to the bank." },
        { at: 10.8, text: "Stella replies: clear duplicates will be kept apart from the ones worth a second look." },
        { at: 16.7, text: "Going through 312 transactions, sped up 5×." },
        { at: 29, text: "Done: two charges to dispute, two pairs to confirm, a refunded double left out, and the list saved." },
      ],
    },
    manualTitle: "Find them yourself",
    manualSteps: [
      {
        title: "Download the activity",
        body: "In your card's website or app, find Download or Export transactions and choose CSV for the months you're unsure about. Wait until charges have posted: a pending charge that later drops off can look like a double.",
      },
      {
        title: "Sort so doubles sit together",
        body: "Open it in Excel or Numbers and sort by Description, then by Amount. Read down the list for the same amount on the same or next day. Some merchants appear under two names (a payment processor's prefix such as `SQ *`), so also sort by Amount alone.",
      },
      {
        title: "Or let a formula flag them",
        body: "In Excel, with dates in A, descriptions in C and amounts in F, add a column: `=COUNTIFS(C:C,C2,F:F,F2,A:A,\">=\"&A2-1,A:A,\"<=\"&A2+1)`. Filter it for values above 1.",
      },
      {
        title: "Cross off the normal repeats and refunds",
        body: "Parking, fares, coffee and subscriptions repeat on purpose. For each pair left, look for a credit from the same merchant later on; if there is one, it's already fixed.",
      },
      {
        title: "Dispute what's left",
        body: "Contact the merchant first, then the card issuer through its app, website or the number on the card. US law gives you 60 days from the statement date to dispute a billing error in writing.",
      },
    ],
    limits: [
      "Stella finds and lists. It doesn't contact your bank or the merchant; it said so in the run.",
      "It can't know whether you really bought two tickets or two of an item, so pairs like that come back as questions, not disputes.",
      "A download taken while charges are still pending can show a temporary hold next to the final charge. Use posted transactions.",
      "Your transactions go to the AI model you use in Stella. It doesn't need your card number or banking login, and the list leaves blanks for you to fill in.",
      "Not legal or financial advice: dispute rules and deadlines depend on your card and country.",
      "Recorded on Linux, where Stella used Python, built in on Mac and Linux. On Windows it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I know if I was really charged twice?",
        a: "Two charges with the same merchant and amount within a day or so, with no matching refund later, and no reason you'd have bought it twice. A pending authorization next to the final charge usually falls off by itself in a few days.",
      },
      {
        q: "How long do I have to dispute a double charge?",
        a: "In the US, the Fair Credit Billing Act gives you 60 days after the statement with the error was sent. Many issuers accept disputes later, but don't count on it.",
      },
      {
        q: "Can it check my bank account too?",
        a: "Yes, from any CSV, Excel, OFX or QIF download. For OFX and QIF see [convert OFX to Excel](/how/money-household/convert-ofx-to-excel); for a monthly picture of spending, [make a budget from your bank statement](/how/money-household/make-a-budget-from-bank-statement).",
      },
      {
        q: "What about subscriptions I didn't mean to keep?",
        a: "That's a different search: see [find subscriptions in your bank statement](/how/pdf-excel/find-subscriptions-in-bank-statement).",
      },
    ],
    related: [
      "pdf-excel/find-subscriptions-in-bank-statement",
      "money-household/make-a-budget-from-bank-statement",
      "money-household/convert-ofx-to-excel",
    ],
    lastChecked: "2026-11-14",
    sources: [
      {
        label: "CFPB: How do I dispute a charge on my credit card bill?",
        href: "https://www.consumerfinance.gov/ask-cfpb/how-do-i-dispute-a-charge-on-my-credit-card-bill-en-61/",
      },
    ],
  },
  {
    slug: "convert-ofx-to-excel",
    niche: "money-household",
    searchPhrases: ["convert ofx to excel", "ofx file", "qif file", "ofx to csv", "qfx to csv", "qif to excel", "how to open ofx file"],
    title: "Convert OFX, QFX and QIF bank files to Excel",
    description:
      "Open OFX, QFX and QIF bank downloads in Excel with date, payee, signed amount and memo for every transaction: GnuCash's import and export, or Stella (stella.sh).",
    h1: "Convert OFX, QFX and QIF files to Excel",
    short: "OFX, QFX and QIF to Excel",
    lede: "Three bank files Excel can't open, as three spreadsheets with every transaction in them.",
    answer:
      "OFX and QFX (the Quicken flavour of OFX) are text files that money programs import; QIF is Quicken's older format. Excel can't open any of them properly. The free GnuCash program imports all three and exports the transactions to CSV, or ask your bank for a CSV download instead. Stella (stella.sh) converts them on your computer: one spreadsheet per file with date, payee, amount and memo, spending as negative numbers, and nothing uploaded to a converter site.",
    stellaSteps: [
      "Finds three files in Downloads: an old-style QFX for checking, an OFX 2 file for savings and a QIF from a 2019 joint account",
      "Reads each format as it is: the QFX without closing tags, the OFX as XML, and the QIF's `1/ 5'19` dates and `T-1,234.56` amounts, keeping a split transaction as one",
      "Writes `Checking_Oct2026.xlsx`, `Savings_2026.xlsx` and `Old joint account 2019.xlsx` next to the originals, with date, payee, amount and memo, sorted by date",
      "Keeps two identical coffees on the same day as two rows, and shows spending as negative numbers in red",
      "Points out things worth asking the bank about, such as one check number used twice, and leaves the original files unchanged",
    ],
    prompt:
      "My bank only lets me download transactions as QFX, OFX and QIF files (they're in my Downloads) and I can't open them. Turn each one into an Excel spreadsheet with the date, payee, amount and memo for every transaction.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "Three spreadsheets in about a minute. Checked afterwards against an answer key written before the run: all 40 transactions from the QFX, all 21 from the OFX and all 25 from the QIF, each with the right date, signed amount and payee, and the memos carried over.",
      note: "The bank files are fictitious, written in the real formats (including the old QFX style without closing tags and a QIF split). The work is sped up 5×.",
      video: {
        src: `${PROOFS}/money-household/convert-ofx-to-excel/proof.mp4`,
        cuts: webCuts("money-household/convert-ofx-to-excel"),
        poster: `${PROOFS}/money-household/convert-ofx-to-excel/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 41.5,
        realDuration: 104,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A QFX, an OFX and a QIF bank file are in Downloads." },
        { at: 2, text: "The prompt: an Excel spreadsheet for each, with date, payee, amount and memo." },
        { at: 10, text: "Stella replies: one spreadsheet per file, with a count of transactions in each." },
        { at: 15.8, text: "Reading the three formats, sped up 5×." },
        { at: 27.5, text: "Done: 40, 21 and 25 transactions, saved next to the originals, with a few things to ask the bank about." },
      ],
    },
    manualTitle: "Convert them yourself",
    manualSteps: [
      {
        title: "Try a CSV download first",
        body: "Most banks offer CSV or Excel alongside OFX, QFX and QIF, sometimes under a different button such as “Spreadsheet” or “Comma delimited”. If yours does, that's the quickest route.",
      },
      {
        title: "Install GnuCash",
        body: "GnuCash is free accounting software for Windows, Mac and Linux. It can import OFX, QFX and QIF, which Excel and Numbers can't.",
      },
      {
        title: "Import the file",
        body: "Make a new GnuCash file, then File, Import, Import OFX/QFX (or Import QIF). Match the transactions to a new bank account when it asks. For QIF it also asks the date format: pick the one your bank uses.",
      },
      {
        title: "Export to CSV",
        body: "Open the account, then File, Export, Export Transactions to CSV. Open the CSV in Excel or Numbers and save it as a spreadsheet.",
      },
      {
        title: "Check dates and signs",
        body: "Compare the first and last few rows with your online banking. A QIF date like 1/5 can mean 5 January or 1 May, and some programs drop the minus sign on spending.",
      },
    ],
    limits: [
      "Investment (brokerage) OFX files hold trades and holdings as well as cash; those come out differently from a bank account and weren't part of this run.",
      "QIF dates don't say whether they're US or day-first. Stella reads the file to tell, but check one known transaction if your bank isn't American.",
      "Stella left out the QIF's own spending categories because the prompt asked for four columns. Ask for them if you want them.",
      "The transactions go to the AI model you use in Stella while it reads them. The spreadsheets are written on your computer.",
      "Recorded on Linux. On a Mac or Windows PC Stella may first install Python or a small spreadsheet library, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What is an OFX file?",
        a: "Open Financial Exchange: a text file of bank transactions made for money programs like Quicken, GnuCash and accounting apps. QFX is the same format with a few Quicken-only fields. Excel shows it as a jumble of tags.",
      },
      {
        q: "What is a QIF file?",
        a: "Quicken Interchange Format, an older plain-text format with one line per field: D for date, T for amount, P for payee, M for memo, ending each transaction with `^`.",
      },
      {
        q: "Can I open an OFX file in Excel directly?",
        a: "Not usefully. Excel may import it as text, but you get tags and values on separate lines, not one row per transaction.",
      },
      {
        q: "What can I do with the spreadsheet next?",
        a: "Build a monthly picture: [make a budget from your bank statement](/how/money-household/make-a-budget-from-bank-statement), or [find duplicate charges](/how/money-household/find-duplicate-charges-on-credit-card). If your statements are PDFs instead, see [bank statement PDF to Excel](/how/pdf-excel/bank-statement-pdf-to-excel).",
      },
    ],
    related: [
      "pdf-excel/bank-statement-pdf-to-excel",
      "money-household/make-a-budget-from-bank-statement",
      "money-household/find-duplicate-charges-on-credit-card",
    ],
    lastChecked: "2026-11-14",
    sources: [{ label: "GnuCash: free accounting software (imports OFX, QFX and QIF)", href: "https://www.gnucash.org/" }],
  },
  {
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
      "Request your Amazon order history, then total each year's spending minus refunds and cancelled orders. With a PivotTable, or Stella (stella.sh) on your own computer.",
    h1: "How much have I spent on Amazon each year?",
    short: "How much I've spent on Amazon",
    lede: "Five years of Amazon orders as one total per year, refunds taken off.",
    answer:
      "Amazon retired its order history report, so the way to see everything now is Request Your Data on Amazon, choosing Your Orders. You get a zip with one row per item, cancelled orders still in it, and refunds in a separate file. Total the item rows per year without the cancelled ones, then subtract that year's refunds. Stella (stella.sh) does it from the zip on your computer, without logging in to Amazon, and saves a spreadsheet with every order line so you can check it.",
    stellaSteps: [
      "Opens `Your Orders.zip` in Downloads: the order history, one row per item, and a separate refunds file",
      "Adds up what was charged each year, combining orders with several item rows",
      "Leaves out $151.42 of orders that were cancelled and never charged",
      "Takes each year's refunds off, $587.21 in total",
      "Saves `Amazon spend by year.xlsx` next to the zip, with purchases, refunds and net spend per year, and tabs of every order line and refund",
      "Says what isn't in this export: digital purchases and membership fees come in a separate part of Amazon's data",
    ],
    prompt:
      "I requested my data from Amazon and got this zip in my Downloads. How much have I spent on Amazon each year, after refunds? Save it as a spreadsheet.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "About 2 minutes. Checked afterwards against an answer key written before the run: spending after refunds right for every year from 2022 to 2026 ($2,626.60, $3,086.26, $3,970.51, $4,581.67 and $2,894.15), with the refunds for each year shown.",
      note: "The orders are fictitious. There's no published layout for Amazon's export, so the file was modelled on how others describe it; your download may have a few more columns. The work is sped up 9×.",
      video: {
        src: `${PROOFS}/money-household/how-much-have-i-spent-on-amazon/proof.mp4`,
        cuts: webCuts("money-household/how-much-have-i-spent-on-amazon"),
        poster: `${PROOFS}/money-household/how-much-have-i-spent-on-amazon/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 45.6,
        realDuration: 154,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. The Your Orders zip from an Amazon data request is in Downloads." },
        { at: 2, text: "The prompt: how much spent each year after refunds, saved as a spreadsheet." },
        { at: 13.6, text: "Stella replies: it will add up each year minus refunds and save the spreadsheet next to the zip." },
        { at: 19.6, text: "Going through the order rows and refunds, sped up 9×." },
        { at: 31.7, text: "Done: $17,159.19 since 2022, a total per year, cancelled orders left out and what the export doesn't cover." },
      ],
    },
    manualTitle: "Add it up yourself",
    manualSteps: [
      {
        title: "Request your order data",
        body: "On amazon.com, open Account, then the Request Your Data page (in the privacy section), choose Your Orders and submit. Confirm the email Amazon sends. The download link arrives by email, often within a few days.",
      },
      {
        title: "Open the order history",
        body: "Unzip it and open `Retail.OrderHistory.1.csv` in Excel or Numbers. Each row is one item, so an order with three things has three rows. Filter Order Status and remove Cancelled.",
      },
      {
        title: "Total each year",
        body: "Add a Year column from Order Date (`=YEAR(...)`, or the first four characters if the date is text). Insert a PivotTable with Year in Rows and Sum of Total Owed in Values.",
      },
      {
        title: "Subtract the refunds",
        body: "Open the refunds file from the same zip (its folder name mentions Returns or Refunds), do the same pivot by year on the refund amount, and subtract it from each year's total.",
      },
    ],
    limits: [
      "Only what's in the export you requested. Kindle books, apps, video and membership fees sit in other parts of Amazon's data, and Stella said they weren't counted.",
      "Totals can differ a little from your card charges where gift cards, promotions or split shipments are involved.",
      "Your order list goes to the AI model you use in Stella while it adds up. Stella doesn't log in to your Amazon account; you request the data yourself.",
      "Recorded on Linux. On a Mac or Windows PC Stella may first install Python or a small spreadsheet library, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Where did Amazon's order history report go?",
        a: "Amazon removed the old order report page. Your full history now comes through the Request Your Data page, as a zip of CSV files sent by email.",
      },
      {
        q: "How long does Amazon take to send my data?",
        a: "It varies, from hours to several days. Amazon emails you when the download is ready, and the link expires after a while.",
      },
      {
        q: "Can it split the spending by category or by month?",
        a: "Yes, in the same chat: ask for months or categories from the product names. For your whole household budget see [make a budget from your bank statement](/how/money-household/make-a-budget-from-bank-statement).",
      },
      {
        q: "Can it do the same with receipts?",
        a: "Yes: see [receipts to spreadsheet](/how/pdf-excel/receipts-to-spreadsheet) for PDFs and photos of receipts.",
      },
    ],
    related: [
      "money-household/make-a-budget-from-bank-statement",
      "pdf-excel/receipts-to-spreadsheet",
      "pdf-excel/find-subscriptions-in-bank-statement",
    ],
    lastChecked: "2026-11-14",
    sources: [
      {
        label: "Amazon Help: How do I request my data?",
        href: "https://www.amazon.com/gp/help/customer/display.html?nodeId=TBiXKXG7RDE6mBHk0b",
      },
      { label: "Tiller: How to download your Amazon order history", href: "https://tiller.com/?p=137473" },
    ],
  },
  {
    slug: "mileage-log-for-taxes",
    niche: "money-household",
    searchPhrases: ["mileage log for taxes", "mileage log", "mileage reimbursement calculator", "mileage tracker spreadsheet", "irs mileage rate 2026"],
    title: "Mileage log for taxes: business miles and the 2026 IRS rates",
    description:
      "Total business miles per month from your car log, personal trips out, and the 2026 claim at both IRS rates (72.5¢, then 76¢ from 1 July). Excel, or Stella (stella.sh).",
    h1: "Total your mileage log for taxes",
    short: "Mileage log for taxes",
    lede: "A year of car-log entries as business miles per month and a claim at the right rates.",
    answer:
      "Add up the business trips in your log month by month, working out miles from the odometer where you didn't write them down, and leave out personal driving and commuting. For 2026 the IRS standard rate is 72.5¢ a mile for January to June and 76¢ from 1 July, so multiply each half separately. Stella (stella.sh) totals the log you already kept, looks the current rate up on IRS.gov, and saves a spreadsheet you can keep adding to. Not tax advice.",
    stellaSteps: [
      "Finds `Car log 2026.xlsx` in Documents: 113 trips from January to October, many with blank miles",
      "Works out the missing miles from the start and end odometer readings, and reads entries like `24 (round trip)` as 24",
      "Leaves out every trip marked Personal, including a 388-mile vacation, and counts the rest as business",
      "Looks up the 2026 rate on IRS.gov and finds the mid-year change: 72.5¢ to June, 76¢ from July",
      "Saves `Business mileage 2026.xlsx` next to the log with miles and claim per month, a Trips tab, and notes on how each trip was read",
      "Flags one trip whose odometer readings don't fit its dates, and says moving it wouldn't change the claim",
    ],
    prompt:
      "My car log for this year is in my Documents. Work out my business miles for each month and for the year so far, and how much I can claim at this year's IRS mileage rate. Save it as a spreadsheet.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "About 3 minutes. Checked afterwards against an answer key written before the run: business miles right for every month January to October, 2,799 for the year, personal trips left out, and the claim worked out with both 2026 rates: $2,071.77 against the key's $2,071.76, the cent from rounding each month.",
      note: "The car log is fictitious, made for this run. Using 72.5¢ for the whole year, as older calculators do, would have failed. The work is sped up 15×.",
      video: {
        src: `${PROOFS}/money-household/mileage-log-for-taxes/proof.mp4`,
        cuts: webCuts("money-household/mileage-log-for-taxes"),
        poster: `${PROOFS}/money-household/mileage-log-for-taxes/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 48.8,
        realDuration: 236,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A car log spreadsheet for 2026 is in Documents." },
        { at: 2, text: "The prompt: business miles per month and for the year, and the claim at this year's IRS rate." },
        { at: 16, text: "Stella replies: it will total the business miles and use the official 2026 rate from irs.gov." },
        { at: 21.8, text: "Reading 113 trips and checking the IRS rate, sped up 15×." },
        { at: 34.8, text: "Done: 2,799 business miles, $2,071.77 using both 2026 rates, and one trip to check." },
      ],
    },
    manualTitle: "Total it yourself",
    manualSteps: [
      {
        title: "Fill in missing miles",
        body: "In your log, add a Miles used column: `=IF(D2=\"\",C2-B2,D2)` takes the miles you wrote down, or end odometer minus start where you didn't. Check any trip that comes out negative or huge.",
      },
      {
        title: "Mark business and personal",
        body: "Add a Business? column. Commuting from home to your regular workplace is personal for the IRS; so are errands, school runs and holidays.",
      },
      {
        title: "Total each month",
        body: "Excel: `=SUMIFS(E:E, A:A, \">=\"&DATE(2026,1,1), A:A, \"<\"&DATE(2026,2,1), F:F, \"Yes\")` for January, and so on. Numbers: a Pivot Table with month in Rows.",
      },
      {
        title: "Apply the right rate",
        body: "For 2026: January to June miles × $0.725, July to December miles × $0.76, then add the two. Check IRS.gov for the year you're claiming; rates are set each December and occasionally changed mid-year.",
      },
      {
        title: "Keep the log itself",
        body: "The IRS expects a record made at the time: date, miles, where and why. Keep the original log with your tax papers, not only the totals.",
      },
    ],
    limits: [
      "Not tax advice. Whether you can claim mileage, and whether the standard rate or actual costs suit you better, depends on your situation; ask a tax professional.",
      "Stella counted everything not marked Personal as business, because that's how the log was kept. If your log mixes in commuting without saying so, it can't tell.",
      "It uses the rate IRS.gov shows on the day you ask. If the IRS changes it again, an old spreadsheet won't update itself.",
      "Your trip notes go to the AI model you use in Stella while it reads them, and it looks the rate up on the web.",
      "Recorded on Linux. On a Mac or Windows PC Stella may first install Python or a small spreadsheet library, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What is the IRS mileage rate for 2026?",
        a: "For business driving, 72.5¢ a mile from 1 January to 30 June 2026 and 76¢ from 1 July to 31 December 2026, after the IRS raised it mid-year because of fuel costs (Announcement 2026-11).",
      },
      {
        q: "Can I claim my commute?",
        a: "No. Driving between home and your regular place of work is personal. Trips from work to a client, or between work sites, can count.",
      },
      {
        q: "What does a mileage log need for the IRS?",
        a: "For each business trip: the date, the miles, where you went and the business reason. Odometer readings at the start and end of the year help too.",
      },
      {
        q: "Can it total hours worked the same way?",
        a: "Yes: see [calculate hours worked from a timesheet](/how/money-household/calculate-hours-worked-from-timesheet). Receipts for parking and tolls go in a spreadsheet with [receipts to spreadsheet](/how/pdf-excel/receipts-to-spreadsheet).",
      },
    ],
    related: [
      "money-household/calculate-hours-worked-from-timesheet",
      "pdf-excel/receipts-to-spreadsheet",
      "money-household/make-a-budget-from-bank-statement",
    ],
    lastChecked: "2026-11-14",
    sources: [
      {
        label: "IRS: 2026 business standard mileage rate set at 72.5 cents a mile",
        href: "https://www.irs.gov/newsroom/irs-sets-2026-business-standard-mileage-rate-at-725-cents-per-mile-up-25-cents",
      },
      {
        label: "Journal of Accountancy: IRS raises standard mileage rates for remainder of 2026 (76 cents from 1 July)",
        href: "https://www.journalofaccountancy.com/news/2026/jul/irs-raises-standard-mileage-rates-for-remainder-of-2026/",
      },
      { label: "IRS Topic 510: Business use of car", href: "https://www.irs.gov/taxtopics/tc510" },
    ],
  },
  {
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
      "Total each person's weekly hours from a time clock export, unpaid breaks off, overnight shifts right and overtime over 40 shown, in Excel or with Stella (stella.sh).",
    h1: "Calculate hours worked from a timesheet",
    short: "Hours worked from a timesheet",
    lede: "Two weeks of clock-ins for six people as weekly hours and overtime, breaks taken off.",
    answer:
      "For each shift, hours are clock-out minus clock-in, minus any unpaid break; in Excel `=MOD(out-in,1)*24-break/60` also handles shifts that run past midnight. Add them up per person per week, and anything over 40 is overtime under US federal rules. Stella (stella.sh) does it from the time clock export on your computer, for everyone at once, and points out a missing clock-out instead of guessing it.",
    stellaSteps: [
      "Finds the time clock export in Documents: six people, 60 shifts over two weeks, 12-hour times and an unpaid-break column in minutes",
      "Works out each shift with breaks taken off, including a night porter's shifts from about 10 pm to 6:45 am",
      "Groups the shifts into Monday-to-Sunday weeks and splits each week into regular hours and overtime past 40",
      "Leaves a shift with no clock-out at zero and asks what time she left, instead of guessing",
      "Saves `Payroll_hours_2026-10-26_to_2026-11-08.xlsx` with Summary, Shifts and Issues tabs, the export left unchanged",
      "Asks how you pay overnight shifts that cross into a new week, and shows what each choice would change",
    ],
    prompt:
      "Add up the hours everyone worked from the time clock export in my Documents, for each of the two weeks (weeks start Monday), minus unpaid breaks, and show any overtime over 40 hours a week. Put it in a spreadsheet.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "About 2 minutes. Checked afterwards against an answer key written before the run: weekly hours right for all six people with breaks off and overnight shifts counted across midnight, overtime over 40 right for each week, the missing clock-out pointed out and not guessed, and the export unchanged.",
      note: "The names and punches are fictitious, made for this run. The work is sped up 11×.",
      video: {
        src: `${PROOFS}/money-household/calculate-hours-worked-from-timesheet/proof.mp4`,
        cuts: webCuts("money-household/calculate-hours-worked-from-timesheet"),
        poster: `${PROOFS}/money-household/calculate-hours-worked-from-timesheet/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 46.4,
        realDuration: 174,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A two-week time clock export is in Documents." },
        { at: 2, text: "The prompt: weekly hours for everyone, minus unpaid breaks, with overtime over 40." },
        { at: 14.6, text: "Stella replies: it will flag missing punches and shifts past midnight instead of guessing." },
        { at: 20.6, text: "Working through 60 shifts, sped up 11×." },
        { at: 32.4, text: "Done: hours and overtime for six people, 483.4 hours in total, and two questions before payroll." },
      ],
    },
    manualTitle: "Work it out in a spreadsheet",
    manualSteps: [
      {
        title: "Get times Excel can read",
        body: "Open the export in Excel or Numbers. Clock-in and clock-out should show as times, not text; if they're text like `9:02 AM`, use `=TIMEVALUE(B2)` in a new column.",
      },
      {
        title: "Hours for each shift",
        body: "In a new column: `=MOD(out-in,1)*24-break/60`, with the break in minutes. MOD makes an overnight shift (10 pm to 6:45 am) come out as 8.75 hours instead of a negative number.",
      },
      {
        title: "Give every shift a week",
        body: "For weeks starting Monday: `=date-WEEKDAY(date,3)` gives the Monday of that week. Decide whether an overnight shift belongs to the day it started; most time clocks do it that way.",
      },
      {
        title: "Total per person and week",
        body: "Insert a PivotTable with the name in Rows, week in Columns and Sum of hours in Values. Overtime for each cell is `=MAX(0,hours-40)`.",
      },
      {
        title: "Check the gaps",
        body: "Sort by clock-out and look for blanks: a missed punch makes a shift zero or wildly long. Ask the person and type the real time in; don't guess.",
      },
    ],
    limits: [
      "Overtime rules differ by state, country and contract: daily overtime, double time, or a different week. Stella applied the rule in the prompt (over 40 a week); tell it yours.",
      "It doesn't fill in missed punches. In the run it left the shift at zero until you add the real time.",
      "Not payroll or legal advice. Check the totals before anyone is paid.",
      "Names and times go to the AI model you use in Stella while it works. The spreadsheet is written on your computer.",
      "Recorded on Linux. On a Mac or Windows PC Stella may first install Python or a small spreadsheet library, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I calculate hours worked with a lunch break?",
        a: "Clock-out minus clock-in, minus the unpaid break. In Excel with the break in minutes: `=MOD(out-in,1)*24-break/60`. A paid break stays in the hours.",
      },
      {
        q: "How do I handle a shift that goes past midnight?",
        a: "Use MOD as above so the hours come out positive. Then decide which week or day the hours belong to; Stella counted the whole shift on the day it started and showed what splitting at midnight would change.",
      },
      {
        q: "Can it do daily overtime, like California's over 8 hours?",
        a: "Yes, if you say so in the prompt. It applies the rule you give; it doesn't decide which law applies to you.",
      },
      {
        q: "Can it make invoices from the hours?",
        a: "Yes: see [generate invoices from a spreadsheet](/how/documents/generate-invoices-from-spreadsheet). For car trips, see [mileage log for taxes](/how/money-household/mileage-log-for-taxes).",
      },
    ],
    related: [
      "money-household/mileage-log-for-taxes",
      "documents/generate-invoices-from-spreadsheet",
      "pdf-excel/summarize-spreadsheet-by-category",
    ],
    lastChecked: "2026-11-14",
    sources: [
      {
        label: "Microsoft Support: Calculate the difference between two times",
        href: "https://support.microsoft.com/en-us/excel/calculate-the-difference-between-two-times-in-excel",
      },
      { label: "US Department of Labor: Overtime pay", href: "https://www.dol.gov/agencies/whd/overtime" },
    ],
  },
];
