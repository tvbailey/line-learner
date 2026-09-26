import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScript } from './script.js';

const SAMPLE = `@version 2026-09-26
# Act 1, Scene 3: The Furnace
MOTHER: Dinner is ready.
OLD MAN: Not now, I am fighting the furnace.
(He kicks the furnace.)
[SONG: A Man of Action]
OLD MAN: A man of action never waits around.
[SKIP TO END OF SONG]
[END SONG]
MOTHER: Very nice.

# Act 1, Scene 4: The Leg Lamp
OLD MAN: It's here!
`;

test('parseScript reads the version and splits scenes by heading', () => {
  const s = parseScript(SAMPLE);
  assert.equal(s.version, '2026-09-26');
  assert.deepEqual(s.scenes.map((x) => x.title), ['Act 1, Scene 3: The Furnace', 'Act 1, Scene 4: The Leg Lamp']);
});

test('parseScript reads speaker lines with speaker and text', () => {
  const first = parseScript(SAMPLE).scenes[0].items[0];
  assert.equal(first.kind, 'line');
  assert.equal(first.who, 'MOTHER');
  assert.equal(first.text, 'Dinner is ready.');
});

test('parseScript keeps a stage direction as its own item, never a line', () => {
  const items = parseScript(SAMPLE).scenes[0].items;
  assert.deepEqual(items[2], { kind: 'direction', text: 'He kicks the furnace.' });
});

test('parseScript reads song start, skip and end markers', () => {
  const kinds = parseScript(SAMPLE).scenes[0].items.map((i) => i.kind);
  assert.deepEqual(kinds, ['line', 'line', 'direction', 'song', 'line', 'skip', 'songEnd', 'line']);
  assert.equal(parseScript(SAMPLE).scenes[0].items[3].title, 'A Man of Action');
});

test('each spoken line gets a stable id from its scene and its words', () => {
  const a = parseScript(SAMPLE).scenes[0].items[1].id;
  const edited = SAMPLE.replace('MOTHER: Dinner is ready.', 'MOTHER: Dinner is ready, dear.');
  const b = parseScript(edited).scenes[0].items[1].id;
  assert.ok(a, 'line has an id');
  assert.equal(a, b, 'editing a different line does not change this line\'s id');
});

test('parseScript reports a line it cannot read, with its line number', () => {
  assert.throws(() => parseScript('# Scene\nthis has no speaker\n'), /line 2/);
});
