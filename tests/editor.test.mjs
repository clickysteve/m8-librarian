// M8 Librarian — editing-suite encoder tests
//
// Zero-dependency: extracts the M8 parser module from ../index.html and
// loads the M8Edit encoder module from ./b-m8edit.js, then round-trips
// every encoder through a synthetic full-size song buffer: encode →
// applyRegions → M8.parseSongPatterns → assert the parse sees the edit.
//
// Run with:  node port/b-tests.mjs
//      (or:  node --test port/b-tests.mjs  for TAP summary output)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// ── Extract the M8 module from index.html ──────────────────
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const start = html.indexOf('const M8 = (() => {');
assert.ok(start > 0, 'M8 module not found in index.html');
const end = html.indexOf('\n})();', start);
assert.ok(end > start, 'M8 module end not found');
const M8 = new Function(`${html.slice(start, end + '\n})();'.length)}; return M8;`)();

// ── Load the M8Edit module from b-m8edit.js ────────────────
const editStart = html.indexOf('const M8Edit = (() => {');
const editEnd = html.indexOf('\n})();', editStart);
const editSrc = html.slice(editStart, editEnd + 6);
const M8Edit = new Function(`${editSrc}; return M8Edit;`)();
const O = M8Edit.OFFSETS;

// ── Fixture builder (same layout as tests/parser.test.mjs) ─
const SONG_SIZE = 0x1AD09;
function writeStr(b, off, s) { for (let i = 0; i < s.length; i++) b[off + i] = s.charCodeAt(i); }
function makeSong() {
  const b = new Uint8Array(SONG_SIZE);
  writeStr(b, 0, 'M8VERSION');
  const vr = (4 << 8) | (0 << 4) | 2;
  b[10] = vr & 0xFF; b[11] = (vr >> 8) & 0xFF;
  b[13] = 0x00;
  writeStr(b, 148, 'EDITTEST');
  b.fill(0xFF, O.GRID_OFF, O.GRID_OFF + 256 * 8);
  b.fill(0xFF, O.CHAIN_OFF, O.CHAIN_OFF + 255 * 32);
  b.fill(0xFF, O.PHRASE_OFF, O.PHRASE_OFF + 255 * 16 * 9);
  b.fill(0xFF, O.INSTR_TABLE, O.INSTR_TABLE + 128 * O.ISIZE);
  return b;
}

// ── Region layout invariants ───────────────────────────────
test('region offsets tile the file with no gaps', () => {
  assert.equal(O.GROOVE_OFF + 32 * 16, O.GRID_OFF);          // grooves end at grid
  assert.equal(O.GRID_OFF + 256 * 8, O.PHRASE_OFF);          // grid ends at phrases
  assert.equal(O.PHRASE_OFF + 255 * 16 * 9, O.CHAIN_OFF);    // phrases end at chains
  assert.equal(O.CHAIN_OFF + 255 * 32, O.TABLE_OFF);         // chains end at tables
  assert.equal(O.TABLE_OFF + 256 * 128, O.INSTR_TABLE);      // tables end at instruments
});

// ── Grid ───────────────────────────────────────────────────
test('encodeGridCell round-trips through parseSongPatterns', () => {
  const b = makeSong();
  M8Edit.applyRegions(b, [
    M8Edit.encodeGridCell(0, 0, 0x00),
    M8Edit.encodeGridCell(4, 2, 0x1A),
    M8Edit.encodeGridCell(255, 7, 0xFE),
  ]);
  const pat = M8.parseSongPatterns(b);
  assert.equal(pat.grid[0][0], 0x00);
  assert.equal(pat.grid[4][2], 0x1A);
  assert.equal(pat.grid[255][7], 0xFE);
  assert.equal(pat.grid[4][3], 0xFF); // neighbour untouched
  assert.equal(pat.lastRow, 255);
});

test('encodeGridCell null clears to 0xFF and bad indices throw', () => {
  const b = makeSong();
  b[O.GRID_OFF + 3 * 8 + 5] = 0x22;
  M8Edit.applyRegions(b, [M8Edit.encodeGridCell(3, 5, null)]);
  assert.equal(M8.parseSongPatterns(b).grid[3][5], 0xFF);
  assert.throws(() => M8Edit.encodeGridCell(256, 0, 0), RangeError);
  assert.throws(() => M8Edit.encodeGridCell(0, 8, 0), RangeError);
  assert.equal(M8Edit.encodeGridCell(0, 0, 0xFF).bytes[0], 0xFF); // 0xFF = explicit empty
});

