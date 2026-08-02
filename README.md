# M8 Librarian

A librarian for [Dirtywave M8](https://dirtywave.com/) SD cards that runs entirely in your browser. Browse songs, instruments, samples, themes, and bundles; find and repair broken sample references; build lean set exports; export songs as MIDI — all from one HTML file with no install, no server, and no data ever leaving your machine.

**Live:** [m8librarian.allmyfriendsaresynths.com](https://m8librarian.allmyfriendsaresynths.com)

Requires Chrome or Edge (it uses the File System Access API to read your card; Firefox and Safari don't support it).

## Getting started

1. Open the page in Chrome or Edge.
2. Click **OPEN SD CARD** and pick your M8 card (or any folder with the M8 layout: `Songs/`, `Samples/`, `Instruments/`, ...).
3. Click **Catalogue Samples** on the Songs tab. This indexes every WAV on the card and unlocks missing-sample detection, repairs, and set exports.

The library is cached locally (IndexedDB), so reopening the same card is instant. **Rescan** is incremental: only files whose modification time changed are re-read.

## What it does

### Browse

- **Songs** — list, compact and grid views with folder tree, filtering, and sorting (name, date, missing samples, instrument count, BPM, key, firmware). Expand a song for its instruments, sample dependencies (with previews), and similar songs. The **♪ Keys** button detects each song's key/scale from its note content.
- **Instruments** — every `.m8i` decoded in full: synth parameters, filter, amp/mixer sends, and all modulators with envelope curves. Usage tracking shows which songs use each instrument. Any instrument in a song's bank can be **extracted as a `.m8i`** into `Instruments/`.
- **Samples** — tree browser with duration/sample-rate/bit-depth per WAV, usage badges, and arrow-key audition. WAVs carrying user-placed slice markers (the M8 stores them as standard cue points) show their slice count.
- **Themes** — every `.m8t` rendered as a mock device screen in its own palette, with all 13 colour-role swatches. **Use** applies a theme's palette to the app itself, and the **theme creator** builds a new `.m8t` (from scratch or a copy of an existing one) with a live device-screen preview, saved straight to the card.
- **Bundles / Grooves / Renders** — bundle contents with song links, groove step visualisation, renders with waveform preview and playback.
- **Stats** — collection health, instrument types, firmware versions, most-used instruments and samples, songs by folder, a modification timeline, and FX command usage (analyzed on demand, cached).

No card handy? **Try with demo data** on the landing screen loads a synthetic in-memory card — songs, instruments, themes, a repairable broken reference — so every tab, the editors, playback and the repair flow can be explored without hardware.

### Play

- **In-browser playback** — press ▶ on any song and hear it. A Web Audio engine walks the song grid the way the tracker does: grooves, per-track `GRV` switches, `HOP` flow, chain transposes, the volume column, and `KIL`, with the mix run through a limiter. An honest sketch, not an emulation: only SAMPLER instruments sound (synth voices are silent and counted in the transport bar), and `TPO` tempo changes are ignored.
- **Play anything** — the whole song, one song row across all 8 tracks, one chain, or one phrase. **Space** plays whatever you're looking at.
- **Transport** — a bottom bar with what's playing, a draggable scrub bar, loop toggle, elapsed/total and stop; while anything plays the grid outlines each track's current cell and the open chain/phrase highlights its current step.
- **Render to WAV** — bounce the mix to a stereo 16-bit WAV, or to **stems**, one WAV per track, zipped. Rendered offline through the same scheduling as the preview.

### Arrange and edit

- **Pattern editor** — the song grid, editable: click any cell to choose a chain from a filterable pick-list (used, defined-but-unplaced, and free slots), arrow keys walk the grid, shift+arrows or shift+click select a block that copies, pastes or clears as a unit, rows copy/paste from the gutter, and spare rows extend the arrangement. Chains are coloured by number group, with custom per-chain colours that can be saved to the card (`M8Librarian_colours.json`).
- **Chain editor** — edit any chain's 16 steps in place: phrase per step and per-step transpose, with **Clone** to copy a chain and repoint the grid cells that used it.
- **Phrase editor** — a tracker-style grid edited in place: notes, instruments and FX chosen by name with fuzzy matching, block selection over steps and columns (copy/paste/clear/transpose), insert/delete step, ±1/±12 transpose, per-step and whole-phrase clipboard, a 40-level undo, and an optional QWERTY piano mode for typing notes.
- **Scale lock** — the editor knows the song's key (chosen or detected), flags out-of-key notes, snaps entry to the key when locked, moves by scale degree, and offers a one-click conform when the scale is explicit.
- **Generators** — preview-then-apply phrase generation: Euclidean rhythms with rotation, arpeggios over twelve chord shapes in four patterns, seeded variations of what's already there, and a humanise pass on the volume column. Nothing is written until Apply; one undo takes it all back.
- **Groove editor** — edit any groove's step ticks.
- **Song map** — named section bands dragged over the arrangement, notes pinned to rows, PNG/SVG export, and a sidecar on the card (`M8Librarian_map.json`) so the marked-up map travels with it.

All edits are held in memory until you explicitly save; the save previews every change, then goes through the same backup/verify/rollback path as repairs.

### Device (USB)

- **Live screen mirror** — connect the M8 over USB (WebSerial) and watch the device screen in the browser, with PNG snapshots, pop-out window, fullscreen, and recording straight to `.webm`. Reachable from the landing page, no SD card needed. Requires Chrome/Edge on `https://` or localhost. A **demo screen** animates a fake M8 display so the mirror, effects and recording can be tried without hardware.
- **Output effects** — nineteen GPU effects over the mirror (CRT, glitch, VHS, scanlines, grades and more) with presets, per-parameter control and persistent settings, reimplemented from [DMG Darkroom](https://github.com/clickysteve/dmg-darkroom) as a single WebGL pass.
- **Audio-reactive effects** — drive any effect from a live audio input (bass/mids/highs/level/transients), riding on top of your slider settings.
- **Experimental input** — an off-by-default control mode sends key states using the community-documented remote protocol. The protocol details are marked and degrade gracefully; the display side is read-only and safe.

### Maintain

- **Problems tab** — broken sample references, unreadable files, unused instruments and samples (with reclaimable sizes), duplicate instrument names, content-identical samples (byte-level dedupe scan), your backbone sounds, and the repair log.
- **Repair mode** — two fixes for a broken reference: *re-point* the file's sample path (candidates ranked, previewable, save-as-copy default or overwrite-with-backup), or *copy the sample in* — write a matching WAV to the referenced path without touching the song file. **Fix all exact matches** batch-repairs every unambiguous reference.
- **Trash, not delete** — cleanup moves unused samples to `M8Librarian_Trash/` on the card. The Trash tab restores files (refusing if the name has reappeared) or deletes permanently.
- **Backup** — copy the card to a folder or download it as a ZIP, with per-directory selection.
- **Sets** — build **ordered** setlists: click songs in play order, reorder by drag or arrows, then export a lean card layout as a folder or ZIP, optionally with numbered filenames (`01_`, `02_` …) so the device lists them in order. Sets save with their order.

macOS junk files (`._*`, `.DS_Store`, Spotlight folders) are filtered everywhere. The hosted page installs as an offline-capable PWA.

## The safety model

The card is opened **read-only**. Nothing is ever written unless you explicitly confirm a repair or an export, and repairs are engineered to be paranoid:

- Write permission is requested only when you press Apply.
- Default is **save as a new copy** (`NAME_FIX.m8s`); the original is untouched.
- **Overwrite** mode first copies the original to `M8Librarian_Backups/<timestamp>/` on the card.
- Before writing, the file's modification time is checked against the scan and the fresh bytes are re-parsed; if the file changed since you scanned (say, you edited it on the M8), the repair refuses and asks for a rescan.
- After writing, the file is re-read and re-parsed to verify the change. If verification fails, the write is automatically rolled back (original restored from backup, or the bad copy deleted).
- Deletions are never destructive: cleanup moves files to `M8Librarian_Trash/`.
- Every repair, edit, trash move and export is recorded in an audit log: in the browser and appended to `M8Librarian_Backups/audit-log.txt` on the card itself, so the history travels with the card.

Everything runs locally. There is no server, no telemetry, and no network access beyond loading the page itself.

## Firmware compatibility

File parsing works across firmware 1.x through 6.x — the core song layout (grid, phrases, chains, instrument table) is byte-identical across versions, verified against [m8-js](https://github.com/whitlockjc/m8-js) and [m8-files](https://github.com/AlexCharlton/m8-files) and against real 6.x song files. All instrument types are recognised, including HyperSynth and External Instrument (3.0+). FX command names are version-aware: the sequencer/mixer tables changed in firmware 3.0 and 4.0, and the right table is chosen from each file's own header. Instrument-specific commands (0x80+) resolve through the instrument's type and its modulator types, including the extra commands (`SLI`, `TRG`, `FMP`, `CVO`/`SNC`, `ADD`/`CHD`). Known limitations:

- MIDI export uses groove 0 for timing; per-phrase `GRV` commands and flow commands (`HOP`) are not applied.
- MIDI export models the 8 tracks independently (as the M8 does); cross-track sync assumes conventionally aligned chain lengths.
- Commands newer than the 4.x-era tables display as hex.

## Development

The entire app is a single `index.html` — CSS, markup, and JavaScript — deliberately, so it can be hosted anywhere (it's on GitHub Pages) and audited in one read. Internal modules: `M8` (binary parser/writer), `Cache` (IndexedDB), `Scanner`, `Zip` (store-method ZIP writer), `AudioPlayer`, and one UI module.

Tests are zero-dependency Node scripts that extract the modules straight out of `index.html`:

```bash
node tests/parser.test.mjs      # binary parser unit tests
node tests/fuzz.test.mjs        # seeded fuzz + property tests (parsers must never throw)
node tests/midi.test.mjs        # MIDI export vs an independent SMF reader
node tests/editor.test.mjs      # editing-suite byte encoders, round-tripped through the parser
node tests/player.test.mjs      # playback timeline builder + WAV encoding
node tests/usb.test.mjs         # SLIP decoder + display-command parser
node tests/generators.test.mjs  # phrase generators: determinism, scale purity
```

The M8 file format knowledge is derived from [whitlockjc/m8-js](https://github.com/whitlockjc/m8-js) and [AlexCharlton/m8-files](https://github.com/AlexCharlton/m8-files) (both Apache 2.0) — thank you to both authors.

Not affiliated with Dirtywave. Use at your own risk; the read-only default and backup-first repairs exist precisely so that risk stays near zero.
