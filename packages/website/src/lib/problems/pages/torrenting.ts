import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const TORRENTING_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "set-up-qbittorrent",
    niche: "torrenting",
    searchPhrases: [
      "how to torrent",
      "how to use qbittorrent",
      "best torrent client",
      "how to use qbittorrent to download",
      "how to torrent on mac",
      "how to torrent safely",
    ],
    title: "How to torrent with qBittorrent: set up, download, verify",
    description:
      "Want to start torrenting without learning how? Ask Stella (stella.sh). It sets up qBittorrent on your computer, downloads what you want and shows you where the file is.",
    h1: "How to torrent with qBittorrent",
    short: "Set up qBittorrent and download a torrent",
    lede: "A torrent app set up for you, and your first download done.",
    answer:
      "The easiest way to torrent is to ask. Stella (stella.sh) installs qBittorrent, the free torrent app, sets it up sensibly and downloads the file you want.",
    gets: [
      "qBittorrent installed, with the settings already done",
      "Your download finished and checked",
      "The folder it's in, one click away",
    ],
    prompt:
      "Set up qBittorrent for me with good settings, then use it to download the latest Debian and tell me where the file is.",
    demo: {
      ack: "On it. Installing qBittorrent first.",
      task: "Setting up qBittorrent",
      rows: ["Installing qBittorrent", "Downloading Debian 13.8", "Making sure it's the genuine file"],
      reply:
        "Done. Debian 13.8.0 is in your **Downloads** folder, and it's the genuine file. qBittorrent stops sharing it once you've given back one full copy.",
      files: ["debian-13.8.0-amd64-netinst.iso"],
    },
    faq: [
      ["What is the best torrent client?", "qBittorrent, for most people: free, no ads, and the same on Windows, Mac and Linux."],
      ["How do I torrent safely?", "Take the torrent from the publisher's own site and check the finished file is genuine. Stella does both."],
    ],
    byHand: [
      "Install qBittorrent from [qbittorrent.org](https://www.qbittorrent.org/download): the installer on Windows, the .dmg on a Mac.",
      "In Tools → Options, pick a save folder, and under BitTorrent stop seeding at ratio 1.00.",
      "Open the .torrent with File → Add Torrent File, or paste a magnet link in Add Torrent Link. It's done when it says Seeding.",
    ],
    related: ["torrenting/fix-qbittorrent-stalled", "torrenting/speed-up-qbittorrent", "torrenting/create-a-torrent-file"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "fix-qbittorrent-stalled",
    niche: "torrenting",
    searchPhrases: [
      "qbittorrent stalled",
      "qbittorrent not downloading",
      "torrent stuck",
      "qbittorrent stalled downloading metadata",
      "qbittorrent stalled at 0",
      "how to fix qbittorrent stalled",
    ],
    title: "qBittorrent stalled and not downloading: find and fix the cause",
    description:
      "Downloads stuck on “stalled”? Ask Stella (stella.sh). It finds out why qBittorrent isn't downloading, fixes it on your computer and lets everything finish.",
    h1: "qBittorrent stalled and not downloading",
    short: "Fix stalled qBittorrent downloads",
    lede: "Stuck downloads moving again, without touching a setting yourself.",
    answer:
      "When qBittorrent says stalled, something is blocking the download. Stella (stella.sh) finds what it is on your computer, fixes it and gets your torrents moving again.",
    gets: [
      "The reason your downloads stopped, in plain words",
      "Everything fixed and downloading",
      "A short list of what was wrong",
    ],
    prompt:
      "All my downloads in qBittorrent say stalled and never start. Find out why, fix it so they finish, and tell me what was wrong.",
    demo: {
      ack: "On it. Looking at why nothing is moving.",
      task: "Fixing stalled downloads",
      rows: [
        "Going through qBittorrent's settings",
        "Fixing four things in the way",
        "Waiting for the downloads to finish",
      ],
      reply:
        "All three downloads finished. What was wrong:\n- A block list that blocked everyone\n- Your seed box on the banned list\n- One download using an old address\n- Encryption set to Require, now Allow",
    },
    faq: [
      ["Why is qBittorrent stuck on downloading metadata?", "It hasn't found anyone to get the file list from yet. Stella turns on what helps it look, or uses the torrent file."],
      ["Will I lose what's already downloaded?", "No. The downloads carry on from where they were."],
    ],
    byHand: [
      "Click the stuck download, open the Trackers tab and read the message. In Seeds, 0 (0) means nobody with the whole file is online.",
      "In Tools → Options → Connection, switch off IP filtering for a moment and check the banned list.",
      "Under BitTorrent, choose Allow encryption. With a VPN, check Advanced → Network interface names the one that's running.",
    ],
    related: [
      "torrenting/speed-up-qbittorrent",
      "torrenting/set-up-qbittorrent",
      "torrenting/convert-magnet-link-to-torrent-file",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "speed-up-qbittorrent",
    niche: "torrenting",
    searchPhrases: [
      "qbittorrent slow download speed",
      "qbittorrent settings for faster download",
      "qbittorrent slow download",
      "qbittorrent slow download fix",
      "speed up qbittorrent",
    ],
    title: "qBittorrent slow download speed: find the limit and remove it",
    description:
      "qBittorrent crawling? Ask Stella (stella.sh) to find what's slowing it down. It fixes it on your computer and tells you the speed before and after.",
    h1: "qBittorrent slow download speed",
    short: "Speed up qBittorrent downloads",
    lede: "Slow downloads back to full speed.",
    answer:
      "A slow qBittorrent is usually held back by its own speed limits, often more than one. Stella (stella.sh) finds them on your computer and lifts them.",
    gets: ["What was slowing it down", "It fixed, and your download finished", "The speed before and after"],
    prompt:
      "qBittorrent downloads way too slowly. Find what's slowing it down, fix it and tell me the speed before and after.",
    demo: {
      ack: "On it. Measuring the speed before I change anything.",
      task: "Speeding up qBittorrent",
      rows: ["Measuring today's speed", "Lifting three limits stacked up", "Letting the download finish"],
      reply:
        "Fixed. A daily schedule, this download and the overall setting each had a speed limit.\n**Before:** 48 KiB/s. **After:** about 9.5 MiB/s, roughly 200 times faster.",
    },
    faq: [
      ["Why is qBittorrent so slow when my internet is fast?", "Often a speed limit someone turned on and forgot. Stella checks every one."],
      ["What are the best qBittorrent settings for faster downloads?", "No download limit, uploads at about 80% of your upload speed, 500 connections and encryption on Allow."],
    ],
    byHand: [
      "Untick Tools → Alternative Speed Limits, and its schedule under Options → Speed, so it doesn't switch back on.",
      "Set the global download limit to 0, then right-click the torrent → Torrent options and set its limit to 0 too.",
      "In Options → Connection, allow 500 connections overall and 100 per torrent. A file with one or two seeds stays slow regardless.",
    ],
    related: [
      "torrenting/fix-qbittorrent-stalled",
      "torrenting/set-up-qbittorrent",
      "torrenting/download-torrents-automatically-with-rss",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "download-torrents-automatically-with-rss",
    niche: "torrenting",
    searchPhrases: [
      "qbittorrent rss rules",
      "qbittorrent rss setup",
      "qbittorrent rss downloader",
      "automate torrent downloads",
      "qbittorrent rss feeds",
      "qbittorrent rss downloader regular expressions",
    ],
    title: "qBittorrent RSS rules: download torrents automatically",
    description:
      "Get new releases automatically: tell Stella (stella.sh) what you want and it sets up qBittorrent to grab every new one, and nothing else.",
    h1: "qBittorrent RSS rules that download torrents automatically",
    short: "Automate torrents with qBittorrent RSS",
    lede: "New releases download themselves.",
    answer:
      "qBittorrent can watch a feed and download new releases by itself. Tell Stella (stella.sh) what you're waiting for, and it sets that up and gets the latest one now.",
    gets: ["New releases downloaded as they come out", "Only the version you asked for", "The latest one, right away"],
    prompt:
      "Set up qBittorrent to download every new Alpine Linux release from this feed by itself, and get the latest one now.",
    demo: {
      ack: "Setting it up now. The first file follows shortly.",
      task: "Setting up automatic downloads",
      rows: ["Adding your feed to qBittorrent", "Matching only the version you want", "Downloading the current release"],
      reply:
        "Done. Every 30 minutes qBittorrent checks the feed and downloads each new Alpine Linux release for your computer, and nothing else. The current one is in your **Downloads**.",
      files: ["alpine-minirootfs-3.23.3-x86_64.tar.gz"],
    },
    faq: [
      ["What is RSS in qBittorrent?", "A list of new releases that qBittorrent keeps checking for you, every half hour or as often as you like."],
      ["Why is the qBittorrent RSS downloader not working?", "Usually automatic downloading is switched off, or the rule isn't ticked for your feed."],
    ],
    byHand: [
      "In Tools → Options → RSS, tick Enable fetching RSS feeds and Enable auto downloading of RSS torrents.",
      "Tick View → RSS Reader, open the RSS tab, click New subscription and paste the feed's address.",
      "Click RSS Downloader, add a rule, tick your feed and fill in Must Contain. For exact matches, tick Use Regular Expressions.",
    ],
    related: [
      "torrenting/set-up-qbittorrent",
      "torrenting/extract-rar-after-torrent-downloads",
      "torrenting/fix-qbittorrent-stalled",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "rename-organize-downloads-for-plex",
    niche: "torrenting",
    searchPhrases: [
      "rename files for plex",
      "organize plex library",
      "rename tv shows for plex",
      "rename movie files for plex",
      "bulk rename files for plex",
      "plex naming convention",
      "hardlink torrents to plex library",
    ],
    title: "Rename files for Plex and keep your torrents seeding",
    description:
      "Let Stella (stella.sh) sort your downloads into Plex with the right names, seasons and subtitles, while your torrents keep seeding.",
    h1: "Rename files for Plex without breaking seeding",
    short: "Rename downloads for Plex",
    lede: "Messy downloads turned into a clean Plex library.",
    answer:
      "Plex needs tidy names to recognise movies and shows. Stella (stella.sh) sorts your downloads into your Plex folders with the right names, and your torrents keep seeding.",
    gets: ["Movies and episodes named the way Plex likes", "Subtitles kept, junk left out", "No extra space used"],
    prompt:
      "Sort my finished downloads into my Plex folders with the names Plex wants. Keep the subtitles, skip the junk and keep everything seeding.",
    demo: {
      ack: "On it. Sorting your downloads for Plex.",
      task: "Sorting downloads into Plex",
      rows: ["Working out each title and year", "Pairing subtitles with their videos", "Leaving samples and junk out"],
      reply:
        "Done. **6 movies** and **5 episodes** are in your Plex folders, subtitles included. Nothing in your downloads moved and no extra space is used. Nosferatu is still downloading, so it waits.",
    },
    faq: [
      ["What is the Plex naming convention?", "Movies as Title (Year), episodes as Show - s01e05, and each subtitle named after its video."],
      ["Will my torrents stop seeding?", "No. The original downloads stay exactly where they are."],
    ],
    byHand: [
      "Give each movie a folder named like the file: His Girl Friday (1940)/His Girl Friday (1940).mp4.",
      "Put episodes in Show (Year)/Season 01/ as Show (Year) - s01e05, and subtitles beside them as Charade (1963).en.srt.",
      "To keep seeding, hard-link each file under its Plex name instead of renaming it. Sonarr and Radarr do this for new downloads.",
    ],
    related: [
      "torrenting/extract-rar-after-torrent-downloads",
      "torrenting/move-qbittorrent-to-new-drive-or-computer",
      "files-folders/rename-multiple-files-at-once",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "extract-rar-after-torrent-downloads",
    niche: "torrenting",
    searchPhrases: [
      "qbittorrent auto unrar",
      "qbittorrent unrar after download",
      "qbittorrent run external program",
      "qbittorrent run external program parameters",
      "qbittorrent move completed files by category",
      "automatically extract rar files after download",
    ],
    title: "Unrar qBittorrent downloads automatically when they finish",
    description:
      "Tired of unpacking RAR files? Stella (stella.sh) sets up qBittorrent to unrar every finished download into the right folder by itself.",
    h1: "Unrar qBittorrent downloads automatically",
    short: "Auto-unrar finished downloads",
    lede: "Downloads unpack themselves the moment they finish.",
    answer:
      "Stella (stella.sh) makes qBittorrent unpack every download as soon as it finishes and put it in the right folder. It does the ones you already have too.",
    gets: [
      "Every new download unpacked by itself",
      "Movies, TV and music in their own folders",
      "Everything still seeding",
    ],
    prompt:
      "When a download finishes, unpack it into my Movies, TV or Music folder and keep it seeding. Do the ones I already have too.",
    demo: {
      ack: "On it. Setting up unpacking for every finished download.",
      task: "Unpacking finished downloads",
      rows: ["Adding a free unpacking tool", "Running it when a download finishes", "Catching up on older downloads"],
      reply:
        "Done. New downloads now unpack themselves into Media. Detour went to Movies, Sherlock Holmes to TV, and the Harbor Lights album to Music. Samples skipped, all still seeding.",
      files: ["unpack.log"],
    },
    faq: [
      ["Can qBittorrent unrar automatically?", "Not by itself. It can start a program when a download finishes, and that program unpacks it. Stella sets that up."],
      ["What do %F, %L and %N mean in Run external program?", "%F is where the download is, %L its category and %N its name. Put each in quotes."],
    ],
    byHand: [
      "Install 7-Zip or the free UnRAR, and give each download a category such as Movies, TV or Music.",
      "Write a small script that unpacks the first part (name.rar or name.part1.rar) into that category's folder.",
      "In Options → Downloads, tick Run on torrent finished and enter your script followed by \"%F\" \"%L\" \"%N\".",
    ],
    related: [
      "torrenting/rename-organize-downloads-for-plex",
      "torrenting/download-from-seedbox-automatically",
      "files-folders/open-rar-file",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "move-qbittorrent-to-new-drive-or-computer",
    niche: "torrenting",
    searchPhrases: [
      "qbittorrent missing files",
      "qbittorrent missing files fix",
      "move qbittorrent to new computer",
      "qbittorrent move files to another location",
      "qbittorrent move torrents to new drive",
      "qbittorrent missing files redownload",
    ],
    title: "Move qBittorrent to a new PC or drive and fix Missing Files",
    description:
      "New PC or drive and qBittorrent says Missing Files? Stella (stella.sh) gets every torrent back and seeding, without downloading anything again.",
    h1: "Fix Missing Files in qBittorrent after moving to a new drive or PC",
    short: "Fix qBittorrent Missing Files after a move",
    lede: "Every torrent back after a move, nothing downloaded twice.",
    answer:
      "After a move, qBittorrent looks for your files in the old place. Stella (stella.sh) points every torrent at the new one and gets them seeding again.",
    gets: ["All your torrents back", "Nothing downloaded again", "New downloads going to the right folder"],
    prompt:
      "I moved to a new PC and every torrent in qBittorrent says Missing Files. Get them all back without downloading anything again.",
    demo: {
      ack: "On it. Finding where each torrent's files went.",
      task: "Reconnecting your torrents",
      rows: [
        "Matching torrents to their new folders",
        "Checking every file is complete",
        "Updating where new downloads go",
      ],
      reply:
        "Six of your seven torrents are seeding again, with their categories and tags. **His Girl Friday** only reached 44% on your old PC, so I left it stopped. Press Start if you want the rest.",
    },
    faq: [
      ["What does Missing Files mean?", "qBittorrent can't find the download where it used to be."],
      ["Will a Force recheck download the files again?", "No. It compares the files you have, and only parts that don't match download, once you start the torrent."],
    ],
    byHand: [
      "Exit qBittorrent from its menu. For a new PC, copy %APPDATA%\\qBittorrent and %LOCALAPPDATA%\\qBittorrent along with the downloads.",
      "Stop the torrents, right-click → Set location, pick the folder that holds their files, then right-click → Force recheck.",
      "Set the new default save path in Options → Downloads, and each category's path, so nothing moves back.",
    ],
    related: [
      "torrenting/switch-utorrent-to-qbittorrent",
      "torrenting/extract-rar-after-torrent-downloads",
      "torrenting/download-from-seedbox-automatically",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "switch-utorrent-to-qbittorrent",
    niche: "torrenting",
    searchPhrases: [
      "utorrent to qbittorrent",
      "utorrent to qbittorrent migration",
      "transfer utorrent to qbittorrent",
      "import utorrent to qbittorrent",
      "export utorrent to qbittorrent",
      "utorrent to qbittorrent migration tool",
    ],
    title: "Move from uTorrent to qBittorrent with labels and progress",
    description:
      "Leaving uTorrent? Stella (stella.sh) moves all your torrents into qBittorrent with their labels and progress, and nothing downloads again.",
    h1: "Switch from uTorrent to qBittorrent",
    short: "Move uTorrent to qBittorrent",
    lede: "Every torrent moved across, with nothing to download again.",
    answer:
      "Stella (stella.sh) moves your whole uTorrent list into qBittorrent on your PC: every torrent, its label and how far along it was.",
    gets: [
      "Every torrent in qBittorrent",
      "Labels and progress kept",
      "uTorrent left as it was, in case you change your mind",
    ],
    prompt:
      "I'm switching from uTorrent to qBittorrent. Move all my torrents over with their labels and progress so nothing downloads again.",
    demo: {
      ack: "On it. Moving your torrents across now.",
      task: "Moving uTorrent to qBittorrent",
      rows: ["Reading your uTorrent list", "Turning labels into categories", "Checking how far each one got"],
      reply:
        "All 6 torrents are in qBittorrent with their labels, and nothing downloaded again. Five are complete, Tears of Steel is at 45.8%, and Night of the Living Dead is stopped, as it was.",
    },
    faq: [
      ["Can qBittorrent import from uTorrent?", "It has no import button, so Stella does it for you."],
      ["Is there a uTorrent to qBittorrent migration tool?", "Yes, a free Windows one called bt2qbt. With Stella you don't need to find or run it."],
      ["Will half-finished downloads continue?", "Yes, from where they stopped."],
    ],
    byHand: [
      "In uTorrent, untick Append .!ut to incomplete files, then exit both apps. In qBittorrent, set Advanced → Resume data storage type to Fastresume files.",
      "Run bt2qbt from its GitHub releases page. It reads %APPDATA%\\uTorrent and turns labels into categories.",
      "Start qBittorrent, select all, right-click → Force recheck, and keep everything stopped until the check is done.",
    ],
    related: [
      "torrenting/move-qbittorrent-to-new-drive-or-computer",
      "torrenting/extract-rar-after-torrent-downloads",
      "torrenting/download-from-seedbox-automatically",
    ],
    platforms: ["windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "download-from-seedbox-automatically",
    niche: "torrenting",
    searchPhrases: [
      "download from seedbox",
      "auto download from seedbox",
      "download files from seedbox",
      "sync seedbox to nas",
      "fastest way to download from seedbox",
      "seedbox setup",
    ],
    title: "Download from your seedbox automatically every night",
    description:
      "Stella (stella.sh) sets up your computer to bring home finished seedbox downloads every night, once each, without you doing a thing.",
    h1: "Download from a seedbox automatically",
    short: "Pull seedbox downloads every night",
    lede: "Your seedbox downloads waiting at home every morning.",
    answer:
      "Ask once, and Stella (stella.sh) sets your computer to fetch finished downloads from your seedbox every night. Nothing comes twice, and unfinished ones wait.",
    gets: ["New downloads every night, by themselves", "Only finished ones, only once", "The first batch right away"],
    prompt:
      "Every night at 3, bring finished downloads home from my seedbox. Never download the same thing twice. Start with the first batch now.",
    demo: {
      ack: "On it. Setting up the nightly pull.",
      task: "Pulling from your seedbox",
      rows: ["Signing in to your seedbox", "Bringing home what's finished", "Scheduling it for 3am"],
      reply:
        "Done. Big Buck Bunny, Harbor Lights and Sintel are home. Two more are still downloading on the seedbox, so they'll come the night after they finish.",
    },
    faq: [
      ["Does it work with any seedbox?", "Yes, if it gives you a login for downloading files."],
      ["What's the fastest way to download from a seedbox?", "Several files at once over a secure connection, instead of one at a time. Stella sets that up."],
    ],
    byHand: [
      "Install rclone, run rclone config and add your seedbox with the details from your provider's panel.",
      "On the seedbox, have qBittorrent copy each finished download into an outbox folder with Run on torrent finished.",
      "Schedule rclone move from the outbox to your Downloads at 3am. Fetched files leave the outbox, so nothing comes twice.",
    ],
    related: [
      "torrenting/rename-organize-downloads-for-plex",
      "torrenting/extract-rar-after-torrent-downloads",
      "torrenting/move-qbittorrent-to-new-drive-or-computer",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "create-a-torrent-file",
    niche: "torrenting",
    searchPhrases: [
      "how to make a torrent",
      "create a torrent file",
      "how to create a torrent",
      "create a torrent file qbittorrent",
      "how to create a torrent and share it",
      "how to create a torrent link",
    ],
    title: "How to make a torrent file and magnet link from a folder",
    description:
      "Want to make a torrent of your own files? Stella (stella.sh) turns a folder into a torrent and a magnet link you can send to anyone.",
    h1: "How to make a torrent",
    short: "Make a torrent file and magnet link",
    lede: "Your folder as a torrent you can share.",
    answer:
      "Tell Stella (stella.sh) which folder to share. It makes the torrent and a magnet link on your computer, ready to send.",
    gets: ["A torrent file", "A magnet link to paste anywhere", "Both next to your folder"],
    prompt:
      "Make a torrent of the Harbor Walk folder in my Documents and save the magnet link next to it.",
    demo: {
      ack: "Making the torrent now.",
      task: "Making a torrent",
      rows: ["Reading the Harbor Walk folder", "Making the torrent file", "Writing out the magnet link"],
      reply:
        "Done. The torrent and its magnet link are in your **Documents**, next to the Harbor Walk folder. Leave the folder where it is so you can share it.",
      files: ["Harbor Walk Field Recordings.torrent", "Harbor Walk Field Recordings - magnet link.txt"],
    },
    faq: [
      ["What do I send people?", "The magnet link or the torrent file. Either one works."],
      ["How do I create a torrent link?", "Make the torrent, then right-click it in qBittorrent and copy the magnet link. Stella hands you both."],
      ["Do I have to keep my computer on?", "Yes, until others have a full copy."],
    ],
    byHand: [
      "Put everything in one folder with the name people should see, and settle the file names first.",
      "In qBittorrent, open Tools → Torrent Creator, select the folder, leave piece size on Auto and paste a few public trackers.",
      "Click Create Torrent and save it. Then right-click it in your list → Copy → Magnet link, and keep it seeding.",
    ],
    related: [
      "torrenting/convert-magnet-link-to-torrent-file",
      "torrenting/set-up-qbittorrent",
      "torrenting/download-torrents-automatically-with-rss",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-magnet-link-to-torrent-file",
    niche: "torrenting",
    searchPhrases: [
      "magnet link to torrent",
      "open magnet link",
      "magnet link not working",
      "convert magnet link to torrent file",
      "magnet link downloader",
      "magnet link opener",
    ],
    title: "Magnet link to torrent file: convert, open and fix links",
    description:
      "Got magnet links that won't open? Stella (stella.sh) turns them into torrent files, repairs broken ones and tells you what's inside each.",
    h1: "Magnet link to torrent file",
    short: "Convert magnet links to .torrent files",
    lede: "Magnet links turned into torrent files, broken ones repaired.",
    answer:
      "Give Stella (stella.sh) your magnet links. It turns them into torrent files, repairs the broken ones and lists what's inside, without downloading the contents.",
    gets: ["A torrent file for every working link", "What's inside each one", "Which links are dead"],
    prompt:
      "Turn the magnet links in magnets.txt into torrent files and tell me what's in each one and which don't work.",
    demo: {
      ack: "On it. Fetching only the file lists.",
      task: "Turning magnet links into torrents",
      rows: ["Repairing two damaged links", "Fetching each file list", "Saving the torrent files"],
      reply:
        "Four of your five links are now torrent files in **Downloads**: Popeye for President, two Alpine Linux releases and Debian 13.8.0. Nothing was downloaded. The newsletter link is dead, so ask for a fresh one.",
    },
    faq: [
      ["Why won't my magnet link open?", "It's often cut off or mangled by the website it came from. Stella can often repair it."],
      ["How do I open a magnet link?", "Click it with qBittorrent installed, or paste it in File → Add Torrent Link."],
    ],
    byHand: [
      "In qBittorrent, choose File → Add Torrent Link and paste the link. When the file list appears, click Save as .torrent file.",
      "A working link starts magnet:?xt=urn:btih: and a long code. Change &amp; back to &, and join links split over two lines.",
      "For a whole list, aria2 saves just the torrent files: aria2c --bt-metadata-only=true --bt-save-metadata=true -i links.txt.",
    ],
    related: ["torrenting/create-a-torrent-file", "torrenting/fix-qbittorrent-stalled", "torrenting/set-up-qbittorrent"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "sonarr-radarr-prowlarr-setup",
    niche: "torrenting",
    searchPhrases: [
      "sonarr radarr prowlarr setup",
      "sonarr radarr setup",
      "sonarr radarr prowlarr docker compose",
      "automated media server",
      "how to set up sonarr and radarr",
    ],
    title: "Sonarr, Radarr and Prowlarr setup, done for you",
    description:
      "Set up Sonarr, Radarr and Prowlarr with Stella (stella.sh): installed, connected to each other and to qBittorrent, and ready to use.",
    h1: "Sonarr, Radarr and Prowlarr setup",
    short: "Set up Sonarr and Radarr",
    lede: "Shows and movies that arrive and sort themselves.",
    answer:
      "Sonarr follows shows, Radarr follows movies and Prowlarr finds them. Stella (stella.sh) installs all three, connects them to qBittorrent and sorts everything into your library.",
    gets: ["All three installed and connected", "New episodes by themselves", "Files named for Plex or Jellyfin"],
    prompt:
      "Set up Sonarr, Radarr and Prowlarr with my qBittorrent and put everything in my Media folder.",
    demo: {
      ack: "Installing all three, then connecting them.",
      task: "Setting up Sonarr and Radarr",
      rows: ["Installing the three apps", "Connecting them to qBittorrent", "Setting your Media folders"],
      reply:
        "All three are running and connected. Open Sonarr to add a show or Radarr to add a movie; they land in Media, named for Plex.",
    },
    faq: [
      ["Do I need Docker?", "No, but Stella can set it up that way if you like."],
      ["Where do they find things?", "In the sources you add to Prowlarr, which shares them with the other two."],
    ],
    byHand: [
      "Install Sonarr, Radarr and Prowlarr and open each in your browser.",
      "In Prowlarr add your sources, then add Sonarr and Radarr under Settings, Apps.",
      "In Sonarr and Radarr add qBittorrent under Download Clients and choose your media folder.",
    ],
    related: [
      "torrenting/rename-organize-downloads-for-plex",
      "torrenting/download-torrents-automatically-with-rss",
      "torrenting/set-up-qbittorrent",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "qbittorrent-web-ui-remote-access",
    niche: "torrenting",
    searchPhrases: [
      "qbittorrent web ui",
      "qbittorrent remote access",
      "qbittorrent web ui default password",
      "qbittorrent on phone",
      "qbittorrent web ui setup",
    ],
    title: "qBittorrent Web UI: use it from your phone or laptop",
    description:
      "Turn on the qBittorrent Web UI with Stella (stella.sh): a password, an address for your phone and it's ready, at home or away.",
    h1: "qBittorrent Web UI, set up for your phone",
    short: "qBittorrent Web UI",
    lede: "Check and add downloads from any room.",
    answer:
      "qBittorrent can be used from any browser through its Web UI. Stella (stella.sh) turns it on, sets a password and gives you the address for your phone.",
    gets: ["qBittorrent on your phone", "A password of your own", "Ready every time you start up"],
    prompt:
      "Set up qBittorrent so I can add and check downloads from my phone.",
    demo: {
      ack: "Turning it on and setting a password.",
      task: "Setting up qBittorrent for your phone",
      rows: ["Turning on the Web UI", "Setting your password", "Getting the address"],
      reply:
        "Done. Open the address in phone-address.txt on your phone and sign in. Add it to your home screen to use it like an app.",
    },
    faq: [
      ["What's the default password?", "New versions make up a temporary one. Stella sets your own."],
      ["Can I use it away from home?", "Yes. Ask Stella to set up Tailscale, and it works anywhere."],
    ],
    byHand: [
      "In qBittorrent open Options, Web UI, tick Web User Interface and set a name and password.",
      "On your phone open your computer's address followed by :8080.",
      "For use away from home, install Tailscale on both.",
    ],
    related: [
      "torrenting/set-up-qbittorrent",
      "torrenting/download-from-seedbox-automatically",
      "torrenting/move-qbittorrent-to-new-drive-or-computer",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "bind-qbittorrent-to-vpn",
    niche: "torrenting",
    searchPhrases: [
      "bind qbittorrent to vpn",
      "qbittorrent vpn",
      "qbittorrent vpn kill switch",
      "torrent ip check",
      "how to use a vpn with qbittorrent",
    ],
    title: "Bind qBittorrent to your VPN so it never runs without it",
    description:
      "Bind qBittorrent to your VPN with Stella (stella.sh): downloads run only through it, stop when it drops, and you see the address others see.",
    h1: "Bind qBittorrent to your VPN",
    short: "Bind qBittorrent to your VPN",
    lede: "Downloads only when the VPN is on.",
    answer:
      "Binding qBittorrent to your VPN means it only downloads while the VPN is on. Stella (stella.sh) sets that up and shows you the address other people see.",
    gets: ["qBittorrent using only your VPN", "Downloads pausing if it drops", "The address others see"],
    prompt:
      "Make qBittorrent only work through my VPN and show me it's working.",
    demo: {
      ack: "Setting it to your VPN now.",
      task: "Binding qBittorrent to your VPN",
      rows: ["Finding your VPN", "Setting qBittorrent to it", "Checking the address others see"],
      reply:
        "qBittorrent now uses only your VPN. Others see the VPN's address in Amsterdam, and with the VPN off nothing downloads.",
    },
    faq: [
      ["Is that a kill switch?", "Yes, for qBittorrent. Without the VPN it has no way out."],
      ["Does it work with any VPN?", "Yes, with any that has an app or a connection on your computer."],
    ],
    byHand: [
      "Connect your VPN, then in qBittorrent open Options, Advanced.",
      "Set Network interface to your VPN's name and restart qBittorrent.",
      "Use a torrent address check page to see what others see.",
    ],
    related: [
      "torrenting/set-up-qbittorrent",
      "torrenting/speed-up-qbittorrent",
      "torrenting/qbittorrent-web-ui-remote-access",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
