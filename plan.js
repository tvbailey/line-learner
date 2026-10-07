// Turns a scene's items into practice steps for one role:
//   speak  - the phone reads it (someone else's spoken line, a song title)
//   listen - the actor says it
//   show   - on screen only (stage directions, song markers)
//   skip   - sung lines not being practiced
//   cue    - the last skipped sung line, read aloud right before the actor's next line
// Songs follow the "lead-in only" rule: after a song starts or after one of the actor's
// spoken lines, the next SUNG_TO_PRACTICE of the actor's sung lines are practiced.
// With { skipSongs: true } everything from a song's first sung line to [END SONG] is skipped,
// spoken lines too; lines spoken after [SONG] but before anyone sings are kept.
const SUNG_TO_PRACTICE = 2;

export function planScene(items, me, { skipSongs = false } = {}) {
  const steps = [];
  let sungLeft = SUNG_TO_PRACTICE;
  let lastSkipped = null;
  let inSong = false;
  let songMarked = false;
  const listen = (item) => {
    if (lastSkipped) { steps.push({ action: 'cue', item: lastSkipped }); lastSkipped = null; }
    steps.push({ action: 'listen', item });
  };
  for (const item of items) {
    if (item.kind === 'song') { steps.push({ action: 'speak', item }); sungLeft = SUNG_TO_PRACTICE; lastSkipped = null; songMarked = true; continue; }
    if (item.kind === 'songEnd') { inSong = false; songMarked = false; }
    if (item.kind !== 'line') { steps.push({ action: 'show', item }); continue; }
    // The skipping starts with the first sung line: lines spoken over the music's intro are dialogue.
    if (songMarked && item.sung) inSong = true;
    if (skipSongs && inSong) { steps.push({ action: 'skip', item }); lastSkipped = item; continue; }
    const mine = item.who.split(/\s*(?:&|,)\s*/).includes(me); // "THE OLD MAN & MOTHER" counts as mine
    if (mine && !item.sung) { listen(item); sungLeft = SUNG_TO_PRACTICE; continue; }
    if (mine && item.sung && sungLeft > 0) { listen(item); sungLeft--; continue; }
    if (item.sung) { steps.push({ action: 'skip', item }); lastSkipped = item; continue; }
    steps.push({ action: 'speak', item });
    lastSkipped = null;
  }
  return steps;
}

// The made-up-words drill: only the actor's lines holding {made-up} words, each preceded by
// the line just before it in the scene, read as the cue.
export function drillSteps(steps) {
  const out = [];
  steps.forEach((st, i) => {
    if (st.action !== 'listen' || !st.item.text.includes('{')) return;
    for (let k = i - 1; k >= 0; k--) {
      if (steps[k].item.kind === 'line') { out.push({ action: 'cue', item: steps[k].item }); break; }
    }
    out.push(st);
  });
  return out;
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
