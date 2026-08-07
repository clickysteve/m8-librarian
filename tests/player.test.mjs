// M8 Librarian — timeline builder + player test suite
//
// Zero-dependency: extracts the M8Player module from ./c-timeline.js and
// the device-neutral SongPlayer from ./songplayer.js (same loader pattern
// as ../tests/parser.test.mjs) and runs them against synthetic pattern
// structures — no DOM, no card, no audio device.
//
// Run with:  node port/c-tests.mjs
//      (or:  node --test port/c-tests.mjs)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── Extract the modules ────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
function extract(file, name) {
  const src = readFileSync(join(here, file), 'utf8');
  const startTok = `const ${name} = (() => {`;
  const start = src.indexOf(startTok);
  assert.ok(start >= 0, `${name} module not found in ${file}`);
  const end = src.indexOf('\n})();', start);
  assert.ok(end > start, `${name} module end not found in ${file}`);
  const body = src.slice(start, end + '\n})();'.length);
  // `window` is only touched inside play(); a stub keeps module eval happy.
  return new Function('window', `'use strict'; ${body}; return ${name};`)({});
}
const M8Player = extract('../index.html', 'M8Player');
const SongPlayer = extract('../index.html', 'SongPlayer');

// ── Fixtures ───────────────────────────────────────────────
const EMPTY = 0xFF;
const GRV = 0x03, HOP = 0x04, KIL = 0x05;

const step = (over = {}) => ({
  note: EMPTY, vol: EMPTY, instr: EMPTY,
  fx: [{ cmd: EMPTY, val: 0 }, { cmd: EMPTY, val: 0 }, { cmd: EMPTY, val: 0 }],
  ...over,
});
const fx1 = (cmd, val) => [{ cmd, val }, { cmd: EMPTY, val: 0 }, { cmd: EMPTY, val: 0 }];

function makePat() {
  return {
    grid: Array.from({ length: 256 }, () => Array(8).fill(EMPTY)),
    chains: Array.from({ length: 255 }, () =>
      Array.from({ length: 16 }, () => ({ phrase: EMPTY, transpose: 0 }))),
    phrases: Array.from({ length: 255 }, () => Array.from({ length: 16 }, () => step())),
    grooves: Array.from({ length: 32 }, () => Array(16).fill(EMPTY)),
    lastRow: -1,
  };
}
const makeSong = (over = {}) => ({
  name: 'TEST', tempo: 120,
  instruments: [
    { slot: 0, kind: 2, typeName: 'SAMPLER', name: 'KICK', samplePath: '/Samples/Drums/Kick.wav' },
    { slot: 1, kind: 0, typeName: 'WAVSYNTH', name: 'LEAD', samplePath: '' },
    { slot: 2, kind: 2, typeName: 'SAMPLER', name: 'SNARE', samplePath: '\\Samples\\Drums\\Snare.WAV' },
  ],
  ...over,
});

