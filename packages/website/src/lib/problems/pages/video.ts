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
    related: ["video/cut-silences-from-video", "video/compress-video-for-discord", "pc-cleanup/organize-downloads-folder", "audio/transcribe-voice-memos-to-text", "video/make-srt-subtitle-file", "video/crop-video-to-vertical"],
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
    related: ["video/burn-subtitles-into-video-for-tiktok", "video/compress-video-for-discord", "pc-cleanup/organize-downloads-folder", "video/speed-up-video", "video/cut-out-part-of-video"],
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
    related: ["video/cut-silences-from-video", "video/convert-mkv-to-mp4", "video/burn-subtitles-into-video-for-tiktok", "video/combine-videos-into-one"],
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
    related: ["video/compress-video-for-discord", "video/burn-subtitles-into-video-for-tiktok", "video/combine-videos-into-one", "video/convert-mov-to-mp4", "video/convert-webm-to-mp4"],
    lastChecked: "2026-11-12",
    sources: [
      { label: "HandBrake documentation: subtitles", href: "https://handbrake.fr/docs/en/latest/advanced/subtitles.html" },
      { label: "FFmpeg documentation", href: "https://ffmpeg.org/ffmpeg.html" },
      { label: "VideoLAN: VLC media player", href: "https://www.videolan.org/vlc/" },
      { label: "Samsung Developers: TV video specifications", href: "https://developer.samsung.com/smarttv/develop/specifications/media-specifications/2025-tv-video-specifications.html" },
      { label: "NASA: Artemis I Launch from NASA Causeway (source footage)", href: "https://images.nasa.gov/details/GX010506" },
    ],
  },
  {
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
      "Join phone clips into one video in the order they were filmed, portrait and landscape mixed: QuickTime, Clipchamp, ffmpeg, or Stella (stella.sh) on your computer.",
    h1: "Merge videos into one, in the order they were filmed",
    short: "Combine videos into one",
    lede: "Six mixed phone clips joined into one 30-second video, nothing stretched.",
    answer:
      "On a Mac, open the first clip in QuickTime Player and use Edit, Add Clip to End for each of the others, then File, Export As. On Windows 11, Clipchamp joins clips on a timeline. Mixed clips are where it goes wrong: a portrait clip gets stretched, or a silent one breaks the sound. Stella (stella.sh) puts the clips in filming order, fits each into one frame size and joins them.",
    stellaSteps: [
      "Finds the beach day clips in Movies and orders them by the recording time saved in each file, not just by file name",
      "Fits every clip into one 1920 × 1080 frame, with black bars beside the portrait clip instead of stretching it",
      "Converts the mix of frame rates and formats (one clip at 25 fps, one HEVC at 60 fps) into one 30 fps H.264 video",
      "Puts silence under the clip that had no sound, so the audio runs the whole way through",
      "Saves Beach day.mp4 next to the clips and leaves them unchanged; it also noticed the clips were plain test cards, not beach footage, and said so",
    ],
    prompt: "Join the beach day clips in my Movies folder into one video, in the order they were filmed.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "One 30-second video from six clips in about 1 minute 40 seconds. Checked afterwards against an answer key written before the run: it plays without errors, all six clips are there in filming order, the audio runs the full length, the portrait clip isn't stretched (a round disc in it stays round), and the six clips are unchanged.",
      note: "The clips are plain coloured test cards with tones, made for this run and mixed on purpose: portrait and landscape, 25, 30 and 60 fps, H.264 and HEVC, one with no sound. Stella spotted they weren't real beach footage and said so. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/video/combine-videos-into-one/proof.mp4`,
        cuts: webCuts("video/combine-videos-into-one"),
        poster: `${PROOFS}/video/combine-videos-into-one/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 46.7,
        realDuration: 99,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Six beach day clips are in Movies, filmed on different settings." },
        { at: 2, text: "The prompt: join them into one video, in the order they were filmed." },
        { at: 15.3, text: "Stella replies: it'll order the clips by when they were filmed and save the video next to them." },
        { at: 21.1, text: "Ordering and joining six mixed clips, sped up 4×." },
        { at: 32.7, text: "Done: Beach day.mp4, 30 seconds, in filming order, the portrait clip with black bars and the silent clip kept silent." },
      ],
    },
    manualTitle: "Join them yourself",
    manualSteps: [
      {
        title: "Put the clips in order",
        body: "Sort the clips by when they were filmed, not by name: in Finder use View, as List with the Date Created column; in File Explorer use Details view and add Media created. Phone file numbers usually match, but clips from two phones won't.",
      },
      {
        title: "On a Mac: QuickTime Player",
        body: "Open the first clip in QuickTime Player, choose Edit, Add Clip to End and pick the next one; repeat in order, dragging clips in the strip to reorder. Then File, Export As, 1080p saves the joined video. Portrait clips get black bars.",
      },
      {
        title: "On Windows: Clipchamp",
        body: "Open Clipchamp (built into Windows 11), create a new video, import the clips and drag them onto the timeline in order. If a portrait clip is cropped, use the fit option on it, then export at 1080p.",
      },
      {
        title: "Or iMovie on a Mac",
        body: "Create a new Movie project, import the clips, drag them to the timeline in order and choose File, Share, File. iMovie also lets you add titles, transitions or a music track if you want them.",
      },
      {
        title: "Command line: ffmpeg",
        body: "ffmpeg's concat demuxer joins clips without re-encoding only if every clip has the same size, frame rate and codec. Phone clips rarely do, so scale and pad each to one size and frame rate first, or use the concat filter, which re-encodes them all together.",
      },
    ],
    limits: [
      "It joins clips and makes them fit one frame. Transitions, titles, music and trimming weren't asked for; say so in the prompt if you want them.",
      "Clips are re-encoded to match, which takes longer for long or 4K footage and costs a little quality.",
      "To describe the clips it looked at frames from them, which go to the AI model you use in Stella along with file details. The video itself is joined on your computer.",
      "Recorded on Linux, where ffmpeg was already installed. On a Mac or Windows PC Stella would download it first, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I merge videos without losing quality?",
        a: "If every clip shares the same size, frame rate and codec, ffmpeg can join them without re-encoding. Mixed phone clips need re-encoding to match; at a good quality setting the loss is hard to see.",
      },
      {
        q: "Why is my portrait clip stretched after merging?",
        a: "The joiner forced it into a landscape frame. Fit it with black bars, as QuickTime and Stella did, or crop it, but don't scale it to fill the frame.",
      },
      {
        q: "Can I add music or cut it down afterwards?",
        a: "Yes, ask in the same chat, or add a track in iMovie or Clipchamp. To [cut out silences](/how/video/cut-silences-from-video) or [shrink the result for Discord](/how/video/compress-video-for-discord), see those guides.",
      },
      {
        q: "Does it work with iPhone videos in HEVC?",
        a: "Yes. One of the test clips was HEVC at 60 fps and joined fine. Older Windows PCs may need the HEVC extension to play the originals, but the joined file is H.264, which plays almost anywhere.",
      },
    ],
    related: ["video/compress-video-for-discord", "video/cut-silences-from-video", "video/convert-mkv-to-mp4", "video/make-slideshow-with-music"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Add a movie or clip to another in QuickTime Player", href: "https://support.apple.com/guide/quicktime-player/qtp00386594f/mac" },
      { label: "Apple: iMovie User Guide", href: "https://support.apple.com/guide/imovie/welcome/mac" },
      { label: "Clipchamp: How to combine videos", href: "https://clipchamp.com/en/resources/how-to-combine-videos/" },
      { label: "FFmpeg wiki: Concatenate", href: "https://trac.ffmpeg.org/wiki/Concatenate" },
    ],
  },
  {
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
      "Turn a folder of photos and your own song into a slideshow video with set time per photo: Photos, iMovie, Clipchamp, or Stella (stella.sh), no watermark or sign-up.",
    h1: "How to make a slideshow with music from your own photos",
    short: "Make a slideshow with music",
    lede: "20 trip photos and a song as an 80-second MP4, 4 seconds a photo, nothing stretched.",
    answer:
      "On a Mac, the Photos app makes a slideshow project from selected photos; you pick a song and a time per slide, then export it. iMovie and Windows' Clipchamp do the same on a timeline with more control. Online makers often add a watermark or want an account. Stella (stella.sh) puts your photos in order with your song, at the time per photo you ask for, and saves an MP4.",
    stellaSteps: [
      "Finds the Lake trip photos (20, four of them portrait) and the song in Downloads",
      "Shows each photo for 4 seconds in the order they were saved, making an 80-second video",
      "Fits portrait photos into the frame the right way up instead of stretching them",
      "Lays the song under the whole video, cutting it at 80 seconds with a fade-out, since the song is 100 seconds long",
      "Saves an MP4 in your Videos folder, leaves the photos and song unchanged, and offers to stretch it to about 5 seconds a photo so the whole song plays",
    ],
    prompt: "Make a slideshow video of my Lake trip photos with the song in my Downloads, about 4 seconds per photo.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "An 80-second H.264 MP4 in about 2 minutes 40 seconds. Checked afterwards against an answer key written before the run: all 20 photos appear in order, each on screen for at least 3 seconds, the portrait photos aren't stretched, the music plays for the whole video, it plays without errors, and the photos and song are unchanged.",
      note: "The photos are drawn lake scenes and the song an instrumental synthesised for this run. Stella saved the video in Videos, the Linux equivalent of the Mac's Movies folder; our check looked there after the run, with the answer key unchanged. The work is sped up 10×.",
      video: {
        src: `${PROOFS}/video/make-slideshow-with-music/proof.mp4`,
        cuts: webCuts("video/make-slideshow-with-music"),
        poster: `${PROOFS}/video/make-slideshow-with-music/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 45.9,
        realDuration: 162,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. 20 Lake trip photos are in Pictures and a song is in Downloads." },
        { at: 2, text: "The prompt: a slideshow video with the song, about 4 seconds per photo." },
        { at: 14, text: "Stella replies that it's finding the photos and song and putting them together." },
        { at: 19.8, text: "Building the slideshow, sped up 10×." },
        { at: 31.9, text: "Done: 80 seconds, 20 photos at 4 seconds each, the song fading out at the end, with the video right there in the chat." },
      ],
    },
    manualTitle: "Make it yourself",
    manualSteps: [
      {
        title: "On a Mac: Photos",
        body: "Select the photos in the Photos app, then File, Create, Slideshow, Photos, and name it. In the slideshow project, click the Music button to choose a song from your Music library, and the Duration button to set a custom time per slide. File, Export, Export Slideshow saves a video.",
      },
      {
        title: "On a Mac with more control: iMovie",
        body: "Create a new Movie, import the photos and drag them to the timeline in order. Select them all and set the clip duration (for example 4 seconds) in the clip inspector, drag the song under them, then File, Share, File.",
      },
      {
        title: "On Windows: Clipchamp",
        body: "Open Clipchamp (built into Windows 11), create a video, import the photos and the song, and drag the photos onto the timeline. Set each photo's length, drag the song onto the audio track below, trim it to the end of the last photo, and export at 1080p.",
      },
      {
        title: "Match the music to the photos",
        body: "Photos times song length is the trick: 20 photos at 4 seconds is 80 seconds, so a 100-second song gets cut. Either fade the music out at the end or set about 5 seconds a photo so the whole song plays.",
      },
      {
        title: "Mind portrait photos",
        body: "Mixed portrait and landscape photos either get black bars or are cropped to fill the frame. Both are fine; stretching is not. Check one portrait photo in the preview before exporting.",
      },
    ],
    limits: [
      "It made a plain slideshow with cuts between photos. Pan-and-zoom effects, titles and transitions weren't asked for; describe them in the prompt if you want them.",
      "It used the photos' saved order. If they're out of order, say “in the order they were taken” or name the order.",
      "Use music you're allowed to share if you post the video online; platforms may mute or remove videos with copyrighted songs.",
      "Recorded on Linux, where ffmpeg was already installed. On a Mac or Windows PC Stella would download it first, which wasn't recorded. It saved to Videos here; on a Mac that's Movies.",
      "File names and details go to the AI model you use in Stella; the photos and song are put together on your computer.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can I use my own song in a Photos slideshow on Mac?",
        a: "Yes, if the song is in your Music library: the slideshow's Music button lists it. Songs that are only in Downloads need adding to Music first. Stella uses any audio file directly.",
      },
      {
        q: "How long should each photo be on screen?",
        a: "3 to 5 seconds suits most slideshows. Shorter feels rushed, longer drags. Work backwards from the song: its length divided by the number of photos.",
      },
      {
        q: "Will it put a watermark on the video?",
        a: "No. Photos, iMovie, Clipchamp's free tier at 1080p, and Stella make videos without a watermark. Many online slideshow makers add one unless you pay.",
      },
      {
        q: "Can it join video clips into the slideshow too?",
        a: "Yes, in the same chat. For clips on their own, see [combine videos into one](/how/video/combine-videos-into-one); to send the result, [compress it for Discord](/how/video/compress-video-for-discord).",
      },
    ],
    related: ["video/combine-videos-into-one", "video/compress-video-for-discord", "photos-files/resize-images-in-bulk"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Create slideshows in Photos on Mac", href: "https://support.apple.com/guide/photos/phtae8c6d40/mac" },
      { label: "Apple: iMovie User Guide", href: "https://support.apple.com/guide/imovie/welcome/mac" },
      { label: "Clipchamp: How to make a slideshow", href: "https://clipchamp.com/en/resources/how-to-make-a-slideshow/" },
    ],
  },
  {
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
      "iPhone MOV videos won't play on a TV or Windows laptop? Convert them to H.264 MP4 with HandBrake, QuickTime, ffmpeg, or Stella (stella.sh) on your computer.",
    h1: "Convert MOV to MP4 so your phone videos play anywhere",
    short: "Convert MOV to MP4",
    lede: "Five phone videos as MP4s that TVs and Windows play, upright clips kept upright.",
    answer:
      "Renaming .mov to .mp4 rarely helps: recent iPhones record HEVC (H.265), which many TVs and Windows PCs can't play without an add-on. Convert to H.264 MP4 instead, with the free HandBrake (preset Fast 1080p30) on Mac or Windows, or ffmpeg. Stella (stella.sh) converted a folder of phone MOVs to H.264 MP4s, kept upright clips upright, and left the originals alone.",
    stellaSteps: [
      "Finds the From my phone folder in Videos: five MOV clips, four of them HEVC (one 10-bit HDR) and one already H.264",
      "Spots that two clips were filmed upright and only marked to be turned at playback, which many TVs ignore",
      "Re-encodes the four HEVC clips to H.264 MP4 at high quality, turning the upright ones' picture itself so they show upright everywhere, and keeps the sound",
      "Repackages the clip that was already H.264 as MP4 without re-encoding it",
      "Plays every new file through, compares picture quality with the originals, saves the MP4s next to the MOVs with the same names and leaves the MOVs untouched",
    ],
    prompt:
      "My TV won't play the videos from my phone in the 'From my phone' folder in Videos. They're MOV files. Convert them to MP4 so they play on the TV and on my sister's Windows laptop.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Five MP4s in about 1 minute 35 seconds. Checked afterwards against an answer key written before the run: one MP4 per MOV, all H.264 8-bit (which TVs and Windows play), sound kept as AAC, the same length and picture, portrait clips still portrait, no file over 4× its MOV's size, and the MOVs unchanged.",
      note: "The clips were made for this run in the formats iPhones record, including a 10-bit HDR clip and two rotated portrait clips. Our check script was fixed after the run to count files that kept their original dates, and re-scored; the answer key didn't change. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/video/convert-mov-to-mp4/proof.mp4`,
        cuts: webCuts("video/convert-mov-to-mp4"),
        poster: `${PROOFS}/video/convert-mov-to-mp4/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 44.43,
        realDuration: 95,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Five MOV videos from a phone are in Videos." },
        { at: 1.67, text: "The prompt: convert them to MP4 so they play on the TV and a Windows laptop." },
        { at: 12.67, text: "Stella replies it's using the format most TVs and Windows laptops play, keeping the MOVs." },
        { at: 18.67, text: "Converting four HEVC clips and checking each result." },
        { at: 30.07, text: "Done: five MP4s; four were HEVC, two upright clips were turned for good, sizes only slightly bigger." },
      ],
    },
    manualTitle: "Convert them yourself",
    manualSteps: [
      {
        title: "HandBrake (Windows, Mac, Linux)",
        body: "Install the free HandBrake and open the folder (File, Open Source, choose the folder). Pick the preset Fast 1080p30 (or Fast 2160p60 for 4K), make sure the format is MP4 and the video encoder H.264, then Add All to the queue and Start Queue.",
      },
      {
        title: "Mac: QuickTime Player",
        body: "Open the clip and choose File, Export As, 1080p, then tick Greater Compatibility (H.264). It still saves a .mov, but an H.264 one most TVs play. For a real .mp4, use HandBrake.",
      },
      {
        title: "ffmpeg",
        body: "`ffmpeg -i IMG_4101.MOV -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac IMG_4101.mp4` makes an H.264 MP4. ffmpeg applies the phone's rotation flag, so upright clips come out upright. `-c copy` alone keeps the HEVC video and won't fix playback.",
      },
      {
        title: "Change the iPhone setting for next time",
        body: "In Settings, Camera, Formats, choose Most Compatible to record H.264 instead of HEVC. Files are bigger, but play everywhere. Turning off HDR Video avoids washed-out colours on non-HDR screens.",
      },
      {
        title: "Or add HEVC to Windows",
        body: "Windows can play HEVC with Microsoft's HEVC Video Extensions from the Microsoft Store (a small charge) or a player like VLC. TVs usually can't be updated this way.",
      },
    ],
    limits: [
      "Converting re-encodes the video. H.264 files are a little bigger than HEVC at the same quality; here they grew by a few hundred KB each.",
      "HDR clips become standard dynamic range so ordinary screens show them correctly.",
      "File names and each clip's format details go to the AI model you use in Stella; the videos are converted on your computer and aren't uploaded.",
      "Recorded on Linux with ffmpeg already installed. On a Mac or Windows PC Stella would usually download ffmpeg first, which isn't shown. It can't test playback on your TV.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why won't my iPhone videos play on my TV?",
        a: "Most likely they're HEVC (H.265). Many TVs, especially older ones, and Windows PCs without the HEVC extension can't decode it. Converting to H.264 fixes it.",
      },
      {
        q: "Can I convert MOV to MP4 without losing quality?",
        a: "If the MOV is already H.264, yes: it can be repackaged as MP4 without re-encoding, as Stella did for one clip. HEVC clips need re-encoding, which at a high-quality setting looks the same.",
      },
      {
        q: "Why is my video sideways after converting?",
        a: "The phone stored it sideways with a flag saying how to turn it, and the converter dropped the flag. Stella turned the picture itself. For a clip that was filmed sideways, see [rotate a video](/how/video/rotate-video).",
      },
      {
        q: "What about MKV files?",
        a: "See [convert MKV to MP4](/how/video/convert-mkv-to-mp4). To make a video small enough to send, see [compress a video for Discord](/how/video/compress-video-for-discord).",
      },
    ],
    related: ["video/convert-mkv-to-mp4", "video/rotate-video", "photos-files/convert-heic-to-jpg", "video/convert-avi-to-mp4"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "HandBrake documentation", href: "https://handbrake.fr/docs/en/latest/" },
      { label: "Apple: Export movies in QuickTime Player on Mac", href: "https://support.apple.com/guide/quicktime-player/qtp20e395859/mac" },
    ],
  },
  {
    slug: "convert-srt-to-vtt",
    niche: "video",
    searchPhrases: [
      "srt to vtt",
      "convert srt to vtt",
      "subtitle converter",
      "convert subtitles to utf 8",
      "srt file",
    ],
    title: "Convert SRT to VTT for a website video player, timings kept",
    description:
      "Turn .srt subtitles into WebVTT for an HTML5 video player, with exact timings and accents that don't break: Subtitle Edit, ffmpeg, or Stella (stella.sh).",
    h1: "Convert SRT subtitles to VTT",
    short: "Convert SRT to VTT",
    lede: "Eight subtitle files as .vtt with every timing identical and the accents fixed.",
    answer:
      "WebVTT is SRT with a `WEBVTT` line at the top and full stops instead of commas in the timestamps. For one file, a text editor will do; for a folder, the free Subtitle Edit batch-converts, and ffmpeg converts one file per command. The trap is old SRTs saved in a Windows encoding, whose accents turn to garbage. Stella (stella.sh) converted eight SRTs, kept all 260 timings exactly, and fixed one file's broken encoding.",
    stellaSteps: [
      "Finds the eight .srt files in the Garden series folder in Videos and reads them",
      "Notices episode 3 isn't valid UTF-8 and checks it: it was saved in an older Windows encoding, so accents like café and jardín would break",
      "Writes a .vtt next to each .srt: the WEBVTT header, commas in timestamps changed to full stops, and nothing else in the text changed",
      "Reads episode 3 in its real encoding, removes an invisible byte-order mark from episode 5, and makes line endings consistent",
      "Compares every timestamp in all 260 subtitles against the originals, keeps italics, and leaves the .srt files unchanged",
    ],
    prompt:
      "The subtitle files in the Garden series folder in my Videos are .srt, but my website's video player needs .vtt. Convert all eight and keep the timings exactly the same.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Eight .vtt files in about 1 minute. Checked afterwards against an answer key written before the run: 8 files that start with WEBVTT and keep every cue's exact timing and text, the Windows-encoded episode's accents (café, jardín, crème) right, italic tags kept, no byte-order mark, and the .srt files unchanged.",
      note: "The subtitles were written for this run, with three files saved the awkward ways real ones often are. The recording plays at normal speed.",
      video: {
        src: `${PROOFS}/video/convert-srt-to-vtt/proof.mp4`,
        cuts: webCuts("video/convert-srt-to-vtt"),
        poster: `${PROOFS}/video/convert-srt-to-vtt/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 41.67,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Eight .srt subtitle files are in a Garden series folder in Videos." },
        { at: 1.67, text: "The prompt: convert all eight to .vtt for a website player, timings exactly the same." },
        { at: 17.67, text: "Stella notes episode 3 isn't valid UTF-8, probably an old Windows encoding, and checks it." },
        { at: 27.67, text: "Done: eight .vtt files, all 260 timings compared and matching, episode 3's accents fixed." },
      ],
    },
    manualTitle: "Convert them yourself",
    manualSteps: [
      {
        title: "One file in a text editor",
        body: "Open the .srt in a plain-text editor (TextEdit in plain-text mode, Notepad). Add `WEBVTT` and an empty line at the very top. In each timing line, change the comma before the milliseconds to a full stop (`00:00:01,250` becomes `00:00:01.250`). Leave commas in the dialogue alone. Save as UTF-8 with a .vtt extension.",
      },
      {
        title: "A folder: Subtitle Edit",
        body: "In the free Subtitle Edit (Windows, with a newer cross-platform build for Mac and Linux), open Tools, Batch convert, add the .srt files, set Format to WebVTT and press Convert. If accents look wrong, set the input encoding to Windows-1252 and try again.",
      },
      {
        title: "ffmpeg",
        body: "`ffmpeg -i \"Garden series E01.srt\" \"Garden series E01.vtt\"` converts one file. For a file in an old Windows encoding, add `-sub_charenc CP1252` before `-i` or the accents break.",
      },
      {
        title: "Check the encoding",
        body: "If you see Ã© where é should be, or a question mark in a diamond, the file was read in the wrong encoding. Reopen it as Windows-1252 (or Latin-1) and save it as UTF-8 before converting.",
      },
      {
        title: "Hook it up on the page",
        body: "In HTML, add `<track kind=\"subtitles\" src=\"E01.vtt\" srclang=\"en\" label=\"English\">` inside the `<video>` element. The .vtt must be served from the same site, or with CORS allowed.",
      },
    ],
    limits: [
      "It converts files; it doesn't upload them to your site or edit your player's code unless you ask.",
      "Styling beyond italics and bold may not show the same in every player.",
      "The subtitle text was read by the AI model you use in Stella to work out encodings and check the conversion. Fine for most subtitles; keep in mind for unreleased material.",
      "Recorded on Linux. The conversion used Stella's built-in scripting, nothing installed, so it works the same on a Mac or Windows PC.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What's the difference between SRT and VTT?",
        a: "Almost nothing for plain subtitles: VTT starts with a WEBVTT line and uses full stops in timestamps. VTT also supports positioning and styling, and it's the format HTML5 video players read.",
      },
      {
        q: "Will converting change my subtitle timings?",
        a: "It shouldn't. Only the separator character changes. Stella compared all 260 timestamps after converting and every one matched.",
      },
      {
        q: "Can I convert VTT back to SRT?",
        a: "Yes, the same way in reverse, or with `ffmpeg -i in.vtt out.srt`. Ask Stella and it will do the folder.",
      },
      {
        q: "Can it make subtitles from scratch?",
        a: "Yes: see [make an SRT subtitle file](/how/video/make-srt-subtitle-file). To burn them into the picture for social media, see [burn subtitles into a video](/how/video/burn-subtitles-into-video-for-tiktok).",
      },
    ],
    related: ["video/make-srt-subtitle-file", "video/burn-subtitles-into-video-for-tiktok", "video/convert-mov-to-mp4"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "W3C: WebVTT format", href: "https://www.w3.org/TR/webvtt1/" },
      { label: "Subtitle Edit command line (seconv)", href: "https://niksedk.github.io/subtitleedit-avalonia/reference/command-line.html" },
      { label: "MDN: the track element", href: "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/track" },
    ],
  },
  {
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
      "Save one picture per second from a video as full-resolution JPGs, to pick the best shot: VLC's scene filter, ffmpeg, or Stella (stella.sh) on your own computer.",
    h1: "Extract frames from a video as JPGs",
    short: "Extract frames from video",
    lede: "One full-size JPG for every second of a 40-second video, named by time.",
    answer:
      "ffmpeg does it in one line: `ffmpeg -i video.mp4 -vf fps=1 -q:v 2 frame_%03d.jpg` saves one JPG per second at full size. Without a command line, VLC's Scene video filter saves frames while the video plays. Online frame grabbers often shrink the pictures. Stella (stella.sh) saved 40 full-resolution JPGs from a bird-feeder video, one per second, named by their time in the video.",
    stellaSteps: [
      "Finds “Bird feeder” in Videos: 40 seconds at 1920×1080",
      "Saves one frame for each second, 0 to 39, at the video's full resolution and the highest JPG quality",
      "Names each file by its moment, from Bird feeder 00m00s.jpg to 00m39s.jpg, so they sort in order and you can find the moment in the video",
      "Looks at a sample frame and reads the video's time code in several frames to confirm they're one second apart",
      "Puts them in a new Bird feeder frames folder next to the video, leaves the video unchanged, and says it didn't search for the woodpecker itself",
    ],
    prompt:
      "Save a picture for every second of the 'Bird feeder' video in my Videos folder, as full-quality JPGs, so I can pick the best shot of the woodpecker.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "40 JPGs in about 1 minute 25 seconds. Checked afterwards against an answer key written before the run, using a time code drawn into each frame: 40 JPGs at the full 1920×1080, exactly one second apart in file-name order, covering the whole video from 0 to 39 seconds, and the video unchanged.",
      note: "The video is a drawn animation made for this run, with a small time code in the corner for checking. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/video/extract-frames-from-video/proof.mp4`,
        cuts: webCuts("video/extract-frames-from-video"),
        poster: `${PROOFS}/video/extract-frames-from-video/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 42.27,
        realDuration: 84,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A 40-second bird-feeder video is in Videos." },
        { at: 1.63, text: "The prompt: a full-quality JPG for every second, to pick the best shot of the woodpecker." },
        { at: 9.63, text: "Stella replies: one frame per second at full resolution, in a new folder next to the video." },
        { at: 15.63, text: "Saving 40 frames and checking their timing." },
        { at: 27.83, text: "Done: 40 full-size JPGs named 00m00s to 00m39s; the woodpecker is yours to find." },
      ],
    },
    manualTitle: "Extract them yourself",
    manualSteps: [
      {
        title: "ffmpeg (Windows, Mac, Linux)",
        body: "`ffmpeg -i \"Bird feeder.mp4\" -vf fps=1 -q:v 2 \"frame_%03d.jpg\"` saves one frame per second, numbered 001, 002 and so on. `-q:v 2` is near-top JPG quality (1 is the highest). Use `fps=5` for five per second, or PNG for no compression.",
      },
      {
        title: "VLC's Scene filter",
        body: "In VLC's preferences, choose Show settings: All, then Video, Filters, Scene filter. Set the image format to jpg, a folder, and the recording ratio to the video's frame rate (25 for one picture per second at 25 fps). Tick Scene video filter under Video, Filters, play the video through, then untick it.",
      },
      {
        title: "One frame at a time",
        body: "Pause on the moment and use VLC's Video, Take Snapshot, or QuickTime's Edit, Copy on a Mac, which copies the paused frame at full size. Fine for one or two shots, not forty.",
      },
      {
        title: "Zoom in around the moment",
        body: "If the action is quick, first save one per second, find the right second, then extract every frame of just that stretch: `ffmpeg -ss 22 -t 4 -i video.mp4 -q:v 2 woodpecker_%03d.jpg`.",
      },
      {
        title: "Know the limit",
        body: "A video frame is only as sharp as the video. Fast movement is often blurred in a single frame, and phone video is compressed, so frames look softer than a photo taken at the same resolution.",
      },
    ],
    limits: [
      "One picture per second can miss a split-second moment. Ask for more per second around the part you care about.",
      "It didn't pick the best shot for you. It looked at one sample frame to check its work; it can look through them for the woodpecker if you ask, which sends those pictures to the AI model.",
      "File names, the video's details and that one sample frame went to the AI model you use in Stella; the frames were saved on your computer.",
      "Recorded on Linux with ffmpeg already installed. On a Mac or Windows PC Stella would usually download ffmpeg first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I get a high-quality still from a video?",
        a: "Extract the frame directly from the file at full resolution rather than taking a screenshot of the player. ffmpeg with `-q:v 1` or `-q:v 2`, or PNG output, keeps the most detail.",
      },
      {
        q: "How many frames does a video have?",
        a: "Its frame rate times its length: a 40-second video at 25 fps has 1,000. One per second is usually plenty to find a moment; then extract every frame near it.",
      },
      {
        q: "Can I turn the frames into a GIF instead?",
        a: "Yes: see [make a GIF from a video](/how/video/make-gif-from-video).",
      },
      {
        q: "Can it sort or rename the pictures afterwards?",
        a: "Yes, in the same chat. For photo collections, see [find duplicate photos](/how/photos-files/find-duplicate-photos) and [resize images in bulk](/how/photos-files/resize-images-in-bulk).",
      },
    ],
    related: ["video/make-gif-from-video", "photos-files/resize-images-in-bulk", "video/speed-up-video"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "FFmpeg filters: fps", href: "https://ffmpeg.org/ffmpeg-filters.html#fps" },
      { label: "VLC media player", href: "https://www.videolan.org/vlc/" },
    ],
  },
  {
    slug: "make-gif-from-video",
    niche: "video",
    searchPhrases: [
      "make a gif from a video",
      "video to gif",
      "make gif",
      "how to make a gif",
      "make gif under 5mb",
    ],
    title: "Make a GIF from a video clip, under a size limit",
    description:
      "Turn five seconds of a video into a smooth GIF small enough for a group chat: Shortcuts on Mac, Clipchamp on Windows, ffmpeg, or Stella (stella.sh) on your computer.",
    h1: "Make a GIF from a video clip",
    short: "Make a GIF from a video",
    lede: "Five exact seconds of a video as a smooth 478 KB GIF, ready for a group chat.",
    answer:
      "Trim the clip to the seconds you want, then convert it with a good colour palette. On a Mac, QuickTime trims and the Shortcuts app's Make GIF action converts; on Windows, Clipchamp exports clips up to 15 seconds as GIF. ffmpeg does both in one command. Stella (stella.sh) made a GIF of exactly 0:42 to 0:47 of a video at 720 pixels wide and 20 frames a second, at 478 KB.",
    stellaSteps: [
      "Finds “Park day” in Videos and checks its size and frame rate",
      "Makes a first GIF of 0:42 to 0:47 at 480 pixels wide, with a palette built from the clip so colours don't band",
      "Looks at frames from it and, since it's far under 5 MB, remakes it sharper: 720 pixels wide at 20 frames a second",
      "Checks a contact sheet of the frames, saves Park day - Biscuit catches the frisbee.gif next to the video and leaves the video unchanged",
      "Reports 478 KB, notes GIFs have no sound, and points out the catch lands at about 0:46.8, offering to run it to 0:48",
    ],
    prompt:
      "Make a GIF of the bit in 'Park day' in my Videos folder where Biscuit catches the frisbee, from 0:42 to 0:47. Keep it under 5 MB so I can send it in the family group chat.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "The GIF in about 1 minute 15 seconds. Checked afterwards against an answer key written before the run, using a time code drawn into the video: an animated GIF of exactly 0:42 to 0:47, 100 frames at 20 per second playing forwards, 720×405 (not squashed), 0.49 MB, and the video unchanged.",
      note: "The park video is a drawn animation made for this run, with a small time code in the corner for checking. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/video/make-gif-from-video/proof.mp4`,
        cuts: webCuts("video/make-gif-from-video"),
        poster: `${PROOFS}/video/make-gif-from-video/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 39.8,
        realDuration: 74,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A 75-second Park day video is in Videos." },
        { at: 1.63, text: "The prompt: a GIF of 0:42 to 0:47, under 5 MB for the family group chat." },
        { at: 9.63, text: "Stella replies it's cutting 0:42 to 0:47 into a GIF under 5 MB." },
        { at: 15.63, text: "Making the GIF, checking frames, and remaking it sharper." },
        { at: 25.7, text: "Done: a 478 KB GIF of exactly 0:42 to 0:47, with an offer to run it to 0:48 so the catch has a beat." },
      ],
    },
    manualTitle: "Make it yourself",
    manualSteps: [
      {
        title: "Mac: QuickTime, then Shortcuts",
        body: "Open the video in QuickTime Player, choose Edit, Trim, drag the yellow handles to 0:42 and 0:47 and save. In the Shortcuts app, make a shortcut with the Make GIF action fed by that video and a Save File action, then run it.",
      },
      {
        title: "Windows: Clipchamp",
        body: "In Clipchamp (built into Windows 11), add the video to the timeline, split it at 0:42 and 0:47 and delete the rest. Choose Export, then GIF. The clip must be 15 seconds or shorter.",
      },
      {
        title: "ffmpeg with a proper palette",
        body: "`ffmpeg -ss 42 -t 5 -i \"Park day.mp4\" -vf \"fps=15,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse\" out.gif` builds a palette from the clip itself, so colours look clean instead of blotchy.",
      },
      {
        title: "Get under the size limit",
        body: "Size grows with width, frame rate and length. To shrink a GIF, cut it shorter first, then lower the width (480 or 360 pixels), then the frame rate (12 to 15). Detailed, busy scenes make much bigger GIFs than simple ones.",
      },
      {
        title: "Consider a short MP4",
        body: "Most chat apps play short videos inline, often with better colour, sound and a smaller file than a GIF. Send a GIF when the app or the joke needs one.",
      },
    ],
    limits: [
      "GIFs have no sound and only 256 colours per frame, so gradients can band a little. A short MP4 often looks better where the chat app allows one.",
      "It cut the times you gave. If the moment lands at the very end, say so and it will extend the clip.",
      "File names, the video's details and a few frames from the GIF (to check it) went to the AI model you use in Stella; the GIF was made on your computer.",
      "Recorded on Linux with ffmpeg already installed. On a Mac or Windows PC Stella would usually download ffmpeg first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I make a GIF from a video on iPhone?",
        a: "In Photos, a Live Photo can be set to Loop or Bounce, which shares as a GIF-like animation. For a normal video, the Shortcuts app's Make GIF action works on the phone too.",
      },
      {
        q: "Why is my GIF so big?",
        a: "GIF compresses poorly. Long clips, full-HD width and high frame rates add up quickly. Keep it to a few seconds at 480 to 720 pixels wide.",
      },
      {
        q: "Why does my GIF look grainy or blotchy?",
        a: "The converter used a generic 256-colour palette. Building the palette from the clip itself (ffmpeg's palettegen) fixes most of it.",
      },
      {
        q: "Can it pull still pictures out instead?",
        a: "Yes: see [extract frames from a video](/how/video/extract-frames-from-video). To make a whole video smaller to send, see [compress a video for Discord](/how/video/compress-video-for-discord).",
      },
    ],
    related: ["video/extract-frames-from-video", "video/compress-video-for-discord", "video/speed-up-video"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Clipchamp: convert a video to a GIF", href: "https://clipchamp.com/en/blog/convert-video-gif/" },
      { label: "FFmpeg filters: palettegen", href: "https://ffmpeg.org/ffmpeg-filters.html#palettegen" },
    ],
  },
  {
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
      "Make a separate .srt subtitle file for a video without burning captions in or uploading it: Subtitle Edit with Whisper, or Stella (stella.sh) on your own computer.",
    h1: "Create an SRT subtitle file from a video",
    short: "Make an SRT subtitle file",
    lede: "A timed .srt file for a 73-second interview, separate from the video and checked.",
    answer:
      "Speech recognition can write the subtitles for you. On Windows, the free Subtitle Edit has Video, Audio to text (Whisper), then saves an .srt. Whisper-based apps do the same on a Mac. Caption sites and CapCut work too, but upload the video or burn the words in. Stella (stella.sh) made an .srt for an interview with a free Whisper model running on the computer, left the video untouched, and flagged two words to check.",
    stellaSteps: [
      "Finds the interview video in Videos and pulls its sound out for transcription",
      "Runs the free faster-whisper speech recognition on the computer, with the large Whisper model and word-level timings, so nothing is sent to a transcription service",
      "Tries smaller models on the guest's name, which is hard to hear, and settles on its best guess",
      "Builds subtitles of at most two short lines each, timed to the words, saves Interview with Dr Okonjo.srt next to the video, then re-listens to each subtitle's stretch of audio to check it",
      "Leaves the video unchanged and names the two spots to check before uploading: the guest's first name and one phrase",
    ],
    prompt:
      "Make an SRT subtitle file for the interview video in my Videos folder. Don't put the subtitles on the video. I just need the separate file to upload with it.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "The .srt in about 4 minutes 10 seconds, including downloading the speech models. Checked afterwards against an answer key written before the run: a valid SRT with 19 numbered subtitles, 1.2% of words wrong (20% allowed), all 14 spoken lines shown while they're said, nothing on screen over 7 seconds, lines of 47 characters or fewer, named like the video, and the video untouched.",
      note: "The interview was written for this run and voiced by two synthetic voices; the people and podcast are fictitious. The work is sped up 17×.",
      video: {
        src: `${PROOFS}/video/make-srt-subtitle-file/proof.mp4`,
        cuts: webCuts("video/make-srt-subtitle-file"),
        poster: `${PROOFS}/video/make-srt-subtitle-file/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 46.7,
        realDuration: 252,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A 73-second interview video is in Videos." },
        { at: 1.63, text: "The prompt: a separate SRT subtitle file, not subtitles on the video." },
        { at: 13.63, text: "Stella replies it will transcribe on this computer and save the .srt next to the video, which won't change." },
        { at: 19.63, text: "Downloading a speech model, transcribing and timing the subtitles." },
        { at: 32.1, text: "Done: the .srt next to the video, made for free on the computer, with two words to double-check." },
      ],
    },
    manualTitle: "Make the subtitles yourself",
    manualSteps: [
      {
        title: "Windows: Subtitle Edit",
        body: "Install the free Subtitle Edit and open the video. Choose Video, Audio to text (Whisper), pick a model (larger is more accurate but slower) and let it download. When it's done, check the text, then File, Save as, SubRip (.srt).",
      },
      {
        title: "Mac: a Whisper app",
        body: "macOS has no built-in subtitle maker. Free and paid apps built on OpenAI's open-source Whisper run on the Mac and export SRT; whisper.cpp does it from the Terminal with `-osrt`.",
      },
      {
        title: "Read it through",
        body: "Automatic transcripts get names, places and jargon wrong. Play the video with the subtitles on and fix anything odd; Subtitle Edit shows the waveform so you can nudge timings too.",
      },
      {
        title: "Keep lines short",
        body: "Aim for two lines of about 42 characters at most, on screen for 1 to 7 seconds each. Long blocks of text are hard to read and some platforms reject them.",
      },
      {
        title: "Name it like the video",
        body: "Save it as the video's name with .srt (Interview.mp4 and Interview.srt). Players like VLC load it automatically, and upload pages for YouTube or Vimeo take it as a separate caption file.",
      },
    ],
    limits: [
      "Names and rare words are best guesses. Stella flagged the guest's first name and one phrase to check; read the file before uploading.",
      "Speaker labels aren't added. Ask if you want them.",
      "The speech models are big: about 5 GB downloaded, since Stella tried three sizes on the hard-to-hear name, and transcription on a processor is slow for long videos. The sound stayed on the computer; the transcript text went to the AI model you use in Stella to build and check the subtitles.",
      "Recorded on Linux. On a Mac or Windows PC Stella would set up the same free speech tool, which wasn't recorded.",
    ],
    costNote:
      "Yes. The recording was on Stella's free plan, so the speech recognition ran on the computer with a free model and nothing was paid; it's just slower than a hosted service.",
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I make an SRT file for free?",
        a: "Use Subtitle Edit with Whisper on Windows, a Whisper app on a Mac, or type one by hand in a text editor for a short clip. Stella made one with a free local model.",
      },
      {
        q: "Will it put the subtitles on my video?",
        a: "No, not unless you ask. The .srt is a separate text file and the video stayed byte-for-byte the same. To burn captions into the picture, see [burn subtitles into a video](/how/video/burn-subtitles-into-video-for-tiktok).",
      },
      {
        q: "How accurate is it?",
        a: "On this clear interview, 1.2% of words were wrong. Expect more errors with background noise, crosstalk or strong accents.",
      },
      {
        q: "My site needs .vtt, not .srt. What now?",
        a: "See [convert SRT to VTT](/how/video/convert-srt-to-vtt). For text you can read instead of captions, see [transcribe voice memos to text](/how/audio/transcribe-voice-memos-to-text).",
      },
    ],
    related: ["video/convert-srt-to-vtt", "video/burn-subtitles-into-video-for-tiktok", "audio/transcribe-voice-memos-to-text"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "OpenAI Whisper on GitHub", href: "https://github.com/openai/whisper" },
      { label: "faster-whisper on GitHub", href: "https://github.com/SYSTRAN/faster-whisper" },
      { label: "Subtitle Edit", href: "https://www.nikse.dk/subtitleedit" },
    ],
  },
  {
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
      "Fix a phone video that plays sideways and save it upright for every app: QuickTime on Mac, Clipchamp on Windows, ffmpeg, or Stella (stella.sh) on your computer.",
    h1: "Rotate a video that plays sideways",
    short: "Rotate a video",
    lede: "A sideways school-play video saved upright, sound and quality kept.",
    answer:
      "On a Mac, QuickTime Player's Edit, Rotate Left (or Right) then File, Save fixes it. On Windows, Clipchamp's rotate button turns the clip before you export. The common mistake is turning it the wrong way, or only changing a rotation flag some players ignore. Stella (stella.sh) looked at frames to work out which way the scene was turned, rotated the picture itself a quarter turn left, and checked the result.",
    stellaSteps: [
      "Finds “School play” in Videos and finds no rotation flag: the picture itself is sideways",
      "Looks at two frames from the video to see which way the stage and children are turned",
      "Rotates the picture a quarter turn to the left (anticlockwise), re-saving at a very high quality setting and copying the sound unchanged",
      "Looks at a frame of the new copy to confirm the children are standing upright on the stage",
      "Saves School play (upright).mp4 next to the original and leaves the original unchanged",
    ],
    prompt:
      "I filmed my daughter's school play with my phone on its side, and now the video in my Videos folder plays sideways. Turn it the right way up.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "The upright copy in about 1 minute. Checked afterwards against an answer key written before the run: a portrait 720×1280 video, right way up and not mirrored (matched against the upright scene), the same 20 seconds, sound kept, the picture really turned rather than just flagged, and the original unchanged.",
      note: "The school play is a drawn scene made for this run, with lopsided props so a wrong turn or mirror image would show. The work is sped up 2×.",
      video: {
        src: `${PROOFS}/video/rotate-video/proof.mp4`,
        cuts: webCuts("video/rotate-video"),
        poster: `${PROOFS}/video/rotate-video/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 40.73,
        realDuration: 63,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A sideways school-play video is in Videos." },
        { at: 1.63, text: "The prompt: turn it the right way up." },
        { at: 9.63, text: "Stella replies it will look at the frames to decide which way to turn it, and keep the original." },
        { at: 15.63, text: "Checking frames, rotating and checking the result." },
        { at: 25.93, text: "Done: a quarter turn left; the children stand upright in the new copy, sound unchanged." },
      ],
    },
    manualTitle: "Rotate it yourself",
    manualSteps: [
      {
        title: "Mac: QuickTime Player",
        body: "Open the video, choose Edit, Rotate Left or Rotate Right until it's upright, then File, Save (or Export As to keep the original). On iPhone, the Photos app's Edit, Crop tool has a rotate button too.",
      },
      {
        title: "Windows: Clipchamp",
        body: "In Clipchamp, add the video to the timeline, select it and press the rotate button on the floating toolbar until it's upright, then Export. The Photos app's video editor on older Windows versions has a similar Rotate button.",
      },
      {
        title: "ffmpeg",
        body: "`ffmpeg -i \"School play.mp4\" -vf transpose=2 -c:a copy \"School play (upright).mp4\"` turns it 90° anticlockwise; `transpose=1` turns it clockwise. Two transposes, or `-vf hflip,vflip`, turn it upside down.",
      },
      {
        title: "Work out the direction first",
        body: "Look at where the floor is. If the floor is on the right of the frame, turn it clockwise; on the left, anticlockwise. Upside down needs a half turn, and writing that reads backwards means the clip is mirrored, which needs a flip, not a rotation.",
      },
      {
        title: "VLC only rotates while playing",
        body: "VLC's Tools, Effects and Filters, Geometry, Transform rotates the picture during playback, but doesn't change the file unless you also run it through Convert / Save with that filter on.",
      },
    ],
    limits: [
      "Rotating doesn't add picture. A portrait video shows with black bars on a landscape TV.",
      "Turning the picture means re-encoding it. Stella used a very high quality setting, so it looks the same, but the file is a fresh copy.",
      "To decide which way to turn it, Stella looked at frames from the video, so those few pictures went to the AI model you use in Stella. The video itself was rotated on your computer.",
      "Recorded on Linux with ffmpeg already installed. On a Mac or Windows PC Stella would usually download ffmpeg first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why does my video play sideways on one app but not another?",
        a: "Phones often save the picture sideways with a flag telling players to turn it. Some apps read the flag and some ignore it. Turning the picture itself, as Stella did, makes it upright everywhere.",
      },
      {
        q: "Does rotating a video lose quality?",
        a: "Changing only the flag doesn't, but not every player respects it. Rotating the picture means re-encoding; at a high-quality setting the difference is invisible.",
      },
      {
        q: "Can I make a portrait video fill a landscape screen?",
        a: "Only by cropping it or adding blurred edges. Ask Stella for a 16:9 version with blurred sides if you need one.",
      },
      {
        q: "My phone videos won't play on the TV at all. Is that the same problem?",
        a: "Usually not; it's the video format. See [convert MOV to MP4](/how/video/convert-mov-to-mp4).",
      },
    ],
    related: ["video/convert-mov-to-mp4", "video/speed-up-video", "video/combine-videos-into-one", "video/crop-video-to-vertical"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Rotate or flip a clip in QuickTime Player on Mac", href: "https://support.apple.com/guide/quicktime-player/qtp5a6251741/mac" },
      { label: "Microsoft: How to rotate videos in Clipchamp", href: "https://support.microsoft.com/en-gb/topic/how-to-rotate-videos-images-and-other-visual-elements-in-clipchamp-4043e70f-7fd0-4371-885f-c95639b8ddbf" },
      { label: "FFmpeg filters: transpose", href: "https://ffmpeg.org/ffmpeg-filters.html#transpose-1" },
    ],
  },
  {
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
      "Make a video twice as fast for Instagram while your voice keeps its normal pitch: iMovie, Clipchamp, ffmpeg, or Stella (stella.sh) on your own computer.",
    h1: "Speed up a video without the chipmunk voice",
    short: "Speed up a video",
    lede: "A 68-second video at 2× in 34 seconds, the voice fast but at its normal pitch.",
    answer:
      "Use a speed control that preserves pitch. iMovie on a Mac keeps the pitch by default (Preserve pitch is ticked), and Clipchamp's speed setting does the same on Windows. Tools that simply play the sound faster raise it into a chipmunk voice. Stella (stella.sh) made a 2× copy of a cake-decorating video with the voice at its normal pitch and the sound in step with the picture.",
    stellaSteps: [
      "Finds “Cake decorating” in Videos: 68 seconds, landscape, with a spoken voice-over",
      "Doubles the speed of the picture and speeds up the sound with a tempo change that keeps the pitch, at a smooth 30 frames a second",
      "Saves Cake decorating (2x for Instagram).mp4 next to the original, ready to post",
      "Compares the voice's pitch before and after, and looks at a frame from the new copy",
      "Reports it's 34 seconds, half of 68, leaves the original unchanged, and points out a landscape video will have bars in an Instagram Reel, offering a vertical version",
    ],
    prompt:
      "Make my cake decorating video in Videos twice as fast for Instagram, but keep my voice sounding normal, not like a chipmunk.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "The 2× copy in about 1 minute 15 seconds. Checked afterwards against an answer key written before the run, using a time code drawn into the video: 34.0 seconds (half of 68), the picture at 2× all the way through, the voice at its normal pitch (208 Hz against 205 Hz), the sound in step with the picture, 30 frames a second, and the original unchanged.",
      note: "The cake video is a drawn animation made for this run with a synthetic voice-over and a time code in the corner. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/video/speed-up-video/proof.mp4`,
        cuts: webCuts("video/speed-up-video"),
        poster: `${PROOFS}/video/speed-up-video/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 42.07,
        realDuration: 74,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A 68-second cake-decorating video with a voice-over is in Videos." },
        { at: 1.63, text: "The prompt: twice as fast for Instagram, with the voice sounding normal." },
        { at: 10.63, text: "Stella replies it's making a 2× copy with the voice at its normal pitch, keeping the original." },
        { at: 16.63, text: "Speeding up the video and comparing the voice's pitch." },
        { at: 27.9, text: "Done: 34 seconds, voice at the same pitch, with an offer of a vertical version for Reels." },
      ],
    },
    manualTitle: "Speed it up yourself",
    manualSteps: [
      {
        title: "Mac: iMovie",
        body: "Add the clip to an iMovie project, select it and click the speedometer button above the viewer. Choose Fast, 2×, and keep Preserve pitch ticked. Then Share, File to export.",
      },
      {
        title: "Windows: Clipchamp",
        body: "Add the clip to the timeline, select it, open Speed in the property panel on the right and set it to 2×. Clipchamp keeps the voice's pitch. Then Export.",
      },
      {
        title: "On the phone",
        body: "Instagram's and TikTok's editors have a speed setting, and CapCut has Speed with a pitch option. Check the voice after: some apps raise the pitch unless you turn that off.",
      },
      {
        title: "ffmpeg",
        body: "`ffmpeg -i in.mp4 -filter_complex \"[0:v]setpts=0.5*PTS[v];[0:a]atempo=2.0[a]\" -map \"[v]\" -map \"[a]\" out.mp4` doubles the speed of both, keeping the voice's pitch. For 4×, chain `atempo=2.0,atempo=2.0`.",
      },
      {
        title: "Fit the platform",
        body: "Reels and TikTok are vertical (9:16). A landscape video will show with bars or be cropped; reframe it to vertical in the editor, and add captions, since fast speech is easier to follow with them.",
      },
    ],
    limits: [
      "At 2× speech is fast but clear. Above about 3× it gets hard to follow, whichever tool you use.",
      "It doesn't post to Instagram or reframe to vertical unless you ask; Stella offered both.",
      "File names, the video's details and one frame from the new copy went to the AI model you use in Stella; the video was processed on your computer.",
      "Recorded on Linux with ffmpeg already installed. On a Mac or Windows PC Stella would usually download ffmpeg first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why does my voice sound like a chipmunk when I speed up a video?",
        a: "The tool plays the sound faster without correcting the pitch, which raises it. Use a speed setting that preserves pitch, as iMovie and Clipchamp do.",
      },
      {
        q: "Can I speed up only part of a video?",
        a: "Yes. In iMovie or Clipchamp, split the clip and change the speed of one piece. Ask Stella for a time range and it will speed up only that stretch.",
      },
      {
        q: "Can I slow a song down the same way?",
        a: "Yes: see [slow down a song without changing pitch](/how/audio/slow-down-song-without-changing-pitch).",
      },
      {
        q: "What else helps a video for Instagram?",
        a: "Captions and a vertical frame. See [burn subtitles into a video for TikTok](/how/video/burn-subtitles-into-video-for-tiktok) and [cut silences from a video](/how/video/cut-silences-from-video).",
      },
    ],
    related: ["video/cut-silences-from-video", "video/burn-subtitles-into-video-for-tiktok", "audio/slow-down-song-without-changing-pitch", "video/reverse-video"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Slow down and speed up clips in iMovie on Mac", href: "https://support.apple.com/guide/imovie/mov6c442b2eb/mac" },
      { label: "Clipchamp: speed up and slow down videos", href: "https://clipchamp.com/en/blog/speed-up-slow-down-video/" },
      { label: "FFmpeg filters: atempo", href: "https://ffmpeg.org/ffmpeg-filters.html#atempo" },
    ],
  },
  {
    slug: "convert-avi-to-mp4",
    niche: "video",
    searchPhrases: [
      "convert avi to mp4",
      "wmv to mp4",
      "3gp to mp4",
      "vob to mp4",
      "convert old videos to mp4",
    ],
    title: "Convert AVI, WMV, 3GP and VOB videos to MP4 (no squashing)",
    description:
      "Turn old camera and phone clips (AVI, WMV, 3GP, VOB) into MP4s that play on any phone or TV, without squashing the picture: HandBrake, VLC, ffmpeg or Stella (stella.sh).",
    h1: "Convert old AVI, WMV, 3GP and VOB videos to MP4",
    short: "Convert AVI, WMV, 3GP, VOB to MP4",
    lede: "Five old family clips in four formats, now MP4s that play on a phone and a TV.",
    answer:
      "Re-encode each clip to H.264 video with AAC sound in an MP4: the free HandBrake does it on Mac and Windows with its Fast 1080p30 preset, and VLC's Convert / Save works for one file at a time. The catch with old footage is shape: DV camcorder and DVD clips use stretched pixels, so a careless conversion squashes or stretches people. Stella (stella.sh) converted five clips in four formats and fixed the shape of the two that needed it.",
    stellaSteps: [
      "Finds the five clips in “Old family videos”: two AVIs, a WMV, a 3GP from an old phone and a VOB from a DVD",
      "Reads each clip's codec, size, frame rate and pixel shape, and checks for interlacing",
      "Grabs a frame from each and lays them side by side to see how they should look",
      "Converts every clip to H.264 with AAC sound, turning the DV camcorder clip and the widescreen DVD clip into square pixels so nothing is squashed",
      "Saves the MP4s in a new MP4 folder inside the original one, copies each file's date across, and checks every new file plays to the end with sound",
    ],
    prompt:
      "My Old family videos folder in Videos has clips in AVI, WMV, 3GP and VOB from old cameras and phones. Convert them all to MP4 so they play on my phone and TV.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Five MP4s in under a minute. Checked afterwards against an answer key written before the run: an MP4 for every clip, H.264 with AAC sound, the DV clip 4:3 and the DVD clip 16:9 widescreen with nothing squashed, full length, the same picture at the same moment, sound kept, and the originals unchanged.",
      note: "The five clips were made for this run in the formats old cameras and phones wrote: Motion JPEG and DV AVIs, WMV with WMA sound, a 3GP with AMR sound and a DVD VOB with AC-3 sound. A time code in each picture let the check compare moments. The work is sped up 4×. We didn't play the files on a real phone or TV.",
      video: {
        src: `${PROOFS}/video/convert-avi-to-mp4/proof.mp4`,
        cuts: webCuts("video/convert-avi-to-mp4"),
        poster: `${PROOFS}/video/convert-avi-to-mp4/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 42.77,
        realDuration: 84,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Old family clips in AVI, WMV, 3GP and VOB are in Videos." },
        { at: 1.63, text: "The prompt: convert them all to MP4 for a phone and TV." },
        { at: 11.23, text: "Stella replies it's converting them and keeping the originals." },
        { at: 17.23, text: "Checking each clip's shape and converting." },
        { at: 28.33, text: "Done: five MP4s, two clips fixed so they no longer look squashed, dates kept." },
      ],
    },
    manualTitle: "Convert them yourself",
    manualSteps: [
      {
        title: "Mac or Windows: HandBrake",
        body: "Open the free HandBrake, drag in a clip and pick the Fast 1080p30 preset (H.264 and AAC in an MP4). On the Dimensions tab leave Anamorphic on Automatic so DV and DVD clips keep their real shape, then Start. Add the others to the queue.",
      },
      {
        title: "One file: VLC",
        body: "In VLC choose Media, Convert / Save, add the file, click Convert / Save and pick the Video - H.264 + MP3 (MP4) profile. Play the result and check that the DVD clip is still widescreen.",
      },
      {
        title: "ffmpeg",
        body: "`ffmpeg -i \"Camping trip 2006.avi\" -vf \"scale=trunc(iw*sar/2)*2:ih,setsar=1\" -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac \"Camping trip 2006.mp4\"` converts one clip and turns stretched pixels into square ones. Loop it over the folder for the rest.",
      },
      {
        title: "Check the shape",
        body: "Look at a face or a round object in each new file. DVD clips are usually 16:9 even though the file says 720×480, and DV camcorder clips are 4:3 at 720×576. Forcing everything to 640×480 squashes the widescreen ones.",
      },
      {
        title: "Keep the originals",
        body: "Store the AVI, WMV, 3GP and VOB files somewhere safe after converting. Converting is lossy, and the originals are what you'd go back to if a better tool or setting comes along.",
      },
    ],
    limits: [
      "Converting doesn't add detail. A 2009 phone clip at 352×288 still looks soft on a big TV, and low frame rates still look choppy; Stella pointed both out.",
      "Copy-protected DVDs aren't covered. This is for VOB files you already have on your computer.",
      "File names and the clips' technical details, plus one frame from each clip, went to the AI model you use in Stella. The videos were converted on your computer.",
      "Recorded on Linux with ffmpeg already installed. On a Mac or Windows PC Stella would usually download ffmpeg first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why does my converted DVD video look squashed?",
        a: "DVD video is stored at 720×480 and stretched to 16:9 when played. A converter that ignores that flag, or forces 4:3, squeezes everyone thin. Keep the shape (HandBrake's Automatic anamorphic) or scale to square pixels as Stella did.",
      },
      {
        q: "Can I convert a whole folder at once?",
        a: "Yes. HandBrake has a queue, and Stella converted all five clips in one go into a separate MP4 folder.",
      },
      {
        q: "Will my converted videos be in the right order on my phone?",
        a: "Phones sort by date. Stella copied each original's date onto its MP4 so they land in the right place in the gallery.",
      },
      {
        q: "What about MOV or MKV files?",
        a: "See [convert MOV to MP4](/how/video/convert-mov-to-mp4) and [convert MKV to MP4](/how/video/convert-mkv-to-mp4).",
      },
    ],
    related: ["video/convert-mov-to-mp4", "video/convert-mkv-to-mp4", "video/convert-webm-to-mp4"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "HandBrake documentation", href: "https://handbrake.fr/docs/en/latest/" },
      { label: "VLC media player", href: "https://www.videolan.org/vlc/" },
      { label: "FFmpeg filters: scale and setsar", href: "https://ffmpeg.org/ffmpeg-filters.html#scale-1" },
    ],
  },
  {
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
      "WebM won't play on your iPhone? Re-encode it to H.264 MP4 (renaming isn't enough) with HandBrake, VLC, ffmpeg, or let Stella (stella.sh) convert them all.",
    h1: "Convert WebM to MP4 that plays on an iPhone",
    short: "Convert WebM to MP4",
    lede: "Four WebM downloads, one with an odd size and no length, turned into iPhone MP4s.",
    answer:
      "Re-encode it: WebM holds VP8, VP9 or AV1 video with Opus or Vorbis sound, and an iPhone wants H.264 or HEVC with AAC. Renaming the file or copying the streams into an .mp4 box doesn't help. The free HandBrake on Mac or Windows does it with its Fast 1080p30 preset. Stella (stella.sh) converted four WebMs, including a browser screen recording with an odd height and no length in its header.",
    stellaSteps: [
      "Finds the four WebM files in Downloads and reads their codecs: VP8, VP9 and AV1 video with Vorbis or Opus sound",
      "Notices the screen recording is 767 pixels tall (H.264 needs an even number) and has no length in its header",
      "Decodes every source to the end to make sure none is damaged, and counts its frames",
      "Re-encodes each to H.264 with AAC sound, set to start playing straight away, rounding the odd height to 766",
      "Checks each MP4 has every frame of its original and saves it next to the WebM with the same name, keeping the WebMs",
    ],
    prompt: "I have some WebM videos in my Downloads that won't play on my iPhone. Can you turn them into MP4s that will?",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Four MP4s in under a minute. Checked afterwards against an answer key written before the run: an MP4 for each WebM, H.264 with AAC inside (not VP9 or Opus renamed), the same picture size, full length including the screen recording with no length in its header, the same picture at the same moment, sound kept, set to start playing straight away, and the WebMs and an unrelated PDF untouched.",
      note: "The four WebMs were made for this run as browsers and sites write them: VP9 with Opus, VP8 with Vorbis and AV1 with Opus, with a time code in each picture. The work is sped up 3×. We didn't play them on a real iPhone; the check confirmed the format iPhones play.",
      video: {
        src: `${PROOFS}/video/convert-webm-to-mp4/proof.mp4`,
        cuts: webCuts("video/convert-webm-to-mp4"),
        poster: `${PROOFS}/video/convert-webm-to-mp4/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 40.57,
        realDuration: 78,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Four WebM videos are in Downloads." },
        { at: 1.63, text: "The prompt: turn them into MP4s that play on an iPhone." },
        { at: 9.63, text: "Stella replies it's converting them next to the originals and keeping the WebMs." },
        { at: 15.63, text: "Checking each file and converting to H.264 with AAC sound." },
        { at: 26.17, text: "Done: four MP4s, every frame there; the screen recording is one pixel shorter." },
      ],
    },
    manualTitle: "Convert it yourself",
    manualSteps: [
      {
        title: "Mac or Windows: HandBrake",
        body: "Open the free HandBrake, drag in the WebM and pick the Fast 1080p30 preset, which makes H.264 video with AAC sound in an MP4. Click Start, or Add to Queue for several files and then Start Queue.",
      },
      {
        title: "VLC",
        body: "Choose Media, Convert / Save, add the WebM, click Convert / Save and pick the Video - H.264 + MP3 (MP4) profile. One file at a time, but it works offline.",
      },
      {
        title: "ffmpeg",
        body: "`ffmpeg -i clip.webm -vf \"scale=trunc(iw/2)*2:trunc(ih/2)*2\" -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart clip.mp4`. The scale part rounds odd sizes to even ones, which H.264 needs.",
      },
      {
        title: "Don't just rename it",
        body: "Renaming .webm to .mp4, or copying the streams with `-c copy`, leaves VP9 or AV1 video and Opus sound inside. Some players cope, but iPhones and many editors won't. The video has to be re-encoded.",
      },
      {
        title: "Screen recordings from a browser",
        body: "Browser recorders often write WebMs with no length in the header, so players show 0:00 or can't seek. A full re-encode fixes that, because the new file gets a proper length.",
      },
    ],
    limits: [
      "Re-encoding takes time and is slightly lossy. Stella used a high-quality setting, which is invisible on short clips; long films take minutes each.",
      "A WebM with transparency loses it in MP4, which has no see-through video.",
      "File names and the videos' technical details went to the AI model you use in Stella. The videos were converted on your computer.",
      "Recorded on Linux with ffmpeg already installed. On a Mac or Windows PC Stella would usually download ffmpeg first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why won't WebM play on my iPhone?",
        a: "Newer iPhones play some WebM in Safari, but not in Photos, Files or Messages, and VP8 or AV1 can fail. An H.264 MP4 plays everywhere.",
      },
      {
        q: "Is there a size limit?",
        a: "Not on your own computer. Online converters cap file size; HandBrake, VLC, ffmpeg and Stella don't.",
      },
      {
        q: "Can I convert to a GIF instead?",
        a: "Yes, see [make a GIF from a video](/how/video/make-gif-from-video).",
      },
      {
        q: "What about old AVI or WMV clips?",
        a: "Same idea, different traps. See [convert AVI, WMV, 3GP and VOB to MP4](/how/video/convert-avi-to-mp4).",
      },
    ],
    related: ["video/convert-avi-to-mp4", "video/convert-mov-to-mp4", "video/make-gif-from-video"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "HandBrake documentation", href: "https://handbrake.fr/docs/en/latest/" },
      { label: "VLC media player", href: "https://www.videolan.org/vlc/" },
      { label: "FFmpeg H.264 encoding guide", href: "https://trac.ffmpeg.org/wiki/Encode/H.264" },
    ],
  },
  {
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
      "Turn a landscape video into a 9:16 vertical one for Reels, TikTok or Shorts that fills the screen and keeps you in shot: Clipchamp, Shotcut, ffmpeg or Stella (stella.sh).",
    h1: "Convert a horizontal video to vertical, keeping you in shot",
    short: "Crop a video to vertical 9:16",
    lede: "A landscape pancake tutorial cropped to a full-screen 9:16 Reel, cook and pan in shot.",
    answer:
      "Crop a 9:16 slice out of the landscape picture and scale it up, placing the slice where the person is, not in the middle. Clipchamp on Windows does it with the 9:16 ratio, Fill and a drag; on a Mac the free Shotcut has a vertical mode. Stella (stella.sh) tracked where the cook and pan were in every frame of a pancake tutorial, chose a crop that keeps both in for all 21 seconds, and made a 1080×1920 Reel.",
    stellaSteps: [
      "Finds “Pancake tutorial” in Videos: 21 seconds, 1280×720, with speech",
      "Makes a sheet of frames from across the video to see the kitchen: the cook and pan stand right of centre",
      "Measures where the cook and pan are in all 525 frames, and finds they barely move, so one fixed crop fits",
      "Crops a 9:16 slice around them with room on each side, nudging it to leave out an on-screen strip at the top left",
      "Scales it to 1080×1920, keeps the sound, saves it next to the original, and checks frames from across the new video",
    ],
    prompt:
      "Turn my pancake tutorial in my Videos into a vertical 9:16 video for Reels. Fill the whole screen, no black bars, and keep me and the pan in the shot.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "The Reel in about 4½ minutes, most of it spent measuring every frame. Checked afterwards against an answer key written before the run: 1080×1920 (9:16), every sampled frame a true crop of the original with no bars, squashing or blurred fill, the cook and pan inside the frame all the way through (a centre crop would cut them off), the same 21 seconds, sound kept, and the original unchanged.",
      note: "The pancake tutorial is a drawn scene with a synthetic voice, made for this run, with the cook placed off-centre so a lazy centre crop would fail. The long frame-by-frame measuring is sped up as much as 22×.",
      video: {
        src: `${PROOFS}/video/crop-video-to-vertical/proof.mp4`,
        cuts: webCuts("video/crop-video-to-vertical"),
        poster: `${PROOFS}/video/crop-video-to-vertical/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 44,
        realDuration: 304,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A landscape pancake tutorial is in Videos." },
        { at: 1.63, text: "The prompt: a full-screen 9:16 Reel that keeps the cook and pan in shot." },
        { at: 11.23, text: "Stella replies it's checking the whole video so the crop follows them, not just the middle." },
        { at: 17.23, text: "Measuring where the cook and pan are in every frame (sped up)." },
        { at: 29.63, text: "Done: 1080×1920, no bars, both in shot; the kitchen's left side is cut and the picture is a little softer." },
      ],
    },
    manualTitle: "Make it vertical yourself",
    manualSteps: [
      {
        title: "Windows: Clipchamp",
        body: "Add the video to the timeline, click the 16:9 button by the preview and choose 9:16. Select the clip, choose Fill in the floating toolbar, then drag the picture sideways in the preview until you and the subject are in frame. Scrub through to check, then Export.",
      },
      {
        title: "Mac: Shotcut",
        body: "iMovie can't make 9:16 projects. In the free Shotcut, set Settings, Video Mode to Vertical HD 30 fps, add the video to the timeline, then use the Size, Position & Rotate filter to fill the frame and slide the picture until the subject is in shot. Export as H.264.",
      },
      {
        title: "On the phone",
        body: "CapCut and Instagram's own editor have a 9:16 canvas: pinch the video to fill it and drag it into place. Check the whole clip, because a subject who walks out of the slice disappears.",
      },
      {
        title: "ffmpeg",
        body: "For a 1280×720 video, `ffmpeg -i in.mp4 -vf \"crop=405:720:722:0,scale=1080:1920\" -c:a copy out.mp4` takes a 405-pixel-wide slice starting 722 pixels from the left. Change that number to where your subject is; find it by pausing on a frame.",
      },
      {
        title: "Pick the slice by watching",
        body: "A vertical crop keeps only about a third of a landscape frame. Watch the whole video first and note how far left and right the subject goes; if it's wider than the slice, split the clip and frame each part separately.",
      },
    ],
    limits: [
      "A vertical slice keeps about a third of the width, so the rest of the scene is lost. Here the shelf and window on the left went.",
      "The slice is enlarged to fill a phone screen, so a 720p source looks a little softer than video filmed upright. Stella said so.",
      "Stella used one fixed crop because the cook barely moved. For someone walking around the room the crop would need to follow them, which this run didn't test.",
      "Frames from the video went to the AI model you use in Stella so it could see the scene. The video was cropped on your computer.",
      "Recorded on Linux with ffmpeg already installed. On a Mac or Windows PC Stella would usually download ffmpeg first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I make a horizontal video vertical without black bars?",
        a: "Crop it instead of shrinking it: take a 9:16 slice of the picture and scale it up to 1080×1920. Shrinking the whole frame to fit is what leaves bars.",
      },
      {
        q: "Why not just crop the middle?",
        a: "If the person isn't in the middle, a centre crop cuts them off. In this run the cook stood right of centre, so Stella measured where they were first.",
      },
      {
        q: "What size should a Reel or TikTok be?",
        a: "1080×1920 pixels (9:16). Stella made exactly that.",
      },
      {
        q: "Can I add captions too?",
        a: "Yes, see [burn subtitles into a video for TikTok](/how/video/burn-subtitles-into-video-for-tiktok).",
      },
    ],
    related: ["video/burn-subtitles-into-video-for-tiktok", "video/rotate-video", "video/speed-up-video"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Microsoft: How to change the aspect ratio of a video (Clipchamp)", href: "https://support.microsoft.com/en-us/clipchamp/how-to-change-the-aspect-ratio-of-a-video" },
      { label: "Shotcut (free video editor)", href: "https://shotcut.org/" },
      { label: "FFmpeg filters: crop", href: "https://ffmpeg.org/ffmpeg-filters.html#crop" },
    ],
  },
  {
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
      "Remove a section from the middle of a video and keep the rest as one clip, cut at the exact second, sound in sync: QuickTime, Clipchamp, ffmpeg or Stella (stella.sh).",
    h1: "Cut out part of a video and keep the rest",
    short: "Cut out part of a video",
    lede: "35 seconds of grass cut from a football final, the rest joined into one video.",
    answer:
      "Split the clip at the start and end of the bad part, delete the middle piece and save. QuickTime Player's Split Clip does it on a Mac and Clipchamp's split does it on Windows. Fast “lossless” cutters can snap to the nearest keyframe, seconds off, or leave the sound out of step after the join. Stella (stella.sh) cut 1:10 to 1:45 out of a football final at the exact second and joined the rest with the sound in sync.",
    stellaSteps: [
      "Finds “Under-9s cup final” in Videos: 3 minutes, with keyframes only every 10 seconds",
      "Looks at frames either side of 1:10 and 1:45 to confirm that's where the camera points at the grass",
      "Cuts out 1:10 to 1:45 and joins the two halves, re-encoding at a very high quality so the cut lands on the exact frame, not the nearest keyframe",
      "Checks frames at the join and the new length: 2:25, down from 3:00",
      "Saves it as a new file next to the original and suggests a quick listen at the join",
    ],
    prompt:
      "In the video of my son's football final in my Videos folder, the camera was pointing at the grass from 1:10 to 1:45. Cut that part out and keep the rest as one video.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "The edited video in about 40 seconds. Checked afterwards against an answer key written before the run, using a time code drawn on every frame: 2:25 long (3:00 minus 35 seconds), not one frame from 1:10–1:45 left, everything else kept in order and cut at the exact second, the sound in step with the picture before and after the join, and the original unchanged.",
      note: "The football final is a drawn match with crowd and whistle sounds, made for this run with keyframes 10 seconds apart so a quick keyframe cut would land at 1:40 instead of 1:45. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/video/cut-out-part-of-video/proof.mp4`,
        cuts: webCuts("video/cut-out-part-of-video"),
        poster: `${PROOFS}/video/cut-out-part-of-video/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 38.7,
        realDuration: 74,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A 3-minute football final is in Videos." },
        { at: 1.63, text: "The prompt: cut out 1:10 to 1:45 and keep the rest as one video." },
        { at: 8.83, text: "Stella replies it's cutting that part and saving a new file, keeping the original." },
        { at: 14.83, text: "Checking frames at the cut points and joining the two halves." },
        { at: 24.3, text: "Done: 2:25 long, a plain cut from 1:09 into the action, picture and sound in step." },
      ],
    },
    manualTitle: "Cut it yourself",
    manualSteps: [
      {
        title: "Mac: QuickTime Player",
        body: "Open the video, choose View, Show Clips, move the playhead to 1:10 and choose Edit, Split Clip. Do the same at 1:45. Click the middle clip, press Delete, then File, Save (or Export As) to write the joined video.",
      },
      {
        title: "Windows: Clipchamp",
        body: "Drag the video onto the timeline, move the playhead to 1:10 and press S to split, then again at 1:45. Select the middle piece, press Delete, close the gap if one is left, and Export.",
      },
      {
        title: "ffmpeg, frame-exact",
        body: "`ffmpeg -i in.mp4 -filter_complex \"[0:v]trim=0:70,setpts=PTS-STARTPTS[v0];[0:a]atrim=0:70,asetpts=PTS-STARTPTS[a0];[0:v]trim=start=105,setpts=PTS-STARTPTS[v1];[0:a]atrim=start=105,asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]\" -map \"[v]\" -map \"[a]\" -crf 18 out.mp4`. Times are in seconds.",
      },
      {
        title: "Why quick cuts land in the wrong place",
        body: "Tools that cut without re-encoding (LosslessCut, `-c copy`) can only start a piece on a keyframe. If keyframes are 10 seconds apart, a cut at 1:45 starts at 1:40 instead. Fine for rough trims; re-encode when the second matters.",
      },
      {
        title: "Check the join",
        body: "Play a few seconds either side of the cut. The sound should match the picture, and nothing from the removed part should flash up.",
      },
    ],
    limits: [
      "An exact cut means re-encoding the video. Stella used a very high quality setting, so it looks the same, but the file is a fresh copy.",
      "Checked by measurement, not by ear. Stella said nobody had listened to the join and suggested checking it.",
      "File names, the video's details and a few frames around the cut went to the AI model you use in Stella. The video was cut on your computer.",
      "Recorded on Linux with ffmpeg already installed. On a Mac or Windows PC Stella would usually download ffmpeg first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I cut out the middle of a video?",
        a: "Split it at the start and end of the part you don't want, delete the middle piece and save. Every editor works this way; Stella does it from the times you give.",
      },
      {
        q: "Why is my sound out of sync after cutting?",
        a: "Usually a no-re-encode cut joined two pieces that don't start on clean boundaries, so the sound drifts. Re-encoding the join, as Stella did, keeps it in step.",
      },
      {
        q: "Can I cut out several parts at once?",
        a: "Yes. Give Stella all the time ranges; it removes each and joins what's left.",
      },
      {
        q: "What about cutting out pauses in a talk?",
        a: "That's a different job: see [cut silences from a video](/how/video/cut-silences-from-video).",
      },
    ],
    related: ["video/cut-silences-from-video", "video/combine-videos-into-one", "video/speed-up-video"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Apple: Split a movie into clips in QuickTime Player on Mac", href: "https://support.apple.com/guide/quicktime-player/qtpa2d90df3d/mac" },
      { label: "Microsoft: How to split or cut videos and audio assets (Clipchamp)", href: "https://support.microsoft.com/en-us/clipchamp/how-to-split-or-cut-videos-and-audio-assets" },
      { label: "FFmpeg filters: trim and concat", href: "https://ffmpeg.org/ffmpeg-filters.html#trim" },
    ],
  },
  {
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
      "Video sound too quiet? Raise it to normal volume without loud moments crackling: iMovie, Clipchamp, ffmpeg's loudnorm, or Stella (stella.sh) on your own computer.",
    h1: "Increase the volume of a quiet video without distortion",
    short: "Make a video louder",
    lede: "A barely audible birthday speech raised 20 dB, without the glass clinks crackling.",
    answer:
      "Turning the volume up evenly makes the loud moments clip, so raise the quiet speech and hold the peaks down: iMovie's Normalize clip volume does that on a Mac, Clipchamp goes to 200% on Windows, and ffmpeg's loudnorm filter does it properly. Stella (stella.sh) brought a speech recorded from the back of a hall up to normal video loudness, about 20 dB louder, with two glass clinks near the start still clean.",
    stellaSteps: [
      "Finds “Nan's 90th - speech” in Videos and measures its sound: very quiet speech, with two loud peaks near the start",
      "Gently evens out the voice, takes out low rumble and some background hiss, then raises it to normal video loudness with a limit on peaks",
      "Copies the picture across untouched, so only the sound changes",
      "Measures the result: about 20 dB louder, no clipping, and the picture identical",
      "Saves a louder copy next to the original and says it was checked by measurement, not by listening",
    ],
    prompt:
      "The sound on the video of my nan's 90th birthday speech in my Videos is so quiet you can barely hear her. Make it louder.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "The louder copy in about 1 minute 10 seconds. Checked afterwards against an answer key written before the run: the speech went from −40 to −15 LUFS (normal video loudness), nothing at full scale and the glass clinks not flattened, the same speech in time, the same length, the picture unchanged and still H.264.",
      note: "The speech is a synthetic voice recorded quietly, with two near-full-scale glass clinks and applause, made for this run so a plain volume boost would clip. The work is sped up 5×. Everything was measured; nobody listened to it.",
      video: {
        src: `${PROOFS}/video/make-video-louder/proof.mp4`,
        cuts: webCuts("video/make-video-louder"),
        poster: `${PROOFS}/video/make-video-louder/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 44.23,
        realDuration: 108,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A very quiet birthday-speech video is in Videos." },
        { at: 1.63, text: "The prompt: the sound is so quiet you can barely hear her, make it louder." },
        { at: 12.03, text: "Stella replies it's making a louder copy and leaving the original alone." },
        { at: 18.03, text: "Measuring the sound, raising the speech and cutting back hiss." },
        { at: 29.87, text: "Done: about 20 dB louder, no distortion, picture untouched; give it a listen." },
      ],
    },
    manualTitle: "Make it louder yourself",
    manualSteps: [
      {
        title: "Mac: iMovie",
        body: "Add the clip to a project, select it and click the Volume button above the viewer. Drag the slider up (it goes to 400%) and turn on Normalize clip volume in the audio settings. Then File, Share, File.",
      },
      {
        title: "Windows: Clipchamp",
        body: "Add the clip to the timeline, select it, open Audio in the property panel and drag the volume up to 200%. For a very quiet recording that may not be enough; ffmpeg or Audacity can go further.",
      },
      {
        title: "ffmpeg",
        body: "`ffmpeg -i in.mp4 -c:v copy -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:a aac out.mp4` brings the sound to normal video loudness and keeps peaks under the limit, without touching the picture.",
      },
      {
        title: "Don't just add decibels",
        body: "A plain `volume=24dB` (or dragging a gain slider to the top) makes any loud moment, a clink, a laugh, a bump, hit the ceiling and crackle. Loudness normalisation or a limiter raises the quiet parts while holding peaks down.",
      },
      {
        title: "Only playing it louder",
        body: "VLC can play up to 125% (200% in some versions), but that changes nothing in the file. To share it, you need a louder copy.",
      },
    ],
    limits: [
      "Raising the voice raises the room noise too. Stella cut back some hiss, but a distant recording won't sound like a close microphone.",
      "Checked by measurement only. Stella said it hadn't listened and suggested a quick listen, noting the last few seconds stayed about 10 dB quieter.",
      "File names and measurements of the sound went to the AI model you use in Stella. The video was processed on your computer.",
      "Recorded on Linux with ffmpeg already installed. On a Mac or Windows PC Stella would usually download ffmpeg first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I make a quiet video louder without distortion?",
        a: "Normalise the loudness with a peak limit (loudnorm in ffmpeg, Normalize in iMovie) instead of adding a fixed amount of gain.",
      },
      {
        q: "Will the picture lose quality?",
        a: "No. Stella copied the picture across untouched; only the sound was re-encoded.",
      },
      {
        q: "How loud should a video be?",
        a: "Around −14 to −16 LUFS is what phones and YouTube play at. Stella's copy came out at −15.",
      },
      {
        q: "My audio files are uneven, not a video. Is there a guide?",
        a: "Yes: [normalize audio volume](/how/audio/normalize-audio-volume).",
      },
    ],
    related: ["audio/normalize-audio-volume", "video/cut-out-part-of-video", "audio/extract-audio-from-video"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Apple: Add a soundtrack and sound effects to your iMovie project", href: "https://support.apple.com/101664" },
      { label: "Microsoft: How to change the volume of a video or audio clip (Clipchamp)", href: "https://support.microsoft.com/en-us/Clipchamp/how-to-change-the-volume-of-a-video-or-audio-clip" },
      { label: "FFmpeg filters: loudnorm", href: "https://ffmpeg.org/ffmpeg-filters.html#loudnorm" },
    ],
  },
  {
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
      "Make a reversed copy of a video so it plays backwards, without it turning sideways: iMovie, Shotcut, ffmpeg, or Stella (stella.sh) on your own computer.",
    h1: "Reverse a video so it plays backwards",
    short: "Reverse a video",
    lede: "Kids jumping into a pool, reversed so they fly back out of the water.",
    answer:
      "On a Mac, iMovie's speed controls have a Reverse tick box; on Windows, Clipchamp can't reverse, but the free Shotcut can. Phone videos are often stored sideways with a rotation flag, and some tools drop it, so the reversed copy plays on its side. Stella (stella.sh) made a reversed copy of a 12-second pool video, picture and sound both backwards, still upright as a portrait video.",
    stellaSteps: [
      "Finds “Pool jump” in Videos: 12 seconds, a portrait phone video",
      "Reverses the picture and the sound in one pass, keeping the video upright",
      "Saves Pool jump (reversed).mp4 next to the original",
      "Compares frames from the start, middle and end of both videos to confirm the new one runs backwards",
      "Reports it starts on the splash and ends with the kid back on the edge, and suggests listening to the reversed sound",
    ],
    prompt:
      "Make a reversed version of the video of the kids jumping into the pool in my Videos, so it plays backwards, like they're flying out of the water.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "The reversed copy in about 30 seconds. Checked afterwards against an answer key written before the run, using a time code drawn in the corner: the same 12 seconds, still an upright 720×1280 portrait video (the phone stored it sideways with a rotation flag), every sampled moment showing the right frame from the other end, and the original unchanged.",
      note: "The pool video is a drawn scene with splash sounds, made for this run and stored sideways with a rotation flag as phones do. The work is sped up 2×.",
      video: {
        src: `${PROOFS}/video/reverse-video/proof.mp4`,
        cuts: webCuts("video/reverse-video"),
        poster: `${PROOFS}/video/reverse-video/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 39.13,
        realDuration: 63,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A 12-second pool video is in Videos." },
        { at: 1.63, text: "The prompt: make a reversed version so the kids fly out of the water." },
        { at: 9.63, text: "Stella replies it's saving a reversed copy next to the original." },
        { at: 15.63, text: "Reversing the picture and sound and comparing frames." },
        { at: 24.73, text: "Done: starts on the splash, ends with the kid back on the edge; same 12 seconds." },
      ],
    },
    manualTitle: "Reverse it yourself",
    manualSteps: [
      {
        title: "Mac: iMovie",
        body: "Add the clip to a project, select it and click the speedometer button above the viewer. Tick Reverse, then File, Share, File to save the reversed video.",
      },
      {
        title: "Windows: Shotcut",
        body: "Clipchamp has no reverse. In the free Shotcut, open the video and click Reverse… in its Properties panel, which writes a reversed copy. Add that to the timeline and Export.",
      },
      {
        title: "On the phone",
        body: "CapCut and several free phone editors have a Reverse button. iPhone's Photos app doesn't. Check the result plays upright; some apps lose the rotation.",
      },
      {
        title: "ffmpeg",
        body: "`ffmpeg -i in.mp4 -vf reverse -af areverse -crf 18 out.mp4` reverses picture and sound. Add `-an` instead of `-af areverse` for silence. ffmpeg keeps the rotation by default; don't turn autorotate off.",
      },
      {
        title: "Long videos",
        body: "Reversing holds every frame in memory. For anything over a minute or two, cut out just the moment you want first, or split it into pieces, reverse each and join them in reverse order.",
      },
    ],
    limits: [
      "Reversed speech is gibberish. Stella reversed the sound too and suggested listening; for a clip with talking you may prefer to mute it or add music.",
      "Long videos need a lot of memory to reverse. This was a 12-second clip; for long ones, cut the moment you want first.",
      "File names, the video's details and a few frames went to the AI model you use in Stella. The video was reversed on your computer.",
      "Recorded on Linux with ffmpeg already installed. On a Mac or Windows PC Stella would usually download ffmpeg first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why does my reversed video play sideways?",
        a: "Phones often save the picture sideways with a flag telling players to turn it. Some reversers drop the flag. Stella's copy stayed upright.",
      },
      {
        q: "Can I reverse just part of a video?",
        a: "Yes. Give Stella the times, or cut the moment out first: see [cut out part of a video](/how/video/cut-out-part-of-video).",
      },
      {
        q: "Can I make a boomerang (forwards then backwards)?",
        a: "Yes: ask Stella to join the clip and its reversed copy, or see [combine videos into one](/how/video/combine-videos-into-one).",
      },
      {
        q: "Can I slow it down too?",
        a: "Yes, ask for both. The speed-up guide works the other way: [speed up a video](/how/video/speed-up-video).",
      },
    ],
    related: ["video/speed-up-video", "video/make-gif-from-video", "video/rotate-video"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Apple: Change clip speed in iMovie on Mac (Reverse)", href: "https://support.apple.com/guide/imovie/mov6c442b2eb/mac" },
      { label: "Shotcut (free video editor)", href: "https://shotcut.org/" },
      { label: "FFmpeg filters: reverse and areverse", href: "https://ffmpeg.org/ffmpeg-filters.html#reverse" },
    ],
  },
];
