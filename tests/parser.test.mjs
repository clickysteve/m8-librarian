// M8 Librarian — parser test suite
//
// Zero-dependency: extracts the M8 binary-parser module directly from
// ../index.html and runs it against synthetic fixture files, so offset
// changes that would corrupt parsing fail here before they ship.
//
// Run with:  node tests/parser.test.mjs
//      (or:  node --test tests/parser.test.mjs  for TAP summary output)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── Extract the M8 module from index.html ──────────────────
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const start = html.indexOf('const M8 = (() => {');
assert.ok(start > 0, 'M8 module not found in index.html');
const end = html.indexOf('\n})();', start);
assert.ok(end > start, 'M8 module end not found');
const src = html.slice(start, end + '\n})();'.length);
const M8 = new Function(`${src}; return M8;`)();

// ── Fixture builders ───────────────────────────────────────
const INSTR_TABLE = 80446, ISIZE = 215, SAMP_OFF = 0x57;
const GRID_OFF = 0x2EE, PHRASE_OFF = 0xAEE, CHAIN_OFF = 0x9A5E;
const SONG_SIZE = 0x1AD09; // full 4.x song file size

function writeStr(b, off, s) { for (let i = 0; i < s.length; i++) b[off + i] = s.charCodeAt(i); }

function header(b, versionTriple, fileType) {
  writeStr(b, 0, 'M8VERSION');
  const [maj, min, pat] = versionTriple;
  const vr = (maj << 8) | (min << 4) | pat;
  b[10] = vr & 0xFF; b[11] = (vr >> 8) & 0xFF;
  b[13] = fileType;
}

function makeSong({version = [4, 0, 2]} = {}) {
  const b = new Uint8Array(SONG_SIZE); // zero-filled
  header(b, version, 0x00);
  writeStr(b, 148, 'TESTSONG');
  // Settings: tempo f32 LE @0x8F, transpose i8 @0x8E, quantize @0x93
  new DataView(b.buffer).setFloat32(0x8F, 128.5, true);
  new DataView(b.buffer).setInt8(0x8E, -2);
  b[0x93] = 1;
  // Grid all empty, then place chain 00 at row0/track0 and chain 01 at row1/track1
  b.fill(0xFF, GRID_OFF, GRID_OFF + 256 * 8);
  b[GRID_OFF + 0 * 8 + 0] = 0x00;
  b[GRID_OFF + 1 * 8 + 1] = 0x01;
  // Chains all empty, then: chain0 step0 → phrase 05 transpose 0; chain1 step0 → phrase 06 transpose -2 (0xFE)
  b.fill(0xFF, CHAIN_OFF, CHAIN_OFF + 255 * 32);
  b[CHAIN_OFF + 0] = 0x05; b[CHAIN_OFF + 1] = 0x00;
  b[CHAIN_OFF + 32] = 0x06; b[CHAIN_OFF + 33] = 0xFE;
  // Phrases all empty, then phrase 5 step 0: note C-3 (24), vol 0x40, instr 0, fx1 HOP 0x10
  b.fill(0xFF, PHRASE_OFF, PHRASE_OFF + 255 * 16 * 9);
  const p5 = PHRASE_OFF + 5 * 16 * 9;
  b[p5] = 24; b[p5 + 1] = 0x40; b[p5 + 2] = 0x00;
  b[p5 + 3] = 0x04; b[p5 + 4] = 0x10; // HOP 10
  // Instruments: all slots empty (kind 0xFF)...
  b.fill(0xFF, INSTR_TABLE, INSTR_TABLE + 128 * ISIZE);
  // ...slot 0: SAMPLER "KICK" with a sample path
  const i0 = INSTR_TABLE;
  b.fill(0x00, i0, i0 + ISIZE);
  b[i0] = 0x02; writeStr(b, i0 + 1, 'KICK');
  writeStr(b, i0 + SAMP_OFF, '/Samples/Drums/kick.wav');
  // ...slot 1: WAVSYNTH "LEAD", no sample
  const i1 = INSTR_TABLE + ISIZE;
  b.fill(0x00, i1, i1 + ISIZE);
  b[i1] = 0x00; writeStr(b, i1 + 1, 'LEAD');
  // ...slot 2: another SAMPLER sharing the same sample path (dedupe check)
  const i2 = INSTR_TABLE + 2 * ISIZE;
  b.fill(0x00, i2, i2 + ISIZE);
  b[i2] = 0x02; writeStr(b, i2 + 1, 'KICK2');
  writeStr(b, i2 + SAMP_OFF, '/Samples/Drums/kick.wav');
  return b;
}

