import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const ETSY_CRICUT_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "make-svg-files-for-cricut",
    niche: "etsy-cricut",
    searchPhrases: [
      "how to make svg files for cricut",
      "how to make svg files for cricut for free",
      "how to turn handwriting into svg for cricut",
      "drawing to svg",
      "signature to svg",
    ],
    title: "Make SVG files for Cricut from words, drawings or handwriting",
    description:
      "Tell Stella (stella.sh) the words or show it a drawing or handwritten note, and get an SVG file for Cricut that cuts as one piece, sized for your project.",
    h1: "Make SVG files for your Cricut",
    short: "Make SVG files for Cricut",
    lede: "Your words, sketch or grandma's handwriting, as a file that's ready to cut.",
    answer:
      "Describe the design, or send a photo of a drawing or handwritten note. Stella (stella.sh) draws it as an SVG with smooth cut lines and joined letters, at the size you need.",
    gets: [
      "Names and quotes in fonts you pick",
      "Handwriting kept exactly as it was written",
      "Letters joined, so nothing peels apart",
      "Sized for a shirt, mug, car or wall",
    ],
    prompt:
      "Turn the photo of Grandma's handwritten 'Love you more' note on my Desktop into an SVG for my Cricut, 6 inches wide, to cut from white vinyl.",
    demo: {
      ack: "What a keepsake. Tracing her writing now.",
      task: "Making Grandma's note an SVG",
      rows: ["Removing the paper lines and shadows", "Tracing every pen stroke", "Thickening hairlines so they cut", "Saving at 6 inches wide"],
      reply:
        "Her note is on your Desktop as **love-you-more.svg**. Each word cuts as one piece with her own loops and slants, 6 inches wide. There's a mirrored copy for iron-on.",
      files: ["love-you-more.svg", "love-you-more-mirrored.svg"],
    },
    faq: [
      ["Can I make SVG files for Cricut for free?", "Yes. Stella is free to install and draws the file using your own ChatGPT, Claude or Gemini plan."],
      ["Can I use a drawing from Procreate?", "Yes. Export it as a PNG and the lines are traced into cut shapes."],
    ],
    byHand: [
      "Open [Inkscape](https://inkscape.org) (free), type your words and choose Path, Object to Path.",
      "For handwriting, import the photo and use Path, Trace Bitmap.",
      "Join touching letters with Path, Union, then save as Plain SVG.",
    ],
    related: ["etsy-cricut/convert-png-to-svg-for-cricut", "etsy-cricut/cricut-not-uploading-svg", "3d-printing/make-svg-files-for-laser-cutting"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-png-to-svg-for-cricut",
    niche: "etsy-cricut",
    searchPhrases: [
      "convert png to svg for cricut",
      "convert jpg to svg",
      "convert photo to svg for cricut free",
      "how to make a layered svg from an image",
      "layered svg converter",
    ],
    title: "Convert PNG or JPG to SVG for Cricut, in clean layers",
    description:
      "Convert a PNG, JPG or photo to an SVG for Cricut. Stella (stella.sh) traces it into smooth shapes, one layer per vinyl color, with no specks to weed.",
    h1: "Convert a PNG or JPG to SVG for Cricut",
    short: "PNG or JPG to SVG",
    lede: "Any picture as smooth cut shapes, split into the vinyl colors you have.",
    answer:
      "Give Stella (stella.sh) the picture and say how many vinyl colors you want. It simplifies the image, traces smooth outlines, and saves an SVG that opens in Design Space as one layer per color.",
    gets: [
      "One layer for each vinyl color",
      "Smooth curves instead of jagged edges",
      "Tiny specks removed before you weed",
      "A whole folder of pictures in one go",
    ],
    prompt: "Convert beagle.jpg in Downloads to a layered SVG for Cricut in three colors: black, tan and white. It's for a 4 inch car decal.",
    demo: {
      ack: "Cute face. Splitting it into three colors.",
      task: "Turning the beagle into an SVG",
      rows: ["Cutting the dog out of the background", "Reducing the photo to three colors", "Smoothing edges and dropping specks"],
      reply:
        "**beagle-3-color.svg** is in Downloads, 4 inches tall: a white base, then tan, then black on top. Small corner marks on each layer help you line them up.",
      files: ["beagle-3-color.svg", "beagle-preview.png"],
    },
    faq: [
      ["Why does my converted SVG have hundreds of tiny pieces?", "The converter traced every shade and bit of noise. Reducing the picture to a few flat colors first fixes it."],
      ["Can a photo of a face become an SVG?", "Yes. It's turned into a bold light-and-dark portrait, with the bits that would fall out bridged together."],
    ],
    byHand: [
      "Remove the background, then reduce the picture to 2 to 4 flat colors.",
      "In [Inkscape](https://inkscape.org): Path, Trace Bitmap, Multicolor tab, Colors mode. Raise Speckles to drop noise.",
      "Delete the white background layer and save as Plain SVG.",
    ],
    related: ["etsy-cricut/make-svg-files-for-cricut", "etsy-cricut/cricut-not-uploading-svg", "photos-files/remove-background-from-photos"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "cricut-not-uploading-svg",
    niche: "etsy-cricut",
    searchPhrases: [
      "cricut design space not uploading svg",
      "svg not showing up in cricut design space",
      "cricut unsupported file type",
      "cricut weld letters",
      "how to merge letters in cricut",
    ],
    title: "Cricut Design Space not uploading your SVG? Fix the file",
    description:
      "SVG missing pieces, rejected or the wrong size in Design Space? Stella (stella.sh) repairs the file: real shapes, welded letters and tidy color layers.",
    h1: "Design Space not uploading your SVG? Get a clean one",
    short: "SVG won't upload to Design Space",
    lede: "The same design, rebuilt so it opens whole, at the right size, and cuts properly.",
    answer:
      "Send the file to Stella (stella.sh). It finds what Design Space rejects, like live text, hidden pictures and masked shapes, rebuilds those as plain cut shapes, welds the letters and saves a clean copy.",
    gets: [
      "Missing pieces back where they belong",
      "Cursive words welded into one cut",
      "Layers grouped by color, duplicates gone",
      "Opens at the size you designed",
    ],
    prompt:
      "Design Space says my wedding-sign.svg has unsupported items, and the letters in 'The Parkers' overlap. Fix it so it uploads and cuts at 11 inches wide.",
    demo: {
      ack: "Let's see what it's tripping over.",
      task: "Repairing wedding-sign.svg",
      rows: ["Found live text and one hidden picture", "Turning the text into shapes", "Welding 'The Parkers' into one line", "Setting the width to 11 inches"],
      reply:
        "Your repaired sign is saved as **wedding-sign-cricut.svg** next to the original. The names are one welded piece, the leaves a separate green layer, all 11 inches wide.",
      files: ["wedding-sign-cricut.svg"],
    },
    faq: [
      ["How do I weld letters in Cricut Design Space?", "Select the text, reduce the letter spacing until they touch, then choose Combine, Weld."],
      ["Why are parts of my SVG missing in Design Space?", "It skips live text, masked shapes, pattern fills and pictures placed inside the file. Turned into plain shapes, they show up."],
    ],
    byHand: [
      "In Inkscape, choose Edit, Select All, then Path, Object to Path.",
      "Release masks and clips under the Object menu, and delete any placed pictures.",
      "Join letters with Path, Union. Save as Plain SVG and upload again.",
    ],
    related: ["etsy-cricut/make-svg-files-for-cricut", "etsy-cricut/convert-png-to-svg-for-cricut", "etsy-cricut/make-stickers-with-cricut"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-stickers-with-cricut",
    niche: "etsy-cricut",
    searchPhrases: [
      "how to make stickers with cricut",
      "cricut print then cut size",
      "cricut print then cut stickers",
      "sticker sheet cricut",
      "how to make printable stickers to sell on etsy",
    ],
    title: "Make sticker sheets with Cricut Print Then Cut",
    description:
      "Turn your drawings into sticker sheets for Cricut Print Then Cut. Stella (stella.sh) adds the white borders, fills the page and saves the sheet ready to upload.",
    h1: "Make stickers with your Cricut, a full sheet at a time",
    short: "Cricut sticker sheets",
    lede: "Your drawings with neat white borders, packed onto a sheet that's ready to print and cut.",
    answer:
      "Point Stella (stella.sh) at a folder of drawings or pictures. It cuts each one out, adds an even white border, and arranges them on a sheet that fits Print Then Cut.",
    gets: [
      "Even white borders that hide wobbly cuts",
      "As many stickers as the page holds",
      "A version for buyers to cut by hand",
    ],
    prompt:
      "Make a sticker sheet for Cricut Print Then Cut from the 12 mushroom drawings in Pictures/Mushrooms, about 1.5 inches each, with white borders, for Letter paper.",
    demo: {
      ack: "Adorable. Cutting them out first.",
      task: "Making your mushroom sticker sheet",
      rows: ["Cutting out 12 mushrooms", "Adding a white border to each", "Packing two of each onto the page"],
      reply:
        "**mushroom-sheet.png** is in Pictures/Mushrooms: 24 stickers, 1.5 inches each, sized for the Letter print area. Upload it as Print Then Cut and it follows each border.",
      files: ["mushroom-sheet.png", "mushroom-sheet.pdf", "singles/"],
    },
    faq: [
      ["What's the Cricut Print Then Cut size limit?", "On most current machines it's 7.44 x 9.94 inches for Letter paper and 7.2 x 10.62 for A4."],
      ["Can I sell the sheet on Etsy too?", "Yes. Ask for a pack with a printable PDF, a Cricut PNG and single stickers, zipped for buyers."],
    ],
    byHand: [
      "Remove each background, then add a white outline around it.",
      "Arrange them on a transparent page inside the Print Then Cut area at 300 DPI.",
      "In Design Space: Upload, Print Then Cut. Pick your sticker paper and kiss cut.",
    ],
    costNote: "Yes for your own drawings and photos. New AI artwork comes with Stella plans from $20 a month.",
    related: ["etsy-cricut/make-svg-files-for-cricut", "etsy-cricut/sell-digital-downloads-on-etsy", "photos-files/remove-background-from-photos"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "sublimation-size-chart",
    niche: "etsy-cricut",
    searchPhrases: [
      "sublimation size chart",
      "sublimation size for 20 oz tumbler",
      "tumbler wrap template",
      "how to make sublimation designs",
      "sublimation size for 11oz mug",
    ],
    title: "Sublimation size chart, and your design made to fit",
    description:
      "Sublimation sizes for tumblers, mugs and shirts, with your design fitted to each one. Stella (stella.sh) makes print-ready, mirrored files from your artwork.",
    h1: "Sublimation size chart, with your design fitted to each blank",
    short: "Sublimation sizes and wraps",
    lede: "One design, fitted to your tumbler, mug and shirt, ready to print.",
    answer:
      "Name the blank, or measure it, and give Stella (stella.sh) your artwork. It fits the design, matches the seam on wraps, and saves a sharp mirrored print file.",
    gets: [
      "Wraps whose edges meet at the seam",
      "Straight and tapered tumblers both covered",
      "Shirt sizes from youth to adult",
    ],
    prompt:
      "Turn my sunflower pattern in Pictures/Sunflower into a wrap for a 20 oz skinny tumbler, plus an 11 oz mug and a size L shirt front.",
    demo: {
      ack: "Pretty pattern. Fitting it to all three.",
      task: "Sizing your sunflower design",
      rows: ["Setting up a 9.3 x 8.2 inch wrap", "Matching the pattern at the seam", "Fitting the mug and shirt", "Saving mirrored print files"],
      reply:
        "Three print files are in Pictures/Sunflower/Print: the tumbler wrap at 9.3 x 8.2 inches, the mug at 9 x 3.75, and an 11 inch wide shirt front. All mirrored, all 300 DPI.",
      files: ["tumbler-20oz.png", "mug-11oz.png", "shirt-L.png"],
    },
    faq: [
      ["What is the sublimation size for a 20 oz skinny tumbler?", "About 9.3 x 8.2 inches for a straight one. Share your own measurements for an exact fit."],
      ["What size is an 11 oz mug wrap?", "Around 9 x 3.75 inches for a full wrap, or 3 x 3.5 inches per side."],
    ],
    byHand: [
      "Wrap paper around the blank, mark the overlap and height, and measure it.",
      "Make a canvas that size at 300 DPI in Canva, GIMP or Photoshop.",
      "Drop in the art, flip it left to right, print at 100%.",
    ],
    costNote: "Yes for fitting your own artwork. New AI patterns and pictures come with Stella plans from $20 a month.",
    related: ["design/design-a-t-shirt", "etsy-cricut/make-stickers-with-cricut", "etsy-cricut/etsy-mockups"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "printable-wall-art-sizes",
    niche: "etsy-cricut",
    searchPhrases: [
      "etsy printable wall art sizes",
      "how to size printable wall art to sell on etsy",
      "wall art size guide free printable",
      "etsy digital wall art sizes",
    ],
    title: "Printable wall art sizes for Etsy, all made from one design",
    description:
      "Turn one artwork into every printable wall art size Etsy buyers want: 8x10, 11x14, 16x20, 24x36 and A-sizes. Stella (stella.sh) crops, sizes and packs them.",
    h1: "Every printable wall art size for Etsy, from one design",
    short: "Printable wall art sizes",
    lede: "Your art in every frame size, sharp and under the upload limit.",
    answer:
      "Give Stella (stella.sh) the artwork. It makes the five shapes that cover nearly every frame, keeps the important parts in frame, and holds each file under Etsy's 20 MB limit.",
    gets: [
      "2:3, 3:4, 4:5, 11x14 and A-size files",
      "Print sharpness for the biggest frame",
      "Five files, which is what Etsy allows",
      "A size guide page for your buyers",
    ],
    prompt:
      "Make all the Etsy print sizes from the 6 botanical prints in Documents/Botanicals, keep the Latin names clear of the edges, and add a size guide.",
    demo: {
      ack: "Lovely set. Working out the crops first.",
      task: "Sizing six botanical prints",
      rows: ["Extending backgrounds to fit each shape", "Keeping the Latin names inside", "Saving five shapes for each print", "Writing the size guide"],
      reply:
        "All six prints are in **Botanicals/Etsy**, a folder each, with five JPGs named by shape and the frame sizes they fit. Every file is under 20 MB, and the size guide is one page.",
      files: ["fern/", "poppy/", "size-guide.pdf"],
    },
    faq: [
      ["Which sizes does each shape cover?", "2:3 prints 4x6 to 24x36, 3:4 prints 9x12 to 18x24, 4:5 prints 8x10 and 16x20. 11x14 and A4 to A1 get their own."],
      ["Will a small file look good at 24x36?", "It's enlarged cleanly first. Text is redrawn at full size, so it stays sharp."],
    ],
    byHand: [
      "Start from art at 7200 x 10800 pixels, which is 24x36 inches at 300 DPI.",
      "Crop copies to 2:3, 3:4, 4:5, 11:14 and A-size.",
      "Export as high-quality JPG, each under 20 MB.",
    ],
    related: ["etsy-cricut/etsy-mockups", "etsy-cricut/sell-digital-downloads-on-etsy", "printing-labels/print-poster-on-multiple-pages"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "etsy-mockups",
    niche: "etsy-cricut",
    searchPhrases: [
      "etsy mockups",
      "free etsy mockups",
      "etsy mockups for digital products",
      "etsy mockup generator",
      "how to make etsy listing photos for digital products",
    ],
    title: "Etsy mockups for every design in your shop",
    description:
      "Put your prints, shirts, mugs and digital products into Etsy mockups in one go. Stella (stella.sh) fills free scenes and saves a matching set for each listing.",
    h1: "Etsy mockups for all your designs at once",
    short: "Etsy mockups",
    lede: "Framed on a wall, worn, held or on a tablet: a full photo set per listing.",
    answer:
      "Show Stella (stella.sh) your designs and the look you like. It places each one into real-looking scenes, adds slides that say what's included, and saves a matching set for every listing.",
    gets: [
      "Frames, shirts, mugs and tablet screens",
      "The same style across your whole shop",
      "\"What's included\" and size slides",
      "Your own mockup scenes work too",
    ],
    prompt:
      "Make Etsy mockups for the 15 nursery prints in Designs/Nursery: a light oak frame above a crib, a set of three, and a what's included slide.",
    demo: {
      ack: "Sweet collection. Picking matching scenes.",
      task: "Making 15 sets of mockups",
      rows: ["Choosing three light nursery scenes", "Placing each print in the frames", "Matching light and shadows", "Adding the what's included slides"],
      reply:
        "45 listing pictures are in **Designs/Nursery/Mockups**, three per print, each 2400 x 1800. Every first picture is landscape with the print in the middle, so the search thumbnail shows it whole.",
      files: ["fox/", "moon/", "rainbow/"],
    },
    faq: [
      ["What size should Etsy mockups be?", "Etsy suggests at least 2000 pixels wide and tall, with a landscape or square first photo."],
      ["Where do the free scenes come from?", "Free mockup sites and stock photos, or templates you've bought. Point to the folder and those get filled."],
    ],
    byHand: [
      "Find scenes at Mockup World, Unblast or Canva's Mockups app.",
      "Place your design into each, one at a time, and export.",
    ],
    costNote: "Yes with free scenes or mockups you have. New AI scenes come with Stella plans from $20 a month.",
    related: ["etsy-cricut/printable-wall-art-sizes", "etsy-cricut/etsy-listing-generator", "design/product-photos-white-background"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "etsy-listing-generator",
    niche: "etsy-cricut",
    searchPhrases: [
      "etsy listing generator",
      "etsy tags generator free",
      "etsy title generator",
      "etsy description generator",
      "bulk create etsy listings",
    ],
    title: "Etsy listing generator: titles, tags and descriptions in bulk",
    description:
      "Write Etsy titles, 13 tags and descriptions for a whole batch of products. Stella (stella.sh) looks at each photo, writes the listing and can fill in the drafts.",
    h1: "An Etsy listing generator for your whole batch",
    short: "Etsy titles, tags and descriptions",
    lede: "Titles, tags and descriptions for thirty products, written from your photos and notes.",
    answer:
      "Drop your product photos in a folder with a few notes. Stella (stella.sh) looks at each item and writes a clear title, all 13 tags, a description and photo alt text, in your shop's voice.",
    gets: [
      "All 13 tags, each within 20 characters",
      "Titles buyers understand at a glance",
      "Descriptions with sizes, materials and care",
      "Drafts filled in on Etsy when you ask",
    ],
    prompt:
      "Write Etsy listings for the 30 earrings in Pictures/Earrings. Details are in earrings.xlsx. Friendly tone, gift tags, then fill them in as drafts in my shop.",
    demo: {
      ack: "On it. Looking through the earrings first.",
      task: "Writing 30 earring listings",
      rows: ["Matching photos to your spreadsheet", "Checking how buyers search for each", "Writing titles, tags and descriptions", "Filling drafts in Shop Manager"],
      reply:
        "All 30 listings are written and waiting as drafts in your shop, with photos, prices and tags in place. Nothing is published yet. A copy of every word is in **etsy-listings.xlsx**.",
      files: ["etsy-listings.xlsx"],
    },
    faq: [
      ["How many tags does Etsy allow?", "Thirteen per listing, up to 20 characters each. Short phrases like \"boho hoop earrings\" work better than single words."],
      ["How long should an Etsy title be?", "Short and clear. Say what the item is first, and leave gift ideas and occasions to the tags."],
    ],
    byHand: [
      "Type your item into Etsy search and note the suggestions.",
      "Use those phrases as tags, 13 per listing.",
      "Copy a past listing in Shop Manager to reuse shipping and policies.",
    ],
    related: ["etsy-cricut/etsy-mockups", "etsy-cricut/etsy-listing-photo-size", "etsy-cricut/etsy-bookkeeping-spreadsheet"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "etsy-listing-photo-size",
    niche: "etsy-cricut",
    searchPhrases: [
      "etsy listing photo size",
      "etsy image size for listing",
      "etsy photo resizer",
      "etsy shop banner size",
      "etsy picture dimensions",
    ],
    title: "Etsy listing photo size: fix every photo in your shop",
    description:
      "The right Etsy listing photo size is 2000 pixels or more each way. Stella (stella.sh) crops, resizes, brightens and renames all your shop photos to fit.",
    h1: "The right Etsy listing photo size, for every photo",
    short: "Etsy listing photo size",
    lede: "A season of phone photos, cropped, sized and named by product.",
    answer:
      "Etsy suggests photos at least 2000 pixels wide and tall, with a landscape or square first one. Stella (stella.sh) sorts a whole shoot by product, crops around the item, sizes it and names the files.",
    gets: [
      "Item centered, so thumbnails look right",
      "Named by product and shot order",
      "Light matched across each listing",
      "Banner, shop icon and video sized too",
    ],
    prompt:
      "Get the 180 ceramics photos in Pictures/October Shoot ready for Etsy: group by product, crop landscape, right size, and name them like blue-mug-1.",
    demo: {
      ack: "Nice shoot. Sorting them by piece first.",
      task: "Preparing 180 ceramics photos",
      rows: ["Grouping shots into 24 products", "Cropping each around the piece", "Evening out the window light", "Naming files by product"],
      reply:
        "24 product folders are in **Pictures/Etsy Ready**, with 180 photos at 2700 x 2025, each under 1 MB. The best front-on shot is number 1 in each. Your originals haven't moved.",
      files: ["blue-mug/", "speckled-bowl/", "bud-vase/"],
    },
    faq: [
      ["What size is the Etsy shop banner?", "The big banner is best at 1600 x 400 pixels, the mini banner at 1600 x 213, and the shop icon at 500 x 500."],
      ["Why does my Etsy thumbnail cut off the product?", "Search crops the first photo to fit its tile. Leaving space around the product keeps it whole."],
    ],
    byHand: [
      "Crop the first photo to 4:3 with space around the item.",
      "Resize to at least 2000 pixels on the short side.",
      "Save as JPG under 1 MB, then rename by product.",
    ],
    related: ["etsy-cricut/etsy-listing-generator", "design/product-photos-white-background", "photos-files/resize-images-in-bulk"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "sell-digital-downloads-on-etsy",
    niche: "etsy-cricut",
    searchPhrases: [
      "how to sell digital downloads on etsy",
      "etsy digital download instructions pdf",
      "etsy digital product file size",
      "etsy zip file",
      "how to sell digital files on etsy",
    ],
    title: "Sell digital downloads on Etsy: files packed and ready",
    description:
      "Selling digital downloads on Etsy? Stella (stella.sh) sorts your files into a tidy bundle: zips under 20 MB, clear names, an instructions PDF and a thank-you page.",
    h1: "Sell digital downloads on Etsy, bundle ready to upload",
    short: "Etsy digital download bundle",
    lede: "Messy design folder in, a bundle buyers understand out.",
    answer:
      "Point Stella (stella.sh) at your design folder. It exports every format buyers expect, sorts and names them, zips them to fit Etsy's limits, and writes a friendly PDF explaining how to open and use everything.",
    gets: [
      "Up to five uploads, each under 20 MB",
      "SVG, PNG, PDF and JPG in tidy folders",
      "Instructions for phone, tablet and computer",
      "A license page in your own words",
    ],
    prompt:
      "Pack the 40 Halloween designs in Designs/Halloween into an Etsy download: SVG and PNG of each, sorted by theme, plus instructions with my shop name, Maple Moth.",
    demo: {
      ack: "Spooky. Sorting the designs now.",
      task: "Packing the Halloween bundle",
      rows: ["Sorting 40 designs into four themes", "Exporting missing PNG copies", "Zipping each theme under 20 MB", "Writing the Maple Moth guide"],
      reply:
        "The bundle is in **Designs/Halloween/Etsy Upload**: four zips (ghosts, pumpkins, cats, quotes) and one instructions PDF in Maple Moth colors. That's Etsy's five uploads exactly.",
      files: ["ghosts.zip", "pumpkins.zip", "cats.zip", "quotes.zip", "start-here.pdf"],
    },
    faq: [
      ["Can I upload an SVG straight to Etsy as a download?", "Etsy's download list includes zip, PDF, PNG and JPG, so put SVG files inside a zip."],
      ["What if my files are bigger than 20 MB?", "They get split into several zips, or the PDF holds a button to your Google Drive or Dropbox folder."],
    ],
    byHand: [
      "Export each format and sort into folders by type.",
      "Right-click a folder to zip it. Keep each zip under 20 MB.",
      "Make a one-page guide in Canva or Word and save it as PDF.",
    ],
    related: ["etsy-cricut/etsy-mockups", "etsy-cricut/make-worksheets-to-sell", "etsy-cricut/printable-wall-art-sizes"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-worksheets-to-sell",
    niche: "etsy-cricut",
    searchPhrases: [
      "how to make worksheets to sell",
      "how to make worksheets to sell on teachers pay teachers",
      "how to make educational worksheets to sell",
      "how to make worksheets to sell on etsy",
      "how to make worksheets for teachers",
    ],
    title: "Make worksheets to sell on Etsy or Teachers Pay Teachers",
    description:
      "Make a whole worksheet pack to sell on TPT or Etsy. Stella (stella.sh) writes the questions, lays out the pages and adds answer keys, a cover and previews.",
    h1: "Make worksheets to sell, a full pack at a time",
    short: "Worksheets to sell",
    lede: "A finished classroom pack with answer keys, a cover and preview pages.",
    answer:
      "Tell Stella (stella.sh) the grade, subject and theme. It writes the questions, lays out clean pages with simple line art, works out every answer, and makes the cover and preview for your TPT or Etsy shop.",
    gets: [
      "Levels from easy to challenge",
      "An answer key matching every page",
      "US Letter and A4, color and black-and-white",
      "Cover and preview pictures for the listing",
    ],
    prompt:
      "Make a 20 page second grade fractions pack to sell on Teachers Pay Teachers, pizza theme, three levels, with answer keys and a cover.",
    demo: {
      ack: "Pizza fractions, great. Planning the levels.",
      task: "Making your pizza fractions pack",
      rows: ["Writing questions at three levels", "Drawing pizzas cut into equal slices", "Working out every answer", "Designing the cover and preview"],
      reply:
        "Your pack is in **Documents/Pizza Fractions**: 20 student pages, matching answer keys, a cover, and a four-page preview for TPT. Want the same set with a garden theme?",
      files: ["pizza-fractions.pdf", "answer-key.pdf", "preview.pdf", "cover.png"],
    },
    faq: [
      ["Can it match school standards?", "Yes. Name them, such as Common Core 2.G.A.3, and the questions follow, with the code in the teacher notes."],
      ["Can I edit the worksheets afterwards?", "Yes. Ask for PowerPoint or Word copies, or say what to change and the PDFs are remade."],
    ],
    byHand: [
      "Pick one skill and draft 10 to 20 questions.",
      "Lay them out in PowerPoint or Canva on a Letter page.",
      "Export a PDF, copy the pages for an answer key, and make a square cover.",
    ],
    related: ["publishing/make-a-printable-planner", "etsy-cricut/sell-digital-downloads-on-etsy", "study/make-a-word-search"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "etsy-bookkeeping-spreadsheet",
    niche: "etsy-cricut",
    searchPhrases: [
      "etsy bookkeeping spreadsheet",
      "etsy spreadsheet template free",
      "etsy profit and loss statement",
      "etsy profit calculator",
      "etsy fee calculator spreadsheet",
    ],
    title: "Etsy bookkeeping spreadsheet with fees and real profit",
    description:
      "See what you really earn on Etsy. Stella (stella.sh) builds a bookkeeping spreadsheet from your order and statement files: sales, every fee, costs and profit.",
    h1: "An Etsy bookkeeping spreadsheet that shows real profit",
    short: "Etsy bookkeeping spreadsheet",
    lede: "Every sale, fee and cost in one place, down to profit per product.",
    answer:
      "Download your orders and monthly statements from Etsy, or let Stella (stella.sh) fetch them in your signed-in browser. It builds a spreadsheet of sales, fees, ads, postage and material costs, with profit by month and product.",
    gets: [
      "Listing, transaction, payment and ad fees split out",
      "Profit for each product after materials",
      "Monthly totals ready for tax time",
      "New months added when you ask",
    ],
    prompt:
      "Build an Etsy spreadsheet from the 2026 order and statement files in Downloads, show fees and profit per product. A candle costs me $4.20 to make.",
    demo: {
      ack: "Sure. Starting with the statements.",
      task: "Building your Etsy books for 2026",
      rows: ["Reading 10 monthly statements", "Matching fees to each order", "Adding $4.20 per candle", "Charting profit by month"],
      reply:
        "**etsy-2026.xlsx** is in Documents: a tab for orders, one for fees and one for profit by product. Your fig candle earns the most per sale, and ads took the biggest share of fees in May.",
      files: ["etsy-2026.xlsx"],
    },
    faq: [
      ["Where do I download my Etsy sales and fees?", "In Shop Manager: Settings, Options, Download Data for orders, and Finances, Monthly statements for fees."],
      ["Does it work in Google Sheets?", "Yes. The file opens there, formulas and charts included."],
    ],
    byHand: [
      "Download each month's CSV from Finances, Monthly statements.",
      "Paste them into one sheet and total the fee types with a pivot table.",
      "Add a cost per product, then subtract costs and fees from sales.",
    ],
    related: ["printing-labels/make-packing-slips-from-orders", "etsy-cricut/etsy-listing-generator", "money-household/make-a-budget-from-bank-statement"],
    lastChecked: "2026-11-24",
  }),
];
