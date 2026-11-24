import { PROOFS, webCuts } from "../media";
import type { ProblemPage } from "../types";

export const TORRENTING_PAGES: ProblemPage[] = [
  {
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
      "Install qBittorrent, set a save folder, seeding limit and queue, download a torrent and check the file against its signed checksum, or let Stella (stella.sh) do it.",
    h1: "How to torrent with qBittorrent",
    short: "Set up qBittorrent and download a torrent",
    lede: "qBittorrent set up, a Debian ISO downloaded through it, and its checksum verified.",
    answer:
      "Install qBittorrent, the free open-source torrent client with no ads, from qbittorrent.org. Set a download folder, a seeding ratio limit and an upload cap in Tools → Options, open a .torrent file or magnet link, and when it finishes, check the file against the publisher's checksum. Stella (stella.sh) does all of it on your own computer: here it installed qBittorrent 5.3.0 without admin rights, downloaded Debian 13.8.0 through it and verified the ISO against Debian's signed checksums.",
    stellaSteps: [
      "Installs qBittorrent 5.3.0 from qbittorrent.org into your home folder (here there were no admin rights, so it used the AppImage)",
      "Sets it up: Downloads as the save folder, unfinished files kept in a separate folder, three downloads at a time, uploads capped at 1 MiB/s and seeding stopped at ratio 1",
      "Finds the current Debian netinst torrent on cdimage.debian.org and downloads it through qBittorrent",
      "Checks the ISO against Debian's SHA256SUMS and checks that list's signature with Debian's CD signing key",
      "Closes qBittorrent and links you to the finished, verified ISO",
    ],
    prompt:
      "Install qBittorrent with sensible settings, then use it to download the latest Debian installer ISO (the small netinst one) and check it's genuine. Just tell me where the file is and whether it checked out.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-24",
      platform: "Linux",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In about 7 and a half minutes Stella installed qBittorrent 5.3.0, downloaded debian-13.8.0-amd64-netinst.iso through it and verified it against Debian's signed SHA256SUMS. Checked afterwards by us: the torrent is in qBittorrent's own resume store, the ISO's SHA-256 is 3770c7a5…931e as Debian publishes, and the saved settings have a seeding limit and encryption left on.",
      note: "Recorded in a Linux home folder with no admin rights. The wait is sped up 60×.",
      video: {
        src: `${PROOFS}/torrenting/set-up-qbittorrent/proof.mp4`,
        cuts: webCuts("torrenting/set-up-qbittorrent"),
        poster: `${PROOFS}/torrenting/set-up-qbittorrent/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 35.5,
        speed: 60,
        realDuration: 450,
      },
      moments: [
        { at: 0, text: "Stella on a Linux computer with no torrent client and no admin password." },
        { at: 6, text: "The prompt: install qBittorrent with sensible settings, download the Debian netinst ISO and check it's genuine." },
        { at: 12.7, text: "Stella says it's installing qBittorrent, then downloading and checking the image." },
        { at: 16.7, text: "Installing qBittorrent, downloading the torrent through it and checking the signatures, sped up 60×." },
        { at: 24, text: "Done: debian-13.8.0-amd64-netinst.iso in Downloads, matching Debian's checksums, which are signed by Debian's own key." },
        { at: 27, text: "The seeding settings it chose: uploads capped at 1 MiB/s, stopping at ratio 1." },
      ],
    },
    manualTitle: "Set it up yourself",
    manualSteps: [
      {
        title: "Install qBittorrent",
        body: "Download it from [qbittorrent.org/download](https://www.qbittorrent.org/download): the 64-bit installer on Windows, the .dmg on a Mac, the AppImage on Linux (or `sudo apt install qbittorrent`, or `flatpak install flathub org.qbittorrent.qBittorrent`). Start it.",
      },
      {
        title: "Choose where files go",
        body: "Open Tools → Options (on a Mac, the qBittorrent menu's settings, ⌘,). Under Downloads, set Default Save Path, tick \"Use another path for incomplete torrents\" and pick a separate folder, which keeps half-finished files apart from finished ones.",
      },
      {
        title: "Set seeding and queue limits",
        body: "Under BitTorrent, leave Encryption mode on \"Allow encryption\", turn on Torrent Queueing with 3 maximum active downloads, and under Seeding Limits tick \"When ratio reaches\" 1.00, then Stop torrent. Under Speed, set a Global Upload limit (1024 KiB/s keeps your connection usable). Under Connection, leave \"Use UPnP / NAT-PMP port forwarding from my router\" on for more peers.",
      },
      {
        title: "Add the torrent",
        body: "Get the .torrent from the publisher, for Debian [cdimage.debian.org/debian-cd/current/amd64/bt-cd/](https://cdimage.debian.org/debian-cd/current/amd64/bt-cd/) (`debian-13.8.0-amd64-netinst.iso.torrent`). In qBittorrent use File → Add Torrent File (Ctrl+O), or File → Add Torrent Link for a magnet link. Pick the folder in the dialog and click OK; it shows Downloading, then Seeding.",
      },
      {
        title: "Check the file is genuine",
        body: "Download `SHA256SUMS` and `SHA256SUMS.sign` from the same folder. Linux: `sha256sum -c --ignore-missing SHA256SUMS` should say `OK`. Mac: `shasum -a 256 debian-13.8.0-amd64-netinst.iso`. Windows PowerShell: `Get-FileHash .\\debian-13.8.0-amd64-netinst.iso -Algorithm SHA256`. Compare with the line in SHA256SUMS. Then check the list itself: `gpg --keyserver keyring.debian.org --recv-keys DF9B9C49EAA9298432589D76DA87E80D6294BE9B` and `gpg --verify SHA256SUMS.sign SHA256SUMS` should say \"Good signature from Debian CD signing key\" (Gpg4win on Windows, GPG Suite on a Mac).",
      },
      {
        title: "Stop sharing when you're done",
        body: "A finished torrent keeps seeding until it hits your ratio limit. To stop now, right-click it → Remove and leave \"Also remove the content files\" unticked: the file stays, the torrent goes.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What is the best torrent client?",
        a: "qBittorrent for most people: free, open source, no ads, the same on Windows, Mac and Linux, with a search tab, RSS downloading and a web interface built in. Transmission is a lighter choice on a Mac or Linux.",
      },
      {
        q: "How do I use qBittorrent to download?",
        a: "Open a .torrent file with File → Add Torrent File, or paste a magnet link in File → Add Torrent Link, pick the save folder and click OK. The file appears in your save folder when the status turns to Seeding.",
      },
      {
        q: "How do I torrent on a Mac?",
        a: "The same way: install the qBittorrent .dmg from qbittorrent.org, drag it to Applications, and open it from there. Settings live in the qBittorrent menu (⌘,) instead of Tools → Options.",
      },
      {
        q: "How do I torrent safely?",
        a: "Install the client from its own site, take the .torrent from the publisher's own page, and compare the finished file with the published checksum, as above. To keep your IP address out of the swarm, bind qBittorrent to a VPN under Tools → Options → Advanced → Network interface.",
      },
      {
        q: "How do I use the qBittorrent search engine?",
        a: "View → Search Engine adds a Search tab. It needs Python installed, and you add search plugins with Search plugins… → Install a new one.",
      },
      {
        q: "Does Stella need admin rights to install qBittorrent?",
        a: "No. Without them it installs qBittorrent in your home folder, as in the recording; with them it uses the normal installer or package.",
      },
    ],
    related: ["torrenting/fix-qbittorrent-stalled", "torrenting/speed-up-qbittorrent", "torrenting/create-a-torrent-file"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "qBittorrent: download", href: "https://www.qbittorrent.org/download" },
      { label: "qBittorrent wiki: explanation of options", href: "https://github.com/qbittorrent/qBittorrent/wiki/Explanation-of-Options-in-qBittorrent" },
      { label: "Debian: downloading Debian USB/CD/DVD images via BitTorrent", href: "https://www.debian.org/CD/torrent-cd/" },
      { label: "Debian: verifying authenticity of Debian images", href: "https://www.debian.org/CD/verify" },
      { label: "Debian netinst torrents (amd64)", href: "https://cdimage.debian.org/debian-cd/current/amd64/bt-cd/" },
      { label: "Flathub: qBittorrent", href: "https://flathub.org/apps/org.qbittorrent.qBittorrent" },
    ],
  },
  {
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
      "qBittorrent stalled at 0%? Check the tracker message, IP filter, banned addresses, encryption and bound interface in turn, or have Stella (stella.sh) find and fix it.",
    h1: "qBittorrent stalled and not downloading",
    short: "Fix stalled qBittorrent downloads",
    lede: "Every stalled download traced to its cause, fixed and finished.",
    answer:
      "Stalled means qBittorrent isn't receiving data from any peer. Select the torrent, open its Trackers tab and read the message, then check IP filtering, banned addresses, encryption mode, proxy and network interface in Tools → Options, all in the free qBittorrent itself. Stella (stella.sh) does the whole diagnosis on your computer: in the recording it found four separate causes in a stalled qBittorrent 5.3.0 on Windows 11, fixed them, and all three downloads finished.",
    stellaSteps: [
      "Reads the tracker notes in Documents, qBittorrent's settings and the state of each stalled torrent",
      "Finds a blocklist line that blocks every address, takes out that one line and saves the original list next to it",
      "Takes the seed's address off qBittorrent's banned list and changes encryption from Require to Allow",
      "Points the download stuck on an old tracker port at the current one",
      "Waits until all three downloads are complete, then lists what was wrong",
    ],
    prompt:
      "All my downloads in qBittorrent (in my Apps folder) just say stalled and never start. My notes about the tracker are in Documents. Find out why and fix it so they finish, then just give me a one-line list of what was wrong.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In 2 minutes 24 seconds Stella found four planted faults and all three downloads finished. Checked afterwards by us: every piece hash in all three is right, both Alpine Linux files match Alpine's published SHA-256, and the rest of the blocklist is still on.",
      note: "The downloads are Alpine Linux and the public-domain cartoon Popeye for President (Internet Archive), served by a test tracker and seed on the same computer. The wait is sped up 30×.",
      video: {
        src: `${PROOFS}/torrenting/fix-qbittorrent-stalled/proof.mp4`,
        cuts: webCuts("torrenting/fix-qbittorrent-stalled"),
        poster: `${PROOFS}/torrenting/fix-qbittorrent-stalled/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 30.43,
        speed: 30,
        realDuration: 144,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11, with qBittorrent running and three downloads stalled at 0%." },
        { at: 4, text: "The prompt: find out why the downloads are stalled and fix them so they finish." },
        { at: 9.7, text: "Stella starts checking qBittorrent against the tracker notes in Documents." },
        { at: 14.2, text: "Finding the causes, fixing them and waiting for the downloads, sped up 30×." },
        { at: 19, text: "All three finished. What was wrong: a blocklist line, a banned address, an old tracker port and required encryption." },
        { at: 22, text: "Only the one blocklist line was removed, with the original list saved beside it." },
      ],
    },
    manualTitle: "Fix it yourself",
    manualSteps: [
      {
        title: "Read the tracker message",
        body: "Click the stalled torrent and open the Trackers tab at the bottom. \"Not working\" comes with a message: a timeout or \"connection refused\" points at your connection or a moved tracker, \"unregistered torrent\" means the tracker no longer lists it. If the address changed, right-click the torrent → Edit trackers… and put in the current one, then Force reannounce.",
      },
      {
        title: "Check that there are seeds",
        body: "In the Seeds column, `0 (0)` means nobody with the full file is online, so add more trackers or leave it running. `0 (25)` means seeds exist and something on your side is stopping the connection: carry on with the next steps.",
      },
      {
        title: "Look at IP filtering and bans",
        body: "Open Tools → Options → Connection. Under IP Filtering, untick the filter path and click Apply. If the torrent starts, open the list in a text editor and delete the range that covers too much, such as `0.0.0.0-255.255.255.255`, then turn it back on. Click \"Manually banned IP addresses…\" and remove any you didn't mean to ban.",
      },
      {
        title: "Set encryption to Allow",
        body: "In Tools → Options → BitTorrent, set Encryption mode to \"Allow encryption\". \"Require encryption\" turns away every peer that doesn't use it, which in a small swarm can be all of them.",
      },
      {
        title: "Check the proxy and the network interface",
        body: "In Options → Connection, set Proxy Server to (None) if the proxy is no longer running. In Options → Advanced, look at Network interface: if it names a VPN that is switched off or reinstalled, connect it or pick the new one, and restart qBittorrent. Linux and Mac use the same two pages; on a Mac they open with ⌘,.",
      },
      {
        title: "Unstick \"Downloading metadata\"",
        body: "A magnet link needs at least one peer before it can list its files. In Options → BitTorrent tick DHT, Peer Exchange and Local Peer Discovery, add the torrent's trackers with Edit trackers…, and then Force reannounce. Private trackers need their own announce URL here.",
      },
      {
        title: "Free up the queue and the disk",
        body: "In Options → BitTorrent → Torrent Queueing, tick \"Do not count slow torrents in these limits\" so dead downloads stop holding the slots. Make sure the save drive has room, and right-click → Force recheck if files were moved.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What does stalled mean in qBittorrent?",
        a: "Stalled on a download means it has started and no peer is sending data right now. Stalled on a finished torrent (seeding) means nobody is asking you for it at the moment, which is normal.",
      },
      {
        q: "Why is qBittorrent stalled even with seeds?",
        a: "Seeds are listed by the tracker, and qBittorrent still has to reach them. A blocklist, a ban, Require encryption, a dead proxy or an interface that no longer exists each block the connection while the seed count stays the same.",
      },
      {
        q: "Why is qBittorrent stuck on downloading metadata?",
        a: "It can't find a peer to get the file list from. Turn on DHT and Peer Exchange, add working trackers to the torrent, or use the .torrent file, which already contains the list.",
      },
      {
        q: "Why is qBittorrent stalled with a VPN?",
        a: "Usually qBittorrent is bound to an interface name the VPN no longer uses. Pick the current adapter under Options → Advanced → Network interface and restart qBittorrent.",
      },
      {
        q: "Can Stella fix the stall without starting the downloads again?",
        a: "Yes. It changes the setting that blocks them and the same torrents carry on from where they were, as the three in the recording did.",
      },
    ],
    related: ["torrenting/speed-up-qbittorrent", "torrenting/set-up-qbittorrent", "torrenting/convert-magnet-link-to-torrent-file", "torrenting/move-qbittorrent-to-new-drive-or-computer"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "qBittorrent wiki: explanation of options", href: "https://github.com/qbittorrent/qBittorrent/wiki/Explanation-of-Options-in-qBittorrent" },
      { label: "qBittorrent 5.3.0 source: options dialog labels", href: "https://github.com/qbittorrent/qBittorrent/blob/release-5.3.0/src/gui/optionsdialog.ui" },
      { label: "qBittorrent wiki: frequently asked questions", href: "https://github.com/qbittorrent/qBittorrent/wiki/Frequently-Asked-Questions" },
      { label: "Alpine Linux downloads", href: "https://alpinelinux.org/downloads/" },
      { label: "Internet Archive: Popeye for President", href: "https://archive.org/details/Popeye_forPresident" },
    ],
  },
  {
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
      "Fix slow qBittorrent downloads: alternative speed limits, the scheduler, global and per-torrent limits, connections and ports, or have Stella (stella.sh) find it.",
    h1: "qBittorrent slow download speed",
    short: "Speed up qBittorrent downloads",
    lede: "48 KiB/s to 9.5 MiB/s, by finding every limit that was holding a download back.",
    answer:
      "Slow qBittorrent downloads usually come from a limit: the alternative speed limits (the speedometer icon in the status bar), the schedule that switches them on, the global rate limits, or a limit on the torrent itself. Check each in Tools → Options → Speed and in the torrent's own options, all in the free qBittorrent. Stella (stella.sh) finds them on your computer and measures the result: in the recording it took a download from 48 KiB/s to about 9.5 MiB/s.",
    stellaSteps: [
      "Measures the speed of the running download and reads your notes on what the connection can do",
      "Finds the limits stacked on it: scheduled alternative limits at 50 KiB/s, 120 KiB/s on the torrent, 300 KiB/s globally",
      "Turns the schedule and the alternative limits off and clears the global and per-torrent limits",
      "Leaves the rest of the setup as your notes ask, then lets the download finish",
      "Tells you what it was and the speed before and after",
    ],
    prompt:
      "qBittorrent (in my Apps folder) downloads way too slowly. My notes about the setup are in Documents. Find what's slowing it down, fix it, let the download finish, and just tell me what it was and the speed before and after.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In 3 minutes Stella found the stacked limits, removed them and let the download finish. Checked afterwards by us: the seed's own log shows up to 9.5 MiB/s over 10 seconds against about 50 KiB/s before, and the Debian ISO matches Debian's published SHA-256.",
      note: "The download is the Debian 13.8.0 netinst ISO from a test seed on the same computer, capped at 10 MB/s. The wait is sped up 34×.",
      video: {
        src: `${PROOFS}/torrenting/speed-up-qbittorrent/proof.mp4`,
        cuts: webCuts("torrenting/speed-up-qbittorrent"),
        poster: `${PROOFS}/torrenting/speed-up-qbittorrent/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 31.67,
        speed: 34,
        realDuration: 180,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11, with qBittorrent downloading a Debian ISO at about 50 KiB/s." },
        { at: 4, text: "The prompt: find what's slowing the download down, fix it, and give the speed before and after." },
        { at: 9.7, text: "Stella starts on the bottleneck." },
        { at: 14.2, text: "Finding the limits, removing them and letting the 795 MB ISO finish, sped up 34×." },
        { at: 19.2, text: "The cause: three download limits stacked on top of each other, at 50, 120 and 300 KiB/s." },
        { at: 24, text: "Before 48 KiB/s, after about 9.5 MiB/s, roughly 200 times faster." },
      ],
    },
    manualTitle: "Speed it up yourself",
    manualSteps: [
      {
        title: "Compare with your real connection",
        body: "Run a speed test in the browser and divide the megabits by 8: 100 Mbit/s is about 12 MB/s. If the torrent's Seeds column shows only one or two, the torrent itself is the limit, so try it with a well-seeded one, such as a [Debian netinst](https://cdimage.debian.org/debian-cd/current/amd64/bt-cd/).",
      },
      {
        title: "Switch off alternative limits and their schedule",
        body: "Untick Tools → Alternative Speed Limits, or click its icon in the status bar. Then open Tools → Options → Speed and untick \"Schedule the use of alternative rate limits\", so it stays off when the clock comes round.",
      },
      {
        title: "Clear the global and per-torrent limits",
        body: "In Options → Speed → Global Rate Limits set Download to 0 (no limit). Then right-click the torrent → Torrent options… and set its download limit to 0 too. The lowest of all the limits wins, so one left behind still holds the download down.",
      },
      {
        title: "Keep some upload",
        body: "Set the upload limit to roughly 80% of your measured upload speed. Peers send more to clients that send back, and a full upload line slows the downloads too.",
      },
      {
        title: "Raise the connection limits",
        body: "In Options → Connection → Connections Limits use 500 for \"Global maximum number of connections\" and 100 for \"Maximum number of connections per torrent\". Under BitTorrent, tick DHT, Peer Exchange and Local Peer Discovery, and set Encryption mode to \"Allow encryption\".",
      },
      {
        title: "Open the port",
        body: "In Options → Connection keep \"Use UPnP / NAT-PMP port forwarding from my router\" ticked, or forward the listening port by hand. The connection icon in the status bar turns green when peers can reach you, which adds connections in both directions.",
      },
      {
        title: "Check the queue and the disk",
        body: "Under Options → BitTorrent → Torrent Queueing, tick \"Do not count slow torrents in these limits\". Save to a local SSD instead of a network share, and stop other downloads to see which one is using the line. These settings are the same on Windows, Mac and Linux.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why is qBittorrent so slow?",
        a: "Most often a limit is on somewhere: the alternative limits, the scheduler, the global limit or one set on the torrent. After that come too few seeds, a closed port, or a slow save drive.",
      },
      {
        q: "What are the best qBittorrent settings for faster downloads?",
        a: "No download limit, upload at about 80% of your line, 500 connections globally and 100 per torrent, DHT and Peer Exchange on, Allow encryption, and an open port.",
      },
      {
        q: "Why does the slow speed come back after I switch it off?",
        a: "The scheduler is turning the alternative limits on again. Untick it under Options → Speed, or change its times.",
      },
      {
        q: "Does qBittorrent's rate limit apply to peers on my own network?",
        a: "It does when \"Apply rate limit to peers on LAN\" is ticked under Options → Speed → Rate Limits Settings.",
      },
      {
        q: "Can Stella measure the speed before and after?",
        a: "Yes. It reads the download speed from qBittorrent before touching anything and again when the fix is in, and gives you both numbers.",
      },
    ],
    related: ["torrenting/fix-qbittorrent-stalled", "torrenting/set-up-qbittorrent", "torrenting/download-torrents-automatically-with-rss", "torrenting/convert-magnet-link-to-torrent-file"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "qBittorrent wiki: explanation of options", href: "https://github.com/qbittorrent/qBittorrent/wiki/Explanation-of-Options-in-qBittorrent" },
      { label: "qBittorrent 5.3.0 source: options dialog labels", href: "https://github.com/qbittorrent/qBittorrent/blob/release-5.3.0/src/gui/optionsdialog.ui" },
      { label: "qBittorrent 5.3.0 source: torrent options labels", href: "https://github.com/qbittorrent/qBittorrent/blob/release-5.3.0/src/gui/torrentoptionsdialog.ui" },
      { label: "Debian netinst torrents (amd64)", href: "https://cdimage.debian.org/debian-cd/current/amd64/bt-cd/" },
    ],
  },
  {
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
      "Set up qBittorrent RSS rules that download each new release by itself: add the feed, write a precise rule, test it, or have Stella (stella.sh) do all of it for you.",
    h1: "qBittorrent RSS rules that download torrents automatically",
    short: "Automate torrents with qBittorrent RSS",
    lede: "One rule on a feed of 1,084 items that takes the right release and nothing else.",
    answer:
      "Turn on RSS in the free qBittorrent (Tools → Options → RSS), add the feed in the RSS tab, and write a download rule whose text or regular expression matches only the titles you want. Stella (stella.sh) sets it up on your own computer: in the recording it added a feed of 1,084 open-source releases, wrote a rule for Alpine Linux's x86_64 mini root filesystem and fetched the current one. When the next release appeared in the feed, qBittorrent took it by itself.",
    stellaSteps: [
      "Reads the feed address from your notes and adds it to qBittorrent",
      "Turns on RSS fetching and automatic downloading, and stores enough articles for a long feed",
      "Writes a regular-expression rule that matches the x86_64 mini root filesystem of any version, and none of the near-identical titles",
      "Lets the rule download the current release through qBittorrent",
      "Replies with the rule in one sentence and the file it got",
    ],
    prompt:
      "Set up my qBittorrent (in my Apps folder) to automatically download every new release of Alpine Linux's mini root filesystem for x86_64, and nothing else, from the torrent feed in my Documents. Get the current one now to show it works, then reply with just the rule in one sentence and the file it got.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In 1 minute 40 seconds Stella set up the feed and the rule, and the current file came in with Alpine's published SHA-256. Checked afterwards by us: the rule matches 1 of the feed's 1,084 titles, and when we published version 3.24.4 for three processor types in the feed, qBittorrent downloaded the x86_64 one and only that.",
      note: "The feed is a copy of the FOSS Torrents feed served on the same computer, with Alpine's own files behind it. The wait is sped up 30×.",
      video: {
        src: `${PROOFS}/torrenting/download-torrents-automatically-with-rss/proof.mp4`,
        cuts: webCuts("torrenting/download-torrents-automatically-with-rss"),
        poster: `${PROOFS}/torrenting/download-torrents-automatically-with-rss/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 30,
        speed: 30,
        realDuration: 100,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11, with qBittorrent running and no RSS set up." },
        { at: 4, text: "The prompt: download every new Alpine mini root filesystem for x86_64 from the feed, and nothing else." },
        { at: 10.5, text: "Stella starts setting up qBittorrent." },
        { at: 15, text: "Adding the feed, writing the rule and downloading the current release, sped up 30×." },
        { at: 18, text: "The rule: every 30 minutes, download any Alpine mini root filesystem for x86_64, and nothing else." },
        { at: 22, text: "The file it got: alpine-minirootfs-3.23.3-x86_64.tar.gz, the newest in the feed." },
      ],
    },
    manualTitle: "Set it up yourself",
    manualSteps: [
      {
        title: "Turn RSS on",
        body: "Open Tools → Options → RSS (qBittorrent → Settings on a Mac). Tick \"Enable fetching RSS feeds\" and \"Enable auto downloading of RSS torrents\". Set the refresh interval to 30 minutes, and raise \"Maximum number of articles per feed\" above the size of your feed: the default of 50 drops everything past the newest fifty.",
      },
      {
        title: "Add the feed",
        body: "Tick View → RSS Reader, open the RSS tab and click New subscription…. Paste the feed's address, for example `https://fosstorrents.com/feed/torrents.xml` for open-source software. The articles appear in the middle column.",
      },
      {
        title: "Make a rule",
        body: "Click RSS Downloader…, then the + button, and name the rule. Under \"Apply Rule to Feeds\" tick your feed. Type the words every wanted title has in Must Contain, and what to leave out in Must Not Contain. Spaces mean \"and\", `|` means \"or\", `*` stands for anything.",
      },
      {
        title: "Make it exact with a regular expression",
        body: "Plain words match inside other words, so `x86` also takes x86_64. Tick Use Regular Expressions and anchor the title, for example `^Alpine Linux [0-9]+([.][0-9]+)+ - Mini Root Filesystem [(]x86_64[)]`. The \"Matching RSS Articles\" list on the right shows at once what the rule takes.",
      },
      {
        title: "Choose where downloads go",
        body: "In the rule, set the category and the save path. For series, tick Use Smart Episode Filter so each episode comes once, or fill in Episode Filter, such as `1x01-;` for season 1 from episode 1.",
      },
      {
        title: "Test it and leave it running",
        body: "Click Apply, then right-click the feed → Update. The matching release turns up in the Transfers tab. qBittorrent has to be open to check the feed, so on Windows turn on starting at login under Options → Behavior; on Linux or a server run `qbittorrent-nox` as a service.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why is the qBittorrent RSS downloader not working?",
        a: "Usually auto downloading is off: tick both boxes under Options → RSS. Next check that the rule is ticked, that your feed is ticked inside the rule, and that the feed's length fits under the maximum number of articles.",
      },
      {
        q: "How do qBittorrent RSS rules match titles?",
        a: "Must Contain needs every word you type to be in the title, in any order, upper or lower case. With Use Regular Expressions on, the whole box is one Perl-style pattern instead.",
      },
      {
        q: "What does the episode filter do?",
        a: "`2x05-;` takes season 2 from episode 5 on; `2x05-10;` takes episodes 5 to 10. The smart filter skips an episode it has already taken.",
      },
      {
        q: "Can I download things that are already in the feed?",
        a: "Yes. A new rule goes through the unread articles already stored, as in the recording, where the current release came in straight away.",
      },
      {
        q: "Can Stella add more rules later?",
        a: "Yes. Describe what you want in a sentence, and it adds another rule to the same feed or a new one.",
      },
    ],
    related: ["torrenting/set-up-qbittorrent", "torrenting/extract-rar-after-torrent-downloads", "torrenting/fix-qbittorrent-stalled"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "qBittorrent 5.3.0 source: RSS downloader labels", href: "https://github.com/qbittorrent/qBittorrent/blob/release-5.3.0/src/gui/rss/automatedrssdownloader.ui" },
      { label: "qBittorrent 5.3.0 source: options dialog labels", href: "https://github.com/qbittorrent/qBittorrent/blob/release-5.3.0/src/gui/optionsdialog.ui" },
      { label: "FOSS Torrents", href: "https://fosstorrents.com/" },
      { label: "Alpine Linux downloads", href: "https://alpinelinux.org/downloads/" },
    ],
  },
  {
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
      "Turn messy torrent downloads into Plex's Movie (Year) and Show - s01e01 names with hard links, so seeding goes on and no space is used, or let Stella (stella.sh) do it.",
    h1: "Rename files for Plex without breaking seeding",
    short: "Rename downloads for Plex",
    lede: "Finished downloads in Plex's naming, samples and junk left out, still seeding.",
    answer:
      "Plex wants each movie as `Movies/Title (Year)/Title (Year).mkv` and each episode as `TV Shows/Show (Year)/Season 01/Show (Year) - s01e05.mkv`, with subtitles named after the video plus a language code. To keep seeding, make hard links with those names next to the untouched downloads (`mklink /H` on Windows, `ln` on Mac and Linux), which take no extra space. Stella (stella.sh) reads every download, works out the titles, years and episodes, and builds the linked library for you on your computer.",
    stellaSteps: [
      "Lists every finished download in the torrent folder and works out what each one is, including years that are only on the folder",
      "Skips anything still downloading, sample clips, .nfo and .txt files, web shortcuts and screenshots",
      "Names movies Title (Year) in their own folders and episodes Show - s01e05 under Season folders, converting styles like 1x06",
      "Hard-links each video into the Plex folders, so the library uses no extra space and the downloads stay exactly where they were",
      "Puts the subtitles beside their videos with matching names and language codes, then lists what went where",
    ],
    prompt:
      "My finished torrents are in Downloads\\Torrents. Sort the movies and TV shows into my Plex folders (Videos\\Plex\\Movies and Videos\\Plex\\TV Shows) with the names Plex wants. Skip the samples and junk, keep the subtitles. They're still seeding, so don't move or rename the downloads, and don't use up extra disk space. Just give me a short list of what went where.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In under 3 minutes Stella put 6 movies and 5 TV episodes from nine messy downloads into the Plex folders with Plex's names, each a hard link to the download, with all five subtitles beside their videos. Checked afterwards by us: every library file is the same file on disk as its download, the downloads are unchanged, and no sample, .nfo, shortcut, screenshot or unfinished file got in.",
      note: "The downloads were public-domain titles with short synthetic test clips standing in for the films; release-group names are invented. The wait is sped up 30×.",
      video: {
        src: `${PROOFS}/torrenting/rename-organize-downloads-for-plex/proof.mp4`,
        cuts: webCuts("torrenting/rename-organize-downloads-for-plex"),
        poster: `${PROOFS}/torrenting/rename-organize-downloads-for-plex/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 31.3,
        realDuration: 174,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11. Downloads\\Torrents holds nine downloads in every naming style, with samples, .nfo files and one still downloading." },
        { at: 4, text: "The prompt: sort the movies and shows into the Plex folders with Plex's names, keep seeding, use no extra space." },
        { at: 11, text: "Stella starts a task that leaves everything in Downloads\\Torrents where it is." },
        { at: 15.6, text: "Reading the downloads, naming them and hard-linking them into the library, sped up 30×." },
        { at: 19.2, text: "Done: 6 movies and 5 episodes in the Plex folders, subtitles included, taking no extra space." },
        { at: 25, text: "It skipped Nosferatu, still downloading, plus the samples and junk, and says the One Step Beyond folder has no year." },
      ],
    },
    manualTitle: "Rename them yourself",
    manualSteps: [
      {
        title: "Point Plex at two folders",
        body: "Keep movies and shows apart, for example `Videos\\Plex\\Movies` and `Videos\\Plex\\TV Shows`, and add each as its own library in Plex (Movies and TV Shows types). Keep them on the same drive as your torrent folder.",
      },
      {
        title: "Name each movie Title (Year)",
        body: "Give every movie its own folder and use the same name for the file: `Movies/His Girl Friday (1940)/His Girl Friday (1940).mp4`. Take the year from the release name; when the file is just `The General.mkv`, the folder it came in often has it. An ID such as `{imdb-tt0017925}` after the year makes the match certain.",
      },
      {
        title: "Name each episode Show - s01e05",
        body: "Episodes go in `TV Shows/Show (Year)/Season 01/`, named `Show (Year) - s01e05.mkv`; anything after the episode number is optional. Rewrite other styles such as `1x06` as `s01e06`; add the first-air year to the folder when two shows share a name.",
      },
      {
        title: "Keep the subtitles",
        body: "Put each `.srt` next to its video with the video's name plus a language code: `Night of the Living Dead (1968).en.srt`, `…(1968).es.srt`. Files in a `Subs` folder named just `English.srt` won't be picked up until you rename them like this.",
      },
      {
        title: "Hard-link instead of moving",
        body: "Renaming or moving a file qBittorrent is seeding breaks the torrent. Make a hard link with the Plex name instead: on Windows, `mklink /H \"D:\\Plex\\Movies\\Charade (1963)\\Charade (1963).mkv\" \"D:\\Torrents\\Charade.1963.1080p.mkv\"` in Command Prompt (or `New-Item -ItemType HardLink` in PowerShell); on Mac and Linux, `ln source.mkv \"Charade (1963).mkv\"`. Both names are the same file, so it takes no extra space. Subtitles can simply be copied.",
      },
      {
        title: "Leave out samples, extras and unfinished files",
        body: "Don't link files with `sample` in the name, `.nfo`, `.txt`, `.url`, screenshots, or anything ending `.!qB` or `.part` (still downloading). Then run Scan Library Files in Plex.",
      },
      {
        title: "Automate it for new downloads",
        body: "Sonarr (shows) and Radarr (movies) do this for every new download: turn on Rename Episodes or Rename Movies, and under Settings › Media Management › Importing (Show Advanced) keep Use Hardlinks instead of Copy on.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What is the right way to name files for Plex?",
        a: "Movies: `Title (Year)/Title (Year).ext`. TV: `Show (Year)/Season 01/Show (Year) - s01e01.ext`. Plex mostly needs the title and year for movies and the sXXeYY number for episodes.",
      },
      {
        q: "Can I rename files for Plex without breaking seeding?",
        a: "Yes, by hard-linking instead of renaming. The torrent client keeps its original file and Plex reads the linked name. Both point to the same data, so seeding continues and no space is used.",
      },
      {
        q: "Is there a program to rename files for Plex automatically?",
        a: "Sonarr and Radarr rename and hard-link new downloads as they finish, and they're free. For a one-off batch of existing files, Stella does it from a plain request.",
      },
      {
        q: "Why does Plex show the wrong movie or no subtitles?",
        a: "Usually the year is missing or wrong, or the subtitle isn't named after the video. Fix the name, then use Refresh Metadata, or Fix Match on the item.",
      },
      {
        q: "Do hard links work across drives?",
        a: "No. A hard link has to be on the same drive or volume as the original, and exFAT drives don't support them at all. If your library is on another drive you need a copy.",
      },
    ],
    related: ["torrenting/extract-rar-after-torrent-downloads", "torrenting/move-qbittorrent-to-new-drive-or-computer", "files-folders/rename-multiple-files-at-once"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "Plex: naming and organizing movie files", href: "https://support.plex.tv/articles/naming-and-organizing-your-movie-media-files/" },
      { label: "Plex: naming and organizing TV show files", href: "https://support.plex.tv/articles/naming-and-organizing-your-tv-show-files/" },
      { label: "Plex: adding local subtitles", href: "https://support.plex.tv/articles/200471133-adding-local-subtitles-to-your-media/" },
      { label: "Jellyfin: movie naming", href: "https://jellyfin.org/docs/general/server/media/movies/" },
      { label: "Microsoft: mklink", href: "https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/mklink" },
      { label: "TRaSH Guides: hardlinks and instant moves", href: "https://trash-guides.info/File-and-Folder-Structure/Hardlinks-and-Instant-Moves/" },
      { label: "Servarr wiki: Sonarr settings", href: "https://wiki.servarr.com/sonarr/settings" },
    ],
  },
  {
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
      "Make qBittorrent unpack finished RAR downloads into Movies, TV or Music folders by category, still seeding, with a log. Free tools, or Stella (stella.sh) sets it up.",
    h1: "Unrar qBittorrent downloads automatically",
    short: "Auto-unrar finished downloads",
    lede: "Every finished download unpacked into the right media folder, while the RARs keep seeding.",
    answer:
      "qBittorrent has no unrar of its own, but it can run a program when a download finishes: Options › Downloads › Run on torrent finished, with parameters such as `\"%F\"` (content path) and `\"%L\"` (category). Point it at a small script that unpacks the RAR set with 7-Zip or UnRAR into a folder for that category and leaves the RARs alone, so seeding continues. Stella (stella.sh) writes and tests that script, sets it in qBittorrent and processes the downloads that already finished, on your own computer.",
    stellaSteps: [
      "Reads qBittorrent's settings and categories and finds the Media folders for Movies, TV and Music",
      "Writes a script that unpacks RAR sets, old .r00 style and .part1.rar style, and copies files that aren't packed, skipping samples",
      "Gets a free RAR tool that handles split sets, without installing anything system-wide",
      "Sets the script as qBittorrent's program to run when a torrent finishes, passing the content path and category",
      "Runs it on the downloads that had already finished and checks they keep seeding, then reports where the log is",
    ],
    prompt:
      "Set up my qBittorrent (it's in Apps\\qBittorrent) so that when a download finishes, anything packed in RAR files gets unpacked into my Media folder under the download's category (Movies, TV or Music), and files that aren't packed get copied there. Skip samples, keep the downloads seeding, and keep a log. Do the ones that already finished too. Just give me a short summary when it's done.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In about 6 minutes Stella set qBittorrent to run its new unpack script on every finished download, and unpacked the three downloads already there into Media\\Movies, TV and Music with samples left out. Checked afterwards by us: we fed qBittorrent two new RAR downloads it had never seen, from a second qBittorrent on the same PC. Both were unpacked into the right category folders within seconds, kept seeding, and were named in the log.",
      note: "The downloads were RAR sets we made from synthetic test clips under public-domain titles, plus an album by an invented band; qBittorrent was a portable copy. The wait is sped up 60×.",
      video: {
        src: `${PROOFS}/torrenting/extract-rar-after-torrent-downloads/proof.mp4`,
        cuts: webCuts("torrenting/extract-rar-after-torrent-downloads"),
        poster: `${PROOFS}/torrenting/extract-rar-after-torrent-downloads/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 30.77,
        realDuration: 374,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11, with a portable qBittorrent holding three finished downloads: two RAR sets and an album." },
        { at: 4, text: "The prompt: unpack finished downloads into Media by category, skip samples, keep seeding, keep a log." },
        { at: 12.6, text: "Stella starts a task to add the unpack step and catch up on the finished downloads." },
        { at: 15.1, text: "Writing the script, fetching UnRAR, setting it in qBittorrent and testing it, sped up 60×." },
        { at: 20, text: "Done: Detour and the Sherlock Holmes episode unpacked, the album copied, all still seeding." },
        { at: 25, text: "Every new download now goes the same way, with each file noted in unpack.log." },
      ],
    },
    manualTitle: "Set it up yourself",
    manualSteps: [
      {
        title: "Get a RAR tool that handles split sets",
        body: "On Windows, install 7-Zip (`7z.exe`) or WinRAR's free command-line UnRAR (`UnRAR.exe`). On a Mac, `brew install sevenzip` gives `7zz`; on Linux, install your distribution's `unrar` or `7zip` package. Open only the first volume, `name.rar` or `name.part1.rar`; the tool finds `.r00`, `.r01` or `.part2.rar` by itself.",
      },
      {
        title: "Write the unpack script",
        body: "The script gets the content path and category, picks the destination (for example `D:\\Media\\TV\\<download name>`), then: for each first volume run `7z x -o\"<destination>\" \"<file>\"` (or `unrar x -o- \"<file>\" \"<destination>\\\"`), copy every other file except samples, `.nfo`, `.sfv` and the volumes themselves, and append a line to a log. Leave the download folder as it is, which keeps the torrent seeding. On Windows a PowerShell `.ps1` works; on Mac and Linux a shell script made executable with `chmod +x`.",
      },
      {
        title: "Give each download a category",
        body: "Create categories such as Movies, TV and Music in qBittorrent (right-click in the Categories list on the left) and set one when you add a torrent. The script uses `%L` to choose the folder; anything without a category can go to an Other folder.",
      },
      {
        title: "Run it when a torrent finishes",
        body: "In Options › Downloads tick Run on torrent finished and enter the command, with every parameter in quotes: on Windows `powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"C:\\Scripts\\unpack.ps1\" \"%F\" \"%L\" \"%N\"`, on Mac or Linux `/home/you/unpack.sh \"%F\" \"%L\" \"%N\"`. `%F` is the content path, `%L` the category, `%N` the name; `%D` (save path) and `%I` (info hash) are also available.",
      },
      {
        title: "Test it, then catch up on old downloads",
        body: "Run the same command by hand on a finished download first and read the log. Then let a small torrent finish. For downloads that finished before the setting existed, run the script once on each of their folders.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Can qBittorrent unrar automatically?",
        a: "Not by itself. It runs a program you choose when a torrent finishes, and that program does the unpacking. A script with 7-Zip or UnRAR is enough.",
      },
      {
        q: "What do %F, %L and %N mean in Run external program?",
        a: "`%F` is the content path (the file, or the folder of a multi-file torrent), `%L` the category, `%N` the torrent name. Others include `%G` tags, `%D` save path, `%R` root path, `%C` number of files, `%Z` size, `%T` tracker and `%I` info hash. Quote each one so names with spaces aren't cut off.",
      },
      {
        q: "Why does qBittorrent say it failed to run the external program?",
        a: "Usually quoting or the interpreter: a `.ps1` or `.py` needs `powershell.exe -File` or `python.exe` in front of it, paths with spaces need quotes, and on Linux the script needs to be executable. qBittorrent's Execution Log shows the command it ran.",
      },
      {
        q: "Will unpacking stop the torrent from seeding?",
        a: "No, as long as the RAR files stay where they are. Unpacking writes a new copy in your media folder and leaves the download untouched.",
      },
      {
        q: "Can it move completed files by category instead?",
        a: "Yes, without a script: give each category its own save path and turn on Automatic Torrent Management, and qBittorrent moves finished downloads there itself. That moves the files rather than unpacking them.",
      },
    ],
    related: ["torrenting/rename-organize-downloads-for-plex", "torrenting/download-from-seedbox-automatically", "files-folders/open-rar-file"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "qBittorrent wiki: external programs", href: "https://github.com/qbittorrent/qBittorrent/wiki/External-programs-How-to" },
      { label: "qBittorrent wiki: explanation of options", href: "https://github.com/qbittorrent/qBittorrent/wiki/Explanation-of-Options-in-qBittorrent" },
      { label: "7-Zip downloads", href: "https://www.7-zip.org/download.html" },
      { label: "RARLAB: UnRAR and other RAR tools", href: "https://www.rarlab.com/rar_add.htm" },
    ],
  },
  {
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
      "Every torrent says Missing Files after a move? Point qBittorrent at the new folders, keep seeding and download nothing again. By hand, or with Stella (stella.sh).",
    h1: "Fix Missing Files in qBittorrent after moving to a new drive or PC",
    short: "Fix qBittorrent Missing Files after a move",
    lede: "Every torrent back in its new folder, checked and seeding, nothing downloaded again.",
    answer:
      "Missing Files means qBittorrent is looking in the old folder. For a few torrents, right-click › Set location and then Force recheck; for a whole list, close qBittorrent and rewrite the saved paths in its `BT_backup` folder with the free qbt_migrate. Stella (stella.sh) does it on your computer for every torrent at once: it finds each one's files, checks them against the torrent, updates the paths, categories and default folders, and leaves them seeding.",
    stellaSteps: [
      "Reads qBittorrent's saved torrents, categories and settings and finds which old folders they point to",
      "Matches each torrent to its files in the new folders and checks them piece by piece against the torrent",
      "Backs up qBittorrent's settings, then writes the new folder into every torrent's resume data",
      "Moves the default save folder and each category's folder to the new locations",
      "Starts qBittorrent, confirms what is seeding, and says which download was never finished",
    ],
    prompt:
      "I moved to a new PC. I copied my qBittorrent (Apps\\qBittorrent) and my downloads over (they're now in Downloads\\Torrents and Media\\Torrents), but every torrent says Missing Files. Get them all back to how they were, seeding, without downloading anything again, and make sure new downloads go to the new folders.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In under 6 minutes all 7 torrents pointed at their new folders, with the dates, categories and tags they had. Checked afterwards by us: we started that qBittorrent and forced a full recheck. The 6 finished torrents came out 100% and seeding, the half-finished one kept its 44%, every file was unchanged, and the default and category folders were the new ones.",
      note: "The torrents were made from synthetic clips and audio under Creative Commons and public-domain titles, plus an album by an invented band; qBittorrent was a portable copy. The wait is sped up 60×.",
      video: {
        src: `${PROOFS}/torrenting/move-qbittorrent-to-new-drive-or-computer/proof.mp4`,
        cuts: webCuts("torrenting/move-qbittorrent-to-new-drive-or-computer"),
        poster: `${PROOFS}/torrenting/move-qbittorrent-to-new-drive-or-computer/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 31.2,
        realDuration: 391,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11, with a qBittorrent copied from an old PC: seven torrents, all pointing at folders that no longer exist." },
        { at: 4, text: "The prompt: get every torrent back, seeding, with nothing downloaded again, and new downloads in the new folders." },
        { at: 11, text: "Stella starts a task that holds back any torrent whose files are missing or incomplete." },
        { at: 15, text: "Matching, checking and updating each torrent, sped up 60×." },
        { at: 20.4, text: "Done: six torrents seeding again, categories and tags as they were." },
        { at: 25, text: "His Girl Friday had only reached 44% on the old PC, so it stays stopped. A backup of the old settings is kept." },
      ],
    },
    manualTitle: "Move it yourself",
    manualSteps: [
      {
        title: "Copy qBittorrent's own data, not just the downloads",
        body: "Close qBittorrent with File › Exit first. On Windows copy `%APPDATA%\\qBittorrent` (settings and categories) and `%LOCALAPPDATA%\\qBittorrent` (its `BT_backup` folder holds one `.torrent` and one `.fastresume` per torrent). On Linux it's `~/.config/qBittorrent` and `~/.local/share/qBittorrent`; on a Mac `~/.config/qBittorrent` and `~/Library/Application Support/qBittorrent`. A portable copy keeps everything in the `profile` folder next to the program. Then copy the downloads.",
      },
      {
        title: "Easiest: give the drive the same letter or path",
        body: "If only the drive letter changed, set the old letter in Disk Management (right-click the drive › Change Drive Letter and Paths) while qBittorrent is closed. On Linux, mount the drive at the same path as before. Start qBittorrent, select all (Ctrl+A) and resume: the torrents find their files.",
      },
      {
        title: "A few torrents: Set location and recheck",
        body: "Stop the torrents first so nothing starts downloading. Select the ones that belong in the same folder, right-click › Set location and choose the folder that now holds their files. Then right-click › Force recheck. Finished torrents go to 100%; resume those and they seed. One that stops short was incomplete, or its files are in another folder.",
      },
      {
        title: "The whole list: rewrite the paths with qbt_migrate",
        body: "Install Python and run `pip install qbt_migrate`. With qBittorrent closed, preview the change with `qbt_migrate -e \"D:\\Torrents\" -n \"E:\\Torrents\" -t Windows -d`, then run it without `-d`. It rewrites the paths inside every `.fastresume` file and saves a backup zip first. Run it once for each old folder when downloads were split between several. On Linux use `-t Linux`, on a Mac `-t Mac`; it can convert the slashes too when you change systems.",
      },
      {
        title: "Update where new downloads go",
        body: "In Options › Downloads set the new Default save path, and the Keep incomplete torrents in folder if you use one. In the left sidebar right-click each category › Edit category and give it its new save path, so Automatic torrent management doesn't move anything back.",
      },
      {
        title: "Check that nothing starts downloading",
        body: "Select all › Force recheck and wait until every torrent has been checked. The finished ones should show 100% and Seeding. Stop anything below 100%, find its missing files, and recheck it before you resume it.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "Why does qBittorrent say Missing Files?",
        a: "The files aren't where qBittorrent saved them: a drive got a new letter, the folder was moved or renamed outside qBittorrent, or an external drive wasn't connected when it started. Put the folder back or point the torrent to the new one.",
      },
      {
        q: "Will a Force recheck download the files again?",
        a: "No. A recheck reads the files and compares them with the torrent. Only parts that don't match are downloaded, and only while the torrent is running.",
      },
      {
        q: "How do I move torrents to another drive without losing seeding?",
        a: "Use right-click › Set location inside qBittorrent: it moves the files and keeps the torrent. If you moved the files yourself, set the new location and force a recheck.",
      },
      {
        q: "What does BT_backup hold?",
        a: "One `.torrent` and one `.fastresume` file for each torrent. The `.fastresume` stores the save path, category, tags, added date and progress, so keeping it in the new install keeps all of that.",
      },
      {
        q: "Can I move from Windows to Linux or a Mac?",
        a: "Yes. Copy the data folders, then convert the paths with `qbt_migrate`, which changes the slashes with `-t Linux` or `-t Mac`.",
      },
    ],
    related: ["torrenting/switch-utorrent-to-qbittorrent", "torrenting/extract-rar-after-torrent-downloads", "torrenting/download-from-seedbox-automatically", "files-folders/compare-two-folders"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "qBittorrent wiki: FAQ (where settings and torrents are saved)", href: "https://github.com/qbittorrent/qBittorrent/wiki/Frequently-Asked-Questions" },
      { label: "qBittorrent wiki: status of missing files at start up", href: "https://github.com/qbittorrent/qBittorrent/wiki/Status-of-Missing-files-at-start-up-or-after-restart" },
      { label: "qbt_migrate on GitHub", href: "https://github.com/jslay88/qbt_migrate" },
    ],
  },
  {
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
      "Bring every uTorrent download into qBittorrent with its label, folder and progress, and download nothing again. Free with bt2qbt, or let Stella (stella.sh) do it.",
    h1: "Switch from uTorrent to qBittorrent",
    short: "Move uTorrent to qBittorrent",
    lede: "Every torrent across with its label, folder and progress, and nothing downloaded again.",
    answer:
      "uTorrent keeps its list in `resume.dat`; qBittorrent keeps one `.fastresume` per torrent in `BT_backup`. The free bt2qbt converts one to the other, labels included: close both programs, run it, start qBittorrent and Force recheck. Stella (stella.sh) does the whole switch on your computer: it reads uTorrent's list, checks the files you already have, and brings each torrent over with its label as a category, its folder, its progress and whether it was stopped.",
    stellaSteps: [
      "Reads uTorrent's saved list with each torrent's label, folder, added date, progress and state",
      "Checks the files on disk against every torrent, so the unfinished one keeps only the parts it really has",
      "Saves a copy of qBittorrent's profile, then writes each torrent into it with the label as a category",
      "Starts qBittorrent to confirm what's complete, what's stopped and what's still partial",
      "Leaves uTorrent and the downloads untouched and says how to undo it",
    ],
    prompt:
      "I'm switching from uTorrent to qBittorrent (it's in Apps\\qBittorrent). Move all my torrents over with their labels and progress so nothing downloads again. Leave its network settings as they are, and just give me a short summary when it's done.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In about 5 minutes all 6 uTorrent downloads were in qBittorrent with their labels as categories, their folders, their added dates and the one stopped torrent still stopped. Checked afterwards by us: we started that qBittorrent and forced a full recheck. Five came out at 100%, the half-finished one kept its 46%, and every file was unchanged.",
      note: "The uTorrent list and downloads were made by us: synthetic clips under Creative Commons and public-domain titles, an album by an invented band and a made-up ISO, with a portable qBittorrent kept to this PC. The wait is sped up 55×.",
      video: {
        src: `${PROOFS}/torrenting/switch-utorrent-to-qbittorrent/proof.mp4`,
        cuts: webCuts("torrenting/switch-utorrent-to-qbittorrent"),
        poster: `${PROOFS}/torrenting/switch-utorrent-to-qbittorrent/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 30.57,
        realDuration: 334,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11, with uTorrent's saved list of six torrents and an empty portable qBittorrent." },
        { at: 4, text: "The prompt: move every torrent over with labels and progress, download nothing again, short summary." },
        { at: 11, text: "Stella starts moving the torrents, leaving qBittorrent's network settings alone." },
        { at: 14.7, text: "Reading uTorrent's list, checking files and writing them into qBittorrent, sped up 55×." },
        { at: 20, text: "Done: all six across, five at 100%, Tears of Steel at 45.8%, and one still stopped as it was." },
        { at: 25, text: "uTorrent is untouched, and the old qBittorrent profile is saved for an undo." },
      ],
    },
    manualTitle: "Switch it yourself",
    manualSteps: [
      {
        title: "Prepare both programs",
        body: "In uTorrent open Options › Preferences › General and untick Append .!ut to incomplete files, or half-finished downloads won't be recognised. Exit both programs from their menus, not just the window, and check the tray. Copy `%APPDATA%\\uTorrent`, `%APPDATA%\\qBittorrent` and `%LOCALAPPDATA%\\qBittorrent` somewhere safe.",
      },
      {
        title: "Set qBittorrent's storage to Fastresume files",
        body: "Open qBittorrent once and go to Options › Advanced › Resume data storage type and choose Fastresume files, which bt2qbt needs on qBittorrent 5. Exit it again.",
      },
      {
        title: "Run bt2qbt",
        body: "Download bt2qbt from its GitHub releases page and double-click it. By default it reads `%APPDATA%\\uTorrent` and writes to `%LOCALAPPDATA%\\qBittorrent\\BT_backup` and `%APPDATA%\\qBittorrent\\categories.json`, turning labels into categories. For other folders run it from a prompt: `bt2qbt.exe -s \"D:\\uTorrent\" -d \"D:\\qBittorrent\\BT_backup\" -c \"D:\\qBittorrent\\categories.json\"`.",
      },
      {
        title: "Change drive letters on the way",
        body: "If the downloads also moved, add `-r \"C:/Torrents,E:/Torrents\"` with single slashes. If some `.torrent` files are in another folder, add `-t` with that folder, once for each.",
      },
      {
        title: "Start qBittorrent and force a recheck",
        body: "All torrents appear with their categories. Select all, right-click and choose Force recheck: torrents still partial show 100% until then, so keep them stopped until the check has finished. Finished ones go back to 100% and seed. Anything that stays short is either unfinished or in a folder bt2qbt didn't find.",
      },
      {
        title: "Only a few torrents?",
        body: "Open each `.torrent` file from `%APPDATA%\\uTorrent` in qBittorrent, choose the folder that already holds the data, and tick Skip hash check only for the ones you know are complete. Set the category by hand.",
      },
      {
        title: "Retire uTorrent",
        body: "Once the list looks right in qBittorrent, turn off uTorrent's start with Windows, and uninstall it when you're happy.",
      },
    ],
    platforms: ["windows"],
    faq: [
      {
        q: "Does qBittorrent import from uTorrent by itself?",
        a: "No, it has no built-in import. You add the `.torrent` files pointing at the existing folders, or convert the whole list with a tool such as bt2qbt.",
      },
      {
        q: "Will my downloads start again?",
        a: "No, when the folders match and you force a recheck. qBittorrent reads what's there and only downloads what is missing.",
      },
      {
        q: "Do uTorrent labels come across?",
        a: "Yes. bt2qbt writes labels as qBittorrent categories or tags unless you turn it off with `--without-labels` or `--without-tags`.",
      },
      {
        q: "What isn't moved?",
        a: "uTorrent's overall statistics and its settings, such as speed limits and RSS feeds, stay behind. Set those again in qBittorrent's options.",
      },
      {
        q: "Where does uTorrent keep its torrents?",
        a: "In `%APPDATA%\\uTorrent`: `resume.dat` holds the list and progress, and the `.torrent` files sit beside it. The program folder in Program Files holds no list.",
      },
    ],
    related: ["torrenting/move-qbittorrent-to-new-drive-or-computer", "torrenting/extract-rar-after-torrent-downloads", "torrenting/download-from-seedbox-automatically", "torrenting/rename-organize-downloads-for-plex"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "bt2qbt on GitHub", href: "https://github.com/rumanzo/bt2qbt" },
      { label: "qBittorrent wiki: FAQ (importing torrents, data locations)", href: "https://github.com/qbittorrent/qBittorrent/wiki/Frequently-Asked-Questions" },
    ],
  },
  {
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
      "Pull finished seedbox downloads over SFTP on a schedule, skip unfinished files and never fetch the same thing twice. With free rclone, or Stella (stella.sh).",
    h1: "Download from a seedbox automatically",
    short: "Pull seedbox downloads every night",
    lede: "Finished downloads come home at night, once each, while the seedbox keeps seeding.",
    answer:
      "Have the seedbox hard-link each finished download into an outbox folder, then run `rclone move` from that outbox over SFTP on a nightly schedule: only finished files come down, nothing comes twice, and the originals keep seeding. rclone is free. Stella (stella.sh) sets up the nightly pull on your computer instead, with no change on the seedbox: it skips unfinished downloads, remembers what it already fetched even after you move it, and does the first pull right away.",
    stellaSteps: [
      "Reads the login from your file and looks through the seedbox's downloads over SFTP without changing anything there",
      "Gets rclone, the free transfer tool, and tells finished downloads from ones still marked .!qB",
      "Writes a pull script with a list of everything fetched, so moving or deleting files at home doesn't bring them back",
      "Does the first pull, checks the sizes, and tries a repeat run",
      "Schedules it in Windows Task Scheduler for 3am every night, with a log",
    ],
    prompt:
      "Set up my PC to pull finished downloads from my seedbox into Downloads\\Seedbox every night at 3am. Only finished ones, and don't download anything twice, even after I move things out of that folder. The login is in Documents\\seedbox.txt. Do the first pull now, and just give me a short summary when it's done.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In under 4 minutes Stella pulled the 3 finished downloads, left the 2 unfinished ones, and scheduled the pull for 3am. Checked afterwards by us: we moved one download away and deleted another at home, let two more finish on the seedbox, and ran the scheduled task's own command. The two new ones came down, the moved and deleted ones did not come back, and nothing unfinished was fetched.",
      note: "The seedbox was an SFTP server on the same PC holding synthetic clips under Creative Commons film titles and an album by an invented band; the 3am run was started by us rather than waited for. The wait is sped up 32×.",
      video: {
        src: `${PROOFS}/torrenting/download-from-seedbox-automatically/proof.mp4`,
        cuts: webCuts("torrenting/download-from-seedbox-automatically"),
        poster: `${PROOFS}/torrenting/download-from-seedbox-automatically/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 32.7,
        realDuration: 227,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11. The seedbox holds three finished downloads and two still downloading." },
        { at: 4, text: "The prompt: pull finished downloads every night at 3am, nothing twice, and do the first pull now." },
        { at: 11, text: "Stella starts on the 3am pull and the first download." },
        { at: 15.8, text: "Connecting, writing the pull script, fetching and scheduling, sped up 32×." },
        { at: 21.5, text: "Done: Big Buck Bunny, Night Ferry and Sintel are home; Cosmos Laundromat and Tears of Steel wait until they finish." },
        { at: 26, text: "It moved Sintel out, ran the pull again, and nothing downloaded twice." },
      ],
    },
    manualTitle: "Set it up yourself",
    manualSteps: [
      {
        title: "Install rclone and add the seedbox",
        body: "Install it with `winget install Rclone.Rclone` (Windows), `brew install rclone` (Mac) or the script on rclone.org (Linux). Run `rclone config`, choose `n` for a new remote, name it `seedbox`, pick `sftp`, and enter the host, port, user and password from your provider's panel. Set `known_hosts_file` if you want the server's key checked. Test it with `rclone lsd seedbox:`.",
      },
      {
        title: "Give the seedbox an outbox of finished downloads",
        body: "On the seedbox, make a folder such as `~/outbox` on the same disk as the downloads. In its qBittorrent open Options › Downloads, tick Run on torrent finished and enter `cp -al \"%F\" /home/you/outbox/`. `%F` is the finished content, and `-l` makes hard links: they take no extra space and the original keeps seeding. Because it runs only when a torrent finishes, half-done files never reach the outbox. rTorrent and Deluge have their own finished hooks for the same command.",
      },
      {
        title: "Pull and empty the outbox",
        body: "Try it first: `rclone move seedbox:outbox \"D:\\Seedbox\" --delete-empty-src-dirs --dry-run -v`. Then run it without `--dry-run`. `move` copies each file, then removes it from the outbox when the copy succeeded, so it is never fetched again even if you move or delete it at home. The downloads folder itself is not touched.",
      },
      {
        title: "Already have finished downloads there?",
        body: "Hard-link them into the outbox once from a shell on the seedbox: `cp -al ~/downloads/\"Some Finished Download\" ~/outbox/`. Leave out anything with a `.!qB` file in it, the ending qBittorrent gives unfinished files when Append .!qB extension to incomplete files is on.",
      },
      {
        title: "Use more connections if it's slow",
        body: "Add `--transfers 4` for several files at once and `--multi-thread-streams 4` for large single files. A seedbox far away usually gains the most from parallel connections.",
      },
      {
        title: "Schedule it for the night",
        body: "On Windows put the command in `C:\\Scripts\\seedbox.cmd` and run `schtasks /create /tn \"Seedbox pull\" /sc daily /st 03:00 /tr \"C:\\Scripts\\seedbox.cmd\"`. On Linux or a NAS add `0 3 * * * rclone move seedbox:outbox /volume1/Seedbox --delete-empty-src-dirs --log-file /var/log/seedbox.log` with `crontab -e`; on a Mac use cron or launchd. Read the log after the first night.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What's the fastest way to download from a seedbox?",
        a: "SFTP with several connections at once: rclone with `--transfers` and `--multi-thread-streams`, or lftp's `mirror --parallel` with `--use-pget-n`. One plain FTP connection is usually the slowest.",
      },
      {
        q: "How do I avoid downloading unfinished files?",
        a: "Turn on Append .!qB extension to incomplete files in the seedbox's qBittorrent and exclude `*.!qB`, or keep unfinished torrents in a separate folder with Keep incomplete torrents in, and only pull the finished folder.",
      },
      {
        q: "Can I sync a seedbox to a NAS?",
        a: "Yes. Install rclone on the NAS and run the same command from its task scheduler, or use Syncthing with the seedbox folder set to send only and the NAS folder to receive only.",
      },
      {
        q: "Will pulling files stop them seeding?",
        a: "No. Copying reads the files, and moving hard links from the outbox removes only the link. The torrent's own files stay where they are.",
      },
      {
        q: "Does my computer need to be on?",
        a: "The scheduled task runs when the computer is on. In Task Scheduler tick Wake the computer to run this task and Run task as soon as possible after a scheduled start is missed.",
      },
    ],
    related: ["torrenting/rename-organize-downloads-for-plex", "torrenting/extract-rar-after-torrent-downloads", "torrenting/move-qbittorrent-to-new-drive-or-computer", "files-folders/compare-two-folders"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "rclone: SFTP", href: "https://rclone.org/sftp/" },
      { label: "rclone: install", href: "https://rclone.org/install/" },
      { label: "rclone: move", href: "https://rclone.org/commands/rclone_move/" },
      { label: "Microsoft: schtasks create", href: "https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create" },
      { label: "qBittorrent wiki: external programs", href: "https://github.com/qbittorrent/qBittorrent/wiki/External-programs-How-to" },
    ],
  },
  {
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
      "Make a torrent of any folder: pick it in qBittorrent's Torrent Creator, add trackers, start seeding and share the magnet link, or have Stella (stella.sh) make both.",
    h1: "How to make a torrent",
    short: "Make a torrent file and magnet link",
    lede: "A folder turned into a .torrent and a magnet link, tested with a second client.",
    answer:
      "To make a torrent, open Tools → Torrent Creator in the free qBittorrent, choose the folder, paste a few public trackers and save the .torrent; then copy the magnet link and keep qBittorrent open to seed. Stella (stella.sh) makes both on your own computer without opening a torrent program: in the recording it made a .torrent and a magnet link from a folder in 28 seconds, and a second client downloaded every file using the link's hash.",
    stellaSteps: [
      "Reads the folder and hashes every file in it",
      "Writes the .torrent next to the folder, with five public trackers",
      "Saves the matching magnet link in a text file beside it",
      "Leaves the folder itself as it was",
      "Links you to both files",
    ],
    prompt:
      "Make a torrent of the Harbor Walk Field Recordings folder in my Documents, with a few public trackers in it. I'll seed it myself later. Save the magnet link in a text file next to it, and just tell me in one short sentence that it's done and where the files are.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In 28 seconds Stella made the .torrent and the magnet link. Checked afterwards by us: one qBittorrent 5.3.0 checked the folder against the .torrent at 100%, and a second one, given the magnet link's hash and the first one's address, downloaded all seven files byte for byte.",
      note: "The folder holds six recordings and a README made for this test (CC BY 4.0). The wait is sped up 9×.",
      video: {
        src: `${PROOFS}/torrenting/create-a-torrent-file/proof.mp4`,
        cuts: webCuts("torrenting/create-a-torrent-file"),
        poster: `${PROOFS}/torrenting/create-a-torrent-file/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 27.93,
        speed: 9,
        realDuration: 28,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11, with a folder of recordings in Documents." },
        { at: 4, text: "The prompt: make a torrent of the folder with a few public trackers, and save the magnet link beside it." },
        { at: 9.3, text: "Stella starts making the torrent." },
        { at: 13.8, text: "Hashing the folder and writing the two files, sped up 9×." },
        { at: 16, text: "Done: the torrent and the magnet link are in Documents, next to the recordings." },
      ],
    },
    manualTitle: "Make it yourself",
    manualSteps: [
      {
        title: "Get the folder ready",
        body: "Put everything into one folder with the name people should see, and settle the file names first: the torrent stores each name and a hash of the contents, so a later change means a new torrent.",
      },
      {
        title: "Create it in qBittorrent",
        body: "Open Tools → Torrent Creator (Ctrl+N), click Select folder and choose it. Leave Piece size on Auto. Tick \"Start seeding immediately\" if you want to share it right away. Linux and Windows have this menu in the window; on a Mac it's in the menu bar.",
      },
      {
        title: "Add trackers",
        body: "In Tracker URLs paste a few public ones, with an empty line between them so each is its own tier: `udp://tracker.opentrackr.org:1337/announce`, `udp://open.stealth.si:80/announce`, `udp://tracker.torrent.eu.org:451/announce`. A current list is kept in [trackerslist](https://github.com/ngosang/trackerslist). For a private tracker, use its own address and tick Private torrent.",
      },
      {
        title: "Save the .torrent",
        body: "Click Create Torrent, choose where to save it, and wait for the hashing to finish. That small file is the one to send to people.",
      },
      {
        title: "Copy the magnet link",
        body: "With the torrent in your list, right-click it → Copy → Magnet link. The link carries the torrent's hash and trackers, so it works in a message or on a web page on its own.",
      },
      {
        title: "Seed it and test it",
        body: "Keep qBittorrent open with the folder where it is; the status says Seeding. Open the magnet link on another computer, or send it to a friend, and see that it reaches 100%. One complete copy elsewhere keeps it alive when yours is off.",
      },
      {
        title: "Or use the command line",
        body: "Linux and Mac: `transmission-create -o recordings.torrent -t udp://tracker.opentrackr.org:1337/announce \"Harbor Walk Field Recordings\"`, or `mktorrent -a udp://tracker.opentrackr.org:1337/announce -o recordings.torrent \"Harbor Walk Field Recordings\"`. Both are in apt and Homebrew.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "How do I make a torrent file work?",
        a: "Someone has to be seeding. Add the .torrent in your client, point it at the folder you made it from, and let the check reach 100%; from then on others can download from you.",
      },
      {
        q: "Does a torrent need a tracker?",
        a: "It can work through DHT alone, where clients find each other without one. A few public trackers make the first connection faster.",
      },
      {
        q: "What piece size should I choose?",
        a: "Auto. qBittorrent works it out from the total size of the files, and the recording's small folder came out at 64 KiB.",
      },
      {
        q: "Can I change a torrent after making it?",
        a: "Trackers and comments can change. The files and their names can't, because they decide the hash; make a new torrent for a new version.",
      },
      {
        q: "Can Stella make torrents of several folders at once?",
        a: "Yes. Name the folders or the parent folder in the prompt, and it makes one .torrent and one magnet link for each.",
      },
    ],
    related: ["torrenting/convert-magnet-link-to-torrent-file", "torrenting/set-up-qbittorrent", "torrenting/download-torrents-automatically-with-rss", "torrenting/fix-qbittorrent-stalled"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "qBittorrent 5.3.0 source: Torrent Creator labels", href: "https://github.com/qbittorrent/qBittorrent/blob/release-5.3.0/src/gui/torrentcreatordialog.ui" },
      { label: "BEP 3: the BitTorrent protocol and .torrent files", href: "https://www.bittorrent.org/beps/bep_0003.html" },
      { label: "transmission-create manual", href: "https://man.archlinux.org/man/transmission-create.1" },
      { label: "mktorrent", href: "https://github.com/pobrn/mktorrent" },
      { label: "Public tracker list", href: "https://github.com/ngosang/trackerslist" },
    ],
  },
  {
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
      "Turn a magnet link into a .torrent file with qBittorrent or aria2, see what's inside, pick files and repair broken links, or have Stella (stella.sh) do a whole list.",
    h1: "Magnet link to torrent file",
    short: "Convert magnet links to .torrent files",
    lede: "A list of magnet links turned into .torrent files, with the broken ones repaired.",
    answer:
      "To turn a magnet link into a .torrent, paste it into File → Add Torrent Link in the free qBittorrent, wait for the metadata and click \"Save as .torrent file…\", or run aria2c with --bt-metadata-only=true --bt-save-metadata=true. Stella (stella.sh) does a whole list on your own computer: in the recording it repaired two damaged links, saved four .torrent files, listed what's inside each and named the one dead link, without downloading the contents.",
    stellaSteps: [
      "Reads the links from magnets.txt, including an old-style one without a name",
      "Repairs the two damaged ones: a stray &amp; from a web page and a line break from an email",
      "Fetches only the file lists through your qBittorrent and saves each .torrent in Downloads",
      "Compares each .torrent with its link, then clears the links out of qBittorrent again",
      "Lists the files and sizes inside each one, and the link that doesn't work",
    ],
    prompt:
      "Turn the magnet links in magnets.txt (in my Documents) into .torrent files in my Downloads using my qBittorrent, in my Apps folder. Don't download the files themselves. Just list what's inside each one and any link that doesn't work.",
    proof: {
      kind: "video",
      recordedOn: "2026-11-23",
      platform: "Windows 11",
      model: "Claude Code with Opus, on a Claude plan",
      result:
        "In 5 minutes 55 seconds Stella turned four of five links into .torrent files and named the fifth as dead. Checked afterwards by us: all four .torrent files have exactly the hash in their link, and none of the contents were downloaded.",
      note: "The links are to Alpine Linux, Debian and the public-domain cartoon Popeye for President, served by a test tracker and seed on the same computer. The wait is sped up 60×.",
      video: {
        src: `${PROOFS}/torrenting/convert-magnet-link-to-torrent-file/proof.mp4`,
        cuts: webCuts("torrenting/convert-magnet-link-to-torrent-file"),
        poster: `${PROOFS}/torrenting/convert-magnet-link-to-torrent-file/poster.jpg`,
        width: 1280,
        height: 860,
        duration: 33.13,
        speed: 60,
        realDuration: 355,
      },
      moments: [
        { at: 0, text: "Stella on Windows 11, with qBittorrent running and five magnet links in a text file." },
        { at: 4, text: "The prompt: turn the links into .torrent files, list what's inside, and leave the contents undownloaded." },
        { at: 10.5, text: "Stella starts fetching the torrent info through qBittorrent." },
        { at: 15.4, text: "Repairing links, fetching file lists and saving the .torrent files, sped up 60×." },
        { at: 21.2, text: "Four of the five links are now .torrent files, with every file and size listed." },
        { at: 26, text: "The newsletter link is the dead one; the web page and email links were repaired." },
      ],
    },
    manualTitle: "Convert them yourself",
    manualSteps: [
      {
        title: "Open the magnet link",
        body: "In qBittorrent choose File → Add Torrent Link… and paste it, or click the link in your browser and allow qBittorrent to open it. On Windows you can make it the default under Settings → Apps → Default apps → MAGNET; on a Mac, qBittorrent's own settings have it under Behavior; on Linux run `xdg-mime default org.qbittorrent.qBittorrent.desktop x-scheme-handler/magnet`.",
      },
      {
        title: "Save it as a .torrent",
        body: "The dialog says it is retrieving metadata, then shows the file list. Click \"Save as .torrent file…\" at the bottom, choose a folder, and press Cancel if you only wanted the .torrent. For one that's already in your list, right-click → Export .torrent….",
      },
      {
        title: "Pick the files you want",
        body: "In the same dialog, untick what you don't need before clicking OK. Later, use the Content tab at the bottom of the window to change it, or set \"Stop condition\" to Metadata received so nothing downloads until you have chosen.",
      },
      {
        title: "Use aria2 for a list",
        body: "aria2 runs on Windows, Mac and Linux: `aria2c --bt-metadata-only=true --bt-save-metadata=true \"magnet:?xt=urn:btih:…\"` writes a `.torrent` named after the hash. Put one link per line in a file and run it with `-i links.txt`. See the contents with `aria2c -S file.torrent`.",
      },
      {
        title: "Repair a broken link",
        body: "A working link starts `magnet:?xt=urn:btih:` followed by 40 letters and digits (0-9, a-f) or 32 capital letters and digits. Change `&amp;` back to `&`, join a link split over two lines, and remove spaces. If only the hash is left, `magnet:?xt=urn:btih:` plus the hash is enough.",
      },
      {
        title: "Help it find peers",
        body: "If it stays on retrieving metadata, turn on DHT and Peer Exchange in Options → BitTorrent, and add trackers by appending `&tr=` and the address. Nobody online with the torrent means there is no metadata to fetch; a fresh link from the publisher solves that.",
      },
    ],
    platforms: ["windows", "mac", "linux"],
    faq: [
      {
        q: "What is a magnet link?",
        a: "A link holding a torrent's hash instead of a file. Your client uses it to ask other people's clients for the file list, then downloads as usual.",
      },
      {
        q: "Why is my magnet link not working?",
        a: "It was damaged when it was copied, no program is set to open magnet links, or nobody online has the torrent. Check the hash length, set qBittorrent as the default, then try DHT and more trackers.",
      },
      {
        q: "How do I open a magnet link without an app?",
        a: "Something has to speak BitTorrent. aria2 is one small program you can run without installing, and with it one command fetches the .torrent or the files.",
      },
      {
        q: "Is the .torrent from a magnet link the same as the original?",
        a: "The part that matters is: the file list and hashes decide the info-hash, and that is the same. Extras such as the comment or creation date may be missing.",
      },
      {
        q: "Can Stella download only some of the files afterwards?",
        a: "Yes. Tell it which files from the list you want and it adds the torrent with only those ticked.",
      },
    ],
    related: ["torrenting/create-a-torrent-file", "torrenting/fix-qbittorrent-stalled", "torrenting/set-up-qbittorrent", "torrenting/download-torrents-automatically-with-rss"],
    lastChecked: "2026-11-23",
    sources: [
      { label: "BEP 9: metadata from magnet links", href: "https://www.bittorrent.org/beps/bep_0009.html" },
      { label: "aria2 manual", href: "https://aria2.github.io/manual/en/html/aria2c.html" },
      { label: "qBittorrent wiki: frequently asked questions", href: "https://github.com/qbittorrent/qBittorrent/wiki/Frequently-Asked-Questions" },
      { label: "Debian netinst torrents (amd64)", href: "https://cdimage.debian.org/debian-cd/current/amd64/bt-cd/" },
      { label: "Internet Archive: Popeye for President", href: "https://archive.org/details/Popeye_forPresident" },
    ],
  },
];
