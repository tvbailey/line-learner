// Turns a scene's items into practice steps for one role:
//   speak  - the phone reads it (someone else's spoken line, a song title)
//   listen - the actor says it
//   show   - on screen only (stage directions, song markers)
//   skip   - sung lines not being practiced
//   cue    - the last skipped sung line, read aloud right before the actor's next line
// Songs follow the "lead-in only" rule: after a song starts or after one of the actor's
// spoken lines, the next SUNG_TO_PRACTICE of the actor's sung lines are practiced.
const SUNG_TO_PRACTICE = 2;

export function planScene(items, me) {
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
    const mine = item.who === me;
    if (mine && !item.sung) { listen(item); sungLeft = SUNG_TO_PRACTICE; continue; }
    if (mine && item.sung && sungLeft > 0) { listen(item); sungLeft--; continue; }
    if (item.sung) { steps.push({ action: 'skip', item }); lastSkipped = item; continue; }
    steps.push({ action: 'speak', item });
    lastSkipped = null;
  }
  return steps;
}
