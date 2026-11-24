import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const DESIGN_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "make-a-youtube-thumbnail",
    niche: "design",
    searchPhrases: [
      "how to make a youtube thumbnail",
      "youtube thumbnail maker from video",
      "how to make a youtube thumbnail for free",
      "youtube thumbnail size",
      "youtube thumbnail with my face cut out",
    ],
    title: "How to make a YouTube thumbnail from your own video",
    description:
      "Ask Stella (stella.sh) for a YouTube thumbnail made from your own video: the best frame, your face cut out and big readable words, saved at 1280 × 720.",
    h1: "Make a YouTube thumbnail from your video",
    short: "YouTube thumbnail",
    lede: "A bold thumbnail that reads on a phone, made from your own footage.",
    answer:
      "Tell Stella (stella.sh) what the video is about. It picks a strong frame from your footage, cuts you out, adds a few big words and saves it at YouTube's size.",
    gets: [
      "Three versions to choose from",
      "Words you can read at phone size",
      "Your face cut out and brightened",
    ],
    prompt:
      "Make a thumbnail for my Iceland vlog in Videos/Iceland: me looking shocked at the glacier, with the words 47 HOURS IN ICELAND.",
    demo: {
      ack: "Love it. Finding the best frames first.",
      task: "Designing your Iceland thumbnail",
      rows: ["Pulling frames from the vlog", "Cutting you out of the glacier shot", "Setting big yellow lettering", "Shrinking it to phone size to check"],
      reply:
        "Done. **Three thumbnails** are in Videos/Iceland/Thumbnails: your face cut out over the glacier, with 47 HOURS IN ICELAND in thick yellow letters. B reads best small.",
      files: ["iceland-thumb-A.jpg", "iceland-thumb-B.jpg", "iceland-thumb-C.jpg"],
    },
    faq: [
      ["What size is a YouTube thumbnail?", "1280 × 720 pixels, a 16:9 shape, saved as a JPG or PNG."],
      ["Can it match my channel's style?", "Yes. Point it at your past thumbnails and it keeps their fonts, colours and layout."],
    ],
    byHand: [
      "In Canva, start a YouTube Thumbnail design, drop in a frame from your video and add big text.",
      "Cut yourself out with a free background remover and add a white outline so you stand out.",
    ],
    costNote:
      "Yes for thumbnails built from your own footage and photos. New AI backgrounds come with Stella plans from $20 a month.",
    related: ["video/extract-frames-from-video", "design/make-twitch-overlays", "design/retouch-portrait-photos"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-an-event-poster",
    niche: "design",
    searchPhrases: [
      "how to make an event poster",
      "how to make an event poster for free",
      "event poster design",
      "gig poster maker",
      "community event poster",
    ],
    title: "How to make an event poster for free, to print and post",
    description:
      "Ask Stella (stella.sh) to design your event poster from the details: date, place, a photo and a ticket QR code, saved for printing and for posting online.",
    h1: "Make an event poster",
    short: "Event poster",
    lede: "A poster for your gig, fair or meetup, ready for the printer and the feed.",
    answer:
      "Give Stella (stella.sh) the what, when and where, plus a photo if you have one. It designs the poster, adds a ticket QR code and saves it for print and social media.",
    gets: [
      "A print file at A3, A4 or tabloid",
      "Square and story versions for Instagram",
      "A QR code that opens your ticket page",
    ],
    prompt:
      "Make a poster for our jazz night at the Old Mill on Friday 12 December, 8pm, tickets at oldmilljazz.co.uk. Moody and warm, use the sax photo on my Desktop.",
    demo: {
      ack: "Sounds great. Starting with the layout.",
      task: "Designing the jazz night poster",
      rows: ["Toning the sax photo warm and dark", "Setting date, time and venue large", "Adding a QR code for tickets", "Saving print and posting sizes"],
      reply:
        "Done. Your poster is in Desktop/Jazz night: an A3 print PDF with the sax photo in amber light, plus square and story versions. The QR code opens oldmilljazz.co.uk.",
      files: ["jazz-night-A3.pdf", "jazz-night-square.png", "jazz-night-story.png"],
    },
    faq: [
      ["What size should an event poster be?", "A3 or A4 for noticeboards and windows, 11 × 17 inches in the US."],
      ["Can I change the poster afterwards?", "Yes. Ask for a new date, colour or line and it saves an updated copy."],
    ],
    byHand: [
      "Canva and Adobe Express have free poster templates; swap in your text and photo.",
      "Make the event name, date and place readable from across a room.",
    ],
    related: ["printing-labels/print-poster-on-multiple-pages", "design/make-a-flyer-for-your-business", "printing-labels/make-qr-codes-in-bulk"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-birthday-invitation",
    niche: "design",
    searchPhrases: [
      "how to make a birthday invitation",
      "birthday invitation maker free",
      "party invitation maker",
      "kids birthday party invitation",
      "birthday invitation to send on whatsapp",
    ],
    title: "How to make a birthday invitation to print or text",
    description:
      "Ask Stella (stella.sh) to make a birthday or party invitation in your theme, as cards to print at home and a picture to send by text or WhatsApp.",
    h1: "Make a birthday invitation",
    short: "Birthday or party invitation",
    lede: "A party invite in your theme, to print or send from your phone.",
    answer:
      "Tell Stella (stella.sh) whose party it is, the theme, the date and where. It designs the invitation and saves cards to print at home plus a picture you can send in any chat.",
    gets: [
      "Any theme, from dinosaurs to disco",
      "5 × 7 cards, two to a page",
      "A phone-sized picture to send",
    ],
    prompt:
      "Make an invitation for Maya's 6th birthday, unicorn theme, 6 June 2 to 4pm at Bounce Park, RSVP by text. I'll print some and text the rest.",
    demo: {
      ack: "Aw, fun. Going pastel with a unicorn.",
      task: "Making Maya's party invitation",
      rows: ["Finding free unicorn and rainbow artwork", "Setting the party details", "Laying two cards on each page"],
      reply:
        "Done. Maya's invitations are in Documents/Maya party: a print PDF with **two 5 × 7 cards per page** and a phone picture to text, both with a Bounce Park map link.",
      files: ["maya-invite-print.pdf", "maya-invite-phone.png"],
    },
    faq: [
      ["Can I send the invitation on WhatsApp?", "Yes. You get a picture sized for phones that sends in WhatsApp, iMessage or any chat."],
      ["Can each guest get one with their name?", "Yes. Give it the guest list and it makes a named invitation for every child."],
    ],
    byHand: [
      "Canva, Adobe Express and Greetings Island have free birthday templates.",
      "Print on card stock at actual size, then cut along the marks.",
    ],
    costNote:
      "Yes with free artwork and your own photos. Custom AI drawings come with Stella plans from $20 a month.",
    related: ["weddings-events/make-place-cards-from-guest-list", "design/make-an-event-poster", "weddings-events/count-wedding-rsvps"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-flyer-for-your-business",
    niche: "design",
    searchPhrases: [
      "how to make a flyer for my business",
      "business flyer design",
      "how to make a flyer for free",
      "flyer for cleaning business",
      "door to door flyers",
    ],
    title: "How to make a flyer for your business, ready to print",
    description:
      "Ask Stella (stella.sh) to design a flyer for your small business from your logo, services and photos, ready for a print shop or your home printer.",
    h1: "Make a flyer for your business",
    short: "Business flyer",
    lede: "A flyer for your small business that a print shop can take as is.",
    answer:
      "Send Stella (stella.sh) your logo, what you offer and how to reach you. It designs a clean flyer, writes the lines if you want, and saves a PDF any print shop can take.",
    gets: [
      "One side or front and back",
      "Bleed and trim marks for the print shop",
      "A home-print copy, two per page",
    ],
    prompt:
      "Design a flyer for Happy Tails, my dog walking business. Logo and photos are in Documents/Happy Tails. Daily walks, puppy visits, call 07700 900123.",
    demo: {
      ack: "Happy to. Starting from your logo colours.",
      task: "Designing the Happy Tails flyer",
      rows: ["Matching colours to your logo", "Writing a short line per service", "Adding bleed for the print shop"],
      reply:
        "Done. Your A5 flyer is in Documents/Happy Tails: a print-shop PDF with 3 mm bleed and trim marks, a home copy with two flyers per A4 sheet, and a square picture for local groups.",
      files: ["happy-tails-flyer-print.pdf", "happy-tails-flyer-home.pdf", "happy-tails-square.png"],
    },
    faq: [
      ["What size is a standard flyer?", "A5 or A6 in the UK and Europe, half letter or 8.5 × 11 inches in the US."],
      ["Can it write the words too?", "Yes. Give it a few notes about your business and it writes a headline and short lines you can change."],
    ],
    byHand: [
      "Print shops like Vistaprint and Moo list the size and bleed they need on each product page.",
      "In Canva, download as PDF Print with crop marks and bleed ticked.",
    ],
    related: ["printing-labels/print-business-cards-at-home", "design/make-a-logo", "design/make-a-lost-pet-poster"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-lost-pet-poster",
    niche: "design",
    searchPhrases: [
      "lost dog poster",
      "lost cat flyer template",
      "missing dog poster",
      "lost pet flyer maker",
      "lost cat poster with tear off tabs",
    ],
    title: "Make a lost dog or lost cat poster to print and share",
    description:
      "Pet missing? Send Stella (stella.sh) a photo and the details. You get a big, clear lost dog or cat poster with tear-off phone tabs, plus one to share online.",
    h1: "Make a lost dog or cat poster",
    short: "Lost dog or cat poster",
    lede: "A poster neighbours spot from across the street, to print and share.",
    answer:
      "Send Stella (stella.sh) your best photo and where your pet went missing. It makes a big, clear poster with tear-off phone tabs to print, and a picture sized for neighbourhood groups.",
    gets: [
      "LOST, the pet's name and one photo, large",
      "Tear-off strips with your number",
      "A version for Facebook, Nextdoor and WhatsApp groups",
    ],
    prompt:
      "My cat Biscuit got out last night near Elm Street. Ginger, white paws, very shy. Make lost cat posters with my number 555 0142 and the photo on my Desktop.",
    demo: {
      ack: "I'm sorry. Let's get these out fast.",
      task: "Making Biscuit's lost cat poster",
      rows: ["Brightening and cropping Biscuit's photo", "Setting LOST CAT in big letters", "Adding tear-off number strips"],
      reply:
        "Done. Biscuit's poster is on your Desktop: a letter-size PDF with his photo large, last seen near Elm Street, and 10 tear-off strips with 555 0142. A square copy for local groups sits beside it.",
      files: ["Biscuit lost cat poster.pdf", "Biscuit lost cat - share.png"],
    },
    faq: [
      ["What should a lost cat poster say?", "LOST CAT in big letters, one clear photo, the name, colour and markings, where last seen and your number. Fewer words get read from a car."],
      ["Can I print it in black and white?", "Yes. Ask for a black and white copy and the photo is tuned to print clearly."],
    ],
    byHand: [
      "Word and Google Docs have flyer templates; cut tear-off strips along the bottom.",
      "Post it in Facebook lost pet groups, on Nextdoor and on PawBoost too.",
    ],
    related: ["design/make-a-flyer-for-your-business", "printing-labels/print-poster-on-multiple-pages", "design/make-an-event-poster"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-cafe-menu",
    niche: "design",
    searchPhrases: [
      "how to make a menu",
      "cafe menu design",
      "restaurant menu template",
      "menu board for tv screen",
      "printable menu template",
    ],
    title: "How to make a menu for your café, to print or show on a TV",
    description:
      "Ask Stella (stella.sh) to turn your price list into a café menu in your own colours: a printed menu and a wide board for the TV behind the counter.",
    h1: "Make a menu for your café",
    short: "Café menu",
    lede: "Your price list turned into a menu that looks like it belongs to you.",
    answer:
      "Give Stella (stella.sh) your dishes and prices in any form, even a photo of the old menu. It designs the menu in your café's colours and saves it for printing and for the screen behind the counter.",
    gets: [
      "Sections clear, prices lined up",
      "A printable menu, A4 or letter",
      "A wide board for a TV screen",
    ],
    prompt:
      "Make a menu for my café, Little Fern, from Documents/menu.xlsx. Earthy greens, hand-drawn feel, one to print and one for the TV above the counter.",
    demo: {
      ack: "Lovely. Reading your price list first.",
      task: "Designing the Little Fern menu",
      rows: ["Grouping drinks, bakes and lunch", "Lining up 34 items and prices", "Making a wide version for the TV"],
      reply:
        "Done. The Little Fern menus are in Documents/Menus: an A4 PDF in deep green with a hand-drawn leaf border, and a 1920 × 1080 picture for the TV. Send new prices any time.",
      files: ["little-fern-menu-A4.pdf", "little-fern-menu-tv.png"],
    },
    faq: [
      ["How do I show a menu on a TV?", "Put the wide picture on a USB stick and open it in the TV's photo viewer, or show it from a streaming stick."],
      ["Can it add allergen labels?", "Yes. Tell it which dishes contain what and it adds small allergen marks with a key at the bottom."],
    ],
    byHand: [
      "Canva has free menu templates; paste in sections and prices one by one.",
      "For a TV, export at 1920 × 1080 and play it from a USB stick.",
    ],
    related: ["design/make-a-flyer-for-your-business", "design/make-a-logo", "documents/make-a-cookbook-from-your-recipes"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "design-a-t-shirt",
    niche: "design",
    searchPhrases: [
      "how to design a t shirt",
      "t shirt design maker",
      "family reunion t shirt design",
      "print ready t shirt design",
      "how to design t shirt graphics",
    ],
    title: "How to design a T-shirt, ready for the print shop",
    description:
      "Ask Stella (stella.sh) to design your T-shirt for a team, a family reunion or your merch. You get a print-ready file with a clear background and mockups to share.",
    h1: "Design a T-shirt",
    short: "T-shirt design",
    lede: "A shirt design you can send straight to a printer or merch shop.",
    answer:
      "Tell Stella (stella.sh) who the shirt is for and the feel you want. It designs the artwork, saves it ready for printing and shows it on a shirt so everyone can vote.",
    gets: [
      "Front and back designs",
      "A large PNG at 300 DPI, clear background",
      "Mockups in the shirt colours you pick",
    ],
    prompt:
      "Design a T-shirt for the Rivera family reunion, Lake Tahoe, July 2027. Retro sunset style, names of the grandparents on the back. We're ordering from Custom Ink.",
    demo: {
      ack: "Fun one. Sketching a retro sunset first.",
      task: "Designing the Rivera reunion shirt",
      rows: ["Building a sunset over the lake", "Setting RIVERA REUNION in retro letters", "Saving print files for Custom Ink", "Showing it on navy and white shirts"],
      reply:
        "Done. The shirt files are in Documents/Reunion shirt: front and back PNGs at 300 DPI with clear backgrounds, plus mockups on navy and white for the family chat.",
      files: ["rivera-front.png", "rivera-back.png", "rivera-mockups.jpg"],
    },
    faq: [
      ["What file does a T-shirt printer need?", "Usually a PNG with a clear background at 300 DPI, about 12 inches wide for the front."],
      ["Can I sell the design on my own merch store?", "Yes. It saves the sizes Printful, Spring or Redbubble ask for, so you upload and list it."],
    ],
    byHand: [
      "Custom Ink and Printful have free design tools in the browser.",
      "Merch by Amazon asks for 4500 × 5400 pixels; most print shops accept that size.",
    ],
    related: ["design/make-a-logo", "design/product-photos-white-background", "design/make-an-event-poster"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-twitch-overlays",
    niche: "design",
    searchPhrases: [
      "how to make twitch overlays",
      "twitch overlays for obs",
      "twitch alerts free",
      "starting soon screen for twitch",
      "custom stream overlay",
    ],
    title: "How to make Twitch overlays and alerts for OBS",
    description:
      "Ask Stella (stella.sh) for a matching Twitch overlay set: webcam frame, starting soon and BRB screens, plus follow and sub alerts, added to OBS for you.",
    h1: "Make Twitch overlays and alerts",
    short: "Twitch overlays and alerts",
    lede: "A stream that looks like yours, from the first screen to the raid alert.",
    answer:
      "Tell Stella (stella.sh) your channel name, colours and the games you play. It designs a matching set of Twitch overlays and alerts, then adds the scenes to OBS so you can go live.",
    gets: [
      "Webcam frame and chat box",
      "Starting soon, BRB and ending screens",
      "Follow, sub and raid alerts with sounds",
    ],
    prompt:
      "Make Twitch overlays for my channel PixelMoth: purple and teal, cozy, I play Stardew. Webcam frame, starting soon, BRB and alerts.",
    demo: {
      ack: "Cozy and purple, got it. Frame first.",
      task: "Building the PixelMoth stream overlays",
      rows: ["Drawing the webcam frame and chat box", "Making starting soon, BRB and ending screens", "Animating follow, sub and raid alerts", "Adding the scenes to OBS"],
      reply:
        "Done. OBS now has a PixelMoth scene collection: Starting Soon, Live, BRB and Ending, in purple and teal with soft pixel stars. The alerts are in your StreamElements alert box with gentle chimes.",
    },
    faq: [
      ["What size is a Twitch overlay?", "1920 × 1080 pixels, the same as your stream, with see-through areas where your game and camera show."],
      ["How do Twitch alerts get to OBS?", "Through a free service like StreamElements or Streamlabs, which gives you a link OBS shows over your stream."],
    ],
    byHand: [
      "Make the overlay as a 1920 × 1080 PNG with see-through gaps for game and camera.",
      "For alerts, set up an alert box in StreamElements and add its link to OBS as a Browser source.",
    ],
    related: ["design/make-a-youtube-thumbnail", "video/make-gif-from-video", "design/make-a-logo"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "product-photos-white-background",
    niche: "design",
    searchPhrases: [
      "product photography white background",
      "product mockup generator free",
      "make product photos look professional",
      "white background product photos for amazon",
      "product photos for online store",
    ],
    title: "Product photos on a clean white background, plus mockups",
    description:
      "Ask Stella (stella.sh) to turn phone shots into clean white-background product photos with soft shadows, plus mockups of your design on jars, mugs or prints.",
    h1: "Product photography with a white background, no studio",
    short: "White-background product photos",
    lede: "Phone shots of your products turned into clean, shop-ready pictures.",
    answer:
      "Send Stella (stella.sh) your phone photos. It sets each product on pure white with a soft shadow, evens out light and colour, and puts your designs on mockups like mugs and tote bags.",
    gets: [
      "Pure white behind, product filling the frame",
      "Even light, true colours, a soft shadow",
      "Mockups from free templates",
    ],
    prompt:
      "Make my candle photos in Pictures/Candles look professional on white with a little shadow, and put the Fig & Cedar label on a jar mockup.",
    demo: {
      ack: "Nice candles. Cleaning them up now.",
      task: "Making your candle product photos",
      rows: ["Lifting each candle off its background", "Evening the light and warming the wax", "Adding soft shadows on pure white", "Placing the label on a jar mockup"],
      reply:
        "Done. **12 product photos** are in Pictures/Candles/Shop, each 2000 × 2000 on pure white with the candle filling most of the frame. The Fig & Cedar jar mockup is in the same folder.",
    },
    faq: [
      ["What background does Amazon want for product photos?", "Pure white for the main picture, with the product filling about 85% of the frame."],
      ["Where do the mockups come from?", "Free mockup templates, with your design following the shape and light of the jar or mug."],
    ],
    byHand: [
      "Cut it out with Photoroom or remove.bg, then set the background to pure white.",
      "For mockups, try Mockup World or Canva's Mockups app.",
    ],
    costNote:
      "Yes for your own photos and free mockup templates. New AI lifestyle scenes come with Stella plans from $20 a month.",
    related: ["photos-files/remove-background-from-photos", "photos-files/resize-images-in-bulk", "design/design-a-t-shirt"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "retouch-portrait-photos",
    niche: "design",
    searchPhrases: [
      "retouch portrait photos for free",
      "how to smooth skin in photo",
      "fix lighting in photo",
      "remove blemishes from photo",
      "brighten face in dark photo",
    ],
    title: "Retouch portrait photos for free: skin, blemishes and light",
    description:
      "Ask Stella (stella.sh) to retouch your portraits: blemishes cleared, skin smoothed but still real, dark faces brightened and colour fixed, originals kept.",
    h1: "Retouch portrait photos for free",
    short: "Retouch a portrait",
    lede: "Portraits with better light and clearer skin that still look like you.",
    answer:
      "Tell Stella (stella.sh) which photos and what bothers you. It clears blemishes, softens skin while keeping its texture, lifts shadows on faces and fixes the colour, saving retouched copies beside the originals.",
    gets: [
      "Spots and blemishes gone",
      "Skin softened, pores still there",
      "Dark or orange faces fixed",
    ],
    prompt:
      "Retouch my LinkedIn headshots in Pictures/Headshots. Clear the spots, smooth my skin a little and fix my face being too dark against the window.",
    demo: {
      ack: "Sure. Keeping it natural.",
      task: "Retouching your headshots",
      rows: ["Clearing spots and under-eye shadows", "Softening skin, keeping texture", "Lifting the light on your face", "Matching colour across all six"],
      reply:
        "Done. Six retouched headshots are in Pictures/Headshots/Retouched. The spots are gone, skin is lightly softened and your face is brighter against the window. Originals untouched.",
    },
    faq: [
      ["How do I smooth skin without it looking fake?", "Even out the skin's tone and keep the fine texture. Ask for more or less smoothing until it looks like you."],
      ["Can it fix a photo that's too dark?", "Yes. It brightens the face and shadows without blowing out the sky or window behind."],
    ],
    byHand: [
      "Photopea is free in the browser: use the Spot Healing Brush on blemishes.",
      "In Lightroom, choose Masking, Select People, Facial Skin, then lower Texture a little.",
    ],
    costNote:
      "Yes for light, colour and skin fixes on your own photos. Bigger changes made with Stella's picture models come with Stella plans from $20 a month.",
    related: ["design/restore-old-photos", "photos-files/convert-raw-to-jpg", "design/make-a-youtube-thumbnail"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "restore-old-photos",
    niche: "design",
    searchPhrases: [
      "how to restore old photos",
      "restore old photos free",
      "fix scratches on old photo",
      "restore faded photo",
      "repair torn photo",
    ],
    title: "Restore old photos: fix scratches, fading and tears",
    description:
      "Ask Stella (stella.sh) to restore your old photos: scratches, dust and creases cleaned up, faded colour brought back and faces sharpened, saved as new copies.",
    h1: "Restore old photos",
    short: "Restore old photos",
    lede: "Faded, scratched family photos brought back, ready to print and share.",
    answer:
      "Scan or photograph the prints and tell Stella (stella.sh) where they are. It cleans dust, scratches and creases, brings back faded colour, sharpens faces and saves restored copies beside the scans.",
    gets: [
      "Dust, scratches and fold lines gone",
      "Faded colour and contrast brought back",
      "Blurry faces made clearer",
    ],
    prompt:
      "Restore the old photos I scanned into Pictures/Grandma scans. They're faded and scratched, one has a big crease. I want to print them for her 90th.",
    demo: {
      ack: "What a lovely gift. Starting with the creased one.",
      task: "Restoring Grandma's photos",
      rows: ["Cleaning dust and scratches", "Mending the crease in the 1962 photo", "Bringing back faded colour", "Sharpening faces for printing"],
      reply:
        "Done. **14 restored photos** are in Pictures/Grandma scans/Restored, at full size for printing. The crease is gone from the wedding photo and the colour is back in the orange-tinted ones.",
    },
    faq: [
      ["Can it fix a photo that's torn in half?", "Yes. It joins the halves and fills the gap. Repainting big missing parts uses Stella's picture models."],
      ["What's the best way to scan old photos?", "Scan at 600 DPI or more, or photograph them flat in daylight without glare."],
    ],
    byHand: [
      "Photoshop: Filter, Neural Filters, Photo Restoration fixes scratches and faces.",
      "Free: GIMP's Heal tool for scratches, and MyHeritage Photo Enhancer for faces.",
    ],
    costNote:
      "Yes for cleaning, colour and sharpening on your computer. Repainting torn or missing parts uses Stella's picture models, on Stella plans from $20 a month.",
    related: ["photos-files/split-scanned-photos", "design/colorize-black-and-white-photos", "design/retouch-portrait-photos"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "colorize-black-and-white-photos",
    niche: "design",
    searchPhrases: [
      "colorize black and white photos",
      "colorize black and white photos free",
      "colorize old photo",
      "add color to black and white photo",
      "colorize photo no sign up",
    ],
    title: "Colorize black and white photos with natural colour",
    description:
      "Ask Stella (stella.sh) to colorize your black and white photos with natural skin, sky and clothing colours, guided by what you remember, saved as new copies.",
    h1: "Colorize black and white photos",
    short: "Colorize black and white photos",
    lede: "Old black and white photos in lifelike colour, the way you remember them.",
    answer:
      "Point Stella (stella.sh) at your black and white photos and mention anything you know, like a red dress. It adds natural colour, follows your notes and saves colour copies beside the originals.",
    gets: [
      "Natural skin, sky and clothing colours",
      "The colours you remember, used",
      "A whole album at once",
    ],
    prompt:
      "Colorize the black and white photos of my grandparents in Pictures/Old family. Grandpa's uniform was navy, Grandma's wedding dress was ivory, and the car was dark green.",
    demo: {
      ack: "Lovely. Using your colour notes.",
      task: "Colorizing your family photos",
      rows: ["Adding colour to 9 photos", "Setting navy, ivory and dark green", "Keeping skin tones warm and real"],
      reply:
        "Done. Nine colour copies are in Pictures/Old family/Colour. Grandpa's uniform is navy, the wedding dress ivory and the car dark green, with warm, natural skin. Originals untouched.",
    },
    faq: [
      ["How does it know the real colours?", "It judges from the scene: skies blue, grass green. Anything you tell it, like a dress colour, wins over the guess."],
      ["Can it colorize a damaged photo?", "Yes. Ask it to fix the scratches and fading first, then add colour."],
    ],
    byHand: [
      "Photoshop: Filter, Neural Filters, Colorize, then adjust with focus points.",
      "Free online: Palette.fm and MyHeritage In Color.",
    ],
    costNote:
      "Yes with a free colouring tool Stella sets up on your computer. Colouring with Stella's own picture models comes with Stella plans from $20 a month.",
    related: ["design/restore-old-photos", "photos-files/split-scanned-photos", "video/make-slideshow-with-music"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-logo",
    niche: "design",
    searchPhrases: [
      "how to make a logo",
      "how to make a logo for a business",
      "how to make a logo for free",
      "logo with transparent background",
      "simple logo design for small business",
    ],
    title: "How to make a logo for your business, free",
    description:
      "Ask Stella (stella.sh) for a logo for your business: a few directions to pick from, then every file you need, with clear backgrounds, in colour and white.",
    h1: "Make a logo for your business",
    short: "Logo for your business",
    lede: "A clean logo in every file you'll need, from website to shop sign.",
    answer:
      "Tell Stella (stella.sh) your business name and the feel you're after. It sketches a few logo directions, refines the one you pick and saves every version you need, with clear backgrounds.",
    gets: [
      "Several directions to choose from",
      "Colour, black and white versions",
      "SVG and PNG files with clear backgrounds",
    ],
    prompt:
      "Make a logo for my bakery, Crumb & Co. Warm, a bit vintage, maybe a wheat stalk. I need it for the sign, Instagram and stickers.",
    demo: {
      ack: "Sounds delicious. Sketching some directions.",
      task: "Designing the Crumb & Co logo",
      rows: ["Sketching four logo directions", "Pairing a vintage serif with a wheat stalk", "Saving colour and one-colour versions"],
      reply:
        "Done. Four directions are in Documents/Crumb & Co logo. Pick one and I'll finish the set: SVG for the sign maker, PNGs with clear backgrounds, a white version and a round Instagram icon.",
    },
    faq: [
      ["How do I make a logo with a transparent background?", "Save it as a PNG or SVG with nothing behind the shapes. Every version you get is saved that way."],
      ["Which files does a sign or sticker printer want?", "Usually an SVG or PDF, which stays sharp at any size. You get both."],
    ],
    byHand: [
      "Canva and Adobe Express have free logo makers; pick a template and change the name.",
      "Export SVG for print and a PNG with a transparent background for the web.",
    ],
    related: ["design/make-a-flyer-for-your-business", "printing-labels/print-business-cards-at-home", "design/design-a-t-shirt"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-an-instagram-carousel",
    niche: "design",
    searchPhrases: [
      "how to make instagram carousel",
      "instagram carousel template",
      "instagram post template",
      "instagram carousel that connects",
      "instagram carousel size",
    ],
    title: "How to make an Instagram carousel, plus post templates",
    description:
      "Ask Stella (stella.sh) to turn your notes or photos into an Instagram carousel in your brand's look, plus a template so the next post needs only the text.",
    h1: "Make an Instagram carousel and post templates",
    short: "Instagram carousel and templates",
    lede: "Swipeable posts in your own look, made from your notes or photos.",
    answer:
      "Send Stella (stella.sh) your text, tips or photos and your brand colours. It lays them out as a swipeable Instagram carousel, sized for the feed, and keeps the look as a template for your next posts.",
    gets: [
      "Slides at 1080 × 1350, the tall feed size",
      "Pictures that flow across slides",
      "Your look saved for next time",
    ],
    prompt:
      "Turn my notes in Documents/5 houseplant mistakes.docx into an Instagram carousel for my plant shop. Sage green and cream, one tip per slide, a strong cover.",
    demo: {
      ack: "Great topic. Planning the slides first.",
      task: "Making your houseplant carousel",
      rows: ["Cutting your notes into seven slides", "Writing a cover that makes people swipe", "Adding free plant photos in sage and cream", "Saving the look as a template"],
      reply:
        "Done. **Seven slides** are in Documents/Instagram/Houseplant mistakes, numbered in order at 1080 × 1350. The look is saved: next time, just send the text.",
    },
    faq: [
      ["How many slides can an Instagram carousel have?", "Up to 20 photos or videos in one post."],
      ["How do I make a carousel that connects?", "Design one wide picture, then cut it into equal slides so it flows as people swipe. Stella lines up the cuts so nothing jumps."],
    ],
    byHand: [
      "In Canva, set a custom size of 1080 × 1350 and duplicate the page for each slide.",
      "For a connected carousel, make one wide design and split it with a carousel splitter.",
    ],
    related: ["design/make-a-youtube-thumbnail", "design/make-a-logo", "photos-files/resize-images-in-bulk"],
    lastChecked: "2026-11-24",
  }),
];
