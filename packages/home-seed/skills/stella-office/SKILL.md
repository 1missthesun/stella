---
name: stella-office
description: Create, analyze, proofread, and modify Office documents (.docx, .xlsx, .pptx) using Stella's bundled `stella-office` CLI. Use when the user wants to create, inspect, check formatting, find issues, add charts, or modify Office documents.
---

# stella-office

A CLI for `.docx`, `.xlsx` and `.pptx`, already on the shell's PATH; no Office install needed.

## Help first

The CLI documents itself, and its schema is current where any example here may not be. When unsure of an element, property name or value format, ask it instead of guessing:

```bash
stella-office help                        # commands, global options
stella-office help docx                   # elements of a format (word/excel/ppt aliases work)
stella-office help docx paragraph         # properties, aliases, examples
stella-office help docx set paragraph     # only what `set` accepts
stella-office help xlsx /                 # document-level properties
```

## Specialized rules

For a specific kind of document, load its rules before starting, one per artifact: `stella-office load_skill <name>` prints a SKILL.md to follow. Pick the most specific match, else the format default.

- Word: `word` (reports, letters, memos), `academic-paper` (citations, equations, journal layout)
- PowerPoint: `pptx` (general decks), `pitch-deck` (fundraising only), `morph-ppt`, `morph-ppt-3d`
- Excel: `excel` (workbooks, formulas, pivots), `financial-model`, `data-dashboard`

## Working with a document

Prefer the highest layer that can do the job: read and inspect, then DOM edits, then raw XML only when nothing else can express it. Add `--json` for structured output.

```bash
stella-office create report.docx                      # blank file, type from extension
stella-office view report.docx outline                # outline | stats | issues | text | annotated | html | screenshot
stella-office get slides.pptx '/slide[1]' --depth 1   # a node and its children
stella-office query report.docx 'paragraph[style=Normal] > run[font!=Arial]'
stella-office add report.docx /body --type paragraph --prop text="Summary" --prop style=Heading1
stella-office set data.xlsx /Sheet1/A1 --prop value="Name" --prop bold=true
stella-office set doc.docx / --find draft --replace final
stella-office move | swap | remove | batch | dump | raw | raw-set | validate
```

- Every attribute goes through `--prop key=value`; any XML attribute is settable on an element path.
- Paths are 1-based (`/body/p[3]`); `--index` is 0-based, except `add --type row|col` in Excel. Quote paths (`'/slide[1]'`): shells expand brackets.
- Elements with stable ids come back as `@id=`/`@paraId=` paths; use those across multi-step edits, since positional indices shift.
- `batch` runs many operations in one save and is atomic by default: if any item fails, the file is left unchanged (`--best-effort` keeps what succeeded). `dump` emits a replayable batch.
- In PowerPoint, `shape[1]` is usually the title placeholder.
- In shell strings, single-quote text containing `$`, and write newlines as `\\n`.
- Check your work with `validate` and `view issues`, and look at `view screenshot` (or `view html`) when layout matters.

## Files and other programs

The first command on a file starts a resident process that keeps it in memory, and stella-office's own reads always see your latest edits. Run `stella-office save <file>` (or `close`) before anything else reads the file: another program, a renderer, an upload. A file open in PowerPoint or Word must be closed there before editing.

## Previews

`stella-office preview <file>` keeps a live preview of the document in the chat that refreshes as the file changes; use it when the user should watch a multi-step edit. `watch <file>` instead serves a localhost preview where the user can click to select elements, and `get <file> selected` returns what they selected.
