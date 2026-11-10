---
name: show-me
description: Read and look closer at Show Stella captures, where the user recorded their screen while talking, clicking and drawing red marks on it. Use whenever a message has a capture (a line like `[Show Stella capture 0:42 · Display · /path/to/captures/…/show-…]`, a contact sheet of numbered moments, or a `captures/…/show-…` folder), or when the user refers to something they just showed or drew.
---

# Show Stella captures

Show Stella records the user's screen, voice, clicks and red ink, then turns it into a capture folder. They send it to show you a problem instead of describing it, so the capture is the bug report. Read it closely before you answer, and don't ask them to explain again what the capture already shows. If something is unclear, zoom in first.

## What a capture looks like

```text
[Show Stella capture 0:42 · Display · /Users/me/.stella/captures/2026-11-09/show-20261109-143201-ab12]
Open contact-sheet.png and frames/ in that folder before changing anything: the marks and words only make sense on the images, which can show more than the text does.
Cropped to: the activity (full frames in frames-full/)
- #1 (0:02) “So this is the checkout page on my dev server.”
- #2 (0:09) “Look, the total here is wrong, it's missing shipping.”
- #3 (0:15) [clicked (x 0.71, y 0.66)] “And when I click pay, nothing happens.”
To look closer at a moment (motion, or something between the numbered frames), run: "…/stella_show" zoom "…/show-…" --at <time like 0:12, or words that were said> (or --mark <n>, --pin <n>)
```

- The first line has the length, what was recorded and the capture's folder.
- Each `#N (M:SS)` line is a moment: what they did in brackets, then what they said while it was on screen. A line with no quote has the action alone.
- Coordinates are fractions of the recorded screen, from the top left.
- The contact sheet attached to the message shows every moment in time order, each with its number in a small chip in a corner.

Refer to moments the same way, as in "#3 (0:15)", so the user can find them.

## Reading a capture

1. Look at the contact sheet first (`contact-sheet.png` in the folder; it is usually attached).
2. Read the lines next to it. Speech recognition mishears names and code terms, so trust the screen when the two disagree.
3. Open `frames/frame-NN.png` for a moment at full size (`frame-03.png` is #3). With `Cropped to:`, the uncropped screens are in `frames-full/`.

Red strokes, circles, underlines and arrows are the user's marks and point at the problem. Numbered pins mark exact spots (`--pin 2`). A ripple shows a click.

`capture.json` is the full manifest: moments, `marks` with shape and box, `events`, and `transcript.words` with times. When `transcript.estimated` is true, word times were spread over each stretch of speech rather than measured, so they place a phrase to within about a second. `recording.mp4` (or `.webm`) and `audio.wav` are the source media; `stream/` holds the frames the zoom reads.

## Look closer at a moment

Run the exact command from the capture's last line. It works only on the computer that recorded the capture:

```sh
"<stella_show>" zoom "<capture folder>" --at 0:21                 # a time
"<stella_show>" zoom "<capture folder>" --at "the total is wrong" # or a phrase they said
"<stella_show>" zoom "<capture folder>" --at 0:21 --span 1 --count 16 --full
"<stella_show>" zoom "<capture folder>" --mark 2                  # mark m2
"<stella_show>" zoom "<capture folder>" --pin 1                   # pin 1
```

It prints the path of a PNG sheet of frames around that moment, the time of each cell, and what was said. Open the PNG before you act. `--span` is the seconds covered (default 2, a quarter of it before the moment), `--count` the number of cells (default 12, up to about 5 a second of recording), and `--full` shows the whole screen instead of the crop. Cells are numbered within the sheet, not as moments.

Zoom sheets go into the capture's `zoom/` folder. Leave the other files as they are. Recordings, sound and `stream/` are deleted a week after a capture, the rest after a month; after that, only `frames/`, the contact sheet and `capture.json` remain.

If you run somewhere else (in the cloud, or on another computer), you can't zoom: work from the attached contact sheet and the text, and say what you'd need to see more closely.

Show Stella's moments, marks and rendering come from [Scrawl](https://github.com/kitlangton/scrawl) by Kit Langton (MIT).
