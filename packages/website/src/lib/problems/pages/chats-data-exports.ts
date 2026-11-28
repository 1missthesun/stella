import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const CHATS_DATA_EXPORTS_PAGES: ProblemPage[] = [
  shortGuide({
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
      "Export a WhatsApp chat to PDF with the photos where they were posted and every name and date kept. Stella (stella.sh) builds it from your chat export.",
    h1: "Export a WhatsApp chat to PDF with the photos",
    short: "WhatsApp chat to PDF",
    lede: "Keep a WhatsApp chat as a PDF, with the photos in place",
    answer:
      "Export the chat from WhatsApp with media, then ask Stella (stella.sh) to make it a PDF: every message in order, with names, dates and photos where they were sent.",
    gets: ["A readable PDF of the whole chat", "A heading for each day", "Photos right where they were sent"],
    prompt:
      "I exported our hiking group's WhatsApp chat to my Downloads. Turn it into a nice PDF with the photos in it so we can keep it.",
    demo: {
      ack: "Lovely. Laying out the chat now.",
      task: "Hiking group chat as a PDF",
      rows: ["Reading the messages in order", "Adding the seven photos"],
      reply:
        "Done. It's a 7-page PDF next to the export, every message with its name and date, all 7 photos where they were posted.",
      files: ["Trailblazers Hiking Club - WhatsApp chat.pdf"],
    },
    faq: [
      ["How do I export a WhatsApp chat with photos?", "In the chat's menu choose Export chat, then Include media. You get a zip with the messages and photos."],
    ],
    byHand: [
      "Android: open the chat, three dots, More, Export chat. iPhone: tap the chat name, then Export Chat.",
      "For text only, open the .txt file and print it to PDF. Photos appear as file names.",
      "With photos, paste the text into Word, insert each picture at its “file attached” line, then save as PDF.",
    ],
    related: [
      "chats-data-exports/read-facebook-messages-from-data-download",
      "contacts-calendar-email/convert-eml-to-pdf",
      "photos-files/combine-photos-into-one-pdf",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "Read a Messenger conversation from your Facebook data download as one tidy PDF, oldest message first, photos included. Stella (stella.sh) puts it together.",
    h1: "Read your Facebook messages from the data download",
    short: "Facebook messages from a download",
    lede: "Read your old Messenger chats as a tidy PDF, oldest first",
    answer:
      "Ask Stella (stella.sh) to turn a chat from your Facebook data download into a PDF. It puts messages oldest first, fixes garbled accents and emoji, and places each photo where it was sent.",
    gets: [
      "One PDF of the whole conversation",
      "Oldest message first, grouped by day",
      "Accents and emoji that read properly",
    ],
    prompt:
      "I downloaded my Facebook data. Make my Messenger chat with Sam Rivera into a PDF I can read, oldest message first, with the photos.",
    demo: {
      ack: "Sure. Finding your chat with Sam.",
      task: "Messenger chat with Sam as a PDF",
      rows: ["Putting messages oldest first", "Fixing the garbled accents"],
      reply:
        "Done. **Messenger - Sam Rivera.pdf** is in your Downloads: 8 pages, oldest first, all 5 photos in place.",
      files: ["Messenger - Sam Rivera.pdf"],
    },
    faq: [
      ["Where is message_1.html in my Facebook download?", "In your_facebook_activity/messages/inbox, in a folder named after the person. It holds the newest messages; older ones continue in message_2.html."],
      ["Why do my messages show strange characters like Ã©?", "That happens in the JSON version of the download. Stella fixes it, or request the download again in HTML."],
      ["Why is a Messenger chat missing?", "End-to-end encrypted chats aren't in the Facebook download. Messenger's privacy settings let you download those separately."],
    ],
    byHand: [
      "Facebook Settings, Accounts Center, Your information and permissions, Download your information. Tick Messages, format HTML, All time.",
      "Unzip it and open your_facebook_activity/messages. your_messages.html or a chat's message_1.html opens in any browser.",
      "Print each page to PDF to keep it.",
    ],
    related: [
      "chats-data-exports/export-whatsapp-chat-to-pdf",
      "chats-data-exports/see-who-doesnt-follow-you-back-on-instagram",
      "contacts-calendar-email/open-mbox-file",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
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
      "See who doesn't follow you back on Instagram without an unfollower app. Stella (stella.sh) gets your followers data in your own browser and compares the lists.",
    h1: "See who doesn't follow you back on Instagram",
    short: "Who doesn't follow you back",
    lede: "Find the people you follow who don't follow you back",
    answer:
      "Ask Stella (stella.sh). It requests your followers data from Instagram in the browser you're signed in to, downloads the zip when it's ready and compares both lists on your computer. No unfollower app gets your password.",
    gets: [
      "Your Instagram data requested and downloaded for you",
      "Everyone who doesn't follow back, A to Z",
      "A link to each profile",
      "Waiting follow requests kept off the list",
    ],
    prompt:
      "Get my followers data from Instagram, then tell me who I follow that doesn't follow me back. Save the names in a file.",
    demo: {
      ack: "On it. Asking Instagram for your data first.",
      task: "Who doesn't follow you back",
      rows: ["Requesting your data from Instagram", "Downloading the zip when it's ready", "Comparing 380 follows with 1,288 followers"],
      reply:
        "**52 accounts** you follow don't follow you back. The list is in your Downloads, A to Z, with a link to each profile.",
      files: ["instagram-not-following-back.txt"],
    },
    faq: [
      ["How long does Instagram take to send the data?", "Minutes, sometimes hours. Stella waits and downloads it when it's ready."],
      ["I already downloaded my data.", "Tell Stella where the zip is and it goes straight to comparing."],
      ["How do I see who unfollowed me on Instagram without an app?", "Download your followers now and again later. Anyone in the older list but missing from the newer one has unfollowed you."],
    ],
    byHand: [
      "Instagram profile, menu, Accounts Center, Your information and permissions, Download your information. Pick Followers and following, JSON, All time.",
      "Unzip it and open connections/followers_and_following.",
      "In Google Sheets, look up each name in following.json among all the followers_*.json files. Names not found don't follow back.",
    ],
    related: [
      "chats-data-exports/read-facebook-messages-from-data-download",
      "chats-data-exports/see-your-spotify-listening-history",
      "photos-files/fix-google-takeout-photo-dates",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-27",
  }),
  shortGuide({
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
      "See your Spotify listening history from all time: your top 10 artists and songs by time listened, plus hours per year. Stella (stella.sh) adds it all up.",
    h1: "See your Spotify listening history, all time",
    short: "Spotify listening history",
    lede: "Your top artists, songs and hours listened since day one",
    answer:
      "Request your Extended streaming history from Spotify, then give the download to Stella (stella.sh). It adds up every play since you joined: top artists, top songs and hours each year.",
    gets: [
      "Top 10 artists and songs of all time",
      "Ranked by time listened, so skips don't count",
      "Hours listened in each year",
    ],
    prompt:
      "I got my full listening history from Spotify. What are my top 10 artists and songs of all time, and how many hours did I listen each year?",
    demo: {
      ack: "Nice. Adding up your plays now.",
      task: "Your all-time Spotify stats",
      rows: ["Reading 18,131 plays since 2023", "Leaving the podcasts out"],
      reply:
        "Your **top 10 artists** and **top 10 songs** by time listened, plus hours for each year from 2023 to 2026, are saved next to the download.",
      files: ["spotify_listening_stats.md"],
    },
    faq: [
      ["How do I request Extended streaming history on Spotify?", "At spotify.com open Account privacy, tick Extended streaming history and confirm the email. It can take up to 30 days."],
      ["Why don't the numbers match Spotify Wrapped?", "Wrapped covers part of one year. This counts every play since you joined."],
    ],
    byHand: [
      "The app only shows recent plays. Account data covers about a year; Extended streaming history covers everything.",
      "In Excel, Data, Get Data, From Folder, and combine the Streaming_History_Audio files.",
      "Drop rows with no artist (podcasts), sum ms_played per artist and song, and divide by 3,600,000 for hours.",
    ],
    related: [
      "chats-data-exports/see-who-doesnt-follow-you-back-on-instagram",
      "study/export-kindle-highlights",
      "money-household/how-much-have-i-spent-on-amazon",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
