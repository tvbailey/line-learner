import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, compareLine, detectCommand, promptText, assembleTranscript, isLineFinished, stripDirections } from './core.js';

test('normalize lowercases, strips punctuation, splits words', () => {
  assert.deepEqual(normalize("Fra-GEE-leh! It must be Italian."), ['fra', 'gee', 'leh', 'it', 'must', 'be', 'italian']);
});

test('normalize folds apostrophes so "don\'t" and "dont" match', () => {
  assert.deepEqual(normalize("Don't touch it"), ['dont', 'touch', 'it']);
});

test('compareLine: exact words match even with different punctuation', () => {
  const r = compareLine('Well, I never!', 'well i never');
  assert.equal(r.match, true);
});

test('compareLine: a changed word is flagged and reported', () => {
  const r = compareLine('It is a major award', 'it is a big award');
  assert.equal(r.match, false);
  assert.deepEqual(r.missing, ['major']);
  assert.deepEqual(r.extra, ['big']);
});

test('compareLine: filler words he adds (uh, um) are ignored', () => {
  assert.equal(compareLine('I won a major award', 'uh I won a um major award').match, true);
});

test('compareLine: a dropped word is flagged', () => {
  const r = compareLine('Not a chance in the world', 'not a chance in world');
  assert.equal(r.match, false);
  assert.deepEqual(r.missing, ['the']);
});

test('detectCommand recognizes a command said on its own', () => {
  assert.equal(detectCommand('Line'), 'line');
  assert.equal(detectCommand(' line. '), 'line');
  assert.equal(detectCommand('pause'), 'pause');
  assert.equal(detectCommand('Repeat'), 'repeat');
});

test('detectCommand ignores a command word inside a sentence', () => {
  assert.equal(detectCommand('let me pause for a moment'), null);
  assert.equal(detectCommand('draw a line in the sand'), null);
});

test('promptText: first prompt gives the first four words, second gives the whole line', () => {
  const line = 'Only I would get a major award like this';
  assert.equal(promptText(line, 1), 'Only I would get');
  assert.equal(promptText(line, 2), line);
});

test('assembleTranscript joins earlier sessions with the current results', () => {
  const current = [{ final: true, text: 'a major' }, { final: false, text: 'award' }];
  assert.equal(assembleTranscript(['it is'], current), 'it is a major award');
});

test('isLineFinished waits for the gap after speech, never before any speech', () => {
  assert.equal(isLineFinished({ heardSomething: false, lastSpeechAt: 0, now: 99999, gapMs: 1500 }), false);
  assert.equal(isLineFinished({ heardSomething: true, lastSpeechAt: 1000, now: 2000, gapMs: 1500 }), false);
  assert.equal(isLineFinished({ heardSomething: true, lastSpeechAt: 1000, now: 2600, gapMs: 1500 }), true);
});

test('detectCommand recognizes "resume" on its own', () => {
  assert.equal(detectCommand('Resume.'), 'resume');
});

test('stripDirections removes stage directions in parentheses', () => {
  assert.equal(stripDirections('That was one small spark... (pause) ...and a lesson.'), 'That was one small spark... ...and a lesson.');
});
