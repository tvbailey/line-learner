import { stripDirections, cleanText } from './core.js?v=20261025d';
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

// Songs skipped whole under "Dialogue only", spoken lines too: he learns those in the song's own
// rehearsal (Thomas, 24 Oct 2026, for this song only, until he has judged the others).
const SKIP_WHOLE = [/genius on cleveland street/i];
export const skippedWhole = (song) => SKIP_WHOLE.some((re) => re.test(song.title));

export function planScene(items, me, { skipSongs = false } = {}) {
  const steps = [];
  let sungLeft = SUNG_TO_PRACTICE;
  let lastSkipped = null;
  let whole = false;
  const listen = (item) => {
    if (lastSkipped) { steps.push({ action: 'cue', item: lastSkipped }); lastSkipped = null; }
    steps.push({ action: 'listen', item });
  };
  for (const item of items) {
    if (item.kind === 'song') { steps.push({ action: 'speak', item }); sungLeft = SUNG_TO_PRACTICE; lastSkipped = null; whole = skipSongs && skippedWhole(item); continue; }
    if (item.kind === 'songEnd') whole = false;
    if (item.kind !== 'line') { steps.push({ action: 'show', item }); continue; }
    if (whole || (skipSongs && item.sung)) { steps.push({ action: 'skip', item }); lastSkipped = item; continue; }
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
export function linesOnly(items, me, left = new Set()) {
  const out = [];
  let started = false;   // one of his lines has been shown
  let last = null;       // the last line anyone said or sang since his last spoken line
  let dir = null;        // the last stage direction since then
  let song = null;       // a song that started since then
  let whole = null;      // inside a song left out whole (SKIP_WHOLE): its name
  let after = null;      // such a song just ended: its name
  for (const it of items) {
    if (whole) {
      if (it.kind === 'songEnd') { after = whole; whole = null; last = null; dir = null; song = null; }
      continue;
    }
    if (it.kind === 'direction') { dir = it.text; continue; }
    if (it.kind === 'song') {
      if (skippedWhole(it)) { whole = it.title.replace(/^#\S+\s*/, ''); continue; }
      song = it.title.replace(/^#\S+\s*/, ''); continue;
    }
    if (it.kind !== 'line') continue;
    // "MOTHER: (gasps)" has no words to hear; it works like a stage direction.
    if (!plainLine(it.text)) { dir = it.text; continue; }
    if (it.sung || !isMine(it, me)) { last = it; continue; }
    if (left.has(it.id)) continue; // one of his he tapped out of the scene
    if (last && !last.sung && !isMine(last, me)) {
      out.push({ kind: 'cue', who: last.who, ...lastSentence(last.text) });
    } else if (after) {
      out.push({ kind: 'break', text: `after the song: ${after}` });
    } else if (last && last.sung) {
      // "Kids" and "Ralphie & The Parkers" sing; "Mother" sings.
      const many = /[&,]/.test(last.who) || /S$/.test(last.who);
      out.push({ kind: 'break', text: isMine(last, me) ? 'after you sing' : `after ${nameCase(last.who)} ${many ? 'sing' : 'sings'}` });
    } else if (song && started) {
      out.push({ kind: 'break', text: `song starts: ${song}` });
    } else if (dir && !started) {
      out.push({ kind: 'context', text: directionEnd(dir, 25) });
    } else if (dir) {
      out.push({ kind: 'break', text: shortDirection(dir) });
    }
    out.push({ kind: 'mine', id: it.id, who: it.who, text: plainLine(it.text) });
    started = true;
    last = null;
    dir = null;
    song = null;
    after = null;
  }
  return out;
}

// The words to say: no in-line directions, no made-up-word braces.
const plainLine = (text) => cleanText(stripDirections(text));

// "THE OLD MAN" -> "The Old Man"; leaves ordinary words and two-letter capitals (TV, OK) alone.
const nameCase = (s) => s.replace(/\b[A-Z][A-Z']{2,}\b/g, (w) => w[0] + w.slice(1).toLowerCase());

// Sentences end at . ! or ? followed by a space; an ellipsis, an initial ("B.B.") and titles
// like "Mr." don't count.
const ABBREV = /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|[A-Z])\./g;
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
export function shortDirection(text, max = 9) {
  let s = stripDirections(text);
  s = nameCase(sentences(s)[0] || s);
  const words = s.split(/\s+/);
  return words.length > max ? words.slice(0, max).join(' ').replace(/[,;:]$/, '') + '...' : s;
}

// The end of a stage direction, where it brings him on: whole sentences from the end, up to
// `max` words; a single longer sentence keeps its last `max` words.
function directionEnd(text, max) {
  const all = sentences(nameCase(stripDirections(text)));
  let out = [];
  for (let i = all.length - 1; i >= 0; i--) {
    const next = [all[i], ...out];
    if (out.length && next.join(' ').split(/\s+/).length > max) break;
    out = next;
  }
  const words = out.join(' ').split(/\s+/);
  return words.length > max ? '...' + words.slice(-max).join(' ') : out.join(' ');
}

// Lines he tapped in the script view to bring into a run (Thomas, 24 Oct 2026: "That's nice,
// dear" was trimmed away). A skipped line of someone else's is read; one of his is listened for.
// An included line isn't read a second time as the cue.
export function includeLines(steps, ids, me) {
  if (!ids.size) return steps;
  return steps
    .filter((st) => !(st.action === 'cue' && ids.has(st.item.id)))
    .map((st) => (st.action === 'skip' && st.item.kind === 'line' && ids.has(st.item.id)
      ? { ...st, action: isMine(st.item, me) ? 'listen' : 'speak', included: true } : st));
}

// His own choices per line, tapped in the script view (Thomas, 24 Oct 2026: "customize each
// scene ... and I don't have to come back and ask you"). `picks` maps a line id to 'in' or 'out'.
// A line tapped out is skipped before the "Read before" trimming, so cues that only led up to a
// line of his he left out drop away too; a line tapped in is read (or listened for) after it.
export function pickLines(steps, picks, me, keep) {
  const out = (id) => picks.get(id) === 'out';
  const trimmed = trimCues(steps
    .filter((st) => !(st.action === 'cue' && out(st.item.id)))
    .map((st) => (st.item.kind === 'line' && out(st.item.id) ? { ...st, action: 'skip', excluded: true } : st)), keep);
  return includeLines(trimmed, new Set([...picks].filter(([, v]) => v === 'in').map(([k]) => k)), me);
}

// His lines with only stage directions between them are one stretch to say (Thomas, 24 Oct 2026:
// three lines after "I think it was the furnace" each waited for a pause). The run listens for the
// whole stretch as one line, under the first line's id; the directions stay in it, in parentheses,
// where the checker ignores them. Anything else between (a cue, a song marker, singing) splits it.
export function joinMyRuns(steps, me) {
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    if (st.action !== 'listen' || st.item.sung || !isMine(st.item, me)) { out.push(st); continue; }
    let text = st.item.text;
    const joined = [st.item.id];
    let j = i + 1;
    for (;;) {
      let k = j;
      const dirs = [];
      while (k < steps.length && steps[k].action === 'show' && steps[k].item.kind === 'direction') dirs.push(steps[k++].item.text);
      const next = steps[k];
      if (!next || next.action !== 'listen' || next.item.sung || !isMine(next.item, me)) break;
      text += dirs.map((d) => ` (${d})`).join('') + ' ' + next.item.text;
      joined.push(next.item.id);
      j = k + 1;
    }
    if (joined.length === 1) { out.push(st); continue; }
    out.push({ ...st, item: { ...st.item, text, joined } });
    i = j - 1;
  }
  return out;
}

// "Skipping ahead" notes (Thomas, 24 Oct 2026): when a run skips two or more lines right after a
// [SKIPPED: ...] summary, the summary is said before the run picks up again. Nothing is said when
// the stretch is read, when one line is skipped, or when the scene simply ends.
export function addSkipNotes(steps) {
  const out = [];
  let pending = [];  // summaries not yet said
  let skipped = 0;   // lines skipped since the last line read or listened for
  for (const st of steps) {
    if (st.item.kind === 'summary') { pending.push(st.item.text); out.push(st); continue; }
    if (st.item.kind === 'line' && st.action === 'skip') { skipped++; out.push(st); continue; }
    if (st.item.kind === 'line') {
      if (pending.length && skipped >= 2) {
        // Several stacked up (a whole song skipped): the first and the last, so it stays short.
        const said = pending.length > 2 ? [pending[0], pending[pending.length - 1]] : pending;
        out.push({ action: 'note', item: { kind: 'summary', text: said.join(' ') } });
        pending = [];
      }
      skipped = 0;
      // Someone else's kept line leaves the summary waiting (his picks keep single lines inside
      // skipped stretches, 24 Oct 2026); one of his own lines closes the stretch.
      if (st.action === 'listen') pending = [];
    }
    out.push(st);
  }
  return out;
}
