// Line Runner: browser glue around core.js.
// Everything here is about Chrome's speech APIs; the testable logic lives in core.js.
import { compareLine, detectCommand, promptText, assembleTranscript, isLineFinished, stripDirections, isSoundOnly, cleanText, madeUpWords, voiceFor } from './core.js?v=20261001a';
import { parseScript } from './script.js?v=20261001a';
import { planScene, drillSteps, trimCues } from './plan.js?v=20261001a';

// An original practice scene (not from any licensed script), used until a real script is loaded.
const DEMO = `# Practice scene (made up)
MOTHER: Dinner is on the table, and it is getting cold.
OLD MAN: Hold your horses. I am in the middle of a very delicate operation.
MOTHER: You have been in the middle of it since Tuesday.
OLD MAN: Great inventions take time. Edison did not rush the light bulb.
MOTHER: Edison did not set the kitchen curtains on fire.
OLD MAN: That was one small spark (pause) and a learning experience.
MOTHER: Wash your hands. And do not stop at the door to admire your work.
OLD MAN: I never pause. I am a man of action.
[SONG: A Man of Action]
OLD MAN: ~ A MAN OF ACTION NEVER WAITS AROUND.
OLD MAN: ~ HE ROLLS HIS SLEEVES UP AND HE STANDS HIS GROUND.
OLD MAN: ~ HE NEVER STOPS TO ASK THE WAY.
[END SONG]
MOTHER: Very nice, dear. Now wash your hands.
OLD MAN: Fine. But we will pause this conversation, not end it.
`;
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* storage off */ } },
};
let script = null;   // parsed script
let me = '';         // the actor's character name
let steps = [];      // practice plan for the chosen scene

const params = new URLSearchParams(location.search);
const SIM = params.has('sim');
const $ = (id) => document.getElementById(id);
const t0 = Date.now();
const logLines = [];

function log(msg) {
  const line = `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${msg}`;
  logLines.push(line);
  const el = $('log');
  el.textContent += line + '\n';
  el.scrollTop = el.scrollHeight;
}

// The turn band: a big heading that always sits in the same place, saying whose turn it is.
const TURN_TITLE = { idle: 'READY', cue: 'CUE', you: 'YOUR LINE', paused: 'PAUSED', done: 'SCENE DONE', problem: 'PROBLEM' };
const TURN_ICON = {
  idle: '<circle cx="12" cy="12" r="9"/>',
  cue: '<path d="M3 9v6h4l5 4V5L7 9H3zM16 8q5 4 0 8"/>',
  you: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
  paused: '<path d="M8 5v14M16 5v14"/>',
  done: '<path d="M4 12l5 5L20 7"/>',
  problem: '<path d="M12 8v5M12 16v1M4 20h16L12 4z"/>',
};
// `cls` is the older shape ('listening' / 'paused'); `turn` names the heading outright.
function setStatus(text, cls = '', turn = '') {
  const kind = turn || (cls === 'listening' ? 'you' : cls === 'paused' ? 'paused' : 'idle');
  $('status').textContent = text;
  $('turnTitle').textContent = TURN_TITLE[kind];
  $('turnIcon').innerHTML = TURN_ICON[kind];
  $('turn').className = 'turn ' + kind;
}

// The current line, big, in the stage area under the turn band. Made-up words are underlined.
function showOnStage(st, next) {
  const it = st.item;
  const line = $('currentLine');
  line.textContent = '';
  if (it.kind === 'song') { $('speaker').textContent = 'Song'; line.textContent = it.title; }
  else if (it.kind !== 'line') { $('speaker').textContent = ' '; line.textContent = it.kind === 'direction' ? `(${it.text})` : ''; }
  else {
    const mine = st.action === 'listen';
    $('speaker').textContent = it.who + (it.sung ? ' (sung)' : '') + (mine ? ' / you' : '');
    for (const piece of it.text.split(/(\{[^}]*\})/)) {
      if (!piece) continue;
      if (piece.startsWith('{')) { const m = document.createElement('mark'); m.textContent = piece.slice(1, -1); line.append(m); }
      else line.append(document.createTextNode(piece));
    }
  }
  const madeUp = it.kind === 'line' && st.action === 'listen' && it.text.includes('{');
  $('lineNote').textContent = madeUp ? 'Underlined words are the made-up ones.'
    : (st.action !== 'listen' && next && next.action === 'listen' ? 'Your line is next.' : '');
}

