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
  shortGuide({
    slug: "make-wedding-budget-spreadsheet",
    niche: "weddings-events",
    searchPhrases: [
      "wedding budget spreadsheet",
      "wedding budget spreadsheet template",
      "wedding budget tracker",
      "wedding budget breakdown",
      "wedding vendor payment schedule",
    ],
    title: "Make a wedding budget spreadsheet from your vendor quotes",
    description:
      "Turn your vendor quotes, contracts and emails into a wedding budget spreadsheet: every cost, deposits paid, what's left and when it's due. Stella (stella.sh) builds it.",
    h1: "Make a wedding budget spreadsheet from your vendor quotes",
    short: "Wedding budget spreadsheet",
    lede: "Every wedding cost, what's paid and what's due next, in one sheet",
    answer:
      "Point Stella (stella.sh) at your vendor quotes, contracts and booking emails. It builds a wedding budget spreadsheet with every cost, the deposits you've paid, what's still owed and each due date.",
    gets: [
      "Each vendor's full price, with fees and tax added",
      "Deposits paid and balances left",
      "A payment calendar sorted by due date",
    ],
    prompt:
      "Our wedding budget is 30k. Vendor quotes and contracts are in Documents/Wedding, booking emails in Gmail. Make a budget sheet: what's paid, what's left, and when each payment is due.",
    demo: {
      ack: "Happy to. Pulling the numbers from your quotes.",
      task: "Wedding budget from quotes",
      rows: ["Reading 11 quotes and 6 contracts", "Adding service charges and tax", "Matching deposits to your emails"],
      reply:
        "**Wedding budget.xlsx** is in Documents/Wedding. You're at $31,420, so $1,420 over, mostly the caterer's 22% service charge. $9,850 is paid; the next payment is the florist's $1,200 on March 3.",
      files: ["Wedding budget.xlsx"],
    },
    faq: [
      [
        "What share of a wedding budget goes to the venue?",
        "Usually the biggest share: venue and food together often take about half. Your sheet shows your own split by category, so you see where the money goes.",
      ],
    ],
    byHand: [
      "Start from a free wedding budget template in Google Sheets or Excel.",
      "Add a row per vendor: quoted total, service charge and tax, deposit, balance and due date.",
      "Total the balance column and sort by due date for a payment calendar.",
    ],
    related: [
      "weddings-events/compare-wedding-vendor-quotes",
      "weddings-events/wedding-day-timeline",
      "money-household/make-a-budget-from-bank-statement",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "compare-wedding-vendor-quotes",
    niche: "weddings-events",
    searchPhrases: [
      "wedding vendor comparison spreadsheet",
      "compare wedding vendor quotes",
      "wedding vendor comparison template",
      "compare wedding photographer packages",
      "compare wedding catering quotes",
    ],
    title: "Compare wedding vendor quotes side by side in one sheet",
    description:
      "Line up wedding vendor quotes side by side: the real total with fees, what each package includes and the deposit terms. Stella (stella.sh) makes the comparison sheet.",
    h1: "Make a wedding vendor comparison spreadsheet from your quotes",
    short: "Compare wedding vendor quotes",
    lede: "See which quote is really cheaper, and what each one leaves out",
    answer:
      "Give Stella (stella.sh) the quotes you've collected for one job, like photographers or caterers. It lines them up side by side: the real total, what's included, what costs extra, and the deposit and cancellation terms.",
    gets: [
      "Real totals with the small-print fees added",
      "What each package includes, row by row",
      "Deposit and cancellation terms next to each other",
    ],
    prompt:
      "I have quotes from four caterers for 120 guests, PDFs and emails in Documents/Wedding/Catering. Put them side by side so I can see which is really cheapest and what each one includes.",
    demo: {
      ack: "Good idea. Lining up the caterers now.",
      task: "Caterer quotes side by side",
      rows: ["Reading four quotes for 120 guests", "Adding service charge, tax and cake cutting", "Comparing what each one includes"],
      reply:
        "**Caterer comparison.xlsx** is in Documents/Wedding/Catering. Bella Cucina looked cheapest but comes second once its 20% service charge and rentals are added. Harvest Table is lowest all-in and includes linens.",
      files: ["Caterer comparison.xlsx"],
    },
    faq: [
      [
        "What should a wedding catering quote include?",
        "Price per guest, service charge, tax, staff, rentals like linens, cake cutting and the deposit schedule. A missing line usually means a cost later.",
      ],
    ],
    byHand: [
      "Make a sheet with a column per vendor and a row per item: base price, fees, tax, staff, rentals.",
      "Write 'not included' wherever a quote is silent, then ask that vendor.",
      "Add an all-in total row and the deposit terms.",
    ],
    related: [
      "weddings-events/make-wedding-budget-spreadsheet",
      "weddings-events/wedding-day-timeline",
      "weddings-events/count-wedding-rsvps",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "wedding-guest-list-with-addresses",
    niche: "weddings-events",
    searchPhrases: [
      "wedding guest list with addresses",
      "wedding guest address spreadsheet",
      "collect addresses for wedding invites",
      "wedding guest list address template excel",
      "wedding guest list from contacts",
    ],
    title: "Make a wedding guest list with addresses from all your lists",
    description:
      "Merge your contacts, texted addresses and family lists into one wedding guest list with addresses, one row per household, gaps flagged. Stella (stella.sh) does it.",
    h1: "Make a wedding guest list with addresses, from everywhere they are",
    short: "Guest list with addresses",
    lede: "One clean list with every household's address, gaps flagged",
    answer:
      "Give Stella (stella.sh) your phone contacts, the addresses people texted you and your parents' lists. It merges them into one wedding guest list, one row per household, with repeats combined and missing addresses flagged.",
    gets: [
      "One row per household, with the full mailing address",
      "The same people from different lists merged",
      "Who's still missing an address",
    ],
    prompt:
      "Our wedding guest list is spread across my contacts, my mum's spreadsheet and screenshots of addresses people texted me, all in Downloads. Make one list with everyone's mailing address and tell me who's missing one.",
    demo: {
      ack: "On it. Gathering everyone into one list.",
      task: "Wedding guest addresses",
      rows: ["Reading contacts, your mum's sheet, 14 screenshots", "Merging people who appear twice", "Grouping guests into households"],
      reply:
        "**Wedding guest list.xlsx** is in Documents: 92 households, 168 guests. Nine households have no address yet and three have two different ones to confirm. A message you can text them is on the second tab.",
      files: ["Wedding guest list.xlsx"],
    },
    faq: [
      [
        "How do I get addresses from guests for wedding invites?",
        "Send one short text asking for their mailing address. Stella writes the message, and adds the replies to your list when you share them.",
      ],
    ],
    byHand: [
      "Export your contacts as a spreadsheet from iCloud or Google Contacts.",
      "Paste every list into one sheet, sort by last name and merge repeats by hand.",
      "Add a household column, then filter for blank addresses to see who to ask.",
    ],
    related: [
      "weddings-events/address-wedding-invitations",
      "weddings-events/count-wedding-rsvps",
      "contacts-calendar-email/merge-duplicate-contacts",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "address-wedding-invitations",
    niche: "weddings-events",
    searchPhrases: [
      "how to address wedding invitations",
      "how to address wedding invitations to a married couple",
      "how to address wedding invitations to a family",
      "wedding guest address labels",
      "how to address wedding invitations plus one",
    ],
    title: "Address wedding invitations properly, then print them",
    description:
      "Address wedding invitations the proper way for couples, families and plus-ones, then print envelopes or clear labels in your font. Stella (stella.sh) does the whole list.",
    h1: "How to address wedding invitations, done for your whole list",
    short: "Address wedding invitations",
    lede: "The right names on every envelope, printed in the font you like",
    answer:
      "Give Stella (stella.sh) your guest list. It writes each envelope's names the proper way for couples, families and plus-ones, then makes printable envelopes or clear address labels in your font.",
    gets: [
      "Traditional or modern names for every household",
      "Couples, kids, plus-ones and doctors done right",
      "Envelopes or clear labels ready to print",
    ],
    prompt:
      "Address our wedding invitations from the guest list in Documents. Traditional style, A7 envelopes, in a script font. Some are couples with different last names, some are families with kids.",
    demo: {
      ack: "Lovely. Writing each envelope's names first.",
      task: "Wedding invitation envelopes",
      rows: ["Writing names for 92 households", "Showing both last names for 11 couples", "Laying out A7 envelopes in script"],
      reply:
        "**Wedding envelopes.pdf**, 92 envelopes plus a return address page, is in Documents. Two households only have first names; send me their surnames and I'll redo those.",
      files: ["Wedding envelopes.pdf", "Envelope names.xlsx"],
    },
    faq: [
      [
        "How do you address a wedding invitation to a married couple?",
        "Traditional is “Mr. and Mrs. James Carter”. Modern is “James and Emily Carter”. With different last names, write both full names on one line, joined by “and”.",
      ],
      [
        "How do you address a wedding invitation to a family?",
        "Write the parents, then the children's first names: “Mr. and Mrs. Carter, Ava and Leo”. Children over 18 get their own invitation.",
      ],
    ],
    byHand: [
      "Add an envelope name column to your guest list and fill it in.",
      "In Word, Mailings, Envelopes, choose the A7 size and your font, then merge from the list.",
    ],
    related: [
      "weddings-events/wedding-guest-list-with-addresses",
      "printing-labels/print-envelopes-from-excel",
      "printing-labels/print-address-labels-from-excel",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "wedding-day-timeline",
    niche: "weddings-events",
    searchPhrases: [
      "wedding day timeline",
      "wedding day timeline template",
      "wedding run of show",
      "wedding reception run of show",
      "wedding day schedule for vendors",
    ],
    title: "Make a wedding day timeline and run of show for vendors",
    description:
      "Make your wedding day timeline and run of show: getting ready, photos, ceremony and reception cues, plus a page per vendor. Stella (stella.sh) builds it from your plans.",
    h1: "Make your wedding day timeline and run of show",
    short: "Wedding day timeline",
    lede: "Who's where, and when, for you, the wedding party and every vendor",
    answer:
      "Tell Stella (stella.sh) your ceremony time and venue, and give it your vendor contracts. It builds the wedding day timeline working back from the ceremony, a run of show for the reception, and a page for each vendor.",
    gets: [
      "Hair, photos and arrivals timed back from the ceremony",
      "A reception run of show, cue by cue",
      "A one-page sheet per vendor with contacts",
    ],
    prompt:
      "Our ceremony is at 4pm at Willow Creek Barn, reception right after. Contracts for the photographer, DJ and caterer are in Documents/Wedding. Make the wedding day timeline and a run of show for the vendors.",
    demo: {
      ack: "Exciting. Building the day around 4pm.",
      task: "Wedding day timeline",
      rows: ["Working back from the 4pm ceremony", "Reading photographer, DJ and caterer contracts", "Finding sunset for your date"],
      reply:
        "**Wedding day timeline.pdf** is in Documents/Wedding: hair at 9:30, first look at 2:15, dinner at 6, sunset photos at 7:05, and a page per vendor. The DJ's contract ends at 10, before your last dance.",
      files: ["Wedding day timeline.pdf"],
    },
    faq: [
      [
        "How early should hair and makeup start?",
        "Allow about 45 minutes per person and finish an hour before photos. For a 4pm ceremony with four people, that usually means starting around 9 or 10.",
      ],
    ],
    byHand: [
      "Start from the ceremony time and work backwards: getting ready, photos, guest arrivals.",
      "List the reception in order: entrance, dinner, toasts, first dance, cake, last dance.",
      "Copy each vendor's arrival time, contact and duties onto their own short sheet.",
    ],
    related: [
      "weddings-events/make-wedding-budget-spreadsheet",
      "weddings-events/make-wedding-seating-chart",
      "video/make-wedding-video-from-phone-clips",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "travel-itinerary-from-booking-emails",
    niche: "weddings-events",
    searchPhrases: [
      "how to make a travel itinerary",
      "travel itinerary from booking emails",
      "travel itinerary template",
      "trip itinerary maker",
      "itinerary from confirmation emails",
    ],
    title: "Make a travel itinerary from your booking emails",
    description:
      "Turn your booking emails and confirmations into one day-by-day travel itinerary with times, addresses and confirmation numbers. Stella (stella.sh) puts it together.",
    h1: "Make a travel itinerary from your booking emails",
    short: "Itinerary from booking emails",
    lede: "Every booking in one day-by-day plan, with times and directions",
    answer:
      "Stella (stella.sh) finds your trip's booking emails and confirmations, then builds a day-by-day travel itinerary: when to leave, where you're staying, what's booked, confirmation numbers and a map link for each place.",
    gets: [
      "Every booking pulled from your inbox and PDFs",
      "A day-by-day plan with check-in times",
      "Confirmation numbers and addresses in one place",
    ],
    prompt:
      "We're going to Portugal May 3 to 14. The airline, three hotels, a rental car and tours are booked, all in my Gmail. Make me a day-by-day itinerary I can print.",
    demo: {
      ack: "Sounds amazing. Finding your bookings.",
      task: "Portugal trip itinerary",
      rows: ["Found 9 booking emails and 2 PDFs", "Putting everything in order, day by day", "Adding map links for each stay"],
      reply:
        "**Portugal itinerary.pdf** and an editable copy are in Documents/Trips, with times, confirmation numbers and directions for all 12 days. One gap: your Lisbon checkout is May 7 but Porto starts May 8. Book a night or move a date.",
      files: ["Portugal itinerary.pdf"],
    },
    faq: [
      [
        "What should a travel itinerary include?",
        "Dates and times, where you sleep each night with the address, how you get between places, what's booked and the confirmation numbers. Free days can stay open.",
      ],
    ],
    byHand: [
      "Search your email for “confirmation”, “booking” and “reservation” around the trip dates.",
      "Make a table with a row per day: travel, where you sleep, plans and confirmation numbers.",
      "Add a Google Maps link for each address, then save it as a PDF.",
    ],
    related: [
      "weddings-events/plan-a-road-trip-with-stops",
      "weddings-events/make-a-packing-list-for-a-trip",
      "apps/make-a-trip-planner-app",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "plan-a-road-trip-with-stops",
    niche: "weddings-events",
    searchPhrases: [
      "road trip planner with stops",
      "road trip itinerary",
      "plan a road trip with multiple stops",
      "road trip planner with stops google maps",
      "road trip route with overnight stops",
    ],
    title: "Plan a road trip with stops, day by day, with Google Maps",
    description:
      "Plan a road trip with stops: daily drives kept short, places worth stopping, towns to sleep in and a Google Maps route for each day. Stella (stella.sh) plans it.",
    h1: "A road trip planner with stops, overnight stays and drive times",
    short: "Road trip with stops",
    lede: "A day-by-day drive plan with stops worth seeing and where to sleep",
    answer:
      "Tell Stella (stella.sh) where you start, where you're headed and how many days you have. It plans the road trip day by day: how long each drive takes, places worth stopping, towns to sleep in, and Google Maps links.",
    gets: [
      "Daily drives kept under the hours you choose",
      "Stops for food, views and stretching legs",
      "A town to stay in each night",
    ],
    prompt:
      "Plan a road trip from Denver to San Francisco over 6 days with the kids. No more than 5 hours of driving a day, and we'd love a couple of national parks on the way.",
    demo: {
      ack: "Fun trip. Mapping out the drive.",
      task: "Denver to San Francisco road trip",
      rows: ["Splitting about 1,300 miles into 6 days", "Fitting in Arches and Lake Tahoe", "Picking towns to sleep each night"],
      reply:
        "**Road trip plan.pdf** is in Documents/Trips. Six days of 3 to 5 hours driving: Grand Junction, Moab, Salt Lake City, Elko, Reno, then San Francisco. Every day has its own Google Maps route, with lunch and playground stops.",
      files: ["Road trip plan.pdf"],
    },
    faq: [
      [
        "How many stops can Google Maps take?",
        "Ten places per route, the start included. That's why Stella gives you one route per day instead of one long one.",
      ],
    ],
    byHand: [
      "Pick a daily driving limit and split the total distance by it.",
      "In Google Maps, add stops to each day's route, up to 10 places.",
      "Book a stay where each day ends.",
    ],
    related: [
      "weddings-events/travel-itinerary-from-booking-emails",
      "weddings-events/make-a-packing-list-for-a-trip",
      "video/make-travel-video-from-clips",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "write-wedding-thank-you-notes",
    niche: "weddings-events",
    searchPhrases: [
      "wedding thank you notes",
      "wedding thank you card wording",
      "wedding thank you notes for money",
      "wedding thank you card wording for gift",
      "wedding thank you notes what to write",
    ],
    title: "Write wedding thank you notes for every gift, personally",
    description:
      "Write wedding thank you notes for every gift: a short, personal note per guest that names what they gave, plus a list to tick off. Stella (stella.sh) writes them all.",
    h1: "Write your wedding thank you notes, one personal note per gift",
    short: "Wedding thank you notes",
    lede: "A warm, personal note for every guest, matched to their gift",
    answer:
      "Give Stella (stella.sh) your gift list or photos of the cards. It writes a personal wedding thank you note for each guest that names their gift, plus a list to tick off as you send them.",
    gets: [
      "A note per guest naming their gift",
      "Cash gifts thanked by what you'll spend them on",
    ],
    prompt:
      "We got 84 gifts. The gift list and a note of cash and cards are in Documents/Wedding. Write a short thank you note for each, mentioning the gift, in our voice: warm but not cheesy.",
    demo: {
      ack: "Congratulations. Starting on your notes.",
      task: "Wedding thank you notes",
      rows: ["Matching 84 gifts to the guest list", "Writing each note in your voice"],
      reply:
        "**Thank you notes.docx** is in Documents/Wedding: 84 notes of three or four lines, each naming the gift. Cash gifts mention your Lisbon honeymoon. Six gifts had no name on them; they're listed first so you can match them.",
      files: ["Thank you notes.docx"],
    },
    faq: [
      [
        "How long do you have to send wedding thank you notes?",
        "Within three months of the wedding. Gifts that arrive before the day get thanked within two weeks.",
      ],
      [
        "What do you write in a thank you note for money?",
        "Thank them warmly, then say what it's going toward, like the honeymoon or a new sofa. There's no need to mention the amount.",
      ],
    ],
    byHand: [
      "Download the gift list from your wedding registry site and add cash and cards.",
      "Write each note in three parts: thanks for the gift, how you'll use it, a line about them.",
    ],
    related: [
      "weddings-events/address-wedding-invitations",
      "weddings-events/wedding-guest-list-with-addresses",
      "weddings-events/count-wedding-rsvps",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "split-group-trip-costs",
    niche: "weddings-events",
    searchPhrases: [
      "split trip expenses",
      "group trip expense calculator",
      "split vacation costs",
      "group trip expense spreadsheet",
      "split trip expenses excel",
    ],
    title: "Split group trip expenses and settle up in a few payments",
    description:
      "Split trip expenses with friends: each cost shared by the people it was for, then the fewest payments to settle up. Stella (stella.sh) works it out from receipts.",
    h1: "Split trip expenses with friends and settle up",
    short: "Split group trip costs",
    lede: "Who paid what on the trip, and the few payments that even it out",
    answer:
      "Give Stella (stella.sh) what everyone paid on the trip: receipts, payment app screenshots or the group chat. It shares each cost between the right people and works out the fewest payments to settle up.",
    gets: [
      "Every cost shared only by who it was for",
      "Couples or kids counted the way you choose",
      "The smallest number of payments to even out",
    ],
    prompt:
      "Six of us just got back from Lisbon. Receipts and Venmo screenshots are in Downloads/Lisbon. Split everything fairly, but the boat trip was only four of us. Tell us who pays who.",
    demo: {
      ack: "Welcome back. Adding up the trip.",
      task: "Lisbon trip split",
      rows: ["Reading 38 receipts and 12 screenshots", "Boat trip shared four ways, not six", "Working out who pays who"],
      reply:
        "**Lisbon trip split.xlsx** is in Downloads/Lisbon. The trip cost €4,812, about €802 each. Four payments settle it: Sam pays Ana €310, Jo pays Ana €145, Max pays Lee €96, Kat pays Lee €51. A group chat message is ready to paste.",
      files: ["Lisbon trip split.xlsx"],
    },
    faq: [
      [
        "How do you split costs when some people skipped things?",
        "Share each cost only between the people it was for. A dinner four people ate is split four ways, even if six were on the trip.",
      ],
    ],
    byHand: [
      "List every cost with who paid and who it was for, one row each.",
      "Divide each row between its people, then total what each person paid and owes.",
      "Or have everyone add costs to Splitwise as you go.",
    ],
    related: [
      "pdf-excel/split-bills-with-roommates",
      "weddings-events/plan-a-bachelorette-party",
      "pdf-excel/receipts-to-spreadsheet",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-packing-list-for-a-trip",
    niche: "weddings-events",
    searchPhrases: [
      "packing list for vacation",
      "packing list for trip",
      "packing list for vacation with kids",
      "printable packing list",
      "packing list for international travel",
    ],
    title: "Make a packing list for your trip, from your plans and weather",
    description:
      "Make a packing list for your vacation from your real plans and the forecast: a checklist per person, outfits counted by day. Stella (stella.sh) makes it.",
    h1: "Make a packing list for your vacation, from your actual plans",
    short: "Packing list for a trip",
    lede: "A list made for this trip: the weather, the plans, who's coming",
    answer:
      "Tell Stella (stella.sh) where you're going, or point it at your itinerary. It checks the forecast and your plans, then makes a packing list for each person, with outfits counted by day and the things people forget.",
    gets: [
      "A checklist per person, kids included",
      "Clothes counted by days, with a laundry stop",
      "Gear for what you're actually doing",
    ],
    prompt:
      "Make a packing list for our week in Costa Rica in March, two adults and a 6 year old. The itinerary is in Documents/Trips. Carry-on only if we can.",
    demo: {
      ack: "Sounds great. Checking your plans and the weather.",
      task: "Costa Rica packing list",
      rows: ["Reading your 7-day itinerary", "Checking March weather in Arenal and Tamarindo", "Sizing it for carry-on bags"],
      reply:
        "**Costa Rica packing list.pdf** is in Documents/Trips, with a checklist page for each of you. Rain jackets for Arenal, water shoes for the river tour, and US plugs work there. A laundry stop on day 4 keeps it carry-on.",
      files: ["Costa Rica packing list.pdf"],
    },
    faq: [
      [
        "How many outfits should I pack for a week?",
        "Plan for half the days plus one and do laundry midway. Shoes take the most room, so two or three pairs is plenty.",
      ],
    ],
    byHand: [
      "Check the forecast for each place and date you'll be there.",
      "List clothes by days, then gear for each thing on your plan.",
      "Add documents, medicine, chargers and plug adapters, then print it as a checklist.",
    ],
    related: [
      "weddings-events/travel-itinerary-from-booking-emails",
      "weddings-events/plan-a-road-trip-with-stops",
      "apps/make-a-trip-planner-app",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "plan-a-bachelorette-party",
    niche: "weddings-events",
    searchPhrases: [
      "bachelorette party planning",
      "hen party planning",
      "bachelorette party planning checklist",
      "hen party planning spreadsheet",
      "bachelorette party cost per person",
    ],
    title: "Plan a bachelorette or hen party: schedule, costs and who paid",
    description:
      "Bachelorette and hen party planning in one go: a weekend schedule, the cost per person with the bride covered, and who has paid. Stella (stella.sh) sets it all up.",
    h1: "Bachelorette party planning, from group chat to final schedule",
    short: "Bachelorette or hen party plan",
    lede: "A weekend plan, the cost per person and who still owes you",
    answer:
      "Give Stella (stella.sh) the bride's wishes, the date, a budget and the guest list. It plans the bachelorette or hen weekend: a schedule, the cost per person, a sheet of who's paid and messages ready for the group.",
    gets: [
      "A weekend schedule with the bookings to make",
      "Cost per person, with the bride's share covered",
      "Who has paid and who still owes",
    ],
    prompt:
      "I'm chief bridesmaid. Plan a hen weekend in Brighton for 10 of us in June: she wants a spa, a nice dinner and dancing. Keep it under £250 each, and track who's paid in a sheet.",
    demo: {
      ack: "So fun. Planning the weekend now.",
      task: "Brighton hen weekend",
      rows: ["Finding spas and a house for 10", "Covering the bride's share across the group", "Making the payments sheet"],
      reply:
        "**Hen weekend plan.pdf** and **Who's paid.xlsx** are in Documents. Friday arrival, Saturday spa, dinner and dancing, Sunday brunch: £231 each with the bride covered. Deposits are due March 1, and a message asking for £80 each is ready to send.",
      files: ["Hen weekend plan.pdf", "Who's paid.xlsx"],
    },
    faq: [
      [
        "Does the bride pay for her own bachelorette party?",
        "Usually not. The group splits her share of the stay, food and activities, and it's worked into everyone's cost per person.",
      ],
    ],
    byHand: [
      "Poll the group for dates and a budget.",
      "Add up the costs and divide by the guests who pay.",
      "Keep a sheet of who has paid, and send reminders before deposits are due.",
    ],
    related: [
      "weddings-events/split-group-trip-costs",
      "make-games/make-a-jackbox-style-party-game",
      "design/make-a-birthday-invitation",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "plan-a-kids-birthday-party",
    niche: "weddings-events",
    searchPhrases: [
      "kids birthday party planning checklist",
      "how to plan a child's birthday party",
      "kids birthday party checklist printable",
      "how to plan a 3 year old birthday party",
      "kids birthday party schedule",
    ],
    title: "Plan a kid's birthday party: checklist, schedule and guests",
    description:
      "A kids birthday party planning checklist made for your party: countdown to-dos, a two-hour schedule, a shopping list and a guest list. Stella (stella.sh) makes it all.",
    h1: "Kids birthday party planning checklist, made for your party",
    short: "Kid's birthday party plan",
    lede: "A checklist, a party schedule and who's coming, made for your kid",
    answer:
      "Tell Stella (stella.sh) your kid's age, the theme, the place and who to invite. It makes a birthday party checklist with dates, an hour-by-hour party schedule, a shopping list and a guest list to track replies.",
    gets: [
      "A countdown checklist from four weeks out",
      "A party schedule with games for their age",
      "A guest list with parents' numbers and allergies",
    ],
    prompt:
      "Plan my son's 7th birthday: a dinosaur party at home on April 12, about 15 kids. The class list is in Downloads. I need a checklist, a 2-hour schedule and a shopping list.",
    demo: {
      ack: "Happy birthday to him. Planning the party.",
      task: "Dinosaur party for a 7th birthday",
      rows: ["Reading the class list", "Planning two hours of games and food", "Sizing food and favors for 15 kids"],
      reply:
        "**Dino party plan.pdf** is in Documents: a checklist starting March 15, the 2-hour schedule (fossil dig, dino egg hunt, cake at 3:15) and a shopping list. **Party guests.xlsx** has the class ready for replies and allergies.",
      files: ["Dino party plan.pdf", "Party guests.xlsx"],
    },
    faq: [
      [
        "How long should a kids birthday party be?",
        "About 90 minutes to 2 hours for ages 4 to 8. Toddlers do better with an hour to an hour and a half.",
      ],
    ],
    byHand: [
      "Pick the date, place and headcount, then send invites three weeks out.",
      "Plan the party in blocks: arrival game, main activity, food, cake, goodbye.",
      "Buy food and favors per child, plus a few spares.",
    ],
    related: [
      "design/make-a-birthday-invitation",
      "weddings-events/baby-shower-checklist-and-guest-list",
      "make-games/make-a-video-game-as-a-gift",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "baby-shower-checklist-and-guest-list",
    niche: "weddings-events",
    searchPhrases: [
      "baby shower checklist",
      "baby shower guest list",
      "baby shower checklist for host",
      "baby shower planning template",
      "baby shower invite list",
    ],
    title: "Make a baby shower checklist and guest list for the host",
    description:
      "A baby shower checklist for the host, counted back from the date, plus one guest list merged from everyone's names, with replies and gifts. Stella (stella.sh) makes both.",
    h1: "A baby shower checklist and guest list for the host",
    short: "Baby shower checklist and guests",
    lede: "Everything to do before the day, and who's invited and coming",
    answer:
      "Tell Stella (stella.sh) the date, the place and where the names are. It makes a baby shower checklist for the host with dates, one guest list with addresses and replies, and a gift list for thank-you notes.",
    gets: [
      "A host's checklist counted back from the date",
      "One guest list from everyone's names",
      "A gift list for thank-you notes",
    ],
    prompt:
      "I'm hosting my sister's baby shower on June 7 at my house. Make me a checklist, and a guest list from the names she emailed me plus her mother-in-law's spreadsheet in Downloads.",
    demo: {
      ack: "How lovely. Setting up the shower.",
      task: "Baby shower plan and guests",
      rows: ["Reading your sister's email and the spreadsheet", "Merging 41 names, 6 on both lists", "Counting back from June 7"],
      reply:
        "**Baby shower checklist.pdf** and **Shower guests.xlsx** are in Documents. 35 guests, 4 still need an address. Invites go out by May 10. The gift tab is ready to fill in as presents are opened.",
      files: ["Baby shower checklist.pdf", "Shower guests.xlsx"],
    },
    faq: [
      [
        "How far ahead should baby shower invites go out?",
        "Four to six weeks before. For a June 7 shower, send them by early May.",
      ],
    ],
    byHand: [
      "Start a checklist six weeks out: date, place, invites, food, games, decorations.",
      "Combine every invite list in one sheet and remove names that appear twice.",
      "Add columns for reply, plus-ones and gift, and fill them in as answers come.",
    ],
    related: [
      "weddings-events/plan-a-kids-birthday-party",
      "weddings-events/wedding-guest-list-with-addresses",
      "design/make-a-birthday-invitation",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
