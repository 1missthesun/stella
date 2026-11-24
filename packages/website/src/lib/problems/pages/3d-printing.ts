import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const PRINTING_3D_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "make-a-custom-stl-file",
    niche: "3d-printing",
    searchPhrases: [
      "how to make an stl file",
      "custom stl maker",
      "ai stl generator from text",
      "make a 3d printable model from a description",
      "how to make an stl file for 3d printing",
    ],
    title: "Make a custom STL file to 3D print, from a description",
    description:
      "Need something printed that doesn't exist yet? Describe it to Stella (stella.sh) and get a custom STL file built to your measurements, with a preview first.",
    h1: "Make a custom STL file from a description",
    short: "A custom STL from a description",
    lede: "Describe the thing you need and get a file ready to print.",
    answer:
      "Say what the object is and how big it should be. Stella (stella.sh) builds the model from exact shapes and measurements, shows you a preview picture, and saves an STL ready for your slicer.",
    gets: ["A print-ready STL, sized in millimetres", "A preview picture before you print", "Changes by asking: taller, thicker, more holes"],
    prompt: "Make me an STL of a wall hook that clips over a 2 cm thick door, strong enough for a backpack.",
    demo: {
      ack: "Sure. Working out the hook's shape first.",
      task: "Making your door hook STL",
      rows: ["Sizing the clip for a 2 cm door", "Thickening the arm to hold weight", "Rendering a preview picture"],
      reply:
        "Done. **door-hook.stl** is in Downloads: it clips over a 2 cm door and has a 6 mm thick arm for a backpack. Print it lying on its side so the layers run along the hook.",
      files: ["door-hook.stl", "door-hook-preview.png"],
    },
    faq: [
      ["Can AI make an STL from a picture?", "Yes. Turning a photo or a loose idea into a 3D shape uses Stella's own 3D models, on paid plans. Models built from shapes and measurements are free."],
      ["Can I change the model afterwards?", "Yes. Ask for 5 mm wider or rounder corners and a new version is saved."],
    ],
    byHand: [
      "Simple shapes: drag and combine blocks in [Tinkercad](https://www.tinkercad.com), then export as STL.",
      "Exact measured objects: [OpenSCAD](https://openscad.org) builds models from typed numbers.",
    ],
    related: ["3d-printing/3d-print-a-replacement-part", "3d-printing/make-a-name-keychain-stl", "3d-printing/resize-a-3d-model-to-measurements"],
    costNote:
      "Yes for models built from shapes and measurements. 3D from a photo and AI-made models come with Stella plans from $20 a month.",
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "3d-print-a-replacement-part",
    niche: "3d-printing",
    searchPhrases: [
      "how to 3d print a replacement part",
      "how to make replacement parts with 3d printer",
      "how to make a replacement plastic part",
      "design a replacement part from measurements",
      "3d print broken plastic clip",
    ],
    title: "3D print a replacement part from your measurements",
    description:
      "Broken clip, knob or bracket? Give Stella (stella.sh) the measurements or a photo next to a ruler and get a replacement part drawn and saved, ready to 3D print.",
    h1: "3D print a replacement part from measurements",
    short: "A replacement part from measurements",
    lede: "The broken clip, knob or bracket, remade to print at home.",
    answer:
      "Measure the broken piece with a ruler or calipers, or send a photo beside a ruler. Stella (stella.sh) draws the part to those sizes, leaves a little room so it fits, and saves a file to print.",
    gets: ["A part drawn to your sizes", "A touch of extra room so it fits first time", "A thin test piece to check the fit"],
    prompt:
      "The plastic clip that holds my dishwasher basket snapped. It's 32 mm long with a 6 mm hole. Make me one to print.",
    demo: {
      ack: "Got it. Drawing the clip to your sizes.",
      task: "Remaking your dishwasher basket clip",
      rows: ["Drawing the 32 mm clip", "Sizing the hole for a snug fit", "Adding a thin fit-test slice"],
      reply:
        "Done. **basket-clip.stl** and **fit-test.stl** are in Downloads. Print the test first; if it's loose, say so and I'll tighten the hole. PETG copes with dishwasher heat better than PLA.",
      files: ["basket-clip.stl", "fit-test.stl"],
    },
    faq: [
      ["What if I don't have calipers?", "A ruler works for most parts. Measure twice, or photograph the piece next to the ruler, and print the quick fit test before the full part."],
      ["What filament should I use?", "PLA for indoor parts that stay cool. PETG for anything warm, wet or outdoors, like dishwasher or car parts."],
    ],
    byHand: [
      "Measure each edge and hole with digital calipers, in millimetres.",
      "Draw it in [Tinkercad](https://www.tinkercad.com) or Fusion, adding about 0.2 mm where parts slide together.",
    ],
    related: ["3d-printing/make-a-custom-stl-file", "3d-printing/resize-a-3d-model-to-measurements", "3d-printing/bambu-studio-best-settings"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-name-keychain-stl",
    niche: "3d-printing",
    searchPhrases: [
      "3d printed name keychain",
      "custom name keychain 3d print",
      "keychain stl maker",
      "keychain generator 3d print",
      "name sign 3d print file",
    ],
    title: "Make a 3D printed name keychain or name sign",
    description:
      "Want a name keychain or desk sign to 3D print? Tell Stella (stella.sh) the names and font and get print-ready files with raised letters for a second colour.",
    h1: "Make a 3D printed name keychain",
    short: "Name keychains and signs",
    lede: "Any name, in the font you like, ready to print in two colours.",
    answer:
      "Give the name, a font and a size. Stella (stella.sh) makes a keychain or desk sign with raised letters and a ring hole, set up so the letters can print in a second colour.",
    gets: ["Raised letters on a solid base", "A ring hole, or a stand for a sign", "Several names at once, one file each"],
    prompt: "Make name keychains for my kids Mia, Leo and Ava, in a bubbly font, white letters on a pink base.",
    demo: {
      ack: "Fun. Making three keychains now.",
      task: "Making Mia, Leo and Ava keychains",
      rows: ["Setting the names in a rounded font", "Adding a base and ring hole", "Splitting letters for the second colour"],
      reply:
        "Done. Three keychains are in Downloads/Keychains, each 50 mm wide with a 5 mm ring hole. Letters and base are separate parts, so they print white on pink.",
      files: ["mia-keychain.3mf", "leo-keychain.3mf", "ava-keychain.3mf"],
    },
    faq: [
      ["Can I do two colours on a single-colour printer?", "Yes. The letters start at a set height, so you pause there, swap filament and carry on. You're told which layer to pause at."],
      ["Can it use my own font?", "Yes. Point to any font on your computer, or name a free one and it's downloaded for you."],
    ],
    byHand: [
      "MakerWorld's MakerLab has free keychain and sign makers: type a name, pick a font, download.",
      "Or in Tinkercad, put a Text shape on a flat base and export as STL.",
      "For two colours on one nozzle, pause the print where the letters begin.",
    ],
    related: ["3d-printing/make-a-custom-stl-file", "3d-printing/make-a-lithophane-from-a-photo", "design/make-a-logo"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "fix-a-broken-stl-file",
    niche: "3d-printing",
    searchPhrases: [
      "fix stl file",
      "repair stl files for 3d printing",
      "fix non manifold edges",
      "fix stl online free",
      "non manifold edges bambu",
    ],
    title: "Fix a broken STL file: holes and non-manifold edges",
    description:
      "Slicer warning about non-manifold edges, or prints with gaps? Stella (stella.sh) repairs the STL: holes closed, parts merged, saved as a clean copy to slice.",
    h1: "Fix a broken STL file",
    short: "Fix a broken STL",
    lede: "A model your slicer complains about, made solid and printable.",
    answer:
      "When a slicer warns about non-manifold edges or holes, the model's surface has gaps. Stella (stella.sh) closes them, joins loose pieces, and saves a repaired STL you can slice without warnings.",
    gets: ["Holes closed and inside-out faces turned around", "Overlapping pieces merged into one solid", "Your original file left as it was"],
    prompt: "Bambu Studio says my dragon STL has non-manifold edges and the print comes out with gaps. Fix it.",
    demo: {
      ack: "On it. Finding where the surface is broken.",
      task: "Repairing your dragon STL",
      rows: ["Finding open edges and holes", "Closing gaps in the wings", "Merging overlapping parts into one"],
      reply:
        "Fixed. **dragon-fixed.stl** is next to the original, now one closed solid with no open edges. It slices without the warning, and the gaps in the wings are filled.",
      files: ["dragon-fixed.stl"],
    },
    faq: [
      ["What does non-manifold edges mean?", "Somewhere the model's skin doesn't close, or one edge is shared by too many faces. Slicers can't tell inside from outside there, so prints get gaps."],
      ["Is there a way to fix STL online free?", "A few free sites do it, but big or badly broken models often fail there. Fixing it on your computer handles large files and keeps them private."],
    ],
    byHand: [
      "Bambu Studio on Windows: right-click the model and choose Fix model.",
      "[Meshmixer](https://meshmixer.com): Analysis, Inspector, then Auto Repair All.",
      "Blender: add the 3D Print Toolbox extension, run Check All, then Make Manifold.",
    ],
    related: ["3d-printing/split-a-model-for-3d-printing", "3d-printing/bambu-studio-best-settings", "3d-printing/resize-a-3d-model-to-measurements"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "split-a-model-for-3d-printing",
    niche: "3d-printing",
    searchPhrases: [
      "split model for 3d printing",
      "split stl into parts",
      "split stl with connectors",
      "model too big for print bed",
      "split large model for 3d printing",
    ],
    title: "Split a model for 3D printing when it's too big for the bed",
    description:
      "Model too big for your print bed? Stella (stella.sh) splits it into pieces that fit, with hidden seams and pegs so the parts line up when you glue them.",
    h1: "Split a big model for 3D printing",
    short: "Split a model that's too big",
    lede: "A model too big for your printer, cut into pieces that fit and join.",
    answer:
      "Tell it which printer you have. Stella (stella.sh) cuts the model into pieces that fit your bed, puts the cuts where seams hide, and adds pegs and holes so the parts line up when glued.",
    gets: ["Every piece fits your print bed", "Pegs and holes so parts line up", "Cuts placed where seams are hard to spot"],
    prompt: "This life-size Pikachu STL is way too big for my Bambu A1 mini. Split it into pieces I can print and glue.",
    demo: {
      ack: "Sure. Planning cuts for a 180 mm bed.",
      task: "Splitting your Pikachu into printable parts",
      rows: ["Measuring the model against your bed", "Cutting along the ears and body", "Adding pegs to line pieces up"],
      reply:
        "Done. Pikachu is now 9 pieces in Downloads/Pikachu-split, each under 180 mm with matching pegs and holes. A **parts map** shows what goes where.",
      files: ["pikachu-parts.3mf", "parts-map.png"],
    },
    faq: [
      ["Can I split STL into parts in Bambu Studio?", "Yes, with the Cut tool, which can add connectors. It makes one flat cut at a time, so a big model means many cuts by hand."],
      ["What glue holds PLA parts together?", "Super glue for small joins, or two-part epoxy for big pieces that carry weight."],
    ],
    byHand: [
      "Bambu Studio or OrcaSlicer: select the model, press C for Cut, and add Dowel or Plug connectors.",
      "PrusaSlicer has the same Cut tool with connectors.",
      "Leave about 0.2 mm of room around each peg.",
    ],
    related: ["3d-printing/3d-print-a-cosplay-helmet", "3d-printing/fix-a-broken-stl-file", "3d-printing/resize-a-3d-model-to-measurements"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "bambu-studio-best-settings",
    niche: "3d-printing",
    searchPhrases: [
      "bambu studio best settings",
      "bambu lab settings for strength",
      "bambu studio settings for miniatures",
      "bambu studio settings for easy support removal",
      "bambu lab a1 settings for petg",
    ],
    title: "Bambu Studio best settings for your print, set up for you",
    description:
      "Not sure which Bambu Studio settings to use? Tell Stella (stella.sh) what you're printing and get a tuned preset for strength, detail, speed or easy supports.",
    h1: "Best Bambu Studio settings for your print",
    short: "Bambu Studio settings",
    lede: "The right settings for this exact print, saved as a preset.",
    answer:
      "Say what you're printing and what matters most: strength, detail, speed or easy supports. Stella (stella.sh) works out the settings for your Bambu Lab printer and filament and saves them as a Bambu Studio preset.",
    gets: ["A named preset in Bambu Studio's list", "Each change explained in a line", "Presets for miniatures, strong parts or quick drafts"],
    prompt: "I'm printing a shelf bracket in PETG on my Bambu A1. Set up Bambu Studio so it's as strong as possible.",
    demo: {
      ack: "Good pick for a bracket. Setting up a strong preset.",
      task: "Making a strong PETG preset for your A1",
      rows: ["Reading your Bambu Studio presets", "Adding walls and infill for strength", "Saving it as Strong PETG Bracket"],
      reply:
        "Done. Pick **Strong PETG Bracket** in Bambu Studio's process list. It uses 5 walls, 40% gyroid infill and a slower outer wall. Lay the bracket so layers run along its arms, not across them.",
    },
    faq: [
      ["Where do Bambu Studio presets go?", "Into your Bambu Studio user folder, so it shows in the list next time you open the app."],
      ["What are good settings for easy support removal?", "Tree supports, a slightly bigger gap between support and part, and a different pattern where they touch. Ask for an easy-supports preset and you get those."],
    ],
    byHand: [
      "In Bambu Studio, pick your printer, filament and the 0.20mm Standard process.",
      "Strength: 4 to 6 wall loops and 25% to 40% infill. Detail: 0.08 or 0.12 mm layers.",
    ],
    related: ["3d-printing/prusaslicer-best-settings", "3d-printing/fix-3d-print-stringing", "3d-printing/split-a-model-for-3d-printing"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "prusaslicer-best-settings",
    niche: "3d-printing",
    searchPhrases: [
      "prusaslicer best settings",
      "best prusaslicer settings for ender 3",
      "prusaslicer settings for tpu",
      "prusaslicer support settings",
      "best prusaslicer settings for pla",
    ],
    title: "PrusaSlicer best settings for your printer and filament",
    description:
      "Using PrusaSlicer with a Prusa, Ender 3 or other printer? Stella (stella.sh) sets up tuned printer, filament and print profiles so you just pick them and slice.",
    h1: "Best PrusaSlicer settings for your printer",
    short: "PrusaSlicer settings",
    lede: "A tuned PrusaSlicer setup for your printer, ready to pick.",
    answer:
      "Name your printer and filament. Stella (stella.sh) sets up PrusaSlicer for them, including printers from other brands like the Ender 3, and saves the profiles so they appear in PrusaSlicer's lists.",
    gets: ["Printer, filament and print profiles in one go", "Works for Creality, Elegoo or Anycubic printers too", "A note on what each change does"],
    prompt: "I just got an Ender 3 V2 and want to use PrusaSlicer. Set it up with good settings for PLA.",
    demo: {
      ack: "Sure. Setting PrusaSlicer up for your Ender 3 V2.",
      task: "Setting up PrusaSlicer for your Ender 3 V2",
      rows: ["Adding the Ender 3 V2 printer", "Tuning PLA heat and pull-back", "Saving a 0.2 mm everyday profile"],
      reply:
        "Done. In PrusaSlicer pick **Ender 3 V2**, **PLA Ender** and **0.20mm Everyday**: 205 °C nozzle, 60 °C bed, 5 mm pull-back for its long feed tube. Print the first-layer square in Downloads to check bed height.",
      files: ["first-layer-square.stl"],
    },
    faq: [
      ["Does PrusaSlicer work with an Ender 3?", "Yes. PrusaSlicer works with most printers and includes Creality profiles you can start from and tune."],
      ["What are good PrusaSlicer support settings?", "Supports on the build plate only for most prints, organic supports for figures, and a slightly bigger top gap so they snap off cleanly."],
    ],
    byHand: [
      "Open the Configuration Wizard and choose your printer's brand and model.",
      "Adjust temperature and retraction under Filament Settings and Printer Settings.",
    ],
    related: ["3d-printing/bambu-studio-best-settings", "3d-printing/fix-3d-print-stringing", "3d-printing/fix-a-broken-stl-file"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "fix-3d-print-stringing",
    niche: "3d-printing",
    searchPhrases: [
      "3d print stringing fix",
      "pla stringing fix",
      "petg stringing",
      "3d print stringing bambu",
      "how to stop stringing 3d printer",
    ],
    title: "Fix 3D print stringing: stop the hairs between parts",
    description:
      "Thin plastic hairs all over your prints? Stella (stella.sh) tunes your slicer's heat and pull-back for your filament, saves a new preset and makes a test print.",
    h1: "Fix 3D print stringing",
    short: "Fix stringing",
    lede: "Clean prints without the cobweb hairs between parts.",
    answer:
      "Stringing is melted plastic oozing while the nozzle moves between parts. Stella (stella.sh) lowers the heat and tunes how far the filament pulls back in your slicer, saves it as a new preset, and makes a small test print.",
    gets: ["Heat and pull-back tuned for your filament", "A new preset, your old one kept", "A small stringing test to print first"],
    prompt: "My PETG prints on the Ender 3 are full of stringy hairs between the towers. Fix my slicer settings.",
    demo: {
      ack: "Sure. Looking at your PETG settings first.",
      task: "Fixing stringing on your PETG prints",
      rows: ["Reading your PETG filament profile", "Lowering nozzle heat by 10 degrees", "Tuning pull-back distance and speed", "Making a two-tower stringing test"],
      reply:
        "Done. Your new **PETG No Strings** preset is in your slicer, with **stringing-test.stl** in Downloads. Print the test; if hairs remain, dry the spool for a few hours, since damp PETG strings most.",
      files: ["stringing-test.stl"],
    },
    faq: [
      ["Why is my PLA stringing?", "Usually too hot, too little pull-back, or damp filament. Drop 5 to 10 degrees first, then dry the spool if it still strings."],
      ["Do Bambu printers string less?", "Their presets are well tuned, but damp filament strings on any printer. Drying the spool fixes most stringing on Bambu printers."],
    ],
    byHand: [
      "Raise retraction a little: 0.5 to 1 mm on direct drive, 4 to 6 mm on Bowden printers.",
      "Dry filament for 4 to 6 hours: PLA around 50 °C, PETG around 65 °C.",
    ],
    related: ["3d-printing/bambu-studio-best-settings", "3d-printing/prusaslicer-best-settings", "3d-printing/3d-print-a-replacement-part"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "3d-print-a-cosplay-helmet",
    niche: "3d-printing",
    searchPhrases: [
      "cosplay helmet 3d print",
      "3d print armor cosplay",
      "pepakura to 3d print",
      "pepakura foam templates",
      "cosplay mask 3d print",
    ],
    title: "3D print a cosplay helmet or armour, or make Pepakura templates",
    description:
      "Making a cosplay helmet or armour? Stella (stella.sh) sizes the model to you and splits it to fit your printer, or unfolds it into Pepakura foam templates.",
    h1: "3D print a cosplay helmet",
    short: "Cosplay helmets and armour",
    lede: "A wearable helmet or armour, cut to print or traced onto foam.",
    answer:
      "Send the helmet or armour file and your head or body size. Stella (stella.sh) sizes it to you and splits it into pieces your printer fits, or unfolds it into Pepakura-style templates to cut from foam.",
    gets: ["Sized to your head or body", "Pieces that fit your printer, with pegs to join", "Flat foam or card templates as a printable PDF"],
    prompt: "I downloaded a Mandalorian helmet STL. My head is 58 cm around. Make it fit me and split it for my Bambu P1S.",
    demo: {
      ack: "This is the way. Sizing it to your head first.",
      task: "Making your Mandalorian helmet printable",
      rows: ["Sizing for a 58 cm head plus padding", "Hollowing it to a 3 mm shell", "Splitting into pieces under 256 mm", "Adding pegs at each seam"],
      reply:
        "Done. Your helmet is 6 pieces in Downloads/Mando-helmet, sized for a 58 cm head with room for foam padding. A **parts map** shows the glue order, and the visor slot stays in one piece.",
      files: ["mando-helmet.3mf", "parts-map.png"],
    },
    faq: [
      ["Pepakura or 3D print: which is better?", "Printing gives sharp detail with little hand work but many hours of printing. Foam is lighter and quicker, with softer detail."],
      ["Can I get Pepakura templates from an STL?", "Yes. The model is simplified into flat panels and laid out on printable pages, with fold lines and numbers to match the edges."],
    ],
    byHand: [
      "Cut it to fit your bed with the slicer's Cut tool.",
      "For foam, open the model in [Pepakura Designer](https://tamasoft.co.jp/pepakura-en/) on Windows and unfold it.",
    ],
    related: ["3d-printing/resize-a-3d-model-to-measurements", "3d-printing/split-a-model-for-3d-printing", "3d-printing/fix-a-broken-stl-file"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "resize-a-3d-model-to-measurements",
    niche: "3d-printing",
    searchPhrases: [
      "how to scale 3d model for printing",
      "resize stl file",
      "cosplay armor sizing software",
      "3d print armor sizing",
      "resize stl to fit body measurements",
    ],
    title: "Scale a 3D model for printing to someone's measurements",
    description:
      "Armour, a mask or a ring that has to fit a real person? Give Stella (stella.sh) the measurements and get each piece scaled to fit, saved as print-ready copies.",
    h1: "Scale a 3D model for printing to your measurements",
    short: "Resize a model to a person",
    lede: "Armour, a ring or a mask sized to the person who will wear it.",
    answer:
      "Give the measurements that matter, like head, wrist or chest. Stella (stella.sh) scales each piece of the model to match, keeps the walls the same thickness, and saves print-ready copies.",
    gets: ["Each piece scaled to its own measurement", "Wall thickness kept, not stretched", "A size card listing every change"],
    prompt: "Scale this Iron Man gauntlet and forearm armour to my son. Wrist 15 cm, forearm 22 cm, hand 17 cm long.",
    demo: {
      ack: "Got it. Matching each piece to his measurements.",
      task: "Sizing the Iron Man armour for your son",
      rows: ["Measuring the model's wrist and forearm", "Scaling each piece to its measurement", "Keeping the shell 2.5 mm thick"],
      reply:
        "Done. Sized copies are in Downloads/IronMan-sized: the forearm at 78% and the gauntlet at 74%, both with the original shell thickness. **size-card.txt** lists each scale for when he grows.",
      files: ["forearm-sized.stl", "gauntlet-sized.stl", "size-card.txt"],
    },
    faq: [
      ["How do I resize an STL file in Bambu Studio?", "Select it, open the Scale tool, and type a percentage or an exact size in millimetres. It scales everything evenly, walls included."],
      ["Is there cosplay armor sizing software?", "ArmorSmith fits armour to a 3D body you shape. Here you just give a few tape measurements and each piece is scaled to fit."],
    ],
    byHand: [
      "Measure the model in your slicer and divide your measurement by it to get the scale.",
      "Add about 1 cm for padding on anything worn.",
      "Scale each piece on its own; one percentage rarely fits every part.",
    ],
    related: ["3d-printing/3d-print-a-cosplay-helmet", "3d-printing/split-a-model-for-3d-printing", "3d-printing/3d-print-a-replacement-part"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-lithophane-from-a-photo",
    niche: "3d-printing",
    searchPhrases: [
      "lithophane maker",
      "create lithophane from photo",
      "how to make a lithophane in bambu studio",
      "lithophane lamp",
      "lithophane maker free",
    ],
    title: "Lithophane maker: turn a photo into a 3D print",
    description:
      "Turn a favourite photo into a lithophane that lights up when held to a lamp. Stella (stella.sh) makes it flat, curved or as a lamp, saved as a file to print.",
    h1: "Make a lithophane from a photo",
    short: "A lithophane from a photo",
    lede: "Your photo, hidden in a print that appears when light shines through.",
    answer:
      "Pick a photo and a shape: flat frame, curved, night light or lamp. Stella (stella.sh) crops and brightens it, turns it into a print whose thickness makes the picture, and saves a file to slice.",
    gets: ["Flat, curved, heart, round lamp or light box", "Contrast tuned so faces stay clear", "How to slice it for your printer"],
    prompt: "Make a lithophane night light from the photo of my grandparents on the Desktop, about 10 cm wide.",
    demo: {
      ack: "Lovely idea. Preparing the photo first.",
      task: "Making your grandparents' lithophane",
      rows: ["Cropping and brightening the faces", "Turning light and dark into thickness", "Curving it for a night light"],
      reply:
        "Done. **grandparents-lithophane.stl** is on your Desktop: 100 mm wide, curved to sit over a tea light. Print it in white PLA, standing upright, at 100% infill so the picture shows evenly.",
      files: ["grandparents-lithophane.stl"],
    },
    faq: [
      ["Can I make a lithophane in Bambu Studio?", "Not inside Bambu Studio itself. MakerWorld's free lithophane maker runs online, or ask and you get a file that opens in Bambu Studio like any model."],
      ["What filament is best for a lithophane?", "Plain white PLA. Coloured or glossy filament hides detail. Print it upright, slowly, with thin layers."],
    ],
    byHand: [
      "MakerWorld's MakerLab has a free lithophane maker that exports a file for Bambu Studio.",
      "Other free makers: [3dp.rocks](https://3dp.rocks/lithophane/) runs in the browser.",
    ],
    related: ["3d-printing/make-a-name-keychain-stl", "design/restore-old-photos", "3d-printing/make-a-custom-stl-file"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-svg-files-for-laser-cutting",
    niche: "3d-printing",
    searchPhrases: [
      "svg files for laser cutting",
      "convert image to svg for laser engraving",
      "photo to svg for laser engraving",
      "laser cut box svg",
      "laser engraving file maker",
    ],
    title: "Make SVG files for laser cutting and engraving",
    description:
      "Need a file for your laser cutter? Stella (stella.sh) draws cut-ready SVG files from an idea, logo or photo, sized to your material, for LightBurn or xTool.",
    h1: "Make SVG files for laser cutting",
    short: "SVG files for a laser cutter",
    lede: "Cut-ready and engrave-ready files for your laser, from an idea or a picture.",
    answer:
      "Describe the piece, or send a logo or photo. Stella (stella.sh) draws clean cut lines, puts engraving in its own colour, sizes everything to your material, and saves SVG files for LightBurn or xTool.",
    gets: ["Cut lines and engraving kept in separate colours", "Boxes and joints sized to your wood's thickness", "Photos traced into clean engrave-ready shapes"],
    prompt: "Make a laser cut SVG for a 3 mm plywood box with finger joints, 15 cm cube, with my dog's name on the lid.",
    demo: {
      ack: "Sure. Drawing the box for 3 mm plywood.",
      task: "Making your plywood box SVG",
      rows: ["Laying out six 150 mm panels", "Fitting finger joints to 3 mm wood", "Adding the name to the lid"],
      reply:
        "Done. **dog-box.svg** is in Downloads: red lines cut, black fill engraves the name. The joints allow for the laser's cut width, so the panels press-fit together.",
      files: ["dog-box.svg"],
    },
    faq: [
      ["How do I convert an image to SVG for laser engraving?", "The picture is traced into clean outlines, specks removed and shapes joined so the laser doesn't jump around. Photos become a dot pattern for engraving."],
      ["Will it work with LightBurn, xTool or Glowforge?", "Yes. All three open SVG files. Colours map to cut and engrave layers, and sizes stay in millimetres."],
    ],
    byHand: [
      "Free box layouts: [MakerCase](https://www.makercase.com) or [boxes.py](https://boxes.hackerspace-bamberg.de).",
      "Trace a picture in [Inkscape](https://inkscape.org) with Path, Trace Bitmap.",
      "Set cut lines to a thin red stroke and engraving to filled black.",
    ],
    related: ["3d-printing/make-a-name-keychain-stl", "design/make-a-logo", "photos-files/remove-background-from-photos"],
    lastChecked: "2026-11-24",
  }),
];
