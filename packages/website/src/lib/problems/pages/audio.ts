import { PROOFS, webCuts } from "../media";
import type { ProblemPage } from "../types";

export const AUDIO_PAGES: ProblemPage[] = [
  {
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
      "Fix MP3s that show Unknown Artist with no cover: fill in title, artist, album and track number from the file names and add art with Mp3tag, Music or Stella (stella.sh).",
    h1: "Edit MP3 tags in bulk (and add the album art)",
    short: "Edit MP3 tags in bulk",
    lede: "12 songs with the right title, artist, album and cover, from names you already have.",
    answer:
      "A tag editor can fill the details in from the file names: in the free Mp3tag on Windows, select the album and use Convert, Filename - Tag with a pattern like `%track% %title%`, type the artist and album once, add the cover and save. On a Mac, the Music app sets shared details for many songs at once, but titles go one song at a time. Stella (stella.sh) tags a whole folder from its names and embeds the cover.",
    stellaSteps: [
      "Finds the album folder in Music, “The Larkspur Trio - Night Ferry (2019)”: 12 MP3s with no tags at all, and a cover.jpg",
      "Takes the artist, album and year from the folder name and each title and track number from the file name, so “01 Harbour Lights” becomes track 1, “Harbour Lights”",
      "Writes title, artist, album, track and year into every file and embeds cover.jpg as the front cover",
      "Leaves the music, the file names and the cover file unchanged",
      "Says what it left empty (genre and composer, which the names don't give) and that your music app may need to rescan the folder",
    ],
    prompt:
      "The songs in my Larkspur Trio album folder in Music show up as Unknown Artist with no cover. Fill in the song info from the file and folder names and add the cover picture that's in the folder.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "All 12 songs tagged, with the cover, in about 1 minute 30 seconds. Checked afterwards against an answer key written before the run: title, artist, album, track number and year right on all 12, the front cover embedded in every file, and every song's length unchanged.",
      note: "The band, album and songs are fictitious: short instrumentals synthesised for this run, saved with no tags. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/audio/edit-mp3-tags-in-bulk/proof.mp4`,
        cuts: webCuts("audio/edit-mp3-tags-in-bulk"),
        poster: `${PROOFS}/audio/edit-mp3-tags-in-bulk/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 48.5,
        realDuration: 89,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. An album folder in Music holds 12 untagged MP3s and a cover.jpg." },
        { at: 2, text: "The prompt: fill in the song info from the file and folder names and add the cover." },
        { at: 17.3, text: "Stella replies that it's tagging the songs and adding the folder's cover picture." },
        { at: 23.1, text: "Tagging 12 files, sped up 3×." },
        { at: 34.5, text: "Done: artist, album, titles and track numbers 1 to 12, and the cover on every song; genre and composer left empty." },
      ],
    },
    manualTitle: "Tag them yourself",
    manualSteps: [
      {
        title: "Windows: Mp3tag",
        body: "Install the free Mp3tag, drag the album folder into it and select all the files. Choose Convert, Filename - Tag and enter `%track% %title%` (match your names, for example `%track% - %title%`), check the preview, then OK.",
      },
      {
        title: "Fill the shared fields and the cover",
        body: "With every file still selected, type the artist, album and year in the left panel. Right-click the cover box, choose Add cover and pick cover.jpg, then press Ctrl+S to save the tags into all the files at once.",
      },
      {
        title: "Mac: the Music app",
        body: "Add the folder to your library with File, Add to Library. Select all the songs, choose Song, Info, and set Artist, Album and Year once, then Artwork, Add Artwork. Titles and track numbers have to be typed in each song's own Info window.",
      },
      {
        title: "Known album? Let Picard look it up",
        body: "If the album was released commercially, the free MusicBrainz Picard (Windows, Mac and Linux) can identify it by its audio and fill in everything, cover included. It won't know home recordings, live bootlegs or very obscure releases.",
      },
      {
        title: "Make your player notice",
        body: "Players cache tags. In Music, remove the songs and add them again; on a phone or car stereo, copy the files over again. If a car still shows Unknown, it may only read ID3v2.3 tags, which Mp3tag can write (Options, Tags, Mpeg).",
      },
    ],
    limits: [
      "Stella filled the tags from information you already had: the file and folder names and the cover in the folder. It didn't look the album up online, and won't identify unknown songs by their sound unless you ask it to search.",
      "It left genre and composer empty rather than guess. Tell it what to put if you want them filled.",
      "File and folder names go to the AI model you use in Stella so it can work out the tags; the tagging itself happens on your computer.",
      "Recorded on Linux. Stella installed a small Python tag library (mutagen) for the job, and does the same on a Mac or Windows PC.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why do my MP3s show Unknown Artist?",
        a: "The files have no artist tag, or one your player can't read. File names alone don't count: players read the ID3 tags stored inside each file.",
      },
      {
        q: "How do I add album art to many MP3s at once?",
        a: "In Mp3tag select every file, right-click the cover box, Add cover, then save. In Music select them all, open Info, then Artwork. Stella embedded cover.jpg into all 12 files in one go.",
      },
      {
        q: "Will editing tags change how the songs sound?",
        a: "No. Tags live in a separate part of the file from the audio. In the recording every song's length was the same afterwards, and the file names stayed as they were.",
      },
      {
        q: "Can it convert the album to another format too?",
        a: "Yes, in the same chat. If the album is FLAC and your car won't play it, see [convert FLAC to MP3](/how/audio/convert-flac-to-mp3), which keeps the tags and art.",
      },
    ],
    related: ["audio/convert-flac-to-mp3", "pc-cleanup/organize-downloads-folder", "audio/transcribe-voice-memos-to-text", "audio/normalize-audio-volume"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Change song and CD info in Music on Mac", href: "https://support.apple.com/guide/music/mus1c6803257/mac" },
      { label: "Mp3tag documentation", href: "https://docs.mp3tag.de/" },
      { label: "MusicBrainz Picard", href: "https://picard.musicbrainz.org/" },
    ],
  },
  {
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
      "Convert a FLAC album to MP3 for the car without losing song names or the cover: fre:ac, XLD, ffmpeg, or Stella (stella.sh) on your own computer, FLACs kept.",
    h1: "Convert FLAC to MP3, keeping the song names and album art",
    short: "Convert FLAC to MP3",
    lede: "10 FLAC tracks as 320 kbps MP3s with names and cover kept, ready for a USB stick.",
    answer:
      "Use a converter that copies tags: fre:ac (free on Windows, Mac and Linux) or XLD on a Mac, set to MP3 at 256 or 320 kbps. Online converters often drop the art, so the car shows Track 01. From the command line, ffmpeg converts each file and keeps tags and cover. Stella (stella.sh) converts a whole album, keeps song names, track numbers and art, and leaves the FLACs alone.",
    stellaSteps: [
      "Finds the album in Music, “Marisol Vega - Coastline Sessions”: 10 FLAC files with tags and an embedded cover",
      "Converts each to a 320 kbps MP3, a format car stereos read reliably",
      "Copies title, artist, album, track number and year across, and embeds the album cover in every MP3",
      "Saves them in a new folder next to the album, “Marisol Vega - Coastline Sessions (MP3)”, ready to copy to a USB stick",
      "Leaves the FLAC files exactly as they were",
    ],
    prompt: "Convert my Marisol Vega FLAC album in Music to MP3 so it plays in my car. Keep the song names and album art.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "10 MP3s in about 1 minute 30 seconds. Checked afterwards against an answer key written before the run: one MP3 per FLAC at 320 kbps, song name, artist, album and track number matching the FLAC, the cover embedded in all 10, every track the same length as its FLAC (within 0.1 s), and the FLACs unchanged.",
      note: "The album is fictitious: instrumentals synthesised and tagged for this run. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/audio/convert-flac-to-mp3/proof.mp4`,
        cuts: webCuts("audio/convert-flac-to-mp3"),
        poster: `${PROOFS}/audio/convert-flac-to-mp3/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 50.7,
        realDuration: 87,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A 10-track FLAC album is in Music." },
        { at: 2, text: "The prompt: convert it to MP3 for the car, keeping the song names and album art." },
        { at: 18, text: "Stella replies: MP3 copies with names and art in a separate folder, FLACs untouched." },
        { at: 23.9, text: "Converting 10 tracks, sped up 3×." },
        { at: 36.7, text: "Done: all 10 tracks as MP3 with names, track numbers and cover, in a new folder ready for a USB stick." },
      ],
    },
    manualTitle: "Convert them yourself",
    manualSteps: [
      {
        title: "Windows, Mac or Linux: fre:ac",
        body: "Install the free fre:ac, add the FLAC files, choose the LAME MP3 encoder and set it to 256 or 320 kbps (constant bitrate is safest for older car stereos). Pick an output folder and start. It carries the tags and cover over.",
      },
      {
        title: "Mac: XLD",
        body: "XLD (X Lossless Decoder, free) converts FLAC on a Mac: in its preferences choose LAME MP3 as the output format, then drag the files onto it. The Music app can't open FLAC, so it can't do this conversion itself.",
      },
      {
        title: "Command line: ffmpeg",
        body: "With the free ffmpeg, `ffmpeg -i \"01 - Tidewater.flac\" -map 0 -c:a libmp3lame -b:a 320k -c:v copy -id3v2_version 3 \"01 - Tidewater.mp3\"` converts one track and keeps the tags and the embedded cover. Loop it over the folder for a whole album.",
      },
      {
        title: "Copy them to a USB stick for the car",
        body: "Many car stereos want the stick formatted FAT32, the MP3s no more than a couple of folders deep, and sometimes a limit on files per folder. Check the car's manual if a stick isn't recognised.",
      },
      {
        title: "Keep the FLACs",
        body: "MP3 is lossy, so converting back won't restore the quality. Keep the FLAC files as your masters and treat the MP3s as copies for the car or phone.",
      },
    ],
    limits: [
      "MP3 is lossy. At 320 kbps the difference is hard to hear, but the MP3s are smaller copies, not replacements for the FLACs.",
      "It doesn't format the USB stick or copy the files to it. Ask in the same chat with the stick plugged in if you want that too.",
      "Recorded on Linux, where ffmpeg was already installed. A Mac or Windows PC usually doesn't have it, so Stella would download it first, which wasn't recorded.",
      "File names and tags go to the AI model you use in Stella; the audio is converted on your computer and isn't uploaded to a converter site.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Does converting FLAC to MP3 lose quality?",
        a: "Yes, a little: MP3 discards detail to make files smaller. At 256 to 320 kbps most people can't hear it in a car. Keep the FLACs in case you want full quality later.",
      },
      {
        q: "Why does my car show Track 01 instead of song names?",
        a: "The converter didn't copy the tags, or wrote a tag version the stereo can't read. Use one that copies tags, and if names still don't appear, write ID3v2.3 tags (ffmpeg's `-id3v2_version 3`).",
      },
      {
        q: "What bitrate should I use for the car?",
        a: "320 kbps constant bitrate is the safe choice; 256 kbps is nearly as good and smaller. Some older stereos stumble on variable-bitrate MP3s.",
      },
      {
        q: "Can it fix tags on MP3s I already have?",
        a: "Yes. If your MP3s show Unknown Artist or have no cover, see [edit MP3 tags in bulk](/how/audio/edit-mp3-tags-in-bulk). Video files that won't play on a TV are covered in [convert MKV to MP4](/how/video/convert-mkv-to-mp4).",
      },
    ],
    related: ["audio/edit-mp3-tags-in-bulk", "video/convert-mkv-to-mp4", "audio/convert-m4a-to-mp3"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "fre:ac", href: "https://www.freac.org/" },
      { label: "XLD (X Lossless Decoder)", href: "https://tmkk.undo.jp/xld/index_e.html" },
      { label: "ffmpeg documentation", href: "https://ffmpeg.org/ffmpeg.html" },
    ],
  },
  {
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
      "Turn voice memos into readable text without uploading them: Voice Memos' transcripts, Word's Transcribe, or Stella (stella.sh) with a free local speech tool.",
    h1: "Transcribe voice memos to text",
    short: "Transcribe voice memos to text",
    lede: "Four voice memos as readable text, word for word, without the audio leaving the computer.",
    answer:
      "On a Mac with macOS 15 or an iPhone with iOS 18, Voice Memos shows a transcript for each memo that you can copy out, one at a time. Microsoft Word for the web can transcribe uploaded recordings with Microsoft 365. Online services like Otter work but upload the audio and cap free minutes. Stella (stella.sh) transcribed a folder of memos with a free speech tool it installed on the computer, so the audio wasn't sent to a transcription service.",
    stellaSteps: [
      "Finds the four voice memos in Downloads, including a two-minute lecture",
      "On the free plan, installs a free speech-recognition tool that runs on the computer itself (about 2 GB) instead of a paid transcription service",
      "Writes one text file per memo, named after it, in a new Voice memo transcripts folder",
      "Makes one page with every transcript and a one-line summary of each at the top, and lists what each memo says in the chat",
      "Says that names and place names are best guesses, and offers to keep the speech tool for next time or delete it",
    ],
    prompt: "Turn the voice memos in my Downloads into text I can read.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Four transcripts in about 3 minutes 50 seconds, including installing the speech tool. Checked afterwards against the scripts the memos were recorded from: three transcripts word for word (0% word error rate) and the fourth at 3.6%, with every key name and fact present, and the recordings unchanged.",
      note: "The memos were voiced from scripts written for this run, with a light room tone; the people and places are fictitious. Our check script needed a fix to run on Linux and was re-scored after the run, with the answer key unchanged. The work is sped up 15×.",
      video: {
        src: `${PROOFS}/audio/transcribe-voice-memos-to-text/proof.mp4`,
        cuts: webCuts("audio/transcribe-voice-memos-to-text"),
        poster: `${PROOFS}/audio/transcribe-voice-memos-to-text/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 50.6,
        realDuration: 230,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Four voice memos are in Downloads." },
        { at: 2, text: "The prompt: turn the voice memos into text I can read." },
        { at: 18, text: "Stella replies that the transcription will run on this computer, free but slower, with one transcript per memo plus a combined one." },
        { at: 23.8, text: "Installing a local speech tool and transcribing four memos, sped up 15×." },
        { at: 36.6, text: "Done: all four memos as text, a summary of what each says, and a note that name spellings are best guesses." },
      ],
    },
    manualTitle: "Transcribe them yourself",
    manualSteps: [
      {
        title: "Mac or iPhone: Voice Memos",
        body: "On macOS 15 or iOS 18 and later, open a memo in Voice Memos and click or tap the transcript button (a speech bubble) to see the text. Select it and copy it into Notes or a document. It works one memo at a time, in English and a few other languages.",
      },
      {
        title: "Windows or the web: Word's Transcribe",
        body: "With Microsoft 365, open Word for the web, choose Home, Dictate, Transcribe, then Upload audio. It returns a transcript with speakers marked that you can add to the document. The audio goes to Microsoft, and there's a monthly limit on uploaded minutes.",
      },
      {
        title: "Free and local: Whisper",
        body: "OpenAI's open-source Whisper model runs on your own computer through free apps and tools (whisper.cpp, faster-whisper, or desktop apps built on them). The bigger models are more accurate but download a gigabyte or more and run slowly without a good graphics card.",
      },
      {
        title: "Online services",
        body: "Otter, TurboScribe and similar sites are quick and add speaker labels, but they upload your recordings and cap the free minutes. Fine for a public lecture; think twice for private notes.",
      },
      {
        title: "Fix the names",
        body: "Speech recognition guesses at names, places and jargon. Skim each transcript for capitalised words and correct them; most tools let you add a vocabulary list or prompt to get them right next time.",
      },
    ],
    limits: [
      "Names and unusual words are best guesses. Stella said so; tell it the right spellings and it can correct them.",
      "The free local tool is slower than a hosted service and takes about 2 GB of disk space. Stella offered to delete it afterwards.",
      "The audio stayed on the computer, but the finished transcripts go to the AI model you use in Stella when it summarises them. Ask for transcripts only if you'd rather it didn't read them.",
      "The test memos were clear speech with light background noise. Noisy rooms, several people talking at once or strong accents will be less accurate. Labelling who is speaking wasn't part of this test.",
      "Recorded on Linux. On a Mac or Windows PC Stella installs a similar local tool, which wasn't recorded.",
    ],
    costNote:
      "Yes. In the recording the account was on Stella's free plan, so Stella installed a free speech tool on the computer and nothing was paid; it's just slower. Stella's own built-in transcription isn't part of the free plan.",
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can I transcribe voice memos for free?",
        a: "Yes. Voice Memos on macOS 15 and iOS 18 shows transcripts for free, one memo at a time. Whisper-based tools run free on your computer, and Stella used one for a whole folder.",
      },
      {
        q: "Does my audio get uploaded?",
        a: "Not in the recording: the speech tool ran on the computer. Word's Transcribe and online services do upload it. The text Stella then summarised does go to the AI model you use in Stella.",
      },
      {
        q: "How accurate is it?",
        a: "On these clear test memos, three came out word for word and the fourth at 96% of words right. Expect more mistakes on phone calls, noisy rooms and crosstalk.",
      },
      {
        q: "Can I transcribe a video or a long lecture?",
        a: "Yes, the same way; longer audio just takes longer locally. To put the words on a video as captions, see [burn subtitles into a video](/how/video/burn-subtitles-into-video-for-tiktok). For music files, see [edit MP3 tags in bulk](/how/audio/edit-mp3-tags-in-bulk).",
      },
    ],
    related: ["video/burn-subtitles-into-video-for-tiktok", "audio/edit-mp3-tags-in-bulk", "local-ai/run-ai-offline-on-your-computer", "video/make-srt-subtitle-file", "audio/trim-silence-from-recordings"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: View a transcript in Voice Memos on Mac", href: "https://support.apple.com/guide/voice-memos/vm4a03609f0d/mac" },
      { label: "Microsoft: Transcribe your recordings", href: "https://support.microsoft.com/en-us/office/transcribe-your-recordings-7fc2efec-245e-45f0-b053-2a97531ecf57" },
      { label: "OpenAI Whisper on GitHub", href: "https://github.com/openai/whisper" },
    ],
  },
  {
    slug: "convert-m4a-to-mp3",
    niche: "audio",
    searchPhrases: [
      "convert m4a to mp3",
      "m4a to mp3",
      "convert voice memo to mp3",
      "wav to mp3",
      "ogg to mp3",
    ],
    title: "Convert M4A to MP3 (and WAV or OGG), a whole folder at once",
    description:
      "Turn voice memos and recordings in M4A, WAV or OGG into real MP3s with the same names: the Music app, VLC, ffmpeg, or Stella (stella.sh) on your own computer.",
    h1: "Convert M4A to MP3, keeping the same names",
    short: "Convert M4A to MP3",
    lede: "Nine recordings in three formats as MP3s with the same names, originals kept.",
    answer:
      "On a Mac, set the Music app's import format to MP3 Encoder, then select the recordings and choose File, Convert, Create MP3 Version. On Windows, VLC's Convert/Save turns files into MP3 one batch at a time. Renaming .m4a to .mp3 doesn't work: the file inside stays M4A and many car stereos refuse it. Stella (stella.sh) converted a folder of M4A, WAV and OGG recordings into real MP3s with the same names.",
    stellaSteps: [
      "Finds the Voice memos folder in Documents: 5 M4A recordings, 3 WAV files, 1 OGG voice note from a chat app, and a text note",
      "Reads each recording's format and length first",
      "Converts each one to a real MP3 at 192 kbps, a setting car stereos play reliably, named exactly like the recording (apostrophes included)",
      "Saves the MP3s next to the originals without overwriting anything, and skips the text note because it isn't a recording",
      "Reports that all 9 converted, each as long as its original, with the originals left alone",
    ],
    prompt:
      "My car only plays MP3s. Convert all the recordings in the Voice memos folder in my Documents to MP3, keeping the same names.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "9 MP3s in about 1 minute 5 seconds. Checked afterwards against an answer key written before the run: one MP3 per recording with the same name, really MP3 inside (not a renamed file), at least 64 kbps, each the same length as its original within 0.3 s with the same sound, and all 9 originals unchanged.",
      note: "The recordings are synthetic speech made for this run; the names and contents are fictitious. The recording plays at normal speed, with only the waiting at the start and end cut.",
      video: {
        src: `${PROOFS}/audio/convert-m4a-to-mp3/proof.mp4`,
        cuts: webCuts("audio/convert-m4a-to-mp3"),
        poster: `${PROOFS}/audio/convert-m4a-to-mp3/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 48.43,
        realDuration: 66,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. The Voice memos folder in Documents holds M4A, WAV and OGG recordings." },
        { at: 1.67, text: "The prompt: convert all the recordings to MP3 for the car, keeping the same names." },
        { at: 13.67, text: "Stella replies that each MP3 keeps its name and goes next to the original, with nothing deleted." },
        { at: 18.67, text: "Converting nine recordings." },
        { at: 33.67, text: "Done: all 9 are MP3s with the same names and lengths; the text note in the folder was skipped." },
      ],
    },
    manualTitle: "Convert them yourself",
    manualSteps: [
      {
        title: "Mac: the Music app",
        body: "In Music, open Settings, Files, Import Settings and choose MP3 Encoder. Add the recordings to your library, select them, then File, Convert, Create MP3 Version. The MP3s land in your Music library folder; drag them out to wherever you need them. Music can't open .ogg voice notes.",
      },
      {
        title: "Windows: VLC",
        body: "In the free VLC, choose Media, Convert / Save, add the files, press Convert / Save and pick the profile Audio - MP3. Give each output its own name, or VLC writes them all to the same file name.",
      },
      {
        title: "Any computer: ffmpeg",
        body: "With the free ffmpeg, `ffmpeg -i \"Choir warm-up.m4a\" -c:a libmp3lame -b:a 192k \"Choir warm-up.mp3\"` converts one file. In a terminal, loop it over the folder to do every .m4a, .wav and .ogg in one go.",
      },
      {
        title: "Don't just rename the files",
        body: "Changing the extension from .m4a to .mp3 leaves the audio as AAC inside. Some players cope, but most car stereos and older devices check what's really in the file and skip it.",
      },
      {
        title: "Put them on a USB stick",
        body: "Many car stereos only read sticks formatted FAT32, and some want the files in a folder no more than a level or two deep. If the car shows nothing, check its manual for the formats and folder layout it supports.",
      },
    ],
    limits: [
      "MP3 is lossy. For speech at 192 kbps you won't hear a difference, but keep the originals if they matter.",
      "It made the files; it didn't format a USB stick or copy them onto one. Ask in the same chat with the stick plugged in if you want that too.",
      "File names, folder contents and each file's format details go to the AI model you use in Stella. The audio itself is converted on your computer and isn't uploaded anywhere.",
      "Recorded on Linux, where ffmpeg was already installed. A Mac or Windows PC usually doesn't have it, so Stella would download it first, which this recording doesn't show.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can I convert a voice memo to MP3 on iPhone?",
        a: "Not in the Voice Memos app itself; it shares M4A. Send the memo to a Mac or PC and convert it there, or share it to a file converter app. On a computer, Stella converts a whole folder of memos at once.",
      },
      {
        q: "Does converting M4A to MP3 lose quality?",
        a: "A little, since both are compressed formats and converting compresses again. At 192 kbps for speech, or 256 to 320 kbps for music, it's very hard to hear.",
      },
      {
        q: "What about WhatsApp voice notes (.ogg or .opus)?",
        a: "They use the Opus codec, which the Music app can't read. VLC and ffmpeg can. The test folder had one, and Stella converted it with the rest.",
      },
      {
        q: "My MP3s have no song names in the car. Can it fix that?",
        a: "Yes. See [edit MP3 tags in bulk](/how/audio/edit-mp3-tags-in-bulk). If you're converting a FLAC album rather than recordings, [convert FLAC to MP3](/how/audio/convert-flac-to-mp3) keeps the tags and cover.",
      },
    ],
    related: ["audio/convert-flac-to-mp3", "audio/extract-audio-from-video", "audio/merge-mp3-files", "audio/convert-wma-to-mp3"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Convert a song to a different file format in Music", href: "https://support.apple.com/en-us/108961" },
      { label: "Apple: Convert an M4A file to MP3 on Mac", href: "https://support.apple.com/en-us/120493" },
      { label: "VLC media player", href: "https://www.videolan.org/vlc/" },
    ],
  },
  {
    slug: "extract-audio-from-video",
    niche: "audio",
    searchPhrases: [
      "extract audio from video",
      "convert video to mp3",
      "mp4 to mp3",
      "extract audio from mp4",
      "video to mp3",
    ],
    title: "Extract audio from a video as MP3, a whole folder at once",
    description:
      "Get the sound out of MP4 videos as MP3s to listen on a walk: QuickTime plus Music on a Mac, VLC on Windows, ffmpeg, or Stella (stella.sh) on your own computer.",
    h1: "Extract the audio from videos as MP3",
    short: "Extract audio from video",
    lede: "Four class recordings as MP3s in order, and a note about the one with no sound.",
    answer:
      "On a Mac, QuickTime Player's File, Export As, Audio Only saves the sound as M4A, which the Music app can then convert to MP3. On Windows, VLC's Convert/Save with the Audio - MP3 profile does it directly. ffmpeg handles a whole folder from the command line. Stella (stella.sh) pulled MP3s out of a folder of class videos, numbered in order, and reported the one video that had no sound instead of making an empty file.",
    stellaSteps: [
      "Finds the Local history evening class folder in Videos: five weekly recordings",
      "Checks each video for a sound track first, and finds that Week 4 (Archive photos) has none",
      "Saves the sound of the other four as MP3s in a new folder next to the videos, named with the week number so they play in order",
      "Doesn't make an empty file for Week 4, and says why it has no MP3",
      "Points out the recordings are only 15 to 20 seconds each, so they look like clips rather than full classes, and leaves the videos unchanged",
    ],
    prompt:
      "Get the audio out of my local history evening class videos in Videos as MP3s, so I can listen to them while I walk the dog.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "4 MP3s in about 1 minute 5 seconds. Checked afterwards against an answer key written before the run: one real MP3 for each of the 4 videos with sound, each the full length of its video (within 0.35 s) with the matching talk inside, no silent MP3 for the video without sound, and every video unchanged.",
      note: "The class videos are slides with synthetic narration, made for this run and kept short; the classes and places are fictitious. The work is sped up 2×.",
      video: {
        src: `${PROOFS}/audio/extract-audio-from-video/proof.mp4`,
        cuts: webCuts("audio/extract-audio-from-video"),
        poster: `${PROOFS}/audio/extract-audio-from-video/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 43.73,
        realDuration: 64,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Five class videos are in a folder in Videos." },
        { at: 1.63, text: "The prompt: get the audio out as MP3s to listen to on a walk." },
        { at: 13.63, text: "Stella replies that the MP3s go in one folder, named so the classes stay in order, with the videos untouched." },
        { at: 19.63, text: "Checking each video for sound and saving the MP3s." },
        { at: 28.9, text: "Done: 4 MP3s by week number; Week 4 has no sound, so it has no MP3." },
      ],
    },
    manualTitle: "Extract it yourself",
    manualSteps: [
      {
        title: "Mac: QuickTime Player, then Music",
        body: "Open the video in QuickTime Player and choose File, Export As, Audio Only. That saves an .m4a. If you need MP3, set Music's import format to MP3 Encoder (Settings, Files, Import Settings), add the .m4a and choose File, Convert, Create MP3 Version.",
      },
      {
        title: "Windows: VLC",
        body: "In VLC choose Media, Convert / Save, add the videos and press Convert / Save. Pick the profile Audio - MP3, choose a destination file name for each one, then Start.",
      },
      {
        title: "Any computer: ffmpeg",
        body: "`ffmpeg -i \"Week 1 - The old mill.mp4\" -vn -c:a libmp3lame -q:a 2 \"Week 1 - The old mill.mp3\"` drops the picture and saves the sound as MP3. `-vn` means no video; repeat it for each file or loop over the folder.",
      },
      {
        title: "Check for videos with no sound",
        body: "Slideshows and screen recordings sometimes have no sound track at all. VLC's Tools, Codec Information lists the streams; if there's no audio stream, there's nothing to extract, and a converter may still write a silent file.",
      },
      {
        title: "Keep them in order",
        body: "Start each file name with a number padded to two digits (01, 02 … 10), so phones and podcast apps play them in the right order instead of putting 10 before 2.",
      },
    ],
    limits: [
      "A video with no sound has nothing to extract. Stella said so for Week 4 rather than making a silent MP3.",
      "MP3 re-encodes the sound. For the original quality, ask for M4A instead (most phone videos already carry AAC sound, which can be copied out as-is).",
      "File names and each video's stream details go to the AI model you use in Stella; the videos and their sound stay on your computer.",
      "Recorded on Linux, where ffmpeg was already installed. On a Mac or Windows PC Stella would usually download it first, which isn't shown here.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I extract audio from a video on iPhone?",
        a: "The Files and Photos apps don't do it directly. Send the video to a Mac and use QuickTime's Export As, Audio Only, or have Stella do a whole folder on your computer.",
      },
      {
        q: "Is MP4 to MP3 lossless?",
        a: "No, MP3 is a fresh encode. For speech at a good bitrate you won't notice. To keep the exact original sound, save it as .m4a without re-encoding.",
      },
      {
        q: "What if a video has several audio tracks?",
        a: "Some recordings carry two languages or a commentary. Say which one you want; this test only had one track per video.",
      },
      {
        q: "Can I get the words as text instead?",
        a: "Yes. See [transcribe voice memos to text](/how/audio/transcribe-voice-memos-to-text), or [make an SRT subtitle file](/how/video/make-srt-subtitle-file) for captions that sit next to the video.",
      },
    ],
    related: ["audio/convert-m4a-to-mp3", "audio/transcribe-voice-memos-to-text", "video/make-srt-subtitle-file"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Export movies in QuickTime Player on Mac", href: "https://support.apple.com/guide/quicktime-player/qtp20e395859/mac" },
      { label: "Apple: Convert a song to a different file format in Music", href: "https://support.apple.com/en-us/108961" },
      { label: "VLC media player", href: "https://www.videolan.org/vlc/" },
    ],
  },
  {
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
      "Join chapter MP3s into one .m4b audiobook with named chapters, cover and author, so the app remembers your place: ffmpeg, paid apps, or Stella (stella.sh).",
    h1: "Combine MP3 chapters into one audiobook with chapters",
    short: "Make an audiobook with chapters",
    lede: "Eight chapter MP3s as one .m4b with real chapter names, cover and author.",
    answer:
      "An audiobook app shows chapters and remembers your place when the book is one .m4b file with chapter marks. Neither Mac nor Windows has a free built-in tool for it: people use paid apps like Audiobook Builder, or ffmpeg with a chapter list. Stella (stella.sh) joined eight chapter MP3s into one .m4b, named each chapter from its tags, and kept the cover, title and author.",
    stellaSteps: [
      "Finds the book's folder in Downloads: 8 chapter MP3s, each tagged with its chapter title, the book and the author, plus a cover.jpg",
      "Measures each chapter's exact length so every chapter mark lands where that chapter starts",
      "Joins them in order into one AAC audiobook, The Lantern Keeper of Gull Point.m4b, with chapters named from the tags (“The Letter” through “Home”)",
      "Adds the book title, author and cover, then plays the whole file through to check it decodes without errors",
      "Leaves the chapter MP3s as they were, and notes the book is only 1 minute 43 seconds long, so it may be a sample",
    ],
    prompt:
      "I've got an audiobook as separate chapter MP3s in my Downloads. Turn it into one audiobook file with chapters, so my audiobook app shows each chapter and remembers my place.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "One .m4b in about 1 minute 20 seconds. Checked afterwards against an answer key written before the run: 8 chapters, each starting within a second of where its chapter begins, carrying its real name and in the right order, the whole book's length, the title, author and cover tagged, and the chapter MP3s unchanged.",
      note: "The book, author and narration are fictitious, made for this run with synthetic speech, and each chapter is about 13 seconds. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/audio/make-audiobook-with-chapters/proof.mp4`,
        cuts: webCuts("audio/make-audiobook-with-chapters"),
        poster: `${PROOFS}/audio/make-audiobook-with-chapters/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 40.57,
        realDuration: 78,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. An audiobook's eight chapter MP3s and its cover are in Downloads." },
        { at: 1.63, text: "The prompt: one audiobook file with chapters, so the app shows them and remembers my place." },
        { at: 9.63, text: "Stella replies it will make an .m4b with each chapter marked and named, keeping the cover and details." },
        { at: 15.63, text: "Measuring the chapters and joining them." },
        { at: 26.57, text: "Done: one .m4b with chapters from “The Letter” to “Home”, cover, title and author." },
      ],
    },
    manualTitle: "Build it yourself",
    manualSteps: [
      {
        title: "Write a chapter list",
        body: "Note each chapter's length (any player shows it). Chapter 1 starts at 0:00, chapter 2 at chapter 1's length, chapter 3 at the sum of the first two, and so on. A spreadsheet makes the running total easy.",
      },
      {
        title: "Join and mark them with ffmpeg",
        body: "Make a text file listing the MP3s in order (`file '01 - Chapter 1 - The Letter.mp3'` per line) and an FFMETADATA file with one `[CHAPTER]` block per chapter giving its start, end and title. Then run `ffmpeg -f concat -safe 0 -i list.txt -i chapters.txt -map_metadata 1 -c:a aac -b:a 96k book.m4b`.",
      },
      {
        title: "Add the cover",
        body: "Add `-i cover.jpg -map 0:a -map 2:v -c:v copy -disposition:v attached_pic` to the same command, or drop the cover onto the finished .m4b in a tag editor such as the free Mp3tag.",
      },
      {
        title: "Mac: a dedicated app",
        body: "Apple Books plays .m4b with chapters, but macOS has no free tool to make one. Paid apps such as Audiobook Builder take the MP3s, read chapter names from the files and export an .m4b.",
      },
      {
        title: "Load it into your app",
        body: "On iPhone, drag the .m4b into Books through Finder (Mac) or the Apple Devices app (Windows). On Android, copy it to the phone and open it in an audiobook app that reads M4B chapters, such as Smart AudioBook Player or Voice.",
      },
    ],
    limits: [
      "The MP3s are re-encoded once to AAC, the format .m4b uses. For speech you won't hear it, but the chapter MP3s stay as your originals.",
      "Only for audiobooks you own without copy protection. Files from Audible or other stores with DRM can't be joined this way.",
      "File names, tags and lengths go to the AI model you use in Stella so it can name and order the chapters; the audio stays on your computer.",
      "Recorded on Linux with ffmpeg already installed. On a Mac or Windows PC Stella would usually download ffmpeg first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What is an M4B file?",
        a: "An M4A audio file (AAC sound in an MP4 container) marked as an audiobook. Apps treat it as one book with chapters and remember where you stopped.",
      },
      {
        q: "Will my audiobook app show the chapter names?",
        a: "Yes, if the chapters carry titles. Stella took them from each MP3's tags, so the chapters read “The Letter”, “The Crossing” and so on rather than Chapter 1, 2, 3.",
      },
      {
        q: "Can I just join the MP3s into one MP3?",
        a: "You can, and it plays straight through, but you lose chapters and most apps won't keep your place reliably. For lessons or a playlist, see [merge MP3 files](/how/audio/merge-mp3-files).",
      },
      {
        q: "How big is the file?",
        a: "At 64 to 96 kbps, about 30 to 45 MB per hour of speech, smaller than most MP3 audiobooks.",
      },
    ],
    related: ["audio/merge-mp3-files", "audio/edit-mp3-tags-in-bulk", "audio/split-audio-into-tracks"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "FFmpeg formats: metadata and chapters (FFMETADATA)", href: "https://ffmpeg.org/ffmpeg-formats.html#Metadata-2" },
      { label: "Mp3tag, free tag editor", href: "https://www.mp3tag.de/en/" },
    ],
  },
  {
    slug: "make-ringtone",
    niche: "audio",
    searchPhrases: [
      "make a ringtone for iphone",
      "custom ringtone iphone",
      "make ringtone from song",
      "ringtone maker",
      "m4r",
    ],
    title: "Make an iPhone ringtone from a song, starting at the chorus",
    description:
      "Cut a song into an iPhone .m4r ringtone that starts where you want, under 40 seconds and faded out: GarageBand on the phone, or Stella (stella.sh) on your computer.",
    h1: "Make an iPhone ringtone from a song",
    short: "Make an iPhone ringtone",
    lede: "A 30-second .m4r from 1:05 with a fade-out, ready to drag onto an iPhone.",
    answer:
      "On the iPhone itself, GarageBand can trim a song and share it as a ringtone (30 seconds at most). From a computer, an iPhone ringtone is a short AAC file named .m4r, up to 40 seconds, synced with Finder on a Mac or the Apple Devices app on Windows. Stella (stella.sh) cut a song to a 30-second .m4r starting exactly at 1:05 with a fade at the end, and said how to get it onto the phone.",
    stellaSteps: [
      "Finds “Juniper Lane - Lanterns” in Music",
      "Cuts 30 seconds starting at exactly 1:05, the time you gave, so it stays under the iPhone's 40-second limit",
      "Adds a 3-second fade-out so it doesn't stop mid-note",
      "Saves it as AAC in the iPhone ringtone format, Juniper Lane - Lanterns (Ringtone).m4r, next to the song, which it leaves unchanged",
      "Says that nobody listened to confirm the chorus starts there, and explains how to put it on an iPhone with Finder, iTunes or GarageBand",
    ],
    prompt: "Make an iPhone ringtone from 'Lanterns' in my Music folder, starting where the chorus comes in at 1:05.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "A ringtone in about 1 minute. Checked afterwards against an answer key written before the run: an .m4r that is really AAC in the MP4 format iPhones use, 30 seconds long, starting at 1:05 of the song (matched against the song's audio), fading out at the end, and the song unchanged.",
      note: "The song is fictitious, synthesised for this run with a quiet verse and a louder chorus from 1:05. The work is sped up 2×.",
      video: {
        src: `${PROOFS}/audio/make-ringtone/proof.mp4`,
        cuts: webCuts("audio/make-ringtone"),
        poster: `${PROOFS}/audio/make-ringtone/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 41.13,
        realDuration: 62,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. The song Lanterns is in Music." },
        { at: 1.63, text: "The prompt: an iPhone ringtone starting where the chorus comes in at 1:05." },
        { at: 9.63, text: "Stella replies: from 1:05, about 30 seconds to stay under the 40-second limit, with a fade-out." },
        { at: 15.63, text: "Cutting and saving the ringtone." },
        { at: 26.53, text: "Done: a 30-second .m4r from 1:05 to 1:35, with how to put it on the iPhone." },
      ],
    },
    manualTitle: "Make it yourself",
    manualSteps: [
      {
        title: "On the iPhone: GarageBand",
        body: "Import the song into a GarageBand project (Loop browser, Files), drag it to the start, trim it so the part you want begins at 0:00 and lasts 30 seconds or less, then go to My Songs, press and hold the project, Share, Ringtone. GarageBand can't open songs bought with copy protection.",
      },
      {
        title: "On a computer: cut and convert",
        body: "With ffmpeg, `ffmpeg -ss 65 -t 30 -i \"Lanterns.mp3\" -af afade=t=out:st=27:d=3 -c:a aac -b:a 256k -f ipod \"Lanterns.m4r\"` takes 30 seconds from 1:05, fades the last 3 and writes an iPhone ringtone. Audacity can do the cut and fade, then export M4A that you rename to .m4r.",
      },
      {
        title: "Mac: sync it with Finder",
        body: "Connect the iPhone, select it in the Finder sidebar, and drag the .m4r onto the General tab. It appears under Settings, Sounds & Haptics, Ringtone.",
      },
      {
        title: "Windows: Apple Devices or iTunes",
        body: "Connect the iPhone, open the Apple Devices app (or iTunes on older Windows), select the phone and drag the .m4r into its Tones section.",
      },
      {
        title: "Android is simpler",
        body: "Android plays MP3 ringtones. Copy the cut MP3 into the phone's Ringtones folder, then pick it in Settings, Sound, Phone ringtone.",
      },
    ],
    limits: [
      "Stella makes the file; it can't reach your phone. Putting it on the iPhone needs Finder, the Apple Devices app or GarageBand, as above.",
      "It cut at the time you gave and didn't listen for the chorus. If the start is a little off, say how much to move it.",
      "Only use songs you own. Copy-protected tracks can't be cut.",
      "The song's name and tags go to the AI model you use in Stella; the audio is cut on your computer. Recorded on Linux with ffmpeg already there; on Mac or Windows Stella would usually download ffmpeg first.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How long can an iPhone ringtone be?",
        a: "Up to 40 seconds for ringtones synced from a computer; GarageBand on the phone limits you to 30. Text tones should be much shorter.",
      },
      {
        q: "Can I make a ringtone without a computer?",
        a: "Yes, with GarageBand on the iPhone, as above. It takes more taps, and you trim by dragging rather than typing a time.",
      },
      {
        q: "What is an .m4r file?",
        a: "AAC audio in an MP4 container, the same as .m4a, with an extension iPhones recognise as a ringtone. Renaming an MP3 to .m4r doesn't work.",
      },
      {
        q: "Can it change the song in other ways?",
        a: "Yes: [make the volume even](/how/audio/normalize-audio-volume) across a playlist, or [change the key of a song](/how/audio/change-key-of-song) to sing along.",
      },
    ],
    related: ["audio/convert-m4a-to-mp3", "audio/normalize-audio-volume", "video/make-gif-from-video"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: Create a custom ringtone on iPhone with GarageBand", href: "https://support.apple.com/en-us/120692" },
      { label: "ffmpeg documentation", href: "https://ffmpeg.org/ffmpeg.html" },
    ],
  },
  {
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
      "Join numbered MP3 lessons into one file that plays straight through, with lesson 10 after 9 and no glitches: Audacity, ffmpeg, or Stella (stella.sh) on your computer.",
    h1: "Merge MP3 files into one, in the right order",
    short: "Merge MP3 files",
    lede: "Twelve lessons as one MP3 in lesson order, 1 to 12, with no skips.",
    answer:
      "In the free Audacity, import the files, line them up end to end and export one MP3. From a command line, ffmpeg's concat joins them. Watch the order: sorted by name, Lesson 10 lands before Lesson 2, and files recorded at different settings can glitch when glued together without re-encoding. Stella (stella.sh) joined twelve lessons in true lesson order and evened out the two different recording formats.",
    stellaSteps: [
      "Finds the Spanish for travellers folder in Downloads: 12 lesson MP3s with jumbled file dates",
      "Orders them by the lesson number in each name, so lessons 10 to 12 come after 9, not after 1",
      "Notices lessons 10 to 12 were recorded at lower quality (mono, a lower sample rate) than the rest",
      "Converts them all to one format as it joins them, so the file doesn't skip or change speed at lesson 10, and saves Spanish for travellers - Lessons 1-12 (complete).mp3 in the same folder",
      "Plays the result through to check for errors, leaves the lesson files alone, and notes they're short samples, 8 to 11 seconds each",
    ],
    prompt:
      "Join the 12 lesson files in the 'Spanish for travellers' folder in my Downloads into one MP3 I can play straight through, in lesson order.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "One MP3 in about 1 minute 10 seconds. Checked afterwards against an answer key written before the run: a real MP3 as long as all 12 lessons together, decoding without errors, every lesson found inside by its sound and in order 1 to 12, and the lesson files unchanged.",
      note: "The lessons are synthetic speech made for this run; three were saved at a lower quality on purpose, and the file dates were scrambled so sorting by date wouldn't work either. The work is sped up 2×.",
      video: {
        src: `${PROOFS}/audio/merge-mp3-files/proof.mp4`,
        cuts: webCuts("audio/merge-mp3-files"),
        poster: `${PROOFS}/audio/merge-mp3-files/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 39.93,
        realDuration: 68,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Twelve lesson MP3s are in a folder in Downloads." },
        { at: 1.63, text: "The prompt: join them into one MP3 in lesson order." },
        { at: 9.63, text: "Stella replies it will order by the lesson numbers, not alphabetically, so lesson 10 won't come before 2." },
        { at: 15.63, text: "Ordering and joining the lessons." },
        { at: 25.73, text: "Done: one MP3 from lesson 1 to 12; lessons 10 to 12 were converted to match the rest." },
      ],
    },
    manualTitle: "Join them yourself",
    manualSteps: [
      {
        title: "Rename for the right order first",
        body: "If files are named Lesson 1 … Lesson 12, many tools sort them 1, 10, 11, 12, 2. Rename the first nine to Lesson 01 … Lesson 09 so every tool sees the true order. A bulk renamer, or Stella, does this in one go.",
      },
      {
        title: "Audacity (Windows, Mac, Linux)",
        body: "Choose File, Import, Audio and add the files. Check they're in order top to bottom, select all, then Tracks, Align Tracks, Align End to End. Export with File, Export Audio, MP3. Audacity resamples everything to the project rate, so mixed formats join cleanly.",
      },
      {
        title: "ffmpeg",
        body: "Make list.txt with one `file 'Lesson 01 - Greetings.mp3'` line per lesson in order, then run `ffmpeg -f concat -safe 0 -i list.txt -ar 44100 -ac 2 -c:a libmp3lame -q:a 2 all.mp3`. Re-encoding like this, rather than `-c copy`, avoids glitches where the formats change.",
      },
      {
        title: "Avoid the copy /b trick",
        body: "On Windows, `copy /b 1.mp3+2.mp3 all.mp3` glues files together byte by byte. It often plays, but the length shown is wrong, seeking jumps, and tags from every file end up inside. Fine in a pinch, not for something you'll keep.",
      },
      {
        title: "Listen to the joins",
        body: "Skip to each place one lesson ends and the next begins. A click, a jump in speed or a gap means the files had different formats and need re-encoding to one.",
      },
    ],
    limits: [
      "Joining re-encodes the MP3s once. For spoken lessons you won't hear it; the lesson files stay as they were.",
      "It ordered the lessons by the numbers in their names. If your files have no numbers, say what order you want.",
      "File names, lengths and format details go to the AI model you use in Stella; the audio is joined on your computer.",
      "Recorded on Linux with ffmpeg already installed. On a Mac or Windows PC Stella would usually download ffmpeg first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can I merge MP3 files without losing quality?",
        a: "Only when every file has the same format, using ffmpeg's `-c copy`. If they differ, as lessons 10 to 12 did here, re-encoding once at a good bitrate is the reliable way.",
      },
      {
        q: "Why is lesson 10 playing after lesson 1?",
        a: "Alphabetical sorting compares character by character, so “10” comes before “2”. Pad the numbers (01, 02 …) or use a tool that reads them as numbers.",
      },
      {
        q: "Can it add chapters so I can skip between lessons?",
        a: "Yes, as an audiobook file. See [make an audiobook with chapters](/how/audio/make-audiobook-with-chapters).",
      },
      {
        q: "Can I do the opposite and split one long file?",
        a: "Yes: [split audio into tracks](/how/audio/split-audio-into-tracks) cuts a recording at the quiet gaps.",
      },
    ],
    related: ["audio/make-audiobook-with-chapters", "audio/split-audio-into-tracks", "video/combine-videos-into-one"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Audacity manual: Align Tracks", href: "https://manual.audacityteam.org/man/tracks_menu_align_tracks.html" },
      { label: "FFmpeg: concat demuxer", href: "https://ffmpeg.org/ffmpeg-formats.html#concat-1" },
    ],
  },
  {
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
      "Even out a playlist where some songs are quiet and one is too loud, without distortion: Audacity's Loudness Normalization, ffmpeg, or Stella (stella.sh).",
    h1: "Make all your songs the same volume",
    short: "Make songs the same volume",
    lede: "Ten songs evened out to one loudness, the quiet one boosted without distorting.",
    answer:
      "Match loudness, not peaks. Audacity's Loudness Normalization (set to about −14 to −16 LUFS) evens songs out by how loud they sound; its plain Normalize only lines up the highest peaks. A quiet song with sharp peaks needs a limiter, or boosting it distorts. Stella (stella.sh) evened out a ten-song party mix to the same loudness, kept a backup of the originals, and turned down a quiet song's drum hits slightly so they wouldn't clip.",
    stellaSteps: [
      "Finds the Party mix folder in Music and measures each song's loudness: from very quiet to one far too loud",
      "Finds that the quietest song, Glasshouse, has sharp drum peaks that would distort if simply turned up",
      "Copies every original into Party mix (originals before loudness fix) before changing anything",
      "Brings the nine songs that needed it to one loudness, using a limiter on the quiet one, saves them at high quality and keeps titles and artists; leaves Saltwater Radio, already at the right level, alone",
      "Says which songs changed and how, and how to put the originals back",
    ],
    prompt:
      "The songs in my Party mix folder in Music are all different volumes. Some are really quiet and one is way too loud. Make them all the same loudness.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Ten songs evened out in about 1 minute 50 seconds. Checked afterwards against an answer key written before the run: all 10 within 2 LU of each other (they ended within 0.1 LU, from a 19.8 LU spread), at a normal listening level of −16 LUFS, no clipping, every song the same length with the same music, and titles and artists kept.",
      note: "The ten songs are fictitious, synthesised for this run at deliberately different loudness. Our check script was fixed after the run to count files that kept their original dates, and re-scored; the answer key didn't change. The work is sped up 5×.",
      video: {
        src: `${PROOFS}/audio/normalize-audio-volume/proof.mp4`,
        cuts: webCuts("audio/normalize-audio-volume"),
        poster: `${PROOFS}/audio/normalize-audio-volume/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 43.47,
        realDuration: 110,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A Party mix folder in Music has ten songs at very different volumes." },
        { at: 1.63, text: "The prompt: make them all the same loudness." },
        { at: 10.63, text: "Stella replies it's evening out the volume and keeping the originals." },
        { at: 16.63, text: "Measuring loudness, backing up the originals and adjusting nine songs." },
        { at: 28.97, text: "Done: all ten at one volume; Glasshouse's drum hits eased slightly to avoid distortion; originals in a backup folder." },
      ],
    },
    manualTitle: "Even them out yourself",
    manualSteps: [
      {
        title: "Audacity: Loudness Normalization",
        body: "Open a song, select all, choose Effect, Volume and Compression, Loudness Normalization, and set perceived loudness to −14 or −16 LUFS. Export it, then repeat for each song, or record the steps as a macro (Tools, Macro Manager) and apply it to the folder.",
      },
      {
        title: "Use a limiter on quiet songs with sharp peaks",
        body: "If a boosted song crackles on loud hits, undo, then run Effect, Volume and Compression, Limiter (limit to −1 dB) before normalizing. That shaves the peaks so the rest can come up without clipping.",
      },
      {
        title: "ffmpeg",
        body: "`ffmpeg -i in.mp3 -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:a libmp3lame -q:a 0 out.mp3` sets one song to −16 LUFS with a true-peak ceiling. Run it for each file; the two-pass form, measuring first, is more accurate.",
      },
      {
        title: "Keep a copy first",
        body: "Normalizing rewrites the audio. Copy the folder before you start, so you can go back if a song sounds worse.",
      },
      {
        title: "Or let the player do it",
        body: "Apple Music's Sound Check and Spotify's volume normalisation even out playback without touching files, but only inside that app. For a USB stick, a party speaker or a DJ set, the files themselves need fixing.",
      },
    ],
    limits: [
      "The songs are rewritten. Stella kept the originals in a backup folder, which it said how to restore from; delete it once you're happy.",
      "The quietest, peakiest song had its loudest hits turned down a little to avoid distortion, so they may sound slightly less punchy.",
      "File names, tags and loudness measurements go to the AI model you use in Stella; the songs are processed on your computer.",
      "Recorded on Linux with ffmpeg already installed. On a Mac or Windows PC Stella would usually download ffmpeg first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What's the difference between normalize and loudness normalize?",
        a: "Peak normalizing makes each song's single loudest moment the same, which doesn't make them sound equally loud. Loudness normalizing matches how loud they sound overall (in LUFS), which is what you want for a playlist.",
      },
      {
        q: "What loudness should I use?",
        a: "Around −14 LUFS matches most streaming services; −16 LUFS leaves a little more headroom. The run used −16, and every song landed within 0.1 of it.",
      },
      {
        q: "Is MP3Gain still a good option?",
        a: "It works by changing a gain value inside MP3s without re-encoding, which is clever, but it's old, Windows-focused, and doesn't limit peaks. Loudness normalization with a limiter handles quiet, peaky songs better.",
      },
      {
        q: "Can it fix song names and covers too?",
        a: "Yes, in the same chat: see [edit MP3 tags in bulk](/how/audio/edit-mp3-tags-in-bulk). To merge the mix into one file, see [merge MP3 files](/how/audio/merge-mp3-files).",
      },
    ],
    related: ["audio/edit-mp3-tags-in-bulk", "audio/merge-mp3-files", "audio/make-ringtone", "video/make-video-louder"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Audacity manual: Loudness Normalization", href: "https://manual.audacityteam.org/man/loudness_normalization.html" },
      { label: "FFmpeg filters: loudnorm", href: "https://ffmpeg.org/ffmpeg-filters.html#loudnorm" },
    ],
  },
  {
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
      "Cut a long recording, like a band rehearsal, into one file per song at the silences, without splitting quiet passages: Audacity, ffmpeg, or Stella (stella.sh).",
    h1: "Split an audio file into parts, one per song",
    short: "Split audio into tracks",
    lede: "A 7-minute rehearsal as seven song files, cut at the gaps and not mid-song.",
    answer:
      "Audacity's Label Sounds finds the quiet gaps in a long recording; Export Multiple then saves one file per label. The fiddly part is the threshold: too sensitive and a soft passage inside a song becomes a split. Stella (stella.sh) measured the gaps in a band rehearsal, cut it into seven songs without re-encoding, and kept a song with a quiet middle section in one piece.",
    stellaSteps: [
      "Finds the rehearsal recording in Music: one 7-minute file",
      "Measures the quiet stretches at several thresholds to tell the gaps between songs apart from quiet moments inside them",
      "Notices a soft passage in the fourth song and leaves it as one song, since it's much louder than the real gaps",
      "Cuts the file into seven songs in a new folder, Rehearsal at the Anchor - songs, without re-encoding, so the quality is the same",
      "Lists each song's length, names them Song 01 to Song 07 because the recording has no titles, and offers to rename them from a setlist",
    ],
    prompt:
      "I recorded my band's rehearsal as one long file in my Music folder. There are a few seconds of quiet between songs. Split it into a separate file for each song.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Seven song files in about 1 minute 30 seconds. Checked afterwards against an answer key written before the run: 7 files, each one whole song in set order (none cut inside a song, including the one with a soft middle), each the song's length plus at most the silence around it, and the full recording unchanged.",
      note: "The band and songs are fictitious, synthesised for this run, with one song given a soft 3-second passage as a trap. The work is sped up 4×.",
      video: {
        src: `${PROOFS}/audio/split-audio-into-tracks/proof.mp4`,
        cuts: webCuts("audio/split-audio-into-tracks"),
        poster: `${PROOFS}/audio/split-audio-into-tracks/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 41.07,
        realDuration: 89,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A 7-minute rehearsal recording is in Music." },
        { at: 1.63, text: "The prompt: split it into one file per song at the quiet gaps." },
        { at: 9.63, text: "Stella replies it will cut at each quiet gap and report how many songs it found." },
        { at: 15.63, text: "Measuring the gaps and cutting the songs." },
        { at: 26.63, text: "Done: seven songs with their lengths; song 4's quiet section left in one piece." },
      ],
    },
    manualTitle: "Split it yourself",
    manualSteps: [
      {
        title: "Audacity: Label Sounds",
        body: "Open the recording, select all and choose Analyze, Label Sounds. Set the threshold to about −45 dB and the minimum silence to 2 seconds, so short pauses inside songs don't count. Audacity adds a label for each stretch of sound.",
      },
      {
        title: "Check the labels",
        body: "Scroll through and look for a song split into two labels (a quiet bridge) or two songs in one (no real gap). Drag label edges to fix them, or rerun with a different threshold. Type a song name into each label if you know the setlist.",
      },
      {
        title: "Export one file per song",
        body: "Choose File, Export Audio, set it to Multiple Files, split based on labels, and name files using the label text or numbers. Pick MP3 or WAV and a folder.",
      },
      {
        title: "ffmpeg",
        body: "`ffmpeg -i set.mp3 -af silencedetect=noise=-45dB:d=2 -f null -` prints where each silence starts and ends. Cut between them with `ffmpeg -ss START -to END -i set.mp3 -c copy \"01.mp3\"` for each song; `-c copy` avoids re-encoding.",
      },
      {
        title: "No gaps? Use times",
        body: "Live sets where songs run into each other can't be split by silence. Note the time each song starts while listening, then cut at those times in Audacity or ffmpeg.",
      },
    ],
    limits: [
      "Songs that run into each other with no quiet gap can't be split this way; give Stella the start times instead.",
      "The files are numbered, not titled, because the recording has no names in it. Send the setlist and it will rename them.",
      "File names and the loudness measurements go to the AI model you use in Stella; the recording itself stays on your computer.",
      "Recorded on Linux with ffmpeg already installed. On a Mac or Windows PC Stella would usually download ffmpeg first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can I split an MP3 without losing quality?",
        a: "Yes. Cutting with `-c copy` keeps the original MP3 data, so nothing is re-encoded. Stella cut the rehearsal that way. Cuts land on MP3 frame boundaries, a few hundredths of a second apart, which you won't hear in a gap.",
      },
      {
        q: "Will a quiet part in the middle of a song be split off?",
        a: "Only if the threshold is too loose. Stella checked the fourth song's soft passage and left it whole; in Audacity, a minimum silence of 2 seconds and a threshold around −45 dB avoids most of these.",
      },
      {
        q: "Can it split into equal parts instead, say every 10 minutes?",
        a: "Yes, just ask for that. Fixed-length parts are useful for long lectures or podcasts that need to fit an upload limit.",
      },
      {
        q: "Can it join files back together?",
        a: "Yes: see [merge MP3 files](/how/audio/merge-mp3-files), or [make an audiobook with chapters](/how/audio/make-audiobook-with-chapters) to keep each part as a chapter.",
      },
    ],
    related: ["audio/merge-mp3-files", "audio/make-audiobook-with-chapters", "video/cut-silences-from-video"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Audacity manual: Label Sounds", href: "https://manual.audacityteam.org/man/label_sounds.html" },
      { label: "Audacity manual: Export Multiple", href: "https://manual.audacityteam.org/man/export_multiple.html" },
      { label: "FFmpeg filters: silencedetect", href: "https://ffmpeg.org/ffmpeg-filters.html#silencedetect" },
    ],
  },
  {
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
      "Lower or raise a song by a few semitones to fit your voice, at the same tempo: Audacity's Change Pitch, ffmpeg's rubberband, or Stella (stella.sh) on your computer.",
    h1: "Change the key of a song to fit your voice",
    short: "Change the key of a song",
    lede: "A practice track two semitones lower, same length and tempo, original kept.",
    answer:
      "Use a pitch shifter, not playback speed: slowing a song down lowers it but changes the tempo too. In the free Audacity, select the song and use Effect, Pitch and Tempo, Change Pitch with −2 semitones. Stella (stella.sh) lowered a practice track by exactly two semitones at the same tempo with a high-quality pitch shifter, and saved it next to the original.",
    stellaSteps: [
      "Finds “Paper Boats (practice track)” in Music and checks its format and length",
      "Checks that this computer's ffmpeg includes the rubberband pitch shifter, a high-quality one",
      "Shifts the pitch down two semitones with the tempo locked, using its setting meant to keep voices sounding natural",
      "Saves Paper Boats (practice track) (-2 semitones).mp3 next to the original, same length and MP3 quality, and leaves the original unchanged",
      "Says it checked length and format but hasn't listened, so play it once before you practise",
    ],
    prompt: "Can you lower Paper Boats from my Music folder by two semitones so it fits my voice? Keep the same speed.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "The lowered copy in about 1 minute. Checked afterwards against an answer key written before the run: a new file measured at −2.00 semitones from the original, 44 seconds long like the original (so the tempo is unchanged), and the original untouched.",
      note: "The song is fictitious, synthesised for this run. Stella also noticed a second copy of the song elsewhere on the test computer, said so and left it alone; its folder path is blurred in the recording. The work is sped up 2×.",
      video: {
        src: `${PROOFS}/audio/change-key-of-song/proof.mp4`,
        cuts: webCuts("audio/change-key-of-song"),
        poster: `${PROOFS}/audio/change-key-of-song/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 40.53,
        realDuration: 60,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. A practice track, Paper Boats, is in Music." },
        { at: 1.67, text: "The prompt: lower it by two semitones to fit my voice, at the same speed." },
        { at: 11.67, text: "Stella replies it's lowering the song two semitones without changing the speed, keeping the original." },
        { at: 16.67, text: "Shifting the pitch, sped up 2×." },
        { at: 25.73, text: "Done: a copy two semitones lower, 44 seconds like the original, with a reminder to listen before practising." },
      ],
    },
    manualTitle: "Change the key yourself",
    manualSteps: [
      {
        title: "Audacity: Change Pitch",
        body: "Install the free Audacity (Windows, Mac, Linux), open the song and select all. Choose Effect, Pitch and Tempo, Change Pitch, set Semitones to −2 (or +2 to raise it), and tick the high-quality stretching option if shown. Apply, then File, Export Audio.",
      },
      {
        title: "Work out how far to move it",
        body: "Each semitone is one piano key or one guitar fret. If a song's top note is two frets too high for you, go down 2. Moving down 3 from G major lands in E major; a capo chart or transposition table helps if you also play along.",
      },
      {
        title: "ffmpeg with rubberband",
        body: "`ffmpeg -i song.mp3 -af rubberband=pitch=0.8909:formant=preserved song-2.mp3` lowers by two semitones. The pitch value is 2^(−2/12); for −1 use 0.9439, for +1 use 1.0595. Not every ffmpeg build includes rubberband.",
      },
      {
        title: "Don't use the speed slider",
        body: "Playing a song slower lowers its pitch, but also drags the tempo. A pitch shifter changes the key while keeping the speed, which is what you want for singing along.",
      },
      {
        title: "Listen before you rely on it",
        body: "Play the shifted version through. Voices moved more than three or four semitones start to sound unnatural; instruments cope better.",
      },
    ],
    limits: [
      "Big shifts sound less natural, especially on voices. Two semitones is comfortable; beyond three or four, expect a processed sound.",
      "It changes the audio only. Chord sheets or lyrics with chords aren't rewritten unless you give them to Stella too.",
      "The song's name and format details go to the AI model you use in Stella; the audio is processed on your computer. Nobody listened to the result in the recording; the check measured it.",
      "Recorded on Linux, where the installed ffmpeg already had the rubberband pitch shifter. On a Mac or Windows PC Stella would need to download an ffmpeg that includes it, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can I change the key of a song without changing the tempo?",
        a: "Yes, with a pitch shifter. Audacity's Change Pitch, ffmpeg's rubberband filter and most practice apps do it. In the recording, the lowered copy stayed exactly 44 seconds long, the same as the original.",
      },
      {
        q: "How many semitones lower should I go?",
        a: "Find the highest note you strain on and count how many frets or piano keys down feel comfortable. Most people need one to three.",
      },
      {
        q: "Does pitch shifting reduce quality?",
        a: "Slightly. Good shifters keep small shifts clean; you may hear a faint warble on voices at bigger shifts.",
      },
      {
        q: "Can it slow the song down too?",
        a: "Yes: see [slow down a song without changing pitch](/how/audio/slow-down-song-without-changing-pitch). To sing without the original vocal, see [make a karaoke version of a song](/how/audio/make-karaoke-version-of-song).",
      },
    ],
    related: ["audio/slow-down-song-without-changing-pitch", "audio/make-karaoke-version-of-song", "audio/convert-midi-to-mp3", "hobbies/transpose-chords"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Audacity manual: Change Pitch", href: "https://manual.audacityteam.org/man/change_pitch.html" },
      { label: "FFmpeg filters: rubberband", href: "https://ffmpeg.org/ffmpeg-filters.html#rubberband" },
    ],
  },
  {
    slug: "convert-midi-to-mp3",
    niche: "audio",
    searchPhrases: [
      "midi to mp3",
      "convert midi to mp3 free",
      "midi to audio",
      "midi to wav",
      "midi to mp3 with soundfont",
    ],
    title: "Convert MIDI to MP3 with a real piano sound, free",
    description:
      "Turn MIDI files from piano lessons into MP3s you can play on your phone, with a proper piano sound: MuseScore Studio, FluidSynth, or Stella (stella.sh).",
    h1: "Convert MIDI to MP3 with a piano sound",
    short: "Convert MIDI to MP3",
    lede: "Four piano-lesson MIDI files as MP3s with a grand piano sound, ready for a phone.",
    answer:
      "A MIDI file holds notes, not sound, so converting it means playing it through a synthesiser with a sound bank. The free MuseScore Studio opens a .mid and exports MP3 with its built-in piano. On Linux, FluidSynth with a free General MIDI sound bank does it from the command line. Stella (stella.sh) installed FluidSynth and a free piano sound bank, rendered four lesson files to MP3 and put them on its Drive for a phone.",
    stellaSteps: [
      "Finds the Piano lessons folder in Music: four MIDI files, including a waltz and a piece that slows down halfway",
      "Finds no MIDI synthesiser on the computer and no admin rights, so downloads FluidSynth and the free FluidR3 sound bank from the Linux distribution's own mirror and unpacks them in its own folder",
      "Plays each MIDI through a grand piano sound, trims long silences, evens out the volume and saves MP3s in an MP3 folder next to the originals",
      "Checks the levels, then uploads the four MP3s to a Piano lessons folder in your Stella Drive so you can play them on your phone",
      "Lists the pieces with their lengths, says nobody has listened yet, and leaves the MIDI files unchanged",
    ],
    prompt:
      "I have some MIDI files from my piano lessons in the Piano lessons folder in Music. Turn them into MP3s I can play on my phone.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Four MP3s in about 4 minutes, including installing the synthesiser. Checked afterwards against an answer key written before the run: each MP3 the right length for its score, not silent, and playing the score's notes (pitch match 0.78 to 0.83 against the MIDI), and the MIDI files unchanged.",
      note: "The four pieces were composed for this run. Any rest of 2 seconds or more in the middle of a piece was shortened, which Stella said. The work is sped up 16×.",
      video: {
        src: `${PROOFS}/audio/convert-midi-to-mp3/proof.mp4`,
        cuts: webCuts("audio/convert-midi-to-mp3"),
        poster: `${PROOFS}/audio/convert-midi-to-mp3/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 46.6,
        realDuration: 242,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Four MIDI files from piano lessons are in Music." },
        { at: 1.67, text: "The prompt: turn them into MP3s I can play on my phone." },
        { at: 13.67, text: "Stella replies it's making MP3s with a proper piano sound and copying them to its Drive for the phone." },
        { at: 19.67, text: "Installing a piano synthesiser, rendering and uploading, sped up 16×." },
        { at: 32.17, text: "Done: four MP3s with their lengths, in the Stella Drive and in an MP3 folder on the computer." },
      ],
    },
    manualTitle: "Convert them yourself",
    manualSteps: [
      {
        title: "MuseScore Studio (Windows, Mac, Linux)",
        body: "Install the free MuseScore Studio and choose File, Open on the .mid. Accept the import options; it turns the MIDI into a score. Then File, Export, choose MP3 and save. Its built-in piano sound is decent, and you can also print the score.",
      },
      {
        title: "Several files at once",
        body: "MuseScore exports one score at a time. Open each file and export it, or use its command line: `mscore -o \"Lesson 4.mp3\" \"Lesson 4.mid\"` (the program is `MuseScore4.exe` on Windows).",
      },
      {
        title: "FluidSynth and a sound bank",
        body: "Install FluidSynth and a free General MIDI SoundFont such as FluidR3 or GeneralUser GS, then run `fluidsynth -ni -F out.wav piano.sf2 lesson.mid` and convert the WAV with `ffmpeg -i out.wav -q:a 2 lesson.mp3`. The sound bank decides how good it sounds.",
      },
      {
        title: "Avoid ringtone-quality converters",
        body: "Many converter sites use a tiny built-in sound set and sound thin. If the result sounds like an old phone, use MuseScore or a better SoundFont instead.",
      },
      {
        title: "Get them onto your phone",
        body: "Copy the MP3s with a cable, AirDrop or a cloud folder you already use, and play them in any music app. On iPhone, the Files app plays MP3s directly.",
      },
    ],
    limits: [
      "The sound depends on the sound bank. The free piano Stella used is good for practice, not a concert grand.",
      "Long rests inside a piece were shortened when Stella trimmed silences. Ask it not to trim if a piece has deliberate long pauses.",
      "On Linux without admin rights Stella fetched FluidSynth and the sound bank (about 150 MB) into its own folder. On a Mac or Windows PC it would install similar free tools, which wasn't recorded.",
      "File names and the files' details go to the AI model you use in Stella. The MP3s were uploaded to your own Stella Drive so your phone can reach them; ask for a local copy only if you'd rather not.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why does my MIDI sound like a ringtone after converting?",
        a: "The converter used a small, cheap sound bank. A MIDI file has no sound of its own, so quality comes entirely from the synthesiser and SoundFont used to play it.",
      },
      {
        q: "Is there a free MIDI to MP3 converter?",
        a: "Yes: MuseScore Studio, or FluidSynth with a free SoundFont. Both run on your own computer, with no upload.",
      },
      {
        q: "Can I change the instrument?",
        a: "Yes. Ask for a different sound (strings, organ) and Stella picks it from the sound bank, or change the instrument in MuseScore before exporting.",
      },
      {
        q: "Can it slow a piece down for practice?",
        a: "Yes: see [slow down a song without changing pitch](/how/audio/slow-down-song-without-changing-pitch), or [change the key of a song](/how/audio/change-key-of-song).",
      },
    ],
    related: ["audio/slow-down-song-without-changing-pitch", "audio/change-key-of-song", "audio/convert-m4a-to-mp3"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "MuseScore Studio handbook", href: "https://handbook.musescore.org/" },
      { label: "MuseScore Studio download", href: "https://musescore.org/en/download" },
      { label: "FluidSynth", href: "https://www.fluidsynth.org/" },
      { label: "GeneralUser GS SoundFont", href: "https://github.com/mrbumpy409/GeneralUser-GS" },
    ],
  },
  {
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
      "Take the singing out of a song but keep the bass and drums, on your own computer: Ultimate Vocal Remover, the Demucs model, or Stella (stella.sh) setting it up for you.",
    h1: "Remove the vocals from a song for karaoke",
    short: "Make a karaoke version of a song",
    lede: "A song with the singing removed and the bass and drums kept, for practice.",
    answer:
      "Use an AI separation model, not the old centre-cancel trick. The free Ultimate Vocal Remover app runs models like Demucs on your computer; sites like LALAL.AI and Moises do it online with limits. Audacity's Vocal Reduction also wipes out bass and drums. Stella (stella.sh) installed the open-source Demucs model and removed the vocal from a song while keeping its bass and kick, then checked the result for leftover voice.",
    stellaSteps: [
      "Finds “Lantern Song (demo)” in Music",
      "Sets up the open-source Demucs separation model in its own Python environment, a download of several gigabytes including PyTorch and the model",
      "Splits the song into vocals and everything else with Demucs's fine-tuned model, then runs the backing track through again to check for leftover voice",
      "Saves Lantern Song (demo) - Karaoke (no vocals).mp3 next to the original, at the original volume, and leaves the original unchanged",
      "Says the result was measured, not listened to, and that parts near the singer's pitch may sound a little thin",
    ],
    prompt:
      "Make a karaoke version of Lantern Song in my Music folder with the singing taken out, so I can practise singing over it.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "The karaoke version in about 3 minutes 20 seconds, including the install. Checked afterwards against an answer key written before the run, using the song's true instrumental: the result is 15 dB closer to the instrumental than the original was (6 dB required), the bass and kick are fully kept (not the centre-cancel trick), and the original is unchanged.",
      note: "The backing track was synthesised for this run and the vocal was sung by a speech model, so the true instrumental was known for checking. Stella also noticed a second copy of the song elsewhere on the test computer and asked about it; that folder path is blurred in the recording. The work is sped up 13×.",
      video: {
        src: `${PROOFS}/audio/make-karaoke-version-of-song/proof.mp4`,
        cuts: webCuts("audio/make-karaoke-version-of-song"),
        poster: `${PROOFS}/audio/make-karaoke-version-of-song/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 44.63,
        realDuration: 199,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Lantern Song, with a sung vocal, is in Music." },
        { at: 1.67, text: "The prompt: make a karaoke version with the singing taken out." },
        { at: 12.67, text: "Stella replies it will save a version without vocals next to the original." },
        { at: 18.67, text: "Installing the Demucs separation model and separating the vocal, sped up 13×." },
        { at: 30.47, text: "Done: the karaoke version, with a note that it was measured but not yet listened to." },
      ],
    },
    manualTitle: "Remove the vocals yourself",
    manualSteps: [
      {
        title: "Ultimate Vocal Remover (Windows, Mac, Linux)",
        body: "Download the free Ultimate Vocal Remover from its GitHub releases page. Choose the song as input, pick a Demucs or MDX-Net model, tick Instrumental Only, choose an output folder and press Start. The first run downloads the model.",
      },
      {
        title: "Demucs from the command line",
        body: "With Python installed, `pip install demucs`, then `demucs --two-stems=vocals \"song.mp3\"` writes vocals.wav and no_vocals.wav into a separated folder. It runs on a normal processor, faster with a graphics card.",
      },
      {
        title: "Audacity: free AI plugin, or the quick trick",
        body: "Audacity's free OpenVINO plugins add a Music Separation effect on Windows and Linux. Its built-in Vocal Reduction and Isolation cancels whatever is in the centre of the stereo mix, which removes the bass and kick drum along with the voice.",
      },
      {
        title: "Online vocal removers",
        body: "LALAL.AI, Moises, vocalremover.org and others separate in the browser. They're quick but upload the song and limit free minutes or quality.",
      },
      {
        title: "Listen for leftovers",
        body: "Play the result through. Faint echoes of the voice, reverb tails, or a thin sound where an instrument shares the singer's range are normal side effects. Trying a different model sometimes helps.",
      },
    ],
    limits: [
      "Separation is very good but not perfect: faint vocal echoes and reverb can remain, and instruments close to the voice may sound thinner. The check measured the result; nobody listened to it in the recording.",
      "It's a big install: Stella's private Python environment for Demucs took about 5 GB, mostly PyTorch, plus a 320 MB model. Ask Stella to delete it afterwards if you won't need it again.",
      "For personal practice. Sharing a karaoke version of someone else's song is a copyright question, not a technical one.",
      "The song's name goes to the AI model you use in Stella; the song itself is separated on your computer and isn't uploaded. Recorded on Linux with a graphics card; on a Mac or Windows PC the same model runs, more slowly without a supported graphics card, which wasn't recorded.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can you really remove vocals from a song?",
        a: "Mostly. AI models like Demucs separate the voice well; in the test the backing track came out 15 dB closer to the true instrumental than the original. Some faint traces can remain.",
      },
      {
        q: "Why does Audacity's vocal remover kill the bass?",
        a: "It subtracts the left channel from the right, removing anything mixed in the centre. Vocals are centred, but so are bass and kick drum.",
      },
      {
        q: "Can I keep just the vocals instead?",
        a: "Yes. The same separation produces a vocals-only track; ask Stella to save that too.",
      },
      {
        q: "Can it also change the key to suit my voice?",
        a: "Yes: see [change the key of a song](/how/audio/change-key-of-song). To learn a part slowly, see [slow down a song without changing pitch](/how/audio/slow-down-song-without-changing-pitch).",
      },
    ],
    related: ["audio/change-key-of-song", "audio/slow-down-song-without-changing-pitch", "local-ai/run-ai-offline-on-your-computer"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Demucs on GitHub", href: "https://github.com/facebookresearch/demucs" },
      { label: "Ultimate Vocal Remover on GitHub", href: "https://github.com/Anjok07/ultimatevocalremovergui" },
      { label: "Audacity manual: Vocal Reduction and Isolation", href: "https://manual.audacityteam.org/man/vocal_reduction_and_isolation.html" },
      { label: "Audacity OpenVINO AI plugins", href: "https://www.audacityteam.org/download/openvino/" },
    ],
  },
  {
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
      "Make a 75% speed practice copy of a song that stays in the same key, to play along on guitar: Audacity's Change Tempo, ffmpeg, or Stella (stella.sh).",
    h1: "Slow down a song without changing its pitch",
    short: "Slow down a song, same pitch",
    lede: "A 75% speed practice copy of a song that stays in tune with your guitar.",
    answer:
      "Use a time-stretch, not the playback speed: slowing playback also lowers the pitch, so you can't play along in tune. In the free Audacity, Effect, Pitch and Tempo, Change Tempo by −25% makes a 75% copy at the same pitch. Paid apps like Amazing Slow Downer and Transcribe! do it live. Stella (stella.sh) made a 75% speed copy of a song at the original pitch with a high-quality time-stretch and saved it next to the original.",
    stellaSteps: [
      "Finds “Harbour Lights” in Music and notes its length, 52.5 seconds",
      "Checks this computer's ffmpeg has the rubberband time-stretcher, which keeps quality better than the basic one",
      "Stretches the song to 75% speed with the pitch locked, using settings meant for music with chords and drums",
      "Saves Harbour Lights (75% speed).mp3 next to the original, which it leaves unchanged, and measures that the pitch didn't move",
      "Reports it runs 70 seconds instead of 52.5 in the same key, and offers an 85% version for when you're ready",
    ],
    prompt:
      "I'm learning Harbour Lights on guitar (it's in my Music folder). Make me a copy at 75% speed so I can play along, without it sounding lower.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-13",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "The practice copy in about 1 minute 30 seconds. Checked afterwards against an answer key written before the run: a new copy exactly 1/0.75 of the original's length (70.0 s), pitch unchanged (measured at +0.00 semitones), not silent, and the original untouched.",
      note: "The song is fictitious, synthesised for this run. Stella named the song's key in its reply; the check didn't test that. The work is sped up 3×.",
      video: {
        src: `${PROOFS}/audio/slow-down-song-without-changing-pitch/proof.mp4`,
        cuts: webCuts("audio/slow-down-song-without-changing-pitch"),
        poster: `${PROOFS}/audio/slow-down-song-without-changing-pitch/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 47.53,
        realDuration: 87,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. The song Harbour Lights is in Music." },
        { at: 1.67, text: "The prompt: a copy at 75% speed to play along on guitar, without it sounding lower." },
        { at: 15.67, text: "Stella replies it's making a 75% copy that keeps the original pitch, next to the original." },
        { at: 21.67, text: "Stretching the song and checking its pitch." },
        { at: 32.67, text: "Done: 70 seconds instead of 52.5, same key, with an offer of an 85% version." },
      ],
    },
    manualTitle: "Slow it down yourself",
    manualSteps: [
      {
        title: "Audacity: Change Tempo",
        body: "Install the free Audacity, open the song and select all (Ctrl+A, or Cmd+A on a Mac). Choose Effect, Pitch and Tempo, Change Tempo, set Percent Change to −25 for 75% speed, tick Use high quality stretching, and apply. Export with File, Export Audio.",
      },
      {
        title: "Make a ladder of speeds",
        body: "Practise at 70%, then 80%, 90% and full speed. Change Tempo by −30, −20 and −10 on fresh copies of the original (not on an already slowed copy), and name them with the speed.",
      },
      {
        title: "ffmpeg",
        body: "`ffmpeg -i song.mp3 -af atempo=0.75 \"song (75%).mp3\"` slows it while keeping the pitch. If your ffmpeg has rubberband, `-af rubberband=tempo=0.75` usually sounds cleaner on music.",
      },
      {
        title: "Slow it while it plays",
        body: "VLC's Playback, Speed menu and many practice apps slow audio live with pitch kept. Handy for a quick listen; a saved copy is better for looping a section on your phone.",
      },
      {
        title: "Loop the hard bit",
        body: "Cut the tricky section out of the slowed copy in Audacity (select it, File, Export Audio, Export Selected Audio) and set your player to repeat that one file.",
      },
    ],
    limits: [
      "Big slowdowns, below about 50%, sound smeary with any tool. 70 to 90% is where practice copies sound natural.",
      "It works on files you have. Songs on streaming services can't be processed; use the service's own speed control if it has one.",
      "The song's name and format details go to the AI model you use in Stella; the audio is stretched on your computer.",
      "Recorded on Linux, where ffmpeg with rubberband was already installed. On a Mac or Windows PC Stella would usually download ffmpeg first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I slow down a song without it sounding lower?",
        a: "Use a time-stretch effect that keeps pitch: Audacity's Change Tempo, VLC's playback speed, or ffmpeg's atempo or rubberband. Stretching to 75% made the test song 70 seconds long at exactly the same pitch.",
      },
      {
        q: "Can I speed a song up without it sounding higher?",
        a: "Yes, the same tools work in the other direction: a tempo change above 100% keeps the pitch. For video, see [speed up a video](/how/video/speed-up-video) with the voice kept normal.",
      },
      {
        q: "What speed should I practise at?",
        a: "Slow enough to play it cleanly, often 60 to 75% to start. Step up by about 10% once it's comfortable.",
      },
      {
        q: "Can it change the key as well?",
        a: "Yes: see [change the key of a song](/how/audio/change-key-of-song), or [make a karaoke version](/how/audio/make-karaoke-version-of-song) to practise singing over it.",
      },
    ],
    related: ["audio/change-key-of-song", "audio/make-karaoke-version-of-song", "video/speed-up-video"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Audacity manual: Change Tempo", href: "https://manual.audacityteam.org/man/change_tempo.html" },
      { label: "FFmpeg filters: atempo", href: "https://ffmpeg.org/ffmpeg-filters.html#atempo" },
    ],
  },
  {
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
      "Car stereo won't play your WMA music? Convert the whole collection to MP3 with titles, artists, albums and track numbers kept: fre:ac, VLC, ffmpeg or Stella (stella.sh).",
    h1: "Convert WMA to MP3 and keep the song info",
    short: "Convert WMA to MP3",
    lede: "Two albums of old Windows Media Player WMAs turned into tagged MP3s for the car.",
    answer:
      "Use a converter that copies the tags across and keeps each album in its own folder: the free fre:ac does a whole collection on Mac or Windows, while VLC does one file at a time and often drops the song names. Watch for two tracks with the same name, like two Intros, overwriting each other. Stella (stella.sh) converted ten WMA songs to MP3 with title, artist, album, track, year and genre kept, and added each album's cover.",
    stellaSteps: [
      "Finds the “From the old PC” folder in Music: two albums, ten WMA songs at 128 kbps, each with tags and a Folder.jpg cover",
      "Converts every song to a high-quality MP3, keeping the artist and album folders and the file names, so both “01 Intro” tracks survive",
      "Copies the title, artist, album, album artist, track number, year and genre into tags car stereos read, and adds each album's cover from its folder picture",
      "Checks the tags, the tag version and each song's length",
      "Saves everything in a new “From the old PC (MP3)” folder next to the original, ready to copy to a USB stick, with the WMAs untouched",
    ],
    prompt:
      "My old music collection in the From the old PC folder in my Music is all WMA files from Windows Media Player, and my car stereo won't play them. Convert them to MP3 and keep the song names, artists and album info.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Ten MP3s in under a minute. Checked afterwards against an answer key written before the run: all ten songs converted with both “Intro” tracks kept, real MP3 at about 145–170 kbps, title, artist, album and track number in every file, year and genre too, each whole song sounding the same as its WMA, and the WMAs unchanged.",
      note: "The two albums are synthesised music by made-up bands, saved as WMA with tags and covers for this run. The work is sped up 3×. We didn't play the MP3s on a real car stereo.",
      video: {
        src: `${PROOFS}/audio/convert-wma-to-mp3/proof.mp4`,
        cuts: webCuts("audio/convert-wma-to-mp3"),
        poster: `${PROOFS}/audio/convert-wma-to-mp3/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 44.97,
        realDuration: 84,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Two albums of WMA songs are in Music/From the old PC." },
        { at: 1.63, text: "The prompt: convert them to MP3 for the car and keep the song info." },
        { at: 13.63, text: "Stella replies it's converting them with names, artists, albums and covers, keeping the WMAs." },
        { at: 19.63, text: "Converting and checking the tags of every song." },
        { at: 30.57, text: "Done: 10 MP3s in a new folder, every tag kept, album covers added." },
      ],
    },
    manualTitle: "Convert them yourself",
    manualSteps: [
      {
        title: "Mac or Windows: fre:ac",
        body: "In the free fre:ac, add the folder, choose the LAME MP3 encoder (VBR quality 2 is a good setting), set an output folder and a file-name pattern like <artist>/<album>/<track> - <title>, then Start. It copies the tags across.",
      },
      {
        title: "VLC, one file at a time",
        body: "Choose Media, Convert / Save, add a WMA, pick the Audio - MP3 profile and a new file name, then Start. Check the song's title and artist afterwards; VLC doesn't always keep them.",
      },
      {
        title: "ffmpeg",
        body: "`ffmpeg -i \"01 Intro.wma\" -map_metadata 0 -id3v2_version 3 -c:a libmp3lame -q:a 2 \"01 Intro.mp3\"` keeps the tags in a form car stereos read. Run it in each album's folder so same-named tracks don't collide.",
      },
      {
        title: "Windows Media Player can't do it",
        body: "Windows Media Player and the newer Media Player app can rip CDs to MP3 but don't convert WMA files you already have to MP3. Use one of the tools above.",
      },
      {
        title: "Copy to the car",
        body: "Most car stereos read a FAT32 USB stick and show the ID3 tags. Copy the whole converted folder across; keeping the artist and album folders makes browsing easier on the dashboard.",
      },
    ],
    limits: [
      "WMA files with copy protection (DRM), often bought from old online music stores, can't be converted. Stella said it would list any; none of these had it.",
      "Converting one lossy format to another can't improve the sound. The MP3s sound the same as the 128 kbps WMAs, not better.",
      "File and folder names and the songs' tags went to the AI model you use in Stella. The music was converted on your computer.",
      "Recorded on Linux with ffmpeg already installed. On a Mac or Windows PC Stella would usually download ffmpeg first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can I convert WMA to MP3 without losing the song names?",
        a: "Yes, with a converter that copies the tags, like fre:ac or ffmpeg with `-map_metadata 0`. Stella kept every tag and added album covers.",
      },
      {
        q: "Why did one of my songs disappear after converting?",
        a: "Two tracks with the same name, like two Intros, went into one folder and the second overwrote the first. Keep album folders, as Stella did.",
      },
      {
        q: "What MP3 quality should I use?",
        a: "VBR quality 2 (about 190 kbps) or 192 kbps is plenty, and can't make a 128 kbps WMA sound better than it did.",
      },
      {
        q: "What about M4A or FLAC files?",
        a: "See [convert M4A to MP3](/how/audio/convert-m4a-to-mp3) and [convert FLAC to MP3](/how/audio/convert-flac-to-mp3).",
      },
    ],
    related: ["audio/convert-m4a-to-mp3", "audio/convert-flac-to-mp3", "audio/edit-mp3-tags-in-bulk"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "fre:ac (free audio converter)", href: "https://www.freac.org/" },
      { label: "VLC media player", href: "https://www.videolan.org/vlc/" },
      { label: "FFmpeg MP3 encoding guide", href: "https://trac.ffmpeg.org/wiki/Encode/MP3" },
    ],
  },
  {
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
      "Trim the dead air before and after each recording without shortening the pauses inside: Audacity, ffmpeg, or Stella (stella.sh) on a whole folder at once.",
    h1: "Remove silence from the start and end of recordings",
    short: "Trim silence from recordings",
    lede: "Six phone recordings with the fumbling at both ends cut off and the talks untouched.",
    answer:
      "Cut only from the start to just before the first word, and from just after the last word to the end. In Audacity, select those parts and press Delete; avoid Truncate Silence, which also shortens the pauses inside the talk. Stella (stella.sh) trimmed six garden-club talks, removing the quiet lead-in, the tail and the phone clicks at both ends, with every pause in the middle kept to the hundredth of a second.",
    stellaSteps: [
      "Finds the six talks in Music/Garden club talks (four MP3s, two M4As) and measures where the sound is in each",
      "Spots a phone click near each start and end, a long quiet lead-in and tail, and three spoken sections with 3–4-second pauses",
      "Moves the untouched recordings into an originals subfolder, then cuts each file from about half a second before the first word to just under a second after the last, without re-encoding",
      "Compares the pauses before and after to confirm none in the middle changed",
      "Reports how much came off each one and points out the talks are only 17–21 seconds of speech, in case the recordings are incomplete",
    ],
    prompt:
      "I recorded six talks for our garden club on my phone, and each one has a long bit of silence at the start and end while I fumbled with the phone. Trim the silence off the start and end of each recording in the Garden club talks folder in my Music, but don't cut anything out of the middle.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-14",
      platform: "Linux (Omarchy)",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "Six trimmed talks in about 1 minute 20 seconds. Checked afterwards against an answer key written before the run: all six trimmed, each starting about half a second before the first word (the phone bump cut too) and ending under a second after the last, the first and last words intact, and nothing cut from the middle.",
      note: "The talks are synthetic voices with room noise, a handling bump and a stop-button click, made for this run. Stella kept the trimmed files under their original names and moved the untouched recordings into an originals subfolder. The work is sped up 7×. Checked by measurement; nobody listened.",
      video: {
        src: `${PROOFS}/audio/trim-silence-from-recordings/proof.mp4`,
        cuts: webCuts("audio/trim-silence-from-recordings"),
        poster: `${PROOFS}/audio/trim-silence-from-recordings/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 45.03,
        realDuration: 120,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer. Six phone recordings of garden-club talks are in Music." },
        { at: 1.63, text: "The prompt: trim the silence at the start and end, nothing from the middle." },
        { at: 13.23, text: "Stella replies only the ends will be trimmed and the originals kept in a subfolder." },
        { at: 19.23, text: "Measuring where each talk starts and ends, trimming and comparing the pauses." },
        { at: 30.63, text: "Done: six talks trimmed, middle pauses unchanged; the talks look short, worth a listen." },
      ],
    },
    manualTitle: "Trim them yourself",
    manualSteps: [
      {
        title: "Audacity, by hand",
        body: "Open a recording in the free Audacity. Drag from the very start to just before the first word and press Delete; do the same from just after the last word to the end. File, Export, and repeat for each file.",
      },
      {
        title: "Don't use Truncate Silence here",
        body: "Audacity's Effect, Truncate Silence shortens every quiet gap, including the pauses between sentences. It's handy for tightening speech, but not when you want the talk itself untouched.",
      },
      {
        title: "ffmpeg",
        body: "Find the times first: `ffmpeg -i talk.mp3 -af silencedetect=noise=-45dB:d=0.5 -f null -` lists the quiet stretches. Then `ffmpeg -ss 11.5 -to 31.2 -i talk.mp3 -c copy trimmed.mp3` cuts without re-encoding.",
      },
      {
        title: "Leave a little air",
        body: "Keep about half a second before the first word and a bit more after the last. Cutting right to the edge clips soft consonants and makes the recording start abruptly.",
      },
      {
        title: "Listen to the ends",
        body: "Play the first and last few seconds of each trimmed file. A very quiet first word, or a handling noise loud enough to look like speech, is the usual way automatic trimming goes wrong.",
      },
    ],
    limits: [
      "A very quiet first or last word can be mistaken for silence. The check confirmed the words were intact here, but nobody listened; play the ends of each file.",
      "Stella replaced the files in place under their own names and moved the originals into a subfolder. Say so if you'd rather keep the originals where they are and get trimmed copies.",
      "File names and measurements of the sound went to the AI model you use in Stella. The recordings were trimmed on your computer.",
      "Recorded on Linux with ffmpeg already installed. On a Mac or Windows PC Stella would usually download ffmpeg first, which isn't shown.",
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I remove silence only at the start and end?",
        a: "Delete from the start to the first word and from the last word to the end, and leave everything between alone. Stella did that for six files at once.",
      },
      {
        q: "Does trimming lose sound quality?",
        a: "Not if the audio is cut without re-encoding, as Stella did. Re-saving through an editor re-encodes MP3 and M4A slightly.",
      },
      {
        q: "Can I take out the long pauses inside a talk too?",
        a: "Yes, that's Truncate Silence in Audacity. For video, see [cut silences from a video](/how/video/cut-silences-from-video).",
      },
      {
        q: "Can I get a transcript of the talks?",
        a: "Yes: see [transcribe voice memos to text](/how/audio/transcribe-voice-memos-to-text).",
      },
    ],
    related: ["video/cut-silences-from-video", "audio/transcribe-voice-memos-to-text", "audio/normalize-audio-volume"],
    lastChecked: "2026-11-14",
    sources: [
      { label: "Audacity manual: Edit menu (Delete)", href: "https://manual.audacityteam.org/man/edit_menu.html" },
      { label: "Audacity manual: Truncate Silence", href: "https://manual.audacityteam.org/man/truncate_silence.html" },
      { label: "FFmpeg filters: silencedetect", href: "https://ffmpeg.org/ffmpeg-filters.html#silencedetect" },
    ],
  },
];
