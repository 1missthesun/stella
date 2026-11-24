import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const AUDIO_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "edit-mp3-tags-in-bulk",
    niche: "audio",
    searchPhrases: [
      "edit mp3 tags in bulk",
      "edit mp3 metadata",
      "mp3 tag editor",
      "add album art to mp3",
      "mp3 showing unknown artist",
    ],
    title: "Edit MP3 tags in bulk and add the album art",
    description:
      "MP3s showing Unknown Artist with no cover? Ask Stella (stella.sh) to fill in titles, artists, albums and album art for a whole folder at once.",
    h1: "Edit MP3 tags in bulk (and add the album art)",
    short: "Edit MP3 tags in bulk",
    lede: "Every song showing its title, artist and cover, not Unknown Artist.",
    answer:
      "To edit MP3 tags in bulk, fill them in from the file and folder names and add the cover to every song at once. Stella (stella.sh) does a whole album that way for you.",
    gets: [
      "Titles, artist, album and track numbers in every song",
      "The album cover added to each file",
      "The music itself left exactly as it was",
    ],
    prompt:
      "My Larkspur Trio album shows Unknown Artist and no cover. Fill in the song info from the file names and add the cover from the folder.",
    demo: {
      ack: "Sure. Filling in the album now.",
      task: "Tagging the Larkspur Trio album",
      rows: [
        "Reading the folder and file names",
        "Writing titles, artist and track numbers",
        "Adding cover.jpg to all 12 songs",
      ],
      reply:
        "Done. All 12 songs on Night Ferry now show the artist, year, track numbers and cover. Genre and composer are empty; tell me what to put.",
    },
    faq: [
      ["Why do my MP3s show Unknown Artist?", "The files have no artist tag inside them. Players read the tags stored in each file, not the file name."],
      ["Is there a batch MP3 tag editor?", "Yes. Mp3tag is free on Windows and edits many files at once. On a Mac, the Music app sets artist, album and cover for many songs together."],
    ],
    byHand: [
      "Windows: drag the album into the free [Mp3tag](https://www.mp3tag.de/en/), select all, then Convert, Filename - Tag with a pattern like %track% %title%.",
      "Type the artist, album and year once, right-click the cover box, choose Add cover, then press Ctrl+S.",
      "Mac: in Music, select all the songs, choose Song, Info, and set Artist, Album and Artwork once.",
    ],
    related: ["audio/convert-flac-to-mp3", "pc-cleanup/organize-downloads-folder", "audio/transcribe-voice-memos-to-text"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-flac-to-mp3",
    niche: "audio",
    searchPhrases: [
      "convert flac to mp3",
      "flac to mp3",
      "flac to mp3 converter",
      "convert flac to mp3 mac",
      "convert flac to mp3 keep album art",
    ],
    title: "Convert FLAC to MP3 and keep the tags and album art",
    description:
      "Car or phone won't play FLAC? Ask Stella (stella.sh) to turn a whole album into MP3s with the song names, track numbers and album art kept.",
    h1: "Convert FLAC to MP3, keeping the song names and album art",
    short: "Convert FLAC to MP3",
    lede: "Your FLAC album as MP3s that play in the car, names and cover intact.",
    answer:
      "To convert FLAC to MP3 and keep the album art, use a converter that copies the song details, such as the free fre:ac. Stella (stella.sh) converts a whole album and leaves the FLACs untouched.",
    gets: [
      "High-quality MP3s that car stereos play",
      "Song names, track numbers and cover carried over",
      "Your FLACs kept as they were",
    ],
    prompt:
      "Convert my Marisol Vega FLAC album to MP3 so it plays in my car. Keep the song names and album art.",
    demo: {
      ack: "On it. Converting the album to MP3.",
      task: "Converting Coastline Sessions to MP3",
      rows: ["Reading the 10 FLAC songs", "Making 320 kbps MP3s", "Copying names, track numbers and cover"],
      reply:
        "Done. All 10 songs are in **Marisol Vega - Coastline Sessions (MP3)**, next to the album, with names and cover in place. Copy that folder to a USB stick for the car.",
      files: ["Marisol Vega - Coastline Sessions (MP3)"],
    },
    faq: [
      ["Does converting FLAC to MP3 lose quality?", "A little, but at 256 to 320 kbps most people can't hear it in a car. Keep the FLACs for full quality."],
      ["Why does my car show Track 01 instead of song names?", "The converter didn't copy the song details. Convert again with one that does, like fre:ac."],
    ],
    byHand: [
      "Install the free [fre:ac](https://www.freac.org) on Windows, Mac or Linux and add the FLAC files.",
      "Choose the MP3 encoder at 256 or 320 kbps, pick an output folder and start. Tags and cover carry over.",
      "On a Mac, the free XLD does the same. The Music app can't open FLAC.",
    ],
    related: ["audio/edit-mp3-tags-in-bulk", "video/convert-mkv-to-mp4", "audio/convert-m4a-to-mp3"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "transcribe-voice-memos-to-text",
    niche: "audio",
    searchPhrases: [
      "transcribe voice memos to text",
      "transcribe audio to text",
      "transcribe audio to text free",
      "transcribe voice memos",
      "transcribe audio on my computer without uploading",
    ],
    title: "Transcribe voice memos to text, free and on your computer",
    description:
      "Want your voice memos as text? Ask Stella (stella.sh) to transcribe a whole folder for free on your own computer, one tidy text file per memo.",
    h1: "Transcribe voice memos to text",
    short: "Transcribe voice memos to text",
    lede: "Your voice memos as text you can read, search and copy.",
    answer:
      "For free voice memo transcripts, open each memo in Voice Memos on a Mac or iPhone. Stella (stella.sh) transcribes a whole folder at once on your computer.",
    gets: ["One text file per memo", "All of them on one page, with a summary of each", "Names marked for you to check"],
    prompt:
      "Turn the voice memos in my Downloads into text I can read, and tell me what each one is about.",
    demo: {
      ack: "Sure. Transcribing your memos now.",
      task: "Transcribing your voice memos",
      rows: [
        "Finding 4 memos in Downloads",
        "Turning speech into text on your computer",
        "Writing a one-line summary of each",
      ],
      reply:
        "Done. Your 4 memos are in **Voice memo transcripts**, one file each, plus a page with all of them. Check the spelling of two names.",
      files: ["Voice memo transcripts"],
    },
    faq: [
      ["Can I transcribe voice memos for free?", "Yes. Voice Memos on macOS 15 and iOS 18 shows a free transcript for each memo. Stella does a whole folder for free on your computer."],
      ["Does my audio get uploaded?", "No. The speech is turned into text on your own computer."],
    ],
    byHand: [
      "Mac (macOS 15) or iPhone (iOS 18): open a memo in Voice Memos, tap the transcript button and copy the text.",
      "With Microsoft 365, use Word for the web: Home, Dictate, Transcribe, Upload audio.",
      "Free Whisper apps run on your own computer and handle many files.",
    ],
    related: [
      "video/burn-subtitles-into-video-for-tiktok",
      "audio/edit-mp3-tags-in-bulk",
      "local-ai/run-ai-offline-on-your-computer",
    ],
    platforms: ["windows", "mac", "linux"],
    costNote:
      "Yes. Stella uses a free speech tool on your computer.",
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-m4a-to-mp3",
    niche: "audio",
    searchPhrases: ["convert m4a to mp3", "m4a to mp3", "convert voice memo to mp3", "wav to mp3", "ogg to mp3"],
    title: "Convert M4A to MP3 (and WAV or OGG), a whole folder at once",
    description:
      "Car only plays MP3? Ask Stella (stella.sh) to convert a folder of M4A, WAV and OGG recordings to real MP3s with the same names, originals kept.",
    h1: "Convert M4A to MP3, keeping the same names",
    short: "Convert M4A to MP3",
    lede: "Recordings your car will actually play, with the same names.",
    answer:
      "To convert M4A to MP3, use the Music app on a Mac or VLC on Windows; renaming the file doesn't work. Stella (stella.sh) converts a whole folder of M4A, WAV and OGG recordings and keeps their names.",
    gets: ["Real MP3s, not renamed files", "The same names as your recordings", "Originals left right beside them"],
    prompt:
      "My car only plays MP3s. Convert all the recordings in my Voice memos folder to MP3 and keep the same names.",
    demo: {
      ack: "Sure. Converting them to MP3.",
      task: "Converting your recordings to MP3",
      rows: ["Finding 9 recordings and a text note", "Making an MP3 of each", "Saving them next to the originals"],
      reply:
        "Done. All 9 recordings (5 M4A, 3 WAV, 1 OGG) are now MP3s with the same names, each as long as the original. I left the text note alone.",
    },
    faq: [
      ["Can you rename M4A to MP3?", "Some phones still play it, but the sound inside stays M4A and most car stereos skip it. Convert it instead."],
      ["Can VLC convert M4A to WAV or MP3?", "Yes. Choose Media, Convert / Save, add the files and pick the Audio - MP3 profile. For WAV, pick Audio - CD."],
    ],
    byHand: [
      "Mac: in Music, go to Settings, Files, Import Settings, choose MP3 Encoder, then select the recordings and File, Convert, Create MP3 Version.",
      "Windows: in the free VLC, choose Media, Convert / Save, add the files and pick Audio - MP3.",
      "Give each output its own name, or VLC writes them all to one file.",
    ],
    related: ["audio/convert-flac-to-mp3", "audio/extract-audio-from-video", "audio/merge-mp3-files"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "extract-audio-from-video",
    niche: "audio",
    searchPhrases: ["extract audio from video", "convert video to mp3", "mp4 to mp3", "extract audio from mp4", "video to mp3"],
    title: "Extract audio from a video as MP3, a whole folder at once",
    description:
      "Want to listen to a video instead of watching it? Ask Stella (stella.sh) to save the sound from a whole folder of videos as numbered MP3s.",
    h1: "Extract the audio from videos as MP3",
    short: "Extract audio from video",
    lede: "The sound from your videos as MP3s for a walk or a drive.",
    answer:
      "To extract the audio from a video, export only the sound: QuickTime Player does it on a Mac, VLC on Windows. Stella (stella.sh) turns a whole folder of videos into MP3s, numbered so they play in order.",
    gets: ["An MP3 for every video that has sound", "Numbered so they play in order", "Your videos left as they were"],
    prompt:
      "Get the audio out of my evening class videos as MP3s so I can listen to them while I walk the dog.",
    demo: {
      ack: "Sure. Pulling the sound out now.",
      task: "Saving your class videos as MP3s",
      rows: ["Finding 5 videos in Videos", "Checking each one has sound", "Saving MP3s named by week"],
      reply:
        "Done. 4 MP3s are in a new folder next to the videos, named by week. Week 4 (Archive photos) has no sound, so there was nothing to save.",
    },
    faq: [
      ["How do I extract audio from a video on iPhone?", "Photos and Files can't do it. Send the video to a Mac and use QuickTime's Export As, Audio Only, or ask Stella on your computer."],
      ["Is MP4 to MP3 lossless?", "Not quite, but for talks you won't hear a difference. Ask for M4A to keep the original sound exactly."],
    ],
    byHand: [
      "Mac: open the video in QuickTime Player and choose File, Export As, Audio Only. That saves an M4A.",
      "Windows: in VLC, choose Media, Convert / Save, add the videos and pick Audio - MP3.",
      "Start the names with 01, 02 and so on so phones play them in order.",
    ],
    related: ["audio/convert-m4a-to-mp3", "audio/transcribe-voice-memos-to-text", "video/make-srt-subtitle-file"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-audiobook-with-chapters",
    niche: "audio",
    searchPhrases: [
      "combine mp3 into audiobook",
      "mp3 to m4b",
      "m4b converter",
      "audiobook maker",
      "how to combine multiple mp3 files into one audiobook",
    ],
    title: "Combine MP3 chapters into one M4B audiobook with chapters",
    description:
      "Audiobook in a pile of chapter MP3s? Ask Stella (stella.sh) to join them into one M4B with named chapters, with the cover and author kept.",
    h1: "Combine MP3 chapters into one audiobook with chapters",
    short: "Make an audiobook with chapters",
    lede: "One audiobook file with chapters that remembers where you stopped.",
    answer:
      "To combine MP3 chapters into an audiobook, join them into one M4B file with a chapter mark where each one starts. Stella (stella.sh) does it from your chapter files, names each chapter and adds the cover.",
    gets: [
      "One M4B file your audiobook app understands",
      "Each chapter named, not just numbered",
      "The cover, title and author included",
    ],
    prompt:
      "My audiobook is a pile of chapter MP3s in Downloads. Make it one audiobook file with chapters so my app remembers my place.",
    demo: {
      ack: "Happy to. Joining the chapters now.",
      task: "Making your audiobook",
      rows: ["Putting 8 chapters in order", "Marking where each chapter starts", "Adding the cover and author"],
      reply:
        "Done. **The Lantern Keeper of Gull Point.m4b** has all 8 chapters, from “The Letter” to “Home”, and the cover. Your chapter MP3s are unchanged.",
      files: ["The Lantern Keeper of Gull Point.m4b"],
    },
    faq: [
      ["What is an M4B file?", "An audio file marked as an audiobook. Apps show its chapters and remember where you stopped."],
      ["Can I combine multiple M4B files into one?", "Yes. Ask Stella to join the parts into one M4B, with a chapter at the start of each."],
    ],
    byHand: [
      "Mac and Windows have no free built-in tool for this. Paid apps like Audiobook Builder take the MP3s and export an M4B.",
      "On iPhone, drag the M4B into Books through Finder or the Apple Devices app.",
      "On Android, open it in an app that reads M4B chapters, such as Smart AudioBook Player.",
    ],
    related: ["audio/merge-mp3-files", "audio/edit-mp3-tags-in-bulk", "audio/split-audio-into-tracks"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-ringtone",
    niche: "audio",
    searchPhrases: ["make a ringtone for iphone", "custom ringtone iphone", "make ringtone from song", "ringtone maker", "m4r"],
    title: "Make an iPhone ringtone from a song, starting at the chorus",
    description:
      "Want a song as your iPhone ringtone, starting at the chorus? Ask Stella (stella.sh) to cut it to the right length and save it as a ringtone file.",
    h1: "Make an iPhone ringtone from a song",
    short: "Make an iPhone ringtone",
    lede: "The best part of your favourite song as your iPhone ringtone.",
    answer:
      "An iPhone ringtone is up to 40 seconds of a song saved as an .m4r file, added with Finder or the Apple Devices app. Stella (stella.sh) makes the file from the moment you choose.",
    gets: [
      "A 30-second ringtone starting where you said",
      "A gentle fade at the end",
      "Simple steps to put it on your iPhone",
    ],
    prompt:
      "Make an iPhone ringtone from Lanterns in my Music folder, starting where the chorus comes in at 1:05.",
    demo: {
      ack: "Sure. Cutting it from 1:05.",
      task: "Making your Lanterns ringtone",
      rows: ["Cutting 30 seconds from 1:05", "Fading out the last 3 seconds", "Saving it as an iPhone ringtone"],
      reply:
        "Done. The ringtone is next to the song. Plug in your iPhone, select it in Finder and drag the file onto it. It then shows up in Settings, Sounds & Haptics.",
      files: ["Juniper Lane - Lanterns (Ringtone).m4r"],
    },
    faq: [
      ["How do I set a song as a ringtone from Files on iPhone?", "Open GarageBand, import the song from Files, trim it to 30 seconds, then in My Songs hold the project and choose Share, Ringtone."],
      ["How long can an iPhone ringtone be?", "Up to 40 seconds from a computer, or 30 if you make it in GarageBand."],
    ],
    byHand: [
      "Mac: connect the iPhone, select it in the Finder sidebar and drag the .m4r onto the General tab.",
      "Windows: open the Apple Devices app, select the phone and drag the .m4r into Tones.",
      "Android takes MP3s: copy the cut song into Ringtones and pick it in Settings, Sound.",
    ],
    related: ["audio/convert-m4a-to-mp3", "audio/normalize-audio-volume", "video/make-gif-from-video"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "merge-mp3-files",
    niche: "audio",
    searchPhrases: [
      "merge mp3 files",
      "combine mp3 files into one",
      "join mp3",
      "combine audio files",
      "merge mp3 files into one",
    ],
    title: "Merge MP3 files into one, in the right order",
    description:
      "Want lessons or tracks joined into one MP3? Ask Stella (stella.sh) to merge them in true number order, so lesson 10 comes after 9, not after 1.",
    h1: "Merge MP3 files into one, in the right order",
    short: "Merge MP3 files",
    lede: "A pile of MP3s joined into one file, in the right order.",
    answer:
      "To merge MP3 files into one, line them up in order and export a single file, for example with the free Audacity. Stella (stella.sh) joins them for you in the right order, even when they were recorded differently.",
    gets: ["One MP3 that plays straight through", "Lesson 10 after 9, not after 1", "No clicks where the files meet"],
    prompt:
      "Join the 12 lesson files in my Spanish for travellers folder into one MP3 I can play straight through, in lesson order.",
    demo: {
      ack: "Sure. Joining all 12 in order.",
      task: "Joining your Spanish lessons",
      rows: ["Sorting by lesson number", "Matching lessons 10 to 12 to the rest", "Joining them into one file"],
      reply:
        "Done. The full set is one MP3 in the same folder. Lessons 10 to 12 were recorded at lower quality, so I matched them to the rest to avoid a glitch.",
      files: ["Spanish for travellers - Lessons 1-12 (complete).mp3"],
    },
    faq: [
      ["How do I combine MP3 files into one?", "In Audacity, import them all, line them up end to end and export one MP3. Or ask Stella to join a folder."],
      ["Why is lesson 10 playing after lesson 1?", "Computers sort names character by character, so 10 comes before 2. Rename them 01, 02 and so on."],
    ],
    byHand: [
      "In the free [Audacity](https://www.audacityteam.org), choose File, Import, Audio and add the files.",
      "Select all, then Tracks, Align Tracks, Align End to End.",
      "Export with File, Export Audio, MP3, then listen to each join.",
    ],
    related: ["audio/make-audiobook-with-chapters", "audio/split-audio-into-tracks", "video/combine-videos-into-one"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "normalize-audio-volume",
    niche: "audio",
    searchPhrases: [
      "make all songs same volume",
      "normalize audio volume",
      "normalize audio",
      "audio normalizer",
      "volume booster mp3",
    ],
    title: "Make all songs the same volume (normalize MP3 loudness)",
    description:
      "Some songs too quiet, one far too loud? Ask Stella (stella.sh) to even out a folder of music to the same loudness, with a backup of the originals.",
    h1: "Make all your songs the same volume",
    short: "Make songs the same volume",
    lede: "A playlist where no song is too quiet or too loud.",
    answer:
      "To make all songs the same volume, match how loud they sound, not their highest peak. Stella (stella.sh) evens out a whole folder of songs that way and keeps a copy of the originals.",
    gets: [
      "Every song at the same loudness",
      "No crackle on quiet songs turned up",
      "Song names, artists and a backup kept",
    ],
    prompt:
      "The songs in my Party mix folder are all different volumes. Some are really quiet and one is way too loud. Make them even.",
    demo: {
      ack: "On it. Measuring each song first.",
      task: "Evening out your party mix",
      rows: ["Measuring the 10 songs", "Saving a copy of the originals", "Bringing 9 to the same loudness"],
      reply:
        "Done. All 10 songs now play at the same loudness. Saltwater Radio was already right, so I left it. Glasshouse's drum hits are a touch softer so it doesn't crackle.",
    },
    faq: [
      ["How do I make all MP3 files the same volume?", "Use loudness normalization, which matches how loud songs sound. Audacity has it, or ask Stella to do the whole folder."],
      ["What's the difference between normalize and loudness normalize?", "Normalize lines up each song's loudest moment. Loudness normalize matches how loud they sound overall, which is what a playlist needs."],
    ],
    byHand: [
      "In Audacity, select all, then Effect, Volume and Compression, Loudness Normalization, set to −14 or −16 LUFS.",
      "If a quiet song crackles afterwards, run a Limiter at −1 dB first.",
      "Apple Music's Sound Check evens out playback in the app without changing the files.",
    ],
    related: ["audio/edit-mp3-tags-in-bulk", "audio/merge-mp3-files", "audio/make-ringtone"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "split-audio-into-tracks",
    niche: "audio",
    searchPhrases: [
      "split audio file into parts",
      "split mp3 into tracks",
      "split audio by silence",
      "split audio file",
      "split mp3 file",
    ],
    title: "Split an audio file into tracks at the quiet gaps",
    description:
      "Recorded a whole set as one file? Ask Stella (stella.sh) to split it at the quiet gaps into a separate file per song, with no loss in quality.",
    h1: "Split an audio file into parts, one per song",
    short: "Split audio into tracks",
    lede: "One long recording cut into a file for each song.",
    answer:
      "To split an audio file into songs, cut it at the quiet gaps between them. Stella (stella.sh) finds the real gaps, keeps quiet moments inside a song in one piece and saves each song as its own file.",
    gets: ["A file for each song", "Exactly the same sound quality", "Soft bits inside a song left whole"],
    prompt:
      "I recorded my band's rehearsal as one long file in my Music folder. Split it into a separate file for each song.",
    demo: {
      ack: "Sure. Finding the gaps between songs.",
      task: "Splitting your rehearsal",
      rows: ["Listening for the quiet gaps", "Keeping song 4's soft middle whole", "Saving 7 songs"],
      reply:
        "Done. Your rehearsal is now 7 files, Song 01 to Song 07. Send me the setlist and I'll name them.",
      files: ["Rehearsal at the Anchor - songs"],
    },
    faq: [
      ["Can I split an MP3 without losing quality?", "Yes. Cutting it without saving the sound again keeps the quality the same, and that's how Stella splits it."],
      ["What if the songs have no gaps between them?", "Give the time each song starts and it's cut at those times instead."],
    ],
    byHand: [
      "In Audacity, select all, then Analyze, Label Sounds, with about −45 dB and 2 seconds of silence.",
      "Fix any song split in two by dragging the label edges.",
      "Choose File, Export Audio, Multiple Files, split based on labels.",
    ],
    related: ["audio/merge-mp3-files", "audio/make-audiobook-with-chapters", "video/cut-silences-from-video"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "change-key-of-song",
    niche: "audio",
    searchPhrases: [
      "change key of song",
      "change pitch of song",
      "key changer",
      "transpose song",
      "change pitch of song without changing speed",
    ],
    title: "Change the key of a song without changing its speed",
    description:
      "Song a little too high to sing? Ask Stella (stella.sh) to change its key by a few semitones without speeding it up or slowing it down.",
    h1: "Change the key of a song to fit your voice",
    short: "Change the key of a song",
    lede: "Your song lower or higher to suit your voice, at the same speed.",
    answer:
      "To change the key of a song without changing its speed, use a pitch shifter, not the speed slider. Stella (stella.sh) moves a song up or down the semitones you ask for and saves a copy beside the original.",
    gets: ["The song in the key you asked for", "The same speed and length", "Your original left alone"],
    prompt:
      "Lower Paper Boats in my Music folder by two semitones so it fits my voice. Keep the same speed.",
    demo: {
      ack: "Sure. Lowering it two semitones.",
      task: "Lowering Paper Boats",
      rows: ["Opening the practice track", "Shifting it down two semitones", "Keeping the tempo exactly the same"],
      reply:
        "Done. The new copy is next to the original, the same length and speed, just two semitones lower. Give it a listen before you practise.",
      files: ["Paper Boats (practice track) (-2 semitones).mp3"],
    },
    faq: [
      ["How many semitones lower should I go?", "Count frets or piano keys down until the highest note feels easy. Most people need one to three."],
      ["Can it transpose the chords too?", "Yes. Send the chord sheet with the song and it comes back in the new key."],
    ],
    byHand: [
      "In Audacity, select the song, then Effect, Pitch and Tempo, Change Pitch, and set Semitones to −2.",
      "Each semitone is one piano key or one guitar fret.",
      "Playing slower lowers the pitch but drags the tempo, so use Change Pitch.",
    ],
    related: [
      "audio/slow-down-song-without-changing-pitch",
      "audio/make-karaoke-version-of-song",
      "audio/convert-midi-to-mp3",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-midi-to-mp3",
    niche: "audio",
    searchPhrases: ["midi to mp3", "convert midi to mp3 free", "midi to audio", "midi to wav", "midi to mp3 with soundfont"],
    title: "Convert MIDI to MP3 with a real piano sound, free",
    description:
      "Got MIDI files that won't play on your phone? Ask Stella (stella.sh) to turn them into MP3s with a rich piano sound, ready to listen to anywhere.",
    h1: "Convert MIDI to MP3 with a piano sound",
    short: "Convert MIDI to MP3",
    lede: "Your MIDI files as MP3s that sound like a real piano.",
    answer:
      "To convert MIDI to MP3, play it through a good instrument sound and save the result. The free MuseScore Studio does one file at a time; Stella (stella.sh) does a whole folder with a grand piano sound.",
    gets: ["MP3s that play on any phone", "A full piano sound, not a thin beep", "Long rests shortened for practice"],
    prompt:
      "I have MIDI files from my piano lessons in the Piano lessons folder in Music. Turn them into MP3s I can play on my phone.",
    demo: {
      ack: "Sure. Turning them into piano MP3s.",
      task: "Turning your lessons into MP3s",
      rows: ["Finding 4 MIDI files", "Playing each through a grand piano", "Putting the MP3s in your Drive"],
      reply:
        "Done. Your 4 lesson pieces are MP3s in a folder next to the originals, and in your Stella Drive so you can play them on your phone.",
    },
    faq: [
      ["How do I save MIDI as MP3?", "Open the MIDI file in the free MuseScore Studio, then choose File, Export, MP3. Or ask Stella to do a folder."],
      ["Why does my MIDI sound like a ringtone after converting?", "MIDI holds notes, not sound. Cheap converters play them with a tiny sound set; a fuller one gives a real piano."],
    ],
    byHand: [
      "Install the free [MuseScore Studio](https://musescore.org) and open the .mid file with File, Open.",
      "Choose File, Export, MP3 and save. Repeat for each file.",
      "Copy the MP3s to your phone with a cable, AirDrop or a cloud folder.",
    ],
    related: ["audio/slow-down-song-without-changing-pitch", "audio/change-key-of-song", "audio/convert-m4a-to-mp3"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-karaoke-version-of-song",
    niche: "audio",
    searchPhrases: [
      "remove vocals from song",
      "vocal remover",
      "make karaoke version of song",
      "karaoke maker",
      "backing track maker",
    ],
    title: "Remove vocals from a song to make a karaoke version",
    description:
      "Want to sing over a song without the original voice? Ask Stella (stella.sh) to remove the vocals and keep the bass, drums and everything else.",
    h1: "Remove the vocals from a song for karaoke",
    short: "Make a karaoke version of a song",
    lede: "Your song with the singing taken out, ready to sing over.",
    answer:
      "To remove vocals from a song, use an AI vocal remover that pulls the voice apart from the music. Stella (stella.sh) does that on your computer and keeps the bass and drums, which simple removers wipe out.",
    gets: ["A backing track with no singing", "Bass and drums still there", "Your original song untouched"],
    prompt:
      "Make a karaoke version of Lantern Song in my Music folder with the singing taken out, so I can practise over it.",
    demo: {
      ack: "Sure. Taking the vocals out.",
      task: "Making a karaoke version",
      rows: ["Separating the voice from the music", "Checking for leftover singing", "Saving the backing track"],
      reply:
        "Done. The karaoke version is next to the original, at the same volume, with the bass and kick drum still in.",
      files: ["Lantern Song (demo) - Karaoke (no vocals).mp3"],
    },
    faq: [
      ["Is there an Audacity karaoke plugin?", "The free OpenVINO plugin adds Music Separation to Audacity on Windows and Linux. The built-in Vocal Reduction takes the bass and drums out with the voice."],
      ["Can I keep just the vocals instead?", "Yes. Ask for the vocals too and you get both tracks."],
    ],
    byHand: [
      "Download the free Ultimate Vocal Remover, choose the song, pick a Demucs model and tick Instrumental Only.",
      "Online removers like LALAL.AI and Moises work in the browser, with a few free minutes.",
      "If you hear traces of the voice, try another model in the app.",
    ],
    related: [
      "audio/change-key-of-song",
      "audio/slow-down-song-without-changing-pitch",
      "local-ai/run-ai-offline-on-your-computer",
    ],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "slow-down-song-without-changing-pitch",
    niche: "audio",
    searchPhrases: [
      "slow down song without changing pitch",
      "slow down song",
      "slow down audio without changing pitch",
      "speed up song without changing pitch",
      "slow down song for practice",
    ],
    title: "Slow down a song without changing the pitch, for practice",
    description:
      "Learning a song by ear? Ask Stella (stella.sh) to make a slower copy at 75% speed, or any speed, that stays in tune so you can play along.",
    h1: "Slow down a song without changing its pitch",
    short: "Slow down a song, same pitch",
    lede: "A slower copy of a song for practice, still in the same key.",
    answer:
      "To slow down a song without changing its pitch, stretch the time instead of lowering the playback speed. Stella (stella.sh) saves a slower copy at the speed you choose, still in tune to play along.",
    gets: ["A copy at the speed you ask for", "Same key, so you can play along", "Your original kept"],
    prompt:
      "I'm learning Harbour Lights on guitar. It's in my Music folder. Make me a copy at 75% speed that doesn't sound lower.",
    demo: {
      ack: "Sure. Making a 75% copy.",
      task: "Slowing down Harbour Lights",
      rows: ["Measuring the song", "Stretching it to 75% speed", "Checking the pitch stayed put"],
      reply:
        "Done. The slower copy runs 70 seconds instead of 52.5, in the same key. Want an 85% one for when you're ready?",
      files: ["Harbour Lights (75% speed).mp3"],
    },
    faq: [
      ["How do I slow down music without changing pitch?", "In Audacity use Change Tempo, not Change Speed. VLC's Playback, Speed menu also keeps the pitch while it plays."],
      ["What speed should I practise at?", "Start where you can play it cleanly, often 60 to 75%, then step up about 10% at a time."],
      ["Can I speed a song up without it sounding higher?", "Yes. The same stretch works above 100% too."],
    ],
    byHand: [
      "In Audacity, select all, then Effect, Pitch and Tempo, Change Tempo, and set −25 for 75% speed.",
      "Tick Use high quality stretching, apply, then File, Export Audio.",
      "Make 80% and 90% copies from the original as you improve.",
    ],
    related: ["audio/change-key-of-song", "audio/make-karaoke-version-of-song", "video/speed-up-video"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "convert-wma-to-mp3",
    niche: "audio",
    searchPhrases: [
      "wma to mp3",
      "convert wma to mp3",
      "convert wma to mp3 keep tags",
      "car stereo won't play wma",
      "convert wma to mp3 windows 11",
    ],
    title: "Convert WMA to MP3 and keep song names and album info",
    description:
      "Old WMA music won't play in your car? Ask Stella (stella.sh) to convert the whole collection to MP3 with song names, artists, albums and covers kept.",
    h1: "Convert WMA to MP3 and keep the song info",
    short: "Convert WMA to MP3",
    lede: "Your old Windows Media songs as MP3s, names and albums intact.",
    answer:
      "To convert WMA to MP3 and keep the song info, use a converter that copies the details and keeps each album in its own folder, like the free fre:ac. Stella (stella.sh) converts your whole collection and adds the covers.",
    gets: ["MP3s your car stereo plays", "Titles, artists, albums and track numbers kept", "Each album's cover added"],
    prompt:
      "My old music in the From the old PC folder is all WMA, and my car stereo won't play it. Convert it to MP3 and keep the song info.",
    demo: {
      ack: "Sure. Converting your collection.",
      task: "Converting your old WMA music",
      rows: ["Finding 2 albums, 10 songs", "Making MP3s in matching album folders", "Adding each album's cover"],
      reply:
        "Done. All 10 songs are MP3s in **From the old PC (MP3)**, with names, artists, albums and covers. Both songs called “01 Intro” are there, each in its own album.",
    },
    faq: [
      ["Why did one of my songs disappear after converting?", "Two songs with the same name, like two Intros, landed in one folder and one replaced the other. Keep album folders."],
      ["Can Windows Media Player convert WMA to MP3?", "No. It rips CDs to MP3 but doesn't convert WMA files you already have."],
    ],
    byHand: [
      "In the free fre:ac, add the folder, choose the MP3 encoder and a name pattern like <artist>/<album>/<track> - <title>.",
      "VLC converts one file at a time with Media, Convert / Save, but often drops song names.",
      "Copy the converted folder to a USB stick for the car.",
    ],
    related: ["audio/convert-m4a-to-mp3", "audio/convert-flac-to-mp3", "audio/edit-mp3-tags-in-bulk"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "trim-silence-from-recordings",
    niche: "audio",
    searchPhrases: [
      "remove silence from audio",
      "trim silence from audio",
      "trim silence at start and end of audio",
      "remove dead air from recording",
      "trim silence from audio files in bulk",
    ],
    title: "Remove silence from the start and end of audio recordings",
    description:
      "Long silences at the start and end of your recordings? Ask Stella (stella.sh) to trim them off every file and leave the pauses in the middle alone.",
    h1: "Remove silence from the start and end of recordings",
    short: "Trim silence from recordings",
    lede: "Recordings that start with the first word and end with the last.",
    answer:
      "To remove silence from the start and end of a recording, cut up to just before the first word and from just after the last. Stella (stella.sh) trims a whole folder that way and leaves the middle untouched.",
    gets: [
      "Each recording starting right before you speak",
      "Pauses in the middle kept exactly",
      "The untouched originals saved in a folder",
    ],
    prompt:
      "Each of my garden club talks in Music has a long silence at the start and end. Trim those off, but don't cut anything from the middle.",
    demo: {
      ack: "Sure. Trimming just the ends.",
      task: "Trimming your garden club talks",
      rows: ["Finding 6 talks", "Finding the first and last words", "Cutting the quiet ends and phone clicks"],
      reply:
        "Done. All 6 talks now start half a second before you speak and stop just after you finish. The untouched recordings are in an **originals** folder.",
    },
    faq: [
      ["How do I remove silence only at the start and end?", "Delete from the start to the first word and from the last word to the end. Leave everything in between."],
      ["What does Truncate Silence in Audacity do?", "It shortens every quiet gap, including pauses between sentences. Use it to tighten speech, not to trim the ends."],
    ],
    byHand: [
      "Open the recording in Audacity, drag from the start to just before the first word and press Delete.",
      "Do the same from just after the last word to the end.",
      "Leave about half a second of air at each end, then File, Export.",
    ],
    related: ["video/cut-silences-from-video", "audio/transcribe-voice-memos-to-text", "audio/normalize-audio-volume"],
    platforms: ["windows", "mac", "linux"],
    lastChecked: "2026-11-24",
  }),
];
