import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const WATCHES_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "ticketmaster-ticket-alerts",
    niche: "watches",
    searchPhrases: [
      "ticketmaster alert when tickets are available",
      "ticketmaster alerts for tickets",
      "ticketmaster alert for resale tickets",
      "ticketmaster notify me when tickets are available",
      "sold out concert tickets",
      "concert ticket alerts",
    ],
    title: "Ticketmaster alert when tickets are available, even if sold out",
    description:
      "Show sold out? Ask Stella (stella.sh) to keep checking Ticketmaster for returned and resale tickets and message your phone the moment a pair shows up.",
    h1: "Ticketmaster alert when tickets are available",
    short: "Ticketmaster alerts for a sold-out show",
    lede: "Two seats come back for a sold-out night, and your phone tells you.",
    answer:
      "Tickets for sold-out shows keep coming back as holds are released and fans resell. Stella (stella.sh) keeps looking at the event page and messages you when seats you'd take appear.",
    gets: [
      "A watch on the exact night you want",
      "Only the number of seats and the price you'd accept",
      "The page open at those seats, ready for you to pay",
    ],
    prompt:
      "Olivia Dean is sold out on Ticketmaster. Tell me as soon as two seats together come up for the Friday, under $180 each with fees.",
    demo: {
      ack: "On it. Opening the Friday show first.",
      task: "Watching the Friday show",
      rows: ["Found the Friday date", "Reading standard and resale seats", "Setting the check for every 5 minutes"],
      reply:
        "I'm watching. Every **5 minutes** I'll look at standard and resale seats for Friday. When two together are under **$180 with fees**, I'll message your phone with the section, row and price, and open them on your computer.",
    },
    faq: [
      ["Do sold-out shows really get more tickets?", "Often. Production seats are released near the date, and people resell right up to the night."],
      ["Can it watch several dates at once?", "Yes. Name the nights and cities you'd go to, and it looks at each one."],
    ],
    byHand: [
      "In the Ticketmaster app, favorite the artist, then turn on alerts under My Account → Settings. These mainly cover new dates.",
      "Open the event page a few times a day, with Resale switched on and your ticket count set.",
    ],
    related: ["watches/concert-ticket-price-drop-alert", "watches/website-change-alert", "watches/restock-alert"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "concert-ticket-price-drop-alert",
    niche: "watches",
    searchPhrases: [
      "concert ticket price drop alert",
      "concert ticket price tracker",
      "do concert tickets drop in price the day of",
      "stubhub price alert",
      "seatgeek price alert",
    ],
    title: "Concert ticket price drop alert across StubHub, SeatGeek and more",
    description:
      "Waiting for resale prices to fall? Stella (stella.sh) compares StubHub, SeatGeek and Ticketmaster with fees included and tells you when a seat hits your price.",
    h1: "Concert ticket price drop alert",
    short: "Concert ticket price drop alerts",
    lede: "Buy when the price falls, without refreshing four resale sites.",
    answer:
      "Resale prices move all week and often fall close to the show. Stella (stella.sh) compares the resale sites with fees added and pings you when one reaches your number.",
    gets: [
      "StubHub, SeatGeek, Vivid Seats and Ticketmaster side by side",
      "The full price at checkout, fees included",
      "A price history sheet, so you can see which way it's heading",
    ],
    prompt:
      "Track prices for two floor tickets to The Weeknd on Saturday across StubHub, SeatGeek and Ticketmaster. Tell me when any drops below $150 each.",
    demo: {
      ack: "Sure. Getting today's prices from all three.",
      task: "Tracking floor ticket prices",
      rows: ["Finding Saturday on each site", "Adding the fees to each price", "Saving today's prices to a sheet"],
      reply:
        "Tracking started. I'll compare all three **every hour**, then every 10 minutes on Saturday. The first floor pair under **$150 each** goes to your phone with the site and row. Prices so far are in your sheet.",
      files: ["The Weeknd Saturday prices.xlsx"],
    },
    faq: [
      ["Do concert tickets drop in price the day of?", "They often do, as sellers would rather take less than be left with seats. The sheet shows how your show is moving."],
      ["How do I set the right price?", "Ask for the going rate first. Stella looks at what your section sells for and suggests a number."],
    ],
    byHand: [
      "In the SeatGeek and StubHub apps, open the event, favorite it and turn on price notifications.",
      "Filter by section and quantity, and switch on prices with fees.",
    ],
    related: ["watches/ticketmaster-ticket-alerts", "watches/price-drop-alert", "watches/hotel-price-drop-alert"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "restock-alert",
    niche: "watches",
    searchPhrases: [
      "restock alert",
      "back in stock alert",
      "ps5 pro restock alert",
      "switch 2 restock alerts",
      "lego restock alert",
      "sneaker restock alerts",
    ],
    title: "Restock alert for anything: consoles, Lego, sneakers, GPUs",
    description:
      "Sold out everywhere? Stella (stella.sh) checks every store that carries it, in your size or color, and messages your phone when it's back in stock.",
    h1: "Restock alert for any sold-out item",
    short: "Restock alerts for sold-out items",
    lede: "Every store watched at once, and a buzz when it's back.",
    answer:
      "Store emails arrive late and cover one shop. Stella (stella.sh) watches every store selling the thing you want, checks your exact size or version, and messages you when it's buyable.",
    gets: [
      "One watch across all the shops, plus your local store",
      "Only real stock at the normal price, no marked-up resellers",
      "The product page opened and added to your cart if you ask",
    ],
    prompt:
      "Let me know when the Lego Minas Tirith set is back in stock anywhere at the normal price. Check Lego, Amazon, Target and Walmart.",
    demo: {
      ack: "Got it. Finding the set in all four shops.",
      task: "Watching for Lego Minas Tirith",
      rows: ["Matching the same set in each shop", "Noting Lego's own price", "Checking stock, then every 10 minutes"],
      reply:
        "All four are sold out right now, so I'm on watch. I'll look **every 10 minutes** and skip sellers asking more than Lego does. The second one turns in stock, your phone gets the shop and link, and the page opens here.",
    },
    faq: [
      ["Can it look for one shoe size?", "Yes. Give the style, colorway and size, and it ignores the rest."],
      ["Will it look at stores near me?", "Yes. Tell it your zip code and it reads the pickup stock for nearby branches."],
    ],
    byHand: [
      "Press Notify me on each store's product page and sign in so the email reaches you.",
      "Set a [Keepa](https://keepa.com) alert for Amazon stock, sold by Amazon only.",
      "Check [BrickSeek](https://brickseek.com) for local Walmart and Target shelves.",
    ],
    related: ["watches/pokemon-restock-alerts", "watches/price-drop-alert", "watches/website-change-alert"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "pokemon-restock-alerts",
    niche: "watches",
    searchPhrases: [
      "pokemon restock alerts",
      "pokemon restock alert app",
      "pokemon restock alerts discord",
      "restock alerts for pokemon cards",
      "pokemon card restock",
    ],
    title: "Pokémon restock alerts for cards, boxes and tins at retail",
    description:
      "Get Pokemon restock alerts for the sets you collect. Stella (stella.sh) watches Pokémon Center, Target, Walmart and Best Buy and messages your phone.",
    h1: "Pokemon restock alerts for the sets you want",
    short: "Pokémon card restock alerts",
    lede: "Your sets, at retail, without living in a Discord channel.",
    answer:
      "Discord channels shout about every product in every country. Stella (stella.sh) watches only the Pokémon sets you collect, in the shops you use, and buzzes you when one is at retail.",
    gets: [
      "Elite Trainer Boxes, bundles and tins you picked, nothing else",
      "Pokémon Center's waiting room noticed as it opens",
      "A list of every drop it saw, with day and hour",
    ],
    prompt:
      "Watch for 30th Celebration Elite Trainer Boxes at Pokémon Center, Target, Walmart and Best Buy. Ping my phone at retail price only, day or night.",
    demo: {
      ack: "Okay. Starting with the box at each shop.",
      task: "Watching for 30th Celebration boxes",
      rows: ["Finding the box in four shops", "Ruling out third-party sellers", "Starting a log of drops"],
      reply:
        "Set. I'll check the four shops **every 5 minutes**, around the clock. If a box shows up at retail, or Pokémon Center puts up its queue, I'll ping your phone and open the page. Each drop goes into your log.",
      files: ["Pokemon drops.xlsx"],
    },
    faq: [
      ["When do Pokémon cards restock?", "It varies by store and week. The log shows which days and hours your own shops tend to refill."],
      ["Can I add my local card shop?", "Yes. If it has a website, paste the link and say which products matter."],
    ],
    byHand: [
      "Save the products to your Target and Walmart lists and allow app notifications.",
      "Follow a restock account on X for your country, with post notifications on.",
      "Use an alert service such as [NowInStock](https://www.nowinstock.net), which covers trading cards.",
    ],
    related: ["watches/restock-alert", "watches/price-drop-alert", "watches/ticketmaster-ticket-alerts"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "price-drop-alert",
    niche: "watches",
    searchPhrases: [
      "price drop alert",
      "price tracker app",
      "walmart price tracker",
      "amazon price tracker",
      "best buy price tracker",
      "price drop alert app",
    ],
    title: "Price drop alert for any product, in any store",
    description:
      "Name the product and what you'd pay. Stella (stella.sh) tracks the price at Amazon, Walmart, Best Buy or any shop and messages you when it drops.",
    h1: "Price drop alert for any product",
    short: "Price drop alerts for any product",
    lede: "Name your price, then forget about it until it gets there.",
    answer:
      "Most price apps cover one store. Stella (stella.sh) follows a product in any shop with a web page, big or tiny, and tells you when it falls to what you'd pay.",
    gets: [
      "Amazon, Walmart, Best Buy and small shops together",
      "Coupons and member prices counted in",
      "A message only when it reaches your number",
    ],
    prompt:
      "I want the Dyson V15 for under $450. Keep an eye on Amazon, Walmart, Best Buy and Dyson's own site and message me when it gets there.",
    demo: {
      ack: "Happy to. Looking up the V15 at all four.",
      task: "Tracking the Dyson V15",
      rows: ["Picking the same V15 version everywhere", "Writing down the four prices", "Setting two looks a day"],
      reply:
        "I'm tracking it. I'll compare the four shops **morning and evening**, refurbished ones left out. When a new V15 is **under $450**, you'll get a phone message with the shop, price and any code to enter, and I'll open the page.",
    },
    faq: [
      ["Can I track a whole wish list?", "Yes. Paste the links or a screenshot of your cart, with a price for each."],
      ["Does it know if a sale is real?", "It keeps the prices it has seen, so you can tell a true low from a raised-then-cut tag."],
    ],
    byHand: [
      "Set an Amazon price alert at [camelcamelcamel.com](https://camelcamelcamel.com) with your target.",
      "Search the product on Google Shopping and turn on Track price.",
      "For other stores, save it to a wish list in their app and allow notifications.",
    ],
    related: ["watches/restock-alert", "watches/hotel-price-drop-alert", "watches/concert-ticket-price-drop-alert"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "hotel-price-drop-alert",
    niche: "watches",
    searchPhrases: [
      "hotel price drop alert",
      "hotel price dropped after booking",
      "hotel price tracker",
      "hotel price drop after booking",
      "hotel price tracker app",
    ],
    title: "Hotel price drop alert, before and after you book",
    description:
      "Booked a hotel you can cancel? Stella (stella.sh) keeps checking the same room and dates and tells you when it's cheaper, so you can rebook and save.",
    h1: "Hotel price drop alert, even after you book",
    short: "Hotel price drop alerts after booking",
    lede: "Same room, same nights, less money, if the rate falls.",
    answer:
      "If your booking has free cancellation, a lower rate is money back. Stella (stella.sh) rechecks the same room and nights until your cancel-by date and says when it's cheaper.",
    gets: [
      "Your confirmation read, so nothing to type in",
      "The hotel's site compared with Booking, Expedia and Hotels.com",
      "The saving in dollars, taxes and fees included",
    ],
    prompt:
      "My hotel confirmation is in Downloads. Watch the same room and dates everywhere and tell me if it gets at least $40 cheaper before I can't cancel.",
    demo: {
      ack: "Will do. Reading your confirmation now.",
      task: "Watching your hotel rate",
      rows: ["Reading room, nights and total", "Noting the cancel-by date", "Comparing four booking sites"],
      reply:
        "Watching your king room, **three nights**, until the cancel-by date. I'll compare rates **every 6 hours**. If one beats your total by **$40 or more** with free cancellation, I'll message your phone and open it with your dates filled in.",
    },
    faq: [
      ["What if the hotel price dropped after booking?", "Book the lower rate first, then cancel the old one. Stella gives you both links in that order."],
      ["Can it watch a hotel I haven't booked?", "Yes. Say where, when and what you'd pay, and it tells you when a room fits."],
    ],
    byHand: [
      "Search your hotel and dates on Google Hotels and switch on Track prices.",
      "Found a lower public rate? Ask the hotel chain to match it through its best rate guarantee.",
    ],
    related: ["watches/flight-price-drop-alert", "watches/price-drop-alert", "watches/campsite-cancellation-alerts"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "rental-listing-alerts",
    niche: "watches",
    searchPhrases: [
      "zillow rental alerts",
      "zillow alerts for new listings",
      "streeteasy alerts",
      "new apartment listings alert",
      "rightmove rental alerts",
    ],
    title: "Zillow rental alerts plus every other site, in one message",
    description:
      "New apartments go fast. Stella (stella.sh) checks Zillow, Apartments.com and Craigslist for places that truly fit you and messages your phone first.",
    h1: "Zillow rental alerts, plus every other site",
    short: "New apartment listing alerts",
    lede: "Hear about the right apartment while it's still free to view.",
    answer:
      "Built-in alerts send everything, hours late. Stella (stella.sh) checks the rental sites, reads each new listing and its photos, and messages you only about homes that fit.",
    gets: [
      "Zillow, Apartments.com, Craigslist and local landlords in one place",
      "Your must-haves read from the actual listing",
      "A note to the landlord written, waiting for your OK",
    ],
    prompt:
      "Find me new two-bedroom rentals in Portland under $2,200 that take cats and have in-unit laundry. Check all the main sites and message me right away.",
    demo: {
      ack: "Good brief. Searching the sites with it now.",
      task: "Watching Portland rentals",
      rows: ["Searching three rental sites", "Reading listings for cats and laundry", "Removing duplicates and repeat posts"],
      reply:
        "Your search is running. I'll look for new places **every 15 minutes, 7am to 10pm**. Each match reaches your phone with rent, street and photos, plus a draft message to the landlord. Today's matches are in the list below.",
      files: ["Portland rentals.xlsx"],
    },
    faq: [
      ["Can it check the commute too?", "Yes. Give it your work address and longest trip, and it leaves out places further away."],
      ["Does it work outside the US?", "Yes. It can read Rightmove, Zoopla, Immobilienscout24 or whatever sites you use."],
    ],
    byHand: [
      "On Zillow, search with your filters, press Save search and choose instant app notifications.",
      "Do the same on Apartments.com, and on StreetEasy in New York.",
      "Save your Craigslist search, then turn on its email alert.",
    ],
    related: ["watches/website-change-alert", "watches/company-job-alerts", "watches/price-drop-alert"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "get-notified-when-a-class-opens",
    niche: "watches",
    searchPhrases: [
      "get notified when a class opens up",
      "how to get into a full class",
      "class seat alert",
      "coursicle class opening notification",
      "college class waitlist notification",
    ],
    title: "Get notified when a class opens up at your college",
    description:
      "Class full? Stella (stella.sh) watches your college's course search for the section you need and messages your phone the moment a seat opens.",
    h1: "Get notified when a class opens up",
    short: "Full class: get told when a seat opens",
    lede: "Someone drops the class, and you're the first to know.",
    answer:
      "Seats in full classes open whenever someone drops. Stella (stella.sh) watches your college's course search, every section you'd take, and messages you with the number to enroll in.",
    gets: [
      "Any college with an online course search",
      "Only sections that fit around your other classes",
      "The enroll page opened, with the class number ready",
    ],
    prompt:
      "ORGO 2 is full for spring. Tell me when a seat opens in any section that doesn't clash with my schedule. My schedule is the PDF on my desktop.",
    demo: {
      ack: "On it. Reading your schedule first.",
      task: "Watching ORGO 2 for a seat",
      rows: ["Reading your spring schedule", "Finding five ORGO 2 sections", "Dropping two that clash"],
      reply:
        "Three sections fit you, so I'm watching those. I check the seat counts **every 5 minutes** until the add deadline. When one opens, your phone gets the professor, times and class number, and the enroll page opens on your computer.",
    },
    faq: [
      ["How do I get into a full class?", "Join the waitlist, email the professor, and watch for drops. Stella does the watching and drafts the email."],
      ["Is this different from Coursicle?", "It works with any college site, reads your schedule and can watch several classes together."],
    ],
    byHand: [
      "Join the official waitlist in your student portal if the class has one.",
      "Add the section on [Coursicle](https://www.coursicle.com) if your college is listed.",
    ],
    related: ["watches/website-change-alert", "watches/global-entry-appointment-alerts", "study/make-a-class-timetable"],
    costNote:
      "Yes, and it watches while your computer is on. Paid Stella plans, from $20 a month, also watch from the cloud overnight.",
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "website-change-alert",
    niche: "watches",
    searchPhrases: [
      "get notified when a website changes",
      "website change alert",
      "track website changes",
      "website change monitor",
      "webpage change alert",
    ],
    title: "Get notified when a website changes the part you care about",
    description:
      "Paste a link and say what matters. Stella (stella.sh) watches the page and tells you in plain words what changed, skipping ads and tiny edits.",
    h1: "Get notified when a website changes",
    short: "Get told when a web page changes",
    lede: "Paste a link, say what matters, and hear about that part alone.",
    answer:
      "Ordinary page watchers go off for every ad and date. Stella (stella.sh) reads the page like you would and messages you only when the thing you named changes.",
    gets: [
      "Any page you can open, from town halls to fan shops",
      "What changed, said in one sentence",
      "Old and new copies kept to compare",
    ],
    prompt:
      "Watch my town's housing page and tell me when the affordable housing waiting list opens. Ignore everything else on it. I'll paste the link.",
    demo: {
      ack: "Sure thing. Reading the page as it is today.",
      task: "Watching the housing page",
      rows: ["Saving today's copy", "Finding the waiting list line", "Setting an hourly look"],
      reply:
        "It says **closed** today. I'll reread that page **every hour**, and look inside any new PDF they post. When the list opens, I'll message your phone with the dates and how to apply, and bring up the form on your computer.",
    },
    faq: [
      ["Can it watch a page I sign in to?", "Yes. It uses your own browser on your computer, where you're already signed in."],
      ["What can I watch?", "Exam results, council notices, a blog, a team roster, a government form, a product recall list. Anything with a link."],
    ],
    byHand: [
      "Add the [Distill](https://distill.io) extension, open the page and select the part to follow.",
      "Or paste the link into [Visualping](https://visualping.io) and pick how often it looks.",
    ],
    related: ["watches/restock-alert", "watches/rental-listing-alerts", "watches/company-job-alerts"],
    costNote:
      "Yes. Free covers watching from your computer. With a paid Stella plan, from $20 a month, public pages are watched from the cloud too.",
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "company-job-alerts",
    niche: "watches",
    searchPhrases: [
      "job alerts for specific companies",
      "create job alerts for specific companies",
      "job alerts not working",
      "new job posting alert",
      "job openings tracker",
    ],
    title: "Job alerts for specific companies, straight from their sites",
    description:
      "Stella (stella.sh) watches the careers pages of the companies you'd work for, reads each new posting and tells you the same day about the ones that fit.",
    h1: "Job alerts for specific companies",
    short: "Job alerts for companies you pick",
    lede: "The right role, the day it's posted, from the company's own page.",
    answer:
      "Job boards post late and send noise. Stella (stella.sh) watches the careers pages of companies you choose, compares new roles with your résumé and sends you the fits.",
    gets: [
      "Your own list of companies, any size",
      "Why each role fits you, in two lines",
      "A résumé version tailored to it, ready to send",
    ],
    prompt:
      "Watch the careers pages of Figma, Canva, Duolingo and Spotify for remote marketing jobs. My résumé is in Documents. Tell me which ones are worth applying to.",
    demo: {
      ack: "Great. Your résumé first, then the four pages.",
      task: "Watching four careers pages",
      rows: ["Reading your résumé", "Listing the marketing roles open today", "Starting your openings sheet"],
      reply:
        "I'll look at all four **every morning at 8 and again at 2**. New remote marketing roles that suit your résumé reach your phone with the link. Everything open today is in your sheet, best first.",
      files: ["Job openings.xlsx"],
    },
    faq: [
      ["Can it help me apply?", "Yes. It can fill in the form and leave submit to you."],
      ["Why are my job alerts not working?", "Boards bundle emails daily and match loosely on titles. The company's own page skips both."],
    ],
    byHand: [
      "On LinkedIn, search the job title, filter by Company, then switch on Set alert and choose daily.",
      "On each company's careers page, join the talent community or email list.",
    ],
    related: ["watches/website-change-alert", "watches/rental-listing-alerts", "watches/get-notified-when-a-class-opens"],
    costNote:
      "Yes, with the looks done while your computer is on. On paid Stella plans, from $20 a month, they also run in the cloud.",
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "global-entry-appointment-alerts",
    niche: "watches",
    searchPhrases: [
      "global entry appointment alerts",
      "global entry appointment alerts free",
      "global entry interview alerts",
      "nexus interview appointments",
      "global entry appointments near me",
    ],
    title: "Global Entry appointment alerts for an earlier interview",
    description:
      "No interviews for months? Stella (stella.sh) watches the enrollment centers near you for canceled Global Entry slots and messages your phone at once.",
    h1: "Global Entry appointment alerts",
    short: "Global Entry interview slot alerts",
    lede: "An interview next week instead of next spring.",
    answer:
      "People cancel Global Entry interviews every day, and the slots go back online. Stella (stella.sh) watches the centers you can reach and messages you when an earlier one appears.",
    gets: [
      "Every enrollment center within your driving distance",
      "Only days and hours that work for you",
      "The booking page brought up for you to confirm",
    ],
    prompt:
      "I need a Global Entry interview before March. Watch every center within two hours of Phoenix, weekdays after 10am, and tell me when one opens.",
    demo: {
      ack: "Okay. Finding the centers you can reach.",
      task: "Watching for an interview slot",
      rows: ["Finding centers within two hours", "Reading each one's open times", "Fitting them to your weekdays"],
      reply:
        "I'm watching every center within your two hours, including Sky Harbor, **every 5 minutes**. When a weekday slot after 10am comes up before March, your phone gets the place and time, and the official scheduling page opens here.",
    },
    faq: [
      ["I already have an interview. Can I move it earlier?", "Yes. Keep yours while it watches, then reschedule on the official site when a better one shows."],
      ["Does it cover NEXUS, or the DMV?", "Yes. Name the program or office and the days you're free."],
    ],
    byHand: [
      "Sign in at [ttp.cbp.dhs.gov](https://ttp.cbp.dhs.gov), pick a center and look for earlier times, mornings especially.",
      "Coming home from abroad? Ask for Enrollment on Arrival at the airport, which needs no appointment.",
    ],
    related: ["watches/campsite-cancellation-alerts", "watches/hotel-price-drop-alert", "watches/website-change-alert"],
    costNote:
      "Yes. It watches while your computer is on. Paid Stella plans, from $20 a month, watch in the cloud too.",
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "campsite-cancellation-alerts",
    niche: "watches",
    searchPhrases: [
      "campsite cancellation alerts",
      "recreation.gov alerts",
      "campsite cancellations",
      "campsite availability alert",
      "yosemite campsite cancellations",
      "recreation.gov permit alert",
    ],
    title: "Campsite cancellation alerts for Recreation.gov and state parks",
    description:
      "Campground fully booked? Stella (stella.sh) watches Recreation.gov and state park sites for cancellations on your nights and messages your phone.",
    h1: "Campsite cancellation alerts",
    short: "Campsite cancellation alerts",
    lede: "Your weekend in a full campground, as soon as someone drops out.",
    answer:
      "Campers cancel all season. Stella (stella.sh) watches several campgrounds and weekends at once, finds sites that suit your tent or RV, and messages you when one frees up.",
    gets: [
      "National and state parks in the same watch",
      "Back-to-back nights found, even across two sites",
      "The reservation page brought up on the right site",
    ],
    prompt:
      "Watch Upper Pines, Lower Pines and North Pines in Yosemite for any two nights in a row in May. We have a 24-foot RV. Message my phone.",
    demo: {
      ack: "Lovely. Checking May in all three campgrounds.",
      task: "Watching Yosemite Valley campsites",
      rows: ["Opening the three Pines campgrounds", "Keeping sites that fit 24 feet", "Listing your two-night pairs"],
      reply:
        "I'm on it. I'll go through the Pines campgrounds **every 10 minutes** for two nights in a row in May. When a site long enough for your RV frees up, I'll message your phone with its number, and open its reservation page here.",
    },
    faq: [
      ["Does it work for permits and timed entry?", "Yes. Half Dome, The Wave, river permits and park entry slots can all be watched with your dates."],
    ],
    byHand: [
      "On [Recreation.gov](https://www.recreation.gov), choose your dates and press the bell for an availability alert, where the campground offers it.",
      "For state parks, use the Notify me button on the state's booking site.",
      "[Campnab](https://campnab.com) also scans parks across the US and Canada.",
    ],
    related: ["watches/global-entry-appointment-alerts", "watches/hotel-price-drop-alert", "watches/ticketmaster-ticket-alerts"],
    costNote:
      "Yes, scanning from your own computer. To keep scanning while it's shut, paid Stella plans from $20 a month use the cloud.",
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "resy-opentable-reservation-alerts",
    niche: "watches",
    searchPhrases: [
      "resy notify",
      "resy alerts",
      "opentable alerts",
      "resy notify not working",
      "opentable notify me",
      "hard to get reservations",
    ],
    title: "Resy Notify and OpenTable alerts, in one place",
    description:
      "Resy Notify always too late? Stella (stella.sh) watches Resy, OpenTable and Tock for your nights and times, and alerts you the moment a table frees up.",
    h1: "Resy Notify and OpenTable alerts in one place",
    short: "Resy and OpenTable reservation alerts",
    lede: "A Friday table at the place that's always full.",
    answer:
      "Resy Notify wants one tap per place and night. Stella (stella.sh) watches every restaurant on your list, on Resy, OpenTable and Tock together, and alerts you when a table fits.",
    gets: [
      "A whole list of restaurants and evenings in one go",
      "Only the hours you'd actually eat",
      "The booking page opened at that table, ready to confirm",
    ],
    prompt:
      "Get me a heads-up when a table for two opens at Don Angie, Lilia or Tatiana, any Friday or Saturday this month, between 6:30 and 9.",
    demo: {
      ack: "Yum. Seeing how each one takes reservations.",
      task: "Watching for a weekend table",
      rows: ["Finding each restaurant's booking page", "Noting when new dates go up", "Looking at your Fridays and Saturdays"],
      reply:
        "All three are on watch for two people, 6:30 to 9. I'll look **every 5 minutes**, and again the minute each one puts up new dates. When a table appears, your phone gets the place, night and time, and it opens here.",
    },
    faq: [
      ["Why is Resy Notify not working for me?", "Popular tables get tapped within seconds, and it covers only the dates you set. Allow push notifications and widen your times."],
      ["Can it tell me when reservations are released?", "Yes. It finds each restaurant's release day and hour and reminds you just before."],
    ],
    byHand: [
      "On Resy, pick the date and party size, press Notify and allow push notifications.",
      "In the OpenTable app, use Notify me on a full night.",
      "Phone at opening time on the day and ask about cancellations and bar seats.",
    ],
    related: ["watches/disney-dining-alerts", "watches/ticketmaster-ticket-alerts", "watches/flight-price-drop-alert"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "flight-price-drop-alert",
    niche: "watches",
    searchPhrases: [
      "flight price drop alert",
      "google flights alerts",
      "flight price alerts",
      "flight price alerts flexible dates",
      "flight price dropped after booking",
      "cheap flight alerts",
    ],
    title: "Flight price drop alert with flexible dates and airports",
    description:
      "Stella (stella.sh) checks Google Flights and the airlines across your flexible dates and nearby airports, then messages your phone when the fare drops.",
    h1: "Flight price drop alert, flexible dates included",
    short: "Flight price drop alerts",
    lede: "The trip you want, at the fare you said you'd pay.",
    answer:
      "Google Flights alerts follow one search apiece. Stella (stella.sh) checks all your possible dates and airports, adds the bag fees, and tells you when the true total drops.",
    gets: [
      "Loose dates, like any long weekend in spring",
      "Nearby airports and budget airlines included",
      "The fare opened on the airline's own site",
    ],
    prompt:
      "Two of us want a week in Lisbon any time in April, from JFK or Newark, one stop at most, with a checked bag. Tell me when it's under $600 each.",
    demo: {
      ack: "Nice trip. Pricing April from both airports.",
      task: "Tracking fares to Lisbon",
      rows: ["Pricing each week in April", "Adding a checked bag to each fare", "Starting a fare history sheet"],
      reply:
        "Every April week from JFK and Newark is being tracked, bag included. I'll reprice them **four times a day**. When one is **under $600 each**, I'll message your phone with the dates and airline, and open the fare here. Today's lowest are in your sheet.",
      files: ["Lisbon fares.xlsx"],
    },
    faq: [
      ["What if my flight price dropped after booking?", "Send your confirmation. Stella watches that same flight and, if your fare can be changed, works out the credit you'd get."],
      ["Can it watch for anywhere cheap?", "Yes. Give a budget, your airport and the weeks you're free, and it brings you destinations."],
    ],
    byHand: [
      "Search on [Google Flights](https://www.google.com/travel/flights) and switch on Track prices for your dates, or Any dates.",
      "Set a Skyscanner or Kayak alert too, with nearby airports ticked.",
      "Check Southwest and budget carriers on their own sites.",
    ],
    related: ["watches/hotel-price-drop-alert", "watches/price-drop-alert", "watches/global-entry-appointment-alerts"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "disney-dining-alerts",
    niche: "watches",
    searchPhrases: [
      "disney dining alerts",
      "disney dining alerts free",
      "disney dining reservation alerts",
      "disney dining reservations",
      "disney world dining alerts",
      "disney restaurant alerts",
    ],
    title: "Disney dining alerts for your park days and party size",
    description:
      "No tables left for your trip? Stella (stella.sh) watches Disney dining for your dates, meals and party size and messages you when a reservation opens.",
    h1: "Disney dining alerts for your whole trip",
    short: "Disney dining reservation alerts",
    lede: "Breakfast with the characters, on the day you're in that park.",
    answer:
      "Families change Disney plans constantly, so full tables come back. Stella (stella.sh) matches your park days to the meals you want and alerts you when a reservation opens.",
    gets: [
      "Every meal on your wish list, across the trip",
      "Your booking day put in your calendar",
      "One-page dining plan that fills in as you go",
    ],
    prompt:
      "We're at Disney World March 8 to 13, party of five. Watch for Cinderella's Royal Table, Be Our Guest and Space 220. My park plan is in Documents.",
    demo: {
      ack: "Fun! Matching meals to your park days.",
      task: "Watching Disney dining",
      rows: ["Reading which park you're in when", "Working out your booking day", "Writing the dining plan"],
      reply:
        "Your plan is made, with your booking morning on the calendar. From that day I'll look **every 10 minutes** for a table for five, in the right park on the right day. Your phone gets each opening, and Disney's page opens here.",
      files: ["Disney dining plan.pdf"],
    },
    faq: [
      ["When can I book Disney dining reservations?", "At Disney World, 60 days ahead from about 6am Eastern. Guests at a Disney hotel can book the whole stay that morning."],
      ["Does it do Disneyland too?", "Yes. Say which resort, and it goes by that one's calendar."],
    ],
    byHand: [
      "In the My Disney Experience app, press + and choose Check Dining Availability.",
      "Look again the day before and that morning, when families change plans.",
      "Ask for the walk-up list in the app when you're near the restaurant.",
    ],
    related: ["watches/resy-opentable-reservation-alerts", "watches/hotel-price-drop-alert", "watches/flight-price-drop-alert"],
    lastChecked: "2026-11-24",
  }),
];