// tickSec at 120 BPM = 60/(120*24) = 1/48 s; default groove step = 6 ticks
const TS = 60 / (120 * 24);
const approx = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} !== ${b}`);

// Simplest playable song: phrase 0 = 16 notes (C-4, instr 0), chain 0
// step 0 → phrase 0, grid row 0 track 0 → chain 0.
function basicPat() {
  const pat = makePat();
  for (let s = 0; s < 16; s++) pat.phrases[0][s] = step({ note: 36, instr: 0 });
  pat.chains[0][0] = { phrase: 0, transpose: 0 };
  pat.grid[0][0] = 0;
  pat.lastRow = 0;
  return pat;
}

// ── Timeline builder ───────────────────────────────────────
test('default groove: step n lands at n*6*60/(bpm*24)', () => {
  const tl = M8Player.buildTimeline(basicPat(), makeSong(), {});
  assert.ok(tl, 'timeline built');
  assert.equal(tl.bpm, 120);
  const ons = tl.events.filter(e => e.kind === 'on');
  assert.equal(ons.length, 16);
  for (let n = 0; n < 16; n++) {
    approx(ons[n].t, n * 6 * TS, `step ${n} time`);
    assert.equal(ons[n].chan, 0);
    approx(ons[n].rate, 1, 'note 36 (C-4) is unity rate');
    assert.equal(ons[n].sampleKey, 'samples/drums/kick.wav');
    approx(ons[n].gain, 0.8, 'empty vol byte → 0.8 default');
    assert.equal(ons[n].loop, null);
  }
  approx(tl.duration, 16 * 6 * TS, 'duration = 16 default steps');
  assert.equal(tl.skippedSynths, 0);
});

test('swing groove via GRV: alternating 8/4 tick spacing', () => {
  const pat = basicPat();
  pat.grooves[1][0] = 8; pat.grooves[1][1] = 4;         // rest 0xFF-terminated
  pat.phrases[0][0].fx = fx1(GRV, 1);                    // switch on the same row
  const tl = M8Player.buildTimeline(pat, makeSong(), {});
  const ons = tl.events.filter(e => e.kind === 'on');
  // GRV applies to its own row's tick advance: 0, 8, 12, 20, 24, ...
  approx(ons[0].t, 0, 'swing step 0');
  approx(ons[1].t, 8 * TS, 'swing step 1');
  approx(ons[2].t, 12 * TS, 'swing step 2');
  approx(ons[3].t, 20 * TS, 'swing step 3');
  approx(tl.duration, 8 * (8 + 4) * TS, 'duration = 8 swing pairs');
});

test('groove filtering: zeros and >0x80 dropped, all-invalid falls back to [6]', () => {
  const pat = basicPat();
  pat.grooves[2][0] = 0; pat.grooves[2][1] = 0x90; pat.grooves[2][2] = EMPTY;
  pat.phrases[0][0].fx = fx1(GRV, 2);                    // invalid groove → [6]
  const tl = M8Player.buildTimeline(pat, makeSong(), {});
  const ons = tl.events.filter(e => e.kind === 'on');
  approx(ons[1].t, 6 * TS, 'fallback groove step is 6 ticks');
  // GRV to out-of-range id (>=32) is ignored
  const pat2 = basicPat();
  pat2.phrases[0][0].fx = fx1(GRV, 40);
  const tl2 = M8Player.buildTimeline(pat2, makeSong(), {});
  approx(tl2.events[1].t, 6 * TS, 'GRV >= 32 ignored');
});

test('chain transpose is signed and shifts rate', () => {
  const pat = basicPat();
  pat.chains[0][0].transpose = 12;                       // +1 octave
  let tl = M8Player.buildTimeline(pat, makeSong(), {});
  approx(tl.events[0].rate, 2, '+12 → rate 2');
  pat.chains[0][0].transpose = 0xF4;                     // signed −12
  tl = M8Player.buildTimeline(pat, makeSong(), {});
  approx(tl.events[0].rate, 0.5, '−12 → rate 0.5');
});

test('vol byte scales gain: 0xFF → 0.8, else 0.8*vol/0xFF', () => {
  const pat = basicPat();
  pat.phrases[0][1].vol = 0x80;
  pat.phrases[0][2].vol = 0x00;
  const tl = M8Player.buildTimeline(pat, makeSong(), {});
  const ons = tl.events.filter(e => e.kind === 'on');
  approx(ons[0].gain, 0.8, 'default');
  approx(ons[1].gain, 0.8 * 0x80 / 0xFF, 'explicit vol');
  approx(ons[2].gain, 0, 'vol 0 is silent');
});

test('KIL emits an off event at its step time', () => {
  const pat = basicPat();
  pat.phrases[0][3] = step({ fx: fx1(KIL, 0) });         // no note, just the cut
  const tl = M8Player.buildTimeline(pat, makeSong(), {});
  const offs = tl.events.filter(e => e.kind === 'off');
  assert.equal(offs.length, 1);
  approx(offs[0].t, 3 * 6 * TS, 'KIL at step 3');
  assert.equal(offs[0].chan, 0);
  assert.equal(tl.events.filter(e => e.kind === 'on').length, 15, 'KIL row itself has no note');
});

test('HOP: row plays nothing, next phrase enters at val & 0xF', () => {
  const pat = makePat();
  pat.phrases[0][0] = step({ note: 36, instr: 0 });
  pat.phrases[0][1] = step({ note: 48, fx: fx1(HOP, 0x04) }); // HOP row's own note is dropped
  pat.phrases[0][2] = step({ note: 40 });                     // never reached
  for (let s = 0; s < 16; s++) pat.phrases[1][s] = step({ note: 36, instr: 0 });
  pat.chains[0][0] = { phrase: 0, transpose: 0 };
  pat.chains[0][1] = { phrase: 1, transpose: 0 };
  pat.grid[0][0] = 0;
  pat.lastRow = 0;
  const tl = M8Player.buildTimeline(pat, makeSong(), {});
  const ons = tl.events.filter(e => e.kind === 'on');
  // phrase 0 contributes only step 0 (1 note, 6 ticks); phrase 1 enters at
  // step 4 → 12 notes, so 13 total and the second note is 6 ticks in.
  assert.equal(ons.length, 1 + 12, 'HOP cut + entry offset');
  approx(ons[1].t, 6 * TS, 'no tick advance on the HOP row');
  const ph1Marks = tl.marks.filter(m => m.phrase === 1);
  assert.equal(ph1Marks[0].phraseStep, 4, 'next phrase entered at step 4');
  assert.equal(tl.marks.filter(m => m.phrase === 0).length, 1, 'no mark for the HOP row');
  approx(tl.duration, (6 + 12 * 6) * TS, 'duration excludes the cut steps');
});

test('HOP-only phrase terminates and yields nothing (never loops)', () => {
  const pat = makePat();
  for (let s = 0; s < 16; s++) pat.phrases[0][s] = step({ fx: fx1(HOP, 0x00) });
  pat.chains[0][0] = { phrase: 0, transpose: 0 };
  pat.chains[0][1] = { phrase: 0, transpose: 0 };        // would loop on hardware
  pat.grid[0][0] = 0;
  pat.lastRow = 0;
  assert.equal(M8Player.buildTimeline(pat, makeSong(), {}), null, 'flattens to silence, returns null');
});

test('empty grid cells advance no time (channel drift)', () => {
  const pat = basicPat();
  pat.grid[2][0] = 0;                                    // rows 1 empty, 2 plays again
  pat.lastRow = 2;
  const tl = M8Player.buildTimeline(pat, makeSong(), {});
  const ons = tl.events.filter(e => e.kind === 'on');
  assert.equal(ons.length, 32);
  approx(ons[16].t, 16 * 6 * TS, 'second pass starts right after the first — no gap');
});

test('instrument carry: empty instr byte reuses the last instrument on the track', () => {
  const pat = makePat();
  pat.phrases[0][0] = step({ note: 36, instr: 0 });
  pat.phrases[0][2] = step({ note: 38 });                // instr 0xFF → carry
  pat.chains[0][0] = { phrase: 0, transpose: 0 };
  pat.grid[0][0] = 0;
  pat.lastRow = 0;
  const tl = M8Player.buildTimeline(pat, makeSong(), {});
  const ons = tl.events.filter(e => e.kind === 'on');
  assert.equal(ons.length, 2, 'carried note sounds');
  assert.equal(ons[1].sampleKey, 'samples/drums/kick.wav');
});

test('synth instruments are skipped and counted', () => {
  const pat = basicPat();
  pat.phrases[0][1].instr = 1;                           // WAVSYNTH
  const tl = M8Player.buildTimeline(pat, makeSong(), {});
  assert.equal(tl.skippedSynths, 1);
  // only step 1 is the synth (the fixture names instr 0 on every other step)
  assert.equal(tl.events.filter(e => e.kind === 'on').length, 15);
  approx(tl.duration, 16 * 6 * TS, 'the silent step still takes time');
});

test('marks carry {t,row,track,chain,chainStep,phraseStep}', () => {
  const tl = M8Player.buildTimeline(basicPat(), makeSong(), {});
  assert.equal(tl.marks.length, 16);
  tl.marks.forEach((m, n) => {
    approx(m.t, n * 6 * TS, `mark ${n} time`);
    assert.equal(m.row, 0);
    assert.equal(m.track, 0);
    assert.equal(m.chain, 0);
    assert.equal(m.chainStep, 0);
    assert.equal(m.phrase, 0);
    assert.equal(m.phraseStep, n);
  });
});

test('scope=phrase: 16 steps, channel 0, transpose 0, marks off-grid', () => {
  const pat = basicPat();
  pat.chains[0][0].transpose = 12;                       // must NOT apply in phrase scope
  pat.grid[5][3] = 0;                                    // unrelated grid content
  pat.lastRow = 5;
  const tl = M8Player.buildTimeline(pat, makeSong(), { phrase: 0 });
  const ons = tl.events.filter(e => e.kind === 'on');
  assert.equal(ons.length, 16, 'exactly the phrase, once');
  assert.ok(ons.every(e => e.chan === 0));
  approx(ons[0].rate, 1, 'phrase scope ignores chain transpose');
  approx(tl.duration, 16 * 6 * TS);
  assert.ok(tl.marks.every(m => m.row === -1), 'solo marks never point at the grid');
  // An existing-but-empty phrase still traverses: 16 silent steps of time
  const tlEmpty = M8Player.buildTimeline(pat, makeSong(), { phrase: 200 });
  assert.equal(tlEmpty.events.length, 0);
  approx(tlEmpty.duration, 16 * 6 * TS, 'empty phrase = 16 steps of silence');
  assert.equal(M8Player.buildTimeline(pat, makeSong(), { phrase: 300 }), null, 'missing phrase id → null');
});

test('scope=chain: solo channel 0, chain transposes apply', () => {
  const pat = basicPat();
  pat.chains[0][0].transpose = 12;
  pat.chains[0][1] = { phrase: 0, transpose: 0 };
  const tl = M8Player.buildTimeline(pat, makeSong(), { chain: 0 });
  const ons = tl.events.filter(e => e.kind === 'on');
  assert.equal(ons.length, 32, 'both chain steps, played once');
  approx(ons[0].rate, 2, 'step 0 transposed +12');
  approx(ons[16].rate, 1, 'step 1 untransposed');
  assert.equal(M8Player.buildTimeline(pat, makeSong(), { chain: 9 }), null, 'empty chain → null');
});

test('scope=songRow plays FROM that row to the end; out of range → null', () => {
  const pat = basicPat();
  pat.grid[0][0] = EMPTY;
  pat.grid[3][0] = 0; pat.grid[3][7] = 0;                // two tracks on row 3
  pat.grid[4][0] = 0;                                    // row 4 also plays (from-row semantics)
  pat.lastRow = 4;
  const tl = M8Player.buildTimeline(pat, makeSong(), { songRow: 3 });
  const ons = tl.events.filter(e => e.kind === 'on');
  assert.equal(ons.length, 48, 'row 3 (2 tracks) + row 4 (1 track), 16 steps each');
  assert.deepEqual([...new Set(ons.map(e => e.chan))].sort(), [0, 7]);
  assert.deepEqual([...new Set(tl.marks.map(m => m.row))].sort(), [3, 4], 'plays to the end');
  assert.ok(!tl.marks.some(m => m.row < 3), 'nothing before the start row');
  assert.equal(M8Player.buildTimeline(pat, makeSong(), { songRow: 9 }), null, 'past lastRow → null');
});

test('sampler loop modes reach the events as fractions', () => {
  const pat = basicPat();
  const song = makeSong();
  const smp = song.instruments.find(i => i.typeName === 'SAMPLER');
  smp.sampParams = { play: 4, start: 0, loopStart: 64, length: 255 };  // FWD PP
  const tl = M8Player.buildTimeline(pat, song, {});
  const on = tl.events.find(e => e.kind === 'on');
  assert.ok(on.loopFrac, 'loop fraction present');
  assert.equal(on.loopFrac.pp, true, 'pingpong flagged');
  assert.ok(Math.abs(on.loopFrac.start - 64/255) < 1e-6);
  smp.sampParams = { play: 0, start: 0, loopStart: 0, length: 255 };   // FWD one-shot
  const tl2 = M8Player.buildTimeline(pat, song, {});
  assert.equal(tl2.events.find(e => e.kind === 'on').loopFrac, null, 'one-shot has no loop');
});

test('tempo fallback and empty song', () => {
  const tl = M8Player.buildTimeline(basicPat(), makeSong({ tempo: 0 }), {});
  assert.equal(tl.bpm, 120, 'tempo 0 falls back to 120');
  assert.equal(M8Player.buildTimeline(makePat(), makeSong(), {}), null, 'empty grid → null');
  assert.equal(M8Player.buildTimeline(null, makeSong(), {}), null, 'null pat → null');
});

// ── buildBuffers ───────────────────────────────────────────
test('buildBuffers: normalized keys, failures swallowed', async () => {
  const loaded = [];
  const buffers = await M8Player.buildBuffers(makeSong(),
    async p => { loaded.push(p); return p.includes('Kick') ? new ArrayBuffer(4) : null; },
    async () => ({ duration: 1 }));
  assert.equal(loaded.length, 2, 'only sampler paths with a sample are loaded');
  assert.equal(buffers.size, 1, 'failed load skipped silently');
  assert.ok(buffers.has('samples/drums/kick.wav'), 'key is normPath-normalized');
  assert.equal(M8Player.sampleKey('\\Samples\\Drums\\Snare.WAV'), 'samples/drums/snare.wav');
  // decoder throwing is also swallowed
  const b2 = await M8Player.buildBuffers(makeSong(),
    async () => new ArrayBuffer(4), async () => { throw new Error('bad wav'); });
  assert.equal(b2.size, 0);
});

// ── wavEncode ──────────────────────────────────────────────
test('wavEncode: canonical 44-byte 16-bit PCM header', () => {
  const len = 100, rate = 44100, chans = 2;
  const data = new Float32Array(len).fill(0.5);
  const buf = { numberOfChannels: chans, length: len, sampleRate: rate, getChannelData: () => data };
  const wav = SongPlayer.wavEncode(buf);
  assert.equal(wav.length, 44 + len * chans * 2);
  const dv = new DataView(wav.buffer);
  const tag = o => String.fromCharCode(wav[o], wav[o + 1], wav[o + 2], wav[o + 3]);
  assert.equal(tag(0), 'RIFF');
  assert.equal(dv.getUint32(4, true), wav.length - 8);
  assert.equal(tag(8), 'WAVE');
  assert.equal(tag(12), 'fmt ');
  assert.equal(dv.getUint32(16, true), 16, 'fmt chunk size');
  assert.equal(dv.getUint16(20, true), 1, 'PCM');
  assert.equal(dv.getUint16(22, true), chans);
  assert.equal(dv.getUint32(24, true), rate);
  assert.equal(dv.getUint32(28, true), rate * chans * 2, 'byte rate');
  assert.equal(dv.getUint16(32, true), chans * 2, 'block align');
  assert.equal(dv.getUint16(34, true), 16, 'bits per sample');
  assert.equal(tag(36), 'data');
  assert.equal(dv.getUint32(40, true), len * chans * 2);
  assert.equal(dv.getInt16(44, true), Math.trunc(0.5 * 0x7FFF), 'sample scaling');
});

// ── Offline render smoke (skipped where Node lacks Web Audio) ──
test('renderOffline smoke', async t => {
  if (typeof globalThis.OfflineAudioContext === 'undefined') {
    t.skip('no OfflineAudioContext in this runtime');
    return;
  }
  const tl = M8Player.buildTimeline(basicPat(), makeSong(), {});
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const sample = ctx.createBuffer(1, 4410, 44100);
  sample.getChannelData(0).fill(0.25);
  const buffers = new Map([['samples/drums/kick.wav', sample]]);
  const mix = await SongPlayer.renderOffline(tl, buffers);
  assert.equal(mix.numberOfChannels, 2);
  assert.ok(mix.getChannelData(0).some(v => v !== 0), 'render is not silent');
  const stems = await SongPlayer.renderOffline(tl, buffers, { stems: true });
  assert.equal(stems.length, 1);
  assert.equal(stems[0].chan, 0);
});

test('scope=songRow is a SECTION: stops at the next blank row; blank row declines', () => {
  const pat = basicPat();
  pat.grid[0][0] = EMPTY;
  pat.grid[3][0] = 0;                                    // section A: rows 3-4
  pat.grid[4][0] = 0;
  for (let t = 0; t < 8; t++) pat.grid[5][t] = EMPTY;    // blank separator
  pat.grid[6][0] = 0;                                    // section B
  pat.lastRow = 6;
  const tl = M8Player.buildTimeline(pat, makeSong(), { songRow: 3 });
  assert.deepEqual([...new Set(tl.marks.map(m => m.row))].sort(), [3, 4],
    'section ends at the blank row — row 6 is the next section');
  const tlB = M8Player.buildTimeline(pat, makeSong(), { songRow: 6 });
  assert.deepEqual([...new Set(tlB.marks.map(m => m.row))], [6]);
  assert.equal(M8Player.buildTimeline(pat, makeSong(), { songRow: 5 }), null,
    'a blank row declines');
});

// ── Regressions from the deep review ───────────────────────
test("song-level transpose applies to playback (was parsed but ignored)", () => {
  const pat = basicPat();
  const base = M8Player.buildTimeline(pat, makeSong(), {});
  const up = M8Player.buildTimeline(pat, makeSong({ transpose: 12 }), {});
  const dn = M8Player.buildTimeline(pat, makeSong({ transpose: -12 }), {});
  const rate = tl => tl.events.find(e => e.kind === 'on').rate;
  approx(rate(base), 1, 'no transpose');
  approx(rate(up), 2, '+12 semitones doubles the rate');
  approx(rate(dn), 0.5, '-12 semitones halves the rate');
});

test("song transpose stacks with the chain-step transpose", () => {
  const pat = basicPat();
  pat.chains[0][0] = { phrase: 0, transpose: 12 };       // +12 on the chain step
  const tl = M8Player.buildTimeline(pat, makeSong({ transpose: -12 }), {});
  approx(tl.events.find(e => e.kind === 'on').rate, 1, '+12 and -12 cancel');
});

test("instrument mixer pan reaches the timeline (was hardcoded centre)", () => {
  const pat = basicPat();
  const panned = over => makeSong({ instruments: [
    { slot: 0, kind: 2, typeName: 'SAMPLER', name: 'KICK', samplePath: '/Samples/Drums/Kick.wav', ...over },
  ]});
  const panOf = song => M8Player.buildTimeline(pat, song, {}).events.find(e => e.kind === 'on').pan;
  approx(panOf(panned({ pan: 0x7F })), 0, '0x7F is centre');
  approx(panOf(panned({ pan: 0x00 })), -1, '0x00 is hard left');
  assert.ok(Math.abs(panOf(panned({ pan: 0xFF })) - 1) < 0.02, '0xFF is hard right');
  approx(panOf(panned({})), 0, 'no pan byte falls back to centre');
  const p = panOf(panned({ pan: 0xFF }));
  assert.ok(p >= -1 && p <= 1, 'pan stays inside the StereoPanner range');
});
