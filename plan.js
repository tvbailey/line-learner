import { stripDirections, cleanText } from './core.js?v=20261010a';
// Turns a scene's items into practice steps for one role:
//   speak  - the phone reads it (someone else's spoken line, a song title)
//   listen - the actor says it
//   show   - on screen only (stage directions, song markers)
//   skip   - sung lines not being practiced
//   cue    - the last skipped sung line, read aloud right before the actor's next line
// Songs follow the "lead-in only" rule: after a song starts or after one of the actor's
// spoken lines, the next SUNG_TO_PRACTICE of the actor's sung lines are practiced.
// With { skipSongs: true } every sung line is skipped; spoken lines inside a song are dialogue and
// stay (Thomas, 4 and 10 Oct 2026: the crowbar line, the dinner inside "What a Mother Does").
const SUNG_TO_PRACTICE = 2;

// "THE OLD MAN & MOTHER" counts as his; "THE OLD MANAGER" doesn't.
export const isMine = (item, me) => item.who.split(/\s*(?:&|,)\s*/).includes(me);

export function planScene(items, me, { skipSongs = false } = {}) {
  const steps = [];
  let sungLeft = SUNG_TO_PRACTICE;
  let lastSkipped = null;
  const listen = (item) => {
    if (lastSkipped) { steps.push({ action: 'cue', item: lastSkipped }); lastSkipped = null; }
    steps.push({ action: 'listen', item });
  };
  for (const item of items) {
    if (item.kind === 'song') { steps.push({ action: 'speak', item }); sungLeft = SUNG_TO_PRACTICE; lastSkipped = null; continue; }
    if (item.kind !== 'line') { steps.push({ action: 'show', item }); continue; }
    if (skipSongs && item.sung) { steps.push({ action: 'skip', item }); lastSkipped = item; continue; }
    const mine = isMine(item, me);
    if (mine && !item.sung) { listen(item); sungLeft = SUNG_TO_PRACTICE; continue; }
    if (mine && item.sung && sungLeft > 0) { listen(item); sungLeft--; continue; }
    if (item.sung) { steps.push({ action: 'skip', item }); lastSkipped = item; continue; }
    steps.push({ action: 'speak', item });
    lastSkipped = null;
  }
  return steps;
}


// Record mode: the lines worth recording at these settings, in order and once each. That's every
// line a run would read aloud (including a skipped sung line read as a cue), plus his own lines.
export function recordSteps(items, me, { skipSongs = false, keep = 0 } = {}) {
  const out = [];
  const seen = new Set();
  for (const st of trimCues(planScene(items, me, { skipSongs }), keep)) {
    if (st.item.kind !== 'line' || seen.has(st.item.id)) continue;
    if (st.action !== 'speak' && st.action !== 'cue' && st.action !== 'listen') continue;
    seen.add(st.item.id);
    out.push({ item: st.item, mine: st.action === 'listen' });
  }
  return out;
}

// Jump ahead: of the lines read aloud before each of the actor's lines, keep only the last
// `keep` (0 keeps everything). Lines after his last line are skipped.
export function trimCues(steps, keep) {
  if (!keep) return steps;
  const out = steps.slice();
  let heard = keep;
  for (let i = out.length - 1; i >= 0; i--) {
    const st = out[i];
    if (st.action === 'listen') { heard = 0; continue; }
    if (st.action !== 'speak' && st.action !== 'cue') continue;
    if (heard >= keep) out[i] = { ...st, action: 'skip' };
    else heard++;
  }
  return out;
}

// ---------- Lines only ----------
// A bare list of his spoken lines, for drilling the words before running the scene (Thomas,
// 10 Oct 2026). Each line comes after one short row:
//   cue     - the last sentence of the line before his, when someone else spoke it
//   break   - a short note when only stage directions (or singing) came between
//   context - the stage direction before his first line, when he opens the scene
// Sung lines never appear, his or anyone else's; spoken lines inside songs do.
export function linesOnly(items, me) {
  const out = [];
  let started = false;   // one of his lines has been shown
  let last = null;       // the last line anyone said or sang since his last spoken line
  let dir = null;        // the last stage direction since then
  for (const it of items) {
    if (it.kind === 'direction') { dir = it.text; continue; }
    if (it.kind !== 'line') continue;
    if (it.sung || !isMine(it, me)) { last = it; continue; }
    if (last && !last.sung && !isMine(last, me)) {
      out.push({ kind: 'cue', who: last.who, ...lastSentence(last.text) });
    } else if (last && last.sung) {
      out.push({ kind: 'break', text: isMine(last, me) ? 'after you sing' : `after ${nameCase(last.who)} sings` });
    } else if (dir && !started) {
      out.push({ kind: 'context', text: shortDirection(dir, 25, false) });
    } else if (dir) {
      out.push({ kind: 'break', text: shortDirection(dir) });
    }
    out.push({ kind: 'mine', id: it.id, who: it.who, text: plainLine(it.text) });
    started = true;
    last = null;
    dir = null;
  }
  return out;
}

// The words to say: no in-line directions, no made-up-word braces.
const plainLine = (text) => cleanText(stripDirections(text));

// "THE OLD MAN" -> "The Old Man"; leaves ordinary words alone.
const nameCase = (s) => s.replace(/\b[A-Z][A-Z']+\b/g, (w) => w[0] + w.slice(1).toLowerCase());

// Sentences end at . ! or ? followed by a space; an ellipsis and titles like "Mr." don't count.
const ABBREV = /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr)\./g;
function sentences(text) {
  const guarded = text.replace(ABBREV, '$1\u0001').replace(/\.\.\./g, '\u0002');
  return guarded.split(/(?<=[.!?]["')]?)\s+/).map((s) => s.replace(/\u0001/g, '.').replace(/\u0002/g, '...').trim()).filter(Boolean);
}

export function lastSentence(text) {
  const all = sentences(plainLine(text));
  return { text: all[all.length - 1] || '', partial: all.length > 1 };
}

// A stage direction cut down to a quick signal: its first sentence (or all of it), names in
// normal case, at most `max` words.
export function shortDirection(text, max = 9, firstOnly = true) {
  let s = stripDirections(text);
  if (firstOnly) s = sentences(s)[0] || s;
  s = nameCase(s);
  const words = s.split(/\s+/);
  return words.length > max ? words.slice(0, max).join(' ').replace(/[,;:]$/, '') + '...' : s;
}
