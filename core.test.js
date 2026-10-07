import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, compareLine, detectCommand, promptText, assembleTranscript, isLineFinished, lineEndHeard, stripStale, stripDirections, isSoundOnly, cleanText, voiceFor } from './core.js';

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

test('assembleTranscript keeps a phrase really said twice across a restart', () => {
  assert.equal(assembleTranscript(["silly you'll see"], [{ final: true, text: "you'll see I'll have you know" }]), "silly you'll see you'll see I'll have you know");
});

test('a phrase the phone heard twice across a restart still matches the line', () => {
  // Phone report 1 Oct 2026: a restart re-heard the start of the line; the line must still pass.
  const heard = assembleTranscript(['how did you note that'], [{ final: true, text: 'how did you know that' }]);
  assert.equal(compareLine('How did you know that?', heard).match, true);
});

test('a real word the phone ran into a neighboring made-up word still counts', () => {
  // Phone report 1 Oct 2026: "racklin' ash" heard as "recognize", so "ash" was marked missing.
  const r = compareLine("{Consarned}, {goobly-degooking}, {racklin'} ash!", 'concerned gobbledy cooking recognize');
  assert.deepEqual(r.missing, []);
  assert.equal(r.match, true);
});

test('a real word skipped after a made-up word is still caught as missing', () => {
  const r = compareLine("{Consarned}, {goobly-degooking}, {racklin'} ash!", 'concerned gobbledy cooking racklin');
  assert.deepEqual(r.missing, ['ash']);
});

test('a real word skipped between two made-up words is still caught as missing', () => {
  const r = compareLine("{Farfangled} britches {cobbler-goblin'}", 'farfangled cobbler goblin');
  assert.deepEqual(r.missing, ['britches']);
});

test('a word the phone splits in two matches even when the first half is a word in the line', () => {
  // Phone report 4 Oct 2026: "apiece" heard as "a piece" in a line that also has "a".
  assert.equal(compareLine('I had to get a jump. Those things are up to six dollars apiece.', 'I had to get a jump those things are up to six dollars a piece').match, true);
});

test('lineEndHeard waits for every repeat of a tag line', () => {
  // Fable's review, 4 Oct 2026: a repeated tag ended the line early at a comic beat.
  assert.equal(lineEndHeard("It's a major award! A major award!", "it's a major award"), false);
  assert.equal(lineEndHeard('Get out! Get out, get out, get out!', 'get out get out get out'), false);
  assert.equal(lineEndHeard("It's a major award! A major award!", "it's a major award a major award"), true);
});

test('a real word swapped for another beside a made-up word is not counted as said', () => {
  // Fable's review, 4 Oct 2026: "trash" for "ash" and "tool" for "fool" passed as Matched.
  assert.equal(compareLine("{racklin'} ash!", 'racklin trash').match, false);
  assert.equal(compareLine('{Consarned} fool!', 'concerned tool').match, false);
  assert.equal(compareLine('Holy {smokes}, Ralphie', 'holy smokes ralph').match, false);
});

test('stripStale drops his previous line\'s words from the start of the next one', () => {
  // Fable's review, 7 Oct 2026: muting doesn't close the engine's open stretch, so it can carry over.
  assert.equal(stripStale('Read it. Who turned the damper down', 'read it.'), 'Who turned the damper down');
  assert.equal(stripStale('Who turned the damper down', 'read it'), 'Who turned the damper down');
  assert.equal(stripStale('Read it', ''), 'Read it');
});

test('a dropped g ("frackin\'" for "fracking") still matches', () => {
  // Phone report 7 Oct 2026, Moonshine Small: "rackin' frackin' mangy mutts".
  assert.equal(compareLine("{Rackin'} fracking mangy mutts!", "rackin' frackin' mangy mutts").match, true);
  assert.equal(compareLine("There's nothing here.", "there's nothin' here").match, true);
  assert.equal(compareLine("There's nothin' here.", "there's nothing here").match, true);
});

test('a real word next to a made-up word, heard as a sound-alike, is a probable mishearing', () => {
  // Phone report 7 Oct 2026: "Call 'em off! Bumpus!" heard "call him out of bumpus" was marked Needs work.
  const r = compareLine("{Bumpus}! Call 'em off! {Bumpus}!", 'Bumpus. Call him out of bumpus.');
  assert.equal(r.match, false);
  assert.equal(r.likelyMishearing, true);
});

test('filler words written in the script ("Hmm.", "Uh ...") are not required', () => {
  // The phone often drops them, and they're ignored in what it hears, so the script's copy must be too.
  assert.equal(compareLine("Hmm. Here's a letter with no stamp on it.", "here's a letter with no stamp on it").match, true);
  assert.equal(compareLine('Uh ... yeah.', 'uh yeah').match, true);
});

test('isLineFinished restarts the quiet clock when the phone resumes listening', () => {
  // Phone report 1 Oct 2026: the line was ended during the phone's own listening restart, cutting him off.
  assert.equal(isLineFinished({ heardSomething: true, lastSpeechAt: 1000, listeningSince: 2500, now: 3200, gapMs: 2000 }), false);
  assert.equal(isLineFinished({ heardSomething: true, lastSpeechAt: 1000, listeningSince: 2500, now: 4600, gapMs: 2000 }), true);
});

test('isLineFinished does not let back-to-back restarts hold the line open forever', () => {
  assert.equal(isLineFinished({ heardSomething: true, lastSpeechAt: 1000, listeningSince: 30000, now: 5100, gapMs: 2000 }), true);
});

test('isLineFinished ends quickly once the end of the line has been heard', () => {
  // Phone report 4 Oct 2026: he finished one line, the app kept waiting, and he ran on into his next line.
  assert.equal(isLineFinished({ heardSomething: true, lastSpeechAt: 1000, now: 2100, gapMs: 2000, endHeard: true }), true);
});

test('isLineFinished waits half as long again while the end of the line has not been heard', () => {
  // A pause partway through ("Look. ... Read it.") should not end the line; but a line whose
  // ending the phone misheard should not wait twice as long either (Fable's review, 4 Oct 2026).
  const base = { heardSomething: true, lastSpeechAt: 1000, gapMs: 2000, endHeard: false };
  assert.equal(isLineFinished({ ...base, now: 3500 }), false);
  assert.equal(isLineFinished({ ...base, now: 4100 }), true);
});

test('lineEndHeard is true when the line\'s last word and most of the line were heard', () => {
  assert.equal(lineEndHeard('Bills ... bills ... bills ... These bills are never ending.', 'bills bills bills never ending'), true);
  assert.equal(lineEndHeard('Well ... they could deliver a deed, for {cripessake}.', 'well they could deliver a deed for crype sake'), true);
});

test('lineEndHeard is false partway through a line', () => {
  assert.equal(lineEndHeard('Look. Read it.', 'look'), false);
  // The last words come round early in a repeated line, but most of it is still to come.
  assert.equal(lineEndHeard("I'm a winner! I'm a winner! I'm a winner!", "I'm a winner"), false);
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

test('compareLine: one word heard as two sound-alike words is a likely mishearing', () => {
  const r = compareLine('A trophy for all to see.', 'a tro fee for all to see');
  assert.equal(r.match, false);
  assert.equal(r.likelyMishearing, true);
});
