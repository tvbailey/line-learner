import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScript } from './script.js';
import { planScene, drillSteps, trimCues } from './plan.js';

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

test('a line shared with others ("THE OLD MAN & MOTHER") is mine to say', () => {
  assert.deepEqual(plan('# S\nRANDY: Wow!\nTHE OLD MAN & MOTHER: Merry Christmas!\nMEN, WOMEN, THE OLD MAN & MOTHER: ~ RALPHIE TO THE RESCUE.\n'),
    ['speak:Wow!', 'listen:Merry Christmas!', 'listen:RALPHIE TO THE RESCUE.']);
});

test('a name that only contains mine is not mine ("THE OLD MANAGER")', () => {
  assert.deepEqual(plan('# S\nTHE OLD MANAGER: Hi.\n'), ['speak:Hi.']);
});

const planSkipping = (text) => planScene(parseScript(text).scenes[0].items, 'THE OLD MAN', { skipSongs: true })
  .map((s) => `${s.action}:${s.item.text || s.item.title || s.item.kind}`);

test('with songs skipped, everything inside a song is skipped, spoken lines included', () => {
  assert.deepEqual(planSkipping('# S\nMOTHER: Nice.\n[SONG: G]\nTHE OLD MAN: ~ ONE\nTHE OLD MAN: Oh, Peter Pan.\nMOTHER: ~ TWO\n[END SONG]\nMOTHER: Boys, breakfast!\nTHE OLD MAN: Quiet!\n'),
    ['speak:Nice.', 'speak:G', 'skip:ONE', 'skip:Oh, Peter Pan.', 'skip:TWO', 'show:songEnd', 'speak:Boys, breakfast!', 'listen:Quiet!']);
});

test('with songs skipped, a line right after the song gets the song\'s last line as its cue', () => {
  assert.deepEqual(planSkipping('# S\n[SONG: G]\nMOTHER: ~ TWO\n[END SONG]\nTHE OLD MAN: Quiet!\n'),
    ['speak:G', 'skip:TWO', 'show:songEnd', 'cue:TWO', 'listen:Quiet!']);
});

test('drill: only my lines with made-up words, each after the line before it as its cue', () => {
  const items = parseScript('# S\nMOTHER: The furnace again, dear.\nTHE OLD MAN: {Consarned} ash!\nMOTHER: Well?\nTHE OLD MAN: Quiet!\nRANDY: Wow.\nTHE OLD MAN: Oh, {flibberdygibbit}!\n').scenes[0].items;
  const drill = drillSteps(planScene(items, 'THE OLD MAN')).map((s) => `${s.action}:${s.item.text}`);
  assert.deepEqual(drill, ['cue:The furnace again, dear.', 'listen:{Consarned} ash!', 'cue:Wow.', 'listen:Oh, {flibberdygibbit}!']);
});

test('trimCues: keep only the last N lines read before each of mine', () => {
  const items = parseScript('# S\nA: one\nB: two\nA: three\nB: four\nTHE OLD MAN: Mine.\nA: five\nTHE OLD MAN: Mine again.\n').scenes[0].items;
  const out = trimCues(planScene(items, 'THE OLD MAN'), 2).map((s) => `${s.action}:${s.item.text}`);
  assert.deepEqual(out, ['skip:one', 'skip:two', 'speak:three', 'speak:four', 'listen:Mine.', 'speak:five', 'listen:Mine again.']);
});

test('trimCues: 0 means read everything', () => {
  const items = parseScript('# S\nA: one\nB: two\nTHE OLD MAN: Mine.\n').scenes[0].items;
  assert.deepEqual(trimCues(planScene(items, 'THE OLD MAN'), 0).map((s) => s.action), ['speak', 'speak', 'listen']);
});

test('trimCues: lines after my last line are skipped too', () => {
  const items = parseScript('# S\nTHE OLD MAN: Mine.\nA: after\nB: more\n').scenes[0].items;
  assert.deepEqual(trimCues(planScene(items, 'THE OLD MAN'), 3).map((s) => s.action), ['listen', 'skip', 'skip']);
});
