# Parity checklist: Rune Stella vs Electron Stella

Every line is proven in the running Rune app (screenshot or recording on the private display,
real-display numbers for performance) before it is ticked. Source of truth is master's
`packages/desktop-ui/src` and `packages/desktop/electron`.

## Platform (engine + host)
- [ ] Windows: main shell, detached viewer windows (tear-off), companion, overlay, Show Stella panel, dialogs' parent
- [ ] Custom titlebar, window controls (Windows/Linux), traffic lights (macOS), drag regions, zoom
- [ ] Tray, global shortcuts, native menus, context menus (spelling, edit, selection, app groups)
- [ ] Clipboard text/image, copy fallbacks; drag and drop in (files, images) and out
- [ ] Text selection across messages, IME, spellcheck, accessibility tree (AccessKit)
- [ ] Notifications (OS), sounds (message sound)
  - macOS: message sound plays through AVPlayer, setSinkId routes output: ~/.stella/outputs/stella-rune/host/audio-output-mac.txt
  - Linux/Windows: the engine's player (symphonia + cpal) decodes MP3/AAC/WAV/FLAC/Vorbis, resamples and ends on time, also with no output device (~/.stella/outputs/stella-rune/host/engine-audio-player.txt). Linux CI (PulseAudio null sink): the message chime plays and ends at 2.65 s (~/.stella/outputs/stella-rune/host/engine-audio-linux-ci.txt).
- [ ] WebViews: HTML deliverables, canvases (bridge + actions), Cloud Apps, stella-media scheme
- [ ] Browser-only APIs on demand: realtime voice (WebRTC), dictation/microphone, pdf/office previews
  - macOS: dictation microphone (~/.stella/outputs/stella-rune/host/dictation-mic-mac.txt), media probe via master's fallbacks (~/.stella/outputs/stella-rune/host/media-probe-mac.txt), realtime voice, voice cues and streaming read-aloud through the media page (~/.stella/outputs/stella-rune/host/voice-media-page-mac.txt, voice-session-mac.png). Voice with every Stella window hidden, the page in the engine's background window (~/.stella/outputs/stella-rune/host/voice-background-window-mac.txt). Linux CI: the media page on WebKitGTK is a secure context with getUserMedia, AudioContext and MediaSource (engine-audio-linux-ci.txt). Linux CI also grants the page a (virtual) microphone. Open: xAI voice not run (BYOK key); stock WebKitGTK has no WebRTC (Ubuntu's build, and Arch's default flags), so Linux realtime voice needs another route; media page on WebView2 is compile-only; on Linux a media page created after a web window closed does not start (engine).
- [ ] Agent browsing: in-app browser panel + CDP on an on-demand Chromium; Stella Browser extension bridge
  - macOS: an agent browses on the on-demand Chromium in a signed-in turn (~/.stella/outputs/stella-rune/host/agent-browsing-mac.txt, agent-browsing-chat-mac.png). Extension bridge not proven.
- [ ] Show Stella capture (screen recording + talking + marks), meeting capture
  - macOS: Show Stella records the screen, microphone and frames into a full capture, which lands in the composer (~/.stella/outputs/stella-rune/host/show-stella-mac.txt, show-stella-contact-sheet.png, show-stella-after-stop.png); desktopCapturer sources from ScreenCaptureKit; the global input hook delivers events. Ink/marks (needs Accessibility for the bundled engine) and meeting capture not proven.
- [ ] Hot swap of `ui/` (zero Cargo, state kept, flat memory); host restart keeps windows
  - macOS: an app-source draft and its Undo hot-swap `ui/` with no relaunch or Cargo (~/.stella/outputs/stella-rune/host/app-source-hot-swap-mac.txt, app-source-*-mac.png). Host restart keeps windows not proven.
- [ ] Linux X11 + Wayland, macOS, Windows builds; launcher starts the engine; Update flow
  - macOS: the launcher starts the engine isolated (~/.stella/outputs/stella-rune/host/isolation-launcher-mac.txt, launcher-mac-rune.log); Update flow for a draft (~/.stella/outputs/stella-rune/host/app-source-hot-swap-mac.txt).