// ── Chains ─────────────────────────────────────────────────
test('encodeChainStep writes phrase + signed transpose', () => {
  const b = makeSong();
  M8Edit.applyRegions(b, [
    M8Edit.encodeChainStep(3, 2, { phrase: 0x10, transpose: -3 }),
    M8Edit.encodeChainStep(3, 3, { phrase: 0x11, transpose: 12 }),
  ]);
  const pat = M8.parseSongPatterns(b);
  assert.equal(pat.chains[3][2].phrase, 0x10);
  assert.equal(pat.chains[3][2].transpose, 0xFD);  // -3 as raw byte
  assert.equal(pat.chains[3][3].phrase, 0x11);
  assert.equal(pat.chains[3][3].transpose, 12);
  assert.equal(pat.chains[3][1].phrase, 0xFF);     // neighbour untouched
});

test('encodeChain writes all 16 steps as one region', () => {
  const b = makeSong();
  const steps = Array.from({ length: 16 }, (_, s) =>
    s % 2 === 0 ? { phrase: s, transpose: -s } : { phrase: 0xFF, transpose: 0 });
  const reg = M8Edit.encodeChain(0x40, steps);
  assert.equal(reg.offset, O.CHAIN_OFF + 0x40 * 32);
  assert.equal(reg.bytes.length, 32);
  M8Edit.applyRegions(b, [reg]);
  const pat = M8.parseSongPatterns(b);
  assert.equal(pat.chains[0x40][4].phrase, 4);
  assert.equal(pat.chains[0x40][4].transpose, (-4) & 0xFF);
  assert.equal(pat.chains[0x40][5].phrase, 0xFF);
  assert.throws(() => M8Edit.encodeChain(255, steps), RangeError);
});

// ── Phrases ────────────────────────────────────────────────
test('encodePhraseStep round-trips a full step object', () => {
  const b = makeSong();
  const stepObj = { note: 24, vol: 0x40, instr: 0x02,
    fx: [{ cmd: 0x04, val: 0x10 }, { cmd: 0x12, val: 0x01 }, { cmd: 0xFF, val: 0 }] };
  const reg = M8Edit.encodePhraseStep(7, 5, stepObj);
  assert.equal(reg.offset, O.PHRASE_OFF + 7 * 144 + 5 * 9);
  assert.equal(reg.bytes.length, 9);
  M8Edit.applyRegions(b, [reg]);
  const st = M8.parseSongPatterns(b).phrases[7][5];
  assert.deepEqual(st, stepObj);
  assert.equal(M8.noteStr(st.note), 'C-3');
  assert.equal(M8.fxStr(st.fx[0].cmd, st.fx[0].val), 'HOP 10');
});

test('encodePhraseStep defaults omitted fields to empty', () => {
  const b = makeSong();
  b.fill(0x33, O.PHRASE_OFF, O.PHRASE_OFF + 9); // dirty target bytes first
  M8Edit.applyRegions(b, [M8Edit.encodePhraseStep(0, 0, {})]);
  const st = M8.parseSongPatterns(b).phrases[0][0];
  assert.deepEqual(st, { note: 0xFF, vol: 0xFF, instr: 0xFF,
    fx: [{ cmd: 0xFF, val: 0 }, { cmd: 0xFF, val: 0 }, { cmd: 0xFF, val: 0 }] });
  assert.throws(() => M8Edit.encodePhraseStep(0, 0, { note: 0x80 }), RangeError);
});

test('encodePhrase writes all 16 steps as one region', () => {
  const b = makeSong();
  const steps = Array.from({ length: 16 }, (_, s) => ({
    note: s % 4 === 0 ? 36 + s : 0xFF, vol: 0xFF, instr: s % 4 === 0 ? 0 : 0xFF,
    fx: [{ cmd: 0xFF, val: 0 }, { cmd: 0xFF, val: 0 }, { cmd: 0xFF, val: 0 }] }));
  const reg = M8Edit.encodePhrase(0xFE, steps);
  assert.equal(reg.bytes.length, 144);
  M8Edit.applyRegions(b, [reg]);
  const ph = M8.parseSongPatterns(b).phrases[0xFE];
  assert.deepEqual(ph, steps);
});

