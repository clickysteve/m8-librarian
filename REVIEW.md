# Deep review — findings and remaining parity gaps

A full code, performance and feature-parity review of M8 Librarian against
pt-librarian v1.3.0. Everything in the "fixed" list has shipped; this file
is the record of what was found and what is left.

## What was fixed this round

See the CHANGELOG entry for detail. In short: one data-corruption bug, one
crash-with-data-loss, two silently-wrong-output bugs, three features that
existed but had no reachable UI, and a performance pass that cut card load
on a large library by roughly 5x.

## Where the parity audit landed

The FX module is now **byte-identical** to pt-librarian's: same 32 effects,
same 23 presets, same routing engine. AudioReact is byte-identical too. No
module is missing, no tab is missing, and the M8 has two tabs pt does not
(Bundles, Trash).

What follows is genuinely still missing, in the order worth doing.

### 1. Slice editor

The single biggest workflow gap. pt has a full waveform slice editor:
scroll-wheel zoom, draggable markers, double-click to add, `1`-`9`/`0` pad
audition, transient auto-chop, equal divide, zero-crossing snap, written
through the normal backup/verify/rollback path.

M8 Librarian can only *count* slices today. The read side already exists
(`M8.parseWavCues` — the M8 stores slices as standard WAV cue points), so
this is a write-side build: a `cue`/`LIST-adtl` chunk writer next to
`writeSamplePath`, and a modal alongside the instrument inspector. Unlike
the picoTracker, offsets go into the WAV rather than the song file, so no
new `M8Edit` region is needed.

Sliced breaks are core M8 practice. This is where the remaining effort
should go.

### 2. Instrument parameter editing

pt can edit instrument parameters with sliders and write them back. M8
Librarian has a read-only inspector. The plumbing is already there and the
code even says so: `M8Edit.encodeInstrParamByte(slot, offsetInSlot, val)`
exists and is exported, and adding a `dirtyInstrs` map to
`buildEditRegions` is a one-line change that the existing verify covers for
free. Start with the kind-independent blocks (filter cutoff/res, amp,
mixer) where the byte map is already known and unit-testable.

This would also close the last step of the ⌥↓ hierarchy walk, which stops
at the phrase where pt continues into the instrument.

### 3. The Instruments tab only shows `Instruments/*.m8i`

On the M8 almost every instrument lives inside a song's bank; standalone
`.m8i` files are the exception. pt merges project banks into its instrument
list behind a toggle. Here, the parse already exists (`song.instruments` is
populated and used by the player), so this is a UI-layer merge in
`renderInstrs` plus a checkbox. Type filters, sorting and usage tracking
all currently operate on an unrepresentative slice of the collection.

### 4. Playback fidelity: tracks drift out of lockstep

`buildTimeline` skips empty grid cells and empty chain steps with no time
advance, so channels with different chain lengths drift apart as playback
proceeds — and the drift compounds into WAV renders and stems. The code is
honest about this in a comment. pt implements firmware-accurate group
looping verified against `Player.cpp`.

Worth confirming the M8's exact chain-termination semantics against
`m8-files` before changing anything: this is flagged because it diverges
from the sibling app, not because the hardware behaviour was verified here.

### 5. MIDI export ignores GRV and HOP

The MIDI export reads groove 0 only and has no `HOP` handling, so a song
that uses either exports a different groove and arrangement from the one
the audio preview plays. The player already contains exactly the logic
needed — the `gSteps`/`hopEntry` block in `buildTimeline` can be lifted
into `buildMidiTracks`. Per-instrument note length is a related gap.

(Song and chain transposes now apply to both paths, as of this round.)

### 6. Smaller items

- **Create a new song on the card.** pt can start a project from the
  browser; here you can only edit songs the device already made. The demo
  card generator already synthesises valid song bytes, so the template
  exists.
- **Mirror font faces.** pt rasterises six alternate faces at runtime. The
  M8 deliberately doesn't embed the device font for licensing reasons, so
  the mirror already draws in a substitute — offering a choice is strictly
  better than the one hardcoded face.
- **UI text-size control**, a `↺ Refresh screen` button for the USB mirror
  (the app already sends the refresh opcode once at connect but never
  exposes it), and two more Stats cards (tempo distribution, key/scale —
  the key data is already computed and cached, so it is nearly free).
- **`renderPatternGrid`** (~90 lines) is dead code with no callers, left
  over from before the editable grid. Worth deleting.

## Not applicable

pt features that are picoTracker-hardware-specific and should not be
ported: the Advance 720x720 mirror model and its font atlas, the embedded
bitmap font, `.config.xml` device-config handling (the M8 keeps no config
file on the card), autosave badges, the pico project/instrument/theme file
formats, and pt's island scheduler as a firmware-fidelity claim. The
*section* concept from that last one does map, and is implemented here.

## Verified healthy

Worth recording so the next review doesn't re-spend the effort:

- Scanning is O(n) and reads each file exactly once; incremental rescan
  re-reads zero bytes and correctly reports "0 parsed, N unchanged".
- Derived maps (usage, sample usage, dupes, tree) are all Map-based and
  measured at 0-8ms even at 1200 songs. No `indexOf`/`find` in a loop.
- Parsing on the main thread yields between files; a 300-song scan
  produced one long task, and it was rendering, not parsing. A worker
  would be wasted effort.
- The FX render loop memoises uniform locations, gates the 2.7MB source
  texture upload on unchanged frames, uses `texSubImage2D` where it can,
  compiles shaders once, and idles correctly when the tab is hidden.
- The windowed-looping player frees finished nodes, clears its interval on
  stop, and holds a flat heap across 45 seconds of continuous looping.
- `appendChunked`'s IntersectionObservers do not leak.
- The editor's byte encoders round-trip cleanly through 40 iterations of
  30 randomised mutations each against a real card, and the save
  protocol's freshness guard, bounds check, backup, verify and rollback
  are all correct.
- Parsers and the timeline builder survive 300 hostile byte mutations and
  a truncation sweep without throwing.
