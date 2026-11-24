import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const WEBSITES_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "make-a-website-without-coding",
    niche: "websites",
    searchPhrases: [
      "make a website without coding",
      "make a website without coding for free",
      "how to make a website with ai",
      "can i make a website without coding",
      "best way to make a website without coding",
    ],
    title: "Make a website without coding, and put it online free",
    description:
      "No code and no website builder. Tell Stella (stella.sh) what your site is for and it makes the pages, puts them online free and changes them when you ask.",
    h1: "Make a website without coding",
    short: "Make a website without coding",
    lede: "Say what the site is for and get it, online, without touching code.",
    answer:
      "You don't need to code or learn a website builder. Describe the site in a sentence and Stella (stella.sh) writes every page on your computer, shows you a preview, then puts it online on a free host you sign in to.",
    gets: [
      "Real pages that look right on phones and computers",
      "A preview to change before anyone sees it",
      "Online at a free web address, or your own domain",
    ],
    prompt:
      "Make me a simple website for my dog walking business in Leeds, with my services, photos from my Pictures folder and a way to get in touch.",
    demo: {
      ack: "Nice. Starting with your services and photos.",
      task: "Making your dog walking website",
      rows: [
        "Writing the home, services and contact pages",
        "Picking your best dog photos",
        "Fitting every page to phone screens",
        "Putting it online on Netlify",
      ],
      reply:
        "Done. Your site is live at **leedsdogwalks.netlify.app** with your services, eight photos and a contact form that emails you. The files are in Documents/dog-walking-site.",
    },
    faq: [
      [
        "Is it really free to put a website online?",
        "Yes. GitHub Pages, Netlify and Cloudflare Pages all host simple sites free. You only pay if you want your own domain name.",
      ],
      [
        "Do I need to know any code to change it later?",
        "No. Ask for the change in plain words, like a new photo, and it's updated and put back online.",
      ],
    ],
    byHand: [
      "Google Sites or Carrd make a basic free page with drag and drop.",
      "Or ask a chatbot for one HTML page, save it as index.html and drag its folder onto [Netlify Drop](https://app.netlify.com/drop).",
    ],
    related: [
      "websites/host-a-website-for-free",
      "websites/make-a-small-business-website",
      "websites/make-a-portfolio-website",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-portfolio-website",
    niche: "websites",
    searchPhrases: [
      "how to make a portfolio website for free",
      "artist portfolio website free",
      "photography portfolio websites free",
      "how to make a portfolio website for graphic design",
      "portfolio website github",
    ],
    title: "Make a free portfolio website for your art, photos or design",
    description:
      "Turn the work in a folder into a clean portfolio site with galleries, an about page and a way to hire you. Stella (stella.sh) makes it and puts it online free.",
    h1: "Make a portfolio website for free",
    short: "Make a portfolio website",
    lede: "Your best work in a clean gallery, with a link you can send anyone.",
    answer:
      "Point at the folder with your work and say what you do. Stella (stella.sh) picks and sizes the images, lays them out as galleries with an about page and contact details, and puts it online free.",
    gets: [
      "Galleries that open fast, even with big photos",
      "An about page and a way to hire you",
      "One link for your CV, emails and Instagram",
    ],
    prompt:
      "Make a portfolio website for my photography from the Portfolio folder in Pictures. Weddings and portraits as separate galleries, plus an about page.",
    demo: {
      ack: "Lovely. Looking through your photos first.",
      task: "Making your photography portfolio",
      rows: [
        "Sorting 64 photos into weddings and portraits",
        "Making web-sized copies that open quickly",
        "Laying out the galleries and about page",
        "Publishing it on GitHub Pages",
      ],
      reply:
        "Your portfolio is live at **annaphoto.github.io** with a weddings gallery, a portraits gallery and an about page with your email. Your original photos weren't changed; the site's files are in Documents/portfolio-site.",
    },
    faq: [
      [
        "Will my photos lose quality on the site?",
        "The site shows web-sized copies so pages open quickly on phones. They still look sharp, and your full-size originals stay untouched.",
      ],
      [
        "Can I add a watermark to my photos?",
        "Yes. Ask for your name in a corner of each picture on the site; the originals in your folder stay clean.",
      ],
    ],
    byHand: [
      "Pick 15 to 30 of your strongest pieces; fewer reads better.",
      "Adobe Portfolio comes with Creative Cloud, and Carrd has a free plan for a single page.",
      "Resize images to about 2000 pixels wide before uploading.",
    ],
    related: [
      "websites/connect-a-domain-to-your-website",
      "photos-files/add-watermark-to-photos",
      "photos-files/resize-images-in-bulk",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-wedding-website-with-rsvp",
    niche: "websites",
    searchPhrases: [
      "wedding website with rsvp",
      "free wedding websites with rsvp",
      "make a wedding website free",
      "wedding website with rsvp qr code",
      "wedding website with rsvp and registry",
    ],
    title: "Make a free wedding website with RSVP",
    description:
      "Your story, the day's plan, travel, registry and an RSVP form guests reach from a QR code. Stella (stella.sh) makes the wedding site and puts it online free.",
    h1: "Make a free wedding website with RSVP",
    short: "Wedding website with RSVP",
    lede: "Everything guests need in one place, and RSVPs that add themselves up.",
    answer:
      "Tell Stella (stella.sh) your date, venue and style. It makes the wedding website with your story, schedule, travel and registry links, adds an RSVP form whose answers land in a Google Sheet, and puts it online free.",
    gets: [
      "Every RSVP, meal and plus-one in one spreadsheet",
      "A QR code for your save-the-dates",
      "No wedding company logos or adverts",
    ],
    prompt:
      "Make a wedding website for Priya and Tom, 14 June 2027 at Hever Castle. Sage green, our photos from Pictures/engagement, RSVP with meal choice.",
    demo: {
      ack: "Congratulations! Starting with your story and the day.",
      task: "Making your wedding website",
      rows: [
        "Writing the story, schedule and travel pages",
        "Adding the RSVP form with meal choices",
        "Sending answers to a Google Sheet",
        "Making a QR code for invitations",
      ],
      reply:
        "Your site is live at **priyaandtom.netlify.app**, in sage green with your engagement photos. RSVPs go straight into a Google Sheet called Wedding RSVPs, and the QR code is ready for the invitations.",
      files: ["wedding-qr-code.png"],
    },
    faq: [
      [
        "Can guests RSVP for a plus-one?",
        "Yes. The form can ask for a plus-one's name and meal too, and each guest shows up as their own row.",
      ],
      [
        "Can we use our own wedding domain?",
        "Yes. Buy a name like priyaandtom.com and it's connected to the site for you.",
      ],
    ],
    byHand: [
      "Zola, The Knot and Withjoy make free wedding sites with RSVP built in.",
      "For your own design, embed a Google Form for RSVPs; answers collect in a Google Sheet.",
      "Make a QR code of the site's link for the save-the-dates.",
    ],
    related: [
      "weddings-events/count-wedding-rsvps",
      "weddings-events/make-wedding-seating-chart",
      "websites/connect-a-domain-to-your-website",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-small-business-website",
    niche: "websites",
    searchPhrases: [
      "free website for my small business",
      "create website for my small business",
      "how to create a website for my cafe",
      "website for plumbers",
      "small business website builder free",
    ],
    title: "Make a free website for your small business",
    description:
      "Café, salon, plumber or shop: get a site with your services, hours, map, photos and a call button. Stella (stella.sh) makes it and puts it online free.",
    h1: "Make a free website for your small business",
    short: "Small business website",
    lede: "Hours, services, photos and a call button, on a site that's yours.",
    answer:
      "Say what the business does and where. Stella (stella.sh) makes a site with your services, opening hours, photos, a map and tap-to-call, written so people searching nearby find you, and puts it online free.",
    gets: [
      "Tap to call and directions on phones",
      "Your hours and services, easy to change",
      "Your town in every page title, for local searches",
    ],
    prompt:
      "Make a website for my café, Bean There, on 12 High Street in Bath. Menu from menu.pdf on my Desktop, opening hours, photos and a map.",
    demo: {
      ack: "Great. Reading your menu first.",
      task: "Making the Bean There website",
      rows: [
        "Turning menu.pdf into a menu page",
        "Adding hours, map and tap to call",
        "Choosing photos that suit each page",
        "Putting it online on Cloudflare Pages",
      ],
      reply:
        "Bean There is live at **beanthere-bath.pages.dev** with your menu, opening hours, a map to 12 High Street and a call button for phones. Ask any time to change the menu or hours.",
    },
    faq: [
      [
        "Do I need a website if I have a Google Business Profile?",
        "It helps. Your Google profile can link to the site, and the site shows your full menu, services and photos your way.",
      ],
      [
        "Can customers book or order online?",
        "The site can link to your booking or delivery app, or have a simple form that emails you each request.",
      ],
    ],
    byHand: [
      "Fill in your free Google Business Profile first; it's what shows on Maps.",
      "Google Sites, Square Online and Carrd have free plans for a simple business site.",
      "Put your phone number and hours at the top; that's what most visitors want.",
    ],
    related: [
      "websites/get-your-website-on-google",
      "websites/connect-a-domain-to-your-website",
      "websites/add-a-contact-form-to-your-website",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-link-in-bio-page",
    niche: "websites",
    searchPhrases: [
      "link in bio free",
      "linktree alternatives free",
      "make a linktree free",
      "link in bio websites",
      "personal website for free",
    ],
    title: "Make your own link in bio page, free (a Linktree alternative)",
    description:
      "Your own page for the link in your Instagram or TikTok bio: your links, your look, no logo at the bottom. Stella (stella.sh) makes it and puts it online free.",
    h1: "Make your own link in bio page, free",
    short: "Your own link in bio page",
    lede: "One link for your bio, with everything you do behind it.",
    answer:
      "Instead of a Linktree, have your own page. Give Stella (stella.sh) your links and a photo, and it makes a link in bio page in your colours, with no logo at the bottom, and puts it online free.",
    gets: [
      "Big buttons for every link, made for phones",
      "Your photo, colours and font",
      "Your own address, not a Linktree one",
    ],
    prompt:
      "Make me a link in bio page like Linktree for my TikTok. Links to my shop, YouTube, Spotify and newsletter, pink and black, my photo is me.jpg.",
    demo: {
      ack: "Fun. Building it around your photo.",
      task: "Making your link in bio page",
      rows: [
        "Adding buttons for your four links",
        "Styling it pink and black",
        "Sizing it for phone screens",
        "Putting it online on GitHub Pages",
      ],
      reply:
        "Your page is live at **mayamakes.github.io**, with your photo, four big buttons and your socials along the bottom. Paste that link in your TikTok bio, and ask whenever a link changes.",
    },
    faq: [
      [
        "Can I see how many people visit?",
        "Yes. Cloudflare's free visitor stats can be added, showing how many people came and which app sent them.",
      ],
      [
        "Can it be a full personal website instead?",
        "Yes. Ask for an about page, a gallery or a blog alongside the links, all on the same site.",
      ],
    ],
    byHand: [
      "Linktree, Beacons and Carrd all have free plans that show their own branding on your page.",
      "Carrd's free plan gives you a carrd.co address; your own domain needs a paid plan.",
    ],
    related: [
      "websites/make-a-website-without-coding",
      "websites/connect-a-domain-to-your-website",
      "websites/make-a-portfolio-website",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-a-landing-page",
    niche: "websites",
    searchPhrases: [
      "make a landing page for free",
      "make a landing page with ai",
      "event landing page",
      "landing page for app",
      "landing page for music",
    ],
    title: "Make a landing page for free, for a product or event",
    description:
      "Launching a product, app, class or event? Stella (stella.sh) makes a one-page site that says what it is, shows why it's good and collects sign-ups, online free.",
    h1: "Make a landing page for free",
    short: "Make a landing page",
    lede: "One page that explains it and gets people to sign up.",
    answer:
      "A landing page is one page with one job: get people to sign up, buy or come. Tell Stella (stella.sh) what you're launching and it writes the page, adds a sign-up form and puts it online free.",
    gets: [
      "A headline and words that make people want it",
      "A sign-up or ticket button that works",
      "Sign-ups in one list you can download",
    ],
    prompt:
      "Make a landing page for my pottery workshop on 8 March in Brighton. Twelve spots, photos in Pictures/pottery, people sign up with name and email.",
    demo: {
      ack: "Sounds fun. Writing the page around the date.",
      task: "Making your pottery workshop page",
      rows: [
        "Writing the headline and what's included",
        "Adding your pottery photos",
        "Adding a sign-up form for names and emails",
        "Putting it online on Netlify",
      ],
      reply:
        "Your workshop page is live at **brightonpottery.netlify.app**. Each sign-up arrives in your email and in a list on Netlify you can download. Tell me when all twelve spots are taken and it'll say sold out.",
    },
    faq: [
      [
        "What should a landing page have?",
        "A clear headline, what people get, a few photos, when and how much, and one button. Everything else gets in the way.",
      ],
      [
        "Can people pay on the page?",
        "Yes. A button can open your Stripe, PayPal or Eventbrite checkout.",
      ],
    ],
    byHand: [
      "Carrd is the quickest free one-page builder; Canva also makes simple one-page sites.",
      "Collect sign-ups with a free Google Form, Tally or Mailchimp form.",
      "Keep one main button, and repeat it at the bottom of the page.",
    ],
    related: [
      "websites/add-a-contact-form-to-your-website",
      "websites/make-a-website-without-coding",
      "websites/get-your-website-on-google",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "host-a-website-for-free",
    niche: "websites",
    searchPhrases: [
      "host website for free",
      "free website hosting",
      "how to put your html website online free",
      "host website for free github",
      "host website for free netlify",
    ],
    title: "Host a website for free and put it online",
    description:
      "Have the files for a site but it isn't online yet? Stella (stella.sh) puts it on GitHub Pages, Netlify or Cloudflare Pages for free and gives you the link.",
    h1: "Host a website for free",
    short: "Host a website for free",
    lede: "A site on your computer, online for anyone with the link.",
    answer:
      "GitHub Pages, Netlify and Cloudflare Pages host websites free. Stella (stella.sh) signs you in to one in your browser, uploads your site and sets it to update whenever you change something, then hands you the link.",
    gets: [
      "A free web address that works straight away",
      "The padlock in the address bar, set up for you",
      "Changes go live whenever you ask for one",
    ],
    prompt:
      "I have a website in a folder called my-site on my Desktop. Put it online for free so I can send people the link.",
    demo: {
      ack: "Sure. Having a look at the folder.",
      task: "Putting your site online",
      rows: [
        "Checking every page and picture links up",
        "Signing in to Cloudflare in your browser",
        "Uploading the site to Cloudflare Pages",
      ],
      reply:
        "Your site is live at **my-site-7ex.pages.dev**. Two pictures pointed at the wrong file, so I fixed those on the way. Ask for any change and the live site updates too.",
    },
    faq: [
      [
        "Which free website hosting is best?",
        "All three suit simple sites. GitHub Pages keeps every past version, Netlify adds free forms, and Cloudflare Pages is quick everywhere in the world.",
      ],
      [
        "Is free hosting enough for a business site?",
        "For a site with pages, photos and a contact form, yes. The free plans handle plenty of visitors.",
      ],
    ],
    byHand: [
      "Fastest: drag your folder onto [Netlify Drop](https://app.netlify.com/drop) for a live link.",
      "GitHub Pages: upload the files to a new GitHub project, then turn on Pages in its Settings.",
      "Your home page has to be named index.html.",
    ],
    related: [
      "websites/connect-a-domain-to-your-website",
      "websites/make-a-website-without-coding",
      "websites/move-your-website-off-wix-or-squarespace",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "connect-a-domain-to-your-website",
    niche: "websites",
    searchPhrases: [
      "how to connect domain to website",
      "connect godaddy domain to github pages",
      "connect namecheap domain to netlify",
      "connect squarespace domain to github pages",
      "point domain to cloudflare",
    ],
    title: "Connect a domain you bought to your website (GoDaddy, Namecheap)",
    description:
      "Bought a name on GoDaddy, Namecheap or Squarespace? Stella (stella.sh) sets the records in your account so the domain opens your site, with and without www.",
    h1: "Connect a domain you bought to your website",
    short: "Connect a domain to your website",
    lede: "The name you bought, opening your site, with the padlock on.",
    answer:
      "To connect a domain, you add a few records at the company you bought it from that point it at your host. Stella (stella.sh) does that in your signed-in browser, for both yourname.com and www, then checks it loads.",
    gets: [
      "Works with GoDaddy, Namecheap, Squarespace and others",
      "Both versions, with and without www",
      "Your email setup left as it is",
    ],
    prompt:
      "I bought bakerysmith.co.uk on GoDaddy. Make it open my website on Netlify instead of the GoDaddy parking page.",
    demo: {
      ack: "On it. Opening your GoDaddy account.",
      task: "Connecting bakerysmith.co.uk",
      rows: [
        "Adding the domain to your Netlify site",
        "Updating the records in GoDaddy",
        "Leaving your email records untouched",
        "Waiting for the padlock to turn on",
      ],
      reply:
        "Done. **bakerysmith.co.uk** and **www.bakerysmith.co.uk** both open your site now, with the padlock showing. Your GoDaddy email still works as before.",
    },
    faq: [
      [
        "How long does a new domain take to connect?",
        "Usually minutes, sometimes a few hours while the change spreads around the world. It keeps being checked until it loads.",
      ],
      [
        "Do I have to move my domain away from GoDaddy?",
        "No. It stays where you bought it; only where it points changes.",
      ],
    ],
    byHand: [
      "In your host, add your custom domain; it lists the records it needs.",
      "At GoDaddy or Namecheap, open the DNS settings and add those A and CNAME records.",
      "Delete the old parking page records, but leave the MX records (your email) alone.",
    ],
    related: [
      "websites/host-a-website-for-free",
      "websites/move-your-website-off-wix-or-squarespace",
      "websites/get-your-website-on-google",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "move-your-website-off-wix-or-squarespace",
    niche: "websites",
    searchPhrases: [
      "export wix website",
      "transfer wix website to another host",
      "move website from squarespace",
      "cancel squarespace but keep domain",
      "wix export website code",
    ],
    title: "Export your Wix or Squarespace website to a free host",
    description:
      "Wix has no export button and Squarespace's is partial. Stella (stella.sh) rebuilds your site from the live pages, puts it on a free host and moves your domain.",
    h1: "Export your Wix website and move it to a free host",
    short: "Move your site off Wix or Squarespace",
    lede: "The same site at the same address, off the monthly plan.",
    answer:
      "Wix has no export, and Squarespace's leaves out the design. Stella (stella.sh) copies your live site page by page, text and photos included, rebuilds it as files you own, hosts it free and points your domain there.",
    gets: [
      "Every page, photo and blog post brought over",
      "Same page addresses, so links from Google keep working",
      "Your domain pointed at the new site, email untouched",
    ],
    prompt:
      "Move my Wix website, www.greenleafyoga.com, somewhere free. Keep it looking the same and keep my domain, then I'll cancel Wix.",
    demo: {
      ack: "Sure. Reading through your site first.",
      task: "Moving Green Leaf Yoga off Wix",
      rows: [
        "Copying 9 pages and 41 photos",
        "Rebuilding the same look as plain files",
        "Putting it online on Cloudflare Pages",
        "Pointing greenleafyoga.com at the new site",
      ],
      reply:
        "Done. **greenleafyoga.com** now opens the new copy on Cloudflare Pages, with the same pages and photos. Look it over, then cancel your Wix plan; the domain itself can move to Cloudflare too.",
    },
    faq: [
      [
        "Can I cancel Squarespace but keep my domain?",
        "Yes. The domain is billed separately from the site plan, so you can cancel the site, keep the domain, or move it elsewhere.",
      ],
      [
        "What about my shop or class bookings?",
        "The new site can link to a free checkout or booking page, like Stripe payment links or Calendly.",
      ],
    ],
    byHand: [
      "Wix: copy each page's text and save its images by hand; there's no export.",
      "Squarespace's Export gives a WordPress file with pages and blog posts, without the design.",
      "Rebuild on a free host, then change your domain's records to point there.",
    ],
    related: [
      "websites/connect-a-domain-to-your-website",
      "websites/host-a-website-for-free",
      "websites/update-your-website-by-asking",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "add-a-contact-form-to-your-website",
    niche: "websites",
    searchPhrases: [
      "add contact form to website",
      "free contact form for static website",
      "add contact us form to website html",
      "free contact form for website",
      "contact form without backend",
    ],
    title: "Add a contact form to your website, free",
    description:
      "Want messages from your site straight to your inbox? Stella (stella.sh) adds a contact form that emails you every message, with spam blocked, and puts it live.",
    h1: "Add a contact form to your website",
    short: "Add a contact form to your website",
    lede: "Messages from your site, straight to your inbox.",
    answer:
      "A site made of plain files needs a free form service to pass messages on. Stella (stella.sh) adds the form, connects it to Netlify Forms or a service like Web3Forms, turns on spam blocking and sends a test to your inbox.",
    gets: [
      "Name, email and message, or whatever you need asked",
      "Every message emailed to you",
      "Spam bots filtered out",
    ],
    prompt:
      "Add a contact form to my website so people can ask for a quote. Name, phone, what they need, and send it to my Gmail.",
    demo: {
      ack: "Sure. Adding it to your contact page.",
      task: "Adding a quote form to your site",
      rows: [
        "Adding name, phone and job fields",
        "Connecting it to your Gmail",
        "Turning on spam blocking",
        "Sending a test message",
      ],
      reply:
        "Your quote form is live on the contact page. A test came through to your Gmail with the subject **New quote request**, and visitors see a thank-you note after sending.",
    },
    faq: [
      [
        "Can I add a contact form without a backend?",
        "Yes. A free form service receives the messages for you, so your site stays plain files on a free host.",
      ],
      [
        "Will I get spam through the form?",
        "Very little. A hidden trap field and a quiet check stop most bots without making visitors solve puzzles.",
      ],
    ],
    byHand: [
      "On Netlify, add data-netlify=\"true\" to your form tag and turn on email alerts under Forms.",
      "Elsewhere, Web3Forms and Formspree have free plans: point your form's action at their address.",
      "Add a hidden honeypot field to catch spam bots.",
    ],
    related: [
      "websites/make-a-small-business-website",
      "websites/make-a-landing-page",
      "websites/host-a-website-for-free",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "get-your-website-on-google",
    niche: "websites",
    searchPhrases: [
      "how to get my website on google search",
      "make my website show up on google",
      "submit website to google search console",
      "how to get your site indexed by google",
      "how to get my website higher on google",
    ],
    title: "Get your website on Google search (Search Console set up)",
    description:
      "Site doesn't come up on Google? Stella (stella.sh) adds proper titles and descriptions, sets up Search Console in your browser and asks Google to read every page.",
    h1: "Get your website on Google search",
    short: "Get your website on Google",
    lede: "From invisible to found when people search your name.",
    answer:
      "New sites can sit unseen for weeks. Stella (stella.sh) gives each page a clear title and description, makes a sitemap, adds your site to Google Search Console in your browser and asks Google to read every page.",
    gets: [
      "Your site added to Google Search Console",
      "Titles and descriptions people want to click",
      "A list of what's holding each page back",
    ],
    prompt:
      "My plumbing website hughesplumbing.co.uk doesn't show up on Google, even when I search my own business name. Get it showing.",
    demo: {
      ack: "On it. Seeing what Google sees first.",
      task: "Getting your site onto Google",
      rows: [
        "Writing a title and description for each page",
        "Making a sitemap of all six pages",
        "Proving you own the site in Search Console",
        "Asking Google to read every page",
      ],
      reply:
        "Done. Your site is in Search Console and all six pages are queued for Google to read. Each title now says what you do and where, like **Emergency Plumber in Swindon**.",
    },
    faq: [
      [
        "How long until Google finds a new website?",
        "Usually a few days to a couple of weeks once it's submitted in Search Console.",
      ],
      [
        "How do I show up on Google Maps?",
        "That's your free Google Business Profile, with your address and hours. It's set up in your browser and linked to your site.",
      ],
    ],
    byHand: [
      "Open [Search Console](https://search.google.com/search-console), add your domain and verify it with a DNS record.",
      "Submit your sitemap, then use URL inspection to request indexing of the home page.",
      "Give every page its own title saying what you do and where.",
    ],
    related: [
      "websites/make-a-small-business-website",
      "websites/connect-a-domain-to-your-website",
      "websites/update-your-website-by-asking",
    ],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "update-your-website-by-asking",
    niche: "websites",
    searchPhrases: [
      "how to edit text on my website",
      "edit my website with ai",
      "how to update my website on github",
      "how to update my website in netlify",
      "how to change pictures on my website",
    ],
    title: "Edit the text and photos on your website, just by asking",
    description:
      "New hours, a new photo, a fresh page? Tell Stella (stella.sh) what to change on your site and it edits the files and puts the update online for you.",
    h1: "Edit the text and photos on your website by asking",
    short: "Update your website by asking",
    lede: "New hours, new photos, new pages, without opening a builder.",
    answer:
      "No dashboard to learn. Say what's changing and Stella (stella.sh) finds it on your site, edits the words or swaps the photo, shows you, and puts the update online on GitHub Pages, Netlify or Cloudflare.",
    gets: [
      "Text, photos and whole pages changed in plain words",
      "A preview before it goes live",
      "Every past version kept, so any change can be undone",
    ],
    prompt:
      "On my salon website, change Saturday hours to 9 to 4, replace the team photo with team-2026.jpg from Downloads, and add Jess to the stylists.",
    demo: {
      ack: "Sure. Finding those three spots.",
      task: "Updating your salon website",
      rows: [
        "Changing Saturday to 9am to 4pm",
        "Swapping in the new team photo",
        "Adding Jess to the stylists page",
        "Publishing the update",
      ],
      reply:
        "All three changes are live. Saturday reads 9am to 4pm everywhere it appeared, the new team photo is on About, and Jess is on the stylists page. The old version is saved if you want it back.",
    },
    faq: [
      [
        "How do I update my website on GitHub?",
        "Change the files and upload them to GitHub, and GitHub Pages republishes the site. Stella does both, so you never open GitHub yourself.",
      ],
      [
        "Can it edit a site someone else made for me?",
        "Yes, when the site's files are in a GitHub, Netlify or Cloudflare account you can sign in to.",
      ],
    ],
    byHand: [
      "GitHub Pages: open the file on github.com, click the pencil, edit and commit.",
      "Netlify Drop sites: change the files, then drag the folder onto the site's Deploys page again.",
      "Keep new images about 2000 pixels wide or less before swapping them in.",
    ],
    related: [
      "websites/make-a-small-business-website",
      "websites/add-a-contact-form-to-your-website",
      "photos-files/resize-images-in-bulk",
    ],
    lastChecked: "2026-11-24",
  }),
];
