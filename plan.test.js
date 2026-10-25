import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScript } from './script.js';
import { planScene, trimCues, recordSteps, linesOnly, lastSentence, shortDirection, includeLines, pickLines, joinMyRuns, addSkipNotes } from './plan.js';

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

test('lines only: a line that is only a direction is a direction, not an empty cue', () => {
  assert.deepEqual(lines('# S\nRALPHIE: Dad, look!\nMOTHER: (gasps)\nTHE OLD MAN: Well!\n'),
    ['cue:RALPHIE:Dad, look!', 'mine:Well!']);
});

test('lines only: a song starting between two of my lines is a break', () => {
  assert.deepEqual(lines('# S\nTHE OLD MAN: Fragile.\n[SONG: #8 A Major Award]\nTHE OLD MAN: Crowbar.\n'),
    ['mine:Fragile.', 'break:song starts: A Major Award', 'mine:Crowbar.']);
});

test('lines only: the opening context is the END of a long direction, where he comes on', () => {
  const long = 'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty. THE OLD MAN storms in from the basement.';
  assert.deepEqual(lines(`# S\n(${long})\nTHE OLD MAN: Ha!\n`),
    ['context:The Old Man storms in from the basement.', 'mine:Ha!']);
});

test('lastSentence: an initial is not the end of a sentence', () => {
  assert.deepEqual(lastSentence('I want a Red Ryder B.B. gun!'), { text: 'I want a Red Ryder B.B. gun!', partial: false });
});

test('shortDirection: two-letter capitals like TV stay as they are', () => {
  assert.equal(shortDirection('THE OLD MAN turns on the TV.'), 'The Old Man turns on the TV.');
});

test('shortDirection: first sentence, names in normal case, long ones cut', () => {
  assert.equal(shortDirection('The Parker house. A week later.'), 'The Parker house.');
  assert.equal(shortDirection('RALPHIE and RANDY enter from upstairs.'), 'Ralphie and Randy enter from upstairs.');
  assert.equal(shortDirection('One two three four five six seven eight nine ten eleven.', 8), 'One two three four five six seven eight...');
});

test('Dialogue only skips everything inside "The Genius on Cleveland Street", spoken lines too (Thomas, 24 Oct 2026)', () => {
  assert.deepEqual(planSkipping('# S\nTHE OLD MAN: Silly?\n[SONG: #4 The Genius on Cleveland Street]\nTHE OLD MAN: ~ WHEELS\nTHE OLD MAN: Wow!\nMOTHER: Frank?\n[END SONG]\nMOTHER: Supper.\nTHE OLD MAN: Quiet!\n'),
    ['listen:Silly?', 'speak:#4 The Genius on Cleveland Street', 'skip:WHEELS', 'skip:Wow!', 'skip:Frank?', 'show:songEnd', 'speak:Supper.', 'listen:Quiet!']);
  // Other songs keep their spoken lines.
  assert.deepEqual(planSkipping('# S\n[SONG: A Major Award]\nTHE OLD MAN: ~ HA\nTHE OLD MAN: Wow!\n[END SONG]\n'),
    ['speak:A Major Award', 'skip:HA', 'cue:HA', 'listen:Wow!', 'show:songEnd']);
});

test('lines only leaves out "The Genius on Cleveland Street" and notes it', () => {
  assert.deepEqual(lines('# S\nTHE OLD MAN: Silly?\n[SONG: #4 The Genius on Cleveland Street]\nTHE OLD MAN: Wow!\n[END SONG]\nMOTHER: Supper.\nTHE OLD MAN: Quiet!\n(He sits.)\nTHE OLD MAN: More.\n'),
    ['mine:Silly?', 'cue:MOTHER:Supper.', 'mine:Quiet!', 'break:He sits.', 'mine:More.']);
  assert.deepEqual(lines('# S\nTHE OLD MAN: Silly?\n[SONG: #4 The Genius on Cleveland Street]\nTHE OLD MAN: Wow!\n[END SONG]\nTHE OLD MAN: Quiet!\n'),
    ['mine:Silly?', 'break:after the song: The Genius on Cleveland Street', 'mine:Quiet!']);
});

