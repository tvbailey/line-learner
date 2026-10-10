import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScript } from './script.js';
import { planScene, trimCues, recordSteps, linesOnly, lastSentence, shortDirection } from './plan.js';

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

test('with songs skipped, only the singing is skipped; spoken lines inside a song stay', () => {
  // Thomas, 10 Oct 2026: the dinner scene inside "What a Mother Does" was being left out.
  assert.deepEqual(planSkipping('# S\nMOTHER: Nice.\n[SONG: G]\nTHE OLD MAN: ~ ONE\nTHE OLD MAN: Oh, Peter Pan.\nMOTHER: ~ TWO\nMOTHER: Sit down.\nTHE OLD MAN: Potatoes.\n[END SONG]\nMOTHER: Boys, breakfast!\nTHE OLD MAN: Quiet!\n'),
    ['speak:Nice.', 'speak:G', 'skip:ONE', 'cue:ONE', 'listen:Oh, Peter Pan.', 'skip:TWO', 'speak:Sit down.', 'listen:Potatoes.', 'show:songEnd', 'speak:Boys, breakfast!', 'listen:Quiet!']);
});

test('recordSteps lists the lines a run actually plays, plus his own, once each', () => {
  const items = parseScript('# S\nA: One.\nB: Two.\nA: Three.\nTHE OLD MAN: Mine.\nB: After.\n').scenes[0].items;
  const r = recordSteps(items, 'THE OLD MAN', { skipSongs: true, keep: 2 });
  assert.deepEqual(r.map((s) => `${s.mine ? 'mine' : 'cue'}:${s.item.text}`), ['cue:Two.', 'cue:Three.', 'mine:Mine.']);
});

test('recordSteps includes a skipped sung line read as a cue, but not song titles', () => {
  const items = parseScript('# S\n[SONG: G]\nMOTHER: ~ TWO\n[END SONG]\nTHE OLD MAN: Quiet!\n').scenes[0].items;
  const r = recordSteps(items, 'THE OLD MAN', { skipSongs: true, keep: 3 });
  assert.deepEqual(r.map((s) => `${s.mine ? 'mine' : 'cue'}:${s.item.text}`), ['cue:TWO', 'mine:Quiet!']);
});

test('with songs skipped, spoken lines after the music starts but before the singing are kept', () => {
  // Thomas, 4 Oct 2026: "Get me a crowbar" comes after the song marker but before anyone sings.
  assert.deepEqual(planSkipping('# S\nMOTHER: Fragile.\n[SONG: A]\nTHE OLD MAN: Crowbar.\n(He tips the crate.)\nTHE OLD MAN: ~ HERE\nTHE OLD MAN: Ha!\n[END SONG]\n'),
    ['speak:Fragile.', 'speak:A', 'listen:Crowbar.', 'show:He tips the crate.', 'skip:HERE', 'cue:HERE', 'listen:Ha!', 'show:songEnd']);
});

test('with songs skipped, a line right after the song gets the song\'s last line as its cue', () => {
  assert.deepEqual(planSkipping('# S\n[SONG: G]\nMOTHER: ~ TWO\n[END SONG]\nTHE OLD MAN: Quiet!\n'),
    ['speak:G', 'skip:TWO', 'show:songEnd', 'cue:TWO', 'listen:Quiet!']);
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

// ---------- Lines only ----------
const lines = (text) => linesOnly(parseScript(text).scenes[0].items, 'THE OLD MAN')
  .map((r) => `${r.kind}:${r.kind === 'cue' ? r.who + ':' : ''}${r.text}`);

test('lines only: each of my lines comes after the last sentence of the line before it', () => {
  assert.deepEqual(lines('# S\nMOTHER: Hello, dear. Did you have a good day?\n(She sets a plate.)\nTHE OLD MAN: (sitting) I did till quitting time.\n'),
    ['cue:MOTHER:Did you have a good day?', 'mine:I did till quitting time.']);
});

test('lines only: my lines split only by stage directions stack, with a short note between', () => {
  assert.deepEqual(lines('# S\nMOTHER: Hi.\nTHE OLD MAN: Get away!\n(He enters, dragging his tattered coat behind him across the whole stage.)\nTHE OLD MAN: You will pay!\nTHE OLD MAN: And another thing.\n'),
    ['cue:MOTHER:Hi.', 'mine:Get away!', 'break:He enters, dragging his tattered coat behind him across...', 'mine:You will pay!', 'mine:And another thing.']);
});

test('lines only: a scene I open starts with the stage direction before my first line', () => {
  assert.deepEqual(lines('# S\n(The kitchen.)\n(THE OLD MAN reads the paper.)\nTHE OLD MAN: Ha!\n'),
    ['context:The Old Man reads the paper.', 'mine:Ha!']);
});

test("lines only: no singing, mine or anyone else's; spoken lines inside a song stay", () => {
  assert.deepEqual(lines('# S\n[SONG: M]\nMOTHER: ~ STAINS ON THE RUG\nTHE OLD MAN: More potatoes, dear.\nJEAN: She had not eaten.\nMOTHER: ~ SIT DOWN\nTHE OLD MAN: Jeez.\nTHE OLD MAN: ~ A MAJOR AWARD\nTHE OLD MAN: Ha!\n[END SONG]\n'),
    ['break:after Mother sings', 'mine:More potatoes, dear.', 'break:after Mother sings', 'mine:Jeez.', 'break:after you sing', 'mine:Ha!']);
});

test('lines only: shared lines are mine; made-up word braces and in-line directions are dropped', () => {
  assert.deepEqual(lines('# S\nRANDY: Wow!\nTHE OLD MAN & MOTHER: (together) Merry {Fra-gee-lay}!\n'),
    ['cue:RANDY:Wow!', 'mine:Merry Fra-gee-lay!']);
});

test('lastSentence: keeps the last sentence, marks when it cut, and is not fooled by Mr. or ...', () => {
  assert.deepEqual(lastSentence('Time for supper. I just heard your father pull up.'), { text: 'I just heard your father pull up.', partial: true });
  assert.deepEqual(lastSentence('Ask Mr. Parker.'), { text: 'Ask Mr. Parker.', partial: false });
  assert.deepEqual(lastSentence('Bills ... bills ... bills.'), { text: 'Bills ... bills ... bills.', partial: false });
  assert.deepEqual(lastSentence('Starving people! What?'), { text: 'What?', partial: true });
});

test('shortDirection: first sentence, names in normal case, long ones cut', () => {
  assert.equal(shortDirection('The Parker house. A week later.'), 'The Parker house.');
  assert.equal(shortDirection('RALPHIE and RANDY enter from upstairs.'), 'Ralphie and Randy enter from upstairs.');
  assert.equal(shortDirection('One two three four five six seven eight nine ten eleven.', 8), 'One two three four five six seven eight...');
});
