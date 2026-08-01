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

test('fxStr resolves sequencer command names (versioned)', () => {
  assert.equal(M8.fxStr(0xFF, 0x00), '------');
  assert.equal(M8.fxStr(0x04, 0x10), 'HOP 10');   // sequencer, stable across versions
  assert.equal(M8.fxStr(0x05, 0x00), 'KIL 00');
  // 2.x tables (vn = 20000): 23 sequencer commands, mixer from 0x17
  assert.equal(M8.fxStr(0x06, 0x00, null, 20601), 'RAN 00');
  assert.equal(M8.fxStr(0x17, 0x80, null, 20601), 'VMV 80');
  assert.equal(M8.fxStr(0x3A, 0x01, null, 20601), 'USB 01');
  // 3.0 inserted RND/RNL and shifted the list; mixer starts at 0x1B
  assert.equal(M8.fxStr(0x06, 0x00, null, 30000), 'RND 00');
  assert.equal(M8.fxStr(0x08, 0x00, null, 30000), 'RET 00');  // was REP pre-3.0
  assert.equal(M8.fxStr(0x0F, 0x00, null, 60500), 'PVX 00');  // real 6.x file evidence
  assert.equal(M8.fxStr(0x1B, 0x80, null, 30000), 'VMV 80');
  // 4.0 mixer renames + additions (also the default when no version given)
  assert.equal(M8.fxStr(0x1B, 0x80), 'VMV 80');
  assert.equal(M8.fxStr(0x35, 0x00, null, 30000), 'DJF 00');
  assert.equal(M8.fxStr(0x35, 0x00, null, 40000), 'DJC 00');
  assert.equal(M8.fxStr(0x46, 0x00, null, 40000), 'GGR 00');  // last 4.x mixer command
});

test('fxStr resolves instrument-specific command names by type', () => {
  assert.equal(M8.fxStr(0x80, 0x20, 'SAMPLER'), 'VOL 20');
  assert.equal(M8.fxStr(0x83, 0x01, 'SAMPLER'), 'PLY 01');
  assert.equal(M8.fxStr(0x83, 0x01, 'WAVSYNTH'), 'OSC 01');
  assert.equal(M8.fxStr(0x83, 0x01, 'FMSYNTH'), 'ALG 01');
  assert.equal(M8.fxStr(0x80, 0x01, 'MIDIOUT'), 'VOL 01');
  assert.equal(M8.fxStr(0x82, 0x01, 'MIDIOUT'), 'MPG 01');
  // modulator command block: 0x92 + 5 per modulator, named by mod type
  assert.equal(M8.fxStr(0x92, 0x01, 'SAMPLER'), 'EA1 01');           // default mod 1 = AHD
  assert.equal(M8.fxStr(0x97, 0x01, 'SAMPLER'), 'EA2 01');
  assert.equal(M8.fxStr(0x9C, 0x01, 'SAMPLER'), 'LA3 01');           // default mod 3 = LFO
  assert.equal(M8.fxStr(0x9D, 0x01, 'SAMPLER'), 'LO3 01');
  assert.equal(M8.fxStr(0x92, 0x01, 'SAMPLER', null, ['LFO']), 'LA1 01'); // explicit mod types
  // extra command after the 4×5 modulator block — matches real 6.x songs,
  // where 0xA6 appears on sliced sampler phrases
  assert.equal(M8.fxStr(0xA6, 0x01, 'SAMPLER'), 'SLI 01');
  assert.equal(M8.fxStr(0xA6, 0x01, 'MACROSYNTH'), 'TRG 01');
  assert.equal(M8.fxStr(0xA6, 0x01, 'FMSYNTH'), 'FMP 01');
  assert.equal(M8.fxStr(0xA7, 0x01, 'HYPERSYNTH'), 'SNC 01');
});

test('fxStr falls back to hex for unknown commands', () => {
  assert.equal(M8.fxStr(0x70, 0x22), '70? 22');            // gap between mixer and instr ranges
  assert.equal(M8.fxStr(0x80, 0x22), '80? 22');            // instr range without a type
  assert.equal(M8.fxStr(0xF0, 0x22, 'SAMPLER'), 'F0? 22'); // beyond the table
  assert.equal(M8.fxStr(0x90, 0x22, 'MIDIOUT'), '90? 22'); // MIDI OUT gap (only 16 base commands)
});