// The last result, kept on the stage until the next one: symbol and word, never color alone.
function showLastResult(kind, word) {
  const el = $('lastResult');
  el.className = 'badge ' + kind;
  el.textContent = kind ? `Last line: ${RESULT_SYMBOL[kind]} ${word}` : '';
}
const RESULT_SYMBOL = { ok: '✓', check: '?', bad: '×' };
const RESULT_WORD = { ok: 'Matched', check: 'Check', bad: 'Needs work' };
function badge(kind, word = RESULT_WORD[kind]) {
  const b = document.createElement('span');
  b.className = 'badge ' + kind;
  b.textContent = `${RESULT_SYMBOL[kind]} ${word}`;
  return b;
}

// ---------- script display ----------
function loadScriptText(text, source) {
  let parsed;
  try { parsed = parseScript(text); }
  catch (err) { setStatus(`Script problem: ${err.message}`, '', 'problem'); log(`script problem: ${err.message}`); return false; }
  script = parsed;
  const names = new Set();
  script.scenes.forEach((sc) => sc.items.forEach((it) => { if (it.kind === 'line') names.add(it.who); }));
  me = names.has('THE OLD MAN') ? 'THE OLD MAN' : (names.has('OLD MAN') ? 'OLD MAN' : [...names][0]);
  const sel = $('scene');
  sel.innerHTML = '';
  script.scenes.forEach((sc, n) => { const o = document.createElement('option'); o.value = n; o.textContent = sc.title; sel.append(o); });
  const saved = store.get('ll-scene');
  if (saved && script.scenes[Number(saved)]) sel.value = saved;
  $('role').textContent = me;
  log(`script loaded (${source}): ${script.scenes.length} scene(s), version ${script.version || 'none'}, you are ${me}`);
  renderScript();
  return true;
}

function renderScript() {
  const scene = script.scenes[Number($('scene').value) || 0];
  const drill = $('mode').value === 'drill';
  // The drill takes every line with made-up words, songs included.
  steps = drill ? drillSteps(planScene(scene.items, me))
    : trimCues(planScene(scene.items, me, { skipSongs: $('skipSongs').checked }), Number($('before').value));
  $('sceneName').textContent = scene.title;
  $('script').innerHTML = '';
  $('summary').hidden = true;
  showLastResult('', '');
  if (drill && !steps.length) $('script').textContent = 'No made-up words in this scene.';
  steps.forEach((st, i) => {
    if (st.action === 'cue' && !drill) return;
    const it = st.item;
    const div = document.createElement('div');
    div.id = 'ln' + i;
    if (it.kind === 'song') { div.className = 'ln song'; div.textContent = `Song: ${it.title}`; }
    else if (it.kind === 'direction') { div.className = 'ln song'; div.textContent = `(${it.text})`; }
    else if (it.kind !== 'line') { div.className = 'ln song'; div.textContent = it.kind === 'songEnd' ? '(end of song)' : '(skip)'; }
    else {
      div.className = 'ln' + (it.who === me ? ' mine' : '') + (st.action === 'skip' ? ' skipped' : '');
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = it.who + (it.sung ? ' (sung)' : '') + (st.action === 'skip' ? ' - skipped' : '');
      div.append(who, document.createTextNode(cleanText(it.text)));
    }
    $('script').append(div);
  });
}

