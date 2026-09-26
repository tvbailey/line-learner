// Line Learner core logic: pure functions, no browser APIs, tested in core.test.js.

const FILLERS = new Set(['uh', 'um', 'er', 'ah', 'hmm']);
const COMMANDS = new Set(['line', 'pause', 'repeat', 'resume']);

// Lowercase, fold apostrophes, turn every other non-letter/digit into a word break.
export function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/['’]/g, '')
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
  return { match: missing.length === 0 && extra.length === 0, missing, extra };
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
