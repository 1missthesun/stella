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
- [ ] WebViews: HTML deliverables, canvases (bridge + actions), Cloud Apps, stella-media scheme
- [ ] Browser-only APIs on demand: realtime voice (WebRTC), dictation/microphone, pdf/office previews
- [ ] Agent browsing: in-app browser panel + CDP on an on-demand Chromium; Stella Browser extension bridge
- [ ] Show Stella capture (screen recording + talking + marks), meeting capture
- [ ] Hot swap of `ui/` (zero Cargo, state kept, flat memory); host restart keeps windows
- [ ] Linux X11 + Wayland, macOS, Windows builds; launcher starts the engine; Update flow

## Shell
- [ ] Launch splash, crash surface, error boundary, route error recovery
- [ ] Top bar: tabs (open-tab notch, reorder, pinned Chat, tight/compact), activity mark, update pill + menu, models control, execution target control, settings menu, notification bell + toasts, window controls
- [ ] Chat sidebar + sidebar sections (collapse, conversations, agents/activity, files)
- [ ] Workspace stage + display: tabs, file viewer (images, video, audio, PDF, office, code/source diff, HTML), strip thumbnails, search, detached windows
- [ ] Right sidebar / document viewer widths (`clamp(380px,34vw,520px)`, expanded `min(960px,100%-48px)`)
- [ ] Companion window, overlay window, selection (screen selection), background
- [ ] Home (empty state greeting + centred composer)

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
