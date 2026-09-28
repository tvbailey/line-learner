// Line Learner core logic: pure functions, no browser APIs, tested in core.test.js.

const FILLERS = new Set(['uh', 'um', 'er', 'ah', 'hmm']);
const COMMANDS = new Set(['line', 'pause', 'repeat', 'resume']);

// Contractions become their long forms on both sides, so "I'm" and "I am" compare equal.
// "'s" expands only after pronouns and question words, so possessives ("Ranger's") stay put.
const CONTRACTIONS = [
  [/\bcan't\b/g, 'can not'], [/\bwon't\b/g, 'will not'], [/\bain't\b/g, 'is not'],
  [/n't\b/g, ' not'], [/'re\b/g, ' are'], [/'ll\b/g, ' will'], [/'ve\b/g, ' have'],
  [/'d\b/g, ' would'], [/\bi'm\b/g, 'i am'],
  [/\b(it|that|what|there|here|who|where|he|she|how)'s\b/g, '$1 is'], [/\blet's\b/g, 'let us'],
];

// Lowercase, expand contractions, fold leftover apostrophes, turn every other non-letter/digit into a word break.
export function normalize(text) {
  let t = String(text).toLowerCase().replace(/\u2019/g, "'");
  for (const [re, long] of CONTRACTIONS) t = t.replace(re, long);
  return t
    .replace(/'/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Word-by-word comparison of the script line with what was heard (longest common subsequence).
export function compareLine(expected, heard) {
  const a = normalize(expected);
  const b = normalize(heard).filter((w) => !FILLERS.has(w));
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const missing = [];
  const extra = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) missing.push(a[i++]);
    else extra.push(b[j++]);
  }
  while (i < a.length) missing.push(a[i++]);
  while (j < b.length) extra.push(b[j++]);
  const match = missing.length === 0 && extra.length === 0;
  const likelyMishearing = !match && missing.length === extra.length
    && missing.every((w, k) => soundsAlike(w, extra[k]));
  return { match, missing, extra, likelyMishearing };
}

// Rough sound-alike test: small edit distance relative to word length ("edison" / "medicine").
function soundsAlike(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length) >= 0.4;
}

// A command counts only when it is the whole utterance.
export function detectCommand(utterance) {
  const words = normalize(utterance);
  return words.length === 1 && COMMANDS.has(words[0]) ? words[0] : null;
}

// First "line" gives the first four words; the second gives the whole line.
export function promptText(line, level) {
  return level >= 2 ? line : line.split(/\s+/).slice(0, 4).join(' ');
}

// Speech recognition restarts mid-line; join what earlier sessions heard with the current results.
export function assembleTranscript(earlierSessions, currentResults) {
  return [...earlierSessions, ...currentResults.map((r) => r.text)]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
}

// The line is finished once he has said something and then been quiet for the gap.
export function isLineFinished({ heardSomething, lastSpeechAt, now, gapMs }) {
  return heardSomething && now - lastSpeechAt >= gapMs;
}

// Stage directions in parentheses are shown on screen but never spoken or checked.
export function stripDirections(text) {
  return text.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}
