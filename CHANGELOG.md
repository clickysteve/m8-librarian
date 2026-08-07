# Changelog

## Unreleased — deep review round: a data-corruption fix, dead play buttons, and a big performance pass

A full code and performance review against pt-librarian. The headline is a
silent data-corruption bug that had survived every safety net in the app.

### Fixed — data corruption (please update)
- **Editing one chain could rewrite every other chain you had opened.** The chain, phrase and table side panels are re-filled in place on every render, but their wiring attached a fresh listener to the *panel* each time, and every stale listener closed over the chain or phrase that was open when it was wired. Opening chain 02, then chain 03, then pressing Delete once wrote to **both** — and because the damage happened before the dirty map was built, the save preview, the byte verify and the re-parse all confirmed it as correct. The panels are now replaced with a fresh node per render, so a listener dies with the element it was bound to. Same fix covers the phrase and table editors.
- **The same leak froze and then killed the tab, losing unsaved edits.** Listener count doubled per edit: by the 13th table edit one keystroke took 27 seconds, and a longer session crashed the renderer with the whole in-memory editing session in it. Now flat: one live listener per panel no matter how many renders, and commit time stays ~25ms.
- Table-only saves recorded an empty ref list in the on-card audit log, so the trail couldn't say which tables changed.
- In the table editor, `Delete` left a half-typed hex digit in the buffer, so typing `1`, pressing Delete, then typing `A` committed `0x1A` — a value never entered.

### Fixed — silently wrong output
- **The song's global transpose was parsed, displayed, and then ignored by everything.** Any song with a non-zero transpose previewed, rendered to WAV and exported to MIDI at the wrong pitch, with no indication. It now applies in both the player and the MIDI export, stacking with the chain-step transpose as it does on hardware.
- **Playback ignored pan.** The audio graph had a stereo panner that only ever received centre, so hard-panned kits collapsed to mono in previews, WAV renders and stems. The instrument's mixer pan is now honoured.

### Fixed — features that existed but could not be reached
- **Section play had no button.** The row ▶ documented last round was never wired: the grid emitted `data-rlbl` where the transport matched `data-row`. Every row now has a ▶ in its gutter (and the row number plays it too), running the section-play path that was already built and tested.
- **▶ on every chain** in the pattern editor's chain list, and on the **chain and phrase editor headers**.
- **Space played the chain even with a phrase open.** It resolved the panel with a bare `.pv-detail`, which always matched the chain panel first, so the phrase branch could never fire. The same bug meant the phrase editor never lit its currently-playing step during playback. Both now resolve the two panels explicitly.

### Performance
Measured on synthetic cards in headless Chromium; the review's own harness is the source of both numbers.

- **Card load on a 500-song / 300-instrument library: 1055ms → 217ms.** DOM nodes 744,000 → 101,000; event listeners 147,000 → 4,500.
- The instrument rows built one "used in" chip **per song per instrument** — quadratic in a normal collection, since instrument names are shared across songs by design, and all of it inside a panel that starts collapsed. The list is now capped at 8 with a `+N more…` that expands on click.
- **The song list view is now streamed and its detail built on expand.** It was rendering every row's full collapsed detail up front: 156 DOM nodes per song against 9 in the compact view. At 1000 songs the list is now flat at ~3,500 nodes instead of 156,000, and a filter keystroke costs 13ms of script instead of 234ms. Instrument lists stream the same way.
- **The Stats tab no longer rebuilds when it isn't showing**, and `fmtDate` reuses one `Intl.DateTimeFormat` instead of constructing one per song — together 341ms of every card load on a large library.
- **The sample browser's filter box is debounced** like every other filter in the app: ~100ms of blocking work per keystroke at 5,000 samples, now 0.

### Delivery
- **The service worker now hands over the new build in the same visit.** It is cache-first, so a returning visitor ran the *previous* build and only picked up the new one on their next navigation — acceptable for a cosmetic change, wrong for a correctness fix. The cache version is bumped (which purges the stale one on activate) and the page now reloads once when a new worker takes control. If there are unsaved edits in memory the reload is skipped, because losing someone's work to fetch a fix would be its own bug.