function makeInstrFile() {
  const b = new Uint8Array(14 + ISIZE + 300);
  header(b, [3, 1, 0], 0x10);
  b.fill(0x00, 14, b.length);
  b[14] = 0x02; writeStr(b, 15, 'SNARE');
  writeStr(b, 14 + SAMP_OFF, 'Samples/snare.wav');
  return b;
}

function makeTheme() {
  const b = new Uint8Array(14 + 13 * 3);
  header(b, [2, 7, 0], 0x20);
  // background = (16,16,16), text = (255,128,0)
  b[14] = 16; b[15] = 16; b[16] = 16;
  b[17] = 255; b[18] = 128; b[19] = 0;
  return b;
}

function makeGroove() {
  const b = new Uint8Array(14 + 16);
  header(b, [4, 1, 0], 0x30);
  b.fill(6, 14, 30);
  b[14] = 8; b[15] = 4; // swung first pair
  return b;
}

// ── Header / version ───────────────────────────────────────
test('parseSong reads header version', () => {
  const s = M8.parseSong(makeSong({version: [4, 0, 2]}));
  assert.ok(s, 'song parsed');
  assert.deepEqual(s.header.version, {major: 4, minor: 0, patch: 2});
  assert.equal(M8.fmtVer(s.header.version), 'v4.0.2');
});

test('verNum orders versions numerically (v1.10.2 > v1.9.0)', () => {
  assert.ok(M8.verNum({major:1, minor:10, patch:2}) > M8.verNum({major:1, minor:9, patch:0}));
});

test('parseSong rejects wrong magic and wrong file type', () => {
  const b = makeSong();
  b[0] = 0x58; // corrupt magic
  assert.equal(M8.parseSong(b), null);
  const b2 = makeSong();
  b2[13] = 0x10; // instrument file type in a .m8s
  assert.equal(M8.parseSong(b2), null);
});

test('parseSong rejects truncated file', () => {
  assert.equal(M8.parseSong(makeSong().slice(0, 50000)), null);
});

// ── Song fields ────────────────────────────────────────────
test('parseSong reads name, tempo, transpose, quantize', () => {
  const s = M8.parseSong(makeSong());
  assert.equal(s.name, 'TESTSONG');
  assert.ok(Math.abs(s.tempo - 128.5) < 0.001);
  assert.equal(s.transpose, -2);
  assert.equal(s.quantize, 1);
});

test('parseSong reads instruments and dedupes sample paths', () => {
  const s = M8.parseSong(makeSong());
  assert.equal(s.instruments.length, 3);
  const [kick, lead, kick2] = s.instruments;
  assert.equal(kick.slot, 0);
  assert.equal(kick.typeName, 'SAMPLER');
  assert.equal(kick.name, 'KICK');
  assert.equal(kick.samplePath, '/Samples/Drums/kick.wav');
  assert.equal(lead.typeName, 'WAVSYNTH');
  assert.equal(lead.samplePath, '');
  assert.equal(kick2.name, 'KICK2');
  // two instruments share one path → deduped
  assert.deepEqual(s.samplePaths, ['/Samples/Drums/kick.wav']);
});

// ── Pattern data ───────────────────────────────────────────
test('parseSongPatterns reads grid, chains, phrases', () => {
  const pat = M8.parseSongPatterns(makeSong());
  assert.ok(pat, 'patterns parsed');
  assert.equal(pat.lastRow, 1);
  assert.equal(pat.grid[0][0], 0x00);
  assert.equal(pat.grid[1][1], 0x01);
  assert.equal(pat.grid[0][1], 0xFF);
  assert.equal(pat.chains[0][0].phrase, 0x05);
  assert.equal(pat.chains[1][0].phrase, 0x06);
  assert.equal(pat.chains[1][0].transpose, 0xFE);
  const step = pat.phrases[5][0];
  assert.equal(step.note, 24);
  assert.equal(step.vol, 0x40);
  assert.equal(step.instr, 0x00);
  assert.equal(step.fx[0].cmd, 0x04);
  assert.equal(step.fx[0].val, 0x10);
  assert.equal(step.fx[1].cmd, 0xFF);
});

test('parseSongPatterns returns null for short buffers', () => {
  assert.equal(M8.parseSongPatterns(new Uint8Array(1000)), null);
});