// ── Grooves ────────────────────────────────────────────────
test('encodeGroove round-trips and enforces 1..0x80', () => {
  const b = makeSong();
  M8Edit.applyRegions(b, [M8Edit.encodeGroove(2, [8, 4, 8, 4, 0xFF])]);
  const g = M8.parseSongPatterns(b).grooves[2];
  assert.deepEqual(g.slice(0, 5), [8, 4, 8, 4, 0xFF]);
  assert.equal(g[15], 0xFF); // unspecified tail is end-marked
  assert.throws(() => M8Edit.encodeGroove(2, [0]), RangeError);    // 0 would stall the player
  assert.throws(() => M8Edit.encodeGroove(2, [0x81]), RangeError); // >0x80 is unset
  assert.throws(() => M8Edit.encodeGroove(32, [6]), RangeError);
});

// ── Tables ─────────────────────────────────────────────────
test('encodeTableStep addresses the table region correctly', () => {
  const reg = M8Edit.encodeTableStep(3, 2, { transpose: -2, vol: 0x30,
    fx: [{ cmd: 0x04, val: 0x20 }, { cmd: 0xFF, val: 0 }, { cmd: 0xFF, val: 0 }] });
  assert.equal(reg.offset, 0xBA3E + 3 * 128 + 2 * 8);
  assert.deepEqual([...reg.bytes], [0xFE, 0x30, 0x04, 0x20, 0xFF, 0x00, 0xFF, 0x00]);
  const b = makeSong();
  M8Edit.applyRegions(b, [reg]);
  assert.equal(b[reg.offset], 0xFE);
  assert.equal(b[reg.offset + 3], 0x20);
  assert.throws(() => M8Edit.encodeTableStep(256, 0, {}), RangeError);
});

// ── Instrument param byte ──────────────────────────────────
test('encodeInstrParamByte addresses the slot and writes one byte', () => {
  const reg = M8Edit.encodeInstrParamByte(2, 15, 0x60); // slot 2 volume byte
  assert.equal(reg.offset, 80446 + 2 * 215 + 15);
  assert.deepEqual([...reg.bytes], [0x60]);
  const b = makeSong();
  // Give slot 2 a kind + name so parseSong sees it, then patch its volume
  b.fill(0x00, O.INSTR_TABLE + 2 * O.ISIZE, O.INSTR_TABLE + 3 * O.ISIZE);
  b[O.INSTR_TABLE + 2 * O.ISIZE] = 0x00;
  writeStr(b, O.INSTR_TABLE + 2 * O.ISIZE + 1, 'LEAD');
  M8Edit.applyRegions(b, [reg]);
  assert.equal(b[80446 + 2 * 215 + 15], 0x60);
  assert.equal(M8.parseSong(b).instruments[0].name, 'LEAD'); // slot still parses
  assert.throws(() => M8Edit.encodeInstrParamByte(128, 0, 0), RangeError);
  assert.throws(() => M8Edit.encodeInstrParamByte(0, 215, 0), RangeError);
});

// ── applyRegions safety ────────────────────────────────────
test('applyRegions rejects out-of-bounds without touching the buffer', () => {
  const b = new Uint8Array(100).fill(0xAA);
  const good = { offset: 10, bytes: Uint8Array.of(1, 2, 3) };
  const bad = { offset: 99, bytes: Uint8Array.of(1, 2, 3) };
  assert.throws(() => M8Edit.applyRegions(b, [good, bad]), RangeError);
  assert.ok(b.every(v => v === 0xAA), 'whole-batch bounds check ran before any write');
  assert.throws(() => M8Edit.applyRegions(b, [{ offset: 0 }]), /malformed/);
});

test('applyRegions on a truncated song file throws instead of writing short', () => {
  const short = makeSong().slice(0, 0x9000); // ends inside the phrase block
  assert.throws(() => M8Edit.applyRegions(short, [M8Edit.encodeChainStep(0, 0, { phrase: 1 })]), RangeError);
});

