import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const WEDDINGS_EVENTS_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "count-wedding-rsvps",
    niche: "weddings-events",
    searchPhrases: ["how to count rsvps", "rsvp tracker", "wedding rsvp spreadsheet", "rsvp list", "wedding guest list template"],
    title: "Count wedding RSVPs, meals and who hasn't replied",
    description:
      "Count wedding RSVPs from your form replies: the real headcount, meals and who hasn't replied, using each guest's latest answer. Stella (stella.sh) adds it up.",
    h1: "Count wedding RSVPs when some guests replied twice",
    short: "Count wedding RSVPs",
    lede: "Know who's coming, what they'll eat and who hasn't replied",
    answer:
      "Give Stella (stella.sh) your RSVP replies and invite list. It uses each household's latest answer, counts who's coming and every meal, and lists who still hasn't replied.",
    gets: [
      "The real headcount, repeat replies counted once",
      "A total for each meal",
      "Who hasn't replied, with their emails",
    ],
    prompt:
      "Our wedding RSVPs came in through a form; the replies are in Downloads and the invite list in Documents. How many are coming, how many of each meal, and who hasn't replied?",
    demo: {
      ack: "Exciting. Counting your replies now.",
      task: "Wedding RSVP count",
      rows: ["Matching replies to invitations", "Keeping each household's latest answer", "Counting the meals"],
      reply:
        "**46 people** are coming: 16 salmon, 13 vegetarian, 11 chicken and 6 kids' meals. Five invitations haven't replied yet; their emails are in the summary.",
      files: ["Wedding RSVP summary.xlsx"],
    },
    faq: [
      ["My RSVPs are in Google Forms. Does this work?", "Yes. Open the form's Responses tab, download the linked sheet, and give it to Stella."],
    ],
    byHand: [
      "Sort the replies newest first, then Data, Remove Duplicates on the email column.",
      "Total the headcount with SUMIF on Attending, and each meal with COUNTIF.",
      "Look up each invite email in the replies to find who hasn't answered.",
    ],
    related: [
      "weddings-events/make-wedding-seating-chart",
      "weddings-events/make-place-cards-from-guest-list",
      "printing-labels/print-envelopes-from-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-wedding-seating-chart",
    niche: "weddings-events",
    searchPhrases: [
      "wedding seating chart",
      "how to make a seating chart",
      "seating chart template",
      "wedding seating chart maker",
      "escort cards",
    ],
    title: "Make a printable wedding seating chart from your guest list",
    description:
      "Make a printable wedding seating chart from your guest list: everyone A to Z with their table, plus a list per table for the venue. Stella (stella.sh) builds it.",
    h1: "Make a printable wedding seating chart from your guest list",
    short: "Wedding seating chart",
    lede: "A seating chart guests can read and a table list for the venue",
    answer:
      "Give Stella (stella.sh) your guest list with tables filled in. It makes a print-ready chart: everyone who said yes, A to Z with their table, plus a page per table for the venue.",
    gets: ["A find-your-seat list, A to Z", "A page per table with meals, for the venue", "Only guests who said yes"],
    prompt:
      "Make a seating chart to print from our wedding guest list in Documents: everyone who said yes, A to Z with their table, and a page per table.",
    demo: {
      ack: "Lovely. Laying out the seating chart.",
      task: "Wedding seating chart",
      rows: ["Keeping the 77 who said yes", "Treating T3 and Table 3 as one"],
      reply:
        "Your 3-page **Wedding seating chart.pdf** is in Documents, with an editable copy. One household never replied and has no table yet.",
      files: ["Wedding seating chart.pdf"],
    },
    faq: [
      ["Should a seating chart be alphabetical or by table?", "Both. Guests look for their own name, so the board is A to Z. The venue wants a list per table."],
    ],
    byHand: [
      "Filter the guest list to Yes, and make every table name match (3, Table 3, T3).",
      "Sort by last name and print the name and table columns for the board.",
      "Sort by table, then Data, Subtotal with a page break per table for the venue.",
    ],
    related: [
      "weddings-events/make-place-cards-from-guest-list",
      "weddings-events/count-wedding-rsvps",
      "printing-labels/print-poster-on-multiple-pages",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-place-cards-from-guest-list",
    niche: "weddings-events",
    searchPhrases: [
      "how to make place cards",
      "place cards template",
      "place cards",
      "place cards from guest list",
      "printable place cards",
    ],
    title: "Make place cards from a guest list, with table numbers",
    description:
      "Make place cards from your guest list: fold-over cards with each guest's name and table number, four to a page, ready for card stock. Stella (stella.sh) makes them.",
    h1: "Make place cards from your guest list",
    short: "Place cards from a guest list",
    lede: "Fold-over place cards with each guest's name and table",
    answer:
      "Give Stella (stella.sh) your guest list. It makes fold-over place cards for everyone attending, with name and table number on both sides, four to a page with cut and fold lines.",
    gets: [
      "A card for each guest attending",
      "Name and table readable from both sides",
      "Sorted by table, ready to lay out",
    ],
    prompt:
      "Make place cards for our rehearsal dinner from the guest list in my Documents: name and table number on fold-over cards, several per page, only for people attending.",
    demo: {
      ack: "Sure. Making your place cards.",
      task: "Rehearsal dinner place cards",
      rows: ["Keeping the 33 guests attending", "Putting names on both halves"],
      reply:
        "**33 place cards** on 9 pages are next to your guest list. Print on card stock at 100%, then cut and fold.",
      files: ["Rehearsal dinner place cards.pdf"],
    },
    faq: [
      ["What size should place cards be?", "About 4 × 2.5 inches folded. Four fit on a Letter sheet with room for cut lines."],
    ],
    byHand: [
      "Filter your list to attending and sort by table, then last name.",
      "In Word, Mailings, Start Mail Merge, Labels: 4 by 5 inch cards, 2 across and 2 down.",
      "Put the name and table in both halves, rotate the top one 180°, then Finish & Merge.",
    ],
    related: [
      "weddings-events/make-wedding-seating-chart",
      "weddings-events/count-wedding-rsvps",
      "printing-labels/make-name-tags-from-a-list",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-numbered-raffle-tickets",
    niche: "weddings-events",
    searchPhrases: [
      "numbered raffle tickets",
      "how to number raffle tickets",
      "raffle tickets",
      "how to make raffle tickets",
      "raffle ticket numbering",
    ],
    title: "Make numbered raffle tickets with matching stubs to print",
    description:
      "Make numbered raffle tickets with matching stubs to print: any range, ten to a page, every number used exactly once. Stella (stella.sh) makes the PDF for you.",
    h1: "Make numbered raffle tickets with matching stubs",
    short: "Numbered raffle tickets",
    lede: "Raffle tickets numbered in order, each with a matching stub",
    answer:
      "Tell Stella (stella.sh) the numbers you need and your event details. It makes a print-ready PDF of raffle tickets, each with a tear-off stub carrying the same number, ten to a page.",
    gets: [
      "Tickets and stubs with matching numbers",
      "Name and phone lines on each stub",
      "Every number used exactly once",
    ],
    prompt:
      "Make raffle tickets for our school's spring fair, numbered 001 to 250, each with a tear-off stub with the same number, on regular paper. The details are in my Documents.",
    demo: {
      ack: "Sure. Numbering your tickets now.",
      task: "Spring fair raffle tickets",
      rows: ["Reading the prizes and price", "Numbering 001 to 250"],
      reply:
        "Done. 250 tickets on 25 pages, each number on one ticket and its stub. Your notes don't say the fair's date, so tell me and I'll add it.",
      files: ["Spring Fair Raffle Tickets 001-250.pdf"],
    },
    faq: [
      ["How many raffle tickets fit on a page?", "Ten tickets with stubs fit well on a Letter page. Smaller ones fit 12 to 16."],
    ],
    byHand: [
      "In Excel, type 1 and 2, drag down to 250 and format the column as 000.",
      "In Word, run a Labels mail merge from that sheet, 1 across and 10 down.",
      "Insert the Number field twice, on the stub and the ticket, then print a test page.",
    ],
    related: [
      "printing-labels/make-name-tags-from-a-list",
      "weddings-events/make-place-cards-from-guest-list",
      "printing-labels/make-certificates-from-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