## Shell
- [ ] Launch splash, crash surface, error boundary, route error recovery
- [ ] Top bar: tabs (open-tab notch, reorder, pinned Chat, tight/compact), activity mark, update pill + menu, models control, execution target control, settings menu, notification bell + toasts, window controls
  - macOS: tabs, notch and pinned Chat match Electron in light/dark/Midnight (~/.stella/outputs/stella-rune/shell/sbs/home-*.jpg, files-*.jpg); drag reorder with the neighbour shift and settle (~/.stella/outputs/stella-rune/shell/clips/tab-reorder-and-stage.mp4); settings menu → Connectors popover (~/.stella/outputs/stella-rune/shell/rune-connectors-popover-nightowl.png). Tight/compact tabs, update pill, bell + toasts and window controls not proven here.
- [ ] Chat sidebar + sidebar sections (collapse, conversations, agents/activity, files)
  - macOS: Files section (empty and listed) matches Electron, centred 880 body (~/.stella/outputs/stella-rune/shell/sbs/files-nightowl.jpg, files-list-nightowl.jpg, files-dark.jpg); chat display tab opens with its own composer (~/.stella/outputs/stella-rune/shell/rune-chat-panel-tab-dark.png; sidebar text/composer sizes wait on chat's `variant="sidebar"`). Email section not ported.
- [ ] Workspace stage + display: tabs, file viewer (images, video, audio, PDF, office, code/source diff, HTML), strip thumbnails, search, detached windows
  - macOS: image viewer matches Electron in light/dark/Midnight (~/.stella/outputs/stella-rune/shell/sbs/viewer-image-*.jpg; its drop shadow waits on the engine's clip+shadow fix); open/close/expand (~/.stella/outputs/stella-rune/shell/clips/viewer-open-close-expand.mp4); detach to its own window and dock back (~/.stella/outputs/stella-rune/shell/clips/viewer-detach.mp4, rune-detached-viewer-window-dark.png); PDF (~/.stella/outputs/stella-rune/shell/rune-pdf-dark.png); strip thumbnails (~/.stella/outputs/stella-rune/shell/rune-strip-thumbnails-dark.png). Video, audio, code/diff and HTML viewers not proven here.
- [x] Right sidebar / document viewer widths (`clamp(380px,34vw,520px)`, expanded `min(960px,100%-48px)`)
  - Today's Electron draws no `.right-sidebar`; the stage and floating viewer replaced it. Their rects match Electron at 1400×940: stage 20,37 → 1380,872, viewer 320,48 760×500 (~/.stella/outputs/stella-rune/shell/sbs/viewer-image-*.jpg, files-dark.jpg); expanded to the stage (~/.stella/outputs/stella-rune/shell/clips/viewer-open-close-expand.mp4).
- [ ] Companion window, overlay window, selection (screen selection), background
  - macOS: companion mark + expanded panel (~/.stella/outputs/stella-rune/shell/rune-companion-expanded-dark.png); overlay region capture (~/.stella/outputs/stella-rune/shell/rune-overlay-region-capture-dark.png); theme backdrop matches Electron's canvas byte for byte, Midnight included (~/.stella/outputs/stella-rune/shell/sbs/backdrop-settings-nightowl.jpg, home-nightowl.jpg; on-screen saturation differs until the engine tags its layer sRGB). Ask Stella selection chip waits on engine selection rect/events.
- [x] Home (empty state greeting + centred composer)
  - macOS, 1400×940: greeting and composer (shell 636 wide at x=382) match Electron in light, dark and Midnight (~/.stella/outputs/stella-rune/shell/sbs/home-light.jpg, home-dark.jpg, home-nightowl.jpg).

## Chat
- [ ] Timeline: message rows, time dividers, pagination/history, follow/scroll management, catch-up pill, jump to message
  - macOS: the same seeded dev chat matches Electron in dark, light and Velvet (~/.stella/outputs/stella-rune/chat/chat-{dark,light,gradient}-side-by-side.png; captured colours differ only by Electron's Display P3 screenshot); fixture rows and dividers too (~/.stella/outputs/stella-rune/chat/timeline-fixture-{dark,light,gradient}-side-by-side.png); sidebar look (~/.stella/outputs/stella-rune/chat/timeline-sidebar-variant-dark.png); a 100-record dev chat pages older history while scrolling (~/.stella/outputs/stella-rune/chat/history-load-scroll.mp4); a send while scrolled up keeps the place and shows the reply peek (~/.stella/outputs/stella-rune/chat/send-while-scrolled-up-reply-peek.mp4); scroll 47–58 fps (~/.stella/outputs/stella-rune/chat/metrics.md). Catch-up pill is off behind CATCH_UP_ENABLED=false in both; jump to message not proven.
- [ ] Markdown (streamdown parity), code blocks, tables, images, file pills, Stella file links, model mention text
  - macOS: paragraphs, lists, inline code, code blocks, tables and links match (~/.stella/outputs/stella-rune/chat/timeline-fixture-*-side-by-side.png). Gaps: code-block line numbers, list item padding (list→table/heading 16 vs 20) and the 10/8 header-cell padding wait on engine markdown options; selection across markdown blocks and image onError are open engine items. Images, file pills, Stella file links and model mention text not proven.
- [ ] Assistant streaming, working indicator, text shimmer, activity/task shimmer, agent assistant updates
  - macOS: a real dev-backend reply streams in with the working indicator (~/.stella/outputs/stella-rune/chat/send-and-stream.mp4). Activity/task shimmer and agent updates not proven.
- [ ] Cards: generated images (+job), map route, office preview, PDF viewer, media preview, screenshot, connector connect, cloud connector, safeguard, usage limit, reminder fire, schedule notice, voice session, user ask (deck/list/record), browser intervention/data, app preview, source diff
  - macOS: safeguard, usage limit, reminder fire, schedule notice, voice session, user ask deck and record, composer notice match Electron in light/dark/gradient (~/.stella/outputs/stella-rune/chat/cards-{dark,light,gradient}-side-by-side.png). The media, map, office, PDF, connector, browser, app preview and source diff cards not proven.
- [ ] Message actions + context menu, copy, reply preview/handoff, send failure marks, held send
  - macOS: reply from a selection hands off as a quote chip, sends, and shows its preview (~/.stella/outputs/stella-rune/chat/reply-handoff-chip.png, reply-sent-with-preview.png); quoted-text hover preview clips and scrolls at 220 (~/.stella/outputs/stella-rune/chat/quote-chip-preview-clipped.png). Context menu, failure marks and held send not proven.
- [ ] Composer: lead row, context chips/rows/sections, add menu, model mention menu, mini model picker, notices, attachments (tiles, browser tray, drop overlay), dictation, voice
  - macOS: shell and lead row cap at min(800, column − 48); Escape is claimed only to stop a reply or close the mention menu; sidebar / sidebar-wide variants; upgrade notice matches (~/.stella/outputs/stella-rune/chat/cards-*-side-by-side.png); keystroke→frame p50 18.8 ms (~/.stella/outputs/stella-rune/chat/metrics.md). Attachments, drop overlay, image paste, dictation and voice not proven.
- [ ] Message alerts + sound, anonymous first-reply counter, nudges, found-via notice

## Global surfaces
- [ ] Auth: sign-in screen, magic link, remembered account, sign-out dialog, browser handoff
  - macOS: sign-in dialog matches in dark, light and Night Owl (~/.stella/outputs/stella-rune/global/sbs/signin-dialog-*.jpg); remembered account (~/.stella/outputs/stella-rune/global/sbs/signin-dialog-remembered-nightowl.jpg); sign-out dialog signed-in and signed-out (~/.stella/outputs/stella-rune/global/sbs/signout-*.jpg); signed-out home (~/.stella/outputs/stella-rune/global/sbs/signed-out-home-nightowl.jpg)
  - macOS: Turnstile in a `<window>` webview hands its token back through will-navigate as in Electron, and a magic-link sign-in on a dev test account completes from the UI (~/.stella/outputs/stella-rune/host/turnstile-magic-link-mac.txt, magic-link-signed-in-mac.png).
  - macOS gap: the sign-in recording is still owed (global). Browser handoff is not exercised (it opens the real browser).
- [ ] Onboarding, local mode, permissions, mobile (get the app), legal dialog
  - macOS: onboarding first screen (~/.stella/outputs/stella-rune/global/sbs/onboarding-1.jpg, `session.ts start --first-run`); local mode via 'Use without an account' (~/.stella/outputs/stella-rune/global/sbs/local-mode-nightowl.jpg); get the app (~/.stella/outputs/stella-rune/global/sbs/phone-connect-*.jpg); legal (~/.stella/outputs/stella-rune/global/sbs/legal-terms-*.jpg)
  - macOS gap: later onboarding steps and the permission prompts are not compared. The greeting wraps one word early because chat Markdown inserts U+2066/2069 isolates.
- [ ] Billing screen, plan & usage dialog, subscription upgrade, BYOK
  - macOS: plan & usage in 3 themes (~/.stella/outputs/stella-rune/global/sbs/plan-usage-*.jpg); upgrade dialog in Night Owl (~/.stella/outputs/stella-rune/global/sbs/upgrade-dialog-nightowl.jpg); BYOK rows in the Claude & ChatGPT tab (~/.stella/outputs/stella-rune/global/sbs/settings-claude-and-chatgpt-*.jpg)
  - macOS gap: the billing screen is not compared
- [x] Settings: nav, search, every tab (General, AI, Account, Privacy, Shortcuts, Audio, ...), theme picker, model pickers, voice catalog, devices, passkeys, sessions, secure values, sync, telemetry, companion, permissions
  - macOS: every tab at 4 scroll positions in dark, light and Night Owl (~/.stella/outputs/stella-rune/global/sbs/settings-*.jpg); search jump recording (~/.stella/outputs/stella-rune/global/rec/settings-search-rune.mp4 vs settings-search-electron.mp4); theme picker and models popover (~/.stella/outputs/stella-rune/global/sbs/theme-picker-*.jpg, models-popover-*.jpg)
- [ ] Usage app (summary cards, timeline chart, threads/calls tables, filters)
  - macOS: summary, timeline and calls table from the usage fixture (~/.stella/outputs/stella-rune/global/sbs/usage-*.jpg)
  - macOS gap: light theme and filter states not shot
- [ ] Apps library + Cloud App panel/viewer, canvas share
  - macOS: Apps library (~/.stella/outputs/stella-rune/global/sbs/apps-library-nightowl.jpg); opening a Cloud App, recorded with the webview composited (~/.stella/outputs/stella-rune/global/rec/open-cloud-app-rune.mp4, ~/.stella/outputs/stella-rune/global/shots/cloud-app-open-nightowl-rune-composited.png)
  - macOS gap: a native webview draws above engine modals (seen with the sign-out dialog over an open Cloud App; reported to engine). Canvas share is not covered.
- [ ] Execution placement (device work offer, remote execution consent), schedule, self-host, integrations connect dialog
  - macOS: where Stella works (~/.stella/outputs/stella-rune/global/sbs/where-stella-works-*.jpg); integrations connect (~/.stella/outputs/stella-rune/global/sbs/phone-connect-*.jpg); remote execution consent on Rune only (~/.stella/outputs/stella-rune/global/shots/remote-consent-nightowl-rune.png)
  - macOS gap: schedule and self-host dialogs not compared against Electron
- [x] Claude / ChatGPT / Antigravity account sections, login prompts, CLI install status
  - macOS: tab in 3 themes (~/.stella/outputs/stella-rune/global/sbs/settings-claude-and-chatgpt-*.jpg); add-account menu and paste-code prompt (~/.stella/outputs/stella-rune/global/sbs/claude-add-account-nightowl.jpg, claude-login-cloud-nightowl.jpg)
- [ ] App source: update cards, notifications, What's new (after the release batch lands)
- [ ] Feedback dialog, i18n (every locale), themes (all of @stella/theme)
  - macOS: feedback in 3 themes (~/.stella/outputs/stella-rune/global/sbs/feedback-*.jpg); `bun run i18n:parity` passes for every catalog; dark, light and Night Owl compared throughout
  - macOS gap: themes other than those three, and non-English locales, not shot

## Web
- [ ] stella.sh/chat renders the same `ui/` through the DOM host; per-user renderers still build

## Measured vs Electron (same machine, same window)
- [ ] Cold start, RSS/PSS, idle CPU, active CPU, input latency, scroll/resize/animation fps, hot-swap latency, memory after 50 swaps