test('includeLines: a skipped line he tapped is read after all, once (Thomas, 24 Oct 2026)', () => {
  const items = parseScript('# S\nA: one\nB: two\nA: three\nB: four\nTHE OLD MAN: Mine.\n').scenes[0].items;
  const steps = trimCues(planScene(items, 'THE OLD MAN'), 2);
  const one = items[0].id;
  assert.deepEqual(includeLines(steps, new Set([one]), 'THE OLD MAN').map((s) => `${s.action}:${s.item.text}`),
    ['speak:one', 'skip:two', 'speak:three', 'speak:four', 'listen:Mine.']);
  assert.equal(includeLines(steps, new Set([one]), 'THE OLD MAN')[0].included, true);
});

test('includeLines: an included sung line is not read twice as the cue', () => {
  const items = parseScript('# S\n[SONG: G]\nMOTHER: ~ LA\n[END SONG]\nTHE OLD MAN: Hi.\n').scenes[0].items;
  const sung = items[1].id;
  assert.deepEqual(includeLines(planScene(items, 'THE OLD MAN', { skipSongs: true }), new Set([sung]), 'THE OLD MAN').map((s) => `${s.action}:${s.item.text || s.item.kind}`),
    ['speak:song', 'speak:LA', 'show:songEnd', 'listen:Hi.']);
});

test('pickLines: one of his lines tapped out is skipped, and so are the cues that only led to it (Thomas, 24 Oct 2026)', () => {
  const items = parseScript('# S\nA: one\nTHE OLD MAN: Keep.\nB: two\nTHE OLD MAN: Drop me.\nC: three\nTHE OLD MAN: Last.\n').scenes[0].items;
  const drop = items[3].id;
  const out = pickLines(planScene(items, 'THE OLD MAN'), new Map([[drop, 'out']]), 'THE OLD MAN', 1);
  assert.deepEqual(out.map((s) => `${s.action}:${s.item.text}`), ['speak:one', 'listen:Keep.', 'skip:two', 'skip:Drop me.', 'speak:three', 'listen:Last.']);
  assert.equal(out[3].excluded, true);
});

test('pickLines: a line tapped in is read; tapped out, a cue line is not', () => {
  const items = parseScript('# S\nA: one\nB: two\nTHE OLD MAN: Mine.\n').scenes[0].items;
  const picks = new Map([[items[0].id, 'in'], [items[1].id, 'out']]);
  assert.deepEqual(pickLines(planScene(items, 'THE OLD MAN'), picks, 'THE OLD MAN', 1).map((s) => `${s.action}:${s.item.text}`),
    ['speak:one', 'skip:two', 'listen:Mine.']);
});

test('lines only leaves out his lines he tapped out', () => {
  const items = parseScript('# S\nMOTHER: Hi.\nTHE OLD MAN: Keep.\nTHE OLD MAN: Drop me.\nMOTHER: So?\nTHE OLD MAN: Last.\n').scenes[0].items;
  assert.deepEqual(linesOnly(items, 'THE OLD MAN', new Set([items[2].id])).map((r) => `${r.kind}:${r.text}`),
    ['cue:Hi.', 'mine:Keep.', 'cue:So?', 'mine:Last.']);
});

test('joinMyRuns: his lines split only by stage directions become one line to say (Thomas, 24 Oct 2026)', () => {
  const items = parseScript('# S\nMOTHER: The furnace.\nTHE OLD MAN: Consarned!\n(He storms off.)\nTHE OLD MAN: Far-fangled!\n(Crash.)\nTHE OLD MAN: Who left the skates?\nMOTHER: Me.\nTHE OLD MAN: Hmph.\n').scenes[0].items;
  const out = joinMyRuns(planScene(items, 'THE OLD MAN'), 'THE OLD MAN');
  assert.deepEqual(out.map((s) => `${s.action}:${s.item.text}`),
    ['speak:The furnace.', 'listen:Consarned! (He storms off.) Far-fangled! (Crash.) Who left the skates?', 'speak:Me.', 'listen:Hmph.']);
  assert.equal(out[1].item.id, items[1].id);
  assert.deepEqual(out[1].item.joined, [items[1].id, items[3].id, items[5].id]);
});

test('joinMyRuns: a cue, a song marker, or a sung line between keeps them apart', () => {
  const items = parseScript('# S\nTHE OLD MAN: One.\n[SONG: G]\nTHE OLD MAN: Two.\nTHE OLD MAN: ~ LA\nTHE OLD MAN: Three.\n').scenes[0].items;
  assert.deepEqual(joinMyRuns(planScene(items, 'THE OLD MAN'), 'THE OLD MAN').filter((s) => s.action === 'listen').map((s) => s.item.text),
    ['One.', 'Two.', 'LA', 'Three.']);
});

