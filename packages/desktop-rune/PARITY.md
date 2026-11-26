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
- [ ] WebViews: HTML deliverables, canvases (bridge + actions), Cloud Apps, stella-media scheme
- [ ] Browser-only APIs on demand: realtime voice (WebRTC), dictation/microphone, pdf/office previews
  - macOS: dictation microphone (~/.stella/outputs/stella-rune/host/dictation-mic-mac.txt), media probe via master's fallbacks (~/.stella/outputs/stella-rune/host/media-probe-mac.txt), realtime voice, voice cues and streaming read-aloud through the media page (~/.stella/outputs/stella-rune/host/voice-media-page-mac.txt, voice-session-mac.png). Open: voice with no Stella window on screen; xAI voice not run (BYOK key).
- [ ] Agent browsing: in-app browser panel + CDP on an on-demand Chromium; Stella Browser extension bridge
  - macOS: an agent browses on the on-demand Chromium in a signed-in turn (~/.stella/outputs/stella-rune/host/agent-browsing-mac.txt, agent-browsing-chat-mac.png). Extension bridge not proven.
- [ ] Show Stella capture (screen recording + talking + marks), meeting capture
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
- [ ] Markdown (streamdown parity), code blocks, tables, images, file pills, Stella file links, model mention text
- [ ] Assistant streaming, working indicator, text shimmer, activity/task shimmer, agent assistant updates
- [ ] Cards: generated images (+job), map route, office preview, PDF viewer, media preview, screenshot, connector connect, cloud connector, safeguard, usage limit, reminder fire, schedule notice, voice session, user ask (deck/list/record), browser intervention/data, app preview, source diff
- [ ] Message actions + context menu, copy, reply preview/handoff, send failure marks, held send
- [ ] Composer: lead row, context chips/rows/sections, add menu, model mention menu, mini model picker, notices, attachments (tiles, browser tray, drop overlay), dictation, voice
- [ ] Message alerts + sound, anonymous first-reply counter, nudges, found-via notice

## Global surfaces
- [ ] Auth: sign-in screen, magic link, remembered account, sign-out dialog, browser handoff
- [ ] Onboarding, local mode, permissions, mobile (get the app), legal dialog
- [ ] Billing screen, plan & usage dialog, subscription upgrade, BYOK
- [ ] Settings: nav, search, every tab (General, AI, Account, Privacy, Shortcuts, Audio, ...), theme picker, model pickers, voice catalog, devices, passkeys, sessions, secure values, sync, telemetry, companion, permissions
- [ ] Usage app (summary cards, timeline chart, threads/calls tables, filters)
- [ ] Apps library + Cloud App panel/viewer, canvas share
- [ ] Execution placement (device work offer, remote execution consent), schedule, self-host, integrations connect dialog
- [ ] Claude / ChatGPT / Antigravity account sections, login prompts, CLI install status
- [ ] App source: update cards, notifications, What's new (after the release batch lands)
- [ ] Feedback dialog, i18n (every locale), themes (all of @stella/theme)

## Web
- [ ] stella.sh/chat renders the same `ui/` through the DOM host; per-user renderers still build

## Measured vs Electron (same machine, same window)
- [ ] Cold start, RSS/PSS, idle CPU, active CPU, input latency, scroll/resize/animation fps, hot-swap latency, memory after 50 swaps
