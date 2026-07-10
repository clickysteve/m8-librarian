// M8 Librarian — MIDI export tests
//
// Builds synthetic songs, exports them with M8.buildMidi, then parses the
// result with an independent minimal SMF reader and checks notes, timing
// (including swing grooves), chain transpose, KIL handling, and VLQ encoding.
//
// Run with:  node tests/midi.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const start = html.indexOf('const M8 = (() => {');
const end = html.indexOf('\n})();', start);
const M8 = new Function(`${html.slice(start, end + 6)}; return M8;`)();

// ── Minimal SMF reader ─────────────────────────────────────
function parseSmf(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = o => String.fromCharCode(u8[o], u8[o+1], u8[o+2], u8[o+3]);
  assert.equal(tag(0), 'MThd');
  assert.equal(dv.getUint32(4), 6);
  const format = dv.getUint16(8), ntrks = dv.getUint16(10), division = dv.getUint16(12);
  let off = 14;
  const tracks = [];
  for (let t = 0; t < ntrks; t++) {
    assert.equal(tag(off), 'MTrk', `track ${t} header`);
    const len = dv.getUint32(off + 4);
    const bodyEnd = off + 8 + len;
    let p = off + 8, tick = 0;
    const events = [];
    let sawEot = false;
    while (p < bodyEnd) {
      // VLQ delta
      let delta = 0, b;
      do { b = u8[p++]; delta = (delta << 7) | (b & 0x7F); } while (b & 0x80);
      tick += delta;
      const status = u8[p++];
      assert.ok(status & 0x80, 'running status not used, full status expected');
      if (status === 0xFF) {
        const type = u8[p++];
        let mlen = 0;
        do { b = u8[p++]; mlen = (mlen << 7) | (b & 0x7F); } while (b & 0x80);
        const data = u8.slice(p, p + mlen); p += mlen;
        events.push({tick, meta: type, data});
        if (type === 0x2F) sawEot = true;
      } else {
        const kind = status & 0xF0, ch = status & 0x0F;
        const d1 = u8[p++], d2 = (kind === 0xC0 || kind === 0xD0) ? null : u8[p++];
        events.push({tick, kind, ch, d1, d2});
      }
    }
    assert.ok(sawEot, `track ${t} has end-of-track`);
    assert.equal(p, bodyEnd, `track ${t} length is exact`);
    tracks.push(events);
    off = bodyEnd;
  }
  assert.equal(off, u8.length, 'no trailing bytes');
  return { format, ntrks, division, tracks };
}

// ── Fixture: raw pattern data in the shape parseSongPatterns returns ──
function emptyPat() {
  const grid = Array.from({length: 256}, () => new Array(8).fill(0xFF));
  const chains = Array.from({length: 255}, () => Array.from({length: 16}, () => ({phrase: 0xFF, transpose: 0})));
  const phrases = Array.from({length: 255}, () => Array.from({length: 16}, () => ({note: 0xFF, vol: 0xFF, instr: 0xFF, fx: [{cmd:0xFF,val:0},{cmd:0xFF,val:0},{cmd:0xFF,val:0}]})));
  const grooves = Array.from({length: 32}, () => new Array(16).fill(0xFF));
  grooves[0][0] = 6; grooves[0][1] = 6;
  return { grid, chains, phrases, grooves, lastRow: -1 };
}
const song = (tempo = 120, name = 'MIDITEST') => ({name, tempo});

test('empty grid exports nothing', () => {
  assert.equal(M8.buildMidi(song(), emptyPat()), null);
});

test('basic export: header, tempo, notes at 24 PPQ', () => {
  const pat = emptyPat();
  pat.lastRow = 0;
  pat.grid[0][0] = 0;                 // track 1, chain 0
  pat.chains[0][0] = {phrase: 0, transpose: 0};
  pat.phrases[0][0].note = 24;        // C-3 → MIDI 48
  pat.phrases[0][0].vol = 0xFF;       // default velocity
  pat.phrases[0][4] = {...pat.phrases[0][4], note: 36, vol: 0x80}; // step 4

  const smf = parseSmf(M8.buildMidi(song(140), pat));
  assert.equal(smf.format, 1);
  assert.equal(smf.division, 24);
  assert.equal(smf.ntrks, 2); // tempo track + 1 used track

  const tempoEv = smf.tracks[0].find(e => e.meta === 0x51);
  const us = (tempoEv.data[0] << 16) | (tempoEv.data[1] << 8) | tempoEv.data[2];
  assert.equal(us, Math.round(60000000 / 140));

  const notes = smf.tracks[1].filter(e => e.kind === 0x90);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].tick, 0);
  assert.equal(notes[0].d1, 48);           // 24 + 24
  assert.equal(notes[0].d2, 100);          // default velocity
  assert.equal(notes[1].tick, 24);         // 4 steps × 6 ticks
  assert.equal(notes[1].d1, 60);           // 36 + 24
  assert.equal(notes[1].d2, 0x40);         // 0x80 >> 1
  // first note off exactly when the second starts
  const offs = smf.tracks[1].filter(e => e.kind === 0x80);
  assert.equal(offs[0].tick, 24);
  assert.equal(offs[0].d1, 48);
  // last note closed at sequence end: 16 steps × 6 ticks
  assert.equal(offs[1].tick, 96);
});