test('addSkipNotes: when a run skips two or more lines after a summary, the summary is said first (Thomas, 24 Oct 2026)', () => {
  const items = parseScript('# S\nTHE OLD MAN: Hi.\n[SKIPPED: Mother sings and the boys argue.]\nA: one\nB: two\nA: three\nB: four\nTHE OLD MAN: Bye.\n').scenes[0].items;
  const out = addSkipNotes(trimCues(planScene(items, 'THE OLD MAN'), 2));
  assert.deepEqual(out.map((s) => `${s.action}:${s.item.text}`),
    ['listen:Hi.', 'show:Mother sings and the boys argue.', 'skip:one', 'skip:two', 'note:Mother sings and the boys argue.', 'speak:three', 'speak:four', 'listen:Bye.']);
});

test('addSkipNotes: nothing is said when the stretch is read, or only one line is skipped, or the scene just ends', () => {
  const items = parseScript('# S\nTHE OLD MAN: Hi.\n[SKIPPED: A note.]\nA: one\nB: two\nTHE OLD MAN: Bye.\n[SKIPPED: End note.]\nA: x\nB: y\nA: z\n').scenes[0].items;
  assert.equal(addSkipNotes(trimCues(planScene(items, 'THE OLD MAN'), 1)).filter((s) => s.action === 'note').length, 0);
  assert.equal(addSkipNotes(trimCues(planScene(items, 'THE OLD MAN'), 0)).filter((s) => s.action === 'note').length, 0);
});

test('addSkipNotes: a line he kept in the middle of a stretch does not cancel its summary', () => {
  const items = parseScript('# S\nTHE OLD MAN: Hi.\n[SKIPPED: The family eats.]\nA: kept\nB: two\nA: three\nB: four\nA: five\nTHE OLD MAN: Bye.\n').scenes[0].items;
  const picks = new Map([[items[2].id, 'in']]);
  const out = addSkipNotes(pickLines(planScene(items, 'THE OLD MAN'), picks, 'THE OLD MAN', 1));
  assert.deepEqual(out.filter((s) => s.action !== 'show').map((s) => `${s.action}:${s.item.text}`),
    ['listen:Hi.', 'speak:kept', 'skip:two', 'skip:three', 'skip:four', 'note:The family eats.', 'speak:five', 'listen:Bye.']);
});

test('pickLines: a song announcement tapped out is not said; tapped back in after trimming, it is (Thomas, 25 Oct 2026)', () => {
  const items = parseScript('# S\nA: one\n[SONG: Tune]\nB: two\nTHE OLD MAN: Mine.\n[END SONG]\n').scenes[0].items;
  const song = items[1].id;
  const steps = planScene(items, 'THE OLD MAN', { skipSongs: true });
  const show = (s) => s.map((x) => `${x.action}:${x.item.text || x.item.title || x.item.kind}`);
  assert.deepEqual(show(pickLines(steps, new Map([[song, 'out']]), 'THE OLD MAN', 0)), ['speak:one', 'skip:Tune', 'speak:two', 'listen:Mine.', 'show:songEnd']);
  // "Read before 1" trims the announcement away; tapping it in brings it back.
  assert.deepEqual(show(pickLines(steps, new Map(), 'THE OLD MAN', 1)), ['skip:one', 'skip:Tune', 'speak:two', 'listen:Mine.', 'show:songEnd']);
  assert.deepEqual(show(pickLines(steps, new Map([[song, 'in']]), 'THE OLD MAN', 1)), ['skip:one', 'speak:Tune', 'speak:two', 'listen:Mine.', 'show:songEnd']);
});

test('recordSteps follows his picks: a sung line tapped in can be recorded (Fable\'s review, 25 Oct 2026)', () => {
  const items = parseScript('# S\n[SONG: Tune]\nMOTHER: ~LA LA\nB: two\nTHE OLD MAN: Mine.\n[END SONG]\n').scenes[0].items;
  const ids = (picks) => recordSteps(items, 'THE OLD MAN', { skipSongs: true, keep: 0, picks }).map((r) => r.item.text);
  assert.deepEqual(ids(new Map()), ['two', 'Mine.']);
  assert.deepEqual(ids(new Map([[items[1].id, 'in']])), ['LA LA', 'two', 'Mine.']);
  assert.deepEqual(ids(new Map([[items[2].id, 'out']])), ['Mine.']);
});
