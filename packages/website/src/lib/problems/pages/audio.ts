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
    related: ["audio/convert-flac-to-mp3", "pc-cleanup/organize-downloads-folder", "audio/transcribe-voice-memos-to-text"],
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
    related: ["audio/edit-mp3-tags-in-bulk", "video/convert-mkv-to-mp4"],
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
    related: ["video/burn-subtitles-into-video-for-tiktok", "audio/edit-mp3-tags-in-bulk", "local-ai/run-ai-offline-on-your-computer"],
    lastChecked: "2026-11-13",
    sources: [
      { label: "Apple: View a transcript in Voice Memos on Mac", href: "https://support.apple.com/guide/voice-memos/vm4a03609f0d/mac" },
      { label: "Microsoft: Transcribe your recordings", href: "https://support.microsoft.com/en-us/office/transcribe-your-recordings-7fc2efec-245e-45f0-b053-2a97531ecf57" },
      { label: "OpenAI Whisper on GitHub", href: "https://github.com/openai/whisper" },
    ],
  },
];