test('fxName boundaries', () => {
  assert.equal(M8.fxName(0x00), 'ARP');
  assert.equal(M8.fxName(0x16, null, 20601), 'TSP');  // last 2.x sequencer command
  assert.equal(M8.fxName(0x17, null, 20601), 'VMV');
  assert.equal(M8.fxName(0x3B, null, 20601), null);   // past the 2.x tables
  assert.equal(M8.fxName(0x1A), 'OFF');               // last 3.0+ sequencer command
  assert.equal(M8.fxName(0x46), 'GGR');               // last 4.x mixer command
  assert.equal(M8.fxName(0x47), null);
  assert.equal(M8.fxName(0xFF), null);
  const r2 = M8.fxRanges(20601), r4 = M8.fxRanges(null);
  assert.equal(r2.seqLen, 23); assert.equal(r2.mixLen, 36);
  assert.equal(r4.seqLen, 27); assert.equal(r4.mixLen, 44);
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

// ── Instrument kinds (3.0+ additions) ──────────────────────
test('HyperSynth and External kinds are recognised', () => {
  const b = makeInstrFile();
  b[10] = 0x00; b[11] = 0x03; // v3.0.0
  b[14] = 0x05;
  assert.equal(M8.parseInstrFile(b).typeName, 'HYPERSYNTH');
  b[14] = 0x06;
  assert.equal(M8.parseInstrFile(b).typeName, 'EXTERNALINST');
});

// ── decodeInstrParams ──────────────────────────────────────
test('decodeInstrParams reads a 3.x sampler (mods at +0x3F)', () => {
  const b = new Uint8Array(14 + ISIZE);
  // header not needed; decode directly at base 14 with a fake version
  const base = 14;
  b[base] = 0x02;                       // SAMPLER
  writeStr(b, base + 1, 'KICK');
  b[base + 13] = 1;                     // transpose on
  b[base + 14] = 0x01;                  // table tick
  b[base + 15] = 0x60;                  // volume
  b[base + 16] = 0x80;                  // pitch
  b[base + 17] = 0x80;                  // fine
  b[base + 18] = 2;                     // play mode FWDLOOP
  b[base + 19] = 0;                     // slice OFF
  b[base + 20] = 0x10;                  // start
  b[base + 21] = 0x20;                  // loop start
  b[base + 22] = 0xFF;                  // length
  b[base + 23] = 0x00;                  // degrade
  b[base + 24] = 1;                     // filter LOWPASS
  b[base + 25] = 0x40; b[base + 26] = 0x30; // cutoff/res
  b[base + 27] = 0x00; b[base + 28] = 0x00; // amp, limit CLIP
  b[base + 29] = 0x80;                  // pan
  // modulator slot 0 at +0x3F: AHD env (type 0) → dest 1 (VOLUME)
  const m0 = base + 0x3F;
  b[m0] = 0x01;                         // type 0, dest 1
  b[m0+1] = 0xFF;                       // amount
  b[m0+2] = 0x08; b[m0+3] = 0x00; b[m0+4] = 0x40; // A H D
  // modulator slot 1: LFO (type 3) → dest 3 (CUTOFF)
  const m1 = base + 0x3F + 6;
  b[m1] = 0x33;
  b[m1+1] = 0x80; b[m1+2] = 1; b[m1+3] = 0; b[m1+4] = 0x20;
  const p = M8.decodeInstrParams(b, base, {major:3, minor:0, patch:0});
  assert.equal(p.kindName, 'SAMPLER');
  assert.equal(p.volume, 0x60);
  assert.equal(p.kindParams.PLAY, 'FWDLOOP');
  assert.equal(p.kindParams.SLICE, 'OFF');
  assert.equal(p.filter.name, 'LOWPASS');
  assert.equal(p.filter.cutoff, 0x40);
  assert.equal(p.amp.limit, 'CLIP');
  assert.equal(p.mixer.pan, 0x80);
  assert.equal(p.mods[0].type, 'AHD ENV');
  assert.equal(p.mods[0].dest, 'VOLUME');
  assert.equal(p.mods[0].amount, 0xFF);
  assert.deepEqual(p.mods[0].env, [0x08, 0x00, 0x40]);
  assert.equal(p.mods[1].type, 'LFO');
  assert.equal(p.mods[1].dest, 'CUTOFF');
  assert.equal(p.mods[1].shape, 'SIN');
});

test('decodeInstrParams returns null for empty slots', () => {
  const b = new Uint8Array(300).fill(0xFF);
  assert.equal(M8.decodeInstrParams(b, 14, {major:4, minor:0, patch:0}), null);
});

// ── writeSamplePath (repair mode) ──────────────────────────
test('writeSamplePath round-trips through parseSong', () => {
  const b = makeSong();
  const newPath = '/Samples/NewKit/kick_v2.wav';
  M8.writeSamplePath(b, INSTR_TABLE, newPath);           // slot 0
  M8.writeSamplePath(b, INSTR_TABLE + 2 * ISIZE, newPath); // slot 2
  const s = M8.parseSong(b);
  assert.equal(s.instruments[0].samplePath, newPath);
  assert.equal(s.instruments[2].samplePath, newPath);
  assert.deepEqual(s.samplePaths, [newPath]);
  // unrelated instrument untouched
  assert.equal(s.instruments[1].name, 'LEAD');
});

test('writeSamplePath zero-fills the old longer path', () => {
  const b = makeSong();
  M8.writeSamplePath(b, INSTR_TABLE, '/a.wav'); // much shorter than original
  const s = M8.parseSong(b);
  assert.equal(s.instruments[0].samplePath, '/a.wav');
});

test('writeSamplePath rejects paths over 127 bytes', () => {
  const b = makeSong();
  assert.throws(() => M8.writeSamplePath(b, INSTR_TABLE, '/Samples/' + 'x'.repeat(130) + '.wav'));
});

// ── parseWavHeader ─────────────────────────────────────────
function makeWav({rate = 44100, bits = 16, channels = 2, dataBytes = 44100 * 4} = {}) {
  const b = new Uint8Array(44 + 16);
  const dv = new DataView(b.buffer);
  writeStr(b, 0, 'RIFF'); dv.setUint32(4, 36 + dataBytes, true); writeStr(b, 8, 'WAVE');
  writeStr(b, 12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);                      // PCM
  dv.setUint16(22, channels, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * channels * bits / 8, true); // byteRate
  dv.setUint16(32, channels * bits / 8, true);
  dv.setUint16(34, bits, true);
  writeStr(b, 36, 'data'); dv.setUint32(40, dataBytes, true);
  return b;
}

test('parseWavHeader reads fmt and duration', () => {
  const w = M8.parseWavHeader(makeWav({rate:44100, bits:16, channels:2, dataBytes:44100*4}));
  assert.ok(w);
  assert.equal(w.sampleRate, 44100);
  assert.equal(w.bits, 16);
  assert.equal(w.channels, 2);
  assert.ok(Math.abs(w.duration - 1.0) < 0.001); // 1 second stereo 16-bit
});

test('parseWavHeader estimates duration when data chunk is out of slice', () => {
  const head = makeWav().slice(0, 36); // fmt only, no data chunk
  const w = M8.parseWavHeader(head, 44 + 88200); // mono 16-bit 44.1k → ~1s
  assert.ok(w);
  assert.ok(w.duration > 0);
});

test('parseWavHeader rejects non-WAV data', () => {
  assert.equal(M8.parseWavHeader(new Uint8Array(100)), null);
  assert.equal(M8.parseWavHeader(makeSong().slice(0, 200), 1000), null);
});

// ── detectScales ───────────────────────────────────────────
test('detectScales identifies C major from its scale tones', () => {
  // phrases shaped like parseSongPatterns output: steps with .note
  const notes = [0,2,4,5,7,9,11, 12,14,16,17,19,21,23, 0,4,7,12]; // C D E F G A B across octaves
  const steps = notes.map(n => ({note: n, vol: 0xFF, instr: 0xFF, fx: []}));
  while (steps.length < 16) steps.push({note: 0xFF, vol: 0xFF, instr: 0xFF, fx: []});
  const { total, candidates } = M8.detectScales([steps]);
  assert.equal(total, notes.length);
  assert.ok(candidates.length > 0);
  assert.equal(candidates[0].root, 'C');
  assert.match(candidates[0].label, /^C /);
});

test('detectScales returns empty for empty phrases', () => {
  const { total, candidates } = M8.detectScales([]);
  assert.equal(total, 0);
  assert.deepEqual(candidates, []);
});

// ── FX names for new kinds ─────────────────────────────────
test('fxStr resolves HyperSynth and External commands', () => {
  assert.equal(M8.fxStr(0x83, 0x01, 'HYPERSYNTH'), 'CRD 01');
  assert.equal(M8.fxStr(0x82, 0x01, 'EXTERNALINST'), 'MPB 01');
});

// ── Real-firmware additions (sources review round) ─────────
test('parseSong exposes the save directory and per-instrument mod types', () => {
  const b = makeSong();
  // directory string sits right after the 14-byte header
  const dir = '/Bundles/TEST/';
  for (let i = 0; i < dir.length; i++) b[14 + i] = dir.charCodeAt(i);
  // instrument 0 (written by the fixture): give mod slots typed nibbles
  // type<<4 | dest — AHD(0), LFO(3), TRIG(4), TRACK(5)
  const i0 = INSTR_TABLE;
  b[i0 + 0x3F + 0*6] = 0x00 << 4;
  b[i0 + 0x3F + 1*6] = 0x03 << 4;
  b[i0 + 0x3F + 2*6] = 0x04 << 4;
  b[i0 + 0x3F + 3*6] = 0x05 << 4;
  const song = M8.parseSong(b);
  assert.equal(song.directory, '/Bundles/TEST/');
  const inst = song.instruments.find(i => i.slot === 0);
  assert.deepEqual(inst.modTypes, ['AHD ENV', 'LFO', 'TRIG ENV', 'TRACK ENV']);
});

test('parseWavCues decodes cue chunk bodies (sorted sample offsets)', () => {
  // 2 cue points at frames 4800 and 1200 (deliberately unsorted)
  const body = new Uint8Array(4 + 2 * 24);
  const dv = new DataView(body.buffer);
  dv.setUint32(0, 2, true);
  dv.setUint32(4 + 20, 4800, true);
  dv.setUint32(4 + 24 + 20, 1200, true);
  assert.deepEqual(M8.parseWavCues(body), [1200, 4800]);
  assert.equal(M8.parseWavCues(new Uint8Array(2)), null);          // truncated
  const zero = new Uint8Array(4); // count 0
  assert.equal(M8.parseWavCues(zero), null);
});

test('parseWavHeader picks up cue chunks inside the buffer', () => {
  // minimal RIFF: fmt + cue + data
  const cueBody = 4 + 24, sz = 12 + 8+16 + 8+cueBody + 8;
  const b = new Uint8Array(sz), dv = new DataView(b.buffer);
  const w4 = (o, s) => { for (let i=0;i<4;i++) b[o+i]=s.charCodeAt(i); };
  w4(0,'RIFF'); dv.setUint32(4, sz-8, true); w4(8,'WAVE');
  w4(12,'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);      // PCM mono
  dv.setUint32(24, 44100, true); dv.setUint32(28, 88200, true); // rate, byteRate
  dv.setUint16(34, 16, true);                                 // bits
  w4(36,'cue '); dv.setUint32(40, cueBody, true);
  dv.setUint32(44, 1, true); dv.setUint32(44+4+20, 999, true);
  w4(36+8+cueBody,'data'); dv.setUint32(36+8+cueBody+4, 0, true);
  const m = M8.parseWavHeader(b, sz);
  assert.equal(m.sampleRate, 44100);
  assert.deepEqual(m.cues, [999]);
});
