# Settings

Settings is a dialog opened from the top bar's ⚙ **Account** menu (signed in) or the **Settings** gear (signed out). It has grouped tabs, a search across every setting, and sits next to account destinations that are not tabs (Plan & usage, Theme, Stella on your phone, Connectors, Send feedback).

## Sub-features

- `settings-entry` opens from either top-bar identity state.
- `settings-tabs`: **App** group General, Audio, Shortcuts; **Personal** group Account & Legal, Privacy, Saved private values (`global/settings/settings-tabs.ts`; the website build drops Shortcuts and Saved private values).
- `settings-search` searches across tabs and jumps from a result to its owning tab.
- `settings-close` returns to the underlying shell.

Notable contents: General has language, message sound, **Desktop companion**, "Stella for Chrome" browser profiles and permissions; Privacy has **Save chat history in the cloud**, **Memory**, **Work from your other devices** (lets other devices place chats and tasks on this computer), telemetry and your data; Saved private values lists what `request_secure_input` remembered on this computer; Account & Legal has **Claude & ChatGPT accounts** (which Claude login each computer and the cloud uses, "Add Claude account", and what cloud chat runs on), **Signed-in devices**, Sign out, Delete data, Delete account, and Legal (passkeys appear where supported).

## How to get to it (user POV)

- Signed in: the ⚙ **Account** button (named by the account's nickname, or `Account`; no plan label), then **Settings**. Its other items are Plan & usage, Theme, Stella on your phone, Connectors, Send feedback, and Sign out.
- Signed out: the **Settings** gear next to **Sign in**, then **Settings**.

## Driving it with control-stella

Preconditions: the verifier is healthy, no other modal dialog is open, English UI.

- **Open.** `node .agents/skills/verify-stella/control-stella.mjs settings open`; require `settingsOpen: true` and a selected tab.
- **Catalog.** `inspect components` and compare the visible tabs with `SETTINGS_TABS` after platform filtering; don't hard-code the list.
- **Select.** `node .agents/skills/verify-stella/control-stella.mjs settings tab --name "Privacy"`; require it in `selectedTabs`.
- **Toggle.** `drive click --role switch --name "<switch name>"`, then read the effect back where it lands (for **Work from your other devices**, `backend-call.mjs view devices.list` shows `remoteExecution: "enabled"` for this device).
- **Search.** `node .agents/skills/verify-stella/control-stella.mjs settings search --query language`; require a result naming its tab. Click it when testing the jump.
- **Close.** `node .agents/skills/verify-stella/control-stella.mjs settings close`; require `settingsOpen: false`.

## Gotchas

- Settings content scrolls in `.settings-panel`; scroll that element, not the tabpanel.
- Search replaces the tab panel. Clear it before checking tab contents or closing with Escape.
- Theme, phone, Connectors and feedback are dialogs of their own, not Settings tabs.
- `settings state` reports shell state, not the dialog's contents.
