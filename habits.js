// Phone habits: words the on-phone listener reliably hears wrong when Thomas says a line right
// ("hill release" for "hillbillies"). He teaches one by tapping "I said it right" on a line, or
// "That's the phone" after recording his own line. A habit belongs to one line and one spot in it
// (the script words on either side), and only a swap is ever learned, never a dropped or added
// word, so a habit can't cover a word he actually left out.
import { normalize, canonWord, isFiller, soundsClose, cleanText, stripDirections } from './core.js?v=20261007e';

const words = (text) => normalize(text).filter((w) => !isFiller(w));
const same = (a, b) => canonWord(a) === canonWord(b);

// Where what was heard differs from the script: each stretch between words that line up, with the
// script words on either side of it ('' at the start or end of the line).
export function diffSpans(expected, heard) {
  const a = words(cleanText(stripDirections(expected)));
  const b = words(heard);
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = same(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const spans = [];
  let i = 0, j = 0, lastA = -1;
  let written = [], got = [];
  const close = (nextA) => {
    if (written.length || got.length) spans.push({ before: lastA >= 0 ? a[lastA] : '', written, heard: got, after: nextA < a.length ? a[nextA] : '' });
    written = []; got = [];
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && same(a[i], b[j])) { close(i); lastA = i; i++; j++; }
    else if (j >= b.length || (i < a.length && dp[i + 1][j] >= dp[i][j + 1])) { written.push(a[i]); i++; }
    else { got.push(b[j]); j++; }
  }
  close(a.length);
  return spans;
}

// Words whose swap changes what the line means, so a swap involving one is never learned.
const MEANING = new Set(['not', 'no', 'never', 'nor', 'none', 'nothing', 'nobody', 'neither', 'cannot',
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty',
  'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'first',
  'second', 'third', 'half', 'once', 'twice']);
const changesMeaning = (w) => MEANING.has(w) || /\d/.test(w);

// Only short swaps that sound like the script words can be learned: a phone habit is a
// mishearing, so a dropped or added word, a long stretch, a swap that sounds different
// ("blue" for "the red"), or one touching a negation or a number is more likely a real mistake.
// Sol's build review, 7 Oct 2026.
export function learnable(spans) {
  return spans.filter((s) => s.written.length >= 1 && s.heard.length >= 1 && s.written.length <= 3 && s.heard.length <= 4
    && !s.written.some(changesMeaning) && !s.heard.some(changesMeaning)
    && soundsClose(s.written.join(' '), s.heard.join(' ')));
}

// What was heard, with each learned habit turned back into the script's words where it occurs in
// its own spot. `used` counts the habits applied.
export function applyHabits(expected, heard, habits) {
  const h = words(heard);
  let used = 0;
  for (const habit of habits || []) {
    const n = habit.heard.length;
    for (let p = 0; p + n <= h.length; p++) {
      if (!habit.heard.every((w, k) => same(w, h[p + k]))) continue;
      const beforeOk = habit.before === '' ? p === 0 : p > 0 && same(h[p - 1], habit.before);
      const afterOk = habit.after === '' ? p + n === h.length : p + n < h.length && same(h[p + n], habit.after);
      if (!beforeOk || !afterOk) continue;
      h.splice(p, n, ...habit.written);
      used++;
      break;
    }
  }
  return { text: h.join(' '), used };
}
