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
- **Songs** — list, compact, and grid views with folder tree, filtering, and sorting (name, date, missing samples, instrument count, BPM, key, firmware). Expand a song for its instruments, sample dependencies (with previews), and similar songs. The **♪ Keys** button detects each song's key/scale from its note content.
- **Instruments** — every `.m8i` decoded in full: synth parameters, filter, amp/mixer sends, and all modulators with envelope curves. Usage tracking shows which songs use each instrument.
- **Samples** — tree browser with duration/sample-rate/bit-depth per WAV, usage badges, and arrow-key audition (press up/down to walk the list and hear each sample).
- **Themes** — visual previews of every `.m8t`, with swatches. **Use** applies a theme's palette to the app itself.
- **Bundles / Grooves / Renders** — bundle contents with song links, groove step visualisation, renders with waveform preview and playback.
- **Stats** — collection health, instrument types, firmware versions, most-used instruments and samples, songs by folder, a modification timeline.

### Inspect
- **Pattern viewer** — open any song's arrangement: a chain-colored timeline of all 8 tracks, the full song grid, and drill-down into chains and phrases with real M8 FX command names (HOP, KIL, PLY, ...), plus a note histogram with scale detection.
- **Compare** — diff two songs: shared/unique instruments and sample paths, metadata side by side (BPM, transpose, quantize, firmware, sizes), and a pattern summary.
- **MIDI export** — download any song as a standard MIDI file (type 1, 24 PPQ, one MIDI track per M8 track, groove timing and chain transposes applied). Drag it into any DAW.

### Maintain
- **Problems tab** — broken sample references, unreadable files, unused instruments and samples (with reclaimable sizes), duplicate instrument names, content-identical samples (byte-level dedupe scan), your most-reused "backbone" sounds, and the repair log.
- **Repair mode** — relinks broken sample references by rewriting the path inside the `.m8s`/`.m8i` file. Candidates are ranked (exact filename matches first) and previewable. **Fix all exact matches** batch-repairs every unambiguous reference at once.
- **Backup** — copy the card to a folder or download it as a ZIP, with per-directory selection.
- **Sets** — tick songs, get their full dependency set resolved automatically (samples, bundles, sizes, missing warnings), and export a lean self-contained card layout as a folder or ZIP. Sets can be named and saved for reuse.

## The safety model

The card is opened **read-only**. Nothing is ever written unless you explicitly confirm a repair or an export, and repairs are engineered to be paranoid:

- Write permission is requested only when you press Apply.
- Default is **save as a new copy** (`NAME_FIX.m8s`); the original is untouched.
- **Overwrite** mode first copies the original to `M8Librarian_Backups/<timestamp>/` on the card.
- Before writing, the file's modification time is checked against the scan and the fresh bytes are re-parsed; if the file changed since you scanned (say, you edited it on the M8), the repair refuses and asks for a rescan.
- After writing, the file is re-read and re-parsed to verify the change. If verification fails, the write is automatically rolled back (original restored from backup, or the bad copy deleted).
- Every repair is recorded in an audit log: in the browser and appended to `M8Librarian_Backups/audit-log.txt` on the card itself, so the history travels with the card.

Everything runs locally. There is no server, no telemetry, and no network access beyond loading the page itself.

## Firmware compatibility

File parsing works across firmware 1.x through 4.x — the core song layout (grid, phrases, chains, instrument table) is byte-identical across versions, verified against [m8-js](https://github.com/whitlockjc/m8-js) and [m8-files](https://github.com/AlexCharlton/m8-files). All instrument types are recognised, including HyperSynth and External Instrument (3.0+). Known limitations:

- MIDI export uses groove 0 for timing; per-phrase `GRV` commands and flow commands (`HOP`) are not applied.
- MIDI export models the 8 tracks independently (as the M8 does); cross-track sync assumes conventionally aligned chain lengths.
- FX command names cover the 2.6-era command set; newer commands display as hex.

## Development

The entire app is a single `index.html` — CSS, markup, and JavaScript — deliberately, so it can be hosted anywhere (it's on GitHub Pages) and audited in one read. Internal modules: `M8` (binary parser/writer), `Cache` (IndexedDB), `Scanner`, `Zip` (store-method ZIP writer), `AudioPlayer`, and one UI module.

Tests are zero-dependency Node scripts that extract the modules straight out of `index.html`:

```bash
node tests/parser.test.mjs   # binary parser unit tests
node tests/fuzz.test.mjs     # seeded fuzz + property tests (parsers must never throw)
node tests/midi.test.mjs     # MIDI export vs an independent SMF reader
```

The M8 file format knowledge is derived from [whitlockjc/m8-js](https://github.com/whitlockjc/m8-js) and [AlexCharlton/m8-files](https://github.com/AlexCharlton/m8-files) (both Apache 2.0) — thank you to both authors.

Not affiliated with Dirtywave. Use at your own risk; the read-only default and backup-first repairs exist precisely so that risk stays near zero.
