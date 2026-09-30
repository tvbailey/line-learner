import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, compareLine, detectCommand, promptText, assembleTranscript, isLineFinished, stripDirections, isSoundOnly, cleanText, voiceFor } from './core.js';

test('normalize lowercases, strips punctuation, splits words', () => {
  assert.deepEqual(normalize("Fra-GEE-leh! It must be Italian."), ['fra', 'gee', 'leh', 'it', 'must', 'be', 'italian']);
});

test('normalize expands a contraction to its long form', () => {
  assert.deepEqual(normalize("Don't touch it"), ['do', 'not', 'touch', 'it']);
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

test('compareLine treats a contraction and its long form as the same words', () => {
  assert.equal(compareLine('I am a man of action. Do not touch it.', "I'm a man of action. Don't touch it.").match, true);
  assert.equal(compareLine("It's here! You'll see.", 'it is here you will see').match, true);
});

test('compareLine marks a one-word difference that sounds alike as a likely mishearing', () => {
  const r = compareLine('Edison did not rush the light bulb', 'medicine did not rush the light bulb');
  assert.equal(r.match, false);
  assert.equal(r.likelyMishearing, true);
});

test('compareLine does not call a real word swap a mishearing', () => {
  assert.equal(compareLine('It is a major award', 'it is a big award').likelyMishearing, false);
});

test('isSoundOnly: an exclamation that is just a sound', () => {
  for (const t of ['Argh!', '(struggling, in frustration) Argh!', 'Ha!', 'Hmm.', 'Aaarrgghh!', 'Ugh.']) assert.equal(isSoundOnly(t), true, t);
});

test('isSoundOnly: real words are not sounds', () => {
  for (const t of ['Quiet!', 'Oh, sure.', 'Jeez.', 'Yeah?', 'What is it?']) assert.equal(isSoundOnly(t), false, t);
});

test('compareLine: a made-up word heard as sound-alike real words passes, with the comparison kept', () => {
  const r = compareLine('{Consarned}, {goobly-degooking}, {racklin} ash!', 'consarned goo glee the gooking racking ash');
  assert.equal(r.match, true);
  assert.equal(r.madeUp.length, 1);
  assert.equal(r.madeUp[0].written, 'Consarned goobly-degooking racklin');
  assert.equal(r.madeUp[0].heard, 'consarned goo glee the gooking racking');
  assert.equal(r.madeUp[0].close, true);
});

test('compareLine: a made-up word replaced by something that sounds different is flagged to check', () => {
  const r = compareLine('The {fumulgatin} furnace has gone out.', 'the stupid furnace has gone out');
  assert.equal(r.match, false);
  assert.equal(r.checkMadeUp, true);
  assert.deepEqual(r.missing, []);
});

test('compareLine: a skipped made-up word is flagged to check', () => {
  const r = compareLine('Oh, {flibberdygibbit}! Corn doodle do.', 'oh corn doodle do');
  assert.equal(r.match, false);
  assert.equal(r.madeUp[0].heard, '');
});

test('compareLine: real words around made-up words are still checked', () => {
  const r = compareLine('The {fumulgatin} furnace has gone out.', 'the fumigating furnace has out');
  assert.equal(r.match, false);
  assert.deepEqual(r.missing, ['gone']);
});

test('compareLine: a false start followed by the right line counts, marked as a restart', () => {
  const r = compareLine('How did you know that?', 'how did you how did you know that');
  assert.equal(r.match, true);
  assert.equal(r.restarted, true);
});

test('compareLine: a clean line is not marked as a restart', () => {
  assert.equal(compareLine('How did you know that?', 'how did you know that').restarted, false);
});

test('promptText and cleanText drop the braces', () => {
  assert.equal(cleanText('The {fumulgatin} furnace'), 'The fumulgatin furnace');
  assert.equal(promptText('{Consarned}, goobly ash!', 2), 'Consarned, goobly ash!');
});

test('voiceFor: the same character always gets the same voice', () => {
  assert.deepEqual(voiceFor('MOTHER', 5), voiceFor('MOTHER', 5));
});

test('voiceFor: women and kids sound higher, men lower', () => {
  assert.ok(voiceFor('MOTHER', 5).pitch > 1);
  assert.ok(voiceFor('RANDY', 5).pitch > voiceFor('MOTHER', 5).pitch);
  assert.ok(voiceFor('JEAN', 5).pitch < 1);
});

test('voiceFor: different characters spread across the available voices', () => {
  const picks = new Set(['MOTHER', 'RALPHIE', 'RANDY', 'JEAN', 'MISS SHIELDS'].map((n) => voiceFor(n, 5).voice));
  assert.ok(picks.size >= 3);
});

test('compareLine: sound-alike spellings count as the same word (shoo/shoe, em/him)', () => {
  assert.equal(compareLine('Shoo! Shoo!', 'shoe shoe').match, true);
  assert.equal(compareLine("Call 'em off!", 'call him off').match, true);
  assert.equal(compareLine("Call 'em off!", 'call them off').match, true);
  assert.equal(compareLine('I want to go too.', 'I want two go to').match, true);
});

test('compareLine: words run together or split apart still match (get away / getaway)', () => {
  assert.equal(compareLine('Get away! Shoo!', 'getaway shoo').match, true);
  assert.equal(compareLine('A crackerjack guy.', 'a cracker jack guy').match, true);
});

test('compareLine: a genuinely different word still fails', () => {
  assert.equal(compareLine("Call 'em off!", 'call it off').match, false);
});
