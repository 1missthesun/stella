import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const EBOOKS_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "ao3-to-kindle",
    niche: "ebooks",
    searchPhrases: [
      "ao3 to kindle",
      "how to download ao3 fics",
      "ao3 epub with cover",
      "download ao3 fics to kindle",
      "ao3 epub to kindle",
    ],
    title: "AO3 to Kindle: download a fic as an EPUB with a cover",
    description:
      "Want to read that 300k slow burn on your Kindle? Ask Stella (stella.sh) to download the AO3 fic as an EPUB, give it a real cover and get it onto your Kindle.",
    h1: "Get an AO3 fic onto your Kindle, with a cover",
    short: "AO3 to Kindle",
    lede: "Paste the link, read it in bed tonight like a proper book.",
    answer:
      "Paste the AO3 link and Stella (stella.sh) downloads the fic as an EPUB, adds a cover with the title and author, tidies the chapter list and sends it to your Kindle.",
    gets: [
      "The whole fic, every chapter in order",
      "A cover that shows in your library",
      "Author, fandom and series filled in",
      "Summary and author's notes kept",
    ],
    prompt:
      "Download this AO3 fic as an EPUB, give it a pretty dark green cover and put it on my Kindle: archiveofourown.org/works/...",
    demo: {
      ack: "Ooh, a long one. Fetching it now.",
      task: "Putting your fic on your Kindle",
      rows: ["Downloading 42 chapters from AO3", "Making a dark green cover", "Filling in author and fandom", "Sending it to your Kindle"],
      reply:
        "It's on its way to your Kindle: all **42 chapters**, with a dark green cover in gold lettering. I kept a copy in Documents/Fanfic too.",
      files: ["The Long Way Back.epub"],
    },
    faq: [
      ["What about fics that only AO3 members can see?", "Sign in to AO3 in your browser and Stella downloads it from there."],
      ["What happens when a new chapter is posted?", "Ask for an update. Stella fetches the new chapters into the same book and sends the fresh copy over."],
    ],
    byHand: [
      "On AO3, open the fic, click Download and choose EPUB.",
      "Add a cover in [Calibre](https://calibre-ebook.com): Edit metadata, then browse for a cover picture.",
      "Upload the file at [amazon.com/sendtokindle](https://www.amazon.com/sendtokindle).",
    ],
    related: ["ebooks/download-all-ao3-bookmarks", "ebooks/make-a-fanfic-cover", "ebooks/send-epub-to-kindle"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "download-all-ao3-bookmarks",
    niche: "ebooks",
    searchPhrases: [
      "download all ao3 bookmarks",
      "bulk download ao3 fics",
      "ao3 series downloader",
      "how to download all ao3 bookmarks at once",
      "ao3 fic backup",
    ],
    title: "Download all your AO3 bookmarks or a whole series at once",
    description:
      "Scared a favourite fic will vanish? Stella (stella.sh) saves all your AO3 bookmarks or a complete series as EPUBs in one go, sorted into folders by fandom.",
    h1: "Download all your AO3 bookmarks in one go",
    short: "Save AO3 bookmarks or a series",
    lede: "Every fic you love, saved on your computer before it disappears.",
    answer:
      "Stella (stella.sh) goes through your AO3 bookmarks, or any series page, and saves each fic as its own EPUB. They land in folders by fandom, with a list of everything that was saved.",
    gets: [
      "Hundreds of fics from one message",
      "Series numbered in reading order",
      "A searchable list with ships, tags and word counts",
      "Only the new ones fetched next time",
    ],
    prompt:
      "Save everything in my AO3 bookmarks as EPUBs, sorted by fandom, and put each series in its own folder in order.",
    demo: {
      ack: "Happy to. Starting with your bookmarks pages.",
      task: "Backing up your AO3 bookmarks",
      rows: ["Listing 318 bookmarked fics", "Saving them at AO3's pace", "Grouping 21 series", "Making the list"],
      reply:
        "**311 of 318** fics are in Documents/AO3, by fandom, with series numbered. The other seven were deleted by their authors, and they're marked on the list.",
      files: ["AO3/", "AO3 bookmarks.xlsx"],
    },
    faq: [
      ["Do private bookmarks count?", "Yes. Stella reads them in the browser where you're signed in to AO3."],
      ["Can it make one book out of a series?", "Yes. Ask for a single EPUB and each fic becomes a part, in order."],
      ["Can it save my Marked for Later list too?", "Yes, and your history, one author's works or a collection. Say which page."],
    ],
    byHand: [
      "Install [Calibre](https://calibre-ebook.com) and its free FanFicFare plugin.",
      "Use FanFicFare's Get Story URLs from Web Page with your bookmarks or series link.",
      "Repeat for each page of bookmarks, then download the list.",
    ],
    related: ["ebooks/ao3-to-kindle", "reading-writing/merge-epub-files", "ebooks/organize-calibre-library"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "send-epub-to-kindle",
    niche: "ebooks",
    searchPhrases: [
      "send epub to kindle",
      "send to kindle epub",
      "send to kindle not working",
      "send epub to kindle via email",
      "kindle email address",
    ],
    title: "Send EPUB books to your Kindle, and fix the ones it rejects",
    description:
      "EPUB won't arrive or Send to Kindle keeps failing? Ask Stella (stella.sh) to repair the files, send the whole folder to your Kindle and set up its email.",
    h1: "Send EPUB books to your Kindle",
    short: "Send EPUBs to Kindle",
    lede: "A folder of EPUBs on your computer, then on your Kindle.",
    answer:
      "Stella (stella.sh) sends your EPUBs to your Kindle library in one batch. Books Amazon turns away get repaired and sent again, and your Kindle email is set up for next time.",
    gets: [
      "Any number of books in one go",
      "Files that failed to send, repaired",
      "Your own email on Amazon's approved list",
      "Books that sync to the Kindle app as well",
    ],
    prompt:
      "Send the EPUBs in my Downloads to my Kindle. Two of them keep failing with an error, please sort those out.",
    demo: {
      ack: "Sure. Checking the two that fail.",
      task: "Sending books to your Kindle",
      rows: ["Finding nine EPUBs in Downloads", "Repairing the two broken files", "Sending all nine to Amazon"],
      reply:
        "All **nine books** are in your Kindle library. The two that failed had damaged chapter files, now fixed. Turn on Wi-Fi on your Kindle and they'll download.",
    },
    faq: [
      ["Where do I find my Kindle email address?", "On Amazon, under Manage Your Content and Devices, Preferences, Personal Document Settings. It ends in @kindle.com."],
      ["Does Kindle read EPUB now?", "Send to Kindle accepts EPUB and converts it on the way. Copying an EPUB over by cable needs AZW3, which Stella makes for you."],
      ["Do my highlights sync?", "Yes, books sent this way keep your place and highlights across your Kindle and the app."],
    ],
    byHand: [
      "Drag EPUBs up to 200 MB each onto [amazon.com/sendtokindle](https://www.amazon.com/sendtokindle).",
      "Or add your email under Approved Personal Document E-mail List and mail the file to your @kindle.com address.",
      "If it fails, convert EPUB to EPUB in [Calibre](https://calibre-ebook.com) and send the new copy.",
    ],
    related: ["ebooks/ao3-to-kindle", "reading-writing/convert-pdf-to-epub", "ebooks/organize-kindle-library"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "organize-calibre-library",
    niche: "ebooks",
    searchPhrases: [
      "how to organize calibre library",
      "how to use calibre",
      "calibre metadata",
      "calibre book covers",
      "ebook organizer",
    ],
    title: "Organize your Calibre library: covers, series and metadata",
    description:
      "Messy ebooks with missing covers and wrong authors? Ask Stella (stella.sh) to set up Calibre, add your books and fix every cover, series and title for you.",
    h1: "Organize your Calibre library, covers and all",
    short: "Set up and tidy Calibre",
    lede: "From a folder of messy files to a shelf that looks like a bookshop.",
    answer:
      "Stella (stella.sh) installs Calibre, brings in every ebook on your computer and tidies the lot: right titles and authors, proper covers, series in order and a few sensible tags.",
    gets: [
      "Real covers instead of grey placeholders",
      "Series numbered, novellas included",
      "One spelling per author",
      "Genre and trope tags you pick",
    ],
    prompt:
      "Set up Calibre with all the ebooks on my laptop. Fix the covers and authors, put series in order and tag the romantasy ones.",
    demo: {
      ack: "Lovely. Gathering your books first.",
      task: "Tidying your ebook library",
      rows: ["Adding 486 books to Calibre", "Finding 173 missing covers", "Numbering 58 series", "Tagging romantasy"],
      reply:
        "Your library is ready in **Calibre**: 486 books, every one with a cover and the right author. 58 series are in order and 94 books are tagged romantasy. Your original files haven't moved.",
    },
    faq: [
      ["I already have a messy Calibre library. Can it fix that one?", "Yes. It copies the library first, then cleans up the one you use."],
      ["Where does Calibre keep my books?", "In a folder called Calibre Library, unless you choose another. Stella can move it to an external drive or the cloud folder you use."],
    ],
    byHand: [
      "Install [Calibre](https://calibre-ebook.com/download) and drag your books in.",
      "Select them all, press Ctrl+D and download metadata and covers.",
      "Check each match, then fill in Series and Number by hand where it's blank.",
    ],
    related: ["ebooks/remove-duplicate-ebooks", "ebooks/how-to-put-books-on-kobo", "pdf-excel/convert-mobi-to-epub"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "how-to-put-books-on-kobo",
    niche: "ebooks",
    searchPhrases: [
      "how to put books on kobo",
      "epub to kobo",
      "kobo epub transfer",
      "kobo series not showing calibre",
      "kobo collections calibre",
    ],
    title: "How to put books on a Kobo: EPUBs, series and collections",
    description:
      "Plug in your Kobo and ask Stella (stella.sh) to put your EPUBs on it, with covers, series and collections showing up the way they should.",
    h1: "Put your own books on your Kobo",
    short: "Put books on a Kobo",
    lede: "Your EPUBs on the Kobo, with covers, series and collections.",
    answer:
      "Plug your Kobo in and tell Stella (stella.sh) which books you want. It turns them into Kobo's own kind of EPUB, copies them across and fills in series, covers and collections.",
    gets: [
      "Faster page turns and Kobo's reading stats",
      "Series grouped in the Series tab",
      "Collections made from your tags",
      "Sharp covers on the sleep screen",
    ],
    prompt:
      "Put every book in Documents/To Read on my Kobo Libra, with the series grouped and a collection called Autumn TBR.",
    demo: {
      ack: "Got it, your Kobo is plugged in. Getting the books ready.",
      task: "Loading your Kobo",
      rows: ["Preparing 34 EPUBs for Kobo", "Copying them across", "Grouping six series", "Making Autumn TBR"],
      reply:
        "**34 books** are on your Kobo Libra, six series grouped, all in a collection called Autumn TBR. Unplug it safely and it'll finish adding them.",
    },
    faq: [
      ["Can I add books to a Kobo without a cable?", "Newer models such as the Libra Colour and Sage connect to Google Drive or Dropbox. Stella can drop books in that folder for you."],
      ["Why does my Kobo hide the series on my own books?", "A plain EPUB copied over leaves the series blank. Stella writes it in for each book."],
    ],
    byHand: [
      "Connect the Kobo by USB and tap Connect on its screen.",
      "Open [Calibre](https://calibre-ebook.com), select books and click Send to device.",
      "For collections and series, set them in Calibre's Kobo driver options.",
    ],
    related: ["ebooks/organize-calibre-library", "pdf-excel/convert-mobi-to-epub", "ebooks/fanfiction-to-epub"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "fanfiction-to-epub",
    niche: "ebooks",
    searchPhrases: [
      "fanfiction to epub",
      "download fanfiction.net stories",
      "wattpad to kindle",
      "how to download wattpad stories to kindle",
      "fanfiction to kindle",
    ],
    title: "Fanfiction.net and Wattpad stories to EPUB",
    description:
      "No download button on FanFiction.net or Wattpad? Give Stella (stella.sh) the link and it makes an EPUB of the fanfiction for your Kindle, Kobo or phone.",
    h1: "Turn fanfiction from FFN or Wattpad into an EPUB",
    short: "FanFiction.net and Wattpad to EPUB",
    lede: "Sites with no download button, turned into books you can keep.",
    answer:
      "Send Stella (stella.sh) a FanFiction.net or Wattpad link. It opens the story in your browser, collects every part and builds one clean EPUB without the ads and comments.",
    gets: [
      "All chapters in one book",
      "No ads, comments or page numbers",
      "Wattpad's own cover kept, pictures included",
      "Several links at once",
    ],
    prompt:
      "Make EPUBs of these two fics for my e-reader, one from FanFiction.net and one from Wattpad. Here are the links.",
    demo: {
      ack: "On it. Opening both stories.",
      task: "Making EPUBs from two stories",
      rows: ["Collecting 67 chapters from FanFiction.net", "Collecting 31 parts from Wattpad", "Adding covers and contents"],
      reply:
        "Both are done: **67 chapters** from FanFiction.net and **31 parts** from Wattpad, in Documents/Fanfic. They open on Kindle, Kobo or your phone.",
      files: ["fanfiction-net-story.epub", "wattpad-story.epub"],
    },
    faq: [
      ["Will it work on an old story I only have a title for?", "Yes. Stella searches the site for it and shows you the matches before saving."],
      ["Can it check for updates?", "Yes. Ask it to look weekly, and new chapters are added to the same EPUB."],
      ["Does it work for other fic sites?", "Yes, Royal Road, SpaceBattles, Quotev and most big story sites. Just send the link."],
    ],
    byHand: [
      "Add the free FanFicFare plugin to [Calibre](https://calibre-ebook.com).",
      "Paste the Wattpad link into Download from URLs.",
      "For FanFiction.net, open the chapters in your browser first and turn on FanFicFare's browser cache option.",
    ],
    related: ["ebooks/ao3-to-kindle", "ebooks/make-a-fanfic-cover", "ebooks/send-epub-to-kindle"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-fanfic-cover",
    niche: "ebooks",
    searchPhrases: [
      "how to make a fanfic cover",
      "fanfic cover maker",
      "fanfiction cover maker",
      "add cover to epub",
      "fanfiction cover size",
    ],
    title: "Make a fanfic cover and add it to the EPUB",
    description:
      "Make fanfic covers that look like real paperbacks. Stella (stella.sh) designs one for each fic and puts it inside the EPUB, so your library shows it.",
    h1: "Make a fanfic cover that looks like a real book",
    short: "Make a fanfic cover",
    lede: "A matching set of covers for your favourite fics, right inside the files.",
    answer:
      "Describe the vibe and Stella (stella.sh) designs a cover with the title, author and art that fits, then puts it inside the EPUB. Do one fic, or a whole shelf in the same style.",
    gets: [
      "Covers sized for your e-reader's screen",
      "Title and author spelled as on the fic",
      "A matching look across a series",
      "Picture files for Goodreads or BookTok too",
    ],
    prompt:
      "Make covers for the 12 fics in Documents/Fanfic, dark academia style, old botanical drawings and serif titles. Add them to the EPUBs.",
    demo: {
      ack: "Fun one. Reading the titles and summaries.",
      task: "Designing 12 fic covers",
      rows: ["Picking vintage botanical art", "Setting titles and author names", "Adding covers to 12 EPUBs"],
      reply:
        "All **12 covers** are inside their EPUBs, each with a different botanical drawing on a dark background. Want any in another colour? Just name the fic.",
      files: ["Covers/", "cover-preview.png"],
    },
    faq: [
      ["What size should a fanfiction cover be?", "1600 x 2560 pixels suits Kindle and Kobo. Wattpad uses 512 x 800."],
      ["Can I use my own picture or fan art I commissioned?", "Yes. Drop the image in the chat and the lettering is designed around it."],
    ],
    byHand: [
      "Start from a Canva book cover template at 1600 x 2560.",
      "Find old artwork at the [Biodiversity Heritage Library](https://www.biodiversitylibrary.org) or Rawpixel's public domain collection.",
      "In Calibre, use Edit book, then Tools, Add cover.",
    ],
    costNote:
      "Yes for covers made from type, your own pictures and free artwork. New AI pictures come with Stella plans from $20 a month.",
    related: ["ebooks/ao3-to-kindle", "publishing/make-a-kdp-book-cover", "ebooks/fanfiction-to-epub"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "reading-wrapped",
    niche: "ebooks",
    searchPhrases: [
      "reading wrapped",
      "goodreads wrapped",
      "reading stats goodreads",
      "book wrapped like spotify",
      "my year in books",
    ],
    title: "Make your reading wrapped from Goodreads or StoryGraph",
    description:
      "Get a Spotify-style reading wrapped for your books. Stella (stella.sh) turns your Goodreads or StoryGraph export into charts and story slides to post.",
    h1: "Make your own reading wrapped",
    short: "Reading wrapped and stats",
    lede: "Your year in books, as charts and slides ready to post.",
    answer:
      "Give Stella (stella.sh) your Goodreads or StoryGraph export and it makes your wrapped: books and pages read, top authors, best month, longest read and your five-star favourites, as slides and charts.",
    gets: [
      "Upright slides for Instagram and TikTok",
      "Pages per month, ratings and genres charted",
      "This year next to last year",
      "Any month or season, whenever you like",
    ],
    prompt:
      "Make my 2026 reading wrapped from this Goodreads export. Pink and burgundy, 8 slides for my Instagram story, with my top five covers.",
    demo: {
      ack: "Yay, wrapped time. Reading your export.",
      task: "Making your 2026 reading wrapped",
      rows: ["Counting 87 books from 2026", "Finding genres and page counts", "Drawing the charts", "Designing eight slides"],
      reply:
        "Your wrapped is ready: **87 books, 31,204 pages**, best month July, most-read author Ali Hazelwood. Eight slides plus a page of charts are in Pictures/Wrapped 2026.",
      files: ["wrapped-1.png … wrapped-8.png", "reading-stats.html"],
    },
    faq: [
      ["How do I get my Goodreads export?", "On the Goodreads website: My Books, Import and export, Export Library. Stella can fetch it from your browser too."],
      ["Can it compare my ratings with everyone else's?", "Yes. The export has the average rating beside yours, so it can show your hottest takes."],
      ["Does StoryGraph's export include moods?", "Yes, moods and pace you logged are in there, so they get their own slide."],
    ],
    byHand: [
      "Export your library from Goodreads or StoryGraph.",
      "Open it in Google Sheets and filter Date Read to this year.",
      "Make charts, then place the numbers on a Canva story template.",
    ],
    related: ["ebooks/goodreads-to-storygraph", "apps/make-a-reading-tracker", "chats-data-exports/see-your-spotify-listening-history"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "goodreads-to-storygraph",
    niche: "ebooks",
    searchPhrases: [
      "goodreads to storygraph",
      "how to import goodreads to storygraph",
      "storygraph import from goodreads",
      "export goodreads library",
      "move goodreads to storygraph",
    ],
    title: "Move from Goodreads to StoryGraph with everything intact",
    description:
      "Leaving Goodreads? Ask Stella (stella.sh) to move your shelves, ratings, reviews and dates to StoryGraph, and track down the books that don't match.",
    h1: "Move from Goodreads to StoryGraph",
    short: "Goodreads to StoryGraph",
    lede: "Years of ratings, reviews and shelves, settled in their new home.",
    answer:
      "Stella (stella.sh) exports your Goodreads library, tidies it, uploads it to StoryGraph in your browser and then finds the stragglers the import couldn't match, so nothing gets left behind.",
    gets: [
      "Ratings, reviews and finish dates moved",
      "Your own shelves turned into tags",
      "DNFs marked as did not finish",
      "A saved copy of your Goodreads library",
    ],
    prompt:
      "Move my Goodreads account to StoryGraph. My dnf shelf should be did-not-finish, and please find any books that go missing.",
    demo: {
      ack: "Okay, starting with your Goodreads export.",
      task: "Moving you to StoryGraph",
      rows: ["Exporting 634 books from Goodreads", "Sorting your dnf shelf", "Importing into StoryGraph", "Adding 11 unmatched books"],
      reply:
        "You're moved: **634 books** are on StoryGraph with your ratings, 48 reviews and 29 DNFs. The eleven that didn't match were added one by one. Your Goodreads copy is in Documents.",
      files: ["goodreads-library.csv"],
    },
    faq: [
      ["Does my Goodreads account stay?", "Yes, as it is. The move makes a copy, so you can keep both or close it later."],
      ["Can I add half and quarter stars afterwards?", "Yes. Tell Stella which books deserve 4.5 or 4.75 and it updates them on StoryGraph."],
    ],
    byHand: [
      "On the Goodreads website open My Books, Import and export, then Export Library.",
      "On [StoryGraph](https://app.thestorygraph.com), open Manage Account and choose Import Goodreads Library.",
      "Wait for the email, then add the books listed as not found.",
    ],
    related: ["ebooks/reading-wrapped", "apps/make-a-reading-tracker", "ebooks/export-kindle-library-list"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "export-kindle-library-list",
    niche: "ebooks",
    searchPhrases: [
      "list of all my kindle books",
      "export kindle library list",
      "export kindle library to excel",
      "can i get a list of all my kindle books",
      "export kindle library to csv",
    ],
    title: "Get a list of all your Kindle books in a spreadsheet",
    description:
      "Own hundreds of Kindle books and no idea which? Stella (stella.sh) makes a spreadsheet of your whole library with authors, series, dates and read status.",
    h1: "Get a list of all your Kindle books",
    short: "List all your Kindle books",
    lede: "Everything you own on Kindle, on one sheet you can search and sort.",
    answer:
      "Stella (stella.sh) goes through your Kindle library on Amazon in your own browser and makes a spreadsheet of it all: title, author, series, date you got it and whether you've read it.",
    gets: [
      "Purchases, freebies and sent documents together",
      "Series gaps spotted, like a missing book two",
      "Unread books counted",
      "Opens in Excel or Google Sheets",
    ],
    prompt:
      "Make me a spreadsheet of every Kindle book I own, with the author, series and whether I've read it. I keep buying the same ones.",
    demo: {
      ack: "Let's see what's in there. Opening your library.",
      task: "Listing your Kindle library",
      rows: ["Reading 52 pages of your library", "Looking up series and numbers", "Building the spreadsheet"],
      reply:
        "You own **1,287 Kindle books**, 702 of them unread. The sheet sorts by author or series, and a second tab lists 19 series where you're missing a book.",
      files: ["My Kindle Library.xlsx"],
    },
    faq: [
      ["Can I add my Kindle list to Goodreads or StoryGraph?", "Yes. Ask for an import file and Stella formats the list for either one."],
      ["Does it include borrowed books?", "Yes, with a column that says whether a book is bought, borrowed or a document you sent."],
    ],
    byHand: [
      "On Amazon, open Manage Your Content and Devices to see 25 or so titles per page.",
      "For a data file, use Amazon's [Request My Data](https://www.amazon.com/hz/privacy-central/data-requests/preview.html) and choose Kindle.",
      "Open the lists it sends in Excel and join titles with dates.",
    ],
    related: ["ebooks/organize-kindle-library", "study/export-kindle-highlights", "ebooks/goodreads-to-storygraph"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "organize-kindle-library",
    niche: "ebooks",
    searchPhrases: [
      "organize kindle library",
      "kindle collections",
      "organize kindle library on computer",
      "kindle organize books by series",
      "kindle collections ideas",
    ],
    title: "Organize your Kindle library into collections",
    description:
      "Endless scroll of unread books? Stella (stella.sh) sorts your Kindle library into collections by genre, trope, series or mood, and they sync to your Kindle.",
    h1: "Organize your Kindle library into collections",
    short: "Organize a Kindle into collections",
    lede: "Hundreds of loose books become shelves you can actually browse.",
    answer:
      "Tell Stella (stella.sh) how you like to pick a book. It works out which shelf each title belongs on, makes the collections in your Amazon account and adds the books, ready on every Kindle you use.",
    gets: [
      "Shelves by genre, trope, spice or season",
      "Series together and in order",
      "Read books moved out of the way",
      "New books sorted whenever you ask",
    ],
    prompt:
      "Sort my Kindle into collections: romantasy, thrillers, cosy fantasy, book club and next up. Put finished books in a Read collection.",
    demo: {
      ack: "Nice shelves. Looking through your books.",
      task: "Sorting your Kindle library",
      rows: ["Looking up 412 titles", "Deciding a shelf for each", "Creating six collections", "Adding the books"],
      reply:
        "Your Kindle has **six collections** now: 98 romantasy, 74 thrillers, 41 cosy fantasy, 12 book club, 10 next up and 177 read. Sync it and they'll appear.",
    },
    faq: [
      ["Can one book sit in two collections?", "Yes. A cosy romantasy can be in both, and Stella does that if you ask."],
      ["Will fanfic I sent to my Kindle be sorted too?", "Yes. Anything that came through Send to Kindle can join a collection, so fics get a shelf by fandom."],
    ],
    byHand: [
      "On Amazon, open Manage Your Content and Devices, tick books and choose Add to Collections.",
      "On the Kindle, tap the three dots in Library to create a collection and pick books.",
      "In the Kindle desktop app, select several books and add them together.",
    ],
    related: ["ebooks/export-kindle-library-list", "ebooks/send-epub-to-kindle", "ebooks/remove-duplicate-ebooks"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "remove-duplicate-ebooks",
    niche: "ebooks",
    searchPhrases: [
      "remove duplicate books in calibre",
      "calibre find duplicates",
      "duplicate books on kindle",
      "how to delete duplicate books on kindle",
      "find duplicate ebooks",
    ],
    title: "Remove duplicate books in Calibre, on Kindle or in a folder",
    description:
      "Same book three times with different names? Stella (stella.sh) finds duplicate ebooks in Calibre, folders or your Kindle and keeps the best copy of each.",
    h1: "Remove duplicate books from Calibre and your Kindle",
    short: "Remove duplicate ebooks",
    lede: "One good copy of every book, whatever the files are called.",
    answer:
      "Stella (stella.sh) compares the books themselves, not just their names, so it spots the same novel as an EPUB, a MOBI and a misspelled download. It keeps the best copy and sets the rest aside.",
    gets: [
      "Repeats found across formats and spellings",
      "The copy with a cover and contents kept",
      "Special editions and translations left alone",
      "Extras moved to one folder to look over",
    ],
    prompt:
      "My Calibre has loads of the same books twice, some with slightly different titles. Keep the best one of each and move the others out.",
    demo: {
      ack: "Copying your library first, then comparing.",
      task: "Finding duplicate ebooks",
      rows: ["Comparing 1,140 books", "Matching titles, authors and text", "Keeping the cleanest copies", "Moving 163 extras aside"],
      reply:
        "Calibre is down from 1,140 to **977 books**, with nothing listed twice. The 163 extras are in Documents/Duplicate Books. I left four illustrated editions where they were.",
      files: ["Duplicate Books/", "what-was-moved.xlsx"],
    },
    faq: [
      ["Why does my Kindle show the same book twice?", "Usually it was sent twice, or sent and bought. Stella removes the spare from your Amazon library in your browser."],
      ["Can it keep EPUB and AZW3 together?", "Yes. Both formats can live under one Calibre entry instead of two."],
    ],
    byHand: [
      "In Calibre, add the Find Duplicates plugin from Preferences, Plugins.",
      "Run it on similar titles and authors, then merge the groups it shows.",
      "For Kindle, delete spare documents under Manage Your Content and Devices.",
    ],
    related: ["ebooks/organize-calibre-library", "ebooks/organize-kindle-library", "pc-cleanup/find-duplicate-files"],
    lastChecked: "2026-11-24",
  }),
];
