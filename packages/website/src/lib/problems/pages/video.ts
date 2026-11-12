import { PROOFS, webCuts } from "../media";
import type { ProblemPage } from "../types";

export const VIDEO_PAGES: ProblemPage[] = [
  {
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
      "Burn subtitles into a video so they show on TikTok, Reels and Shorts: transcribe, fix the text, and render with free tools, or let Stella (stella.sh) do it.",
    h1: "Add burned-in subtitles to a video for TikTok",
    short: "Burned-in subtitles for TikTok",
    lede: "Captions burned into the video itself, sized for a phone screen.",
    answer:
      "Burned-in subtitles are drawn into the video pictures themselves, so they show everywhere, even with captions turned off. Make a timed subtitle file from the speech, correct it, then render it onto the video with a free tool like CapCut or ffmpeg, keeping the text above TikTok's buttons. Stella (stella.sh) does it on your computer: it transcribes the clip, fits a widescreen video to TikTok's 9:16 frame, and saves a captioned copy next to the original.",
    stellaSteps: [
      "Transcribes the speech with word-level timings (in the recording, with Stella's own transcription, which comes with paid plans)",
      "Checks the sound and picture line up; in the recording it found the audio started half a second late and corrected for it",
      "Asks how to fit a widescreen clip into TikTok's 9:16 frame: crop to portrait, or keep the full frame on a blurred background",
      "Writes a subtitle file and burns it in with ffmpeg: white bold text with a dark outline, two lines at most, above TikTok's caption area",
      "Saves a new 1080×1920 video next to the original, which it leaves untouched",
    ],
    prompt: "Add subtitles to interview.mp4 and burn them in so I can post it on TikTok.",
    costNote:
      "Partly. Stella itself is free with the ChatGPT or Claude plan you already have, and so are the ffmpeg steps. The transcription in the recording used Stella's own transcription model, which comes with paid Stella plans (from Plus, $20 a month); new accounts get a small free trial of Stella's own models. On the free path, give Stella a subtitle file, or ask it to set up the free, open-source Whisper on your computer and transcribe with that.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-10",
      platform: "Linux (Omarchy)",
      model: "Stella’s own models (GPT-6 Luna)",
      result:
        "A 1080×1920 copy of a 39-second widescreen interview, cropped to portrait with 15 burned-in caption lines. Transcribed again independently afterwards, every caption starts within 0.14 s of the speech. The original file was unchanged.",
      note: "Trimmed: a two-minute wait before the message sent (the new test account was still signing in) is cut, and the waits are sped up.",
      video: {
        src: `${PROOFS}/video/burn-subtitles-into-video-for-tiktok/proof.mp4`,
        cuts: webCuts("video/burn-subtitles-into-video-for-tiktok"),
        poster: `${PROOFS}/video/burn-subtitles-into-video-for-tiktok/poster.jpg`,
        width: 1280,
        height: 800,
        duration: 83.6,
        realDuration: 347,
      },
      moments: [
        { at: 0, text: "The prompt, typed into Stella on a Linux computer." },
        { at: 5, text: "Sent. Stella replies that it will transcribe the interview, add TikTok-friendly subtitles and export a copy without changing the original." },
        { at: 10, text: "Transcribing and timing the captions, sped up 20×." },
        { at: 17, text: "Stella asks how to fit the 16:9 interview into TikTok's 9:16 frame: crop to portrait, or keep the full frame on a blurred background." },
        { at: 27, text: "“Crop to portrait” is picked." },
        { at: 31, text: "Cropping, scaling and burning in the captions, sped up 20×." },
        { at: 39, text: "Done: timed English subtitles and a TikTok-ready portrait version with bold, outlined text. The original is unchanged." },
        { at: 56, text: "The finished video playing in Stella, captions burned in." },
      ],
      output: {
        src: `${PROOFS}/video/burn-subtitles-into-video-for-tiktok/output.mp4`,
        poster: `${PROOFS}/video/burn-subtitles-into-video-for-tiktok/output-poster.jpg`,
        width: 720,
        height: 1280,
        caption:
          "The portrait copy Stella exported, shown here at 720p with sound. The source is a public-domain NASA interview clip, 1920×1080. The captions are clean but small by TikTok standards; ask for a bigger size or a highlight colour if you want them louder.",
      },
    },
    manualSteps: [
      {
        title: "Easiest: CapCut's auto captions",
        body: "In CapCut (desktop or phone), import the clip, choose Text, then Auto captions, and pick the spoken language. Read through every line and fix mistakes, choose a style, and export. The captions are burned in on export.",
      },
      {
        title: "Free and offline: make the .srt with Whisper",
        body: "If you'd rather not upload the clip, install OpenAI's free [Whisper](https://github.com/openai/whisper) (or the faster whisper.cpp) and run `whisper clip.mp4 --model small --output_format srt`. You get `clip.srt`, a plain text file with numbered, timed lines.",
      },
      {
        title: "Correct the subtitle text",
        body: "Open the .srt in any text editor and fix names, slang and misheard words. Keep the numbers and the `00:00:01,200 --> 00:00:03,900` timing lines exactly as they are. Shorter lines read better on a phone: aim for under 30 characters.",
      },
      {
        title: "Burn them in with ffmpeg",
        body: "Run `ffmpeg -i clip.mp4 -vf \"subtitles=clip.srt:force_style='Fontsize=16,Bold=1,Outline=2,Alignment=2,MarginV=90'\" -c:a copy clip-captioned.mp4`. `MarginV` lifts the text off the bottom edge; raise it if TikTok's caption and buttons cover your words.",
      },
      {
        title: "Check it on a phone before posting",
        body: "Send the new file to your phone and play it full screen. TikTok puts its buttons on the right and the description along the bottom, so the safe area is roughly the middle two-thirds of a 1080×1920 frame.",
      },
    ],
    limits: [
      "Stella doesn't post to TikTok or any other account for you. You upload the finished file yourself.",
      "Its own transcription comes with paid Stella plans. On the free path (your ChatGPT or Claude plan) it can't use it, so hand it a subtitle file or have it set up Whisper on your computer, which this recording doesn't show.",
      "Transcription is good but not perfect, especially over loud music, heavy accents or several people talking at once. Add “show me the text before you burn it in” to the prompt to check the words first.",
      "Rendering takes as long as your computer takes. A one-minute clip is quick; an hour-long video on an older laptop can take a while.",
      "Animated word-by-word caption templates are CapCut's strength. Stella makes clean, readable captions, not CapCut's full template library.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What's the difference between burned-in and closed captions?",
        a: "Burned-in (open, or hardcoded) captions are part of the picture and always show. Closed captions are a separate track the viewer can turn on or off. TikTok and Reels viewers mostly watch muted, so creators burn them in.",
      },
      {
        q: "Does TikTok add captions automatically?",
        a: "TikTok can generate auto captions that viewers can switch on, but they're small, styled by TikTok, and often off by default. Burning your own in means everyone sees them, in your style.",
      },
      {
        q: "Where should captions go on a TikTok video?",
        a: "In the lower-middle of the frame, above the description text and left of the like, comment and share buttons. Keep a clear margin of about 15% at the bottom and on the right.",
      },
      {
        q: "Should I cut the pauses before or after adding subtitles?",
        a: "Before. Cutting moves every line's timing, so captions made first drift out of sync. [Cut the silences out of the video](/how/video/cut-silences-from-video) first, then caption the shorter file.",
      },
      {
        q: "Can I add subtitles in another language?",
        a: "Yes. Transcribe in the spoken language, translate the .srt (Stella can translate it and keep the timings), then burn in the translated file the same way.",
      },
    ],
    related: ["video/cut-silences-from-video", "video/compress-video-for-discord", "pc-cleanup/organize-downloads-folder"],
    lastChecked: "2026-11-10",
    sources: [
      { label: "Whisper on GitHub", href: "https://github.com/openai/whisper" },
      { label: "ffmpeg subtitles filter", href: "https://ffmpeg.org/ffmpeg-filters.html#subtitles-1" },
      { label: "CapCut auto captions", href: "https://www.capcut.com/tools/auto-caption-generator" },
    ],
  },
  {
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
      "Remove the pauses and dead air from a talking video automatically, free: auto-editor or ffmpeg by hand, or let Stella (stella.sh) cut it for you and keep the original.",
    h1: "Cut silences out of a video automatically",
    short: "Cut silences out of a video",
    lede: "The pauses cut out, the original kept, the edit ready to post.",
    answer:
      "To cut silences automatically, a tool finds the stretches where the sound stays below a loudness level for longer than a moment, then removes them with a little padding so speech doesn't sound clipped. The free, open-source auto-editor does this in one command, and ffmpeg can list every pause. Stella (stella.sh) does it on your own file: it cuts the dead air, tells you how much shorter the video is, and saves the edit next to the original.",
    stellaSteps: [
      "Measures the pauses with ffmpeg's silence detector; in the recording it tried −38 dB, settled on −34 dB, and counted anything quieter for 0.35 s or more",
      "Keeps a short pad either side of speech (120 ms here) so words aren't clipped, then cuts the pauses and joins what's left",
      "Saves the edit as a new file next to the original (here `lecture_edited.mp4`), which it leaves untouched",
      "Checks its own work: runs the detector again on the edit and plays it through before reporting",
      "Tells you the new length and what it may have left in: short pauses and very quiet speech",
    ],
    prompt: "Cut out all the silent pauses from my recording lecture.mp4.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-10",
      platform: "Linux (Omarchy)",
      model: "Stella’s own models (GPT-6 Luna)",
      result:
        "A 92-second lecture recording cut to 46 seconds. Checked afterwards with ffmpeg's silence detector (quieter than −35 dB for half a second or more): 12 pauses in the original, none in the edit. The original file was unchanged.",
      note: "The lecture is a test clip made for this run: a slide and a synthetic voice with 38 seconds of pauses added. A separate transcript of the edit matched all 135 words, nothing clipped. The wait while Stella worked is sped up 10×.",
      video: {
        src: `${PROOFS}/video/cut-silences-from-video/proof.mp4`,
        cuts: webCuts("video/cut-silences-from-video"),
        poster: `${PROOFS}/video/cut-silences-from-video/poster.jpg`,
        width: 1280,
        height: 800,
        duration: 72.1,
        realDuration: 91,
      },
      moments: [
        { at: 0, text: "The prompt, typed into Stella on a Linux computer." },
        { at: 4, text: "Sent." },
        { at: 12, text: "Stella replies that it will remove the silent gaps and save an edited copy, leaving the original untouched." },
        { at: 14, text: "Finding and cutting the quiet stretches, sped up 10×." },
        { at: 22, text: "Done: the edit is 46 seconds, down from 92, with the original untouched. Stella notes that short pauses and very quiet speech may remain." },
        { at: 34, text: "Opening the edited lecture in Stella." },
        { at: 42, text: "Playing the edit: the recording clock in the corner jumps forward wherever a pause was cut." },
      ],
      output: {
        src: `${PROOFS}/video/cut-silences-from-video/output.mp4`,
        poster: `${PROOFS}/video/cut-silences-from-video/output-poster.jpg`,
        width: 1280,
        height: 720,
        caption: "The edited lecture Stella saved, with sound: 46 seconds, down from 92. Watch the clock in the corner skip where the pauses were.",
      },
      shots: [
        {
          src: `${PROOFS}/video/cut-silences-from-video/waveform.png`,
          alt: "Sound waveforms of the lecture before and after, on the same time scale: the original has long flat gaps between phrases, the edit has none and is half as long.",
          width: 1640,
          height: 440,
          caption: "Before and after on the same time scale: the gaps are gone and the edit is half the length.",
        },
      ],
    },
    manualSteps: [
      {
        title: "Install auto-editor",
        body: "[auto-editor](https://auto-editor.com) is free and open source. Download the build for your system from its [GitHub releases](https://github.com/WyattBlue/auto-editor/releases), rename it to `auto-editor` (`auto-editor.exe` on Windows), and run it from a terminal in that folder. On a Mac, `brew install auto-editor` does the same.",
      },
      {
        title: "Run it on your video",
        body: "Run `auto-editor talk.mp4 --margin 0.2sec`. It writes `talk_ALTERED.mp4` with the quiet parts removed. The margin keeps a fifth of a second either side of speech; raise it if cuts feel abrupt.",
      },
      {
        title: "Tune the threshold if it cuts too much or too little",
        body: "If breaths or room noise count as speech, raise the threshold: `--edit audio:threshold=6%` (or give it in decibels, `--edit audio:-18dB`). If quiet words get cut, lower it. Background music defeats loudness detection, so cut a clean voice track first if you have one.",
      },
      {
        title: "Prefer to fine-tune in an editor?",
        body: "Run `auto-editor talk.mp4 --export premiere` (or `resolve`, or `final-cut-pro`) to get a timeline with the cuts already made but every clip still adjustable. Import that file into your editor and nudge any cut you don't like.",
      },
      {
        title: "Or just find the silences with ffmpeg",
        body: "To see where the gaps are without changing anything, run `ffmpeg -i talk.mp4 -af silencedetect=noise=-30dB:d=0.5 -f null -`. It prints a `silence_start` and `silence_end` for every pause longer than half a second.",
      },
    ],
    limits: [
      "Silence detection goes by loudness. With music or constant background noise under the voice, pauses and speech are hard to tell apart; expect to adjust, and check the result.",
      "In the recording it also shortened the natural gaps between sentences to about a quarter of a second, so the pacing came out brisk. Ask for a longer pad (say 0.3 s) if you want the speech to breathe.",
      "It removes dead air, not filler words like “um” or retakes. Cutting those needs a transcript-based edit, which is more careful work.",
      "Rendering the new file takes as long as your computer takes; long 4K recordings on a laptop can take a while.",
      "Stella doesn't upload or post the result anywhere. It stays on your computer.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Does cutting silences lower the video quality?",
        a: "Removing sections means the video is re-encoded, which costs a tiny amount of quality at normal settings. auto-editor and Stella both keep the original file, so you can always go back.",
      },
      {
        q: "How long a pause counts as silence?",
        a: "Most people cut pauses longer than about half a second and keep 0.1 to 0.3 seconds of padding. Shorter padding gives a punchier jump-cut style; longer feels more natural.",
      },
      {
        q: "Can it cut silences in a podcast or audio-only file?",
        a: "Yes. The same method works on MP3 and WAV files; auto-editor and ffmpeg both take audio, and Stella can do it on audio as well as video.",
      },
      {
        q: "Can I add captions after cutting the silences?",
        a: "Yes, and that's the right order: cut first, then caption, so the timings match the final edit. See [burned-in subtitles for TikTok](/how/video/burn-subtitles-into-video-for-tiktok) for the next step.",
      },
      {
        q: "Will it sync the cuts across several camera angles?",
        a: "Not automatically. For multicam edits, export a cut list from one angle into your editor and apply it there.",
      },
    ],
    related: ["video/burn-subtitles-into-video-for-tiktok", "video/compress-video-for-discord", "pc-cleanup/organize-downloads-folder"],
    lastChecked: "2026-11-10",
    sources: [
      { label: "auto-editor", href: "https://auto-editor.com" },
      { label: "ffmpeg silencedetect filter", href: "https://ffmpeg.org/ffmpeg-filters.html#silencedetect" },
    ],
  },

  {
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
      "Video too big for Discord? Shrink it under the free upload limit on your own computer with HandBrake or ffmpeg, or let Stella (stella.sh) do it and keep it sharp.",
    h1: "Compress a video for Discord",
    short: "Compress a video for Discord",
    lede: "A 231 MB clip down to 9.2 MB, still sharp, and it plays right in the chat.",
    answer:
      "Discord's free upload limit is 20 MB (it was 10 MB until August 2026). To fit, pick a video bitrate from the length (about 8,000 kilobits per minute for 10 MB), drop to 720p, and encode with H.264 so it previews inline; HandBrake does it in a window, ffmpeg from the command line. Stella (stella.sh) does it on your computer, aims just under the size you name and checks a frame.",
    stellaSteps: [
      "Finds the video you mean (in the recording, “the rocket launch one in my Videos folder”) and reads its length, resolution and sound",
      "Works out the bitrate that fits the size you asked for, here a two-pass encode aimed at about 9.5 MB",
      "Drops to 720p rather than starving 1080p of bits, and uses H.264 and AAC so Discord plays it right in the chat",
      "Grabs a frame from the middle and looks at it to check the picture still holds up",
      "Saves the copy next to the original with “(Discord)” in the name and leaves the original untouched",
    ],
    prompt:
      "Make this video small enough to send on Discord (under 10 MB). It's the rocket launch one in my Videos folder.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-12",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "A 78-second 1080p clip, 231.3 MB, became a 9.2 MB (9,223,425 bytes) 720p MP4 in 45 seconds, the full length kept. Checked afterwards: it decodes start to end with no errors, H.264 and AAC, SSIM 0.994 against the original at the same size, and frames side by side look the same. The original was byte-for-byte unchanged.",
      note: "The clip is NASA's public-domain footage of the Artemis I launch, cut to 78 seconds at 1080p and about 24 Mbit/s for this run; its audio track is silent, which Stella noticed. Waits are sped up 6× and 4×, and the dark first part of playback 4×.",
      video: {
        src: `${PROOFS}/video/compress-video-for-discord/proof.mp4`,
        cuts: webCuts("video/compress-video-for-discord"),
        poster: `${PROOFS}/video/compress-video-for-discord/poster.jpg`,
        width: 1280,
        height: 800,
        duration: 70,
        realDuration: 45,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A 231 MB, 78-second 1080p launch video is in Videos." },
        { at: 3, text: "The prompt: make it small enough to send on Discord, under 10 MB." },
        { at: 9, text: "Stella replies that it's compressing it and won't touch the original." },
        { at: 11, text: "Reading the video, then a two-pass encode at 720p, sped up 6×." },
        { at: 18, text: "Done: 9.2 MB, 720p instead of 1080p, the full 1:18, plays in Discord. The original had no sound, so no audio was lost." },
        { at: 34, text: "The compressed copy opened in Stella's player." },
        { at: 40, text: "Playing; the dark first seconds sped up 4×." },
        { at: 46, text: "Ignition and liftoff at normal speed, from the 9.2 MB file." },
      ],
      output: {
        src: `${PROOFS}/video/compress-video-for-discord/output.mp4`,
        poster: `${PROOFS}/video/compress-video-for-discord/output-poster.jpg`,
        width: 1280,
        height: 720,
        caption:
          "The exact 9.2 MB file Stella made, unedited. Source: NASA, Artemis I launch from the causeway (public domain).",
      },
      shots: [
        {
          src: `${PROOFS}/video/compress-video-for-discord/crop.jpg`,
          alt: "The same 1:1 crop of the rocket's flame and the launch tower at 40 seconds: on the left the original scaled to 720p, on the right the 9.2 MB Discord copy. The copy is very slightly softer, with no blocks.",
          width: 976,
          height: 331,
          caption: "Our check after the run: the hardest frame (flame and smoke), original and copy at 1:1.",
        },
      ],
    },
    manualTitle: "Compress it yourself",
    manualSteps: [
      {
        title: "Work out the bitrate",
        body: "Size in megabits is the limit × 8: 10 MB is 80 megabits, 20 MB is 160. Divide by the length in seconds and leave 10% spare for the container and sound: for a 78-second clip under 10 MB that's about 900 kbit/s of video with 64 kbit/s audio. Longer clips get less; past two or three minutes, trim it or send a link.",
      },
      {
        title: "In HandBrake (free, Windows and Mac)",
        body: "Open the video, choose the Fast 720p30 preset, and on the Video tab pick H.264, Avg Bitrate with your number, and tick 2-Pass Encoding. Set the audio to AAC at 64 or 96 kbit/s. Start, check the file size, and lower the bitrate a little if it comes out over.",
      },
      {
        title: "With ffmpeg",
        body: "Run `ffmpeg -i in.mp4 -vf scale=-2:720 -c:v libx264 -b:v 900k -pass 1 -an -f null NUL` (use `/dev/null` on Mac), then `ffmpeg -i in.mp4 -vf scale=-2:720 -c:v libx264 -b:v 900k -pass 2 -c:a aac -b:a 64k -movflags +faststart out.mp4`. Two passes land much closer to the target size than one.",
      },
      {
        title: "Keep it previewable",
        body: "Use H.264 video and AAC audio in an MP4. Discord shows those inline on every device; HEVC, AV1 or MKV files may just appear as a download. Avoid odd frame rates and keep 8-bit colour (yuv420p).",
      },
      {
        title: "Still too big? Trim, crop or link",
        body: "Cut the clip to the part that matters, drop to 480p for fast-moving game footage, or upload it to YouTube (unlisted), Google Drive or Streamable and paste the link. Nitro raises the limit to 500 MB, Nitro Basic to 50 MB.",
      },
    ],
    limits: [
      "This was slow-moving launch footage. Fast game clips with lots of motion look worse at the same size; expect Stella to drop to 480p or suggest trimming, which hasn't been recorded yet.",
      "It aimed for 10 MB because the prompt said so. Discord's free limit has been 20 MB since August 2026, so say “under 20 MB” if that's your limit and you'd like a sharper file.",
      "ffmpeg was already installed on the Linux computer in the recording. On a Windows PC, Stella has to install it first, which hasn't been recorded yet.",
      "Stella looks at one frame to check the quality, so that frame goes to the AI model you use in Stella. The video itself stays on your computer.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What is Discord's file size limit?",
        a: "20 MB per file on a free account since August 2026 (it was 10 MB from 2024), 50 MB with Nitro Basic and 500 MB with Nitro. Check what the upload box says on your account; Discord has been testing different limits.",
      },
      {
        q: "Can I compress a video without losing quality?",
        a: "Not to a tenth of its size, but you can lose quality you won't notice. Lower the resolution to 720p first and use two-pass H.264. In the recording the copy measured SSIM 0.994 against the original, and frames side by side look the same.",
      },
      {
        q: "Are online video compressors safe?",
        a: "The well-known ones are, but your video is uploaded to their servers, and free tiers often limit length or add a watermark. Doing it on your computer avoids all three.",
      },
      {
        q: "Can Stella also cut or caption the clip?",
        a: "Yes, in the same chat: trim it to the best part, [cut out silent pauses](/how/video/cut-silences-from-video) or [burn in subtitles](/how/video/burn-subtitles-into-video-for-tiktok) before it's compressed.",
      },
    ],
    related: ["video/cut-silences-from-video", "video/convert-mkv-to-mp4", "video/burn-subtitles-into-video-for-tiktok"],
    lastChecked: "2026-11-12",
    sources: [
      { label: "HandBrake", href: "https://handbrake.fr" },
      { label: "FFmpeg documentation", href: "https://ffmpeg.org/ffmpeg.html" },
      { label: "Dexerto: Discord raises free upload limit to 20MB (August 2026)", href: "https://www.dexerto.com/entertainment/discord-raises-free-upload-limit-to-20mb-after-lowering-it-two-years-ago-3398251/" },
      { label: "NASA: Artemis I Launch from NASA Causeway (source footage)", href: "https://images.nasa.gov/details/GX010506" },
    ],
  },
  {
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
      "TV won't play your MKV movies? Convert them to MP4 with VLC, HandBrake or ffmpeg, often without re-encoding, or let Stella (stella.sh) check each file and do it.",
    h1: "Convert MKV to MP4 so your TV plays it",
    short: "Convert MKV to MP4 for your TV",
    lede: "Three MKV movies turned into MP4s, with the sound and English subtitles still there.",
    answer:
      "An MKV is a box around video, sound and subtitles, and TVs usually reject one thing inside it, not the box. If the video is H.264 and the sound AAC, just copy them into an MP4 (seconds, no quality lost); convert only what the TV can't play, often HEVC video or Dolby Digital sound. HandBrake, VLC and ffmpeg all do it for free. Stella (stella.sh) checks each file and converts only what it has to.",
    stellaSteps: [
      "Looks inside every MKV for its video, sound and subtitle tracks, in the recording three films with three different mixes",
      "Copies the picture and sound straight across when they're already in a format TVs play, so nothing is re-encoded and it takes seconds",
      "Converts only what a TV may refuse: Dolby Digital (AC3) sound to AAC, and HEVC video to H.264, testing a few quality settings first",
      "Turns the subtitle track into the kind an MP4 can carry, so the English subtitles come along",
      "Checks every new file plays to the end, saves them next to the MKVs with the same names, and leaves the originals alone",
    ],
    prompt: "My TV won't play these MKV movies, convert them to MP4 so they work. They're in Videos/Movies.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-12",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Three MKVs became three MP4s in 1 minute 46 seconds. One was only repackaged, one had its Dolby Digital sound converted to AAC, and one had its HEVC video re-encoded to H.264 with its 5.1 sound kept. Checked afterwards: all three decode start to end with no errors, the lengths match to within 0.02 s, the loudness to within 0.1 dB, and all 29 subtitle lines are there with the same text and timing. The MKVs were byte-for-byte unchanged.",
      note: "The three test films are 32–36-second clips of NASA's public-domain Artemis I launch footage at 720p, each with a generated narration track and an English subtitle track that matches it. They were made for this run: one H.264 with AAC sound, one H.264 with Dolby Digital stereo, one HEVC with Dolby Digital 5.1. The wait is sped up 12×. We didn't play the files on a real TV.",
      video: {
        src: `${PROOFS}/video/convert-mkv-to-mp4/proof.mp4`,
        cuts: webCuts("video/convert-mkv-to-mp4"),
        poster: `${PROOFS}/video/convert-mkv-to-mp4/poster.jpg`,
        width: 1280,
        height: 800,
        duration: 41,
        realDuration: 106,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Three MKV films are in Videos/Movies." },
        { at: 3, text: "The prompt: my TV won't play these MKV movies, convert them to MP4 so they work." },
        { at: 8, text: "Stella replies: each MP4 goes next to its original, and the MKVs stay where they are." },
        { at: 11, text: "Checking every track in every file, then converting all three at once, sped up 12×." },
        { at: 19.5, text: "Done. Launch Night was copied as it was, Three Miles Out had its Dolby Digital sound converted, and Ignition's HEVC video became H.264. All three keep their English subtitles." },
        { at: 30, text: "It couldn't test on the TV itself, says the subtitles are now on by default, and offers to delete the MKVs once you've checked." },
      ],
    },
    manualTitle: "Convert it yourself",
    manualSteps: [
      {
        title: "See what's inside the MKV",
        body: "Open it in VLC and choose Tools > Codec Information (Window > Media Information on a Mac), or install MediaInfo. Note the video codec (H.264/AVC or HEVC/H.265), the audio codec (AAC, AC3/Dolby Digital, E-AC3, DTS) and whether there's a subtitle track. Compare that with your TV's manual: many play H.264 with AAC everywhere, while HEVC, AC3 and DTS support depends on the brand and year.",
      },
      {
        title: "If the video is H.264, just repackage it",
        body: "With ffmpeg, `ffmpeg -i movie.mkv -map 0 -c copy -c:s mov_text -movflags +faststart movie.mp4` copies the picture and sound into an MP4 in seconds with no quality lost, and turns text subtitles into the MP4 kind. Add `-c:a aac -b:a 256k` (before the output name) if the TV complains about the sound only.",
      },
      {
        title: "If it's HEVC, or you'd rather use a window",
        body: "In HandBrake (free, Windows and Mac), open the file, pick the Fast 1080p30 preset (or 720p for a smaller file), keep the Format as MP4, set the Video Encoder to H.264, and on the Audio tab choose AAC. On the Subtitles tab add the English track and leave Burn In off to keep them switchable. Re-encoding a full film can take as long as the film or longer on a laptop.",
      },
      {
        title: "Or use VLC",
        body: "Choose Media > Convert / Save, add the MKV, click Convert / Save, pick the profile Video – H.264 + MP3 (MP4) and a file name ending in .mp4, then Start. It's simple, but VLC always re-encodes and may drop the subtitles, so check the result.",
      },
      {
        title: "Subtitles still don't show?",
        body: "Many TVs ignore subtitles stored inside an MP4 but show a separate file. Save the subtitles as `Movie Name.srt` next to `Movie Name.mp4` (in ffmpeg, `ffmpeg -i movie.mkv -map 0:s:0 movie.srt`), or burn them into the picture in HandBrake if you always want them on. Image subtitles from Blu-rays (PGS) can't go into an MP4 as text; burn them in instead.",
      },
    ],
    limits: [
      "We didn't play the MP4s on a real TV. “Works” here means they decode start to end with no errors in H.264 and AAC, which most TVs since about 2012 play; check one on yours before deleting the MKVs.",
      "The subtitles ended up switched on by default in all three files, and Stella said it couldn't change that back. It also didn't make separate .srt files, which some TVs need to show subtitles at all; ask for them if yours ignores the built-in ones.",
      "The test films were half a minute long. A two-hour film that only needs repackaging still takes seconds, but one that needs HEVC re-encoded can take an hour or more on a laptop, and the H.264 file comes out bigger (here 2.8 MB became 5.1 MB).",
      "ffmpeg was already on the Linux computer in the recording. On Windows or a Mac, Stella would install it first, which hasn't been recorded yet.",
      "Copy-protected files (from a streaming app or an encrypted Blu-ray) can't be converted.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Does converting MKV to MP4 lose quality?",
        a: "Not if it only repackages: copying H.264 video and AAC sound into an MP4 keeps them bit for bit. Quality is only lost when something is re-encoded, like HEVC to H.264, and at a sensible setting (HandBrake's presets, or ffmpeg's `-crf 20`) it's hard to see.",
      },
      {
        q: "Why does my TV play the picture but not the sound?",
        a: "The sound track is usually Dolby Digital (AC3), E-AC3 or DTS, which some TVs won't decode inside an MP4 or from a USB stick. Converting only the sound to AAC fixes it and leaves the picture untouched; that's what Stella did for one of the three test films.",
      },
      {
        q: "Will the subtitles carry over?",
        a: "Text subtitles (SRT, ASS) can go into an MP4 as a switchable track, and did in the recording, but not every TV shows that kind. A separate .srt file with the same name, or burning them into the picture, works almost everywhere.",
      },
      {
        q: "Is there a way without converting at all?",
        a: "Yes. A media server such as Plex or Jellyfin converts on the fly while you watch, and a cheap streaming stick (Chromecast, Fire TV, Apple TV with Infuse) plays most MKVs directly.",
      },
    ],
    related: ["video/compress-video-for-discord", "video/burn-subtitles-into-video-for-tiktok"],
    lastChecked: "2026-11-12",
    sources: [
      { label: "HandBrake documentation: subtitles", href: "https://handbrake.fr/docs/en/latest/advanced/subtitles.html" },
      { label: "FFmpeg documentation", href: "https://ffmpeg.org/ffmpeg.html" },
      { label: "VideoLAN: VLC media player", href: "https://www.videolan.org/vlc/" },
      { label: "Samsung Developers: TV video specifications", href: "https://developer.samsung.com/smarttv/develop/specifications/media-specifications/2025-tv-video-specifications.html" },
      { label: "NASA: Artemis I Launch from NASA Causeway (source footage)", href: "https://images.nasa.gov/details/GX010506" },
    ],
  },
];
