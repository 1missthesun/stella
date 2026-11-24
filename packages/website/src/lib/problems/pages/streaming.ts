import { shortGuide } from "../short";
import type { ProblemPage } from "../types";

export const STREAMING_PAGES: ProblemPage[] = [
  shortGuide({
    slug: "set-up-obs-for-streaming",
    niche: "streaming",
    searchPhrases: [
      "how to set up obs for streaming",
      "how to set up obs for streaming on twitch",
      "how to stream on twitch with obs",
      "obs setup for youtube streaming",
      "how to stream on kick with obs",
    ],
    title: "How to set up OBS for streaming on Twitch, YouTube or Kick",
    description:
      "Go from nothing installed to ready to go live. Stella (stella.sh) sets up OBS with your game, camera, mic and your Twitch, YouTube or Kick channel.",
    h1: "Set up OBS for streaming",
    short: "Set up OBS for streaming",
    lede: "Game, camera, mic and channel all connected, ready for Start Streaming.",
    answer:
      "Streaming needs OBS, your game and camera in a scene, sound levels, and a link to your channel. Stella (stella.sh) installs and arranges all of it, and you just sign in to Twitch, YouTube or Kick.",
    gets: [
      "OBS installed and set for your screen and internet",
      "Your game, webcam and mic in one scene",
      "Your channel linked, ready to go live",
    ],
    prompt:
      "I want to start streaming Minecraft on Twitch with my webcam and USB mic. Set up OBS so all I have to do is press Start Streaming.",
    demo: {
      ack: "Fun! I'll get OBS ready around your Minecraft setup.",
      task: "Getting OBS ready for Twitch",
      rows: ["Installing OBS from obsproject.com", "Adding Minecraft, webcam and USB mic", "Placing the webcam bottom left", "Opening the Twitch sign-in for you"],
      reply:
        "You're ready. OBS shows Minecraft full screen with your webcam in the corner, your mic and game sound are balanced, and your Twitch channel is connected. Press **Start Streaming** whenever you like.",
    },
    faq: [
      ["How do I connect OBS to Kick?", "Copy the stream URL and stream key from your Kick dashboard into OBS under Settings > Stream, with Custom as the service."],
      ["Do I need a webcam to stream?", "No. Game and mic are enough, and you can add a camera or an avatar later."],
    ],
    byHand: [
      "Install [OBS Studio](https://obsproject.com/download) and let its first-run wizard test your internet.",
      "Settings > Stream: choose Twitch or YouTube and click Connect Account.",
      "Under Sources, add Game Capture (Display Capture on Mac and Linux), Video Capture Device and your mic, then Start Streaming.",
    ],
    related: ["streaming/best-obs-settings-for-streaming", "streaming/set-up-obs-scenes", "design/make-twitch-overlays"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "best-obs-settings-for-streaming",
    niche: "streaming",
    searchPhrases: [
      "best obs settings for streaming",
      "best obs settings for streaming 1080p 60fps",
      "obs settings for streaming low end pc",
      "best obs settings for streaming on twitch",
      "obs bitrate settings",
    ],
    title: "Best OBS settings for streaming, matched to your PC",
    description:
      "Skip the copy-paste settings lists. Stella (stella.sh) checks your graphics card, processor and upload speed, then sets OBS to what your PC can really hold.",
    h1: "Best OBS settings for streaming on your PC",
    short: "Best OBS streaming settings",
    lede: "The sharpest picture your PC and internet can hold, with the game still smooth.",
    answer:
      "The right settings depend on your graphics card and upload speed, which decide resolution, bitrate and who does the encoding. Stella (stella.sh) looks at both and fills in every OBS setting for your platform.",
    gets: [
      "Resolution and frame rate picked for your hardware",
      "A bitrate your upload speed can carry",
      "Your old settings kept as a second profile",
    ],
    prompt:
      "Set OBS to the best settings for streaming Apex on Twitch. I have an RTX 3060 and I want 1080p 60 if my internet can take it.",
    demo: {
      ack: "Sure. Checking your card and your upload first.",
      task: "Tuning OBS for Apex on Twitch",
      rows: ["RTX 3060 can encode by itself", "Measuring your upload speed", "Saving your current profile", "Writing the new stream settings"],
      reply:
        "OBS is set to 1080p at 60 fps, 6,000 kbps, with the RTX 3060 doing the encoding so your processor stays free for Apex. Your previous settings are in the profile called **Before Stella**.",
    },
    faq: [
      ["What bitrate should I stream at?", "For 1080p60: around 6,000 kbps on Twitch, up to 8,000 on Kick, and about 12,000 on YouTube. Keep it under three quarters of your upload speed."],
      ["Should I stream 720p or 1080p?", "Pick 720p60 for fast games on slow internet. At a low bitrate it looks cleaner than 1080p."],
    ],
    byHand: [
      "Settings > Output: choose your graphics card's encoder (NVENC, AMD, QuickSync or Apple) over x264.",
      "Use CBR with a keyframe interval of 2 seconds.",
      "Settings > Video: set the output resolution and 60 or 30 fps.",
    ],
    related: ["streaming/obs-dropped-frames-encoding-overloaded", "streaming/set-up-obs-for-streaming", "streaming/best-obs-settings-for-recording"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "obs-dropped-frames-encoding-overloaded",
    niche: "streaming",
    searchPhrases: [
      "obs dropped frames",
      "obs encoding overloaded",
      "obs lagging when streaming",
      "obs lagging my game",
      "obs dropped frames with good internet",
    ],
    title: "OBS dropped frames, lag or encoding overloaded? Fix it",
    description:
      "Stream stuttering or OBS warning that encoding is overloaded? Stella (stella.sh) reads what OBS recorded about your last stream and fixes the part that's choking.",
    h1: "OBS dropped frames, lag or encoding overloaded",
    short: "OBS dropped frames and lag",
    lede: "A stream that stays smooth, and a game that does too.",
    answer:
      "Dropped frames mean your internet can't keep up; encoding overloaded and lag mean your PC can't. Stella (stella.sh) reads the OBS log from your last stream, works out which one it is and fixes it.",
    gets: [
      "Whether it's your internet, your graphics card or OBS itself",
      "Stream quality lowered only as far as needed",
      "Heavy scenes trimmed so OBS has room",
    ],
    prompt:
      "OBS keeps saying encoding overloaded when I stream Warzone, and viewers tell me it's a slideshow. Fix it without making my game look awful.",
    demo: {
      ack: "Let me read what OBS wrote down last night.",
      task: "Fixing the Warzone stream lag",
      rows: ["Log shows encoding and rendering lag", "Processor was doing the encoding", "Warzone frame rate had no limit", "OBS wasn't running as administrator"],
      reply:
        "It was your PC, not your internet. Your graphics card now handles the encoding, Warzone is capped at your screen's 144 fps, and OBS starts as administrator. Game graphics stay as they were.",
    },
    faq: [
      ["Why do I drop frames with good internet?", "Upload counts, not download. Wi-Fi, a faraway stream server or a VPN can all cut it short."],
      ["Why does the game lag but the stream looks fine?", "The game and OBS are fighting over the graphics card. A frame rate limit in the game gives OBS breathing room."],
    ],
    byHand: [
      "Open View > Stats in OBS while live and see which number climbs.",
      "Network drops: use a cable, lower the bitrate, or choose another stream server.",
      "Encoding or rendering lag: use a hardware encoder, limit the game's fps, run OBS as administrator.",
    ],
    related: ["streaming/best-obs-settings-for-streaming", "pc-gaming/fix-fps-drops-in-games", "streaming/obs-black-screen"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "obs-black-screen",
    niche: "streaming",
    searchPhrases: [
      "obs black screen",
      "obs game capture black screen",
      "obs display capture black screen",
      "obs game capture not working",
      "obs black screen when recording",
    ],
    title: "OBS black screen in game or display capture? Get the picture",
    description:
      "OBS showing black instead of your game or desktop? Stella (stella.sh) finds why on your computer, changes the right setting and gets your picture back.",
    h1: "OBS black screen when capturing a game or display",
    short: "OBS black screen",
    lede: "Your game or desktop back in the OBS preview instead of a black box.",
    answer:
      "A black capture usually means a game that blocks OBS, a laptop running OBS and the game on different graphics chips, or a missing Mac permission. Stella (stella.sh) finds which one you have and fixes it.",
    gets: [
      "The right kind of capture for that game",
      "OBS and the game on the same graphics chip",
      "Screen permission sorted on a Mac",
    ],
    prompt:
      "OBS is just black when I capture Counter-Strike 2 on my gaming laptop. I can hear the game but there's no picture.",
    demo: {
      ack: "Got it. Checking how OBS is trying to grab the game.",
      task: "Fixing the black OBS preview",
      rows: ["Counter-Strike 2 blocks Game Capture", "OBS was on the built-in graphics", "Switching to Window Capture"],
      reply:
        "Your picture is back. Counter-Strike 2 now runs fullscreen windowed and OBS uses Window Capture for it, since the game blocks the usual kind. OBS also runs on your RTX chip, same as the game.",
    },
    faq: [
      ["Why is OBS display capture black on a laptop?", "Windows may run OBS on a different graphics chip from the one driving your screen. Change it under Settings > System > Display > Graphics, then reopen OBS."],
      ["Why is OBS black on a Mac?", "OBS needs Screen & System Audio Recording turned on in System Settings > Privacy & Security, then a restart of OBS."],
    ],
    byHand: [
      "Switch the game to borderless and try Window Capture or Display Capture.",
      "Run OBS as administrator, and close overlays such as RivaTuner.",
      "On a laptop, set OBS and the game to High performance in Windows graphics settings.",
    ],
    related: ["streaming/set-up-obs-for-streaming", "streaming/obs-dropped-frames-encoding-overloaded", "pc-gaming/black-screen-when-launching-games"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "separate-game-and-discord-audio-in-obs",
    niche: "streaming",
    searchPhrases: [
      "obs separate discord and game audio",
      "obs separate audio tracks",
      "how to keep discord audio out of stream",
      "obs discord audio capture",
      "obs game audio only",
    ],
    title: "Separate Discord and game audio in OBS, or keep Discord off",
    description:
      "Put game, Discord, music and mic on their own tracks in OBS, or keep your friends' voices off stream. Stella (stella.sh) splits and labels the sound for you.",
    h1: "Separate Discord and game audio in OBS",
    short: "Separate game and Discord audio",
    lede: "Game, friends, music and mic each on their own slider.",
    answer:
      "By default OBS records everything your PC plays as one lump. Stella (stella.sh) splits it so the game, Discord, music and your mic get their own sliders and tracks, or leaves Discord off the stream completely.",
    gets: [
      "A volume slider for each app",
      "Discord heard by you, not by viewers, if you prefer",
      "Separate tracks in recordings for editing later",
    ],
    prompt:
      "In OBS I want viewers to hear the game and me, but not my friends on Discord. Still record Discord on its own track for clips.",
    demo: {
      ack: "Easy. Splitting your sound by app.",
      task: "Splitting Discord from game sound",
      rows: ["Turning off the all-in-one desktop sound", "Adding the game and Discord separately", "Choosing what the stream hears"],
      reply:
        "Viewers now hear only the game and your mic. In recordings, track 1 is what the stream hears, track 2 is the game, track 3 your mic and track 4 Discord.",
    },
    faq: [
      ["Why do I hear an echo after splitting audio?", "The same app is being captured twice. Turn off Desktop Audio in Settings > Audio once each app has its own source."],
      ["Can I keep music out of my Twitch VODs?", "Yes. OBS has a Twitch VOD track setting, so music plays live but is missing from the saved video."],
    ],
    byHand: [
      "Settings > Audio: set Desktop Audio to Disabled.",
      "Windows: add an Application Audio Capture source for the game and another for Discord.",
      "Mac: add macOS Audio Capture and choose each application.",
      "Edit > Advanced Audio Properties: tick which tracks each source goes to.",
    ],
    related: ["streaming/make-mic-sound-better-in-obs", "streaming/best-obs-settings-for-recording", "streaming/set-up-obs-for-streaming"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "make-mic-sound-better-in-obs",
    niche: "streaming",
    searchPhrases: [
      "how to make mic sound better in obs",
      "obs mic filters",
      "obs noise suppression",
      "obs mic settings for background noise",
      "best obs mic filters settings",
    ],
    title: "How to make your mic sound better in OBS",
    description:
      "Keyboard clicks, fan hum, quiet one second and peaking the next? Stella (stella.sh) adds and tunes OBS mic filters for your voice and your room.",
    h1: "Make your mic sound better in OBS",
    short: "Make your mic sound better",
    lede: "A clear, even voice without the fan, the keyboard or the shouting peaks.",
    answer:
      "A good stream voice is a few OBS filters in the right order: remove noise, warm the tone, even out the volume, catch the peaks. Stella (stella.sh) adds them and tunes them from a sample of your voice.",
    gets: [
      "Fan and keyboard noise pushed down",
      "Quiet talking lifted, shouting held back",
      "A fuller tone instead of thin or boomy",
    ],
    prompt:
      "My HyperX mic sounds thin on stream, you can hear my fan and keyboard, and I blow people's ears out when I yell. Fix it in OBS.",
    demo: {
      ack: "On it. Say a few normal sentences, then yell once.",
      task: "Tuning your mic in OBS",
      rows: ["Listening to your sample recording", "Adding noise suppression and a gentle gate", "Adding EQ, compressor and limiter"],
      reply:
        "Your HyperX now runs through noise suppression, a gate for the keyboard, a little more low end, a compressor and a limiter for the yelling. Turn any of them off by right-clicking the mic and choosing Filters.",
    },
    faq: [
      ["What order should OBS mic filters go in?", "Noise suppression, gate, EQ, compressor, then limiter last."],
      ["Why does noise suppression make me sound robotic?", "It's working too hard. Move the mic closer, lower its gain, and use RNNoise rather than Speex."],
    ],
    byHand: [
      "Right-click your mic in the Audio Mixer and choose Filters.",
      "Add Noise Suppression (RNNoise), Noise Gate, 3-Band Equalizer, Compressor and Limiter, top to bottom.",
      "Record a test and adjust until normal talking sits around -12 dB.",
    ],
    related: ["streaming/separate-game-and-discord-audio-in-obs", "streaming/set-up-obs-for-streaming", "video/remove-filler-words-from-video"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "set-up-obs-scenes",
    niche: "streaming",
    searchPhrases: [
      "how to set up scenes in obs",
      "obs scenes for streaming",
      "obs automatic scene switcher",
      "obs scene transitions",
      "how to switch scenes in obs with hotkeys",
    ],
    title: "How to set up scenes in OBS and switch with one key",
    description:
      "Starting, gameplay, chatting, break and ending scenes in OBS, with hotkeys, fades and automatic muting. Stella (stella.sh) builds the whole set for you.",
    h1: "Set up scenes in OBS",
    short: "Set up OBS scenes",
    lede: "From opening countdown to goodnight, each part of the show one key away.",
    answer:
      "A stream usually needs five scenes: starting, gameplay, just chatting, break and ending. Stella (stella.sh) builds them in OBS around the pictures you like, then adds hotkeys, transitions and muting.",
    gets: [
      "A live countdown on the opening scene",
      "Mic and camera off by themselves on breaks",
      "A hotkey per scene, or switching by which game is open",
    ],
    prompt:
      "Build me proper OBS scenes: starting with a 5 minute countdown, gameplay, just chatting, be right back and ending. Mute my mic on breaks and give me hotkeys.",
    demo: {
      ack: "Nice. Building the five and wiring up the keys.",
      task: "Building your five OBS scenes",
      rows: ["Reusing your game, camera and mic", "Adding a 5 minute countdown", "Muting the mic on breaks", "Setting Ctrl+Alt+1 to 5 as scene keys"],
      reply:
        "All five scenes are in a new collection called **Stream show**. Ctrl+Alt+1 starts the countdown, Ctrl+Alt+4 is your break with mic and camera off. Your old scenes are in the old collection.",
    },
    faq: [
      ["Can OBS switch scenes by itself?", "Yes. Tools > Automatic Scene Switcher changes scene when a chosen window, such as your game, comes to the front."],
      ["What's the difference between scenes and sources?", "A source is one thing, like your webcam. A scene is an arrangement of sources that viewers see."],
    ],
    byHand: [
      "Click + under Scenes for each one, then add sources to it.",
      "Use Add Existing for your webcam and mic so every scene shares them.",
      "Assign keys under Settings > Hotkeys, and pick a fade under Scene Transitions.",
    ],
    related: ["design/make-twitch-overlays", "streaming/add-chat-and-alerts-to-obs", "streaming/set-up-obs-for-streaming"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "add-chat-and-alerts-to-obs",
    niche: "streaming",
    searchPhrases: [
      "how to add chat to obs",
      "how to set up alerts on obs",
      "obs chat overlay not working",
      "streamlabs alerts not working in obs",
      "how to set up youtube alerts obs",
    ],
    title: "How to add chat and alerts to OBS, and get them working",
    description:
      "Show live chat on screen and make follow, sub and donation alerts go off. Stella (stella.sh) connects them to OBS for Twitch or YouTube and tests each one.",
    h1: "Add chat and alerts to OBS",
    short: "Add chat and alerts to OBS",
    lede: "Viewers see their messages, and every new follower gets a moment.",
    answer:
      "Chat and alerts come from a free service such as StreamElements or Streamlabs, shown inside OBS as a web page. Stella (stella.sh) links your channel, puts both on your scenes and sends a test of each.",
    gets: [
      "Live chat on screen, sized so people can read it",
      "Follow, sub and donation alerts with sound viewers hear",
      "A chat panel for you, hidden from viewers",
    ],
    prompt:
      "Show my Twitch chat on the left of my stream and make alerts pop up for follows and subs. My old Streamlabs alerts stopped showing.",
    demo: {
      ack: "Sure thing. Seeing why the old alerts went quiet.",
      task: "Connecting Twitch chat and alerts",
      rows: ["Old alert link belonged to a reset account", "Adding your new alert link", "Placing chat on the left", "Sending test follow and sub"],
      reply:
        "Chat sits down the left of your gameplay scene and alerts appear top centre with sound. The old link had expired when your Streamlabs account was reset, so I replaced it. You also have a private chat panel in OBS.",
    },
    faq: [
      ["Why do test alerts work but real ones don't?", "The service has lost its link to your channel. Reconnect Twitch or YouTube in its account settings."],
      ["Why do alerts have no sound on stream?", "Open the alert's properties in OBS, tick Control audio via OBS, then check its slider isn't muted."],
    ],
    byHand: [
      "Sign in to [StreamElements](https://streamelements.com) or [Streamlabs](https://streamlabs.com) with your channel.",
      "Copy the chat and alert links into OBS as Browser sources.",
      "Press the test buttons there and check they show in OBS.",
    ],
    related: ["design/make-twitch-overlays", "streaming/set-up-obs-scenes", "streaming/stream-to-twitch-and-youtube"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "stream-to-twitch-and-youtube",
    niche: "streaming",
    searchPhrases: [
      "stream to twitch and youtube at the same time",
      "how to stream on twitch and youtube at the same time obs",
      "obs multistream",
      "obs multistream plugin",
      "stream on kick and twitch at the same time",
    ],
    title: "Stream to Twitch and YouTube at the same time with OBS",
    description:
      "Go live on Twitch, YouTube and Kick together from one OBS. Stella (stella.sh) adds multistreaming, links each channel and sizes it to your internet.",
    h1: "Stream to Twitch and YouTube at the same time",
    short: "Stream to Twitch and YouTube",
    lede: "One press of Start Streaming, live on every channel you have.",
    answer:
      "OBS streams to one place on its own, and a free multistream plugin adds the others. Stella (stella.sh) installs it, links your channels and splits your upload speed between them so none of them stutters.",
    gets: [
      "Twitch, YouTube and Kick from the same scenes",
      "Everything starting and stopping together",
      "Both chats side by side in OBS",
    ],
    prompt:
      "I stream on Twitch and want to go live on YouTube and Kick as well, without paying for Restream. My upload is 30 Mbps.",
    demo: {
      ack: "Great, 30 Mbps is enough to work with.",
      task: "Adding YouTube and Kick to OBS",
      rows: ["Installing the Aitum Multistream plugin", "Sharing out your 30 Mbps upload", "Linking YouTube and Kick as you sign in"],
      reply:
        "Start Streaming now goes live on Twitch, YouTube and Kick together at 6,000 kbps each, so about 18 of your 30 Mbps. All three chats are docked on the right in OBS.",
    },
    faq: [
      ["Does Twitch allow multistreaming?", "Yes. Since 2023 Twitch lets streamers go live elsewhere too, unless they've signed an exclusive deal."],
      ["How much upload do I need to multistream?", "Add up the bitrate of every channel and leave about a third spare. Two 6,000 kbps streams fit in 20 Mbps."],
    ],
    byHand: [
      "Install [Aitum Multistream](https://github.com/Aitum/obs-aitum-multistream/releases) or [Multiple RTMP Outputs](https://github.com/sorayuki/obs-multi-rtmp) in OBS.",
      "Add YouTube and Kick with the stream keys from their dashboards.",
      "Share the stream encoder where possible so your PC only encodes once.",
    ],
    related: ["streaming/best-obs-settings-for-streaming", "streaming/add-chat-and-alerts-to-obs", "streaming/set-up-obs-for-streaming"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "obs-replay-buffer",
    niche: "streaming",
    searchPhrases: [
      "obs replay buffer",
      "how to clip last 30 seconds on obs",
      "how to clip on pc while gaming",
      "obs replay buffer not working",
      "how to set up obs for clipping",
    ],
    title: "OBS replay buffer: clip the last 30 seconds on PC",
    description:
      "Press one key and the last 30 seconds of your game is saved as a video. Stella (stella.sh) sets up the OBS replay buffer, the hotkey and a tidy clips folder.",
    h1: "OBS replay buffer: clip the last 30 seconds",
    short: "Clip the last 30 seconds in OBS",
    lede: "Something amazing happens, you press a key, and it's already saved.",
    answer:
      "The replay buffer keeps the last moments of your game in memory and saves them when you press a key. Stella (stella.sh) turns it on in OBS, picks a free hotkey and starts it with your PC.",
    gets: [
      "Any length you like, from 15 seconds to a few minutes",
      "A hotkey that works mid-match, even in full screen",
      "Clips named and sorted by date",
    ],
    prompt:
      "Make it so pressing one key saves the last 30 seconds of Rocket League as a clip, with my mic and Discord in it. I always forget to hit record.",
    demo: {
      ack: "Love it. Setting that up in OBS.",
      task: "Setting up one-key clips",
      rows: ["Replay length set to 30 seconds", "F9 is free in Rocket League", "OBS opens quietly with Windows"],
      reply:
        "Press **F9** any time and the last 30 seconds lands in Videos/Clips, with game, mic and Discord sound. OBS opens minimised when you sign in, with the replay buffer already running.",
    },
    faq: [
      ["Why isn't my replay buffer saving?", "It has to be running first. Click Start Replay Buffer, and check a Save Replay hotkey is set."],
      ["Does the replay buffer slow down my game?", "Barely, when your graphics card does the encoding. It mostly uses some memory."],
    ],
    byHand: [
      "Settings > Output > Replay Buffer: enable it and choose the length.",
      "Settings > Hotkeys: set Save Replay.",
      "Click Start Replay Buffer before you play.",
    ],
    related: ["video/make-gaming-montage", "video/twitch-clips-to-tiktok", "streaming/best-obs-settings-for-recording"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "best-obs-settings-for-recording",
    niche: "streaming",
    searchPhrases: [
      "best obs settings for recording",
      "best obs settings for recording 1080p 60fps",
      "how to record gameplay on pc with obs",
      "obs recording blurry",
      "obs recording file size too big",
    ],
    title: "Best OBS settings for recording gameplay, small files",
    description:
      "Sharp gameplay recordings that don't fill the drive. Stella (stella.sh) sets OBS recording for your graphics card, with safe files and separate sound tracks.",
    h1: "Best OBS settings for recording gameplay",
    short: "Record gameplay with OBS",
    lede: "Crisp 1080p or 1440p footage that doesn't eat the disk.",
    answer:
      "Great recordings come from a quality target rather than a fixed bitrate, a newer video format and your graphics card doing the work. Stella (stella.sh) sets OBS up that way and saves where you have space.",
    gets: [
      "Your screen's full resolution at 60 fps",
      "Files that survive a crash and open in your editor",
      "Mic and game on separate tracks for editing",
    ],
    prompt:
      "My OBS recordings look blurry and an hour takes 40 GB. I want sharp 1440p 60 of Elden Ring for YouTube, saved on my D drive.",
    demo: {
      ack: "Okay. Looking at how OBS records now.",
      task: "Setting up sharp 1440p recording",
      rows: ["Canvas was shrunk to 1080p", "RTX 4070 can record AV1", "Switching to constant quality", "Pointing recordings to D:"],
      reply:
        "OBS now records Elden Ring at your full 1440p, 60 fps, in AV1 with a constant quality target, so quiet scenes take far less space. Files are MP4, two sound tracks, in D:/Recordings.",
    },
    faq: [
      ["Why is my OBS recording blurry?", "Usually the output is scaled down or the bitrate is too low. Match Base and Output resolution, then record with CQP or CRF."],
      ["MKV or MP4 in OBS?", "Hybrid MP4, the default since OBS 32. It keeps the recording if OBS crashes and opens in editors like a normal MP4."],
    ],
    byHand: [
      "Settings > Output > Advanced > Recording: choose a hardware HEVC or AV1 encoder.",
      "Rate control: CQP around 20. A higher number means smaller files.",
      "Settings > Video: make Base and Output resolution the same.",
    ],
    related: ["video/edit-raw-footage-into-youtube-video", "streaming/obs-replay-buffer", "streaming/separate-game-and-discord-audio-in-obs"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "capture-card-obs-setup",
    niche: "streaming",
    searchPhrases: [
      "capture card obs setup",
      "how to stream ps5 on obs",
      "capture card obs no audio",
      "how to stream switch on twitch with capture card",
      "capture card obs audio delay",
    ],
    title: "Capture card OBS setup: stream PS5, Xbox or Switch",
    description:
      "Get your PS5, Xbox or Switch into OBS with picture, sound and no delay. Stella (stella.sh) sets up the capture card, fixes silent audio and lines it all up.",
    h1: "Capture card OBS setup for PS5, Xbox or Switch",
    short: "Capture card and console in OBS",
    lede: "Your console's picture and sound in OBS, in step with your mic.",
    answer:
      "The console plugs into the card, the card into your PC, and OBS adds it as a video device. Stella (stella.sh) chooses the right picture mode, brings the game sound in and lines it up with your voice.",
    gets: [
      "Picture at the best mode your card supports",
      "Console sound in OBS and in your headphones",
      "Mic and game in sync on stream",
    ],
    prompt:
      "I plugged my Elgato HD60 X between my PS5 and PC. OBS shows nothing and there's no sound. Get it streaming to Twitch.",
    demo: {
      ack: "First, on the PS5: Settings, System, HDMI, turn off HDCP.",
      task: "Getting the PS5 into OBS",
      rows: ["Card found, picture now arriving", "Setting 1080p at 60 fps", "Adding the card's sound", "Matching mic delay to the game"],
      reply:
        "Your PS5 is in OBS at 1080p60 with game sound, and you hear it in your headset too. I delayed your mic slightly so it matches the picture. Your Twitch scene is called **PS5**.",
    },
    faq: [
      ["Can I stream PS5 on OBS without a capture card?", "Yes. Use Sony's PS Remote Play app on your PC, then capture its window in OBS."],
      ["Why is there no sound from my capture card?", "In its OBS properties, set Audio Output Mode to Capture audio only and choose the card under custom audio device."],
    ],
    byHand: [
      "Plug the card into a USB 3 socket and the console into its HDMI In.",
      "Add a Video Capture Device in OBS and choose the card.",
      "PS5: turn off Enable HDCP under Settings > System > HDMI.",
    ],
    related: ["streaming/set-up-obs-for-streaming", "streaming/obs-black-screen", "streaming/separate-game-and-discord-audio-in-obs"],
    lastChecked: "2026-11-24",
  }),
  shortGuide({
    slug: "obs-virtual-camera",
    niche: "streaming",
    searchPhrases: [
      "obs virtual camera",
      "obs virtual camera not showing up in discord",
      "obs virtual camera not showing up in zoom",
      "how to set up obs virtual camera",
      "obs virtual camera not working",
    ],
    title: "OBS virtual camera for Zoom and Discord (or not showing up)",
    description:
      "Use your OBS scene as your webcam in Zoom, Discord, Teams or Meet. Stella (stella.sh) turns on the virtual camera and fixes it when it's not showing up.",
    h1: "OBS virtual camera for Zoom, Discord and Teams",
    short: "OBS virtual camera",
    lede: "Your OBS scene as your webcam, on any call.",
    answer:
      "OBS can act as a webcam, so calls see your scene, background or slides instead of the plain camera. Stella (stella.sh) builds the scene, starts the virtual camera and picks it in your call app.",
    gets: [
      "Your webcam framed with a background or slides",
      "OBS listed as a camera in your call app",
      "A shortcut that opens OBS with it already on",
    ],
    prompt:
      "I want my OBS scene as my camera in Discord and Zoom, but OBS Virtual Camera isn't in the list. Make it show up.",
    demo: {
      ack: "Right, finding out why they don't see it.",
      task: "Turning on the OBS virtual camera",
      rows: ["Virtual camera wasn't started", "Discord was open before OBS", "Adding a call scene"],
      reply:
        "OBS Virtual Camera is now in both lists, and Discord and Zoom are set to use it. There's a Calls scene with your webcam and a soft background, plus a desktop shortcut that starts OBS with the camera on.",
    },
    faq: [
      ["Does the OBS virtual camera send sound?", "No, only the picture. Keep your normal mic selected in the call."],
      ["Why am I flipped in Discord?", "Discord mirrors your own preview. Everyone else sees it the right way round."],
    ],
    byHand: [
      "Click Start Virtual Camera in OBS, then fully quit and reopen the call app.",
      "Choose OBS Virtual Camera as the camera there.",
      "On a Mac, allow OBS under System Settings > General > Login Items & Extensions > Camera Extensions.",
      "On Linux, install v4l2loopback first.",
    ],
    related: ["streaming/obs-black-screen", "streaming/set-up-obs-scenes", "streaming/make-mic-sound-better-in-obs"],
    lastChecked: "2026-11-24",
  }),
];
