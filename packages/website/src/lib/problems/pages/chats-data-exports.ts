import { PROOFS, webCuts } from "../media";
import type { ProblemPage } from "../types";

const MODEL = "Claude Code with Opus, on a Claude plan";

export const CHATS_DATA_EXPORTS_PAGES: ProblemPage[] = [
  {
    slug: "export-whatsapp-chat-to-pdf",
    niche: "chats-data-exports",
    searchPhrases: [
      "export whatsapp chat to pdf",
      "whatsapp chat to pdf",
      "export whatsapp chat",
      "whatsapp chat to pdf with media",
      "whatsapp chat export viewer",
    ],
    title: "Export a WhatsApp chat to PDF, with the photos in place",
    description:
      "Turn a WhatsApp chat export (a zip of a .txt and photos) into a readable PDF with names, dates and pictures where they were sent, by hand or with Stella (stella.sh).",
    h1: "Export a WhatsApp chat to PDF with the photos",
    short: "WhatsApp chat to PDF",
    lede: "A group chat's export zip as a dated, readable PDF, photos where they were posted.",
    answer:
      "In WhatsApp on your phone, open the chat, choose Export chat from its menu and include media: you get a zip with a plain .txt of the messages and the photos as separate files. There's no built-in way to make that a PDF with the pictures in it; by hand you paste the photos into a Word document at each “file attached” line. Stella (stella.sh) builds the PDF from the zip on your computer, messages in order with names and dates, photos where they were posted, without uploading the chat to a converter site.",
    stellaSteps: [
      "Opens the WhatsApp export zip in Downloads: the chat's .txt, seven photos, a route-map PDF and a voice note",
      "Reads every message in order, keeping the extra lines of multi-line messages with their message, and skipping the encryption notice and other system lines",
      "Lays the chat out with a cover page, a date heading for each day, the sender's name on each message and the photos shown where they were sent",
      "Puts a short note where something can't go on paper: the voice note, the route-map PDF and an item WhatsApp left out of the export",
      "Saves `Trailblazers Hiking Club - WhatsApp chat.pdf` next to the zip and suggests keeping the zip for the audio and the map",
    ],
    prompt:
      "I exported our hiking group's WhatsApp chat, it's the zip in my Downloads. Turn it into a nice readable PDF with the photos in it so I can keep it.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "A 7-page PDF in about a minute and a half. Checked afterwards against an answer key written before the run: every message in it, in the original order, each with its sender's name, multi-line messages kept whole, all 7 photos in the PDF as pictures, and no bare “file attached” file names left in their place.",
      note: "The group, its members and photos are made up, written in WhatsApp's Android export format. The work is sped up 7×.",
      video: {
        src: `${PROOFS}/chats-data-exports/export-whatsapp-chat-to-pdf/proof.mp4`,
        cuts: webCuts("chats-data-exports/export-whatsapp-chat-to-pdf"),
        poster: `${PROOFS}/chats-data-exports/export-whatsapp-chat-to-pdf/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 43,
        realDuration: 127,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A WhatsApp group chat export, a zip, is in Downloads." },
        { at: 2.1, text: "The prompt: a readable PDF of the chat with the photos in it." },
        { at: 11.7, text: "Stella replies: messages in order with names and dates, photos where they were posted." },
        { at: 17.6, text: "Reading the chat and laying out the pages, sped up 7×." },
        { at: 29.1, text: "Done: 7 pages from March 6 to April 8, all 7 photos, and notes for what couldn't go on paper." },
      ],
    },
    manualTitle: "Make the PDF yourself",
    manualSteps: [
      {
        title: "Export the chat from your phone",
        body: "Open the chat in WhatsApp. On Android, tap the three dots, More, Export chat; on an iPhone, tap the group or contact name at the top, then Export Chat. Choose Include media (Attach Media) to get the photos, and save the zip to your files or email it to yourself.",
      },
      {
        title: "Unzip it on your computer",
        body: "You get `_chat.txt` (or a .txt named after the chat) and one file per photo, video or voice note. Each message line starts with a date, time and the sender's name.",
      },
      {
        title: "Text only: print the .txt",
        body: "Open the .txt in TextEdit (File, Export as PDF) or Notepad (Print, Microsoft Print to PDF). That's quick, but photos appear only as file names such as `IMG-20260308-WA0003.jpg (file attached)`.",
      },
      {
        title: "With photos: build it in Word or Pages",
        body: "Paste the text into a document, then at each “file attached” line insert the matching photo (Insert, Pictures) and delete the file name. Save as PDF when done. For a long chat this is the slow part.",
      },
    ],
    limits: [
      "Voice notes and videos can't play on paper. Stella put a note in their place and the files stay in the zip.",
      "Stella works with the export you make on your phone; it can't reach WhatsApp or your phone itself. Disappearing and view-once messages aren't in exports at all.",
      "The chat text goes to the AI model you use in Stella while it lays out the PDF. Nothing is uploaded to a converter site.",
      "Some emoji may come out as plain symbols, depending on the fonts on your computer.",
      "Recorded on Linux. On a Mac or Windows PC Stella may first install Python or a PDF library, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I export a WhatsApp chat with photos?",
        a: "In the chat's menu choose Export chat and pick Include media. WhatsApp makes a zip of the text and the media files and lets you share or save it. Very long chats may be cut short when media is included.",
      },
      {
        q: "Can I export a WhatsApp chat straight to PDF?",
        a: "No. WhatsApp only exports a text file plus media. Making a PDF with the pictures in place takes a word processor and some copying, or a tool such as Stella.",
      },
      {
        q: "Can it do a Messenger chat too?",
        a: "Yes, from your Facebook data download: see [read Facebook messages from your data download](/how/chats-data-exports/read-facebook-messages-from-data-download).",
      },
      {
        q: "Can I keep emails the same way?",
        a: "Yes: see [convert EML to PDF](/how/contacts-calendar-email/convert-eml-to-pdf), and [open an mbox file](/how/contacts-calendar-email/open-mbox-file) for a whole mailbox download.",
      },
    ],
    related: [
      "chats-data-exports/read-facebook-messages-from-data-download",
      "contacts-calendar-email/convert-eml-to-pdf",
      "photos-files/combine-photos-into-one-pdf",
    ],
    lastChecked: "2026-11-14",
    sources: [{ label: "WhatsApp Help: How to export your chat history", href: "https://faq.whatsapp.com/1180414079177245" }],
  },
  {
    slug: "read-facebook-messages-from-data-download",
    niche: "chats-data-exports",
    searchPhrases: [
      "read facebook messages from data download",
      "facebook messages download",
      "facebook data download",
      "facebook messenger json viewer",
      "facebook messages json to pdf",
    ],
    title: "Read Facebook messages from your data download, as a PDF",
    description:
      "Turn a Messenger conversation from your Facebook data download into a readable PDF: oldest first, accents and emoji fixed, photos in, with Stella (stella.sh) or by hand.",
    h1: "Read your Facebook messages from the data download",
    short: "Facebook messages from a download",
    lede: "One Messenger conversation from a Facebook data zip as a readable PDF, oldest first.",
    answer:
      "If you only want to read the messages, request the download in HTML format and open `message_1.html` in a browser; newer messages are in the first file. The JSON format is better for keeping, but it writes accented letters and emoji as garbled pairs (`cafÃ©`), lists newest first and splits long chats into several files. Stella (stella.sh) turns one conversation from either into a PDF on your computer: oldest message first, characters fixed and photos where they were sent.",
    stellaSteps: [
      "Opens the Facebook data zip in Downloads and finds the conversation with the person you named, split over two message files",
      "Puts both files together and turns the order round so the oldest message comes first",
      "Fixes the garbled encoding Facebook uses, so café, Zoë, São Paulo, crème brûlée, € and emoji read right",
      "Lays it out as chat bubbles grouped by day, each with sender and time, and the five photos where they were sent",
      "Leaves a book-club group chat in the same download out, saves `Messenger - Sam Rivera.pdf` and leaves the zip untouched",
    ],
    prompt:
      "I downloaded my Facebook data, it's the zip in my Downloads. Turn my Messenger conversation with Sam Rivera into a readable PDF, oldest message first, with the photos in it.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "An 8-page PDF in about a minute. Checked afterwards against an answer key written before the run: every message from both export files, oldest first all the way through, no garbled characters, accented words reading right, all 5 photos in the PDF, and the group chat not mixed in.",
      note: "The people, messages and photos are made up, written in the JSON layout of Facebook's download, including its broken character encoding. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/chats-data-exports/read-facebook-messages-from-data-download/proof.mp4`,
        cuts: webCuts("chats-data-exports/read-facebook-messages-from-data-download"),
        poster: `${PROOFS}/chats-data-exports/read-facebook-messages-from-data-download/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 45.7,
        realDuration: 99,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A Facebook data download zip is in Downloads." },
        { at: 2, text: "The prompt: one Messenger conversation as a readable PDF, oldest first, with the photos." },
        { at: 13.2, text: "Stella replies: it will find the chat in the zip and lay it out oldest first." },
        { at: 19.1, text: "Reading the message files, sped up 4×." },
        { at: 31.7, text: "Done: 52 messages over 8 pages, all 5 photos, and the garbled accents and emoji fixed." },
      ],
    },
    manualTitle: "Read them yourself",
    manualSteps: [
      {
        title: "Request your messages",
        body: "On Facebook, open Settings, Accounts Center, Your information and permissions, Download your information. Pick your profile, choose specific types of information, tick Messages, and set the format to HTML if you only want to read them (JSON for tools), date range All time. Facebook emails you when the files are ready.",
      },
      {
        title: "Find the conversation",
        body: "Unzip the download and open `your_facebook_activity/messages/inbox/`. Each conversation has a folder named after the person, with `message_1`, `message_2` and so on, plus a photos folder.",
      },
      {
        title: "Read the HTML in a browser",
        body: "Open `message_1.html` in Safari, Chrome or Edge. It holds the newest messages; older ones continue in `message_2.html`. Print each to PDF if you want to keep it.",
      },
      {
        title: "If you only have JSON",
        body: "The JSON files aren't meant to be read directly, and accents show garbled. Either request the download again in HTML, or use a tool that re-reads the text as UTF-8.",
      },
    ],
    limits: [
      "End-to-end encrypted Messenger chats are stored separately and may not be in the Facebook download; Messenger has its own option for downloading those.",
      "You request the download from Facebook yourself; Stella works on the zip after it arrives and doesn't log in to your account.",
      "The messages Stella reads go to the AI model you use in Stella while it builds the PDF.",
      "Stella showed times in the computer's time zone. If the chat happened somewhere else, say which time zone you want.",
      "Recorded on Linux. On a Mac or Windows PC Stella may first install Python or a PDF library, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why do my Facebook messages show strange characters like Ã©?",
        a: "Facebook's JSON writes each byte of an accented letter or emoji as its own character, so é becomes Ã© and emoji become runs like ðŸ˜‚. Reading the text back as UTF-8 fixes it; the HTML format doesn't have the problem.",
      },
      {
        q: "Why are my messages in the wrong order?",
        a: "The download puts the newest messages first, and `message_1` holds the newest part of a long chat. Read the files backwards, or let Stella merge them oldest first.",
      },
      {
        q: "How long does Facebook take to prepare the download?",
        a: "Usually from minutes to a few days, depending on how much you asked for. Asking for Messages only is faster than everything.",
      },
      {
        q: "Can it do WhatsApp or Instagram data too?",
        a: "Yes: see [export a WhatsApp chat to PDF](/how/chats-data-exports/export-whatsapp-chat-to-pdf) and [see who doesn't follow you back on Instagram](/how/chats-data-exports/see-who-doesnt-follow-you-back-on-instagram).",
      },
    ],
    related: [
      "chats-data-exports/export-whatsapp-chat-to-pdf",
      "chats-data-exports/see-who-doesnt-follow-you-back-on-instagram",
      "contacts-calendar-email/open-mbox-file",
    ],
    lastChecked: "2026-11-14",
    sources: [{ label: "Facebook Help: Download a copy of your information", href: "https://www.facebook.com/help/212802592074644" }],
  },
  {
    slug: "see-who-doesnt-follow-you-back-on-instagram",
    niche: "chats-data-exports",
    searchPhrases: [
      "see who doesn't follow you back on instagram",
      "who doesn't follow me back on instagram",
      "see who unfollowed you on instagram",
      "instagram followers not following back",
      "instagram data download followers",
    ],
    title: "See who doesn't follow you back on Instagram, without an app",
    description:
      "Use Instagram's own data download to list who you follow that doesn't follow you back. No unfollower app, no password shared. By hand, or Stella (stella.sh).",
    h1: "See who doesn't follow you back on Instagram",
    short: "Who doesn't follow you back",
    lede: "Your Instagram data download, checked: everyone you follow who doesn't follow back.",
    answer:
      "Request your data from Instagram's Accounts Center, choosing Followers and following in JSON format. The zip has the people you follow in `following.json` and your followers split across `followers_1.json`, `followers_2.json` and so on; anyone in the first and in none of the others doesn't follow you back. Stella (stella.sh) does the comparison on your computer from the zip and saves the list, so you never give your Instagram password to an unfollower app or site.",
    stellaSteps: [
      "Opens the Instagram data zip in Downloads and finds the followers-and-following folder",
      "Reads the 380 accounts followed, including the newer layout where the username sits in a `title` field",
      "Reads followers from both followers files, 1,288 in all, not just the first one",
      "Lists the 52 accounts that don't follow back, alphabetically, with a link to each profile",
      "Leaves out six follow requests still waiting, and saves `instagram-not-following-back.txt` in Downloads",
    ],
    prompt:
      "I downloaded my Instagram data, it's the zip in my Downloads. Who do I follow that doesn't follow me back? Save the list as a file.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "Under a minute. Checked afterwards against an answer key written before the run: all 52 accounts that don't follow back listed, none of the people who do (including those only in the second followers file), not the reverse list, and pending requests and recently unfollowed accounts not mixed in.",
      note: "The account and every username are made up, written in the layout of Instagram's download. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/chats-data-exports/see-who-doesnt-follow-you-back-on-instagram/proof.mp4`,
        cuts: webCuts("chats-data-exports/see-who-doesnt-follow-you-back-on-instagram"),
        poster: `${PROOFS}/chats-data-exports/see-who-doesnt-follow-you-back-on-instagram/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 42.1,
        realDuration: 76,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. An Instagram data download zip is in Downloads." },
        { at: 2, text: "The prompt: who I follow that doesn't follow me back, saved as a file." },
        { at: 12.9, text: "Stella replies: it will compare following against followers and save the list." },
        { at: 18.8, text: "Comparing the lists, sped up 3×." },
        { at: 28.2, text: "Done: 52 of 380 accounts don't follow back, saved with profile links; pending requests left out." },
      ],
    },
    manualTitle: "Compare the lists yourself",
    manualSteps: [
      {
        title: "Request your followers data",
        body: "In the Instagram app: your profile, the menu, Accounts Center, Your information and permissions, Download your information. Choose some of your information, tick Followers and following, then format JSON and date range All time. Instagram emails you when it's ready, usually within a day or two.",
      },
      {
        title: "Find the two lists",
        body: "Unzip the download and open `connections/followers_and_following/`. `following.json` is who you follow; `followers_1.json`, `followers_2.json` and so on are your followers. Large accounts get several followers files.",
      },
      {
        title: "Put both into a spreadsheet",
        body: "Windows Excel: Data, Get Data, From File, From JSON, once for following.json and once for each followers file; expand the lists so each username is a row. In newer downloads the username of people you follow is in `title`, not `value`.",
      },
      {
        title: "Find who's missing",
        body: "Append the followers files into one query, then Merge Queries with following.json on the username using a Left Anti join. The rows left are the accounts that don't follow you back. In Numbers or Google Sheets, a lookup column (`MATCH` or `XLOOKUP`) does the same.",
      },
    ],
    limits: [
      "The list is as of the day you requested the download. It doesn't update, and it can't say when someone unfollowed.",
      "Stella doesn't log in to Instagram or unfollow anyone for you; you request the data and act on the list yourself.",
      "Usernames from the download go to the AI model you use in Stella while it compares them.",
      "Recorded on Linux, where Stella used Python, built in on Mac and Linux. On Windows it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Are unfollower apps safe?",
        a: "Many ask for your Instagram password or a login session, which breaks Instagram's terms and can get an account flagged. The data download needs no third party at all.",
      },
      {
        q: "Can I see who unfollowed me?",
        a: "Not from one download: it only shows who follows you now. Compare two downloads taken at different times to see who dropped off.",
      },
      {
        q: "Why do some unfollower scripts show empty names?",
        a: "Since 2024 the download stores the usernames of people you follow in a `title` field instead of `value`, so older scripts read blanks. Scripts that only read `followers_1.json` also miss everyone in the later followers files.",
      },
      {
        q: "What else can I do with my data downloads?",
        a: "Read old Messenger chats: see [read Facebook messages from your data download](/how/chats-data-exports/read-facebook-messages-from-data-download), or your all-time music stats in [see your Spotify listening history](/how/chats-data-exports/see-your-spotify-listening-history).",
      },
    ],
    related: [
      "chats-data-exports/read-facebook-messages-from-data-download",
      "chats-data-exports/see-your-spotify-listening-history",
      "photos-files/fix-google-takeout-photo-dates",
    ],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Instagram Help: Download a copy of your information", href: "https://help.instagram.com/181231772500920" },
      {
        label: "Unfollowtool: Instagram export files explained",
        href: "https://www.unfollowtool.com/blog/instagram-data-export-files-explained.html",
      },
    ],
  },
  {
    slug: "see-your-spotify-listening-history",
    niche: "chats-data-exports",
    searchPhrases: [
      "see your spotify listening history",
      "spotify listening history",
      "spotify extended streaming history",
      "spotify data export",
      "spotify all time top artists",
    ],
    title: "See your Spotify listening history: all-time top artists, songs",
    description:
      "Use Spotify's extended streaming history to find your all-time top artists and songs by time listened, and hours per year. In Excel, or with Stella (stella.sh).",
    h1: "See your Spotify listening history, all time",
    short: "Spotify listening history",
    lede: "Years of plays from a Spotify data download as top 10s by time and hours per year.",
    answer:
      "Request Extended streaming history from Spotify's account privacy page. It can take up to 30 days, and arrives as JSON files with one entry per play: when, what, and how many milliseconds you listened. Add up the time per artist and per song across every file, leaving podcasts out, and divide by 3,600,000 for hours. Stella (stella.sh) does that from the zip on your computer and saves the results, ranked by time listened rather than play count.",
    stellaSteps: [
      "Opens `my_spotify_data.zip` in Downloads and reads all three streaming history files, 18,131 plays from March 2023 to October 2026",
      "Adds up time listened per artist and per song, keeping podcast episodes out of both top 10s",
      "Ranks by time, so a song played thousands of times but skipped after seconds doesn't top the list",
      "Keeps two different songs with the same title by different artists apart",
      "Works out hours per year, all listening and music only, and saves `spotify_listening_stats.md` next to the zip",
    ],
    prompt:
      "I got my full listening history from Spotify, it's the zip in my Downloads. What are my top 10 artists and top 10 songs of all time by time listened, and how many hours did I listen each year? Save it as a file.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: MODEL,
      result:
        "About 2 minutes. Checked afterwards against an answer key written before the run: the top 10 artists by time in the right order with no podcast among them, the top 10 songs by time in the right order (not by play count, same-name songs kept apart), and hours listened right for each year from 2023 to 2026.",
      note: "The artists, songs and podcasts are made up, written in the format Spotify documents for its extended history. The work is sped up 9×.",
      video: {
        src: `${PROOFS}/chats-data-exports/see-your-spotify-listening-history/proof.mp4`,
        cuts: webCuts("chats-data-exports/see-your-spotify-listening-history"),
        poster: `${PROOFS}/chats-data-exports/see-your-spotify-listening-history/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 48.8,
        realDuration: 160,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A Spotify extended streaming history zip is in Downloads." },
        { at: 2, text: "The prompt: all-time top 10 artists and songs by time listened, and hours per year." },
        { at: 16.5, text: "Stella replies: it will work through the history and save the results next to the zip." },
        { at: 22.3, text: "Adding up 18,131 plays, sped up 9×." },
        { at: 34.9, text: "Done: about 1,025 hours since 2023, top 10s by time, podcasts counted separately." },
      ],
    },
    manualTitle: "Work it out yourself",
    manualSteps: [
      {
        title: "Request the extended history",
        body: "Sign in at spotify.com, open your account, then Account privacy. Tick Extended streaming history (the basic Account data only covers the last year) and confirm the email. Spotify says it can take up to 30 days.",
      },
      {
        title: "Load the files into Excel",
        body: "Unzip the download. In Excel, Data, Get Data, From File, From Folder, pick the extended history folder and combine the `Streaming_History_Audio` JSON files. Each row is one play.",
      },
      {
        title: "Leave podcasts out",
        body: "Filter out rows where `master_metadata_album_artist_name` is empty: those are podcast episodes and audiobooks, which have their own episode fields.",
      },
      {
        title: "Group by artist and by song",
        body: "Use Group By on the artist column with Sum of `ms_played`, then again on artist plus `master_metadata_track_name` together, so same-name songs by different artists stay apart. Divide by 3,600,000 for hours and sort.",
      },
      {
        title: "Hours per year",
        body: "Add a column with the year from `ts` (the time the play ended, in UTC) and sum `ms_played` per year.",
      },
    ],
    limits: [
      "Spotify Wrapped uses its own rules and dates, so these all-time numbers won't match a Wrapped exactly.",
      "Times in the history are in UTC, so a play just after midnight can land in the neighbouring day or year.",
      "You request the history from Spotify yourself and it can take weeks; Stella doesn't log in to your account.",
      "The play history goes to the AI model you use in Stella while it adds up the numbers.",
      "Recorded on Linux, where Stella used Python, built in on Mac and Linux. On Windows it may install Python first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I see my Spotify listening history from all time?",
        a: "The app shows only recent plays. For everything since you joined, request Extended streaming history from your account's privacy page and wait for the email.",
      },
      {
        q: "What's the difference between Account data and Extended streaming history?",
        a: "Account data covers about the last year with less detail. Extended streaming history goes back to when you started, with one entry per play including how long you listened.",
      },
      {
        q: "Why rank by time instead of plays?",
        a: "Skips count as plays. A song you skip every day after three seconds can have more plays than your real favourite. Time listened shows what you actually played.",
      },
      {
        q: "What else can I get from my data downloads?",
        a: "See [see who doesn't follow you back on Instagram](/how/chats-data-exports/see-who-doesnt-follow-you-back-on-instagram), or for books, [export Kindle highlights](/how/study/export-kindle-highlights).",
      },
    ],
    related: [
      "chats-data-exports/see-who-doesnt-follow-you-back-on-instagram",
      "study/export-kindle-highlights",
      "money-household/how-much-have-i-spent-on-amazon",
    ],
    lastChecked: "2026-11-14",
    sources: [{ label: "Spotify Support: Understanding my data", href: "https://support.spotify.com/us/article/understanding-my-data/" }],
  },
];
