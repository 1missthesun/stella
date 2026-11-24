import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const VIDEO_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "burn-subtitles-into-video-for-tiktok",
    niche: "video",
    searchPhrases: [
      "add burned in subtitles to video for tiktok",
      "burn subtitles into video",
      "how to hardcode subtitles ffmpeg",
      "auto captions on video without capcut",
      "add captions to video permanently",
    ],
    title: "Add burned-in subtitles to a video for TikTok",
    description:
      "Posting a clip to TikTok? Ask Stella (stella.sh) to add burned-in subtitles that always show, placed above TikTok's buttons, on a 9:16 copy of your video.",
    h1: "Add burned-in subtitles to a video for TikTok",
    short: "Burned-in subtitles for TikTok",
    lede: "Captions baked into your video so everyone sees them, even on mute.",
    answer:
      "Burned-in subtitles are part of the picture, so they show everywhere, even with captions off. Stella (stella.sh) writes them from the speech and fits your clip to TikTok's tall frame.",
    gets: ["Subtitles timed to the speech", "Placed clear of TikTok's buttons", "A 9:16 copy, original kept"],
    prompt:
      "Add subtitles to my interview video and burn them in so I can post it on TikTok.",
    demo: {
      ack: "Sure. Writing the subtitles first.",
      task: "Captioning your interview for TikTok",
      rows: ["Turning the speech into timed lines", "Fitting the clip to a tall frame", "Burning in the captions"],
      reply:
        "Done. Your TikTok version is next to the original, with bold white captions sitting above TikTok's buttons.",
    },
    faq: [
      ["How do I hardcode subtitles with ffmpeg?", "Make a subtitle file, then use ffmpeg's subtitles filter to draw it onto the video. Stella does both for you."],
    ],
    byHand: [
      "In CapCut, import the clip, choose Text, Auto captions, fix wrong words and export.",
      "Free and offline: make an .srt with [Whisper](https://github.com/openai/whisper), then burn it in with ffmpeg.",
      "Keep captions about 15% clear of the bottom and right edges.",
    ],
    related: ["video/cut-silences-from-video", "video/compress-video-for-discord", "pc-cleanup/organize-downloads-folder"],
    platforms: ["windows", "mac", "linux"],
    costNote:
      "Yes, with a subtitle file you have or a free speech tool. Stella's own transcription comes with Stella plans from $20 a month.",
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "cut-silences-from-video",
    niche: "video",
    searchPhrases: [
      "cut silences from video automatically",
      "remove silent parts from video",
      "auto cut dead air from recording",
      "jump cut silences free tool",
      "remove pauses from video",
    ],
    title: "Cut silences out of a video automatically",
    description:
      "Long pauses dragging your video down? Ask Stella (stella.sh) to cut the silent parts out automatically and save a tighter edit beside the original.",
    h1: "Cut silences out of a video automatically",
    short: "Cut silences out of a video",
    lede: "Your recording with the dead air gone and every word left in.",
    answer:
      "To cut silences from a video automatically, find the stretches where nobody speaks and remove them, leaving a little room around each word. Stella (stella.sh) does that and tells you how much shorter it got.",
    gets: ["Every long pause taken out", "Words never clipped", "A new file, original untouched"],
    prompt:
      "Cut out all the silent pauses from my lecture recording and tell me how much shorter it gets.",
    demo: {
      ack: "On it. Finding the pauses.",
      task: "Cutting the silences from your lecture",
      rows: ["Finding every pause", "Keeping a little room around words", "Joining what's left"],
      reply:
        "Done. Your lecture went from 1:32 to 0:46 with the pauses gone. The edit is saved next to the original.",
      files: ["lecture_edited.mp4"],
    },
    faq: [
      ["Does cutting silences lower the video quality?", "Barely. The video is saved again, which you won't see at normal settings, and your original stays as it was."],
      ["Can it cut silences in a podcast or audio file?", "Yes. The same works on MP3 and WAV files."],
    ],
    byHand: [
      "The free [auto-editor](https://auto-editor.com) removes quiet parts in one go: auto-editor talk.mp4 --margin 0.2sec.",
      "If it cuts quiet words, lower its threshold; if breaths count as speech, raise it.",
      "To fine-tune the cuts, export a timeline for Premiere, Resolve or Final Cut with --export premiere.",
    ],
    related: [
      "video/burn-subtitles-into-video-for-tiktok",
      "video/compress-video-for-discord",
      "pc-cleanup/organize-downloads-folder",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "compress-video-for-discord",
    niche: "video",
    searchPhrases: [
      "compress video for discord",
      "compress video to 10mb",
      "make video smaller for discord",
      "discord file too large video",
      "compress video without losing quality",
    ],
    title: "Compress a video for Discord (under 10 MB or 20 MB)",
    description:
      "Video too big for Discord? Ask Stella (stella.sh) to shrink it under 10 MB or 20 MB so it plays right in the chat, with the full length kept.",
    h1: "Compress a video for Discord",
    short: "Compress a video for Discord",
    lede: "Your video small enough to send on Discord, and still sharp.",
    answer:
      "Discord's free limit is 20 MB per file. To fit, lower the video to 720p and set the quality to suit its length. Stella (stella.sh) does it for you, aiming just under the size you name.",
    gets: ["Just under the size you ask for", "Plays right in the Discord chat", "The full length kept"],
    prompt:
      "Make the rocket launch video in my Videos folder small enough to send on Discord, under 10 MB.",
    demo: {
      ack: "Sure. Shrinking it under 10 MB.",
      task: "Shrinking your rocket launch video",
      rows: ["Working out the size it needs", "Bringing it down to 720p", "Checking the picture still looks good"],
      reply:
        "Done. The rocket launch went from 231 MB to 9.2 MB, all 78 seconds kept. It's next to the original and plays right in Discord.",
    },
    faq: [
      ["What is Discord's file size limit?", "20 MB per file on a free account since August 2026, up from 10 MB. Nitro Basic allows 50 MB and Nitro 500 MB."],
      ["Can I compress a video without losing quality?", "Not to a tenth of its size, but you only lose what you won't notice. Dropping to 720p helps most."],
    ],
    byHand: [
      "In the free HandBrake, open the video and pick the Fast 720p30 preset.",
      "On the Video tab choose Avg Bitrate and tick 2-Pass Encoding. A 78-second clip under 10 MB needs about 900 kbps.",
      "Still too big? Trim it, drop to 480p, or upload it elsewhere and paste the link.",
    ],
    related: ["video/cut-silences-from-video", "video/convert-mkv-to-mp4", "video/burn-subtitles-into-video-for-tiktok"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-mkv-to-mp4",
    niche: "video",
    searchPhrases: [
      "convert mkv to mp4",
      "mkv won't play on tv",
      "convert mkv to mp4 without losing quality",
      "convert mkv to mp4 with subtitles",
      "tv says format not supported mkv",
    ],
    title: "Convert MKV to MP4 so your TV plays it (keep subtitles)",
    description:
      "TV says the format isn't supported? Ask Stella (stella.sh) to convert your MKV movies to MP4, changing only what the TV can't play, subtitles kept.",
    h1: "Convert MKV to MP4 so your TV plays it",
    short: "Convert MKV to MP4 for your TV",
    lede: "Movies your TV plays, with the sound and subtitles still there.",
    answer:
      "To convert MKV to MP4 for your TV, copy the picture and sound into an MP4 and convert only the part the TV can't play. Stella (stella.sh) checks each movie and does just that, often in seconds.",
    gets: ["MP4s that play on your TV", "No quality lost where nothing needed changing", "Subtitles carried over"],
    prompt:
      "My TV won't play the MKV movies in my Movies folder. Convert them to MP4 so they work.",
    demo: {
      ack: "On it. Checking each movie first.",
      task: "Converting your movies for the TV",
      rows: ["Checking what's inside each movie", "Copying what the TV already plays", "Converting only what it can't"],
      reply:
        "Done. All 3 movies are MP4s now.\n- One only needed repacking\n- One had its sound converted\n- One had its picture converted, surround sound kept",
    },
    faq: [
      ["How do I check the codec of an MP4 or MKV file?", "Open it in VLC and choose Tools, Codec Information (Window, Media Information on a Mac). It lists the video, sound and subtitle formats."],
      ["Does converting MKV to MP4 lose quality?", "Not when it only repackages. Quality changes only when something must be converted, and you won't see it."],
      ["Why does my TV play the picture but not the sound?", "The sound is often Dolby Digital or DTS, which some TVs won't play from an MP4. Converting the sound fixes it."],
    ],
    byHand: [
      "In VLC, Tools, Codec Information shows what's inside the MKV.",
      "In the free HandBrake, open the movie, pick Fast 1080p30, keep MP4 and press Start.",
      "If the TV ignores the subtitles, save them as a .srt with the same name as the movie.",
    ],
    related: [
      "video/compress-video-for-discord",
      "video/burn-subtitles-into-video-for-tiktok",
      "video/combine-videos-into-one",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "combine-videos-into-one",
    niche: "video",
    searchPhrases: [
      "merge videos",
      "combine videos into one",
      "combine videos on mac",
      "merge videos in the order they were filmed",
      "join video clips together",
    ],
    title: "Combine videos into one, in filming order (Mac, Windows)",
    description:
      "Got a pile of clips from one day out? Ask Stella (stella.sh) to join them into one video in filming order, with portrait clips kept the right shape.",
    h1: "Merge videos into one, in the order they were filmed",
    short: "Combine videos into one",
    lede: "All your clips joined into one video, in the order you filmed them.",
    answer:
      "To combine videos into one, put the clips in filming order and join them end to end. Stella (stella.sh) does it for you, fits every clip into one frame without stretching and keeps the sound going throughout.",
    gets: ["One video, clips in filming order", "Portrait clips not stretched", "Sound running the whole way through"],
    prompt:
      "Join the beach day clips in my Movies folder into one video, in the order they were filmed.",
    demo: {
      ack: "Sure. Putting the clips in order.",
      task: "Joining your beach day clips",
      rows: ["Sorting 6 clips by when they were filmed", "Fitting each into one frame", "Joining them into one video"],
      reply:
        "Done. Your 30-second beach day video has all 6 clips in filming order. The portrait one has black bars instead of being stretched.",
    },
    faq: [
      ["Why is my portrait clip stretched after merging?", "The joiner forced it into a wide frame. Fit it with black bars or crop it, so its shape stays true."],
      ["Does it work with iPhone videos?", "Yes, whatever format they're in, even mixed with clips from other phones."],
    ],
    byHand: [
      "Mac: open the first clip in QuickTime Player, choose Edit, Add Clip to End for each one, then File, Export As.",
      "Windows 11: in Clipchamp, drag the clips onto the timeline in order and export.",
      "For filming order, sort by Date Created in Finder or Media created in File Explorer.",
    ],
    related: ["video/compress-video-for-discord", "video/cut-silences-from-video", "video/convert-mkv-to-mp4"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-slideshow-with-music",
    niche: "video",
    searchPhrases: [
      "how to make a slideshow with music",
      "make a slideshow with music",
      "slideshow with music on mac",
      "photo slideshow video with my own song",
      "make a slideshow video from photos",
    ],
    title: "Make a slideshow with music from your photos (Mac, Windows)",
    description:
      "Want a photo slideshow set to your own song? Ask Stella (stella.sh) to turn a folder of photos and a song into a video, with no watermark.",
    h1: "How to make a slideshow with music from your own photos",
    short: "Make a slideshow with music",
    lede: "Your photos and your song made into one video to share.",
    answer:
      "To make a slideshow with music, give each photo a few seconds, lay your song underneath and save it as a video. Stella (stella.sh) does it from your photos and any song file, at the pace you ask for.",
    gets: [
      "Every photo in order",
      "Your song underneath, fading out at the end",
      "Portrait photos upright, no watermark",
    ],
    prompt:
      "Make a slideshow video of my Lake trip photos with the song in my Downloads, about 4 seconds per photo.",
    demo: {
      ack: "Lovely. Making your slideshow now.",
      task: "Making your Lake trip slideshow",
      rows: ["Putting 20 photos in order", "Giving each photo 4 seconds", "Fading the song out at the end"],
      reply:
        "Done. Your 80-second slideshow is in Videos, with all 20 photos and the song fading out at the end. The portrait photos aren't stretched.",
    },
    faq: [
      ["Can I use my own song in a Photos slideshow on Mac?", "Yes, if it's in your Music library. Add it there first, then pick it with the slideshow's Music button."],
      ["How long should each photo be on screen?", "3 to 5 seconds. Or divide the song's length by the number of photos."],
    ],
    byHand: [
      "Mac: select the photos in Photos, then File, Create, Slideshow, Photos, and pick a song with the Music button.",
      "Windows 11: in Clipchamp, drag the photos onto the timeline, put the song below and trim it to the end.",
      "20 photos at 4 seconds is 80 seconds, so fade out a longer song.",
    ],
    related: ["video/combine-videos-into-one", "video/compress-video-for-discord", "photos-files/resize-images-in-bulk"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-mov-to-mp4",
    niche: "video",
    searchPhrases: [
      "convert mov to mp4",
      "mov to mp4",
      "convert mov to mp4 mac",
      "convert mov to mp4 without losing quality",
      "iphone video won't play on tv",
    ],
    title: "Convert MOV to MP4 so phone videos play on a TV or Windows",
    description:
      "iPhone videos won't play on your TV? Ask Stella (stella.sh) to convert a folder of MOV clips to MP4s that play anywhere, the right way up.",
    h1: "Convert MOV to MP4 so your phone videos play anywhere",
    short: "Convert MOV to MP4",
    lede: "Phone videos that play on your TV and any Windows laptop.",
    answer:
      "To make iPhone MOV videos play on a TV or Windows PC, convert them to a widely supported MP4; renaming them rarely works. Stella (stella.sh) converts a whole folder and keeps upright clips upright.",
    gets: ["MP4s that play on TVs and Windows", "Upright clips staying upright", "Originals left alone"],
    prompt:
      "My TV won't play the MOV videos in my From my phone folder. Convert them to MP4 so they play on the TV and my sister's Windows laptop.",
    demo: {
      ack: "Sure. Converting your phone videos.",
      task: "Converting your phone videos to MP4",
      rows: ["Checking each of the 5 clips", "Turning upright clips the right way", "Saving MP4s next to the originals"],
      reply:
        "Done. All 5 clips are now MP4s that play on TVs and Windows. Four needed converting, one was already fine, and the upright ones stay upright.",
    },
    faq: [
      ["Why won't my iPhone videos play on my TV?", "Recent iPhones record in HEVC, which many TVs and Windows PCs can't play. Converting to an H.264 MP4 fixes it."],
      ["How do I stop my iPhone recording in HEVC?", "In Settings, Camera, Formats, choose Most Compatible. Files are bigger but play everywhere."],
    ],
    byHand: [
      "In the free HandBrake, open the folder, pick Fast 1080p30 and check the format is MP4 with H.264.",
      "Mac: QuickTime's File, Export As, 1080p with Greater Compatibility makes a MOV most TVs play.",
      "Windows can play HEVC once you add Microsoft's HEVC Video Extensions.",
    ],
    related: ["video/convert-mkv-to-mp4", "video/rotate-video", "photos-files/convert-heic-to-jpg"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-srt-to-vtt",
    niche: "video",
    searchPhrases: ["srt to vtt", "convert srt to vtt", "subtitle converter", "convert subtitles to utf 8", "srt file"],
    title: "Convert SRT to VTT for a website video player, timings kept",
    description:
      "Website player needs VTT subtitles, not SRT? Ask Stella (stella.sh) to convert a whole folder, keep every timing exact and fix broken accents.",
    h1: "Convert SRT subtitles to VTT",
    short: "Convert SRT to VTT",
    lede: "Subtitles your website's video player reads, timings unchanged.",
    answer:
      "VTT is nearly the same as SRT: a WEBVTT line at the top and full stops instead of commas in the times. Stella (stella.sh) converts a whole folder of SRT files and keeps every timing exactly.",
    gets: ["A .vtt next to each .srt", "Every timing exactly the same", "Accents like café showing properly"],
    prompt:
      "The subtitle files in my Garden series folder are .srt, but my website's video player needs .vtt. Convert all eight and keep the timings the same.",
    demo: {
      ack: "Sure. Converting all eight.",
      task: "Converting your subtitles to VTT",
      rows: ["Reading the 8 subtitle files", "Fixing broken accents in episode 3", "Saving a .vtt beside each one"],
      reply:
        "Done. All 8 episodes have a .vtt next to their .srt, with all 260 timings unchanged. Episode 3 was saved the old Windows way, so I fixed its accents.",
    },
    faq: [
      ["What's the difference between SRT and VTT?", "For plain subtitles, almost nothing: VTT starts with a WEBVTT line and uses full stops in the times. Web video players read VTT."],
      ["Can I convert VTT back to SRT?", "Yes. Ask for it and the folder comes back as .srt files."],
    ],
    byHand: [
      "One file: open the .srt in Notepad or TextEdit and add WEBVTT and an empty line at the top.",
      "In each timing line, change the comma before the milliseconds to a full stop, then save as .vtt.",
      "A folder: in the free Subtitle Edit, choose Tools, Batch convert and set Format to WebVTT.",
      "If you see Ã© instead of é, reopen the file as Windows-1252 and save it as UTF-8 first.",
    ],
    related: ["video/make-srt-subtitle-file", "video/burn-subtitles-into-video-for-tiktok", "video/convert-mov-to-mp4"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "extract-frames-from-video",
    niche: "video",
    searchPhrases: [
      "extract frames from video",
      "video to jpg",
      "extract frames from video ffmpeg",
      "save frames from video as images",
      "video to jpg converter high quality",
    ],
    title: "Extract frames from a video as full-quality JPGs",
    description:
      "Want stills from a video at full quality? Ask Stella (stella.sh) to save a JPG for every second, named by time, so you can pick the best shot.",
    h1: "Extract frames from a video as JPGs",
    short: "Extract frames from video",
    lede: "Every moment of your video saved as a sharp picture.",
    answer:
      "To extract frames from a video, save pictures straight from the file at full size instead of taking screenshots. Stella (stella.sh) saves one JPG per second, or as many as you want, named by their time.",
    gets: ["Full-size JPGs at top quality", "Named by their time in the video", "All in one new folder"],
    prompt:
      "Save a picture for every second of the Bird feeder video in my Videos, at full quality, so I can pick the best shot of the woodpecker.",
    demo: {
      ack: "Sure. Saving one per second.",
      task: "Saving frames from Bird feeder",
      rows: ["Reading the 40-second video", "Saving a full-size JPG each second", "Naming each by its time"],
      reply:
        "Done. 40 full-size pictures are in **Bird feeder frames**. Tell me the second the woodpecker lands and I'll save every frame around it.",
      files: ["Bird feeder frames"],
    },
    faq: [
      ["How do I extract frames from a video with ffmpeg?", "Give ffmpeg the video with an fps=1 filter and it saves one JPG per second. The full line is in the steps below."],
      ["How do I get a high-quality still from a video?", "Take the frame straight from the file at full size rather than a screenshot of the player."],
    ],
    byHand: [
      "With the free ffmpeg: ffmpeg -i video.mp4 -vf fps=1 -q:v 2 frame_%03d.jpg saves one JPG per second.",
      "Without it, pause in VLC and choose Video, Take Snapshot, one frame at a time.",
      "Found the right second? Add -ss 22 -t 4 and drop fps=1 to save every frame of just that stretch.",
    ],
    related: ["video/make-gif-from-video", "photos-files/resize-images-in-bulk", "video/speed-up-video"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-gif-from-video",
    niche: "video",
    searchPhrases: ["make a gif from a video", "video to gif", "make gif", "how to make a gif", "make gif under 5mb"],
    title: "Make a GIF from a video clip, under a size limit",
    description:
      "Want a GIF of one moment in a video? Ask Stella (stella.sh) to cut exactly those seconds into a sharp GIF that stays under the size you need.",
    h1: "Make a GIF from a video clip",
    short: "Make a GIF from a video",
    lede: "The funny bit of your video as a GIF for the group chat.",
    answer:
      "To make a GIF from a video, trim it to a few seconds and convert it with colours taken from the clip. Stella (stella.sh) cuts the exact seconds you name and keeps it under your size limit.",
    gets: ["Exactly the seconds you asked for", "Smooth colours, not grainy", "Under the size you need"],
    prompt:
      "Make a GIF of the bit in my Park day video where Biscuit catches the frisbee, 0:42 to 0:47. Keep it under 5 MB for the family chat.",
    demo: {
      ack: "Fun. Making the GIF now.",
      task: "Making the Biscuit frisbee GIF",
      rows: ["Cutting 0:42 to 0:47", "Taking the colours from the clip", "Making it sharper, still under 5 MB"],
      reply:
        "Done. The GIF is next to the video: 720 pixels wide and only 478 KB, so it sends easily.",
      files: ["Park day - Biscuit catches the frisbee.gif"],
    },
    faq: [
      ["Can Clipchamp export as GIF?", "Yes. Trim the clip to 15 seconds or less, choose Export, then GIF."],
      ["Why is my GIF so big?", "GIFs grow fast with length, width and frame rate. Keep it to a few seconds at 480 to 720 pixels wide."],
    ],
    byHand: [
      "Mac: trim in QuickTime with Edit, Trim, then use the Shortcuts app's Make GIF action.",
      "Windows: in Clipchamp, split out the seconds you want, then choose Export, GIF.",
      "On iPhone, the Shortcuts app's Make GIF works on videos too.",
    ],
    related: ["video/extract-frames-from-video", "video/compress-video-for-discord", "video/speed-up-video"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-srt-subtitle-file",
    niche: "video",
    searchPhrases: [
      "create srt file from video",
      "srt generator",
      "subtitle generator",
      "generate srt file from video",
      "make subtitles",
    ],
    title: "Create an SRT subtitle file from a video, free and local",
    description:
      "Need an SRT for YouTube or Vimeo? Ask Stella (stella.sh) to write timed subtitles from the speech in your video, free and on your own computer.",
    h1: "Create an SRT subtitle file from a video",
    short: "Make an SRT subtitle file",
    lede: "A subtitle file for your video, ready to upload alongside it.",
    answer:
      "To create an SRT file from a video, let speech recognition write timed lines from what's said. Stella (stella.sh) does it for free on your computer and leaves the video untouched.",
    gets: ["A timed .srt, named like the video", "Short lines that are easy to read", "Words it's unsure of pointed out"],
    prompt:
      "Make an SRT subtitle file for the interview video in my Videos folder. I just need the separate file, not subtitles on the video.",
    demo: {
      ack: "Sure. Writing the subtitles now.",
      task: "Making subtitles for your interview",
      rows: ["Listening to the interview", "Writing short, timed lines", "Saving the .srt next to the video"],
      reply:
        "Done. 19 subtitles are in an .srt next to the interview, and the video is unchanged. Check the guest's name, which was hard to hear.",
    },
    faq: [
      ["How do I make an SRT file for free?", "On Windows, Subtitle Edit has a free Audio to text option. On a Mac, use a free Whisper app. Or ask Stella."],
      ["Can it add speaker names?", "Yes. Ask for each line to start with who's speaking."],
    ],
    byHand: [
      "Windows: in the free Subtitle Edit, open the video and choose Video, Audio to text (Whisper).",
      "Read it through, fix names, then save it as .srt.",
      "Name it like the video, such as Interview.srt, so players load it.",
    ],
    related: [
      "video/convert-srt-to-vtt",
      "video/burn-subtitles-into-video-for-tiktok",
      "audio/transcribe-voice-memos-to-text",
    ],
    platforms: ["windows", "mac", "linux"],
    costNote:
      "Yes. Stella uses a free speech tool on your computer.",
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "rotate-video",
    niche: "video",
    searchPhrases: [
      "rotate video",
      "how to rotate a video",
      "rotate video 90 degrees",
      "rotate video mac",
      "video plays sideways",
    ],
    title: "Rotate a sideways video and save it the right way up",
    description:
      "Filmed with your phone on its side? Ask Stella (stella.sh) to rotate the video and save an upright copy that plays correctly in every app.",
    h1: "Rotate a video that plays sideways",
    short: "Rotate a video",
    lede: "Your sideways video turned the right way up for good.",
    answer:
      "To rotate a video that plays sideways, turn the picture a quarter turn the right way and save it. Stella (stella.sh) works out which way it needs to go and saves an upright copy.",
    gets: ["The right way up in every app", "Sound kept as it was", "Original saved alongside"],
    prompt:
      "I filmed my daughter's school play with my phone on its side, and now it plays sideways. Turn it the right way up.",
    demo: {
      ack: "Sure. Working out which way it's turned.",
      task: "Turning School play upright",
      rows: ["Looking at a few frames", "Turning it a quarter left", "Checking everyone stands upright"],
      reply:
        "Done. The upright copy is next to the original, with the stage and children the right way up and the sound unchanged.",
      files: ["School play (upright).mp4"],
    },
    faq: [
      ["Why does my video play sideways in one app but not another?", "Phones often save a flag saying how to turn the video. Some apps read it and some ignore it. Turning the picture itself fixes it everywhere."],
      ["How do I rotate a video on Mac?", "Open it in QuickTime Player, choose Edit, Rotate Left or Rotate Right, then File, Save."],
    ],
    byHand: [
      "Windows: in Clipchamp, select the clip, press the rotate button and Export.",
      "On iPhone, the Photos app's Edit, Crop tool has a rotate button.",
      "If the floor is on the right of the frame, turn it clockwise; on the left, anticlockwise.",
    ],
    related: ["video/convert-mov-to-mp4", "video/speed-up-video", "video/combine-videos-into-one"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "speed-up-video",
    niche: "video",
    searchPhrases: [
      "speed up video",
      "speed up a video",
      "speed up video without chipmunk voice",
      "fast forward video",
      "speed up video keep pitch",
    ],
    title: "Speed up a video 2× without a chipmunk voice",
    description:
      "Want a faster video without the chipmunk voice? Ask Stella (stella.sh) to speed it up 2× or more with your voice kept at its normal pitch.",
    h1: "Speed up a video without the chipmunk voice",
    short: "Speed up a video",
    lede: "Your video twice as fast, with your voice still sounding like you.",
    answer:
      "To speed up a video without a chipmunk voice, use a speed setting that keeps the pitch, like iMovie's Preserve pitch. Stella (stella.sh) makes a faster copy with your voice sounding normal.",
    gets: ["Twice as fast, or any speed you name", "Your voice at its normal pitch", "Sound and picture in step"],
    prompt:
      "Make my cake decorating video twice as fast for Instagram, but keep my voice sounding normal, not like a chipmunk.",
    demo: {
      ack: "Sure. Doubling the speed now.",
      task: "Speeding up Cake decorating",
      rows: ["Doubling the picture's speed", "Speeding the voice without raising it", "Saving a copy for Instagram"],
      reply:
        "Done. Your video went from 68 seconds to 34, with your voice at its usual pitch. The fast copy is next to the original.",
      files: ["Cake decorating (2x for Instagram).mp4"],
    },
    faq: [
      ["Why does my voice sound like a chipmunk when I speed up a video?", "The tool plays the sound faster without correcting the pitch. Use a speed setting that keeps the pitch."],
      ["Can I speed up only part of a video?", "Yes. Split the clip in iMovie or Clipchamp, or give Stella the time range."],
    ],
    byHand: [
      "Mac: in iMovie, select the clip, click the speedometer, choose Fast, 2×, and keep Preserve pitch ticked.",
      "Windows: in Clipchamp, select the clip, open Speed and set 2×. It keeps the pitch.",
      "On the phone, CapCut's Speed has a pitch option; listen to the voice after.",
    ],
    related: [
      "video/cut-silences-from-video",
      "video/burn-subtitles-into-video-for-tiktok",
      "audio/slow-down-song-without-changing-pitch",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-avi-to-mp4",
    niche: "video",
    searchPhrases: ["convert avi to mp4", "wmv to mp4", "3gp to mp4", "vob to mp4", "convert old videos to mp4"],
    title: "Convert AVI, WMV, 3GP and VOB videos to MP4 (no squashing)",
    description:
      "Old AVI, WMV, 3GP or VOB clips that won't play? Ask Stella (stella.sh) to convert them all to MP4 without squashing or stretching anyone.",
    h1: "Convert old AVI, WMV, 3GP and VOB videos to MP4",
    short: "Convert AVI, WMV, 3GP, VOB to MP4",
    lede: "Old camcorder and phone clips that play on today's phones and TVs.",
    answer:
      "To convert old AVI, WMV, 3GP and VOB videos, turn each into a standard MP4 and keep its true shape. Stella (stella.sh) converts the whole folder so nobody looks squashed or stretched.",
    gets: ["Every clip as an MP4", "People the right shape, not squashed", "Original dates kept so phones sort them"],
    prompt:
      "My Old family videos folder has clips in AVI, WMV, 3GP and VOB from old cameras and phones. Convert them all to MP4 so they play on my phone and TV.",
    demo: {
      ack: "On it. Checking each old clip.",
      task: "Converting your old family videos",
      rows: ["Finding 5 clips in 4 formats", "Fixing the shape of 2 clips", "Saving MP4s in a new folder"],
      reply:
        "Done. All 5 clips are MP4s in a new folder. The camcorder and DVD clips needed their shape fixed, so nobody looks squashed now.",
    },
    faq: [
      ["Why does my converted DVD video look squashed?", "DVD video is stored narrow and stretched to widescreen when played. A converter that ignores that squeezes everyone thin."],
      ["Can I convert a whole folder at once?", "Yes. HandBrake has a queue, and Stella converts the folder in one go."],
    ],
    byHand: [
      "In the free HandBrake, drag in a clip, pick Fast 1080p30 and leave Anamorphic on Automatic.",
      "VLC: Media, Convert / Save, profile Video - H.264 + MP3 (MP4), one file at a time.",
      "Look at a face in each new file to be sure nothing is squashed.",
    ],
    related: ["video/convert-mov-to-mp4", "video/convert-mkv-to-mp4", "video/convert-webm-to-mp4"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-webm-to-mp4",
    niche: "video",
    searchPhrases: [
      "webm to mp4",
      "convert webm to mp4",
      "webm won't play on iphone",
      "convert webm to mp4 mac",
      "webm to mp4 no limit",
    ],
    title: "Convert WebM to MP4 so it plays on an iPhone",
    description:
      "WebM videos won't play on your iPhone? Ask Stella (stella.sh) to turn them into MP4s that play in Photos, Files and Messages, with no size limit.",
    h1: "Convert WebM to MP4 that plays on an iPhone",
    short: "Convert WebM to MP4",
    lede: "WebM videos turned into MP4s your iPhone plays.",
    answer:
      "To play a WebM on an iPhone, convert it to an MP4; renaming the file doesn't work. Stella (stella.sh) converts every WebM you have, including screen recordings that show no length.",
    gets: ["MP4s that play on any iPhone", "Full length, with no size cap", "Screen recordings you can skip through"],
    prompt:
      "Some WebM videos in my Downloads won't play on my iPhone. Turn them into MP4s that will.",
    demo: {
      ack: "Sure. Converting them to MP4.",
      task: "Converting your WebM videos",
      rows: ["Finding 4 WebM videos", "Checking none is damaged", "Saving an MP4 of each"],
      reply:
        "Done. All 4 are MP4s now and play on your iPhone. The screen recording also has a proper length, so you can skip through it.",
    },
    faq: [
      ["Why won't WebM play on my iPhone?", "iPhones play some WebM in Safari, but not in Photos, Files or Messages. An MP4 plays everywhere."],
      ["Is there a size limit?", "Not on your own computer. Online converters cap file size; doing it at home has no cap."],
    ],
    byHand: [
      "In the free HandBrake, drag in the WebM, pick Fast 1080p30 and click Start.",
      "VLC: Media, Convert / Save, profile Video - H.264 + MP3 (MP4).",
      "Renaming .webm to .mp4 doesn't help; it has to be converted.",
    ],
    related: ["video/convert-avi-to-mp4", "video/convert-mov-to-mp4", "video/make-gif-from-video"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "crop-video-to-vertical",
    niche: "video",
    searchPhrases: [
      "convert horizontal video to vertical",
      "crop video to vertical",
      "make video vertical for reels",
      "convert video to 9:16",
      "horizontal to vertical video without black bars",
    ],
    title: "Convert a horizontal video to vertical 9:16, no black bars",
    description:
      "Need a horizontal video in 9:16 for Reels or TikTok? Ask Stella (stella.sh) to crop it vertical with no black bars, keeping you in the frame.",
    h1: "Convert a horizontal video to vertical, keeping you in shot",
    short: "Crop a video to vertical 9:16",
    lede: "Your landscape video as a full-screen vertical Reel, you still in shot.",
    answer:
      "To convert a horizontal video to vertical without black bars, crop a tall slice around the person and scale it up. Stella (stella.sh) finds where you are throughout and crops to keep you in shot.",
    gets: ["A full-screen 9:16 video, no bars", "You and the action kept in frame", "Sound kept, original untouched"],
    prompt:
      "Turn my pancake tutorial into a vertical 9:16 video for Reels. Fill the whole screen, no black bars, and keep me and the pan in the shot.",
    demo: {
      ack: "Sure. Finding where you are first.",
      task: "Making your pancake Reel",
      rows: ["Finding you and the pan in each frame", "Picking one crop that fits throughout", "Saving it at Reel size"],
      reply:
        "Done. Your 21-second Reel fills the screen at 1080×1920, with you and the pan in shot the whole way. It's next to the original.",
    },
    faq: [
      ["Why not just crop the middle?", "If you're not in the middle, a centre crop cuts you off. The slice has to follow where you are."],
      ["What size should a Reel or TikTok be?", "1080×1920 pixels, which is 9:16."],
    ],
    byHand: [
      "Windows: in Clipchamp, switch the ratio to 9:16, choose Fill and drag the picture until you're centred.",
      "Mac: iMovie can't do 9:16; the free Shotcut can, with Video Mode set to Vertical HD.",
      "On the phone, CapCut and Instagram's editor have a 9:16 canvas.",
    ],
    related: ["video/burn-subtitles-into-video-for-tiktok", "video/rotate-video", "video/speed-up-video"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "cut-out-part-of-video",
    niche: "video",
    searchPhrases: [
      "cut out part of a video",
      "remove part of video",
      "trim middle of video",
      "cut a section out of a video",
      "delete part of video and join",
    ],
    title: "Cut out part of a video and join the rest, frame-exact",
    description:
      "Part of your video you'd rather not keep? Ask Stella (stella.sh) to cut out exactly those seconds and join the rest, with the sound still in step.",
    h1: "Cut out part of a video and keep the rest",
    short: "Cut out part of a video",
    lede: "The bad bit gone, the rest joined into one smooth video.",
    answer:
      "To cut out part of a video, split it at the start and end of the bit you don't want, delete the middle and save. Stella (stella.sh) does it from the times you give, to the exact second.",
    gets: [
      "Exactly the seconds you named, gone",
      "The rest joined into one video",
      "Sound still in step with the picture",
    ],
    prompt:
      "In my son's football final video, the camera points at the grass from 1:10 to 1:45. Cut that out and keep the rest as one video.",
    demo: {
      ack: "Sure. Cutting 1:10 to 1:45.",
      task: "Cutting the grass shot out",
      rows: ["Checking 1:10 and 1:45", "Removing the middle part", "Joining the two halves"],
      reply:
        "Done. The football final is now 2:25 instead of 3:00, with no grass shot left and the sound in step. It's a new file next to the original.",
    },
    faq: [
      ["How do I cut out the middle of a video?", "Split it at both ends of the part you don't want, delete that piece and save. Every editor works this way."],
      ["Can I cut out several parts at once?", "Yes. Give all the time ranges and each one is removed."],
    ],
    byHand: [
      "Mac: in QuickTime Player, choose View, Show Clips, then Edit, Split Clip at 1:10 and again at 1:45.",
      "Click the middle clip, press Delete, then File, Save.",
      "Windows: in Clipchamp, press S at each point to split, delete the middle and Export.",
    ],
    related: ["video/cut-silences-from-video", "video/combine-videos-into-one", "video/speed-up-video"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-video-louder",
    niche: "video",
    searchPhrases: [
      "increase volume of video",
      "make video louder",
      "make audio louder in video",
      "boost audio volume in video",
      "video sound too quiet",
    ],
    title: "Make a quiet video louder without crackle or clipping",
    description:
      "Can barely hear the speech in your video? Ask Stella (stella.sh) to make it louder without distortion, so the loud moments stay clean too.",
    h1: "Increase the volume of a quiet video without distortion",
    short: "Make a video louder",
    lede: "A quiet video you can actually hear, without the crackle.",
    answer:
      "To make a quiet video louder without distortion, raise the quiet speech while holding the loud moments down. Stella (stella.sh) brings it up to normal video loudness and leaves the picture untouched.",
    gets: ["Speech you can hear clearly", "No crackle on loud moments", "The picture exactly as it was"],
    prompt:
      "The sound on my nan's 90th birthday speech video is so quiet you can barely hear her. Make it louder.",
    demo: {
      ack: "Sure. Bringing her voice up.",
      task: "Making Nan's speech louder",
      rows: ["Measuring how quiet it is", "Taking out rumble and hiss", "Raising the voice, holding the peaks"],
      reply:
        "Done. Nan's speech is about 20 dB louder, at normal video loudness, and the two glass clinks near the start are still clean. It's next to the original.",
    },
    faq: [
      ["Why does my video crackle when I turn it up?", "A plain volume boost pushes loud moments past the limit. Raising the quiet parts and capping the peaks avoids it."],
      ["Will the background hiss get louder too?", "Not if it's taken out at the same time, which Stella does."],
    ],
    byHand: [
      "Mac: in iMovie, select the clip, click Volume, drag it up and turn on Normalize clip volume.",
      "Windows: in Clipchamp, open Audio and drag the volume up to 200%.",
      "VLC can play it louder, but that doesn't change the file.",
    ],
    related: ["audio/normalize-audio-volume", "video/cut-out-part-of-video", "audio/extract-audio-from-video"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "reverse-video",
    niche: "video",
    searchPhrases: [
      "reverse video",
      "how to reverse a video",
      "play video backwards",
      "reverse video iphone",
      "reverse video on mac",
    ],
    title: "Reverse a video so it plays backwards (stays upright)",
    description:
      "Want a video to play backwards, like jumping out of a pool? Ask Stella (stella.sh) to make a reversed copy, picture and sound, that stays upright.",
    h1: "Reverse a video so it plays backwards",
    short: "Reverse a video",
    lede: "Your clip playing backwards, still the right way up.",
    answer:
      "To reverse a video, play the picture and sound from the end back to the start and save that as a copy. Stella (stella.sh) makes the reversed video for you, upright even from a phone.",
    gets: ["A reversed video, picture and sound", "Still upright, the same shape", "Original kept as it was"],
    prompt:
      "Make a reversed version of the video of the kids jumping into the pool, so it looks like they're flying out of the water.",
    demo: {
      ack: "Fun. Reversing it now.",
      task: "Reversing the pool jump",
      rows: ["Playing it from end to start", "Keeping it upright", "Saving the reversed copy"],
      reply:
        "Done. The reversed copy starts on the splash and ends with the kids back on the edge. The sound runs backwards too; say if you'd rather mute it.",
      files: ["Pool jump (reversed).mp4"],
    },
    faq: [
      ["How do I make a reversed video on iPhone?", "The Photos app can't. CapCut and several free editors have a Reverse button, or ask Stella on your computer."],
      ["Why does my reversed video play sideways?", "Phones save a flag saying how to turn the video, and some reversers drop it. Stella's copy stays upright."],
    ],
    byHand: [
      "Mac: in iMovie, select the clip, click the speedometer and tick Reverse, then File, Share, File.",
      "Windows: Clipchamp can't reverse, but the free Shotcut can, with Reverse in its Properties panel.",
      "For a long video, cut out the moment first and reverse just that.",
    ],
    related: ["video/speed-up-video", "video/make-gif-from-video", "video/rotate-video"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "add-music-to-video",
    niche: "video",
    searchPhrases: [
      "add music to video",
      "add background music to video",
      "add music to video and fade out",
      "put song under video keep voices",
      "add background music without losing original sound",
    ],
    title: "Add background music to a video, voices kept, fade out",
    description:
      "Want background music on a video without losing the talking? Ask Stella (stella.sh) to mix a song in quietly underneath and fade it out at the end.",
    h1: "Add background music to a video and keep the voices",
    short: "Add music to a video",
    lede: "Your favourite song under your video, voices still clear.",
    answer:
      "To add background music to a video, lay the song under the original sound, turn it well down and fade it out at the end. Stella (stella.sh) mixes it for you so the voices stay clear.",
    gets: ["The song under the talking, not over it", "Faded out right at the end", "The picture untouched"],
    prompt:
      "Add Sunny Days from my Music as background music to my beach video. Keep us talking, with the music quieter underneath, and fade it out at the end.",
    demo: {
      ack: "Sure. Mixing it in now.",
      task: "Adding Sunny Days to Beach day",
      rows: ["Measuring the voices and the song", "Mixing the song in quietly", "Fading it out over 5 seconds"],
      reply:
        "Done. Sunny Days sits well under your voices and fades out over the last 5 seconds. Want the music louder or softer?",
      files: ["Beach day (with music).mp4"],
    },
    faq: [
      ["How do I add music without losing the original sound?", "Add the song as a second track under the existing sound instead of replacing it."],
      ["How loud should background music be?", "Well under the voices, about 10 to 15 dB quieter."],
    ],
    byHand: [
      "Mac: in iMovie, drag the song into the background music well, lower its volume and drag the fade handle.",
      "Windows: in Clipchamp, lower the song to 20–30% in Audio, add a fade-out and trim it to the video's end.",
      "If you strain to hear the words, the music is too loud.",
    ],
    related: ["video/make-slideshow-with-music", "video/make-video-louder", "audio/normalize-audio-volume"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "stabilize-shaky-video",
    niche: "video",
    searchPhrases: [
      "stabilize video",
      "stabilize shaky video",
      "how to stabilize a shaky video",
      "stabilize video free",
      "fix shaky phone video",
    ],
    title: "Stabilize a shaky phone video, no black borders",
    description:
      "Phone video too shaky to watch? Ask Stella (stella.sh) to steady it after filming, keeping the walk but losing the wobble, with no black borders.",
    h1: "Stabilize a shaky video filmed while walking",
    short: "Stabilize a shaky video",
    lede: "A shaky walking video made smooth, with no black edges.",
    answer:
      "To stabilize a shaky video, track how the camera moved, smooth it out and zoom in slightly to hide the edges. Stella (stella.sh) does it for you and keeps the natural walking movement.",
    gets: ["Most of the shake gone", "No black borders at the edges", "Still feels like walking, not floating"],
    prompt:
      "My carnival parade video is really shaky because I was walking with my phone. Can you steady it?",
    demo: {
      ack: "Sure. Steadying it now.",
      task: "Steadying your parade video",
      rows: ["Tracking how the camera moved", "Smoothing out the wobble", "Checking for black edges"],
      reply:
        "Done. About three quarters of the shake is gone, with no black edges, and it still follows your walk. It's saved next to the original.",
    },
    faq: [
      ["Can you stabilize a video after it's filmed?", "Yes. The software follows how the camera moved, smooths it and shifts each frame to match."],
      ["How do I stabilize a video for free?", "iMovie on a Mac and Shotcut on Windows both do it free. Clipchamp has no stabiliser."],
    ],
    byHand: [
      "Mac: in iMovie, select the clip, click Stabilization and tick Stabilize Shaky Video.",
      "Windows: in the free Shotcut, add the Stabilize filter, click Analyze, then Export.",
      "Android: Google Photos has a stabilise button in its video editor.",
    ],
    related: ["video/crop-video-to-vertical", "video/speed-up-video", "video/rotate-video"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
