import { PROOFS, webCuts } from "../media";
import type { ProblemPage } from "../types";

const MODEL = "Claude Code with Opus, on a Claude plan";

const MS_DEDUPE = {
  label: "Microsoft Support: Filter for unique values or remove duplicate values",
  href: "https://support.microsoft.com/en-us/office/filter-for-unique-values-or-remove-duplicate-values-ccf664b0-81d6-449b-bbe1-8daaec1e83c2",
};
const MS_PRINT_LABELS = { label: "Microsoft Support: Print labels for your mailing list", href: "https://support.microsoft.com/kb/294684" };

export const WEDDINGS_EVENTS_PAGES: ProblemPage[] = [
  {
    slug: "count-wedding-rsvps",
    niche: "weddings-events",
    searchPhrases: ["how to count rsvps", "rsvp tracker", "wedding rsvp spreadsheet", "rsvp list", "wedding guest list template"],
    title: "Count wedding RSVPs, meals and who hasn't replied",
    description:
      "Get the real headcount, meal counts and the list of who hasn't replied from RSVP form responses, even when guests answered twice: Excel formulas, or Stella (stella.sh).",
    h1: "Count wedding RSVPs when some guests replied twice",
    short: "Count wedding RSVPs",
    lede: "Form responses and an invite list as one headcount, meal totals and a no-reply list.",
    answer:
      "Sort the form responses by time, keep only each household's latest reply (Remove Duplicates on email, after sorting newest first), then add up the number coming and count each meal with SUMIF and COUNTIF. Look each invite-list email up in the responses to find who hasn't replied. Stella (stella.sh) does all of that on your computer from the two files and writes the totals and lists into a spreadsheet.",
    stellaSteps: [
      "Reads the form responses in Downloads and the invite list in Documents, and matches every reply to an invitation",
      "Keeps each household's latest answer: one changed from No to Yes, one from 4 coming to 3, one sent the same reply twice",
      "Counts 46 people coming and one meal per guest: 16 salmon, 13 vegetarian, 11 chicken and 6 kids' meals",
      "Lists the five invitations with no reply (up to 12 more guests), with their emails for a reminder, and the three that declined",
      "Flags nine invitations bringing fewer people than invited, and saves it all as `Wedding RSVP summary.xlsx` in Documents",
    ],
    prompt:
      "Our wedding RSVPs came in through a form. The responses are in my Downloads and the invite list is in my Documents. How many people are coming, how many of each meal, and who still hasn't replied? A few people filled the form in twice, so use their latest answer. Put it in a spreadsheet.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "A summary spreadsheet in under two minutes. Checked afterwards against an answer key written before the run: 46 people coming (adding up every form row gives 53), chicken 11, salmon 16, vegetarian 13, kids' meal 6, all five invitations without a reply listed and no household that replied among them, and both input files unchanged.",
      note: "The guests, emails and replies are made up for this run. The work is sped up 6×.",
      video: {
        src: `${PROOFS}/weddings-events/count-wedding-rsvps/proof.mp4`,
        cuts: webCuts("weddings-events/count-wedding-rsvps"),
        poster: `${PROOFS}/weddings-events/count-wedding-rsvps/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 43.13,
        realDuration: 109.5,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. RSVP form responses are in Downloads, the invite list in Documents." },
        { at: 2, text: "The prompt: how many are coming, meals, who hasn't replied, latest answer for double replies." },
        { at: 12, text: "Stella replies: it will match responses to the invite list and use only the latest answer." },
        { at: 17.8, text: "Matching and counting, sped up 6×." },
        { at: 29.1, text: "Done: 46 coming, meal counts, five invitations without a reply, all in a spreadsheet." },
      ],
    },
    manualTitle: "Count them yourself",
    manualSteps: [
      {
        title: "Keep each household's latest reply",
        body: "Open the form responses in Excel or Google Sheets. Sort by Timestamp, newest first. Then Data, Remove Duplicates, ticking only the email column: Excel keeps the first row it finds, which is now the latest answer.",
      },
      {
        title: "Add up the headcount and meals",
        body: "For people coming, `=SUMIF(D:D,\"Yes\",E:E)` with your Attending and Number columns. For meals, count each choice across the guest meal columns, for example `=COUNTIF(F:I,\"Salmon\")`, and check the meal total equals the headcount.",
      },
      {
        title: "Find who hasn't replied",
        body: "In the invite list add a column `=IF(ISNA(MATCH(B2,Responses!C:C,0)),\"No reply\",\"Replied\")` with the email columns, then filter it to No reply. Match on email, not names: people type their names differently.",
      },
      {
        title: "Check the odd ones",
        body: "Compare the number each household said is coming against how many were invited. Fewer can be right (one partner can't come) or a typo worth a quick message.",
      },
    ],
    limits: [
      "Stella counts what the form says. It doesn't email guests; it can draft reminder messages for the no-replies if you ask.",
      "It matches replies to invitations by email and name. A guest who used a different email and spelled their name differently may need you to confirm the match; Stella lists anything it couldn't match.",
      "Guest names, emails and meal choices go to the AI model you use in Stella. The spreadsheet is made on your computer, with no RSVP website involved.",
      "Recorded on Linux, where Stella used Python tools already on the computer. On a Mac or Windows PC it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "My RSVPs are in Google Forms. Does this work?",
        a: "Yes. In the form's Responses tab, open the linked sheet and download it as Excel or CSV, then point Stella at it.",
      },
      {
        q: "Can it do the seating chart next?",
        a: "Yes, once tables are assigned in your guest list: see [make a wedding seating chart](/how/weddings-events/make-wedding-seating-chart) and [place cards from a guest list](/how/weddings-events/make-place-cards-from-guest-list).",
      },
      {
        q: "Can it give the caterer a meal list by table?",
        a: "Yes, ask for meals per table, with names, from the same files plus your table plan.",
      },
      {
        q: "What if replies came by text or email instead of a form?",
        a: "Paste or save them into a document and ask Stella to read them into the same summary; check its reading of anything ambiguous.",
      },
    ],
    related: ["weddings-events/make-wedding-seating-chart", "weddings-events/make-place-cards-from-guest-list", "printing-labels/print-envelopes-from-excel", "pdf-excel/remove-duplicate-rows-in-excel"],
    lastChecked: "2026-11-14",
    sources: [MS_DEDUPE],
  },
  {
    slug: "make-wedding-seating-chart",
    niche: "weddings-events",
    searchPhrases: ["wedding seating chart", "how to make a seating chart", "seating chart template", "wedding seating chart maker", "escort cards"],
    title: "Make a printable wedding seating chart from your guest list",
    description:
      "Turn a guest list into an alphabetical “find your seat” chart and a list per table for the venue, declines left out: in Excel, or Stella (stella.sh).",
    h1: "Make a printable wedding seating chart from your guest list",
    short: "Wedding seating chart",
    lede: "88 guests, tables typed every which way, as an A–Z seat finder and per-table lists.",
    answer:
      "Filter your guest list to the people who said yes, make the table column consistent (3, Table 3 and T3 are the same table), sort by last name and print that as the “find your seat” list, then sort by table and print a page per table for the venue. Stella (stella.sh) does it from the spreadsheet on your computer and writes a print-ready PDF, plus an editable copy.",
    stellaSteps: [
      "Reads `Guest list - final.xlsx` in Documents: 88 guests, with tables typed as 3, Table 3, T3 or Head Table",
      "Keeps the 77 who said yes and treats every spelling of a table as one table",
      "Makes a “Find your seat” page with everyone A–Z by last name and their table",
      "Adds two pages listing each table for the venue, with a headcount and each guest's meal",
      "Saves `Wedding seating chart.pdf` and an editable spreadsheet in Documents, and flags a household that never replied and has no table, and tables that look uneven",
    ],
    prompt:
      "Make a seating chart to print for our wedding from the guest list in my Documents: everyone who said yes in alphabetical order by last name with their table, and a list for each table for the venue.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "A three-page chart in a little over two minutes. Checked afterwards against an answer key written before the run: all 77 guests who said yes, each with their table on the same line, in alphabetical order by last name, each also under their own table's heading and none under the wrong one, nobody who declined or didn't answer, and the guest list unchanged.",
      note: "The guests are made up for this run. The work is sped up 8×.",
      video: {
        src: `${PROOFS}/weddings-events/make-wedding-seating-chart/proof.mp4`,
        cuts: webCuts("weddings-events/make-wedding-seating-chart"),
        poster: `${PROOFS}/weddings-events/make-wedding-seating-chart/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 50.5,
        realDuration: 137.7,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. The wedding guest list is in Documents." },
        { at: 2.1, text: "The prompt: everyone who said yes, A–Z by last name with their table, and a list per table." },
        { at: 18.8, text: "Stella replies: an alphabetical list and per-table lists, flagging anything that needs a decision." },
        { at: 24.7, text: "Cleaning up the table numbers and laying out the chart, sped up 8×." },
        { at: 36.5, text: "Done: 77 guests at 12 tables on 3 pages; one household with no reply and uneven tables flagged." },
      ],
    },
    manualTitle: "Make it yourself",
    manualSteps: [
      {
        title: "Clean the table column",
        body: "In Excel, add a column that turns every table into a plain number: `=IFERROR(VALUE(TRIM(SUBSTITUTE(SUBSTITUTE(E2,\"Table\",\"\"),\"T\",\"\"))),E2)` handles 3, Table 3, T3 and stray spaces. Fix anything left by hand, such as Head Table.",
      },
      {
        title: "Filter and sort by last name",
        body: "Filter RSVP to Yes. Select the table and use Data, Sort by Last name, then First name. Hide the columns you don't need and print the name and table columns, two or three columns to a page if the list is long.",
      },
      {
        title: "A list per table for the venue",
        body: "Sort again by table, then Last name. Data, Subtotal, at each change in Table, use Count, and tick Page break between groups, so each table prints on its own page with a headcount.",
      },
      {
        title: "Check the totals",
        body: "Make sure the count of Yes guests equals the sum of the table counts, and look for anyone who said yes without a table before you print.",
      },
    ],
    limits: [
      "Stella uses the tables already in your guest list. It doesn't decide who sits where unless you ask, and then you should check its plan.",
      "The layout is a clean printable list, not a decorated board. For a styled sign, give Stella the design or take the PDF to a print shop as the source list.",
      "Guest names, replies, tables and meals go to the AI model you use in Stella. The chart is made on your computer.",
      "Recorded on Linux, where Stella used Python, a browser and LibreOffice already on the computer to write the PDF and the spreadsheet. On a Mac or Windows PC it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Should a seating chart be alphabetical or by table?",
        a: "Both, for different readers: guests look for their own name, so the display board is A–Z by last name; the venue and caterer want a list per table.",
      },
      {
        q: "Can it make escort cards or place cards too?",
        a: "Yes, from the same list: see [place cards from a guest list](/how/weddings-events/make-place-cards-from-guest-list).",
      },
      {
        q: "Can it print it big for an easel?",
        a: "Ask for the A–Z list at poster size, or tile it across pages: see [print a poster on multiple pages](/how/printing-labels/print-poster-on-multiple-pages).",
      },
      {
        q: "My RSVPs aren't counted yet. Where do I start?",
        a: "See [count wedding RSVPs](/how/weddings-events/count-wedding-rsvps) for the headcount, meals and who hasn't replied.",
      },
    ],
    related: ["weddings-events/make-place-cards-from-guest-list", "weddings-events/count-wedding-rsvps", "printing-labels/print-poster-on-multiple-pages"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Microsoft Support: Sort data in a range or table in Excel", href: "https://support.microsoft.com/en-us/excel/sort-data-in-a-range-or-table-in-excel" },
    ],
  },
  {
    slug: "make-place-cards-from-guest-list",
    niche: "weddings-events",
    searchPhrases: ["how to make place cards", "place cards template", "place cards", "place cards from guest list", "printable place cards"],
    title: "Make place cards from a guest list, with table numbers",
    description:
      "Print fold-over place cards for every attending guest with their table number, readable from both sides, several per page: Word, or Stella (stella.sh).",
    h1: "Make place cards from your guest list",
    short: "Place cards from a guest list",
    lede: "40 names on a guest list as 33 fold-over cards, table number on each, four per page.",
    answer:
      "In Word, set up a page of tent cards (a 2 × 2 grid of 4 × 2.5 inch cards on Letter works on most card stock), merge in each attending guest's name and table, and rotate the top half's text box 180° so the name reads from both sides once folded. Stella (stella.sh) does it from your spreadsheet on your computer and writes a print-ready PDF with fold and cut lines.",
    stellaSteps: [
      "Reads `Rehearsal dinner guests.xlsx` in Documents: 40 guests with reply and table",
      "Keeps the 33 attending and names the seven who declined, noting one family where only one person is coming",
      "Makes 4 × 2.5 inch tent cards, four to a Letter page, each with the guest's name and table number",
      "Prints the name and table on both halves, one upside down, so they read from either side of the table once folded",
      "Sorts the cards by table, then surname, adds cut and fold lines, and saves `Rehearsal dinner place cards.pdf` next to the list",
    ],
    prompt:
      "Make place cards for our rehearsal dinner from the guest list in my Documents: each guest's name and table number, fold-over cards I can print on card stock, several per page. Only people who are attending.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "33 place cards on 9 pages in under two minutes. Checked afterwards against an answer key written before the run: a card for each of the 33 attending guests with their own table number, none for guests who declined, several cards per page, the name on both halves with one upside down, and the guest list unchanged.",
      note: "The guests are made up for this run. The work is sped up 5×.",
      video: {
        src: `${PROOFS}/weddings-events/make-place-cards-from-guest-list/proof.mp4`,
        cuts: webCuts("weddings-events/make-place-cards-from-guest-list"),
        poster: `${PROOFS}/weddings-events/make-place-cards-from-guest-list/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 46.03,
        realDuration: 109.1,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. The rehearsal dinner guest list is in Documents." },
        { at: 2, text: "The prompt: fold-over place cards with name and table, attending guests only." },
        { at: 13.6, text: "Stella replies: fold-over cards several to a page, with fold and cut lines." },
        { at: 19.6, text: "Reading the list and laying out the cards, sped up 5×." },
        { at: 32, text: "Done: 33 cards on 9 pages, names on both sides, seven declines left out." },
      ],
    },
    manualTitle: "Make them yourself",
    manualSteps: [
      {
        title: "Filter the guest list",
        body: "In Excel, filter the reply column to attending and check every guest has a table. Sort by table, then last name, so the printed cards come out in the order you'll set them down.",
      },
      {
        title: "Set up a card layout",
        body: "In Word, Mailings, Start Mail Merge, Labels, and pick a tent-card product if you bought pre-cut cards. For plain card stock, choose New Label and enter 4 in wide by 5 in high (a card before folding), 2 across and 2 down on Letter.",
      },
      {
        title: "Put the name on both halves",
        body: "In the first card insert a text box in the bottom half with the Guest and Table fields. Copy it into the top half and rotate that box 180° (Shape Format, Rotate), so the folded card reads from both sides. Update Labels and Finish & Merge.",
      },
      {
        title: "Print on card stock",
        body: "Set the printer's paper type to card stock or heavy paper and print at 100%. Print one page on plain paper first and fold it to check the names sit the right way up.",
      },
    ],
    limits: [
      "Card stock thickness varies. Check your printer's maximum paper weight and choose the heavy paper setting.",
      "The design is simple and clean. For a particular font or motif, describe it or give Stella a sample card.",
      "Guest names, replies and tables go to the AI model you use in Stella. The cards are made on your computer.",
      "It makes the PDF; it doesn't print it unless you ask. Cutting and folding is up to you: the cards have cut and fold lines, not perforations.",
      "Recorded on Linux, where Stella used Python and a browser already on the computer to write the PDF. On a Mac or Windows PC it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What size should place cards be?",
        a: "A folded tent card of about 3.5 to 4 × 2 to 2.5 inches is standard. Four 4 × 2.5 inch cards fit on a Letter sheet with room for cut lines.",
      },
      {
        q: "Can it add meal choices or guest initials for the caterer?",
        a: "Yes, from any column in the list: a small meal icon or letter on each card is common.",
      },
      {
        q: "Can it print on pre-cut place card sheets?",
        a: "Yes: give the product number or the card size and margins, and print a plain-paper test first.",
      },
      {
        q: "Can it do the seating chart too?",
        a: "Yes: see [make a wedding seating chart](/how/weddings-events/make-wedding-seating-chart).",
      },
    ],
    related: ["weddings-events/make-wedding-seating-chart", "weddings-events/count-wedding-rsvps", "printing-labels/make-name-tags-from-a-list"],
    lastChecked: "2026-11-14",
    sources: [MS_PRINT_LABELS],
  },
  {
    slug: "make-numbered-raffle-tickets",
    niche: "weddings-events",
    searchPhrases: ["numbered raffle tickets", "how to number raffle tickets", "raffle tickets", "how to make raffle tickets", "raffle ticket numbering"],
    title: "Make numbered raffle tickets with matching stubs to print",
    description:
      "Print raffle tickets numbered 001 to 250, each with a tear-off stub of the same number, on plain paper: Excel and Word's merge, or Stella (stella.sh).",
    h1: "Make numbered raffle tickets with matching stubs",
    short: "Numbered raffle tickets",
    lede: "250 raffle tickets, 001 to 250, each with a matching stub, ten to a page.",
    answer:
      "Number the tickets in Excel (type 1 and 2, drag down to 250, format as 000), then run a label mail merge in Word with the number field placed twice: once on the ticket and once on the stub. Stella (stella.sh) reads your event details on your computer and writes a print-ready PDF of numbered tickets and stubs, checking every number appears exactly twice.",
    stellaSteps: [
      "Reads `Raffle details.txt` in Documents for the event, price, prizes and drawing date and time",
      "Lays out ten tickets per Letter page over 25 pages, numbered 001 to 250",
      "Gives each ticket a stub with the same number and lines for name and phone, with solid cut lines and a dashed tear line",
      "Checks every number from 001 to 250 appears on exactly one ticket and its own stub, with none missing or doubled",
      "Saves `Spring Fair Raffle Tickets 001-250.pdf` next to the notes, and lists details the notes didn't give (the fair's own date, a contact) instead of guessing",
    ],
    prompt:
      "Make raffle tickets for our school's spring fair, numbered 001 to 250, each with a tear-off stub that has the same number, to print on regular paper. The details are in my Documents.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "250 tickets on 25 pages in under two minutes. Checked afterwards against an answer key written before the run: every number 001 to 250 printed exactly twice in three digits, each stub next to its own ticket, nothing past 250, at least six tickets a page, the event name, drawing date and $2 price on every ticket, name and phone lines on every stub, and the notes unchanged.",
      note: "The school and event are made up for this run. The work is sped up 6×.",
      video: {
        src: `${PROOFS}/weddings-events/make-numbered-raffle-tickets/proof.mp4`,
        cuts: webCuts("weddings-events/make-numbered-raffle-tickets"),
        poster: `${PROOFS}/weddings-events/make-numbered-raffle-tickets/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 43.97,
        realDuration: 115.5,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. The PTA's raffle notes are in Documents." },
        { at: 2, text: "The prompt: tickets 001 to 250, each with a stub of the same number, on regular paper." },
        { at: 12, text: "Stella replies: a print-ready PDF of tickets with matching numbered stubs." },
        { at: 17.8, text: "Reading the details, laying out and checking the numbers, sped up 6×." },
        { at: 30, text: "Done: 25 pages of 10 tickets, every number checked, missing details listed." },
      ],
    },
    manualTitle: "Make them yourself",
    manualSteps: [
      {
        title: "Make the numbers in Excel",
        body: "Type Number in A1, 1 in A2 and 2 in A3. Select A2:A3 and drag the fill handle down to row 251. Format the column with a custom format of `000` so they show as 001 to 250, then save the workbook.",
      },
      {
        title: "Lay out one ticket in Word",
        body: "Mailings, Start Mail Merge, Labels, New Label: about 7.5 in wide by 1 in high, 1 across and 10 down on Letter. In the first label put a narrow stub on the left with Name and Phone lines and the event details on the right.",
      },
      {
        title: "Insert the number twice",
        body: "Select Recipients, Use an Existing List, open the workbook. Insert the Number field on the stub and again on the ticket. Word ignores Excel's 000 format, so press Alt+F9 and add `\\# \"000\"` inside each field. Update Labels and Finish & Merge.",
      },
      {
        title: "Print and cut",
        body: "Print a page on plain paper to check the numbers match, then the rest. Cut along the outlines and score or fold along the stub line so it tears cleanly.",
      },
    ],
    limits: [
      "The tickets have cut lines and a dashed tear line, not perforations. Cutting 250 tickets takes a while; a paper trimmer helps.",
      "Stella uses the details in your notes and leaves out anything they don't say, such as whether winners must be present. Check local raffle rules, which some states and towns set for fundraisers.",
      "The event details go to the AI model you use in Stella. The tickets are made on your computer.",
      "It makes the PDF; it doesn't print it unless you ask.",
      "Recorded on Linux, where Stella installed a small PDF library for Python. On a Mac or Windows PC it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How many raffle tickets fit on a page?",
        a: "Ten tickets with stubs fit well on a Letter page, as in this run. Smaller tickets can fit 12 to 16 if you don't need room for prize details.",
      },
      {
        q: "Can it number tickets in a different range?",
        a: "Yes, any range and any number of digits, for example 0501 to 1000 for a second book.",
      },
      {
        q: "Can it print on colored paper or card stock?",
        a: "The PDF prints on anything your printer takes; ask for a design with less ink if you're using coloured paper.",
      },
      {
        q: "Can it make other event printables?",
        a: "Yes: see [name tags from a list](/how/printing-labels/make-name-tags-from-a-list) and [place cards from a guest list](/how/weddings-events/make-place-cards-from-guest-list).",
      },
    ],
    related: ["printing-labels/make-name-tags-from-a-list", "weddings-events/make-place-cards-from-guest-list", "printing-labels/make-certificates-from-excel"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Microsoft Support: Fill data automatically in worksheet cells", href: "https://support.microsoft.com/en-us/excel/get-started/fill-data-automatically-in-worksheet-cells" },
      MS_PRINT_LABELS,
    ],
  },
];
