# Old page commands

Desktops whose browser service has no debugger pipe send whole commands
("click this selector") and the extension carries them out. Newer services send
raw debugger commands (`commands/pipe.js`) and never use this folder.

**Delete when** no supported desktop runs a service without the pipe: the
service with the pipe has been on the prod channel
(`promote-stella-browser.yml`) long enough that every desktop still allowed to
connect has started with it. Desktops take the prod service at each launcher
start. Until then the extension's hello says `debuggerPipe: 1`, beside the
protocol version old services require to be exactly "2.1".

## Commands that stay until then

| Kind | Commands |
| --- | --- |
| Navigation | `navigate` `open` `back` `forward` `reload` |
| Pointer and keyboard | `click` `dblclick` `hover` `drag` `mousemove` `mousedown` `mouseup` `scroll` `scrollintoview` `press` `keydown` `keyup` `inserttext` `type` |
| Forms | `fill` `clear` `select` `check` `uncheck` `focus` `clipboard` |
| Reading | `snapshot` `screenshot` `pdf` `content` `evaluate` `gettext` `getattribute` `innertext` `innerhtml` `inputvalue` `boundingbox` `isvisible` `isenabled` `ischecked` `count` `styles` |
| Waiting | `wait` `waitforurl` |
| Network | `requests` `responsebody` `route` `unroute` `har_start` `har_stop` |
| Batches | `chain` |
| Profile check | `site_mod_set` `site_mod_remove` (store the marker only; they no longer change pages) |

## Deleting it

1. This folder, and its import and `LEGACY_HANDLERS` in `background.js`.
2. The service's page scripts for the old commands: `DISARM_BEFOREUNLOAD`,
   `DIALOG_GUARD` and their callers in `extension_bridge.rs`, and
   `PipeOutcome::UseExtension` for page commands.
3. In the service: the `site_mod_*` branch of `probe_profile`, and the
   connection's `debugger_pipe` flag with its no-pipe branches (an extension
   without it is then too old to connect).
4. `lib/agent-cursor.js` moves to the desktop's in-app browser (its only other
   user) and `lib/snapshot.js` to the service (which embeds it).