function highlight(i) {
  document.querySelectorAll('.ln.now').forEach((el) => el.classList.remove('now'));
  const el = $('ln' + i);
  if (el) {
    el.classList.add('now');
    // Scroll inside the folded script only, so the stage at the top stays where it is.
    const box = $('script');
    box.scrollTo({ top: el.offsetTop - box.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
  }
  if (steps[i]) showOnStage(steps[i], steps[i + 1]);
}

function showHeard(i, heard, result, prompted, phoneRestarts = 0) {
  const el = $('ln' + i);
  const ok = result.match && !prompted;
  let kind = ok ? 'ok' : 'bad';
  let note = heard ? `Heard: "${heard}"` : 'Heard: a sound (no words needed for this line)';
  if (prompted) note += ' (you asked for "line")';
  if (result.restarted) note += ' (you restarted, then got it)';
  if (result.missing.length || result.extra.length) note += ` | missing: ${result.missing.join(' ') || 'none'} | extra: ${result.extra.join(' ') || 'none'}`;
  if (result.likelyMishearing && !prompted) { note += ' | probably the phone mishearing'; kind = 'check'; }
  // The phone stopped listening partway through: missing or doubled words may be the phone's, not his.
  if (!result.match && phoneRestarts && !prompted) { note += ` | the phone stopped listening ${phoneRestarts === 1 ? 'once' : phoneRestarts + ' times'} during this line, so some words may not have reached it`; kind = 'check'; }
  if (result.checkMadeUp && !prompted && !result.missing.length && !result.extra.length) kind = 'check';
  const mark = badge(kind);
  mark.classList.add('result');
  const span = document.createElement('span');
  span.className = 'heard ' + kind;
  span.textContent = note;
  el.append(mark, span);
  showLastResult(kind, RESULT_WORD[kind]);
  for (const m of result.madeUp || []) {
    const row = document.createElement('span');
    row.className = 'heard ' + (m.close ? 'ok' : 'check');
    row.textContent = `Script: ${m.written}  |  Phone heard: ${m.heard || '(nothing)'}  |  ${m.close ? '✓ sounds close' : '? check this one'}`;
    el.append(row);
  }
}

// ---------- speaking ----------
let voice = null;
let voiceList = [];
function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  voiceList = voices;
  const sel = $('voice');
  const current = sel.value;
  sel.innerHTML = '';
  voices.forEach((v, n) => {
    const o = document.createElement('option');
    o.value = n; o.textContent = `${v.name} (${v.lang})`;
    sel.append(o);
  });
  // Remember the chosen voice by name, since the list can come back in a different order.
  const savedName = store.get('ll-voice');
  const savedIndex = voices.findIndex((v) => v.name === savedName);
  if (savedIndex >= 0) sel.value = savedIndex;
  else if (current) sel.value = current;
  voice = voices[Number(sel.value) || 0] || null;
  sel.onchange = () => { voice = voices[Number(sel.value)] || null; if (voice) store.set('ll-voice', voice.name); };
  log(`voices available: ${voices.length}${voices.length ? ` (${voices.map((v) => v.name).join('; ')})` : ''}`);
}

// Phones name some voices by gender or a person's name; use that when it's there.
// Kids share the women's voices, pitched up. Without any hints, every voice is fair game.
const FEMALE_HINT = /female|woman|girl|zira|samantha|susan|karen|moira|tessa|victoria|aria|jenny|sonia|libby|emma|ava|allison/i;
const MALE_HINT = /\bmale\b|\bman\b|david|mark|daniel|alex|fred|guy|ryan|george|tom|aaron|christopher/i;
function voicesFor(kind) {
  if (kind === 'man') return voiceList.filter((v) => MALE_HINT.test(v.name) && !/female/i.test(v.name));
  return voiceList.filter((v) => FEMALE_HINT.test(v.name));
}

let speaking = false;
// `who` picks that character's own voice when "a different voice for each character" is on.
function speak(text, who = '') {
  return new Promise((resolve) => {
    speaking = true;
    const done = (why) => { if (!speaking) return; speaking = false; clearTimeout(timer); if (why) log(`speech ${why}`); resolve(); };
    // Chrome sometimes never fires "end"; don't hang the scene waiting for it.
    const timer = setTimeout(() => done(SIM ? '' : 'timed out (no end event)'), SIM ? 300 : text.length * 90 + 3000);
    if (SIM || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (who && $('perCharacter').checked && voiceList.length) {
      const v = voiceFor(who, voiceList.length);
      const pool = voicesFor(v.kind);
      // No gender hints in the names (Android's voices are named by country): keep one American
      // voice for everyone, told apart by pitch and speed, rather than a family with five accents.
      const american = voiceList.find((x) => /United States|en[-_]US/i.test(`${x.name} ${x.lang}`));
      u.voice = pool.length ? pool[v.voice % pool.length] : (american || voiceList[v.voice]);
      u.pitch = v.pitch; u.rate = v.rate;
    } else if (voice) u.voice = voice;
    u.onend = () => done();
    u.onerror = (e) => done(`error: ${e.error}`);
    speechSynthesis.speak(u);
  });
}

// ---------- listening ----------
const Recognition = SIM ? null : (window.SpeechRecognition || window.webkitSpeechRecognition);
let rec = null;
let wantListening = false;
let earlierSessions = [];
let currentResults = [];
let lastSpeechAt = 0;
let restarts = 0;
let micBlocked = false;

// In continuous mode Android can repeat earlier words inside later results; keep only the longest of a growing run.
function dedupe(results) {
  const out = [];
  for (const r of results) {
    const prev = out[out.length - 1];
    if (prev && r.text.trim().toLowerCase().startsWith(prev.text.trim().toLowerCase())) out[out.length - 1] = r;
    else out.push(r);
  }
  return out;
}

function heardText() { return assembleTranscript(earlierSessions, currentResults); }
// Last time the microphone picked up any sound at all, words or not (for lines like "Argh!").
let lastSoundAt = 0;
// When the phone last (re)started listening: it hears nothing while restarting, so quiet then isn't him finishing.
let listeningSince = 0;
// Restarts after he had started the line: words said during one can be lost or heard twice.
let midLineRestarts = 0;
function resetHeard() { earlierSessions = []; currentResults = []; lastSpeechAt = 0; lastSoundAt = 0; listeningSince = 0; midLineRestarts = 0; }

function startListening() {
  wantListening = true;
  if (SIM) return;
  if (!Recognition) { setStatus('This browser cannot listen. Use Chrome.', '', 'problem'); return; }
  rec = new Recognition();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = $('continuous').checked;
  if ($('local').checked) rec.processLocally = true;
  rec.onresult = (e) => {
    currentResults = dedupe(Array.from(e.results).map((r) => ({ final: r.isFinal, text: r[0].transcript })));
    lastSpeechAt = Date.now();
  };
  rec.onaudiostart = () => { listeningSince = Date.now(); };
  rec.onsoundstart = () => { lastSoundAt = Date.now(); };
  rec.onsoundend = () => { lastSoundAt = Date.now(); };
  rec.onerror = (e) => {
    if (e.error === 'aborted') return; // our own stop between lines
    log(`listening error: ${e.error}`);
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      micBlocked = true; wantListening = false;
      setStatus('Microphone blocked. Allow it in Chrome settings.', '', 'problem');
    }
  };
  rec.onend = () => {
    if (currentResults.length) earlierSessions.push(currentResults.map((r) => r.text).join(' '));
    currentResults = [];
    if (wantListening && !micBlocked) {
      restarts++;
      if (earlierSessions.length) midLineRestarts++;
      listeningSince = Date.now();
      log(`listening stopped by the phone; restarting (#${restarts})`);
      // Restart at once: words spoken while the phone isn't listening are lost.
      if (wantListening) startListening();
    }
  };
  try { rec.start(); } catch (err) { log(`start failed: ${err.message}`); }
}

function stopListening() {
  wantListening = false;
  if (rec) { rec.onend = null; try { rec.abort(); } catch (_) { /* already stopped */ } rec = null; }
}

// ---------- the scene ----------
let running = false;
let paused = false;
let lastCue = '';
let tapCommand = null;

function gapMs() { return Number($('gap').value) * 1000; }

async function sayOther(text, who = '') {
  stopListening();
  setStatus(who ? `${who} is speaking` : 'Reading the cue...', '', 'cue');
  await speak(cleanText(stripDirections(text)), who);
}

// Wait for one of his lines, handling commands, until he says a real line.
function awaitMyLine(expected, soundOnly = false) {
  return new Promise((resolve) => {
    let promptLevel = 0;
    let busy = false;
    let phoneRestarts = 0;
    const expectedWords = expected.split(/\s+/).filter(Boolean).length;
    resetHeard();
    startListening();
    setStatus('Your line. Listening...', 'listening');
    const tick = setInterval(async () => {
      if (busy || speaking) return;
      let cmd = tapCommand; tapCommand = null;
      let utterance = '';
      if (!cmd) {
        utterance = heardText();
        // A sound-only line ("Argh!") may produce no words at all; any sound counts.
        const heardSomething = utterance.length > 0 || (soundOnly && lastSoundAt > 0);
        const lastHeard = soundOnly ? Math.max(lastSpeechAt, lastSoundAt) : lastSpeechAt;
        const heardWords = utterance.split(/\s+/).filter(Boolean).length;
        if (!isLineFinished({ heardSomething, lastSpeechAt: lastHeard, now: Date.now(), gapMs: gapMs(), listeningSince, heardWords, expectedWords: soundOnly ? 0 : expectedWords })) return;
        cmd = detectCommand(utterance);
        phoneRestarts = midLineRestarts;
        resetHeard();
      }
      busy = true;
      if (paused && cmd !== 'resume' && cmd !== 'pause') { busy = false; return; }
      if (cmd === 'pause') { paused = !paused; log(paused ? 'paused' : 'resumed'); setStatus(paused ? 'Paused. Say "resume".' : 'Your line. Listening...', paused ? 'paused' : 'listening'); busy = false; return; }
      if (cmd === 'resume') { if (paused) { paused = false; log('resumed'); } setStatus('Your line. Listening...', 'listening'); busy = false; return; }
      if (cmd === 'line' || cmd === 'repeat') {
        const text = cmd === 'line' ? promptText(expected, ++promptLevel) : lastCue;
        log(cmd === 'line' ? `prompt level ${promptLevel}` : 'repeating the cue');
        stopListening();
        await speak(text);
        resetHeard();
        startListening();
        setStatus('Your line. Listening...', 'listening');
        busy = false;
        return;
      }
      clearInterval(tick);
      stopListening();
      resolve({ heard: utterance, prompted: promptLevel > 0, phoneRestarts });
    }, 150);
  });
}

let madeUpSeen = [];

// Shows text big across the screen for a few seconds.
function flashBig(text) {
  return new Promise((resolve) => {
    const box = $('bigWords');
    box.innerHTML = '';
    for (const w of text.split('  ·  ')) { const p = document.createElement('p'); p.className = 'flash-word'; p.textContent = w; box.append(p); }
    $('big').hidden = false;
    setTimeout(() => { $('big').hidden = true; resolve(); }, 3500);
  });
}

// End of scene: every made-up word, the script's spelling beside what the phone heard.
function showSummary() {
  if (!madeUpSeen.length) return;
  const box = $('summary');
  box.innerHTML = '<h2>Made-up words</h2><p>Script vs. what the phone heard</p>';
  for (const m of madeUpSeen) {
    const row = document.createElement('div');
    row.className = 'word-pair';
    const dl = document.createElement('dl');
    for (const [dt, dd] of [['Script', m.written], ['Phone heard', m.heard || '(nothing)']]) {
      const t = document.createElement('dt'); t.textContent = dt;
      const d = document.createElement('dd'); d.textContent = dd;
      dl.append(t, d);
    }
    row.append(dl, badge(m.close ? 'ok' : 'check', m.close ? 'Sounds close' : 'Check this one'));
    box.append(row);
  }
  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = 'The phone only knows if they sound close. You are the judge of exact.';
  box.append(note);
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth' });
}

async function runScene() {
  if (running) return;
  running = true; paused = false; restarts = 0; madeUpSeen = [];
  store.set('ll-gap', $('gap').value);
  renderScript();
  await keepAwake();
  log(`scene start: ${script.scenes[Number($('scene').value) || 0].title}; wait ${$('gap').value}s; continuous ${$('continuous').checked}`);
  for (let i = 0; i < steps.length && running; i++) {
    const { action, item } = steps[i];
    if (action === 'show' || action === 'skip') continue;
    if (action === 'cue') { if ($('mode').value === 'drill') highlight(i); lastCue = stripDirections(item.text); await sayOther(item.text, item.who); continue; }
    highlight(i);
    if (action === 'speak') {
      if (item.kind === 'song') { await sayOther(`Song. ${item.title.replace(/^#\S+\s*/, '')}.`); continue; }
      lastCue = stripDirections(item.text);
      await sayOther(item.text, item.who);
      continue;
    }
    const expected = stripDirections(item.text);
    const soundOnly = isSoundOnly(expected);
    const { heard, prompted, phoneRestarts } = await awaitMyLine(expected, soundOnly);
    const result = soundOnly ? { match: true, missing: [], extra: [], likelyMishearing: false } : compareLine(expected, heard);
    log(`line ${i}: ${result.match ? 'matched' : (result.likelyMishearing ? 'probably misheard' : 'differs')}${result.restarted ? ', restarted' : ''}${prompted ? ', prompted' : ''}${phoneRestarts ? `, phone stopped listening ${phoneRestarts}x mid-line` : ''} | heard: "${heard}"${result.match ? '' : ` | missing: ${result.missing.join(' ')} | extra: ${result.extra.join(' ')}`}`);
    if (result.madeUp && result.madeUp.length) log(`  made-up words: ${result.madeUp.map((m) => `${m.written} -> "${m.heard}" (${m.close ? 'close' : 'check'})`).join('; ')}`);
    showHeard(i, heard, result, prompted, phoneRestarts);
    if (result.madeUp && result.madeUp.length) {
      madeUpSeen.push(...result.madeUp);
      // In the drill, flash the made-up words big right after he says them, to check himself.
      if ($('mode').value === 'drill') await flashBig(madeUpWords(item.text).join('  ·  '));
    }
  }
  stopListening();
  running = false;
  log(`scene end; listening restarts: ${restarts}`);
  $('context').open = true;
  showSummary();
  setStatus('Scene done. Open "Scene around this line" for every line: ✓ Matched, ? Check, × Needs work.', '', 'done');
}

// ---------- screen awake, network ----------
let wakeLock = null;
async function keepAwake() {
  if (!('wakeLock' in navigator)) { log('screen wake lock: not supported'); return; }
  try {
    if (wakeLock && !wakeLock.released) return;
    wakeLock = await navigator.wakeLock.request('screen');
    log('screen wake lock: on');
    wakeLock.addEventListener('release', () => log('screen wake lock: released'), { once: true });
  } catch (err) { log(`screen wake lock failed: ${err.message}`); }
}
document.addEventListener('visibilitychange', () => {
  log(`page ${document.visibilityState}`);
  if (document.visibilityState === 'visible' && running) keepAwake();
});
window.addEventListener('offline', () => log('network: offline'));
window.addEventListener('online', () => log('network: online'));

// ---------- report ----------
async function copyReport() {
  const report = [
    'Line Runner report',
    `when: ${new Date().toString()}`,
    `browser: ${navigator.userAgent}`,
    `listening supported: ${!!(window.SpeechRecognition || window.webkitSpeechRecognition)}`,
    `settings: wait ${$('gap').value}s, continuous ${$('continuous').checked}, on-phone ${$('local').checked}`,
    `listening restarts: ${restarts}`,
    '', ...logLines,
  ].join('\n');
  try { await navigator.clipboard.writeText(report); setStatus('Report copied. Paste it to Reginald.', '', 'done'); }
  catch (_) { setStatus('Copy failed; open the Event log and copy it by hand.', '', 'problem'); }
}

// ---------- setup ----------
async function setup() {
  setStatus('Tap Start');
  $('before').value = store.get('ll-before') || '3';
  $('before').onchange = () => { store.set('ll-before', $('before').value); if (!running) renderScript(); };
  $('perCharacter').checked = store.get('ll-per-character') !== 'off';
  $('perCharacter').onchange = () => store.set('ll-per-character', $('perCharacter').checked ? 'on' : 'off');
  $('mode').value = store.get('ll-mode') === 'drill' ? 'drill' : 'run';
  // Two big buttons stand in for the mode list; the list itself keeps the value.
  const syncMode = () => document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === $('mode').value));
  $('mode').onchange = () => { store.set('ll-mode', $('mode').value); syncMode(); if (!running) renderScript(); };
  document.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { $('mode').value = b.dataset.mode; $('mode').onchange(); }; });
  syncMode();
  // Dark unless the phone asks for light; the button overrides either way and is remembered.
  const themeLabel = () => {
    const light = document.documentElement.dataset.theme === 'light'
      || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: light)').matches);
    $('theme').textContent = light ? 'Dark' : 'Light';
    $('theme').setAttribute('aria-label', `Switch to ${light ? 'dark' : 'light'} theme`);
    return light;
  };
  $('theme').onclick = () => {
    const light = themeLabel();
    document.documentElement.dataset.theme = light ? 'dark' : 'light';
    store.set('ll-theme', light ? 'dark' : 'light');
    themeLabel();
  };
  themeLabel();
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', themeLabel);
  $('skipSongs').checked = store.get('ll-skip-songs') !== 'off';
  $('skipSongs').onchange = () => { store.set('ll-skip-songs', $('skipSongs').checked ? 'on' : 'off'); if (!running) renderScript(); };
  const savedGap = store.get('ll-gap');
  if (savedGap) { $('gap').value = savedGap; $('gapVal').textContent = savedGap; }
  $('scene').onchange = () => { store.set('ll-scene', $('scene').value); if (!running) renderScript(); };
  $('file').onchange = async () => {
    const f = $('file').files[0];
    if (!f) return;
    const text = await f.text();
    if (loadScriptText(text, f.name)) { store.set('ll-script', text); setStatus('Script loaded. Pick a scene and tap Start.'); }
  };
  const savedScript = store.get('ll-script');
  if (!(savedScript && loadScriptText(savedScript, 'saved on this phone'))) loadScriptText(DEMO, 'practice scene');
  $('gap').oninput = () => { $('gapVal').textContent = $('gap').value; store.set('ll-gap', $('gap').value); };
  $('start').onclick = runScene;
  $('pause').onclick = () => { tapCommand = paused ? 'resume' : 'pause'; };
  $('repeat').onclick = () => { tapCommand = 'repeat'; };
  $('lineBtn').onclick = () => { tapCommand = 'line'; };
  $('copy').onclick = copyReport;

  const cont = document.createElement('label');
  cont.className = 'setting';
  cont.innerHTML = '<input id="continuous" type="checkbox"><span>Continuous listening<small class="note">Try it if the phone cuts you off</small></span>';
  $('localWrap').before(cont);
  $('continuous').checked = store.get('ll-continuous') === 'on';
  $('continuous').onchange = () => store.set('ll-continuous', $('continuous').checked ? 'on' : 'off');

  if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (R && 'processLocally' in R.prototype) {
    // Offer the option only when this phone can actually do it.
    if (typeof R.available === 'function') {
      try {
        const status = await R.available({ langs: ['en-US'], processLocally: true });
        log(`on-phone listening: ${status}`);
        if (status !== 'unavailable') $('localWrap').hidden = false;
        else $('local').checked = false;
      } catch (err) { log(`on-phone check failed: ${err.message}`); }
    }
  } else log('on-phone listening: not offered by this browser');
  if (!R && !SIM) setStatus('This browser cannot listen. Open it in Chrome.', '', 'problem');

  if (SIM) {
    $('sim').style.display = 'flex';
    $('simSay').onclick = () => {
      // "*" stands for a sound the recognizer turns into no words (like "Argh!").
      if ($('simText').value === '*') { lastSoundAt = Date.now(); $('simText').value = ''; return; }
      currentResults = [...currentResults, { final: true, text: $('simText').value }];
      lastSpeechAt = Date.now();
      $('simText').value = '';
    };
    log('simulation mode: type instead of speaking');
  }
  log('ready');
}

setup();