### Verified sound (no change needed)
Scanning is O(n) and reads each file exactly once; incremental rescan re-reads zero bytes. The FX render loop memoises uniform locations, gates the 2.7MB texture upload on unchanged frames, and idles correctly. The windowed-looping player frees its nodes and holds a flat heap over long loops. The editor's byte encoders round-trip cleanly through 40 iterations of randomised mutation against a real card, and the save protocol's freshness guard, backup, verify and rollback are all correct.

## Unreleased — the pt 1.2.0/1.3.0 catch-up: background feedback + Lottes CRT

### Effects
- **Background feedback** (31st effect): the letterbox region becomes a live video-enhancer feedback loop. Last frame's own output is resampled through a zoom/rotate/hue-spin transform at near-unity **loop gain** and soft-clipped like a saturating tube, so it self-oscillates into swirling analogue colour instead of whiting out. The loop is excited by **screen bleed** (the display's own spilled glow — the bloom prepass now runs whenever the background needs it, even with the glow effect off) and a slow video-synth **oscillator** for colour waves when the screen is dark. **Drift** wanders the resample point on a slow Lissajous so the loop never settles, and **Screen echo** rescans last frame's finished picture — every effect included — into the loop at wandering offsets. **Picture inset** floats the display smaller over the churn. All of it audio-routable. With a Custom wide output, the display sits on a wall of feedback: the "camera pointed at the monitor" rig with none of the cables.
- **CRT (Lottes)** (32nd effect): a port of Timothy Lottes' public-domain CRT shader (the RetroArch `crt-lottes`). A gaussian beam is drawn per scanline in linear light (beam hardness and pixel sharpness exposed), through his shadow masks: aperture **grille**, compressed **TV** mask, or stretched **VGA** mask, with a depth control. It replaces the plain sampler while on (RGB offset/planes pause; everything else composes) and runs in device-pixel space so the beam sits on the M8's real 320×240 scanlines at any output size.
- **Two new presets** — **Enhancer loop** and **Lottes CRT** — 23 total. Both new effects join 🎲 Random's curated pools.

### Fixed
- **Empty chain steps no longer show a -1 transpose.** An empty step (phrase `--`) whose transpose byte is FF-fill now reads as transpose 0, matching what the firmware writes for blank steps; a real -1 transpose on a placed phrase is untouched. The demo card generator also now blanks chain steps the way the firmware does (phrase FF, transpose 00).

## Unreleased — the "port everything" round

The remaining pt-librarian features, previously deferred as too large, now ported in full.

### Playback
- **Seamless looping**: the loop toggle no longer restarts the song at the end — playback is scheduled in rolling 25-second windows ahead of the playhead, so a looping song rolls straight over the boundary with no gap and no re-click. Applies to whole songs, from-row, chains and phrases alike.
- **Row ▶ plays the section**, not just to the end of the song: from the clicked row down to the next blank row (a blank grid row is a section break on the M8, as it is on the picoTracker). Blank rows decline to play.

### Effects
- **The full multi-route audio routing UI**: every effect card can now hold up to three audio→parameter routes, each with its own source (bass/mid/high/level/hit), target parameter and depth, added with a ＋ react button and deleted per-row. Previously the panel edited only the first route; presets that shipped multi-route wiring now show all of it.

### Editors
- **Table editor** — the ⊞ Tables button in the pattern editor opens the M8's 256 instrument/FX tables: a chip list with state dots for tables holding data, and a 16-step editor (transpose, volume, three FX columns) with hex cell entry, arrow-key movement and undo. FX names resolve through the owning instrument, version-aware like the phrase editor. Edits ride the same in-memory dirty state, save preview, and backup/verify/rollback write path as everything else.
- **⌥↓ / ⌥↑ walk the hierarchy**: from a grid cell dive into its chain, from a chain step into its phrase, and back up — without touching the mouse.
- **Insert-paste for grid rows**: the row gutter paste now inserts, shifting rows down (with a warning if content would fall off the end of the grid) instead of overwriting.
- **🔍 INS in the phrase editor** — jump straight from a phrase to a full read-only inspector of the instrument under the cursor (synth, filter, amp/mixer and modulator parameters, decoded fresh from the file bytes). Esc or click-away closes it.

## Unreleased — the SIGNAL//ROT round (pt-librarian 1.0.1→1.1.0 catch-up)

