// M8 Librarian — markup integrity tests
//
// Guards against the parser landmines that a single-file app is prone to:
// a literal "</style>" or "</script>" inside comments/strings terminates
// the block early in a real browser (regex-based extraction won't notice),
// and a nested "<!--" corrupts HTML comments.
//
// Run with:  node tests/markup.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');

test('exactly one </style>, terminating the real style block', () => {
  assert.equal((html.match(/<\/style/gi) || []).length, 1);
});

test('exactly one </script>, terminating the real script block', () => {
  assert.equal((html.match(/<\/script/gi) || []).length, 1);
});

test('no CSS comment contains a literal style closer', () => {
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  for (const m of style.matchAll(/\/\*([\s\S]*?)\*\//g))
    assert.ok(!/<\/style/i.test(m[1]), 'CSS comment contains </style');
});

test('no HTML comment nests another comment opener', () => {
  for (const m of html.matchAll(/<!--([\s\S]*?)-->/g))
    assert.ok(!m[1].includes('<!--'), 'nested <!-- inside HTML comment: ' + m[1].slice(0, 60));
});

test('script body never contains a literal script closer', () => {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(!/<\/script/i.test(script));
});

// ── Editor side-panel listener discipline ──────────────────
// The chain / phrase / tables panels persist across renders while their
// contents are replaced. Their wireX() functions attach listeners to the
// PANEL, so re-rendering into the same node used to stack a new listener
// on top of every old one — and each old one closed over the chain or
// phrase index that was open when it was wired. One keystroke then
// edited every chain the user had merely LOOKED at, and the save path
// wrote and "verified" the damage. The panels must therefore be replaced
// with a fresh node on every render.
test('editor side panels are re-created per render, not re-filled in place', () => {
  const start = html.indexOf('function edFreshPanel');
  assert.ok(start > 0, 'edFreshPanel helper must exist');
  const helper = html.slice(start, start + 400);
  assert.ok(/cloneNode\(false\)/.test(helper), 'must clone without children (drops listeners)');
  assert.ok(/replaceWith/.test(helper), 'must swap the old node out');

  for (const id of ['pv-chain-detail', 'pv-phrase-detail', 'pv-tables-detail']) {
    assert.ok(html.includes(`edFreshPanel(host, '${id}')`),
      `${id} must be re-created via edFreshPanel before it is refilled`);
    // ...and must NOT be re-acquired with a plain lookup in a render path,
    // which is what allowed the listeners to pile up.
    const plain = new RegExp(`const det = host\\.querySelector\\('#${id}'\\)`);
    assert.ok(!plain.test(html), `${id} must not be re-filled via a plain querySelector`);
  }
});

test('the transport can reach section, chain and phrase play from the editor', () => {
  // These were all implemented and documented but had no UI hooked up:
  // the grid emitted data-rlbl where the handler matched data-row.
  assert.ok(html.includes('class="pv-rowplay"'), 'row gutter has a section-play button');
  assert.ok(/\.pv-rowplay\[data-row\]/.test(html), 'row play is wired in the delegated handler');
  assert.ok(html.includes('cp-play pv-detail-play'), 'chain list rows have a play button');
  assert.ok(/pv-detail-play" data-phrase=/.test(html), 'the phrase editor header has a play button');
  assert.ok(/pv-detail-play" data-chain=/.test(html), 'the chain editor header has a play button');
  // Space must resolve the two panels by id: a bare '.pv-detail' always
  // matched the chain panel, so the phrase branch could never fire.
  assert.ok(!/querySelector\('#modal-pattern-section \.pv-detail'\)/.test(html),
    'spacePlay must not resolve the panel with a bare .pv-detail lookup');
});
