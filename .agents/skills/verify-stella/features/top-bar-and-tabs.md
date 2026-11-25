# Top bar, tabs and the stage

The full-window top bar (`.shell-topbar-full`, `shell/ShellTopBarFull.tsx`) is Stella's only navigation. It replaced the old right-side workspace panel and its tab strip: there is no "Open panel", "New tab" or "Close panel" any more, and no right-click shortcut to a panel.

## Layout (left to right)

- **Tabs** (`role=tablist`, name `Tabs`; `shell/topbar/ShellTopBarTabs.tsx`). **Chat (⌘1)** is pinned first. Each open place, file, app or task view is a Chrome-style tab with `Close <title>`; a tab an agent added and you haven't looked at has a dot (`… · new from Stella`). Tabs are one width (152px) and shrink evenly; when titles would be cut, Chat goes icon-only first, then narrow tabs (<104px `data-tight`, <60px `data-compact`) swap the icon for the X on hover. Drag to reorder (`use-tab-reorder.ts`); order persists in ui-state `stella.topbar.tabs`.
- **Open** (+, ⌘T; `shell/topbar/NewTabMenu.tsx`): a menu with **Search anything** (files, tasks, schedules) and the places **Files, Apps, Browser, Schedule, Email, Updates, Trash**. Email shows an unseen count; Updates appears only when the app runs from a git checkout (`useAppSourceState`). Files root, Apps list and Browser allow one empty tab each; Schedule, Email and Updates one tab each, so picking them again reselects.
- **Activity** mark, centred (`ShellTopBarActivity.tsx`): disabled unless a task is running or paused. See [activity and tasks](./activity-and-tasks.md).
- **Update** pill (`ShellTopBarUpdatePill.tsx`), only while an update is waiting.
- **Where Stella works** (computer icon, `GlobalExecutionTargetControl.tsx`): This computer / Cloud (and other computers on the account), name in its tooltip.
- **Notifications** bell (`data-testid="notification-bell"`). See [notifications](./notifications.md).
- **Models** (`GlobalModelsControl`, placement `topbar`). See [account, models and billing](./account-models-billing.md).
- ⚙ **Account** (`button.shell-topbar-account-trigger`; accessible name is the account nickname or `Account`, no plan label). Signed out: **Sign in** plus a `Settings` gear. On Windows the window controls follow.

The whole bar is 12px medium text on one 26px rhythm (`shell-topbar-full.css`). Min window 480×600; check changes near 760px wide too, where tabs go icon-only and the strip scrolls.

## The stage

A file or app tab opens the viewer (`data-viewing` on the tab while it floats or has its own window, `data-active` while it fills the stage). Any other non-Chat tab shows on the stage (`.workspace-stage[data-visible="true"]`, `shell/workspace-stage/WorkspaceStage.tsx`): one layer over the chat, joined to the open tab, inset 20px, ending just above the composer (`--workspace-stage-bottom`, re-measured every 250 ms). The chat column never moves and the composer stays usable under it. Selecting **Chat (⌘1)** hides the stage. Files open in the file viewer, which either floats over the chat (movable, resizable, never over the composer) or fills the stage (ui-state `stella.fileViewer.mode`); see [files and viewers](./files-and-viewers.md).

## Driving it

- `node .agents/skills/verify-stella/control-stella.mjs nav open --name Schedule` (or `nav files`, `nav browser`, `apps open`) clicks **Open** and the place, then waits for `stageOpen: true` and `activeTab` to match. `inspect state` reports `stageOpen`, `activeTab` and `selectedTabs`.
- Switch tabs with `drive click --role tab --name "<title>"` (Chat is `Chat (⌘1)`); close with `drive click --role button --name "Close <title>"`. The close button is visible only on the selected tab, on hover or with keyboard focus, so select the tab first (`drive click` reports an unselected tab's X as not found). Closing the selected tab selects its neighbour; tabs and their order survive a relaunch.
- Reorder with CDP `Input.dispatchMouseEvent` drags on the run's `cdpPort`; read the order back from ui-state.
- Capture the whole window: the stage and the chat under it are one picture.

## Gotchas

- A tab on the stage fills the body whether or not the conversation is empty: on Home, opening a tab sets Home aside and the composer docks at the bottom (keeping any draft); back on Chat, Home returns with the composer centred.
- While a dialog is open the bar is inert: `activeTab` reads null.
- The tab's top edge runs into the stage with concave feet; never cover the stage's edge with a patch (the open-tab notch is `shell/topbar/open-tab-notch.ts`).
- Older layouts saved section ids that no longer exist (`tasks`, `search`, `settings`, `quickchat`); they restore as the Home launcher (`resolveSidebarSection` in `features/workspace-display/sidebar-sections.ts`).