// ── Other file types ───────────────────────────────────────
test('parseInstrFile reads kind, name, sample path', () => {
  const i = M8.parseInstrFile(makeInstrFile());
  assert.ok(i);
  assert.equal(i.typeName, 'SAMPLER');
  assert.equal(i.name, 'SNARE');
  assert.equal(i.samplePath, 'Samples/snare.wav');
});

test('parseTheme reads colors', () => {
  const t = M8.parseTheme(makeTheme());
  assert.ok(t);
  assert.deepEqual(t.colors.background, {r: 16, g: 16, b: 16});
  assert.deepEqual(t.colors.text, {r: 255, g: 128, b: 0});
  assert.equal(M8.rgbHex(t.colors.background), '#101010');
});

test('parseGroove reads 16 steps', () => {
  const g = M8.parseGroove(makeGroove());
  assert.ok(g);
  assert.equal(g.steps.length, 16);
  assert.equal(g.steps[0], 8);
  assert.equal(g.steps[1], 4);
  assert.equal(g.steps[2], 6);
});

// ── Note / FX formatting ───────────────────────────────────
test('noteStr formats notes and empties', () => {
  assert.equal(M8.noteStr(0xFF), '---');
  assert.equal(M8.noteStr(0), 'C-1');
  assert.equal(M8.noteStr(1), 'C#1');
  assert.equal(M8.noteStr(24), 'C-3');
});

test('fxStr resolves sequencer command names', () => {
  assert.equal(M8.fxStr(0xFF, 0x00), '------');
  assert.equal(M8.fxStr(0x04, 0x10), 'HOP 10');   // sequencer
  assert.equal(M8.fxStr(0x05, 0x00), 'KIL 00');
  assert.equal(M8.fxStr(0x17, 0x80), 'VMV 80');   // fx/mixer
  assert.equal(M8.fxStr(0x3A, 0x01), 'USB 01');   // last mixer command
});

test('fxStr resolves instrument-specific command names by type', () => {
  assert.equal(M8.fxStr(0x80, 0x20, 'SAMPLER'), 'VOL 20');
  assert.equal(M8.fxStr(0x83, 0x01, 'SAMPLER'), 'PLY 01');
  assert.equal(M8.fxStr(0x83, 0x01, 'WAVSYNTH'), 'OSC 01');
  assert.equal(M8.fxStr(0x83, 0x01, 'FMSYNTH'), 'ALG 01');
  assert.equal(M8.fxStr(0x80, 0x01, 'MIDIOUT'), 'MPG 01');
  assert.equal(M8.fxStr(0xA2, 0x01, 'SAMPLER'), 'SLI 01');
});

test('fxStr falls back to hex for unknown commands', () => {
  assert.equal(M8.fxStr(0x70, 0x22), '70? 22');            // gap between mixer and instr ranges
  assert.equal(M8.fxStr(0x80, 0x22), '80? 22');            // instr range without a type
  assert.equal(M8.fxStr(0xF0, 0x22, 'SAMPLER'), 'F0? 22'); // beyond the table
});

test('fxName boundaries', () => {
  assert.equal(M8.fxName(0x00), 'ARP');
  assert.equal(M8.fxName(0x16), 'TSP');
  assert.equal(M8.fxName(0x17), 'VMV');
  assert.equal(M8.fxName(0xFF), null);
  assert.equal(M8.fxName(0x3B), null);
});

// ── String decoding ────────────────────────────────────────
test('readStr handles utf-8 and terminators (via song name)', () => {
  const b = makeSong();
  // clear the 12-byte name field, then write utf-8 'ÄBC'
  b.fill(0x00, 148, 160);
  b[148] = 0xC3; b[149] = 0x84; b[150] = 0x42; b[151] = 0x43;
  assert.equal(M8.parseSong(b).name, 'ÄBC');
  // 0xFF-terminated
  b.fill(0xFF, 148, 160);
  writeStr(b, 148, 'AB');
  b[150] = 0xFF;
  assert.equal(M8.parseSong(b).name, 'AB');
  // invalid utf-8 falls back to latin1 rather than throwing
  b.fill(0x00, 148, 160);
  b[148] = 0xE9; b[149] = 0x42; // lone 0xE9 is invalid utf-8, 'é' in latin1
  assert.equal(M8.parseSong(b).name, 'éB');
});

test('empty name falls back to UNTITLED', () => {
  const b = makeSong();
  b.fill(0x00, 148, 160);
  assert.equal(M8.parseSong(b).name, 'UNTITLED');
});
