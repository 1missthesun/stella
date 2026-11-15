# Schedule

Reminders, watches and scheduled tasks the user asked for in chat. Reminders fire with no AI (push, Done/Snooze); watches run a check script and wake an agent when it finds something; tasks run a prompt at each fire, straight to an agent when the instruction is clear, otherwise to Stella. Missed fires catch up once.

## Surfaces

- **Schedule tab** (+ menu › Schedule; `shell/sidebar-sections/ScheduleSection.tsx`): **Upcoming** and **Paused** groups. Each row: kind (Reminder, Task, Watch), name, `Next <when>`, where it runs (`Runs in the cloud`, `Runs on this computer`, `Runs on your computer`, `Waiting for your computer`), what a fire does (`Starts a task`, `Goes to Stella`, `Stops once found`), a last failure, and hover actions **Edit** (name, message or task, when, zone), **Pause/Resume** and **Delete** ("Delete?" to confirm). The schedule dialog that a card opens (`global/schedule/ScheduleDetailsDialog.tsx`) adds **Run now**. Empty: "Nothing scheduled". Signed out: "Sign in to see your schedule", except schedules a signed-out or cloud-sync-off desktop keeps in its local scheduler (`local-scheduler.json`), which list there.
- **Schedule cards in chat** (`features/schedule/ScheduleNoticeCard.tsx`, `ScheduleNotices.tsx`; mobile `components/chat/ScheduleNoticeCard.tsx`, `ScheduleNotices.tsx`): creating, editing, pausing, resuming or removing a cloud schedule posts a `schedule-notice` card; one posted mid-turn lands after the reply. Consecutive notices fold into one grouped row (net per schedule; one made and then removed shows struck through as "Scheduled, then removed" with **Show all**; "N/M" for a series, soonest run; `packages/contracts/schedule-notice-group.ts`). Notices for a background task's own schedules are a bare line ("For a background task"), never a bubble. Tapping a card opens the schedule focused. Notices never ring or badge.
- **Fired reminder card** (`features/reminders/ReminderFireCard.tsx`): "Reminder · 9:00 AM" with Done / Snooze. Task fires have no card.
- A one-click time-zone move prompt appears when the computer's zone differs from the schedules' (`features/schedule/use-schedule-zone.ts`).

## Placement

Paid plans run cloud tasks and watches in the cloud. Plans without cloud containers (Free) send a scheduled task or watch finding to the computer that set it up (else the main computer); when that computer is away the row shows "Waiting for your computer", one waiting card and a phone push appear, and it runs once when the computer is back. Reminders always fire from the cloud. Local-only schedules (computer watches, heartbeats) get no chat card.

## Driving it

- Seed without the model: `backend-call.mjs call schedules.create '<args>'` as the run's account (`requestId`, `kind`, `prompt`, `schedule` such as `{"kind":"at","atMs":…}`, `conversationId`); then `nav open --name Schedule`.
- Through the product: `chat send --text "remind me in 2 minutes to stretch"` and wait for the card, the row, and the fire.
- Row actions are opacity 0 until hover, so `inspect components` omits them and `drive click` can't find them: read their rect with `inspect eval` over `.workspace-stage button` and use `drive click-xy`. **Delete** turns into a wider **Delete?** that confirms on a second click at its new centre; read the rect again.
- Seeding with `schedules.create` and a `conversationId` (the run's `activeConversationId`) posts the same chat card as a schedule made in chat (proven 2026-11-14).
- Grouped cards: ask for several schedules in one turn and check one folded row; remove one and check the net.

## Gotchas

- A schedule card needs a conversation; schedules created headlessly without one post nothing.
- The phone needs an OTA for card changes; desktop and phone render the same contract.
