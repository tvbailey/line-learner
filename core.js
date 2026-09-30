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
// Made-up words in {braces} ("{goobly-degooking}") cannot be spelled by speech recognition, so
// they are checked by sound instead: the heard words in their place must sound close. Each one
// comes back in `madeUp` (written vs heard) so the actor can judge it himself; one that does not
// sound close sets `checkMadeUp`. A false start ("how did you, how did you know that") counts as
// right when the corrected attempt matches, and is marked restarted.
export function compareLine(expected, heard) {
  const parts = splitMadeUp(expected).map((p) => (p.madeUp ? p : { word: canon(p.word) }));
  const real = parts.filter((p) => !p.madeUp).map((p) => p.word);
  const b = fixRunTogether(normalize(heard).filter((w) => !FILLERS.has(w)).map(canon), real);
  let result = { ...alignLine(parts, b), restarted: false };
  if (!result.match) {
    for (const candidate of restartCandidates(b)) {
      const r = alignLine(parts, candidate);
      if (r.match) { result = { ...r, restarted: true }; break; }
    }
  }
  const { match, missing, extra } = result;
  // Word for word ("medicine" for "Edison"), or a short run heard as a different number of
  // words that sounds the same ("made you" for "mangy").
  const likelyMishearing = !match && !result.checkMadeUp && missing.length > 0 && extra.length > 0
    && ((missing.length === extra.length && missing.every((w, k) => soundsAlike(w, extra[k])))
      || (missing.length <= 3 && extra.length <= 3 && soundKeysClose(missing.join(' '), extra.join(' '))));
  return { ...result, likelyMishearing };
}

// Words that sound the same but are spelled differently: speech recognition picks one
// spelling, the script may use another ("Shoo" heard as "shoe", "'em" heard as "him").
const SAME_SOUND = [
  ['shoo', 'shoe'], ['em', 'him', 'them'], ['to', 'too', 'two'], ['for', 'four', 'fore'],
  ['their', 'there'], ['know', 'no'], ['one', 'won'], ['right', 'write'], ['hear', 'here'],
  ['ate', 'eight'], ['by', 'buy', 'bye'], ['see', 'sea'], ['whole', 'hole'], ['wear', 'where'],
  ['weather', 'whether'], ['ok', 'okay'], ['mr', 'mister'], ['yeah', 'yea'],
];
const CANON = new Map();
for (const group of SAME_SOUND) for (const w of group) CANON.set(w, group[0]);
function canon(w) { return CANON.get(w) || w; }

// "getaway" for "get away", "cracker jack" for "crackerjack": split or join heard words so
// they line up with the script's words.
function fixRunTogether(b, real) {
  const known = new Set(real);
  const pairs = new Map();
  for (let i = 0; i + 1 < real.length; i++) pairs.set(real[i] + real[i + 1], [real[i], real[i + 1]]);
  const out = [];
  for (let j = 0; j < b.length; j++) {
    const w = b[j];
    if (!known.has(w) && pairs.has(w)) out.push(...pairs.get(w));
    else if (!known.has(w) && j + 1 < b.length && known.has(w + b[j + 1])) { out.push(w + b[j + 1]); j++; }
    else out.push(w);
  }
  return out;
}

// The line as a list of real words and made-up spans; neighboring made-up spans are merged.
function splitMadeUp(text) {
  const parts = [];
  for (const piece of text.split(/(\{[^}]*\})/)) {
    if (piece.startsWith('{')) {
      const written = piece.slice(1, -1).trim();
      const last = parts[parts.length - 1];
      if (last && last.madeUp) last.written += ' ' + written;
      else parts.push({ madeUp: true, written });
    } else {
      for (const w of normalize(piece)) parts.push({ word: w });
    }
  }
  return parts;
}

