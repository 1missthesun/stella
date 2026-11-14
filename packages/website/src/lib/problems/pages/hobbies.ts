import { PROOFS, webCuts } from "../media";
import type { ProblemPage } from "../types";

const MODEL = "Claude Code with Opus, on a Claude plan";

export const HOBBIES_PAGES: ProblemPage[] = [
  {
    slug: "transpose-chords",
    niche: "hobbies",
    searchPhrases: ["transpose chords", "transpose chord chart", "transpose song", "transpose chords down", "chordpro transpose"],
    title: "Transpose chords for a whole folder of chord sheets",
    description:
      "Move every chord in your chord sheets up or down by half steps, lyrics untouched and slash chords moved too: by hand, or Stella (stella.sh) for a whole folder.",
    h1: "Transpose the chords in your chord sheets",
    short: "Transpose chords",
    lede: "Five songs moved down two half steps, every chord changed and every lyric left alone.",
    answer:
      "Count each chord down (or up) the same number of half steps on the chromatic scale: C, C#/Db, D, D#/Eb, E, F, F#/Gb, G, G#/Ab, A, A#/Bb, B. Two half steps down turns G into F, D/F# into C/E and Em into Dm. Keep the chord type, move the bass note of slash chords too, and spell with flats in flat keys. Stella (stella.sh) rewrites a whole folder of chord sheets on your computer and saves new copies.",
    stellaSteps: [
      "Finds the five songs in `Documents/Chord Sheets`: four chord-over-lyrics text files and one ChordPro file with chords in square brackets",
      "Writes a small transposer that only touches chord lines and bracketed chords, so lyric lines starting “Am I”, “A distant” or “E is for” stay as written",
      "Moves every chord down two half steps, keeping sevenths, minors, sus chords and slash bass notes, and spells them with flats where the new key uses flats (Ab, Db, Eb)",
      "Updates the key labels in the song titles (Willow Street goes from Bb to Ab) and keeps each chord over the same syllable",
      "Saves each song as a new file with “(-2)” in the name, leaves the originals as they were and ignores the Saturday setlist, which isn't a song",
    ],
    prompt:
      "Transpose all the songs in the Chord Sheets folder in my Documents down two half steps so they're easier to sing. Save them as new files and keep the originals.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "Five transposed songs in under a minute and a half. Checked afterwards against an answer key written before the run: for each of the 5 songs, a new file whose chords are exactly the originals moved down 2 half steps, slash bass notes moved too, every lyric line unchanged, flat spellings in the flat keys, and the original sheets unchanged.",
      note: "The songs were written for this run, with lyric lines that look like chords on purpose. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/hobbies/transpose-chords/proof.mp4`,
        cuts: webCuts("hobbies/transpose-chords"),
        poster: `${PROOFS}/hobbies/transpose-chords/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 42.5,
        speed: 3,
        realDuration: 85,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Five chord sheets are in Documents/Chord Sheets." },
        { at: 2, text: "The prompt: move them all down two half steps, as new files." },
        { at: 10.8, text: "Stella replies each new version will sit next to its original." },
        { at: 16.7, text: "Transposing, sped up 3×." },
        { at: 28.5, text: "Done: G to F, D to C, A to G, E to D and Bb to Ab, lyrics untouched, setlist left alone." },
      ],
    },
    manualTitle: "Transpose them yourself",
    manualSteps: [
      {
        title: "Work out the new key",
        body: "Write out the twelve notes: C, C#/Db, D, D#/Eb, E, F, F#/Gb, G, G#/Ab, A, A#/Bb, B, then back to C. Count down from the song's key by the number of half steps you want. Two half steps down from G is F.",
      },
      {
        title: "Save a copy first",
        body: "Open the song in Notepad, TextEdit or your notes app and use Save As with a new name, such as the song title plus the new key, so the original stays as it was.",
      },
      {
        title: "Move each chord",
        body: "Change only the root letter (and accidental) of each chord, keeping the rest: Em7 becomes Dm7, Asus4 becomes Gsus4. For slash chords move both notes: D/F# becomes C/E. Keep each chord above the same word.",
      },
      {
        title: "Don't use find and replace",
        body: "Replacing every A with G also changes lyrics like “A distant train”, and changing chords one at a time with replace can move a chord twice. Go line by line, or use a transposer that only reads chord lines.",
      },
      {
        title: "ChordPro files",
        body: "Chords sit in square brackets, such as `[G]`. Change each one, or open the file in a ChordPro app and use its transpose setting before saving under a new name.",
      },
    ],
    limits: [
      "Stella changes the written chords. To change the key of a recording, see [change the key of a song](/how/audio/change-key-of-song).",
      "Chord sheets in PDF or image form need the text read out first, which is less reliable than plain text files.",
      "The songs' text, lyrics included, goes to the AI model you use in Stella while it reads them. The new files are written on your computer.",
      "Recorded on Linux, using Python (built in on Mac and Linux). On Windows Stella may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How many half steps should I transpose to sing lower?",
        a: "Two half steps (a whole step) is a common first try. If the high notes are still a strain, go to three or four; to keep easy guitar shapes, use a capo instead.",
      },
      {
        q: "Should it be A# or Bb?",
        a: "Both are the same note. Keys with flats in their signature (F, Bb, Eb, Ab, Db) are normally written with flats, which is what Stella used.",
      },
      {
        q: "Can I transpose up instead, or for a capo?",
        a: "Yes. Ask for up a number of half steps, or for shapes to play with a capo on a given fret, and Stella writes those versions.",
      },
      {
        q: "Can I get a practice track in the new key?",
        a: "Yes: see [change the key of a song](/how/audio/change-key-of-song) or [make a karaoke version](/how/audio/make-karaoke-version-of-song).",
      },
    ],
    related: ["audio/change-key-of-song", "audio/make-karaoke-version-of-song", "audio/slow-down-song-without-changing-pitch", "hobbies/scale-a-recipe"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "ChordPro file format", href: "https://www.chordpro.org/chordpro/" },
      { label: "Wikipedia: Transposition (music)", href: "https://en.wikipedia.org/wiki/Transposition_(music)" },
    ],
  },
  {
    slug: "scale-a-recipe",
    niche: "hobbies",
    searchPhrases: ["recipe scaler", "scale a recipe", "double a recipe", "recipe converter", "recipe scaling calculator"],
    title: "Scale a recipe for more people, without the mistakes",
    description:
      "Scale recipes to serve more people in kitchen-friendly amounts, oven temperatures and can sizes kept right: by hand, or Stella (stella.sh) for a folder of recipes.",
    h1: "Scale a recipe up or down for more people",
    short: "Scale a recipe",
    lede: "Three recipes rewritten for 15 people, oven temperatures and can sizes left alone.",
    answer:
      "Divide the people you're feeding by the servings the recipe makes, multiply every ingredient by that number and round to sensible kitchen measures. Scale the number of cans, not the can size, keep the oven temperature the same, and check for doneness rather than multiplying the cooking time. Big batches need a bigger pan or two. Stella (stella.sh) rewrites every recipe in a folder this way on your computer and saves new copies.",
    stellaSteps: [
      "Finds three recipes in `Documents/Recipes`: lasagna in Word (serves 6), garlic bread as a text file (serves 4) and tiramisu in Markdown (serves 8)",
      "Works out each factor for 15: 2.5, 3.75 and 1.875",
      "Multiplies every ingredient and rounds to measures you'd use: 3¾ baguettes becomes 4, 1⅞ times the sugar becomes 1⅓ cups, “2 (28 oz) cans” becomes “5 (28 oz) cans”",
      "Keeps oven temperatures, and rewrites pan and timing notes for the bigger batch: two racks for the bread, a deeper dish and longer chilling for the tiramisu, extra dishes and 10–15 minutes more for the lasagna",
      "Saves each as a new file with “(serves 15)” in the name, in the same format; the lasagna's Word formatting matches the original, which stays untouched",
    ],
    prompt:
      "I'm cooking for 15 people. Scale the three recipes in the Recipes folder in my Documents to serve 15 and save the new versions.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "Three scaled recipes in about 2 minutes. Checked afterwards against an answer key written before the run: every ingredient of all three recipes scaled for 15 within kitchen rounding (lasagna ×2.5, garlic bread ×3.75, tiramisu ×1.875), the 28 oz can size kept with only the number of cans scaled, oven temperatures kept, cooking times not multiplied, and the originals unchanged.",
      note: "The recipes were written for this run. Stella added its own advice on pans, racks and timing, which the check didn't grade. The work is sped up 6×.",
      video: {
        src: `${PROOFS}/hobbies/scale-a-recipe/proof.mp4`,
        cuts: webCuts("hobbies/scale-a-recipe"),
        poster: `${PROOFS}/hobbies/scale-a-recipe/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 51.4,
        speed: 6,
        realDuration: 128,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Three recipes are in Documents/Recipes." },
        { at: 2, text: "The prompt: scale all three to serve 15 and save new versions." },
        { at: 19.2, text: "Stella replies with the three recipes it found and their servings." },
        { at: 25, text: "Scaling and rewriting, sped up 6×." },
        { at: 37.4, text: "Done: three new files for 15, with pans, racks and timings to plan the meal." },
      ],
    },
    manualTitle: "Scale it yourself",
    manualSteps: [
      {
        title: "Find the factor",
        body: "Divide the servings you need by the servings the recipe makes. For 15 people from a recipe that serves 6, that's 15 ÷ 6 = 2.5.",
      },
      {
        title: "Multiply and round",
        body: "Multiply every amount by the factor and round to measures you can actually use: 2.81 cups is about 2¾ cups, 3.75 baguettes is 4. Round eggs to whole eggs. Converting cups to grams first makes odd amounts easier to weigh.",
      },
      {
        title: "Leave these alone",
        body: "Oven temperature stays the same. Can and packet sizes stay the same: scale how many you buy. Don't multiply cooking times; a deeper dish takes a little longer, so check for doneness instead.",
      },
      {
        title: "Think about pans",
        body: "A bigger batch needs a bigger pan, or two pans on two racks swapped halfway. Note the pan sizes on the new copy so you aren't working it out mid-cook.",
      },
      {
        title: "Save a new copy",
        body: "Use Save As (or File, Duplicate in TextEdit and Pages) with the new serving count in the name, so the original recipe stays as it was.",
      },
    ],
    limits: [
      "Baking doesn't always scale in a straight line: leavening, salt and spices sometimes need less than a full multiple in very large batches. Stella scales them evenly and you may want to hold back a little.",
      "Its pan and timing advice is a suggestion based on the recipe; check doneness as you would normally.",
      "The recipes' text goes to the AI model you use in Stella while it rewrites them. The new files are saved on your computer.",
      "Recorded on Linux. Stella used its built-in Office document tool for the Word recipe, which works the same on Mac and Windows; nothing was installed.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Do you double the baking time when you double a recipe?",
        a: "No. Keep the temperature and start checking at the original time. A deeper dish takes somewhat longer; two dishes side by side take about the original time.",
      },
      {
        q: "How do I scale a recipe that uses eggs?",
        a: "Round to whole eggs, or beat an extra egg and use part of it. For 1.875 times a 6-yolk recipe, 11 yolks is close enough.",
      },
      {
        q: "Can it convert cups to grams at the same time?",
        a: "Yes. Ask for metric weights and Stella rewrites the amounts in grams and millilitres.",
      },
      {
        q: "Can it put my recipes into a cookbook?",
        a: "Yes: see [make a cookbook from your recipes](/how/documents/make-a-cookbook-from-your-recipes).",
      },
    ],
    related: ["documents/make-a-cookbook-from-your-recipes", "hobbies/transpose-chords", "hobbies/make-a-family-tree-chart-from-gedcom", "pdf-excel/split-bills-with-roommates"],
    lastChecked: "2026-11-14",
    sources: [{ label: "Wikipedia: Cooking weights and measures", href: "https://en.wikipedia.org/wiki/Cooking_weights_and_measures" }],
  },
  {
    slug: "make-a-family-tree-chart-from-gedcom",
    niche: "hobbies",
    searchPhrases: ["print family tree", "create family tree chart from gedcom", "gedcom viewer", "gedcom to pdf", "family tree chart from gedcom"],
    title: "Make a printable family tree chart from a GEDCOM file",
    description:
      "Turn the GEDCOM file your genealogy site exports into a printable family tree PDF, parents above children, with Gramps or Stella (stella.sh), nothing uploaded.",
    h1: "Print a family tree chart from your GEDCOM file",
    short: "Family tree chart from GEDCOM",
    lede: "A 20-person, four-generation family as a printable chart, every parent above its child.",
    answer:
      "Export your tree as a GEDCOM (.ged) file from the genealogy site you use, import it into the free Gramps program, then choose Reports, Graphical Reports, Descendant Tree, pick the oldest ancestor and save as PDF. Stella (stella.sh) reads the GEDCOM on your computer and draws a one-page chart PDF with birth and death years, telling apart people who share a name.",
    stellaSteps: [
      "Finds `Pell family tree.ged` in Documents: 20 people over four generations, including two different men named John Harrow and a second marriage",
      "Reads the people, couples and parent–child links and writes names plainly (John Harrow, not `John /Harrow/`)",
      "Draws the chart on one landscape page, parents above their children, each box with the name and birth and death years and the marriage year under each couple",
      "Adds a second page listing everyone with dates, places and parents, and saves `Pell family tree chart.pdf` next to the GEDCOM, which it doesn't change",
      "Points out two things in the data: a surname that matches neither parent nor husband, and six people with no death date who the chart treats as living",
    ],
    prompt: "Make a printable family tree chart as a PDF from the GEDCOM file in my Documents.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "A two-page chart PDF in under 3 minutes. Checked afterwards against an answer key written before the run: all 20 people named, both John Harrows told apart by birth year, all 22 parent–child links on the same page with the parent above the child, birth years shown for everyone, no GEDCOM slashes in names, and the GEDCOM unchanged.",
      note: "The family is made up, written as a GEDCOM 5.5.1 file for this run. The work is sped up 10×.",
      video: {
        src: `${PROOFS}/hobbies/make-a-family-tree-chart-from-gedcom/proof.mp4`,
        cuts: webCuts("hobbies/make-a-family-tree-chart-from-gedcom"),
        poster: `${PROOFS}/hobbies/make-a-family-tree-chart-from-gedcom/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 46.9,
        speed: 10,
        realDuration: 170,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A GEDCOM family tree file is in Documents." },
        { at: 2, text: "The prompt: a printable family tree chart as a PDF." },
        { at: 14.4, text: "Stella replies it will report how many people and generations the chart covers, and any gaps in the data." },
        { at: 20.3, text: "Reading the file and drawing the chart, sped up 10×." },
        { at: 32.9, text: "Done: 20 people across 4 generations on one landscape page, a list of everyone on page 2, and two data questions." },
      ],
    },
    manualTitle: "Make the chart yourself",
    manualSteps: [
      {
        title: "Export a GEDCOM",
        body: "Most genealogy sites and programs can export your tree as a .ged file, usually from the tree's settings or a Share or Export menu. Save it to your computer.",
      },
      {
        title: "Import it into Gramps",
        body: "Install the free Gramps from its [releases page](https://github.com/gramps-project/gramps/releases) for Windows, Mac or Linux. Create a new family tree, load it, and choose Family Trees, Import to bring in the .ged file.",
      },
      {
        title: "Make the chart",
        body: "Choose Reports, Graphical Reports, Descendant Tree (from an ancestor down) or Ancestor Tree (from a person up). Pick the starting person, set the output format to PDF, and choose a paper size; for a big tree, let it span pages or pick a larger size.",
      },
      {
        title: "Check and print",
        body: "Open the PDF, check that people with the same name are the right ones (birth years help), and print at Actual size or Fit to page. A copy shop can print large poster sizes.",
      },
    ],
    limits: [
      "A large tree won't fit one readable page. Ask Stella to split it by branch or use a poster-size page.",
      "Family data includes living relatives. The GEDCOM's names, dates and places go to the AI model you use in Stella while it reads the file; nothing is uploaded to a genealogy site.",
      "Stella draws a standard parents-above-children chart. Fan charts and decorative designs weren't covered.",
      "Recorded on Linux, using Python (built in on Mac and Linux) and the browser already on the computer to make the PDF. On Windows Stella may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What is a GEDCOM file?",
        a: "The standard text format genealogy programs use to exchange family trees: people, families, dates and places. Ancestry, MyHeritage, FamilySearch and most desktop programs can export one.",
      },
      {
        q: "Can I print a family tree without a subscription?",
        a: "Yes. Export the GEDCOM and make the chart with Gramps or Stella on your own computer.",
      },
      {
        q: "Will it get confused by relatives with the same name?",
        a: "It goes by the GEDCOM's own record IDs, not names, and shows birth years so you can tell them apart on paper. In the test, two men called John Harrow were kept apart.",
      },
      {
        q: "Can it make a family photo book or seating chart too?",
        a: "For photos, see [combine photos into one PDF](/how/photos-files/combine-photos-into-one-pdf). For a reunion's recipes, see [make a cookbook from your recipes](/how/documents/make-a-cookbook-from-your-recipes).",
      },
    ],
    related: ["documents/make-a-cookbook-from-your-recipes", "photos-files/combine-photos-into-one-pdf", "photos-files/fix-wrong-date-on-photos", "hobbies/scale-a-recipe"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Gramps releases (GitHub)", href: "https://github.com/gramps-project/gramps/releases" },
      { label: "Wikipedia: GEDCOM", href: "https://en.wikipedia.org/wiki/GEDCOM" },
    ],
  },
];