### Effects: a real video-effects rig
- **Five new / upgraded effects (30 total)**, the circuit-bent signal path from SIGNAL//ROT: **composite signal** (YIQ chroma bleed, NTSC rainbows, dot crawl, ringing), **tape rot** (streaky luma noise, chroma speckle, comet-tail dropouts, generation loss), **sync damage** (H-sync wobble, slipping V-hold with a blanking bar, mains hum bar), **bent enhancer** (oscillating edge ghosts, luma-hue chasing, strobing keyed inversion), **rainbow map**, and **trails → trails/rescan** — the feedback buffer can be zoomed, rotated and hue-spun as it decays, compounding into tunnels and colour spirals. Old looks load unchanged.
- **Four new presets** (Signal rot, Third-gen tape, Bent enhancer, Rescan feedback) — 21 total. Everything is audio-reactive through the per-parameter routing and included in 🎲 Random's pools.
- **Custom output dimensions**: the Output picker gains **Custom…** with free width × height (320-3840 × 240-2160) — wide banners, ultrawide walls. Custom dims persist, survive Reset, travel in look files, and are locked while recording.

### MIDI
- **⬇ MIDI stems** — one .mid per track that plays, zipped; the MIDI counterpart of the audio stems.
- **MIDI OUT / EXTERNAL INST instruments export on their configured channel** (carried across steps like the device does; note-offs close on the same channel). Everything else stays on the track's own channel.

