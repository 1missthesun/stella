import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const DOWNLOADS_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "download-youtube-videos",
    niche: "downloads",
    searchPhrases: [
      "how to download youtube videos",
      "save youtube video to computer",
      "download youtube videos windows",
      "yt-dlp how to download",
      "save youtube video as file",
    ],
    title: "Download YouTube videos to your computer, in full quality",
    description:
      "Want a YouTube video saved on your computer? Paste the link to Stella (stella.sh). It saves the video in the best quality, as an MP4 that plays anywhere.",
    h1: "Download YouTube videos to your computer",
    short: "Download YouTube videos",
    lede: "Paste a link, get the video saved as a file that plays anywhere.",
    answer:
      "The cleanest way to download YouTube videos is yt-dlp, the free tool most download sites quietly run. Stella (stella.sh) sets it up on your computer and saves the video in the best quality YouTube offers, as an MP4.",
    gets: ["The video at full resolution, up to 4K", "An MP4 your phone, TV and editor all play", "No ad-filled converter sites"],
    prompt:
      "Download this YouTube video in the best quality and put it in my Videos folder: youtube.com/watch?v=dQw4w9WgXcQ",
    demo: {
      ack: "Sure. Grabbing the best version YouTube has.",
      task: "Saving your YouTube video",
      rows: ["Setting up yt-dlp", "Fetching the 1080p picture and sound", "Joining them into one MP4"],
      reply:
        "Done. The video is in **Videos** at 1080p with full sound, named after its title. Send me any other link the same way.",
      files: ["Never Gonna Give You Up.mp4"],
    },
    faq: [
      ["How do I use yt-dlp to download a video?", "Install yt-dlp and ffmpeg, then give yt-dlp the video's link. Stella installs both, picks the best quality and keeps them up to date."],
      ["Why are my YouTube downloads only 360p or have no sound?", "YouTube keeps high quality picture and sound apart. A good download fetches both and joins them; cheap sites skip that step."],
    ],
    byHand: [
      "Install [yt-dlp](https://github.com/yt-dlp/yt-dlp), ffmpeg and Deno, which yt-dlp now needs for YouTube. On a Mac: brew install yt-dlp ffmpeg deno.",
      "Run yt-dlp -t mp4 followed by the link, from the folder you want it in.",
      "If it suddenly fails, update it with yt-dlp -U: YouTube changes often.",
    ],
    related: ["downloads/download-youtube-playlist", "downloads/youtube-to-mp3", "video/turn-long-video-into-shorts"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "download-youtube-playlist",
    niche: "downloads",
    searchPhrases: [
      "download youtube playlist",
      "download whole youtube playlist at once",
      "download youtube playlist to usb",
      "download youtube playlist as separate mp3",
      "download youtube playlist to files",
    ],
    title: "Download a whole YouTube playlist at once, numbered in order",
    description:
      "Need every video in a YouTube playlist? Ask Stella (stella.sh). It saves the whole list in one go, numbered in playlist order, as videos or MP3s.",
    h1: "Download a whole YouTube playlist",
    short: "Download a YouTube playlist",
    lede: "Every video in the playlist saved in one go, in the right order.",
    answer:
      "To download a YouTube playlist, give a downloader the playlist link instead of one video. Stella (stella.sh) saves every entry into its own folder, numbers the files in order and picks up where it stopped if your connection drops.",
    gets: ["Every video, numbered 01, 02, 03", "Video files or MP3s, your pick", "New additions fetched next time, nothing twice"],
    prompt:
      "Download every video in this cooking course playlist into a folder on my USB stick, in order: youtube.com/playlist?list=PL…",
    demo: {
      ack: "On it. Reading the playlist first.",
      task: "Saving the cooking course playlist",
      rows: ["Found 42 videos in the playlist", "Saving each one at 1080p", "Numbering them in playlist order"],
      reply:
        "Done. All 42 lessons are on your USB stick in **Cooking Course**, named 01 to 42 with their titles. Ask again later and I'll add only the new ones.",
    },
    faq: [
      ["How do I download a YouTube playlist as separate MP3s?", "Ask for MP3s instead of video. Each entry becomes its own MP3 with the song or episode title, numbered in playlist order."],
      ["Can it download a private or unlisted playlist?", "Unlisted ones, yes, from the link. For your own private lists, it uses your signed-in browser so YouTube knows it's you."],
    ],
    byHand: [
      "With [yt-dlp](https://github.com/yt-dlp/yt-dlp) installed, run it with the playlist link.",
      "Add -o \"%(playlist_index)02d %(title)s.%(ext)s\" to number the files.",
      "Add --download-archive done.txt so a second run skips what you already have.",
    ],
    related: ["downloads/download-youtube-videos", "downloads/youtube-to-mp3", "downloads/spotify-playlist-to-mp3"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "youtube-to-mp3",
    niche: "downloads",
    searchPhrases: [
      "youtube to mp3",
      "youtube to mp3 high quality",
      "save audio from youtube video",
      "youtube link to mp3",
      "youtube to mp3 with album art",
    ],
    title: "YouTube to MP3 in high quality, with title and cover",
    description:
      "Want the sound from a YouTube link as an MP3? Ask Stella (stella.sh). It saves the best audio YouTube has, tagged with the title and cover art.",
    h1: "YouTube to MP3, in high quality",
    short: "YouTube to MP3",
    lede: "The sound from any YouTube link, as a tidy MP3 for your phone.",
    answer:
      "For YouTube to MP3, take the best audio YouTube streams and save it as an MP3 at a high setting. Stella (stella.sh) does that from the link, without converter sites, and fills in the title, artist and cover.",
    gets: ["An MP3 from the best sound on offer", "Title, artist and thumbnail cover filled in", "Ready for your phone, car or music app"],
    prompt:
      "Turn this YouTube live set into an MP3 for my phone and put it in my Music folder: youtube.com/watch?v=…",
    demo: {
      ack: "Sure. Taking just the sound.",
      task: "Saving the live set as an MP3",
      rows: ["Fetching the best audio from YouTube", "Saving a high quality MP3", "Adding the title and cover"],
      reply:
        "Done. The 58 minute set is in **Music** as an MP3, with the video thumbnail as its cover. It shows up properly in your music app.",
      files: ["Boiler Room Set.mp3"],
    },
    faq: [
      ["What quality is a YouTube MP3?", "YouTube's best audio sits around 128 to 160 kbps. Saving at 320 kbps keeps all of it; going higher adds nothing."],
      ["Can I get M4A or FLAC instead of MP3?", "M4A, yes, and it keeps YouTube's sound with no conversion at all. FLAC would only make the file bigger."],
    ],
    byHand: [
      "Install [yt-dlp](https://github.com/yt-dlp/yt-dlp) and ffmpeg.",
      "Run yt-dlp -x --audio-format mp3 --audio-quality 0 --embed-thumbnail --embed-metadata followed by the link.",
    ],
    related: ["downloads/download-youtube-playlist", "downloads/download-youtube-videos", "audio/edit-mp3-tags-in-bulk"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "download-tiktok-without-watermark",
    niche: "downloads",
    searchPhrases: [
      "download tiktok without watermark",
      "how to download tiktok videos on pc",
      "download tiktok without watermark hd",
      "download all tiktok videos from an account",
      "save my own tiktoks without watermark",
    ],
    title: "Download TikTok videos without the watermark, in HD",
    description:
      "Want a TikTok saved clean, with no logo bouncing around? Ask Stella (stella.sh). It saves the HD original without the watermark, one video or a whole account.",
    h1: "Download TikTok videos without the watermark",
    short: "Download TikToks without watermark",
    lede: "TikToks saved clean in HD, with no logo or username stamped on.",
    answer:
      "TikTok's own save button stamps a moving logo on the video, but the clean original is still there behind it. Stella (stella.sh) saves that version in HD, for one link or every post on an account.",
    gets: ["The clean HD video, no logo or username", "One link, or every post from a profile", "Files named by date and caption"],
    prompt:
      "Save all my old TikToks from @maya.bakes without the watermark so I can repost them on Reels and Shorts.",
    demo: {
      ack: "On it. Finding every post on your profile.",
      task: "Saving your TikToks clean",
      rows: ["Found 86 videos on @maya.bakes", "Saving each clean original in HD", "Naming them by date and caption"],
      reply:
        "Done. All 86 videos are in **Videos/TikTok maya.bakes**, with no logo or username, newest first. They're ready to post on Reels and Shorts.",
    },
    faq: [
      ["How do I download TikTok videos on PC?", "Paste the link to Stella, or use yt-dlp. The TikTok website's own download adds the watermark, and the app does the same."],
      ["Can it save TikTok slideshows and sounds?", "Yes. Photo posts come out as the separate pictures plus the sound, and a sound on its own comes out as an MP3."],
    ],
    byHand: [
      "Install [yt-dlp](https://github.com/yt-dlp/yt-dlp) and run it with the TikTok link. It picks the clean version.",
      "For a whole profile, give it the profile link (tiktok.com/@name) instead.",
      "If TikTok blocks it, add --cookies-from-browser chrome so it uses your login.",
    ],
    related: ["downloads/download-instagram-reels", "video/make-instagram-reel", "downloads/download-youtube-videos"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "download-twitch-vods",
    niche: "downloads",
    searchPhrases: [
      "download twitch vods",
      "download twitch vod with chat",
      "how to download twitch vods as a viewer",
      "download twitch vod from link",
      "save twitch stream before it gets deleted",
    ],
    title: "Download Twitch VODs before they expire, with chat if you like",
    description:
      "A stream you want to keep is about to vanish? Ask Stella (stella.sh) to download the Twitch VOD in full quality, with the chat drawn beside it if you want.",
    h1: "Download Twitch VODs before they disappear",
    short: "Download Twitch VODs",
    lede: "A past stream saved for good, in full quality, chat included.",
    answer:
      "Twitch deletes past broadcasts after a week or two, so download the VOD while it's up. Stella (stella.sh) saves it in source quality from the link and can draw the chat next to the picture.",
    gets: ["The whole stream in source quality", "Chat drawn beside it, if you want", "Just one part, by start and end time"],
    prompt:
      "Download yesterday's 6 hour stream from my Twitch channel, with the chat on the right, before Twitch deletes it.",
    demo: {
      ack: "Sure. Grabbing the full stream first.",
      task: "Saving yesterday's Twitch stream",
      rows: ["Saving the 6 hour VOD at 1080p60", "Fetching every chat message", "Drawing the chat beside the stream"],
      reply:
        "Done. Two files in **Videos/Twitch**: the plain stream, and a version with chat running down the right side. Both are full length.",
      files: ["stream 2026-11-23.mp4", "stream 2026-11-23 with chat.mp4"],
    },
    faq: [
      ["How long do Twitch VODs last?", "7 days for most channels, 60 for Partners and for streamers with Turbo or Prime. Highlights stay until deleted."],
      ["How do I download Twitch VODs as a viewer?", "The same way: paste the VOD link. Subscriber-only VODs work once you're signed in to Twitch in your browser."],
    ],
    byHand: [
      "The free [TwitchDownloader](https://github.com/lay295/TwitchDownloader) saves VODs, clips and chat, and can render chat as a video.",
      "Or run yt-dlp with the VOD link; add --download-sections \"*1:00:00-1:30:00\" for one part.",
    ],
    related: ["video/twitch-clips-to-tiktok", "downloads/download-youtube-videos", "video/compress-video-for-discord"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "download-instagram-reels",
    niche: "downloads",
    searchPhrases: [
      "download instagram reels to computer",
      "how to download instagram reels on mac",
      "download instagram reels chrome extension",
      "save instagram reel with sound",
      "download instagram reels in bulk",
    ],
    title: "Download Instagram Reels to your computer, with sound",
    description:
      "Want an Instagram Reel saved on your PC or Mac? Ask Stella (stella.sh). It saves the Reel in full quality with its sound, from a link or a whole profile.",
    h1: "Download Instagram Reels to your computer",
    short: "Download Instagram Reels",
    lede: "Reels saved as normal video files, sound and all.",
    answer:
      "Instagram has no download button for Reels on a computer, so most extensions screen-record or grab a blurry copy. Stella (stella.sh) saves the original file with its sound, using your own Instagram sign-in in the browser when a Reel needs it.",
    gets: ["The Reel in its original quality", "Sound included, not a silent clip", "One link, or all Reels from a profile"],
    prompt:
      "Save all the Reels from my bakery's Instagram page to a folder on my Mac so I have a backup of them.",
    demo: {
      ack: "On it. Opening your bakery's profile.",
      task: "Backing up your Instagram Reels",
      rows: ["Found 34 Reels on the profile", "Saving each with its sound", "Adding the caption to each name"],
      reply:
        "Done. All 34 Reels are in **Movies/Instagram Reels**, full quality with sound, named by date and caption. Ask again anytime to add the newest ones.",
    },
    faq: [
      ["How do I download Instagram Reels on Mac?", "Paste the Reel's link to Stella and it lands in Movies. By hand, yt-dlp works on a Mac too."],
      ["Why do downloaded Reels have no sound?", "Some tools save only the picture, which Instagram keeps apart from the audio. Saving both and joining them fixes it."],
    ],
    byHand: [
      "Install [yt-dlp](https://github.com/yt-dlp/yt-dlp) and ffmpeg, then run yt-dlp with the Reel's link.",
      "If Instagram asks for a login, add --cookies-from-browser chrome (or firefox, safari).",
    ],
    related: ["downloads/download-tiktok-without-watermark", "video/make-instagram-reel", "downloads/download-video-from-website"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "download-video-from-website",
    niche: "downloads",
    searchPhrases: [
      "download embedded video from website",
      "download video from website",
      "how to download vimeo embedded videos",
      "download vimeo video",
      "download video from website to mp4",
    ],
    title: "Download an embedded or Vimeo video from any web page",
    description:
      "Found a video on a page with no download button? Ask Stella (stella.sh). It finds the video behind the player, Vimeo or otherwise, and saves it as an MP4.",
    h1: "Download an embedded video from a website",
    short: "Download a video from a web page",
    lede: "The video inside any web page, saved as an MP4 you can keep.",
    answer:
      "An embedded video still comes from a real file or stream behind the player. Stella (stella.sh) opens the page in your browser, finds that source, Vimeo or a site's own player, and saves the full video as an MP4.",
    gets: ["The video at the best size the page offers", "Works on Vimeo, course sites and news pages", "Pages you're signed in to, as you"],
    prompt:
      "Save the welcome video on my online course page as an MP4 so I can watch it on the train. The link is in my browser.",
    demo: {
      ack: "Sure. Looking at what's behind the player.",
      task: "Saving the video from your course page",
      rows: ["Opening the course page in your browser", "Found a Vimeo player inside it", "Saving the 1080p version"],
      reply:
        "Done. The 24 minute welcome video is in **Downloads** as an MP4, in 1080p. Send any other lesson page and I'll do the same.",
      files: ["Course welcome video.mp4"],
    },
    faq: [
      ["How do I download a Vimeo video with a password?", "Give Stella the link and the password, the way you'd type it on the page. yt-dlp takes it with --video-password."],
      ["Why does right-click Save video not work?", "Most players stream the video in small pieces, so there is no single file to save. Those pieces have to be fetched and joined."],
    ],
    byHand: [
      "Try [yt-dlp](https://github.com/yt-dlp/yt-dlp) with the page's link first; it knows Vimeo and thousands of other players.",
      "For a Vimeo video embedded on another site, add --referer followed by that site's address.",
      "Otherwise, play it with the browser's Network tab open and hand yt-dlp the .m3u8 address you find.",
    ],
    related: ["downloads/download-youtube-videos", "downloads/download-instagram-reels", "video/convert-webm-to-mp4"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "download-all-podcast-episodes",
    niche: "downloads",
    searchPhrases: [
      "download all episodes of a podcast",
      "download podcast mp3",
      "download podcast from rss feed",
      "download podcasts as mp3",
      "download entire podcast back catalogue",
    ],
    title: "Download every episode of a podcast as MP3s, in order",
    description:
      "Want a podcast's whole back catalogue on your computer? Ask Stella (stella.sh). It saves every episode as an MP3, named by date and title, oldest first.",
    h1: "Download all episodes of a podcast as MP3s",
    short: "Download a whole podcast",
    lede: "A show's whole back catalogue saved as files, oldest episode first.",
    answer:
      "Almost every podcast publishes a public feed listing each episode's MP3. Stella (stella.sh) finds the show's feed, downloads every episode in it and names the files by date and title so they sort in order.",
    gets: ["Every episode the feed lists, as MP3s", "Named by date and title, oldest first", "Show art and episode notes kept with each"],
    prompt:
      "Download every episode of the Hardcore History podcast as MP3s into a folder so I can listen offline on a long trip.",
    demo: {
      ack: "On it. Finding the show's feed.",
      task: "Downloading the whole podcast",
      rows: ["Found the show's public feed", "Saving each episode as an MP3", "Naming them by date and title"],
      reply:
        "Done. Every episode in the feed is in **Music/Podcasts/Hardcore History**, oldest first, with the show's art. They play in any podcast or music app.",
    },
    faq: [
      ["How do I download a podcast from its RSS feed?", "Paste the feed into a podcast app like gPodder and choose download all, or give the feed to Stella. Each item in the feed links its MP3."],
      ["Can I download a podcast I hear on Spotify?", "Yes, when the show also has a public feed, which most do. Stella looks it up by the show's name."],
    ],
    byHand: [
      "Find the show's feed: Apple Podcasts pages and [podcastindex.org](https://podcastindex.org) list it.",
      "Add it to the free [gPodder](https://gpodder.github.io), select every episode and press Download.",
    ],
    related: ["audio/make-audiobook-with-chapters", "downloads/youtube-to-mp3", "audio/transcribe-voice-memos-to-text"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "spotify-playlist-to-mp3",
    niche: "downloads",
    searchPhrases: [
      "spotify playlist to mp3 files",
      "download spotify playlist to mp3 player",
      "get my spotify playlist as files",
      "spotify playlist to mp3 with album art",
      "move spotify playlist to usb",
    ],
    title: "Get your Spotify playlist as MP3 files, with covers",
    description:
      "Want your Spotify playlist on an MP3 player, USB stick or in the car? Ask Stella (stella.sh). You get every song as an MP3 with its title, artist and cover.",
    h1: "Get your Spotify playlist as MP3 files",
    short: "Spotify playlist to MP3 files",
    lede: "Your playlist as real song files for an MP3 player, USB or car.",
    answer:
      "Spotify keeps its offline songs locked inside the app, so they won't copy to anything else. Stella (stella.sh) reads your playlist, fetches each song as an MP3 and labels it with the right title, artist and album cover.",
    gets: ["Every song as an MP3, in playlist order", "Title, artist, album and cover on each", "A playlist file your player understands"],
    prompt:
      "Get my Spotify playlist Gym 2026 as MP3 files with covers, so I can put it on my running MP3 player.",
    demo: {
      ack: "Sure. Reading the playlist first.",
      task: "Turning Gym 2026 into MP3s",
      rows: ["Found 52 songs in Gym 2026", "Fetching each song as an MP3", "Adding titles, artists and covers"],
      reply:
        "Done. All 52 songs are in **Music/Gym 2026** as MP3s, numbered in playlist order with covers, plus a playlist file. Copy the folder to your player and they show up right.",
    },
    faq: [
      ["Why can't I copy Spotify downloads to a USB stick?", "Spotify's offline songs are scrambled and only open inside the Spotify app. You need regular MP3s instead."],
      ["Can I do my Liked Songs too?", "Yes. Liked Songs works like any other playlist once you're signed in to Spotify in your browser."],
    ],
    byHand: [
      "The free [spotDL](https://github.com/spotDL/spotify-downloader) reads a Spotify playlist and finds each song on YouTube Music.",
      "Install it with pip install spotdl, then run spotdl followed by the playlist link.",
      "Add --m3u to also get a playlist file for your player.",
    ],
    related: ["downloads/download-youtube-playlist", "audio/edit-mp3-tags-in-bulk", "chats-data-exports/see-your-spotify-listening-history"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "rip-cd-to-flac-or-mp3",
    niche: "downloads",
    searchPhrases: [
      "rip cd to flac",
      "rip cd to mp3",
      "rip cd to mp3 with track names",
      "rip cd to flac with metadata",
      "rip cd collection to computer",
    ],
    title: "Rip a CD to FLAC or MP3, with track names and covers",
    description:
      "Got a shelf of CDs? Ask Stella (stella.sh) to rip them to FLAC or MP3 with the right track names, album covers and a folder per album.",
    h1: "Rip a CD to FLAC or MP3 with track names",
    short: "Rip a CD to FLAC or MP3",
    lede: "Your CDs on your computer, every track named, every album with art.",
    answer:
      "To rip a CD to FLAC or MP3, read each track off the disc, then look the album up so the tracks get real names. Stella (stella.sh) does both, adds the cover and files each album in its own folder.",
    gets: ["FLAC for a perfect copy, MP3 for small files, or both", "Real track names, artist and album cover", "One folder per album, ready for any music app"],
    prompt:
      "I'm putting my CD collection on my laptop. Rip the CD in the drive to FLAC, and make MP3 copies for my phone.",
    demo: {
      ack: "On it. Looking the album up first.",
      task: "Ripping your CD",
      rows: ["Found Rumours, 11 tracks", "Reading each track off the disc", "Saving FLAC and MP3 copies with covers"],
      reply:
        "Done. **Fleetwood Mac/Rumours** is in your Music folder as FLAC, with a matching MP3 folder for your phone. Put the next CD in and tell me.",
      files: ["01 Second Hand News.flac", "02 Dreams.flac"],
    },
    faq: [
      ["Should I rip my CDs to FLAC or MP3?", "FLAC keeps the CD's sound exactly and takes about half the space of the disc. MP3 is a tenth of the size and fine for phones. Many people keep both."],
      ["Why does my ripped CD say Track 01, Unknown Artist?", "The ripper couldn't look the album up. Matching the disc against MusicBrainz fills in names, artist and cover."],
    ],
    byHand: [
      "Windows: the free [Exact Audio Copy](https://www.exactaudiocopy.de) or fre:ac rips to FLAC and MP3 with track names.",
      "Mac: [XLD](https://tmkk.undo.jp/xld/) does the same. A Mac needs a USB CD drive.",
      "Linux: fre:ac, or whipper for exact copies.",
    ],
    related: ["audio/convert-flac-to-mp3", "audio/edit-mp3-tags-in-bulk", "downloads/rip-dvd-to-mp4"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "rip-dvd-to-mp4",
    niche: "downloads",
    searchPhrases: [
      "rip dvd to mp4",
      "rip blu ray to mp4",
      "rip dvd to mp4 handbrake",
      "rip blu ray with makemkv",
      "rip dvd collection to plex",
    ],
    title: "Rip a DVD or Blu-ray to MP4 (MakeMKV and HandBrake)",
    description:
      "Want your DVDs and Blu-rays as files for Plex, a laptop or a TV? Ask Stella (stella.sh). It rips the main film to an MP4, keeping the sound and subtitles.",
    h1: "Rip a DVD or Blu-ray to MP4",
    short: "Rip a DVD or Blu-ray to MP4",
    lede: "Your discs as movie files, main film found, subtitles kept.",
    answer:
      "To rip a DVD or Blu-ray to MP4, copy the disc with MakeMKV, then shrink the main film to an MP4 with HandBrake. Stella (stella.sh) runs both, picks the real movie out of the extras and names it for Plex.",
    gets: ["The main film found, not a trailer or extra", "Surround sound and subtitles carried over", "Named so Plex and Jellyfin find the poster"],
    prompt:
      "Rip the Blu-ray of Dune in my drive to an MP4 for my Plex server, with English subtitles, and name it properly.",
    demo: {
      ack: "Sure. Reading the disc first.",
      task: "Ripping Dune to your Plex folder",
      rows: ["Copying the disc with MakeMKV", "Picking the 2h35m main film", "Making a 1080p MP4 with subtitles"],
      reply:
        "Done. **Dune (2021).mp4** is in your Plex Movies folder in 1080p, with the 5.1 sound and English subtitles. Plex will pick up the poster on its next scan.",
    },
    faq: [
      ["Why does HandBrake say no valid source found on my DVD?", "Most bought DVDs and Blu-rays are locked, and HandBrake can't open them alone. MakeMKV reads the disc first, then HandBrake converts that copy."],
      ["How big is a ripped movie?", "A DVD comes out around 1 to 2 GB as an MP4, a Blu-ray around 4 to 8 GB at 1080p. A straight MakeMKV copy is far bigger."],
    ],
    byHand: [
      "Install [MakeMKV](https://www.makemkv.com), open the disc and save the longest title as an MKV.",
      "Open that MKV in [HandBrake](https://handbrake.fr), pick the Fast 1080p30 preset, choose MP4 and add the sound and subtitle tracks you want.",
      "Name it Title (Year).mp4 so Plex matches it.",
    ],
    related: ["downloads/rip-cd-to-flac-or-mp3", "torrenting/rename-organize-downloads-for-plex", "video/convert-mkv-to-mp4"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "hevc-video-wont-play",
    niche: "downloads",
    searchPhrases: [
      "hevc video won't play",
      "can't play hevc files",
      "hevc codec windows 11",
      "h.265 video won't play",
      "convert hevc to h264",
    ],
    title: "HEVC (H.265) video won't play? Make it play anywhere",
    description:
      "Video plays sound but no picture, or won't open at all? It's usually HEVC. Ask Stella (stella.sh) to make it play on your PC or convert it for everything.",
    h1: "HEVC video won't play",
    short: "Fix HEVC video that won't play",
    lede: "Videos from new phones and cameras playing on every screen you own.",
    answer:
      "New phones, cameras and downloads often save video as HEVC (H.265), which Windows, older TVs and many editors won't open without help. Stella (stella.sh) gets your player handling it, or saves H.264 copies that play everywhere.",
    gets: ["Your videos playing on this computer", "H.264 copies for old TVs and editors", "Originals untouched, same look and sound"],
    prompt:
      "The videos from my new camera won't play on my Windows laptop, just a black screen with sound. Make them work.",
    demo: {
      ack: "On it. Checking how they were saved.",
      task: "Getting your camera videos to play",
      rows: ["They're HEVC (H.265), 4K", "Setting up a player that opens them", "Saving H.264 copies for everything else"],
      reply:
        "Done. They play now on your laptop, and **Camera videos (H.264)** has copies that open on your TV and in any editor. The originals are as they were.",
    },
    faq: [
      ["How do I get the HEVC codec on Windows 11?", "Microsoft sells HEVC Video Extensions in the Store. Free routes: VLC plays HEVC by itself, or convert the file to H.264."],
      ["Does converting HEVC to H.264 lose quality?", "Not visibly at a high setting, but the copy is often bigger, since H.264 needs more space for the same picture."],
    ],
    byHand: [
      "Play it in the free [VLC](https://www.videolan.org), which handles HEVC on Windows, Mac and Linux.",
      "To convert, open it in [HandBrake](https://handbrake.fr), pick a Fast preset, set Video Encoder to H.264 and press Start.",
      "On an iPhone, Settings, Camera, Formats, Most Compatible films in H.264 from now on.",
    ],
    related: ["video/convert-mov-to-mp4", "video/convert-mkv-to-mp4", "downloads/fix-audio-out-of-sync-with-video"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "separate-song-into-stems",
    niche: "downloads",
    searchPhrases: [
      "how to get stems of a song",
      "separate stems from audio",
      "separate stems free",
      "how to get stems out of a song",
      "split song into stems",
    ],
    title: "Get the stems of a song: vocals, drums, bass and more",
    description:
      "Remixing, sampling or practising? Ask Stella (stella.sh) to split any song into stems on your own computer: vocals, drums, bass, guitar, piano and the rest.",
    h1: "Get the stems of a song",
    short: "Split a song into stems",
    lede: "One song split into vocals, drums, bass and the rest, ready to remix.",
    answer:
      "To get the stems of a song, run it through a free AI splitter like Demucs that pulls each instrument apart. Stella (stella.sh) does it on your computer and hands you a separate WAV for each part, lined up to the same beat.",
    gets: ["Vocals, drums, bass and the rest as separate WAVs", "Guitar and piano split out too, if you want", "All starting at the same moment, ready to drop in"],
    prompt:
      "Split Night Drive.wav in my Music folder into stems, vocals, drums, bass and the rest, so I can remix it in FL Studio.",
    demo: {
      ack: "Sure. Splitting it into four parts.",
      task: "Splitting Night Drive into stems",
      rows: ["Setting up Demucs on your computer", "Separating vocals, drums, bass and other", "Saving each part as a WAV"],
      reply:
        "Done. **Night Drive stems** sits next to the song with four WAVs, all the same length. Drag them into FL Studio and they line up.",
      files: ["vocals.wav", "drums.wav", "bass.wav", "other.wav"],
    },
    faq: [
      ["What's the best free way to separate stems?", "Demucs, the open model most stem tools are built on. Ultimate Vocal Remover puts it behind simple buttons. Both run on your own computer."],
      ["Can I separate stems in FL Studio or Logic?", "Recent FL Studio and Logic Pro versions have a stem splitter built in. Demucs on its own often sounds cleaner."],
    ],
    byHand: [
      "Install [Ultimate Vocal Remover](https://github.com/Anjok07/ultimatevocalremovergui), choose Demucs and the htdemucs_ft model.",
      "Pick All Stems, choose WAV and press Start. Use htdemucs_6s to split guitar and piano too.",
    ],
    related: ["audio/make-karaoke-version-of-song", "audio/change-key-of-song", "audio/slow-down-song-without-changing-pitch"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "fix-audio-out-of-sync-with-video",
    niche: "downloads",
    searchPhrases: [
      "fix audio out of sync with video",
      "fix out of sync audio mp4",
      "downloaded video no sound",
      "downloaded video no audio",
      "audio drifts out of sync screen recording",
    ],
    title: "Fix audio out of sync with video, or a video with no sound",
    description:
      "Voices land late, or a downloaded video plays in silence? Ask Stella (stella.sh) to fix the file itself so the sound plays and lines up with the lips.",
    h1: "Fix audio out of sync with video, or no sound",
    short: "Fix out-of-sync or missing sound",
    lede: "The sound back in your video and lined up with the picture.",
    answer:
      "To fix audio out of sync with video, shift the sound by the gap or, if it drifts, even out the frame timing. A silent download usually has sound your player can't read. Stella (stella.sh) finds which it is and saves a fixed copy.",
    gets: ["Sound that matches the lips start to end", "Silent videos playing with sound", "A fixed copy, original kept"],
    prompt:
      "In my phone video of the school play the voices come about half a second late, and it gets worse. Fix it.",
    demo: {
      ack: "On it. Measuring how far the sound is off.",
      task: "Lining the sound up with the picture",
      rows: ["Sound starts 0.4 seconds late", "Gap grows as the frame rate wobbles", "Steadying the frames and moving the sound"],
      reply:
        "Done. **School play (fixed).mp4** is next to the original, with the voices on the lips from first line to curtain call.",
    },
    faq: [
      ["Why does my downloaded video have no sound?", "Either only the picture was saved, or the sound is in a format your player skips, like Opus or DTS. Converting the sound to AAC fixes the second."],
      ["How do I fix out of sync audio in VLC?", "Press J or K to nudge the sound while you watch. That only fixes playback; the file itself stays out of sync."],
    ],
    byHand: [
      "Fixed gap: ffmpeg -i in.mp4 -itsoffset 0.4 -i in.mp4 -map 0:v -map 1:a -c copy out.mp4.",
      "Drifting sync from phones and screen recordings: re-save in HandBrake with Constant Framerate ticked.",
      "No sound: open it in VLC, Tools, Codec Information to see the sound format.",
    ],
    related: ["downloads/hevc-video-wont-play", "video/make-video-louder", "downloads/download-youtube-videos"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
