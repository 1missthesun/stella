import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const APPS_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "make-an-app-without-coding",
    niche: "apps",
    searchPhrases: [
      "how to make an app without coding",
      "make your own app without coding",
      "can i create my own app without coding",
      "make an app with ai for free",
      "build your own app no code",
    ],
    title: "How to make an app without coding (just describe it)",
    description:
      "Want your own app but can't code? Describe it to Stella (stella.sh) in plain words. It builds the app on your computer and changes it whenever you ask.",
    h1: "How to make an app without coding",
    short: "Make an app without coding",
    lede: "Say what the app should do. It gets built and opened for you.",
    answer:
      "You don't need to learn coding or a drag-and-drop builder. Describe the app in a sentence or two and Stella (stella.sh) writes it on your computer, opens it in your browser, and reworks it each time you ask for a change.",
    gets: [
      "A working app from a plain description",
      "Opens with a double-click, nothing to install",
      "Changes whenever you ask",
    ],
    prompt:
      "Make me a simple app to keep track of which friends I've lent books and games to, and when they're due back.",
    demo: {
      ack: "Nice idea. Building your lending app now.",
      task: "Building your lending app",
      rows: ["Planning a list, a form and filters", "Writing the app on your computer", "Highlighting anything overdue"],
      reply:
        "Done. **Lent Out** is in Documents/Apps; double-click to open it in your browser. Add a friend, the item and a due date. Anything late turns red.",
      files: ["Lent Out.html"],
    },
    faq: [
      ["Can I make an app with AI for free?", "Yes. Stella runs on the ChatGPT, Claude or Gemini plan you already have, and the app it writes is yours to keep."],
      ["Where does my app live?", "In a folder on your computer. It opens in your browser and remembers what you enter."],
    ],
    byHand: [
      "No-code builders like [Glide](https://www.glideapps.com) or [Softr](https://www.softr.io) turn a spreadsheet into an app with drag and drop.",
      "Or ask a chatbot for a one-page app and save it as an .html file.",
    ],
    related: ["apps/turn-a-spreadsheet-into-an-app", "apps/make-your-own-budget-app", "game-mods/make-a-minecraft-mod"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "turn-a-spreadsheet-into-an-app",
    niche: "apps",
    searchPhrases: [
      "turn spreadsheet into app",
      "turn excel into app free",
      "turn google sheet into app",
      "convert spreadsheet into web app",
    ],
    title: "Turn a spreadsheet into an app (Excel or Google Sheets)",
    description:
      "Has your Excel or Google Sheets file become a mess? Stella (stella.sh) turns it into a simple app with search, filters and a form for adding new rows.",
    h1: "Turn your spreadsheet into an app",
    short: "Turn a spreadsheet into an app",
    lede: "Your rows become an app with search, forms and buttons.",
    answer:
      "Give Stella (stella.sh) the spreadsheet and say how you use it. It builds an app around your rows, with a search box, filters and a tidy form for new entries, and saves everything back out to Excel whenever you want.",
    gets: [
      "Every row brought in, nothing retyped",
      "Search, filters and sorting in one click",
      "A form for adding entries without breaking anything",
      "Export back to Excel any time",
    ],
    prompt:
      "Turn my client list spreadsheet in Documents into an app where I can search clients, add new ones and see who I haven't called in a month.",
    demo: {
      ack: "Sure. Reading your client list first.",
      task: "Turning your client list into an app",
      rows: ["Reading 214 clients from the spreadsheet", "Building search and an add-client form", "Flagging anyone not called in 30 days"],
      reply:
        "Done. **Clients** is in Documents/Apps with all 214 clients. Search by name or town, add people with the form, and Call Soon lists the 19 you haven't rung in a month.",
      files: ["Clients.html"],
    },
    faq: [
      ["Can I turn a Google Sheet into an app?", "Yes. Download it as an Excel file, or let Stella open it in your browser, and the app is built from those rows."],
      ["Does my original spreadsheet change?", "No. It's read once to fill the app and left as it was. The Export button makes a fresh copy whenever you want one."],
    ],
    byHand: [
      "[Google AppSheet](https://about.appsheet.com) and [Glide](https://www.glideapps.com) build apps straight from a Google Sheet or Excel file, with free starter plans.",
    ],
    related: ["apps/make-an-app-without-coding", "apps/make-a-home-inventory-app", "pdf-excel/summarize-spreadsheet-by-category"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-your-own-workout-tracker",
    niche: "apps",
    searchPhrases: [
      "make my own workout app",
      "workout tracker app no subscription",
      "create my own workout app",
      "make my own fitness app",
    ],
    title: "Make your own workout tracker app, no subscription",
    description:
      "Tired of workout apps that want a subscription? Ask Stella (stella.sh) to make your own workout tracker with your routine, a rest timer and progress charts.",
    h1: "Make your own workout app",
    short: "Your own workout tracker",
    lede: "Log your sets, watch your lifts go up, pay no subscription.",
    answer:
      "Tell Stella (stella.sh) your routine and what you want to see. It makes a workout tracker on your computer with your exercises already in, a rest timer and charts of your best lifts, with no account to create.",
    gets: [
      "Your own split and exercises, ready to tick off",
      "Last session's weights shown next to each set",
      "A chart of every lift over time",
      "A rest timer that beeps",
    ],
    prompt:
      "Make me a workout tracker for my push pull legs routine. Show last week's weights next to each set and a chart of my bench press.",
    demo: {
      ack: "Love it. Setting up your push, pull and legs days.",
      task: "Making your workout tracker",
      rows: ["Adding push, pull and legs days", "Showing last session beside each set", "Drawing a chart for each lift"],
      reply:
        "Ready. **Lift Log** is in Documents/Apps. Pick today's day, tap in reps and weight, and last week's numbers sit beside each set. The Progress tab charts your bench press and every other lift.",
      files: ["Lift Log.html"],
    },
    faq: [
      ["Kilos or pounds?", "Either. Say which you use, or ask for a switch in the settings."],
      ["Can I bring in my history from Strong or Hevy?", "Yes. Export your workouts from the app as a file and Stella adds them, so your charts start with your real history."],
    ],
    byHand: [
      "Apps like [Hevy](https://www.hevyapp.com) and [Strong](https://www.strong.app) log sets for free; their fuller charts sit behind a paid tier.",
      "Or a spreadsheet of date, exercise, reps and weight, with a chart per lift.",
    ],
    related: ["apps/make-your-own-habit-tracker", "apps/make-a-meal-planner-with-shopping-list", "apps/make-an-app-without-coding"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-your-own-budget-app",
    niche: "apps",
    searchPhrases: [
      "make my own budgeting app",
      "create my own budget app",
      "budget app without linking bank account",
      "personal budget app free no bank login",
    ],
    title: "Make your own budgeting app (no bank login needed)",
    description:
      "Want a budget app that doesn't ask for your bank login? Stella (stella.sh) makes your own budgeting app, filled from the statements you download yourself.",
    h1: "Make your own budgeting app",
    short: "Your own budgeting app",
    lede: "Your categories, your limits, and no bank login handed over.",
    answer:
      "Stella (stella.sh) makes a budgeting app on your computer built around your own categories and monthly limits. Bring in the statements you download from your bank and it sorts each purchase, so no app ever gets your bank password.",
    gets: [
      "Your categories and monthly limits",
      "Bank statement files sorted into categories",
      "Bars showing what's left this month",
      "Nothing uploaded anywhere",
    ],
    prompt:
      "Make me a budget app with my own categories and limits. I'll drop my bank's CSV in each month and want to see what's left in each.",
    demo: {
      ack: "Good plan. Starting with your categories.",
      task: "Making your budget app",
      rows: ["Setting up groceries, eating out, bills, fun", "Learning how your bank's file is laid out", "Sorting October's 86 purchases"],
      reply:
        "Done. **Budget** is in Documents/Apps with October already in. Drag next month's statement onto it and each purchase lands in its category. Groceries is on track; eating out is already over.",
      files: ["Budget.html"],
    },
    faq: [
      ["Is it safe without linking my bank?", "That's the idea: you download statements yourself and the app reads them on your computer. No bank login, no account, nothing uploaded."],
      ["Can it handle a shared budget with my partner?", "Yes. Ask for a who-paid column and it shows each person's share for the month."],
    ],
    byHand: [
      "[Actual Budget](https://actualbudget.org) is a free, open budgeting app you can run yourself and import bank files into.",
      "Or keep a spreadsheet: paste each month's statement, add a category column and total it.",
    ],
    related: ["money-household/make-a-budget-from-bank-statement", "apps/turn-a-spreadsheet-into-an-app", "pdf-excel/split-bills-with-roommates"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-your-own-habit-tracker",
    niche: "apps",
    searchPhrases: [
      "make my own habit tracker",
      "habit tracker app free",
      "how to make a habit tracker",
      "habit tracker app no ads",
    ],
    title: "Make your own habit tracker app",
    description:
      "Want a habit tracker that fits how you live? Stella (stella.sh) makes one on your computer with your habits, daily ticks, streaks and a year-at-a-glance grid.",
    h1: "Make your own habit tracker",
    short: "Your own habit tracker",
    lede: "Tick off your habits each day and watch the streaks build.",
    answer:
      "List the habits you want to build and how often. Stella (stella.sh) makes a habit tracker with one tap per habit each day, streak counts, and a grid of the whole year that fills in as you go.",
    gets: [
      "Daily, weekly or three-times-a-week habits",
      "Streaks that survive rest days",
      "A year grid that fills in colour",
      "No ads, no sign-up",
    ],
    prompt:
      "Make me a habit tracker for reading, stretching, no phone after 10pm and gym three times a week, with streaks and a year view.",
    demo: {
      ack: "On it. Setting up your four habits.",
      task: "Making your habit tracker",
      rows: ["Adding four habits with their schedules", "Counting gym as three times a week", "Drawing a year grid for each"],
      reply:
        "Done. **Habits** is in Documents/Apps. Tap a habit to tick it for today. Gym counts as a win at three visits a week, so rest days never break the streak. The Year tab fills a square for every good day.",
      files: ["Habits.html"],
    },
    faq: [
      ["Can I add a habit later?", "Any time, with the add button or by asking. Old habits can be paused and keep their streaks."],
      ["Can I print it as a chart?", "Yes. Ask for a print view and you get a monthly sheet with your habits down the side and days across."],
    ],
    byHand: [
      "Free apps like [Loop Habit Tracker](https://loophabits.org) on Android do daily ticks and streaks.",
      "On paper: a grid with habits down the side and the month's days across the top.",
    ],
    related: ["apps/make-your-own-workout-tracker", "apps/make-a-reading-tracker", "apps/make-a-family-chore-chart-app"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-recipe-app",
    niche: "apps",
    searchPhrases: [
      "recipe organizer app no subscription",
      "make my own recipe app",
      "recipe keeper app free",
      "digital recipe box",
    ],
    title: "Make a recipe organizer app with no subscription",
    description:
      "Recipes scattered across screenshots, bookmarks and notes? Stella (stella.sh) gathers them into your own recipe organizer app with search, tags and a cook view.",
    h1: "Your own recipe organizer app, no subscription",
    short: "Your own recipe app",
    lede: "All your saved recipes in one searchable place you own.",
    answer:
      "Point Stella (stella.sh) at wherever your recipes are: links, screenshots, a notes file or old Word documents. It gathers them into a recipe organizer app with search, tags, servings you can change and a big-text cooking view.",
    gets: [
      "Recipes pulled from links, photos and notes",
      "Search by ingredient or tag",
      "Change the servings and amounts follow",
      "A big-text view for cooking",
    ],
    prompt:
      "Gather my recipes from my bookmarks folder, the screenshots in Pictures/Recipes and Mum's Word file into one recipe app I can search.",
    demo: {
      ack: "Yum. Collecting your recipes first.",
      task: "Building your recipe box",
      rows: ["Reading 31 bookmarked recipe pages", "Copying recipes out of 18 screenshots", "Adding Mum's 12 recipes", "Tagging by meal and main ingredient"],
      reply:
        "Done. **Recipe Box** is in Documents/Apps with 61 recipes. Search chicken or Mum to filter, change servings to rescale, and tap Cook for big text you can read from the stove.",
      files: ["Recipe Box.html"],
    },
    faq: [
      ["Can I add new recipes later?", "Yes. Send Stella a link or a photo and it adds the recipe with ingredients and steps, or type one in with the app's add form."],
      ["My recipes are in Paprika. Can they move over?", "Yes. Export them from Paprika and Stella brings them across with their photos and categories."],
    ],
    byHand: [
      "[Paprika](https://www.paprikaapp.com) and the free, self-hosted [Mealie](https://mealie.io) save recipes from links and organise them.",
      "For a small collection, a Google Doc with a contents page does the job.",
    ],
    related: ["documents/make-a-cookbook-from-your-recipes", "apps/make-a-meal-planner-with-shopping-list", "hobbies/scale-a-recipe"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-reading-tracker",
    niche: "apps",
    searchPhrases: [
      "reading tracker app free",
      "make my own reading tracker",
      "book tracker app without goodreads",
      "reading log app",
    ],
    title: "Make your own free reading tracker app",
    description:
      "Want to log your books without Goodreads? Stella (stella.sh) makes you a free reading tracker with covers, ratings, a to-read pile and a yearly goal.",
    h1: "A free reading tracker app of your own",
    short: "Your own reading tracker",
    lede: "Every book you've read, your ratings and this year's goal.",
    answer:
      "Stella (stella.sh) makes a reading tracker on your computer: books with covers, star ratings, notes, a to-read pile and a yearly goal. It brings in your Goodreads or StoryGraph history, so you start with every book you've logged.",
    gets: [
      "Your Goodreads or StoryGraph history brought over",
      "Covers, ratings and notes for every book",
      "A yearly goal that counts itself",
      "Stats on genres and favourite authors",
    ],
    prompt:
      "Make me a reading tracker with my Goodreads export, book covers, a to-read list and a goal of 30 books this year.",
    demo: {
      ack: "Great. Bringing your books in first.",
      task: "Making your reading tracker",
      rows: ["Reading 412 books from your Goodreads export", "Finding a cover for each book", "Setting your 30-book goal"],
      reply:
        "Done. **Bookshelf** is in Documents/Apps with all 412 books and their covers. You're on 23 of 30 for this year. Type a title to add a book, rate it when you finish, and it moves to Read.",
      files: ["Bookshelf.html"],
    },
    faq: [
      ["How do I get my data out of Goodreads?", "On Goodreads, open My Books, then Import and export, and choose Export Library. Give Stella that file."],
      ["Can it log audiobooks too?", "Yes. Ask for a format field with pages or listening time, and the yearly stats split them out."],
    ],
    byHand: [
      "[The StoryGraph](https://thestorygraph.com) is a free Goodreads alternative with reading stats and imports.",
      "A spreadsheet with title, author, date finished and rating covers the basics.",
    ],
    related: ["apps/make-your-own-habit-tracker", "study/export-kindle-highlights", "apps/make-a-home-inventory-app"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-trip-planner-app",
    niche: "apps",
    searchPhrases: [
      "trip planner app with map",
      "make my own trip planner",
      "travel itinerary app free",
      "day by day itinerary with map",
    ],
    title: "Make a trip planner app with a map for your holiday",
    description:
      "Planning a trip? Stella (stella.sh) makes your own trip planner app with each day's plan on a map, your bookings in one place and a packing list to tick off.",
    h1: "Your own trip planner app with a map",
    short: "Your own trip planner",
    lede: "Your whole trip, day by day, on a map, in one place.",
    answer:
      "Tell Stella (stella.sh) where you're going and point it at your booking emails. It makes a trip planner app with a day-by-day plan, every stop pinned on a map, hotel and train details together, and a packing list.",
    gets: [
      "Each day's plan pinned on a map",
      "Bookings pulled from your confirmation emails",
      "Distances between each day's stops",
      "A packing list to tick off",
    ],
    prompt:
      "Make a trip planner for our 10 days in Japan: Tokyo, Kyoto and Osaka, with each day on a map, our hotel bookings and a packing list.",
    demo: {
      ack: "Exciting. Starting with your cities and dates.",
      task: "Making your Japan trip planner",
      rows: ["Laying out 10 days across three cities", "Pinning hotels and sights on a map", "Adding your three hotel bookings", "Writing a packing list"],
      reply:
        "Ready. **Japan Trip** is in Documents/Apps. Each day has its own map and plan, hotels sit under Bookings with check-in times, and the packing list ticks off. Want a rainy-day option for each city?",
      files: ["Japan Trip.html"],
    },
    faq: [
      ["Can my friends see the plan?", "Yes. Stella can save a copy they open in any browser, or put it online on a free host you sign in to, so everyone sees one plan."],
    ],
    byHand: [
      "[Wanderlog](https://wanderlog.com) lays out itineraries on a map and pulls in bookings from forwarded emails.",
      "Google My Maps lets you pin each day's places on its own layer.",
    ],
    related: ["apps/make-a-meal-planner-with-shopping-list", "apps/make-an-app-without-coding", "apps/make-a-family-chore-chart-app"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-meal-planner-with-shopping-list",
    niche: "apps",
    searchPhrases: [
      "meal planner app with shopping list",
      "meal planning app with grocery list free",
      "make my own meal planner",
      "weekly meal plan and shopping list",
    ],
    title: "Make a meal planner app with a shopping list",
    description:
      "Want to plan the week's meals and shop once? Stella (stella.sh) makes a meal planner app that builds the shopping list from your own recipes, sorted by aisle.",
    h1: "A meal planner app with a shopping list",
    short: "Meal planner with shopping list",
    lede: "Plan the week's dinners and the shopping list writes itself.",
    answer:
      "Stella (stella.sh) makes a meal planner app with your own recipes in it. Drag dinners onto the week and it adds the ingredients up into one shopping list, sorted by supermarket aisle, leaving out what you already have.",
    gets: [
      "Drag dinners onto a weekly calendar",
      "One combined shopping list, sorted by aisle",
      "Cupboard staples left off the list",
      "Allergy and picky-eater notes on each meal",
    ],
    prompt:
      "Make a meal planner for our family of four using my recipes doc, and build a shopping list by aisle for whatever I plan each week.",
    demo: {
      ack: "Sounds good. Reading your recipes doc.",
      task: "Making your family meal planner",
      rows: ["Loading 40 recipes from your doc", "Setting portions for four", "Grouping ingredients by aisle"],
      reply:
        "Done. **Dinners** is in Documents/Apps. Drag meals onto the week and the Shopping tab totals everything by aisle, skipping what's ticked in your cupboard. Print gives you a one-page list.",
      files: ["Dinners.html"],
    },
    faq: [
      ["Can it suggest meals for the week?", "Yes. Ask for a shuffle button that fills the week from your recipes without repeating last week's."],
    ],
    byHand: [
      "[Plan to Eat](https://www.plantoeat.com) and [Mealime](https://www.mealime.com) turn planned meals into grocery lists.",
      "Or keep a weekly sheet of dinners and copy each recipe's ingredients into one list.",
    ],
    related: ["apps/make-a-recipe-app", "hobbies/scale-a-recipe", "apps/make-a-home-inventory-app"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-family-chore-chart-app",
    niche: "apps",
    searchPhrases: [
      "chore chart app for family",
      "chore chart app for kids free",
      "make a chore chart",
      "chore chart with rewards",
    ],
    title: "Make a family chore chart app with points for the kids",
    description:
      "Tired of nagging about chores? Stella (stella.sh) makes a family chore chart app with jobs that rotate each week, points for the kids and rewards to earn.",
    h1: "A chore chart app for the family",
    short: "Family chore chart app",
    lede: "Who does what this week, with points the kids can cash in.",
    answer:
      "Tell Stella (stella.sh) who's in the family and which jobs need doing. It makes a chore chart app where jobs rotate fairly each week, kids tick them off for points, and points add up to rewards you choose.",
    gets: [
      "Jobs that rotate so nobody's stuck with the bins",
      "Points per job and rewards to save for",
      "Picture icons for kids who can't read yet",
      "A printable week for the fridge",
    ],
    prompt:
      "Make a chore chart for my three kids aged 5, 9 and 12, with jobs that rotate weekly and points they can save up for screen time.",
    demo: {
      ack: "Fun. Setting up a chart for three.",
      task: "Making your family chore chart",
      rows: ["Matching jobs to each child's age", "Rotating jobs every Monday", "Turning points into screen-time rewards"],
      reply:
        "Ready. **Chores** is in Documents/Apps. Each child taps their picture to see today's jobs and tick them off. 10 points buys 30 minutes of screen time, and jobs swap round every Monday. Print gives you the fridge version.",
      files: ["Chores.html"],
    },
    faq: [
      ["Can I approve chores before points count?", "Yes. Ask for a parent check: ticked jobs wait for your OK, which can sit behind a simple PIN."],
      ["Does it work for roommates?", "Yes. Swap the kids for housemates, drop the points and keep the fair rotation."],
    ],
    byHand: [
      "A spreadsheet grid: names across the top, jobs down the side, shifted one row each week.",
      "Print it and use stickers for points.",
    ],
    related: ["apps/make-your-own-habit-tracker", "apps/make-a-meal-planner-with-shopping-list", "pdf-excel/split-bills-with-roommates"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-plant-watering-tracker",
    niche: "apps",
    searchPhrases: [
      "plant watering tracker app",
      "houseplant watering tracker",
      "plant watering schedule app free",
      "app to remember to water plants",
    ],
    title: "Make a plant watering tracker app for your houseplants",
    description:
      "Always forgetting which plant needs water? Stella (stella.sh) makes a plant watering tracker with a schedule per plant, a photo of each and a today list.",
    h1: "A plant watering tracker app for your houseplants",
    short: "Plant watering tracker",
    lede: "Know which plants need water today, and stop guessing.",
    answer:
      "Show Stella (stella.sh) photos of your plants or list them. It makes a plant watering tracker with a sensible schedule for each one, a needs-water-today list, and room to note feeding, repotting and how each is doing.",
    gets: [
      "A watering schedule set for each plant",
      "A today list so nothing dries out",
      "Photos to see each plant grow",
      "Feeding and repotting notes",
    ],
    prompt:
      "Make a plant watering tracker for my 14 houseplants from the photos in Pictures/Plants, with how often each one needs water.",
    demo: {
      ack: "Lovely. Looking at your plant photos.",
      task: "Making your plant watering tracker",
      rows: ["Naming 14 plants from your photos", "Setting how often each needs water", "Building a water-today list"],
      reply:
        "Done. **Plants** is in Documents/Apps with all 14, each with its photo. Today's list shows the fern and both calatheas. Tap Watered and the next date moves on; the succulents won't show up for two weeks.",
      files: ["Plants.html"],
    },
    faq: [
      ["Can it change the schedule in winter?", "Yes. Ask for a season switch and the gaps between waterings stretch in the colder months."],
    ],
    byHand: [
      "[Planta](https://getplanta.com) and [Greg](https://greg.app) are plant care apps with watering reminders.",
      "A repeating calendar event per plant works too.",
    ],
    related: ["apps/make-your-own-habit-tracker", "apps/make-a-home-inventory-app", "apps/make-an-app-without-coding"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-home-inventory-app",
    niche: "apps",
    searchPhrases: [
      "home inventory app free",
      "pantry inventory app",
      "collection tracker app",
      "closet inventory app",
    ],
    title: "Make a home inventory app: pantry, closet or collection",
    description:
      "Want a list of what you own? Stella (stella.sh) makes a free home inventory app for your pantry, closet, collection or insurance list, with photos and search.",
    h1: "A free home inventory app for your things",
    short: "Home inventory app",
    lede: "Everything you own, where it is, and what it's worth.",
    answer:
      "Say what you're keeping track of: the pantry, your closet, a Lego or card collection, or everything for insurance. Stella (stella.sh) makes a home inventory app with photos, rooms or shelves, values and search, filled from your photos or a list.",
    gets: [
      "Items filled in from your photos or a list",
      "Where each thing is, by room or shelf",
      "Values added up for insurance",
      "Pantry use-by dates flagged",
    ],
    prompt:
      "Make an app for my Lego collection from my spreadsheet of set numbers, with pictures, which sets are complete, and a wishlist.",
    demo: {
      ack: "Great collection. Reading your set list.",
      task: "Making your Lego collection app",
      rows: ["Reading 87 sets from your spreadsheet", "Adding a picture for each set", "Splitting owned, incomplete and wishlist"],
      reply:
        "Done. **Lego** is in Documents/Apps with all 87 sets and their pictures. Filter by theme or year, mark missing pieces, and the Wishlist tab holds the 12 you're after. Type a set number to add one.",
      files: ["Lego.html"],
    },
    faq: [
      ["Can I use it for a home insurance list?", "Yes. Photograph each room, put the photos in a folder, and Stella lists every item by room with a value column and a printable total."],
      ["Can it keep track of the pantry?", "Yes. Ask for quantities and use-by dates, and it shows what's running low or about to go off."],
    ],
    byHand: [
      "[Sortly](https://www.sortly.com) and the free, self-hosted [Homebox](https://homebox.software) keep inventories with photos.",
      "For Lego, [Brickset](https://brickset.com) keeps lists of owned and wanted sets.",
    ],
    related: ["apps/turn-a-spreadsheet-into-an-app", "apps/make-a-recipe-app", "apps/make-a-plant-watering-tracker"],
    lastChecked: "2026-11-24",
  }),
];
