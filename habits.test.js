import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSpans, learnable, applyHabits } from './habits.js';
import { compareLine } from './core.js';

test('diffSpans pairs what the phone heard with the script words it stood in for', () => {
  assert.deepEqual(diffSpans('Stupid hillbillies.', 'stupid hill release'),
    [{ before: 'stupid', written: ['hillbillies'], heard: ['hill', 'release'], after: '' }]);
});

test('diffSpans reports a dropped word as a span with nothing heard', () => {
  assert.deepEqual(diffSpans('Get away! Shoo! Shoo!', 'get away shoo'),
    [{ before: 'shoo', written: ['shoo'], heard: [], after: '' }]);
});

test('learnable keeps only swaps, never a dropped or an added word', () => {
  const spans = [
    { before: 'a', written: ['b'], heard: ['c'], after: 'd' },
    { before: 'a', written: ['b'], heard: [], after: 'd' },
    { before: 'a', written: [], heard: ['c'], after: 'd' },
  ];
  assert.deepEqual(learnable(spans), [spans[0]]);
});

test('learnable refuses long stretches, which are more likely a real misreading than a phone habit', () => {
  assert.deepEqual(learnable([{ before: '', written: ['one', 'two', 'three', 'four', 'five'], heard: ['x'], after: '' }]), []);
});

test('applyHabits turns a learned phone habit back into the script words, so the line matches', () => {
  const habits = [{ before: 'stupid', written: ['hillbillies'], heard: ['hill', 'release'], after: '' }];
  const r = applyHabits('Stupid hillbillies.', 'Stupid hill release.', habits);
  assert.equal(r.used, 1);
  assert.equal(compareLine('Stupid hillbillies.', r.text).match, true);
});

test('applyHabits only applies a habit in the same spot of the line', () => {
  const habits = [{ before: 'stupid', written: ['hillbillies'], heard: ['hill', 'release'], after: '' }];
  const r = applyHabits('Stupid hillbillies.', 'silly hill release', habits);
  assert.equal(r.used, 0);
  assert.equal(compareLine('Stupid hillbillies.', r.text).match, false);
});

test('applyHabits never covers a word he left out', () => {
  const habits = [{ before: 'stupid', written: ['hillbillies'], heard: ['hill', 'release'], after: '' }];
  const r = applyHabits('Stupid hillbillies.', 'stupid', habits);
  assert.equal(r.used, 0);
  assert.equal(compareLine('Stupid hillbillies.', r.text).match, false);
});

test('applyHabits works in the middle of a line, anchored on both sides', () => {
  const habits = [{ before: 'call', written: ['em', 'off'], heard: ['him', 'out', 'of'], after: 'bumpus' }];
  const r = applyHabits("{Bumpus}! Call 'em off! {Bumpus}!", 'Bumpus call him out of bumpus', habits);
  assert.equal(r.used, 1);
  assert.equal(compareLine("{Bumpus}! Call 'em off! {Bumpus}!", r.text).match, true);
});
