import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const PUBLISHING_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "make-a-childrens-book",
    niche: "publishing",
    searchPhrases: [
      "how to make a children's book",
      "make a children's book with ai",
      "how to make a children's book and sell on amazon",
      "creating illustrations for a children's book with ai",
    ],
    title: "Make a children's book from your story, illustrated",
    description:
      "Got a bedtime story in your head? Ask Stella (stella.sh) to turn it into a finished, illustrated children's book you can print at home or sell on Amazon.",
    h1: "Make a children's book from your story",
    short: "Make a children's book",
    lede: "Your story, split into spreads, illustrated and ready to print.",
    answer:
      "Tell Stella (stella.sh) the story, or paste what you wrote. It splits the text into page spreads, draws matching pictures with the same characters on every page, and lays out a book file ready to print or sell.",
    gets: [
      "Your words, paced one moment per page",
      "Characters that look the same on every page",
      "A print file in a picture book size",
      "A cover with title and author name",
    ],
    prompt:
      "Make a 24 page picture book from my story about Milo the hedgehog who's scared of the dark. Soft watercolour style, for ages 3 to 5.",
    demo: {
      ack: "Lovely story. Planning the pages first.",
      task: "Making Milo's picture book",
      rows: ["Splitting the story into 12 spreads", "Drawing Milo and his forest", "Laying out text and pictures", "Designing the cover"],
      reply:
        "Your book is ready in Documents/Milo Book: 24 pages at 8.5 x 8.5 inches with soft watercolour pictures, plus a cover. Tell me any page to redraw or reword.",
      files: ["milo-interior.pdf", "milo-cover.pdf", "pictures/"],
    },
    faq: [
      ["Can I sell my children's book on Amazon?", "Yes. Ask for an Amazon KDP version and you get the interior and cover sized for their paperback, ready to upload."],
      ["Can I use my own drawings instead?", "Yes. Scan or photograph them and the book is built around your art."],
    ],
    byHand: [
      "Write the story in about 500 words and split it into 12 spreads.",
      "Draw or commission the pictures, keeping the characters consistent.",
      "Lay out pages in Canva at 8.5 x 8.5 inches and export a print PDF.",
    ],
    related: ["publishing/make-a-kdp-book-cover", "publishing/format-a-book-for-kdp", "publishing/turn-kids-artwork-into-a-book"],
    costNote:
      "Yes for laying out your story with your own drawings. New AI illustrations come with Stella plans from $20 a month.",
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "turn-kids-artwork-into-a-book",
    niche: "publishing",
    searchPhrases: [
      "turn kids artwork into a book",
      "turn kids drawings into a book",
      "make children's artwork into a book",
    ],
    title: "Turn your kids' artwork into a book",
    description:
      "Fridge full of drawings? Ask Stella (stella.sh) to turn photos of your kids' artwork into a tidy hardcover-ready book, each piece labelled with name and age.",
    h1: "Turn your kids' artwork into a book",
    short: "Kids' artwork into a book",
    lede: "Years of drawings, straightened, labelled and bound into one book.",
    answer:
      "Photograph the drawings on the floor, one by one. Stella (stella.sh) straightens and crops each photo, brightens the paper to white, adds the child's name and age, and lays them out as a printable book.",
    gets: [
      "Wonky phone photos straightened and cropped",
      "Paper colour evened out, crayon kept true",
      "Name, age and title under each piece",
      "A print file for home or a book printer",
    ],
    prompt:
      "Turn the photos of Ava's drawings in Pictures/Ava Art into a book, one per page, with her age when she drew each one.",
    demo: {
      ack: "What a collection. Cleaning up the photos first.",
      task: "Making Ava's art book",
      rows: ["Straightening 64 drawing photos", "Whitening the paper backgrounds", "Reading dates to work out her age", "Laying out one piece per page"],
      reply:
        "Ava's art book is ready: 64 pages, oldest drawings first, each labelled \"Ava, age 4\" and so on. It's sized for Blurb's 8 x 10 hardcover. Saved in Pictures/Ava Art.",
      files: ["ava-art-book.pdf", "ava-art-cover.pdf"],
    },
    faq: [
      ["What do I do with the originals afterwards?", "Keep a few favourites. The book holds the rest, and the cleaned photos are saved in a folder too."],
      ["Can it add what my child said about each drawing?", "Yes. Type their words in a list or say them in the chat and they go under the matching picture."],
    ],
    byHand: [
      "Photograph each piece flat, in daylight, from straight above.",
      "Crop and brighten in your phone's photo editor.",
      "Upload to a book service like Artkive, Blurb or Shutterfly and place them by hand.",
    ],
    related: ["publishing/make-a-photo-book", "publishing/make-a-memory-book", "photos-files/make-a-contact-sheet"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-photo-book",
    niche: "publishing",
    searchPhrases: [
      "how to make a photo book",
      "photo book from vacation photos",
      "how to make a photo book at home",
      "photo book pdf print",
    ],
    title: "Make a photo book from your photos",
    description:
      "Thousands of trip photos and no book? Ask Stella (stella.sh) to pick the best shots, lay out the pages with captions and make a photo book ready to print.",
    h1: "Make a photo book from your photos",
    short: "Make a photo book",
    lede: "Your best shots picked, arranged by day and ready for the printer.",
    answer:
      "Point Stella (stella.sh) at the folder. It skips blurry shots and near-duplicates, groups the rest by day and place, lays out varied pages with short captions, and saves a book file a printer like Blurb or Lulu accepts.",
    gets: [
      "Blurry shots and repeats left out",
      "Pages grouped by day and place",
      "Captions from dates and where photos were taken",
      "Sized for the printer you choose",
    ],
    prompt:
      "Make a photo book of our Japan trip from Pictures/Japan 2026. About 40 pages, best photos only, captions with the city and day.",
    demo: {
      ack: "Great trip. Picking the best photos first.",
      task: "Making your Japan photo book",
      rows: ["Picking 140 of 1,812 photos", "Grouping by city and day", "Laying out 40 pages", "Writing short captions"],
      reply:
        "Your Japan book is ready: 40 pages, Tokyo to Kyoto to Osaka, with a full-page photo opening each city. The print file and cover are in Pictures/Japan 2026/Book.",
      files: ["japan-2026-book.pdf", "japan-2026-cover.pdf", "chosen-photos/"],
    },
    faq: [
      ["Which photo book printers take my own file?", "Blurb, Lulu and many local print shops take a finished PDF. Tell Stella which one and the pages are sized for it."],
      ["Can I swap photos afterwards?", "Yes. Say which page and which photo and the book is updated."],
    ],
    byHand: [
      "Sort your favourites into one folder, about three per page.",
      "Use Blurb's BookWright or Shutterfly's builder to place them.",
      "Check every page at full size before ordering.",
    ],
    related: ["publishing/make-a-memory-book", "publishing/turn-kids-artwork-into-a-book", "photos-files/make-a-contact-sheet"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-memory-book",
    niche: "publishing",
    searchPhrases: [
      "how to make a memory book",
      "how to make a memory book for dementia",
      "how to make a memory book for best friend",
      "how to make a yearbook",
    ],
    title: "Make a memory book with photos and stories",
    description:
      "Want a book of someone's life, a friendship or a school year? Ask Stella (stella.sh) to make a memory book from your photos and notes, ready to print.",
    h1: "Make a memory book with photos and stories",
    short: "Make a memory book",
    lede: "Photos, names and little stories, gathered into one book to keep.",
    answer:
      "Give Stella (stella.sh) the photos and whatever notes you have. It puts them in order, writes clear captions with names, places and years, and lays out a warm, easy-to-read book you can print.",
    gets: [
      "A chapter for each part of life or year",
      "Large, clear captions with names and places",
      "Your notes turned into short stories",
      "A class yearbook layout with a page per person",
    ],
    prompt:
      "Make a memory book for my grandma from the photos in Pictures/Nana and my notes. Big captions with names, she has dementia.",
    demo: {
      ack: "That's a kind thing to make. Reading your notes now.",
      task: "Making Nana's memory book",
      rows: ["Putting photos in order by decade", "Matching your notes to each photo", "Writing large, simple captions", "Laying out one photo per page"],
      reply:
        "Nana's memory book is ready: 30 pages from her childhood in Cork to the grandchildren, one photo per page with a short caption in large type. Saved in Pictures/Nana.",
      files: ["nana-memory-book.pdf"],
    },
    faq: [
      ["How do I make a memory book for someone with dementia?", "Keep one photo per page, large captions that say who and where, and a calm order through their life. Stella sets it up that way when you mention dementia."],
      ["Can it make a yearbook for a class or club?", "Yes. Give it the photos and a list of names and it makes a page per person plus group pages."],
    ],
    byHand: [
      "Gather 30 to 50 photos and jot who, where and when for each.",
      "Use a photo book template in Canva or Google Slides.",
      "Print in a large font and bind at a copy shop.",
    ],
    related: ["publishing/make-a-photo-book", "publishing/turn-kids-artwork-into-a-book", "hobbies/make-a-family-tree-chart-from-gedcom"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "turn-a-story-into-a-comic",
    niche: "publishing",
    searchPhrases: [
      "turn my story into a comic book",
      "how to make a comic book with ai",
      "how to make a webtoon",
      "how to turn a story into a comic",
    ],
    title: "Turn your story into a comic book or webtoon",
    description:
      "Have a story but can't draw? Ask Stella (stella.sh) to turn it into a comic: panels, speech bubbles and the same characters throughout, as pages or a webtoon.",
    h1: "Turn your story into a comic book",
    short: "Turn a story into a comic",
    lede: "Your script drawn as panels, with speech bubbles and steady characters.",
    answer:
      "Paste your story into Stella (stella.sh). It breaks it into scenes and panels, draws the characters the same way every time, adds speech bubbles, and saves comic pages or a tall scrolling webtoon strip.",
    gets: [
      "Your story split into pages and panels",
      "Characters designed once and kept consistent",
      "Speech bubbles with your dialogue",
      "Print pages or a scrolling webtoon version",
    ],
    prompt:
      "Turn my short story in Documents/the-heist.docx into a 12 page comic, gritty noir style, and a webtoon version too.",
    demo: {
      ack: "Fun story. Designing the characters first.",
      task: "Drawing The Heist as a comic",
      rows: ["Splitting the story into 48 panels", "Designing Vera and Sal", "Drawing the panels", "Lettering the speech bubbles"],
      reply:
        "The Heist is ready: 12 comic pages in black, grey and red, plus a webtoon strip 800 pixels wide in episode files. Both are in Documents/The Heist Comic.",
      files: ["the-heist-comic.pdf", "webtoon/episode-1.png", "characters.png"],
    },
    faq: [
      ["How do I make a webtoon?", "A webtoon is one tall strip read by scrolling, 800 pixels wide, cut into images. Stella arranges your panels that way, ready for Webtoon Canvas."],
      ["Can I use my own sketches?", "Yes. Your sketches can guide every panel, or be cleaned up and lettered as they are."],
    ],
    byHand: [
      "Write a script that lists each panel and its dialogue.",
      "Draw in Clip Studio Paint, Procreate or ibisPaint.",
      "Letter speech bubbles and export pages or a tall strip.",
    ],
    related: ["publishing/make-a-childrens-book", "publishing/make-a-zine", "reading-writing/convert-cbr-to-pdf"],
    costNote:
      "Yes for lettering and laying out your own drawings. New AI-drawn panels come with Stella plans from $20 a month.",
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-coloring-book",
    niche: "publishing",
    searchPhrases: [
      "how to make a coloring book",
      "make a coloring book from photos",
      "coloring pages from photos",
      "how to make a coloring book to sell on amazon",
    ],
    title: "Make a coloring book from your photos or ideas",
    description:
      "Want a coloring book of your pets, your town or a theme to sell? Ask Stella (stella.sh) to make clean line-art pages and a print-ready coloring book.",
    h1: "Make a coloring book from your photos or ideas",
    short: "Make a coloring book",
    lede: "Clean black outlines on white, one picture per page, ready to color.",
    answer:
      "Give Stella (stella.sh) your photos or a theme. It turns each into bold black outlines on white, leaves the backs of pages blank so markers don't bleed through, and makes a book file for home printing or Amazon.",
    gets: [
      "Photos traced into clean outlines",
      "Thick lines for kids, fine detail for adults",
      "Blank backs so markers don't show through",
      "A file sized for home printing or Amazon",
    ],
    prompt:
      "Make a coloring book for my niece from the dog photos in Pictures/Biscuit. Thick outlines, 20 pages, her name on the cover.",
    demo: {
      ack: "Cute idea. Tracing the photos first.",
      task: "Making Biscuit's coloring book",
      rows: ["Turning each photo into bold outlines", "Leaving page backs blank", "Adding a cover with her name"],
      reply:
        "The coloring book is ready: 20 outline pages of Biscuit, each on its own sheet, plus a cover saying \"Lily's Biscuit Coloring Book\". Print it from Pictures/Biscuit.",
      files: ["biscuit-coloring-book.pdf"],
    },
    faq: [
      ["How do I make a coloring book to sell on Amazon?", "Pick a theme, make 30 to 50 pages and size them for a KDP paperback with a cover. Stella makes the interior and cover files."],
      ["Can I just make a single coloring page from a photo?", "Yes. Send one photo and you get one printable page."],
    ],
    byHand: [
      "Trace photos in a drawing app, or use a sketch filter and tidy it.",
      "Place one picture per right-hand page in Canva at 8.5 x 11 inches.",
      "Export as a print PDF.",
    ],
    related: ["publishing/format-a-book-for-kdp", "publishing/make-a-childrens-book", "study/make-a-word-search"],
    costNote:
      "Yes when the pages are traced from your own photos. Brand-new drawings from a theme come with Stella plans from $20 a month.",
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-printable-planner",
    niche: "publishing",
    searchPhrases: [
      "how to make a printable planner",
      "how to make printable planners to sell on etsy",
      "how to make a journal to sell on amazon",
      "printable planner pdf",
    ],
    title: "Make a printable planner or journal to print or sell",
    description:
      "Want your own planner, or one to sell on Etsy or Amazon? Ask Stella (stella.sh) to design the pages and make a printable planner PDF in the sizes you need.",
    h1: "Make a printable planner or journal",
    short: "Make a printable planner",
    lede: "Your own planner pages, dated and laid out, ready to print or sell.",
    answer:
      "Describe the planner you want. Stella (stella.sh) designs the pages, fills in real dates for the year, and makes printable files in Letter and A4, or a journal interior sized for Amazon paperbacks.",
    gets: [
      "Yearly, monthly, weekly and daily pages",
      "Real dates filled in for the year you pick",
      "Letter, A4 and A5 versions for buyers",
      "Tappable tabs for planner apps like GoodNotes",
    ],
    prompt:
      "Make a 2027 printable planner to sell on Etsy: monthly and weekly pages, a habit page, minimal sage green look, Letter and A4.",
    demo: {
      ack: "Nice niche. Designing the page styles first.",
      task: "Making your 2027 planner",
      rows: ["Designing the sage green pages", "Filling in every 2027 date", "Adding habit charts and notes", "Saving Letter and A4 versions"],
      reply:
        "Your 2027 planner is ready: 12 monthly and 52 weekly spreads with habit charts, in Letter and A4, plus three listing images for Etsy. All in Documents/Planner 2027.",
      files: ["planner-2027-letter.pdf", "planner-2027-a4.pdf", "etsy-images/"],
    },
    faq: [
      ["How do I make a journal to sell on Amazon?", "Choose a theme and page style, make 100 to 120 pages at 6 x 9 inches, and add a cover. Stella makes both files for KDP."],
      ["Can it make an undated planner?", "Yes. Blank date boxes let buyers start any month."],
    ],
    byHand: [
      "Sketch the page types you need on paper first.",
      "Build them in Canva or Google Slides, one page per type.",
      "Duplicate for every week and month, type the dates, export a PDF.",
    ],
    related: ["publishing/format-a-book-for-kdp", "publishing/make-recipe-cards", "printing-labels/print-business-cards-at-home"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "format-a-book-for-kdp",
    niche: "publishing",
    searchPhrases: [
      "how to format a book for kdp",
      "kdp paperback formatting",
      "kdp interior margins",
      "kdp interior template",
    ],
    title: "Format a book for KDP: paperback interior with bleed",
    description:
      "Self-publishing a paperback? Ask Stella (stella.sh) to format your book for KDP: trim size, margins, bleed, page numbers and chapter starts, as an upload-ready PDF.",
    h1: "Format a book for KDP paperback",
    short: "Format a book for KDP",
    lede: "Your manuscript as a print-ready paperback interior Amazon accepts.",
    answer:
      "Give Stella (stella.sh) your manuscript and pick a trim size. It sets KDP's margins for your page count, adds bleed if pictures touch the edge, styles chapters and page numbers, and saves a PDF ready to upload.",
    gets: [
      "Trim size of your choice, like 6 x 9 or 5 x 8",
      "Inside margins matched to your page count",
      "Bleed added when images run to the edge",
      "Chapter openings, page numbers and contents",
    ],
    prompt:
      "Format my novel in Documents/Saltwater.docx for a KDP paperback, 6 x 9, cream paper, chapters starting on the right.",
    demo: {
      ack: "Sure. Reading the manuscript first.",
      task: "Formatting Saltwater for KDP",
      rows: ["Setting 6 x 9 pages", "Setting margins for 312 pages", "Styling chapters and page numbers", "Saving the print PDF"],
      reply:
        "Saltwater is formatted: 312 pages at 6 x 9 with a 0.625 inch inside margin, chapters opening on the right and fonts embedded. Upload saltwater-interior.pdf to KDP.",
      files: ["saltwater-interior.pdf"],
    },
    faq: [
      ["What are KDP's interior margins?", "Inside margins grow with page count, from 0.375 inches for short books to 0.875 for very long ones. Outside margins need at least 0.25 inches, or 0.375 with bleed."],
      ["When do I need bleed?", "Only when a picture or colour runs to the page edge. The page gets 0.125 inches extra on the outside, top and bottom."],
    ],
    byHand: [
      "Download KDP's free Word template for your trim size.",
      "Paste your text in, style chapter headings and add page numbers.",
      "Export a PDF and check it in KDP's Print Previewer.",
    ],
    related: ["publishing/make-a-kdp-book-cover", "reading-writing/format-a-manuscript", "publishing/self-publish-a-poetry-book"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-kdp-book-cover",
    niche: "publishing",
    searchPhrases: [
      "how to make a kdp book cover",
      "kdp cover template",
      "kdp spine width calculator",
      "kdp cover size calculator",
    ],
    title: "Make a KDP book cover with the right spine width",
    description:
      "Need a paperback cover Amazon accepts? Ask Stella (stella.sh) to make a full KDP cover: front, spine and back, with the spine width worked out from your pages.",
    h1: "Make a KDP book cover with the right spine width",
    short: "Make a KDP book cover",
    lede: "Front, spine and back in one file, sized to your page count.",
    answer:
      "Tell Stella (stella.sh) your trim size, page count and paper. It works out KDP's spine width, builds the full wrap with bleed, places the title and blurb, keeps the barcode corner clear, and saves an upload-ready PDF.",
    gets: [
      "Spine width from your page count and paper",
      "Front, spine and back in one file with bleed",
      "Title, author and back blurb placed",
      "A matching flat front for the ebook",
    ],
    prompt:
      "Make a KDP paperback cover for Saltwater: 6 x 9, 312 pages, cream paper. Use my photo of the pier, blurb is in blurb.txt.",
    demo: {
      ack: "On it. Working out the spine first.",
      task: "Making the Saltwater cover",
      rows: ["Spine for 312 cream pages: 0.78 inches", "Laying the pier photo across the wrap", "Setting title, spine and blurb", "Clearing the barcode corner"],
      reply:
        "Your cover is ready: 13.03 by 9.25 inches with bleed, a 0.78 inch spine with the title, and the blurb on the back. Upload saltwater-cover.pdf; the ebook cover is beside it.",
      files: ["saltwater-cover.pdf", "saltwater-ebook-cover.jpg"],
    },
    faq: [
      ["How is KDP spine width calculated?", "Page count times paper thickness: 0.002252 inches per page for white paper, 0.0025 for cream. Spine text needs more than 79 pages."],
      ["Do I need my own picture?", "No. A clean type-led cover works well, or Stella can make new cover art."],
    ],
    byHand: [
      "Get the exact size from KDP's cover calculator and template tool.",
      "Design over the template in Canva, Affinity or Photoshop.",
      "Hide the template's guide layer and export a PDF.",
    ],
    related: ["publishing/format-a-book-for-kdp", "publishing/make-an-ebook", "design/design-a-t-shirt"],
    costNote:
      "Yes with your own photo, art or a type-only design. New AI cover art comes with Stella plans from $20 a month.",
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-an-ebook",
    niche: "publishing",
    searchPhrases: [
      "how to make an ebook",
      "how to make an ebook to sell",
      "how to self publish an ebook on amazon",
      "turn blog posts into a book",
    ],
    title: "Make an ebook to sell on Kindle and Apple Books",
    description:
      "Have notes, posts or a draft you want to sell as an ebook? Ask Stella (stella.sh) to shape it into a finished ebook with cover and contents for Kindle and Apple Books.",
    h1: "Make an ebook to sell",
    short: "Make an ebook",
    lede: "Your notes or posts shaped into a finished ebook people can buy.",
    answer:
      "Give Stella (stella.sh) what you have: a draft, notes or blog posts. It orders them into chapters, tidies the writing, adds a cover, contents and about-the-author page, and saves an EPUB for Kindle and Apple Books plus a PDF.",
    gets: [
      "Scattered writing ordered into chapters",
      "Cover, title page and clickable contents",
      "An EPUB both stores accept, plus a PDF",
      "Book description and keywords for the listing",
    ],
    prompt:
      "Turn my 30 sourdough blog posts into an ebook I can sell on Kindle and Apple Books, with a cover and contents.",
    demo: {
      ack: "Good material. Reading all 30 posts first.",
      task: "Making your sourdough ebook",
      rows: ["Grouping 30 posts into 8 chapters", "Smoothing repeats between posts", "Designing the cover", "Saving EPUB and PDF"],
      reply:
        "Your ebook \"Slow Bread\" is ready: 8 chapters, 41,000 words, cover and contents. Upload slow-bread.epub to Kindle and Apple Books; the store description is in listing.txt.",
      files: ["slow-bread.epub", "slow-bread.pdf", "cover.jpg", "listing.txt"],
    },
    faq: [
      ["How do I self-publish an ebook on Amazon?", "Sign up at KDP, add a new Kindle eBook, paste the description, and upload the EPUB and cover. Stella can open the form and fill it in for you."],
      ["Can I sell the same file on Apple Books?", "Yes. Apple Books takes the same EPUB."],
    ],
    byHand: [
      "Gather your writing into one document and order the chapters.",
      "Use Kindle Create, Reedsy Studio or Calibre to make the EPUB.",
      "Make a 1600 x 2560 pixel cover in Canva.",
    ],
    related: ["publishing/make-a-kdp-book-cover", "reading-writing/convert-word-to-epub", "audio/make-audiobook-with-chapters"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "self-publish-a-poetry-book",
    niche: "publishing",
    searchPhrases: [
      "how to self publish a poetry book",
      "poetry book formatting",
      "make a book of my poems",
      "how to self publish a poetry collection",
    ],
    title: "Self-publish a poetry book from your poems",
    description:
      "Poems scattered across notes and docs? Ask Stella (stella.sh) to gather them into a formatted poetry collection, ready as a paperback and an ebook.",
    h1: "Self-publish a poetry book",
    short: "Self-publish a poetry book",
    lede: "Your poems gathered, ordered and set as a real collection.",
    answer:
      "Point Stella (stella.sh) at your poems, wherever they are. It gathers them, suggests an order and sections, keeps every line break and stanza as you wrote them, and makes a paperback file and an ebook.",
    gets: [
      "Poems collected from notes, docs and emails",
      "Line breaks and indents kept exactly",
      "Stanzas never split awkwardly across pages",
      "Paperback interior, cover and ebook",
    ],
    prompt:
      "Make a poetry book from all my poems in Documents/Poems and my phone notes export. Group them by theme, 5 x 8 paperback and Kindle.",
    demo: {
      ack: "Happy to. Gathering your poems first.",
      task: "Making your poetry collection",
      rows: ["Collecting 74 poems from two places", "Grouping them into four sections", "Keeping stanzas whole on each page", "Saving paperback and ebook files"],
      reply:
        "Your collection \"Low Tide\" is ready: 74 poems in four sections, 96 pages at 5 x 8, with contents and an index of first lines. Paperback, cover and ebook are in Documents/Poems/Book.",
      files: ["low-tide-interior.pdf", "low-tide-cover.pdf", "low-tide.epub"],
    },
    faq: [
      ["How many poems do I need for a poetry book?", "Most collections hold 30 to 80 poems, usually 60 to 120 pages. A chapbook is shorter, around 20 to 30."],
      ["Will my line breaks survive in the ebook?", "Yes. Each line is set so it wraps with an indent on small screens instead of running into the next."],
    ],
    byHand: [
      "Copy every poem into one document and choose an order.",
      "Set a 5 x 8 page in Word with page breaks between poems.",
      "Export a PDF for KDP or IngramSpark and an EPUB with Kindle Create.",
    ],
    related: ["publishing/format-a-book-for-kdp", "publishing/make-a-zine", "reading-writing/format-a-manuscript"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-zine",
    niche: "publishing",
    searchPhrases: [
      "how to make a zine",
      "how to make a zine with one piece of paper",
      "how to make a zine pdf",
      "how to make a zine booklet",
    ],
    title: "Make a zine from your writing, photos or drawings",
    description:
      "Want to print your own zine? Ask Stella (stella.sh) to lay out your writing and pictures and make a print file you fold from one sheet or staple as a booklet.",
    h1: "Make a zine from your writing and pictures",
    short: "Make a zine",
    lede: "Your pages laid out and arranged so they fold into a zine.",
    answer:
      "Give Stella (stella.sh) your writing, photos or scans. It designs the pages with a cut-and-paste look, then arranges them on the sheet in the right order so they fold into a mini zine or staple into a booklet.",
    gets: [
      "Pages in a photocopied, collage look",
      "An 8-page mini zine from one sheet of paper",
      "A longer booklet in the right page order",
      "A folding guide on the last page",
    ],
    prompt:
      "Make an 8 page zine about my neighbourhood's best corner shops from my photos and notes in Documents/Zine. Print on one A4 sheet.",
    demo: {
      ack: "Love that. Sorting your photos and notes first.",
      task: "Making your corner shop zine",
      rows: ["Designing 8 collage-style pages", "Turning photos black and white", "Arranging pages for folding", "Adding the fold-and-cut guide"],
      reply:
        "Your zine is ready on one A4 sheet: 8 pages with the shops, prices and owners' quotes. Print it single-sided, fold and cut along the middle. File is in Documents/Zine.",
      files: ["corner-shops-zine-a4.pdf", "corner-shops-zine-pages.pdf"],
    },
    faq: [
      ["How do I make a zine with one piece of paper?", "Eight pages print on one side of a sheet, some upside down. Fold it in half three ways, cut the middle slit and fold it into a little book."],
      ["Can I make copies at a copy shop?", "Yes. The print file works on any copier, in black and white or colour."],
    ],
    byHand: [
      "Draw a 2 x 4 grid on a sheet and number the panels.",
      "Fill each panel with writing, collage or drawings.",
      "Photocopy, fold, cut the middle slit and fold into a booklet.",
    ],
    related: ["publishing/turn-a-story-into-a-comic", "publishing/self-publish-a-poetry-book", "printing-labels/print-poster-on-multiple-pages"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-recipe-cards",
    niche: "publishing",
    searchPhrases: [
      "printable recipe cards",
      "printable recipe cards 4x6",
      "recipe cards for bridal shower",
      "make recipe cards from my recipes",
    ],
    title: "Make printable recipe cards from your recipes",
    description:
      "Want your recipes on proper cards for a recipe box or a gift? Ask Stella (stella.sh) to make matching printable recipe cards, front and back, at 4x6 or 5x7.",
    h1: "Make printable recipe cards from your recipes",
    short: "Make printable recipe cards",
    lede: "Every recipe on a matching card, sized for your recipe box.",
    answer:
      "Send Stella (stella.sh) your recipes, typed, photographed or from links. It writes each onto a matching card, moves the method to the back when it runs long, and lines them up to print and cut on card stock.",
    gets: [
      "Recipes from photos, notes or website links",
      "Ingredients front, method back when it runs long",
      "4x6 or 5x7 cards lined up to print and cut",
      "Blank cards in the same style for guests",
    ],
    prompt:
      "Make 4x6 recipe cards for Mum's 25 recipes in Pictures/Recipe Photos, vintage floral style, to print on card stock as a gift.",
    demo: {
      ack: "Lovely gift. Reading Mum's handwriting first.",
      task: "Making Mum's recipe cards",
      rows: ["Reading 25 handwritten recipe photos", "Writing each onto a 4x6 card", "Moving long methods to the back", "Lining up cards for card stock"],
      reply:
        "All 25 cards are done in a vintage floral style, four to a Letter sheet with cut marks, backs lined up for double-sided printing. Saved in Documents/Recipe Cards.",
      files: ["mums-recipe-cards.pdf", "blank-recipe-card.pdf"],
    },
    faq: [
      ["Can I make recipe cards for a bridal shower?", "Yes. You get blank cards in the shower's colours with the couple's names, for guests to fill in and drop in a box."],
      ["Can I print them at home?", "Yes. Any printer that takes card stock works; choose double-sided for the backs."],
    ],
    byHand: [
      "Pick a free 4x6 template in Canva or Word.",
      "Type each recipe in, splitting long ones front and back.",
      "Print on card stock and cut along the marks.",
    ],
    related: ["documents/make-a-cookbook-from-your-recipes", "hobbies/scale-a-recipe", "publishing/make-a-printable-planner"],
    lastChecked: "2026-11-24",
  }),
];