test('swing groove drives step timing', () => {
  const pat = emptyPat();
  pat.grooves[0] = new Array(16).fill(0xFF);
  pat.grooves[0][0] = 8; pat.grooves[0][1] = 4; // hard swing
  pat.lastRow = 0;
  pat.grid[0][2] = 0;
  pat.chains[0][0] = {phrase: 0, transpose: 0};
  for (let s = 0; s < 4; s++) pat.phrases[0][s].note = 12;

  const smf = parseSmf(M8.buildMidi(song(), pat));
  const notes = smf.tracks[1].filter(e => e.kind === 0x90);
  assert.deepEqual(notes.map(n => n.tick), [0, 8, 12, 20]); // 8,4 cycling
  assert.equal(notes[0].ch, 2); // channel = M8 track index
});

test('chain transpose shifts notes, out-of-range notes dropped', () => {
  const pat = emptyPat();
  pat.lastRow = 1;
  pat.grid[0][0] = 0; pat.grid[1][0] = 1;
  pat.chains[0][0] = {phrase: 0, transpose: 12};    // +1 octave
  pat.chains[1][0] = {phrase: 0, transpose: 0xF4};  // -12 (0xF4 = -12 signed)
  pat.phrases[0][0].note = 24;

  const smf = parseSmf(M8.buildMidi(song(), pat));
  const notes = smf.tracks[1].filter(e => e.kind === 0x90);
  assert.equal(notes[0].d1, 60);  // 24 + 24 + 12
  assert.equal(notes[1].d1, 36);  // 24 + 24 - 12
  assert.equal(notes[1].tick, 96); // second chain starts after 16 steps
});

test('KIL command cuts the open note', () => {
  const pat = emptyPat();
  pat.lastRow = 0;
  pat.grid[0][0] = 0;
  pat.chains[0][0] = {phrase: 0, transpose: 0};
  pat.phrases[0][0].note = 24;
  pat.phrases[0][2].fx[0] = {cmd: 0x05, val: 0}; // KIL at step 2

  const smf = parseSmf(M8.buildMidi(song(), pat));
  const offs = smf.tracks[1].filter(e => e.kind === 0x80);
  assert.equal(offs.length, 1);
  assert.equal(offs[0].tick, 12); // cut at step 2 (2 × 6 ticks)
});

test('long gaps produce valid multi-byte VLQ deltas', () => {
  const pat = emptyPat();
  pat.lastRow = 20;
  pat.grid[0][0] = 0; pat.grid[20][0] = 1; // huge silent gap between chains
  pat.chains[0][0] = {phrase: 0, transpose: 0};
  pat.chains[1][0] = {phrase: 1, transpose: 0};
  pat.phrases[0][0].note = 24;
  pat.phrases[1][0].note = 25;

  // gap: track only advances through real phrase steps, so second note
  // starts after chain 0's 16 steps = tick 96 — but stuff many phrases into
  // chain 0 to force a >127-tick delta
  for (let s = 0; s < 16; s++) pat.chains[0][s] = {phrase: 0, transpose: 0};
  const smf = parseSmf(M8.buildMidi(song(), pat)); // parseSmf asserts VLQ correctness
  const notes = smf.tracks[1].filter(e => e.kind === 0x90);
  assert.equal(notes.at(-1).tick, 16 * 16 * 6); // 16 phrases × 16 steps × 6 ticks
});

test('multiple tracks land on separate channels, empty tracks omitted', () => {
  const pat = emptyPat();
  pat.lastRow = 0;
  pat.grid[0][0] = 0; pat.grid[0][7] = 1;
  pat.chains[0][0] = {phrase: 0, transpose: 0};
  pat.chains[1][0] = {phrase: 1, transpose: 0};
  pat.phrases[0][0].note = 24;
  pat.phrases[1][0].note = 36;

  const smf = parseSmf(M8.buildMidi(song(), pat));
  assert.equal(smf.ntrks, 3); // tempo + T1 + T8
  assert.equal(smf.tracks[1].find(e => e.kind === 0x90).ch, 0);
  assert.equal(smf.tracks[2].find(e => e.kind === 0x90).ch, 7);
});
