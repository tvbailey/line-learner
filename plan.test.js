import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScript } from './script.js';
import { planScene } from './plan.js';

const plan = (text) => planScene(parseScript(text).scenes[0].items, 'THE OLD MAN')
  .map((s) => `${s.action}:${s.item.text || s.item.title || s.item.kind}`);

test('others speak, I listen, directions are only shown', () => {
  assert.deepEqual(plan('# S\nMOTHER: Hi.\n(He sits.)\nTHE OLD MAN: Quiet!\n'),
    ['speak:Hi.', 'show:He sits.', 'listen:Quiet!']);
});

test('in a song I practice only the first two sung lines, then the rest is skipped', () => {
  assert.deepEqual(plan('# S\n[SONG: Genius]\nTHE OLD MAN: ~ ONE\nTHE OLD MAN: ~ TWO\nTHE OLD MAN: ~ THREE\n'),
    ['speak:Genius', 'listen:ONE', 'listen:TWO', 'skip:THREE']);
});

test('after skipped singing, the last skipped line is spoken as my cue', () => {
  assert.deepEqual(plan('# S\n[SONG: G]\nTHE OLD MAN: ~ ONE\nTHE OLD MAN: ~ TWO\nTHE OLD MAN: ~ THREE\nMOTHER: ~ FOUR\nTHE OLD MAN: Oh, Peter Pan.\n'),
    ['speak:G', 'listen:ONE', 'listen:TWO', 'skip:THREE', 'skip:FOUR', 'cue:FOUR', 'listen:Oh, Peter Pan.']);
});

test('a spoken line of mine opens a new handoff: the next two sung lines are practiced again', () => {
  assert.deepEqual(plan('# S\n[SONG: G]\nTHE OLD MAN: ~ A\nTHE OLD MAN: ~ B\nTHE OLD MAN: ~ C\nTHE OLD MAN: Hey!\nTHE OLD MAN: ~ D\n'),
    ['speak:G', 'listen:A', 'listen:B', 'skip:C', 'cue:C', 'listen:Hey!', 'listen:D']);
});

test("other people's sung lines are skipped, not read", () => {
  assert.deepEqual(plan('# S\n[SONG: M]\nMOTHER: ~ STAINS ON THE RUG\nTHE OLD MAN: More potatoes, dear.\n'),
    ['speak:M', 'skip:STAINS ON THE RUG', 'cue:STAINS ON THE RUG', 'listen:More potatoes, dear.']);
});