function alignLine(parts, b) {
  const a = parts.filter((p) => !p.madeUp).map((p) => p.word);
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matchedJ = new Array(a.length).fill(-1);
  const usedJ = new Set();
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { matchedJ[i] = j; usedJ.add(j); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const missing = a.filter((_, i) => matchedJ[i] < 0);
  const madeUp = [];
  let realBefore = 0;
  for (const p of parts) {
    if (!p.madeUp) { realBefore++; continue; }
    let left = -1;
    for (let i = realBefore - 1; i >= 0; i--) if (matchedJ[i] >= 0) { left = matchedJ[i]; break; }
    let right = b.length;
    for (let i = realBefore; i < a.length; i++) if (matchedJ[i] >= 0) { right = matchedJ[i]; break; }
    const words = [];
    for (let j = left + 1; j < right; j++) if (!usedJ.has(j)) { words.push(b[j]); usedJ.add(j); }
    const heardText = words.join(' ');
    madeUp.push({ written: p.written, heard: heardText, close: heardText !== '' && soundKeysClose(p.written, heardText) });
  }
  const extra = b.filter((_, j) => !usedJ.has(j));
  const checkMadeUp = madeUp.some((m) => !m.close);
  return { match: missing.length === 0 && extra.length === 0 && !checkMadeUp, missing, extra, madeUp, checkMadeUp };
}

// A rough sound key: consonant skeleton with look-alike sounds folded together,
// so "goobly-degooking" and "goo glee the gooking" come out close.
function soundKey(text) {
  let t = text.toLowerCase().replace(/[^a-z]/g, '');
  t = t.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/[cq]/g, 'k').replace(/x/g, 'ks')
    .replace(/z/g, 's').replace(/v/g, 'f').replace(/d/g, 't').replace(/b/g, 'p').replace(/g/g, 'k').replace(/h/g, '');
  const first = t[0] || '';
  t = first + t.slice(1).replace(/[aeiouyw]/g, '');
  return t.replace(/(.)\1+/g, '$1');
}

function soundKeysClose(a, b) {
  return similarity(soundKey(a), soundKey(b)) >= 0.5;
}

function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length);
}

// Ways the heard words could be read if he stopped and started again:
// starting over from any later word, or dropping a fragment he then repeated.
function restartCandidates(b) {
  const out = [];
  for (let k = 1; k < b.length; k++) out.push(b.slice(k));
  for (let len = 1; len * 2 <= b.length; len++) {
    for (let i = 0; i + len * 2 <= b.length; i++) {
      const repeated = b.slice(i, i + len).every((w, n) => w === b[i + len + n]);
      if (repeated) out.push([...b.slice(0, i), ...b.slice(i + len)]);
    }
  }
  return out;
}

// The line as shown and spoken: braces that mark made-up words removed.
export function cleanText(text) {
  return text.replace(/[{}]/g, '');
}

// The made-up words of a line, for showing big on screen.
export function madeUpWords(text) {
  return (text.match(/\{[^}]*\}/g) || []).map((w) => w.slice(1, -1));
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
  const text = cleanText(line);
  return level >= 2 ? text : text.split(/\s+/).slice(0, 4).join(' ');
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

// A line that is only a sound ("Argh!", "Ha!", "Hmm.") has no words for speech recognition
// to catch, so the app accepts any sound for it instead of comparing words.
const SOUND = /^(a+r+g+h*|a+r+r+|u+g+h+|h+a+|h+m+|a+h+|o+h+h+|e+r+g+h*|g+r+r+)$/;
export function isSoundOnly(text) {
  const words = normalize(stripDirections(text));
  return words.length > 0 && words.every((w) => SOUND.test(w));
}

// A voice for each character: the same one every time, spread across the phone's voices,
// with women and kids pitched higher and men lower so parts are easy to tell apart.
const WOMEN = /MOTHER|MOM|MISS SHIELDS|MRS\.|WOMEN|WOMAN|ESTHER|MARY|GIRL|TOWNSWOMEN/;
const KIDS = /RALPHIE|RANDY|KIDS|FLICK|SCHWARTZ$|FARKUS|DILL|CHILD/;
export function voiceFor(name, voiceCount) {
  let h = 7;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const voice = voiceCount ? h % voiceCount : 0;
  if (WOMEN.test(name)) return { voice, pitch: 1.25, rate: 1, kind: 'woman' };
  if (KIDS.test(name)) return { voice, pitch: 1.5, rate: 1.08, kind: 'kid' };
  // Jean is the narrator: the grown-up Ralphie, an older man, so lower and a touch slower.
  if (name === 'JEAN') return { voice, pitch: 0.7, rate: 0.93, kind: 'man' };
  return { voice, pitch: 0.8, rate: 1, kind: 'man' };
}
