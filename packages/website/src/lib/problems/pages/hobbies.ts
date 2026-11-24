import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const HOBBIES_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "transpose-chords",
    niche: "hobbies",
    searchPhrases: ["transpose chords", "transpose chord chart", "transpose song", "transpose chords down", "chordpro transpose"],
    title: "Transpose chords for a whole folder of chord sheets",
    description:
      "Need your chord sheets in a lower or higher key? Ask Stella (stella.sh) to transpose a whole folder of songs and save new copies next to the originals.",
    h1: "Transpose the chords in your chord sheets",
    short: "Transpose chords",
    lede: "Your songs in a key that suits your voice, every chord moved for you.",
    answer:
      "To transpose chords, move every chord the same number of half steps up or down. Stella (stella.sh) does that for a whole folder of chord sheets and leaves the lyrics alone.",
    gets: [
      "Every song in the key you asked for",
      "Lyrics left exactly as they were",
      "New copies, with your originals kept",
    ],
    prompt:
      "Transpose all the songs in my Chord Sheets folder down two half steps so they're easier to sing. Keep the originals.",
    demo: {
      ack: "Sure. Taking every song down two half steps.",
      task: "Transposing your chord sheets",
      rows: [
        "Finding the songs in Chord Sheets",
        "Moving each chord down two half steps",
        "Saving new copies beside the old ones",
      ],
      reply:
        "Done. All 5 songs are two half steps lower, saved with “(-2)” in the name. Willow Street now starts in Ab instead of Bb.",
      files: ["Chord Sheets"],
    },
    faq: [
      ["How many half steps should I transpose to sing lower?", "Two is a good first try. If the high notes still strain, go to three or four."],
      ["Should it be A# or Bb?", "Same note. Keys with flats, like F, Bb and Eb, are normally written with flats."],
    ],
    byHand: [
      "The twelve notes in order: C C# D D# E F F# G G# A A# B.",
      "Move each chord by the same count, changing only the letter: down two, Em7 becomes Dm7, D/F# becomes C/E.",
      "Skip find and replace, which changes lyrics too: “A distant train” becomes “G distant train”.",
      "In ChordPro files, change each chord in square brackets the same way.",
    ],
    related: [
      "audio/change-key-of-song",
      "audio/make-karaoke-version-of-song",
      "audio/slow-down-song-without-changing-pitch",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "scale-a-recipe",
    niche: "hobbies",
    searchPhrases: ["recipe scaler", "scale a recipe", "double a recipe", "recipe converter", "recipe scaling calculator"],
    title: "Scale a recipe for more people, without the mistakes",
    description:
      "Cooking for a crowd? Ask Stella (stella.sh) to scale your recipes for any number of people, round to real kitchen measures and save the new versions.",
    h1: "Scale a recipe up or down for more people",
    short: "Scale a recipe",
    lede: "Any recipe resized for the number of people you're feeding.",
    answer:
      "To scale a recipe, divide the servings you need by the servings it makes, then multiply every ingredient by that. Stella (stella.sh) does it for all your recipes at once and rounds to measures you can use.",
    gets: [
      "Every ingredient resized to cups, spoons and whole eggs",
      "More cans, not bigger ones",
      "Pan and timing notes for the bigger batch",
    ],
    prompt:
      "I'm cooking for 15 people. Scale the three recipes in my Recipes folder to serve 15 and save the new versions.",
    demo: {
      ack: "Happy to. Scaling all three for 15.",
      task: "Scaling your recipes for 15",
      rows: [
        "Reading the lasagna, garlic bread and tiramisu",
        "Rounding to measures you'd use",
        "Saving copies marked “serves 15”",
      ],
      reply:
        "Done. All three now serve 15.\n- **Lasagna**: 5 cans instead of 2\n- **Garlic bread**: 4 baguettes, on two racks\n- **Tiramisu**: a deeper dish\nOven temperatures stay the same.",
      files: ["Lasagna (serves 15).docx", "Garlic bread (serves 15).txt", "Tiramisu (serves 15).md"],
    },
    faq: [
      ["Do you double the baking time when you double a recipe?", "No. Keep the temperature and start checking at the original time. A deeper dish takes a little longer."],
      ["How do I scale a recipe that uses eggs?", "Round to whole eggs, or beat an extra egg and use part of it."],
      ["Can it convert cups to grams too?", "Yes. Ask for weights and the amounts come back in grams and millilitres."],
    ],
    byHand: [
      "Divide the servings you need by what the recipe makes: 15 ÷ 6 = 2.5.",
      "Multiply each amount by that and round: 2.81 cups is about 2¾ cups.",
      "Keep oven temperature and can sizes the same; buy more cans instead.",
    ],
    related: [
      "documents/make-a-cookbook-from-your-recipes",
      "hobbies/transpose-chords",
      "hobbies/make-a-family-tree-chart-from-gedcom",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-family-tree-chart-from-gedcom",
    niche: "hobbies",
    searchPhrases: [
      "print family tree",
      "create family tree chart from gedcom",
      "gedcom viewer",
      "gedcom to pdf",
      "family tree chart from gedcom",
    ],
    title: "Make a printable family tree chart from a GEDCOM file",
    description:
      "Have a GEDCOM file from Ancestry or MyHeritage? Ask Stella (stella.sh) to turn it into a printable family tree chart PDF, with names, dates and every branch.",
    h1: "Print a family tree chart from your GEDCOM file",
    short: "Family tree chart from GEDCOM",
    lede: "Your family tree on a page you can print, from the file you already have.",
    answer:
      "To print a family tree from a GEDCOM file, open it in a free program like Gramps and save a chart as PDF. Or ask Stella (stella.sh), which reads the file and draws the chart for you.",
    gets: [
      "A one-page chart, parents above their children",
      "Birth and death years in every box",
      "Relatives with the same name kept apart",
    ],
    prompt:
      "Make a printable family tree from the GEDCOM file in my Documents, as a PDF I can print at home.",
    demo: {
      ack: "Sure. Drawing your family tree now.",
      task: "Drawing your family tree",
      rows: [
        "Reading Pell family tree.ged",
        "Linking parents, children and couples",
        "Fitting four generations on one page",
      ],
      reply:
        "Done. All 20 people fit on one landscape page, with a list of everyone on page two. The two John Harrows are told apart by birth year.",
      files: ["Pell family tree chart.pdf"],
    },
    faq: [
      ["What is a GEDCOM file?", "The file genealogy sites use to share a family tree, ending in .ged. Ancestry, MyHeritage and FamilySearch can all export one."],
      ["Can I print a family tree without a subscription?", "Yes. Export the GEDCOM once, then make the chart on your own computer for free."],
      ["How do I print a big tree?", "Split it into one page per branch, or make a poster a copy shop can print."],
    ],
    byHand: [
      "Export your tree as a .ged file, usually under Settings, Share or Export on your genealogy site.",
      "In the free [Gramps](https://github.com/gramps-project/gramps/releases), create a family tree and choose Family Trees, Import.",
      "Choose Reports, Graphical Reports, Descendant Tree, pick the oldest ancestor, save as PDF and print.",
    ],
    related: [
      "documents/make-a-cookbook-from-your-recipes",
      "photos-files/combine-photos-into-one-pdf",
      "photos-files/fix-wrong-date-on-photos",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
