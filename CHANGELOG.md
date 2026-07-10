# Changelog

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
