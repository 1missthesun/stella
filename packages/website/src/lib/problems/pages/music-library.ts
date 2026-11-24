import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const MUSIC_LIBRARY_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "transfer-spotify-playlists-to-apple-music",
    niche: "music-library",
    searchPhrases: [
      "transfer spotify playlist to apple music",
      "transfer spotify playlist to apple music free",
      "transfer spotify playlist to apple music on mac",
      "move all my spotify playlists to apple music",
      "transfer spotify playlist to apple music not working",
    ],
    title: "Transfer all your Spotify playlists to Apple Music",
    description:
      "Switching to Apple Music? Ask Stella (stella.sh). It rebuilds every Spotify playlist in Apple Music in the same order and lists any song it couldn't match.",
    h1: "Transfer your Spotify playlists to Apple Music",
    short: "Spotify playlists to Apple Music",
    lede: "Every playlist you made, rebuilt in Apple Music in the same order.",
    answer:
      "To transfer Spotify playlists to Apple Music, each song has to be found again in Apple's catalogue. Stella (stella.sh) reads your playlists in your browser, matches every song to the right version in Apple Music and rebuilds them in order, Liked Songs included.",
    gets: [
      "Every playlist rebuilt with the same name and order",
      "Liked Songs moved into your Apple Music library",
      "A short list of anything Apple Music doesn't carry, with close picks",
    ],
    prompt:
      "I'm switching to Apple Music. Move all 14 of my Spotify playlists over, plus my Liked Songs, in the same order.",
    demo: {
      ack: "Happy to. Reading your Spotify playlists first.",
      task: "Moving 14 playlists to Apple Music",
      rows: [
        "Found 14 playlists and 1,208 liked songs",
        "Matching each song in Apple Music",
        "Building the playlists in order",
      ],
      reply:
        "Done. All 14 playlists are in **Apple Music** in their original order, and your liked songs are in your library. Nine songs aren't on Apple Music; **Not moved.txt** on your Desktop lists them with the closest versions I found.",
      files: ["Not moved.txt"],
    },
    faq: [
      [
        "Doesn't Apple Music have its own transfer tool?",
        "It does. It copies playlists you made but skips ones Spotify made for you, like Discover Weekly. Stella copies those too.",
      ],
      ["Will my Spotify playlists be deleted?", "No. Spotify stays exactly as it was, so you can keep both while you decide."],
    ],
    byHand: [
      "On iPhone, open Settings, Apps, Music, then Transfer Music from Other Music Services.",
      "Or sign in to both services on [TuneMyMusic](https://www.tunemymusic.com) and add unmatched songs yourself.",
    ],
    related: [
      "music-library/transfer-apple-music-playlists-to-spotify",
      "music-library/backup-spotify-playlists",
      "chats-data-exports/see-your-spotify-listening-history",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "transfer-apple-music-playlists-to-spotify",
    niche: "music-library",
    searchPhrases: [
      "transfer apple music playlist to spotify",
      "transfer apple music playlist to spotify free",
      "move apple music playlist to spotify",
      "import apple music playlist to spotify",
      "export apple music playlist to spotify",
    ],
    title: "Transfer Apple Music playlists to Spotify, in order",
    description:
      "Moving from Apple Music to Spotify? Ask Stella (stella.sh). It finds every song from your Apple Music playlists on Spotify and builds them in the same order.",
    h1: "Transfer your Apple Music playlists to Spotify",
    short: "Apple Music playlists to Spotify",
    lede: "Your Apple Music playlists and library, rebuilt on Spotify.",
    answer:
      "Moving Apple Music playlists to Spotify means looking each song up again. Stella (stella.sh) opens Apple Music on the web, reads your playlists and library, finds every song on Spotify and builds matching playlists in the order you made them.",
    gets: [
      "Your playlists on Spotify with the same names",
      "Your Apple Music library saved to Liked Songs",
      "Remixes and rare versions swapped for the nearest match, and named",
    ],
    prompt:
      "Copy my Apple Music playlists to Spotify. The ones I care about are Sunday Kitchen, Road Trip 2025 and Wedding Dances.",
    demo: {
      ack: "Sure. Opening Apple Music on the web.",
      task: "Copying 3 playlists to Spotify",
      rows: ["Reading Sunday Kitchen, Road Trip 2025, Wedding Dances", "Looking up 186 songs on Spotify", "Creating the three playlists"],
      reply:
        "Done. **Sunday Kitchen**, **Road Trip 2025** and **Wedding Dances** are on Spotify in their original order. 183 of 186 songs matched. The other 3 are remixes Spotify doesn't have, so I used the original mixes and listed them below.",
    },
    faq: [
      [
        "Does Spotify have an import button now?",
        "Where it has rolled out, yes: Your Library, then Import your music. Stella also shows every song it had to swap.",
      ],
      [
        "Can I cancel Apple Music afterwards?",
        "Yes. Once the playlists are on Spotify they stay there, whatever happens to your Apple Music account.",
      ],
    ],
    byHand: [
      "In the Spotify phone app, open Your Library, scroll to the bottom and tap Import your music.",
      "Or use [Soundiiz](https://soundiiz.com) with both accounts connected.",
      "Search Spotify for anything it couldn't match.",
    ],
    related: [
      "music-library/transfer-spotify-playlists-to-apple-music",
      "music-library/export-apple-music-playlist",
      "music-library/transfer-spotify-to-youtube-music",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "transfer-spotify-to-youtube-music",
    niche: "music-library",
    searchPhrases: [
      "transfer spotify to youtube music",
      "spotify to youtube music playlist transfer",
      "spotify to youtube music playlist converter",
      "transfer spotify liked songs to youtube music",
      "transfer apple music to youtube music",
    ],
    title: "Transfer Spotify playlists and likes to YouTube Music",
    description:
      "Got YouTube Premium and done with Spotify? Ask Stella (stella.sh). It moves your playlists and liked songs to YouTube Music, picking the official songs.",
    h1: "Transfer Spotify to YouTube Music",
    short: "Spotify to YouTube Music",
    lede: "Your playlists and liked songs, moved over to YouTube Music.",
    answer:
      "To transfer Spotify to YouTube Music, every song is looked up again and added to new playlists. Stella (stella.sh) does it in your browser with both accounts signed in, picks the official song over random uploads, and brings Liked Songs along.",
    gets: [
      "Every playlist rebuilt on YouTube Music, in order",
      "Official album songs picked over lyric videos and fan uploads",
      "Liked Songs saved as likes",
      "Works from Apple Music too",
    ],
    prompt:
      "I got YouTube Premium with my phone, so move my Spotify playlists and liked songs to YouTube Music. Skip the podcasts.",
    demo: {
      ack: "On it. Both accounts look signed in.",
      task: "Moving Spotify to YouTube Music",
      rows: ["Found 22 playlists and 640 liked songs", "Picking official songs, not lyric videos", "Leaving podcasts and audiobooks out"],
      reply:
        "Done. Your 22 playlists are under **Library** in YouTube Music with the same names, and 640 songs are liked. Four songs only exist there as fan uploads, so I left them out and listed them below.",
    },
    faq: [
      [
        "Why do some moved songs play as music videos?",
        "YouTube Music mixes album songs, music videos and uploads under one name. Stella picks the plain album version first, so playlists don't jump into video intros.",
      ],
      [
        "Can I move new songs later?",
        "Yes. Ask again any time and only what's new since the last move gets added, so nothing doubles up.",
      ],
    ],
    byHand: [
      "Check YouTube Music's settings under Privacy and data for a Transfer playlists option.",
      "Or use the free [spotify_to_ytmusic](https://github.com/linsomniac/spotify_to_ytmusic) tool or [TuneMyMusic](https://www.tunemymusic.com).",
    ],
    related: [
      "music-library/transfer-spotify-playlists-to-apple-music",
      "downloads/download-youtube-playlist",
      "music-library/backup-spotify-playlists",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "add-local-files-to-spotify",
    niche: "music-library",
    searchPhrases: [
      "how to add local files to spotify",
      "how to add local files to spotify mobile",
      "sync local files spotify to iphone",
      "spotify local files not showing",
    ],
    title: "Add local files to Spotify, then get them on your phone",
    description:
      "Got songs Spotify doesn't have? Ask Stella (stella.sh). It adds your own music files to Spotify in a playlist and puts them on your iPhone or Android too.",
    h1: "Add your local files to Spotify and your phone",
    short: "Add local files to Spotify",
    lede: "Your own songs inside Spotify, on your computer and your phone.",
    answer:
      "To add local files to Spotify, switch on Local Files in the desktop app and put the songs in a playlist. Stella (stella.sh) does that, fixes songs that don't show up, and copies them to your phone's Spotify folder.",
    gets: [
      "Your songs in a Spotify playlist next to everything else",
      "Missing titles and covers filled in so they show properly",
      "The same songs playing on your iPhone or Android",
    ],
    prompt:
      "Add the remixes in my Downloads/DJ Edits folder to Spotify in a playlist called Edits, and get them on my iPhone too.",
    demo: {
      ack: "Sure. Turning on Local Files first.",
      task: "Adding DJ Edits to Spotify",
      rows: [
        "Showing Downloads/DJ Edits in Spotify",
        "Making the Edits playlist, 31 songs",
        "Copying them to the iPhone's Spotify folder",
      ],
      reply:
        "Done. **Edits** is in Spotify with all 31 songs. They're in Spotify's folder on your iPhone too: switch on **Local audio files** in Spotify's settings there and they play.",
    },
    faq: [
      [
        "Why are my local files not showing in Spotify?",
        "Usually the folder isn't switched on, or the songs have no title saved inside them. Stella fixes both.",
      ],
      [
        "Does it work with Android?",
        "Yes. The songs go into a Spotify folder on the phone over a cable, then you switch on Local audio files in the app.",
      ],
    ],
    byHand: [
      "Desktop: profile picture, Settings, switch on Show Local Files, then Add a source.",
      "iPhone: switch on Local audio files under Settings and privacy, Apps and devices.",
      "Copy the songs into On My iPhone, Spotify, using the Files app or Finder.",
    ],
    related: [
      "audio/edit-mp3-tags-in-bulk",
      "music-library/add-your-own-music-to-apple-music",
      "audio/convert-flac-to-mp3",
    ],
    platforms: ["windows", "mac"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "add-your-own-music-to-apple-music",
    niche: "music-library",
    searchPhrases: [
      "add your own music to apple music",
      "add unreleased songs to apple music",
      "add music to apple music from computer",
      "how to add unreleased songs to apple music on iphone",
    ],
    title: "Add your own music and unreleased songs to Apple Music",
    description:
      "Songs Apple Music doesn't have? Ask Stella (stella.sh). It adds your own files and unreleased tracks to Apple Music with covers, synced to your iPhone.",
    h1: "Add your own music to Apple Music and your iPhone",
    short: "Add your own music to Apple Music",
    lede: "Songs Apple Music doesn't have, in your library and on your iPhone.",
    answer:
      "To add your own music to Apple Music, import the files on a computer and turn on Sync Library so they reach your iPhone. Stella (stella.sh) imports them with proper names and covers and switches syncing on.",
    gets: [
      "Unreleased songs, demos and mixes in your Apple Music library",
      "Names, artist and cover filled in so they sort right",
      "On your iPhone through Sync Library, no cable",
    ],
    prompt:
      "Add my band's demos and the unreleased songs in Downloads/Unreleased to Apple Music with covers, and get them on my iPhone.",
    demo: {
      ack: "Sure. Tidying the files before they go in.",
      task: "Adding your songs to Apple Music",
      rows: [
        "Found 18 songs in Downloads/Unreleased",
        "Filling in titles, artists and covers",
        "Importing them into the Music app",
      ],
      reply:
        "Done. All 18 songs are in Apple Music in a playlist called **Unreleased**, each with a cover. Sync Library is on, so they show up on your iPhone once they finish uploading.",
    },
    faq: [
      [
        "Do I need a computer to add songs to Apple Music?",
        "For songs from your own files, yes. Apple Music only takes them in through the Music app on a Mac or the Apple Music app on Windows.",
      ],
      [
        "Why don't they show on my iPhone?",
        "Sync Library has to be on, with the same Apple Account, on both. On the iPhone it's under Settings, Apps, Music.",
      ],
    ],
    byHand: [
      "Mac: open Music, choose File, Add to Library, and pick the songs.",
      "Windows: open the Apple Music app and import the files from its menu.",
    ],
    related: [
      "music-library/add-local-files-to-spotify",
      "audio/edit-mp3-tags-in-bulk",
      "music-library/transfer-itunes-library-to-new-computer",
    ],
    platforms: ["mac", "windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "fix-greyed-out-songs-on-spotify",
    niche: "music-library",
    searchPhrases: [
      "spotify greyed out songs",
      "how to fix greyed out songs on spotify",
      "spotify greyed out songs on playlist",
      "why are some songs greyed out on spotify",
      "apple music songs greyed out in playlist",
    ],
    title: "Fix greyed out songs in your Spotify playlists",
    description:
      "Old playlists full of songs that won't play? Ask Stella (stella.sh). It finds every greyed out song and swaps in a version that plays, in the same spot.",
    h1: "Fix greyed out songs on Spotify",
    short: "Fix greyed out songs on Spotify",
    lede: "The songs that won't play, swapped for versions that do.",
    answer:
      "Spotify greys out a song when that release is pulled or not offered where you live, yet the same song often sits on another album. Stella (stella.sh) finds every one and puts a playable version in the same spot.",
    gets: [
      "Every greyed out song found, across all your playlists",
      "Swapped for the same recording from a reissue or another album",
      "A list of the few with no playable version",
    ],
    prompt:
      "Half my old 2016 playlists have greyed out songs now. Find versions that play and swap them in where the old ones were.",
    demo: {
      ack: "Sure. Checking every playlist for songs that won't play.",
      task: "Fixing greyed out songs",
      rows: ["Checked 38 playlists", "Found 71 greyed out songs", "Swapping in the same songs from reissues"],
      reply:
        "Done. 64 of the 71 play again, in the same spots, mostly from remasters and greatest hits albums. Seven aren't on Spotify in any version; they're listed below if you want to add them from your own files.",
    },
    faq: [
      [
        "Why are some songs greyed out on Spotify?",
        "The label pulled that release, it isn't offered in your country, or it's one of your own files that isn't on this device.",
      ],
      [
        "Does it fix Apple Music songs greyed out in a playlist?",
        "Yes. Stella finds the Apple Music version that plays and puts it in the same place in the playlist.",
      ],
    ],
    byHand: [
      "In Spotify's settings, switch on Show unavailable songs in playlists so you can see them.",
      "Search each one, add a playable version and drag it into the old spot.",
    ],
    related: [
      "music-library/remove-duplicates-from-spotify-playlist",
      "music-library/add-local-files-to-spotify",
      "music-library/backup-spotify-playlists",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "remove-duplicates-from-spotify-playlist",
    niche: "music-library",
    searchPhrases: [
      "remove duplicates spotify playlist",
      "combine spotify playlists and remove duplicates",
      "merge spotify playlists into one",
      "spotify find duplicates in liked songs",
    ],
    title: "Remove duplicates from a Spotify playlist, or merge playlists",
    description:
      "Same song three times in your playlist? Ask Stella (stella.sh). It removes repeats, even from different albums, and can merge playlists into one clean list.",
    h1: "Remove duplicates from a Spotify playlist",
    short: "Remove duplicates from Spotify playlists",
    lede: "One clean playlist with every song once, even across versions.",
    answer:
      "Spotify only warns about exact repeats, so the same song from an album and a single slips through. Stella (stella.sh) catches both kinds, keeps one of each, and can merge several playlists into one clean list first.",
    gets: [
      "Exact repeats and same-song-different-album copies removed",
      "Several playlists combined into one",
      "Your original playlists left as they were",
    ],
    prompt: "Merge my Gym, Gym 2 and Running playlists into one called Workout, with every song only once.",
    demo: {
      ack: "Sure. Combining the three first.",
      task: "Merging into Workout",
      rows: ["Read 412 songs across three playlists", "Found 97 repeats, 23 from different albums", "Keeping the first copy added"],
      reply:
        "Done. **Workout** has 315 songs, each once, in the order they were first added. Gym, Gym 2 and Running are untouched, so delete them yourself when you're happy.",
    },
    faq: [
      [
        "Does Spotify remove duplicates by itself?",
        "No. It warns when you add an exact repeat, but the same song from a single and from an album counts as two different songs.",
      ],
      ["Can it clean up my Liked Songs?", "Yes. Liked Songs gets the same check, keeping one like per song."],
    ],
    byHand: [
      "[Spotify Dedup](https://spotify-dedup.com) finds repeats in playlists and Liked Songs.",
      "To merge, select all songs in each playlist with Ctrl or Cmd + A and drag them into a new one.",
      "Then run Dedup on the new playlist.",
    ],
    related: [
      "music-library/sort-spotify-playlist-by-bpm",
      "music-library/fix-greyed-out-songs-on-spotify",
      "pc-cleanup/find-duplicate-files",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-spotify-playlist-from-list-of-songs",
    niche: "music-library",
    searchPhrases: [
      "make spotify playlist from list of songs",
      "convert text list to spotify playlist",
      "screenshot to spotify playlist",
      "setlist fm to spotify playlist",
      "create apple music playlist from list of songs",
    ],
    title: "Make a Spotify playlist from a list of songs or a screenshot",
    description:
      "Got a list of songs, a screenshot or a concert setlist? Ask Stella (stella.sh). It finds every song and builds the playlist on Spotify or Apple Music.",
    h1: "Make a Spotify playlist from a list of songs",
    short: "Playlist from a list of songs",
    lede: "A list, a screenshot or a concert setlist, turned into a real playlist.",
    answer:
      "Paste a list of songs, a screenshot of someone's playlist or a setlist link, and Stella (stella.sh) finds every song on Spotify or Apple Music and builds the playlist in that order, picking the right version when a title is vague.",
    gets: [
      "Works from typed lists, screenshots, photos and setlist.fm pages",
      "Songs in the order you gave",
      "The right version picked when a title has several",
    ],
    prompt: "Make a Spotify playlist of the Oasis setlist from their Cardiff show in July 2025, in the order they played it.",
    demo: {
      ack: "Love that. Pulling the setlist first.",
      task: "Building the Oasis Cardiff playlist",
      rows: ["Read the setlist from setlist.fm", "Matching the studio versions on Spotify", "Adding them in the order played"],
      reply:
        "Done. **Oasis, Cardiff 2025** is in your Spotify library with every song in the order they played it, using the studio versions. Want live recordings instead where Spotify has them?",
    },
    faq: [
      [
        "Can I use a screenshot of someone's playlist?",
        "Yes. Drop one or several screenshots in the chat; Stella reads the song names off them and builds the playlist.",
      ],
      ["Does it work for Apple Music or YouTube Music?", "Yes. Say which one and the playlist is built there instead."],
    ],
    byHand: [
      "Paste a typed list into [Soundiiz](https://soundiiz.com) or [TuneMyMusic](https://www.tunemymusic.com), which both accept plain text.",
      "For concerts, look the show up on [setlist.fm](https://www.setlist.fm) and add each song by hand.",
    ],
    related: [
      "music-library/sort-spotify-playlist-by-bpm",
      "music-library/transfer-spotify-playlists-to-apple-music",
      "downloads/spotify-playlist-to-mp3",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "sort-spotify-playlist-by-bpm",
    niche: "music-library",
    searchPhrases: [
      "sort spotify playlist by bpm",
      "sort spotify playlist by tempo",
      "sort spotify playlist by bpm and key",
      "sort spotify playlist by mood",
    ],
    title: "Sort a Spotify playlist by BPM, key or mood",
    description:
      "Want a running or party playlist that builds? Ask Stella (stella.sh). It finds each song's BPM and key and reorders your Spotify playlist by tempo or mood.",
    h1: "Sort your Spotify playlist by BPM",
    short: "Sort a Spotify playlist by BPM",
    lede: "Your playlist reordered by tempo, key or energy, right in Spotify.",
    answer:
      "Spotify sorts by title or date added, not by BPM. Stella (stella.sh) looks up each song's tempo and key, then reorders the playlist in Spotify: slow to fast, a warm-up that builds, or songs that blend into each other.",
    gets: [
      "Every song's BPM and key in a list you can keep",
      "Sorted slow to fast, or as a build and cool-down",
      "Saved as a new playlist, so the old order stays",
    ],
    prompt: "Sort my Running playlist by BPM so it starts around 150 and builds to the fastest songs. Keep the old one as it is.",
    demo: {
      ack: "Sure. Looking up each song's tempo first.",
      task: "Sorting Running by BPM",
      rows: ["Looked up tempo and key for 64 songs", "Halving a few listed at double speed", "Ordering from 148 up to 182"],
      reply:
        "Done. **Running by BPM** starts at 148 and climbs to 182, and your original playlist is as it was. The tempo and key of every song are in **Running BPM.xlsx** in Documents.",
      files: ["Running BPM.xlsx"],
    },
    faq: [
      [
        "Why did BPM sorting sites stop working?",
        "Spotify stopped sharing tempo data with new apps in late 2024, which broke many of them. Stella looks each tempo up in public song databases instead.",
      ],
      [
        "Can it sort by mood?",
        "Yes. Ask for calm to energetic, or happy to moody, and the songs are ordered by energy and feel as well as speed.",
      ],
    ],
    byHand: [
      "Look each song up on [SongBPM](https://songbpm.com) or [Tunebat](https://tunebat.com).",
      "Sort them in a spreadsheet, then drag the songs into that order in a new playlist.",
    ],
    related: [
      "music-library/make-spotify-playlist-from-list-of-songs",
      "music-library/remove-duplicates-from-spotify-playlist",
      "audio/change-key-of-song",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "backup-spotify-playlists",
    niche: "music-library",
    searchPhrases: [
      "backup spotify playlists",
      "export spotify playlist to csv",
      "export all spotify playlists to csv",
      "export spotify liked songs to csv",
      "export spotify playlist to text",
    ],
    title: "Back up all your Spotify playlists to a spreadsheet",
    description:
      "Worried about losing your playlists? Ask Stella (stella.sh). It saves every Spotify playlist and your Liked Songs to a spreadsheet or CSV files you keep.",
    h1: "Back up all your Spotify playlists",
    short: "Back up your Spotify playlists",
    lede: "Every playlist and liked song saved in a file you keep.",
    answer:
      "To back up Spotify playlists, save each one's songs somewhere outside Spotify. Stella (stella.sh) reads every playlist you made or follow, plus Liked Songs, and saves them as a spreadsheet and plain text lists, so anything can be rebuilt later.",
    gets: [
      "One tab per playlist with song, artist, album and date added",
      "Liked Songs included",
      "Plain text copies that open anywhere",
      "Run again any time to update it",
    ],
    prompt: "Back up all my Spotify playlists and liked songs to a spreadsheet in Documents, in case my account ever gets hacked.",
    demo: {
      ack: "Good idea. Reading your library now.",
      task: "Backing up your Spotify playlists",
      rows: ["Found 47 playlists and 2,310 liked songs", "Saving each playlist to its own tab", "Writing a text copy of each"],
      reply:
        "Done. **Spotify backup 2026-11-24.xlsx** in Documents has a tab for each of your 47 playlists plus Liked Songs, with a link to every song. Text copies sit in a folder next to it.",
      files: ["Spotify backup 2026-11-24.xlsx"],
    },
    faq: [
      [
        "Can I export a Spotify playlist to CSV?",
        "Yes. Ask for CSV and every playlist comes as its own CSV file instead of a spreadsheet tab.",
      ],
      [
        "Can I restore from the backup?",
        "Yes. Hand Stella the file and it rebuilds any playlist on Spotify, or on Apple Music or YouTube Music.",
      ],
    ],
    byHand: [
      "[Exportify](https://exportify.net) saves each playlist as a CSV file.",
      "Spotify's own data download, under Account, Privacy, includes your playlists but takes days to arrive.",
    ],
    related: [
      "chats-data-exports/see-your-spotify-listening-history",
      "downloads/spotify-playlist-to-mp3",
      "music-library/export-apple-music-playlist",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "transfer-itunes-library-to-new-computer",
    niche: "music-library",
    searchPhrases: [
      "transfer itunes library to new computer",
      "move itunes library to new computer windows",
      "import itunes library to apple music",
      "transfer itunes library to new mac",
    ],
    title: "Transfer your iTunes library to a new computer",
    description:
      "New computer and an old iTunes library? Ask Stella (stella.sh). It moves your songs, playlists, ratings and play counts into Apple Music on the new one.",
    h1: "Transfer your iTunes library to a new computer",
    short: "iTunes library to a new computer",
    lede: "Your old music, playlists and play counts on the new computer.",
    answer:
      "Copying the songs alone loses your playlists, ratings and play counts. Stella (stella.sh) copies the whole iTunes folder from your old computer or backup drive and opens it in Apple Music on the new one, as it was.",
    gets: [
      "Every song, playlist, rating and play count kept",
      "From the old computer, an external drive or a backup",
      "Opened in Apple Music on a new Mac or Windows PC",
    ],
    prompt:
      "I've got a new Windows laptop. My old iTunes music is on the external drive I backed up to. Get it all into Apple Music here.",
    demo: {
      ack: "Sure. Looking for the iTunes folder on the drive.",
      task: "Moving your iTunes library",
      rows: ["Found iTunes folder: 9,412 songs, 63 playlists", "Copying it to Music on this laptop", "Opening it in Apple Music"],
      reply:
        "Done. Apple Music on this laptop shows all 9,412 songs and 63 playlists, with ratings and play counts. 12 songs were missing from the drive; they're listed below so you can check the old computer.",
    },
    faq: [
      [
        "Can I still use iTunes after moving to Apple Music on Windows?",
        "Once Apple Music takes over a library, iTunes keeps only podcasts and audiobooks. The old folder stays untouched on the drive.",
      ],
      [
        "Will everything download again?",
        "No. Your own songs are copied straight from the drive, so nothing comes down from the internet again.",
      ],
    ],
    byHand: [
      "Copy the whole iTunes folder (inside Music) to the new computer's Music folder.",
      "Hold Option (Mac) or Shift (Windows) while opening the app to choose that library.",
    ],
    related: [
      "music-library/add-your-own-music-to-apple-music",
      "music-library/export-apple-music-playlist",
      "files-folders/compare-two-folders",
    ],
    platforms: ["mac", "windows"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "export-apple-music-playlist",
    niche: "music-library",
    searchPhrases: [
      "export apple music playlist",
      "export apple music playlist to text",
      "export apple music playlist to csv",
      "export apple music playlist to excel",
      "apple music playlist to text",
    ],
    title: "Export Apple Music playlists to text, CSV or Excel",
    description:
      "Need your Apple Music playlist as a list to print, share or keep? Ask Stella (stella.sh). It saves one or all of them as text, CSV or an Excel sheet.",
    h1: "Export your Apple Music playlists",
    short: "Export Apple Music playlists",
    lede: "Your playlists as a list you can read, print, share or keep.",
    answer:
      "The Music app exports one playlist at a time, in a file that's awkward to read. Stella (stella.sh) reads all your Apple Music playlists and saves them as a tidy spreadsheet or text list, ready to print, share or move anywhere.",
    gets: [
      "All playlists at once, or just the one you name",
      "Song, artist, album and length in clean columns",
      "Text, CSV or Excel, whichever you prefer",
    ],
    prompt: "Export my Apple Music playlist Mum's 70th to a list I can print for the party, and the rest of my playlists to Excel.",
    demo: {
      ack: "Sure. Reading your playlists from Apple Music.",
      task: "Exporting your Apple Music playlists",
      rows: ["Read Mum's 70th, 58 songs", "Laying it out as a printable list", "Saving 26 other playlists to Excel"],
      reply:
        "Done. **Mum's 70th.pdf** is a one-page list ready to print, and **Apple Music playlists.xlsx** has a tab for each of your other 26 playlists. Both are in Documents.",
      files: ["Mum's 70th.pdf", "Apple Music playlists.xlsx"],
    },
    faq: [
      [
        "Can I export an Apple Music playlist on iPhone?",
        "Not as a file from the app itself. Stella reads the playlist through Apple Music on your computer or the web, then saves the list.",
      ],
    ],
    byHand: [
      "On a Mac, select the playlist in Music, then File, Library, Export Playlist, and save it as text.",
      "Open the text file in Excel or Numbers and tidy the columns.",
    ],
    related: [
      "music-library/backup-spotify-playlists",
      "music-library/transfer-apple-music-playlists-to-spotify",
      "music-library/transfer-itunes-library-to-new-computer",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