// ── verifyRegions ──────────────────────────────────────────
test('verifyRegions passes after apply and pinpoints corruption', () => {
  const b = makeSong();
  const regions = [
    M8Edit.encodeGridCell(1, 1, 0x05),
    M8Edit.encodePhraseStep(5, 0, { note: 24, vol: 0x40, instr: 0,
      fx: [{ cmd: 0x04, val: 0x10 }, { cmd: 0xFF, val: 0 }, { cmd: 0xFF, val: 0 }] }),
    M8Edit.encodeGroove(0, [6, 6]),
  ];
  M8Edit.applyRegions(b, regions);
  assert.deepEqual(M8Edit.verifyRegions(b, regions), []);
  // Corrupt one byte inside the phrase step (the vol byte) — as if the
  // write to the card went bad
  const phOff = O.PHRASE_OFF + 5 * 144 + 1;
  b[phOff] = 0x41;
  const bad = M8Edit.verifyRegions(b, regions);
  assert.equal(bad.length, 1);
  assert.deepEqual(bad[0], { offset: phOff, expected: 0x40, actual: 0x41 });
  // A region past the end of a truncated read is reported, not thrown
  const short = b.slice(0, 0x500);
  assert.ok(M8Edit.verifyRegions(short, [M8Edit.encodeChainStep(0, 0, {})]).length > 0);
});

// ── Full batched edit, end to end ──────────────────────────
test('a batched edit (grid+chain+phrase+groove) round-trips together', () => {
  const b = makeSong();
  const phrase = Array.from({ length: 16 }, (_, s) => ({
    note: s === 0 ? 36 : 0xFF, vol: s === 0 ? 0x50 : 0xFF, instr: s === 0 ? 1 : 0xFF,
    fx: [{ cmd: 0xFF, val: 0 }, { cmd: 0xFF, val: 0 }, { cmd: 0xFF, val: 0 }] }));
  const chain = Array.from({ length: 16 }, (_, s) =>
    ({ phrase: s === 0 ? 0x0A : 0xFF, transpose: s === 0 ? 7 : 0 }));
  const regions = [
    M8Edit.encodeGridCell(0, 3, 0x21),
    M8Edit.encodeChain(0x21, chain),
    M8Edit.encodePhrase(0x0A, phrase),
    M8Edit.encodeGroove(0, [6, 6]),
  ];
  M8Edit.applyRegions(b, regions);
  assert.deepEqual(M8Edit.verifyRegions(b, regions), []);
  const pat = M8.parseSongPatterns(b);
  assert.equal(pat.grid[0][3], 0x21);
  assert.equal(pat.chains[0x21][0].phrase, 0x0A);
  assert.equal(pat.chains[0x21][0].transpose, 7);
  assert.deepEqual(pat.phrases[0x0A], phrase);
  assert.deepEqual(pat.grooves[0].slice(0, 2), [6, 6]);
  assert.equal(M8.parseSong(b).name, 'EDITTEST'); // rest of the file untouched
});

// ── Tables (port round) ────────────────────────────────────
test('encodeTable writes a whole 128-byte table region that round-trips', () => {
  const steps = [];
  for (let s = 0; s < 16; s++) steps.push({ transpose: 0, vol: 0xFF,
    fx: [{cmd:0xFF,val:0},{cmd:0xFF,val:0},{cmd:0xFF,val:0}] });
  steps[2] = { transpose: 0x0C, vol: 0x40, fx: [{cmd:0x03,val:0x02},{cmd:0xFF,val:0},{cmd:0x81,val:0x7F}] };
  const r = M8Edit.encodeTable(5, steps);
  assert.equal(r.offset, 0xBA3E + 5 * 128);
  assert.equal(r.bytes.length, 128);
  // step 2 bytes: tsp vol c v c v c v
  assert.deepEqual([...r.bytes.slice(16, 24)], [0x0C, 0x40, 0x03, 0x02, 0xFF, 0x00, 0x81, 0x7F]);
  // untouched step stays the empty pattern
  assert.deepEqual([...r.bytes.slice(0, 8)], [0x00, 0xFF, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00]);
});