### Mirror
- **The effects moved into a drawer** (pt 0.9.11's layout, by request): the mirror owns the left of the Device tab and the whole effects panel lives in a slide-out sidebar down the right — single-column cards, remembers whether it was open, and at narrow windows it overlays the mirror rather than crushing it (never the toolbar, which holds the button that closes it).
- **Screen text stamp** — a Text field stamps over the mirror (demo screen AND a connected M8) right before each frame reaches the effects, so the device redrawing its own title never wins the race. Top covers the title area, Bottom writes along the last row, colour picker included; blank shows the device's own text.
- **Live opcode counters** — while connected the status chip counts received draw commands (T text · R rects · W waveforms · ? unknown), so "the mirror isn't showing X" can be diagnosed as client-side or firmware-side at a glance.

Not ported: the Advance 720×720 panel/font work (pico-specific hardware) and pt's island/endless-loop scheduling (picoTracker firmware semantics).

## Unreleased — pt-librarian 0.9.11→0.9.16 catch-up round

pt-librarian moved six releases ahead of the parity port; this brings the applicable improvements across, adapted to the M8.

### Playback
- **Row ▶ plays from that row to the end** (all channels, transport says "from row XX") instead of looping one row in isolation.
- **Sampler loop modes are honoured**: FWDLOOP and OSC loop natively; **FWD PP and OSC PP actually pingpong** through a composite buffer (the loop region mirrored, interior only — built once per sample per play, live and in WAV renders alike). REV modes stay one-shot forward. Degenerate few-frame loop regions (the granular/timestretch trick) fall back to one-shot rather than buzz. Sample START offsets are applied.
- Finished notes free their audio nodes (long looped sessions no longer grow the graph).

### Effects (the 0.9.12 round, adapted)
- **Six new effects** — phosphor trails (a real feedback buffer), pixelate, hue cycle, kaleidoscope, refresh bar, invert/solarise — twenty-five total.
- **Seven new presets** (Oscilloscope, Rainbow drift, Broadcast, Mosaic, Negative, Kaleidoscope, Séance), seventeen total.
- **🎲 Random** rolls a curated look; your own wiring survives where the roll keeps that effect.
- **⇩ / ⇪ Look** — save and load the whole effects state as a small JSON file, imported through the same sanitiser as stored settings.
- The engine now supports up to three audio routings per effect, each mapping any source to any numeric parameter (presets and Random use them; the panel edits the first route and counts the rest).

### Editors
- **The active cell is marked**: a persistent high-contrast marker that survives the chain highlight, block selection and the playhead, with the row number and channel header lit up with it.
- **Grid manners**: clicking an empty grid cell just selects it — the picker opens on typing, Enter or a double-click. Every grid row has a one-click gutter clear (✕, undoable), and every phrase-editor step has a hover ✕ that clears the whole step.

### Library
- **🗑 from the sample browser**: every WAV row can move to `M8Librarian_Trash/` (restorable from the Trash tab), with a loud warning if songs still use it.
- **Instrument rows are playable**: instruments whose sample resolves on the card get a ▶ right on the row; missing WAVs and synth types offer nothing rather than a dead button.
- **ZIP exports batched into 4MB writes** — card/Dropbox backup and set ZIPs no longer crawl through thousands of tiny File System Access writes.
- The **M8 LIBRARIAN title is a home button** (closes whatever is open, back to Songs) and the version number links to GitHub.

## Unreleased — discoverability + theme creator round

- **Dashboard and pattern editor, one click away.** Every song row (list, dense and grid views) now has ⧉ (song dashboard) and ▦ (pattern editor) buttons, the ▦ opens the dashboard with the editor already expanded, and the expanded row leads with "Song dashboard" / "Pattern editor" buttons.
- **Theme creator.** ＋ New theme on the Themes tab (or ✎ on any theme to start from a copy): all 13 colour roles with pickers, a live device-screen preview, and Save writes `NAME.m8t` into `Themes/` on the card (never overwrites, verified after writing, audit-logged). With no card open it downloads the file instead.
- **Representative theme previews.** Theme cards now render a mock M8 SONG screen in the theme's palette — title, info, empty/default/value text, play-marker row, cursor, selection, scope slider and the three meter segments are all visible — instead of a generic four-row strip.
- **Correct 13-role theme decode.** The .m8t colour list was 8 roles with wrong names past the second (verified against m8-files: background, empty/info/default/value/title text, play marker, cursor, selection, scope slider, meter low/mid/peak). Swatches, previews and app skinning now use the real roles.
- **Mirror demo screen.** ▶ Demo screen on the Device tab animates a fake M8 SONG screen (play marker, cursor, live scope) on the mirror, so the output effects, audio-reactive mode and recording can be tried with no device plugged in. Stops itself the moment a real M8 connects.

## Unreleased — real-data review round

Validated the whole parsing stack against real M8 cards (firmware 6.0–6.5 song, instrument and sample files) and fixed what the synthetic fixtures couldn't catch.

- **Version-correct FX command names.** Firmware 3.0 inserted `RND`/`RNL`/`RMX`/`PBN`/`TBX`/`OFF` into the sequencer command list (shifting everything after `KIL`) and 4.0 renamed and extended the mixer block — the app used the 2.x table for every file, so modern songs showed `REP` where the device shows `RET`, `PVX` for `PBN`, and so on. Sequencer/mixer names now come from the file's own header version, in the viewer, the phrase editor (display, pick-lists and typed entry) and the FX stats.
- **Instrument-command block decoded properly.** Commands `0x80`+ now follow the real layout: 18 per-type commands, then 5 commands per modulator × 4 (named from each instrument's actual modulator types, parsed from the song), then the extra commands — `SLI`, `TRG`, `FMP`, `CVO`/`SNC`, `ADD`/`CHD`. Previously the modulator block was 4 slots too short with wrong LFO names, so e.g. `SLI` (slice select, all over real sliced-break songs) displayed as raw hex. When a step has no `INS` in scope and the song only contains one instrument type, that type's names are used.
- **Slice markers surfaced.** The M8 stores user-placed sample slices as standard WAV cue points; the sample browser now walks each WAV's chunk list (small ranged reads) and shows the slice count. Groundwork for a slice editor.
- **Songs carry their save path.** The 128-byte directory field after the header (e.g. `/Bundles/NAME/`) is parsed and shown in the song detail strip.
- Firmware 6.x confirmed working end to end (header version decode matches m8-files exactly); docs updated from "1.x–4.x" to "1.x–6.x".
- Cache schema v6 (adds modulator types and save directory to cached parses; first open after updating rescans).

### Layout fixes (visual QA pass with real cards)
- The device-round HTML had landed outside the main layout container: the landing page's "MIRROR YOUR M8" entry and a duplicate DEVICE tab button rendered at the bottom of every tab (and on top of open modals), and the Device tab itself sat outside the tab area with a page-height gap above it. Everything is now in its proper place — the mirror entry lives on the landing screen and disappears once a card is open.
- Song rows: the play ▶ and compare ⇌ buttons had no grid columns, so they wrapped onto a second line under every row (and in the dense view the play button stretched into a full-width bar). The row grids now include them properly.
- The song modal now widens to fit the editors and the song map — previously the 720px modal clipped the song grid at track 4, hiding tracks 5-8.

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
