# Changelog

## Unreleased — real-data review round

Validated the whole parsing stack against real M8 cards (firmware 6.0–6.5 song, instrument and sample files) and fixed what the synthetic fixtures couldn't catch.

- **Version-correct FX command names.** Firmware 3.0 inserted `RND`/`RNL`/`RMX`/`PBN`/`TBX`/`OFF` into the sequencer command list (shifting everything after `KIL`) and 4.0 renamed and extended the mixer block — the app used the 2.x table for every file, so modern songs showed `REP` where the device shows `RET`, `PVX` for `PBN`, and so on. Sequencer/mixer names now come from the file's own header version, in the viewer, the phrase editor (display, pick-lists and typed entry) and the FX stats.
- **Instrument-command block decoded properly.** Commands `0x80`+ now follow the real layout: 18 per-type commands, then 5 commands per modulator × 4 (named from each instrument's actual modulator types, parsed from the song), then the extra commands — `SLI`, `TRG`, `FMP`, `CVO`/`SNC`, `ADD`/`CHD`. Previously the modulator block was 4 slots too short with wrong LFO names, so e.g. `SLI` (slice select, all over real sliced-break songs) displayed as raw hex. When a step has no `INS` in scope and the song only contains one instrument type, that type's names are used.
- **Slice markers surfaced.** The M8 stores user-placed sample slices as standard WAV cue points; the sample browser now walks each WAV's chunk list (small ranged reads) and shows the slice count. Groundwork for a slice editor.
- **Songs carry their save path.** The 128-byte directory field after the header (e.g. `/Bundles/NAME/`) is parsed and shown in the song detail strip.
- Firmware 6.x confirmed working end to end (header version decode matches m8-files exactly); docs updated from "1.x–4.x" to "1.x–6.x".
- Cache schema v6 (adds modulator types and save directory to cached parses; first open after updating rescans).

## Unreleased — parity with pt-librarian

Ports the feature set built out in the sibling picoTracker Librarian back to the M8, adapted to the M8's binary formats. Roughly doubles the app.

### Arrange and edit
- Editable pattern workspace: song grid with cursor, chain pick-lists (used / defined / free slots), shift block selection with copy/paste/clear, row gutter ops, spare rows, group-hued chain colours with custom picks and a card sidecar (`M8Librarian_colours.json`).
- Chain editor (phrase + transpose per step, Clone-with-repoint) and a full tracker-style phrase editor: fuzzy pick-lists for notes/instruments/FX, QWERTY piano entry, block ops across steps and columns, insert/delete step, ±1/±12, 40-level unified undo.
- Scale lock (chosen or detected key, snap, degree-wise transpose, explicit-only conform) and seeded generators (Euclidean, arpeggios over 12 chord shapes × 4 patterns, variations, humanise) with preview-then-apply.
- Groove editor. Saves preview every change, then run through the backup → write → verify → rollback path with `{mode:'edit'}` audit entries.

### Play
- In-browser playback: Web Audio sampler sketch honouring grooves, per-track GRV switches, HOP flow, chain transposes, the volume column and KIL, through a limiter. Play the song, a row, a chain or a phrase; Space plays what you're looking at; transport bar with scrub, loop and live grid/chain/phrase highlighting.
- Render to stereo 16-bit WAV or per-track stems (zipped), offline through the same scheduler.
- Known limits: synth engines are silent (counted in the transport), TPO ignored.

### Device (USB)
- Live M8 screen mirror over WebSerial using the community-documented SLIP protocol (uncertain details marked and tolerant), with PNG snapshot, pop-out, fullscreen and .webm recording.
- Nineteen WebGL output effects with presets (from DMG Darkroom, reimplemented as one shader pass) and audio-reactive modulation from a live input. Experimental input mode, off by default.

### Library
- Trash instead of delete: unused samples move to `M8Librarian_Trash/`; Trash tab with restore (reappearance refusal) and permanent delete.
- Repair-by-copy: fix a broken reference by writing the matching WAV to the referenced path, never touching the song file (triple-verified).
- Extract any song-bank instrument as a `.m8i` (slot + table block, round-trip verified).
- Ordered setlists with drag/arrow reorder and numbered export (`01_NAME.m8s`).
- Annotated song map: section bands, pinned notes, PNG/SVG export, `M8Librarian_map.json` sidecar.
- Demo mode: synthetic in-memory card from the landing page.
- FX-usage stats (analyzed on demand, mtime-cached; cache schema v5).
- macOS junk-file filtering everywhere; PWA (manifest + service worker + icons).

### Tests
- Four new suites extracted from the shipped file: editor byte encoders, playback timeline + WAV encoding, SLIP/display parser, generators. Plus end-to-end browser smokes for the editors, playback wiring and the QoL layer.


## Unreleased

### Added
- **MIDI export** — any song downloads as a standard MIDI file (type 1, 24 PPQ): one MIDI track per M8 track, groove-0 timing, chain transposes, KIL-aware note-offs. Verified against an independent SMF reader in tests.
- **Batch repair** — "Fix all exact matches" repairs every broken sample reference that has exactly one exact-filename candidate, in one confirmed pass with per-file audit entries. Ambiguous references stay in the per-file dialog.
- Fuzz and property test suite (`tests/fuzz.test.mjs`): parsers are verified total over random/truncated/mutated inputs; ZIP output validated against zlib CRCs; sample-path writes round-tripped.
- README and this changelog.

### Fixed (adversarial audit)
- **Cross-card races**: opening a second card while a scan, catalogue, key analysis, or dupe scan was still running could write the first card's data into the second card's state and cache. All long operations now carry a card-generation token and abandon their results if the card changed.
- **Repair safety**: repairs now refuse if the file changed on disk since scanning (mtime check) and match instrument slots against a fresh re-parse rather than cached offsets; verification failures automatically roll back (restore from backup / delete the bad copy).
- **ZIP integrity**: error paths now abort the write instead of committing a truncated archive over an existing file; exact size accounting near the 4GB boundary.
- Audit log is per-card and appends to the card-resident file instead of rebuilding it from browser storage (survives cleared browser data and other machines).
- Sample/bundle browser state is fully reset when a new card is opened; open modals and pending compare-picks are closed.
- Stronger cache-key fingerprint (includes Songs/ listing) to prevent cache collisions between identically named cards.
- Truncated `.m8i` files no longer produce phantom NUL sample references; all binary writes are bounds-checked.
- Escape closes the repair dialog; global shortcuts are inert while it is open; sample audition no longer fires behind modals.
- Restored firmware filter that matches nothing on the current card resets to "All firmware" instead of hiding the library.
- Bundle-browser file extensions are HTML-escaped (injection via hostile filenames).
- Sundry: stuck lazy-tab spinners on read errors, set-builder options no longer reset on selection changes, stale chunked-render callbacks, compare-pick highlight on late-rendered rows.

## v0.4.1 (feature sessions)

### Repair mode, sets, and inspection
- Repair mode: relink broken sample references with candidate ranking, previews, save-as-copy default, overwrite-with-backup, post-write verification, and an on-card audit log.
- Set builder: pick songs, resolve their full dependency set (samples, bundles, sizes, missing warnings), export as folder or ZIP; named saved sets.
- Arrangement map: chain-colored timeline of the song grid in the pattern viewer.
- Full instrument inspection: synth params, filter, amp/mixer, all modulators with envelope curves (firmware 1.x-4.x layouts).
- WAV metadata (duration/rate/bits) in the sample browser plus arrow-key audition.
- Key/scale detection per song; BPM and key columns and sorts.
- Theme skinning: apply any .m8t palette to the app UI.
- HyperSynth and External Instrument types recognised (firmware 3.0+).

### Scanning and analysis
- Incremental rescan (unchanged files reuse cached parses).
- Real M8 FX command names in the phrase viewer (sequencer, mixer, per-instrument).
- Content-identical duplicate sample detection (size grouping + SHA-256).
- Unused-sample reclaimable sizes; unreadable files surfaced in Problems.
- Richer song diff: metadata strip, sample-path comparison, pattern summaries.
- ZIP backup (streamed, store-method); chunked rendering for large libraries.
- Parser test suite; pattern offsets verified stable across firmware 1.x-4.x.

### Fixes (first review pass)
- Interactive elements in expanded song rows actually work; Cmd/Ctrl shortcuts no longer hijacked; audio contexts no longer leak; attribute escaping; cache keys fingerprint card contents; lazy tabs scan on restore; firmware-sorted dropdown; safer backups (no card-into-itself copies).
