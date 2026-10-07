// Line Runner: browser glue around core.js.
// Everything here is about Chrome's speech APIs; the testable logic lives in core.js.
import { compareLine, detectCommand, promptText, assembleTranscript, isLineFinished, lineEndHeard, stripStale, stripDirections, isSoundOnly, cleanText, madeUpWords, voiceFor } from './core.js?v=20261007d';
import { parseScript } from './script.js?v=20261007d';
import { planScene, drillSteps, trimCues, recordSteps } from './plan.js?v=20261007d';
import { diffSpans, learnable, applyHabits } from './habits.js?v=20261007d';
import * as voices from './voices.js?v=20261007d';

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
const TURN_TITLE = { idle: 'READY', cue: 'CUE', you: 'YOUR LINE', paused: 'PAUSED', done: 'SCENE DONE', problem: 'PROBLEM', rec: 'RECORDING' };
const TURN_ICON = {
  rec: '<circle cx="12" cy="12" r="6" fill="currentColor"/>',
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
  const recording = $('mode').value === 'record';
  // The drill takes every line with made-up words, songs included. Record mode takes the lines a
  // run would read aloud at these settings, plus his own.
  if (recording) steps = recordSteps(scene.items, me, { skipSongs: $('skipSongs').checked, keep: Number($('before').value) }).map((r) => ({ action: r.mine ? 'listen' : 'speak', item: r.item }));
  else steps = drill ? drillSteps(planScene(scene.items, me))
    : trimCues(planScene(scene.items, me, { skipSongs: $('skipSongs').checked }), Number($('before').value));
  $('sceneName').textContent = scene.title;
  $('script').innerHTML = '';
  $('summary').hidden = true;
  showLastResult('', '');
  if (drill && !steps.length) $('script').textContent = 'No made-up words in this scene.';
  // A stage direction rides on the line after it, as a small note, instead of a row of its own
  // (Thomas, 4 Oct 2026: separate rows made the script feel chopped into sections).
  let directions = [];
  steps.forEach((st, i) => {
    if (st.action === 'cue' && !drill) return;
    const it = st.item;
    const next = steps.slice(i + 1).find((s) => !(s.action === 'cue' && !drill) && s.item.kind !== 'direction');
    if (it.kind === 'direction' && next && next.item.kind === 'line') { directions.push(it.text); return; }
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
      for (const d of directions) { const s = document.createElement('span'); s.className = 'dir'; s.textContent = `(${d})`; div.append(s); }
      directions = [];
      div.append(who, document.createTextNode(cleanText(it.text)));
    }
    $('script').append(div);
  });
  markRecorded();
}

// Marks the lines that have a recorded voice (in any mode), so he can see what's left to record.
async function markRecorded() {
  const shown = steps.map((st, i) => ({ st, i })).filter(({ st }) => st.item.kind === 'line');
  for (const { st, i } of shown) {
    let clip = null;
    try { clip = await voices.getClip(st.item.id); } catch (_) { return; }
    const el = $('ln' + i);
    if (!el || el.querySelector('.rec-mark')) continue;
    if (voices.clipFits(clip, st.item)) { const b = badge('ok', 'Recorded'); b.classList.add('rec-mark'); el.append(b); }
  }
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

function showHeard(i, heard, result, prompted, phoneRestarts = 0, item = null, expected = '') {
  const el = $('ln' + i);
  const ok = result.match && !prompted;
  let kind = ok ? 'ok' : 'bad';
  let note = heard ? `Heard: "${heard}"` : 'Heard: a sound (no words needed for this line)';
  if (result.habitUsed) note += ` (a phone habit you taught it was allowed${result.habitUsed > 1 ? `, ${result.habitUsed} of them` : ''})`;
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
  // He knows he said it right: mark it so, and teach the phone's habit for this line.
  if (!ok && !prompted && item && heard) {
    const btn = document.createElement('button');
    btn.className = 'mark-right';
    btn.textContent = 'I said it right';
    btn.onclick = async () => {
      btn.disabled = true;
      const spans = learnable(diffSpans(expected, heard));
      let msg = 'Marked right. Nothing to learn: the phone missed words rather than hearing them wrong.';
      try {
        if (spans.length) {
          await voices.addHabits(item, runEngine, spans);
          voices.askToKeep();
          msg = `Learned for this line: the phone hears ${spans.map((s) => `"${s.heard.join(' ')}" for "${s.written.join(' ')}"`).join(', ')}.`;
        }
      } catch (err) { msg = `Marked right, but the habit could not be saved: ${err.message}`; }
      mark.className = 'badge ok result';
      mark.textContent = '✓ You said it right';
      const done = document.createElement('span');
      done.className = 'heard ok';
      done.textContent = msg;
      btn.replaceWith(done);
      log(`line ${i}: he says it was right; ${spans.length ? `learned ${spans.length} habit(s) for ${runEngine}` : 'nothing to learn'}`);
      refreshVoicesBox();
    };
    el.append(btn);
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
let speechTurn = 0;
// `who` picks that character's own voice when "a different voice for each character" is on.
function speak(text, who = '') {
  return new Promise((resolve) => {
    speaking = true;
    // Each call finishes once, on its own: a late "end" or "interrupted" from an earlier line
    // (one that timed out) must not mark this one finished, or this one would never resolve.
    const turn = ++speechTurn;
    let finished = false;
    const done = (why) => { if (finished) return; finished = true; if (turn === speechTurn) speaking = false; clearTimeout(timer); if (why) log(`speech ${why}`); resolve(); };
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
let restartPending = false;
// Called once when the microphone actually comes on for his line.
let onMicReady = null;
function resetHeard() { earlierSessions = []; currentResults = []; lastSpeechAt = 0; lastSoundAt = 0; listeningSince = 0; midLineRestarts = 0; restartPending = false; }

// ---------- on-phone listening (Moonshine) ----------
// Moonshine runs a speech model on the phone itself. The mic stays on for the whole scene (no
// beeps, no restarts, nothing lost in a gap) and is only muted while the other parts are read.
// It is pointed at the line's made-up words only; pointing it at the whole line could make it
// "hear" the right words when he said something else.
const MOONSHINE = 'https://cdn.jsdelivr.net/npm/@moonshine-ai/moonshine-wasm@0.1.5/dist/index.js';
let moon = null;        // { size, mic, ready, live, stopMeter, errors }
let moonLoading = null; // { size, promise } while a model is loading, so a second request waits for it
let moonKeyterms = [];
// The stretch the engine is still working on. Muting doesn't close it, so after a cue it can come
// back with his previous line's last words at its start; those are stripped (moonStale).
let moonOpen = '';
let moonStale = '';

function engine() { return $('engine').value; }
function moonLive() { return !SIM && moon && moon.live; }

function freshText(text) { return stripStale(text, moonStale); }
// The words of the stretch he is saying right now, revised as he goes.
function moonText(text) {
  moonOpen = (text || '').trim();
  if (!wantListening) return;
  const t = freshText(text);
  currentResults = t ? [{ final: false, text: t }] : [];
  lastSpeechAt = Date.now();
}
// A stretch finished at a pause: keep it, and start the next one fresh.
function moonLineDone(text) {
  const t = freshText(text);
  moonOpen = ''; moonStale = '';
  if (!wantListening) return;
  currentResults = [];
  if (t) { earlierSessions.push(t); lastSpeechAt = Date.now(); }
}
// Repeated engine errors mid-scene: give up on Moonshine for this scene and carry on with Google,
// including for the line he is on now.
function moonError(err) {
  log(`on-phone listening error: ${err.message}`);
  if (!moon || !moon.live) return;
  moon.errors = (moon.errors || 0) + 1;
  if (moon.errors < 3) return;
  log('on-phone listening failed repeatedly; switching to Google for the rest of this scene');
  stopMoonScene();
  if (wantListening) startListening();
}

function loadMoon() {
  const size = engine() === 'moon-small' ? 'small' : 'tiny';
  if (moon && moon.size === size && moon.ready) return Promise.resolve(true);
  if (moonLoading && moonLoading.size === size) return moonLoading.promise;
  const promise = loadMoonModel(size).finally(() => { if (moonLoading && moonLoading.promise === promise) moonLoading = null; });
  moonLoading = { size, promise };
  return promise;
}

async function loadMoonModel(size) {
  if (moon) { try { moon.mic.close(); } catch (_) { /* already closed */ } moon = null; }
  if (!self.crossOriginIsolated) { log('on-phone listening: this page is not isolated yet (reload once); using Google'); return false; }
  const t = Date.now();
  try {
    const lib = await import(MOONSHINE);
    const m = { size, ready: false, live: false, errors: 0 };
    m.mic = new lib.MicTranscriber()
      .modelArch(size === 'small' ? lib.ModelArch.SmallStreaming : lib.ModelArch.TinyStreaming)
      .onProgress((f, file, bytes) => { if (!running || !moon) setStatus(`Downloading the on-phone listener: ${Math.round(f * 100)}%${bytes && bytes.total ? ` of ${Math.round(bytes.total / 1048576)} MB` : ''}`, '', 'idle'); })
      .onText(moonText)
      .onLine((line) => moonLineDone(line.text))
      .onError(moonError);
    // A stretch's first words arrive as "line started", which onText doesn't carry.
    m.mic.addListener({ onLineStarted: ({ line }) => moonText(line.text) });
    await m.mic.load();
    m.ready = true;
    moon = m;
    log(`on-phone listening: Moonshine ${size} ready in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    return true;
  } catch (err) {
    log(`on-phone listening failed to load: ${err.message}; using Google`);
    return false;
  }
}

// Turns the mic on for the scene (muted until his first line). A second look at the mic,
// a plain volume meter, catches sounds with no words ("Argh!").
async function startMoonScene() {
  if (!(await loadMoon())) return false;
  if (moon.stopping) { await moon.stopping; moon.stopping = null; }
  try {
    await moon.mic.start();
    moon.mic.mute(true);
    moon.live = true;
    moon.errors = 0;
  } catch (err) {
    log(`on-phone listening could not start the mic: ${err.message}; using Google`);
    // A half-started engine can hold the mic and refuse the next start: release it and reload next time.
    try { await moon.mic.stop(); } catch (_) { /* not started */ }
    try { moon.mic.close(); } catch (_) { /* already closed */ }
    moon = null;
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => { /* resumes on the next tap */ });
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    const timer = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      if (wantListening && Math.sqrt(sum / buf.length) > 0.02) lastSoundAt = Date.now();
    }, 50);
    moon.stopMeter = () => { clearInterval(timer); ctx.close(); stream.getTracks().forEach((tr) => tr.stop()); };
  } catch (err) { log(`on-phone listening: no volume meter (${err.message}); sound-only lines need a word`); }
  log(`on-phone listening: mic on for the scene (Moonshine ${moon.size})`);
  return true;
}

function stopMoonScene() {
  if (!moon || !moon.live) return;
  moon.live = false;
  try { moon.mic.mute(true); } catch (_) { /* already stopped */ }
  // Remembered so a quick second Start waits for the mic to be fully released first.
  moon.stopping = Promise.resolve(moon.mic.stop()).catch(() => { /* already stopped */ });
  if (moon.stopMeter) { moon.stopMeter(); moon.stopMeter = null; }
}

function startListening() {
  wantListening = true;
  if (SIM) return;
  if (moonLive()) {
    try { moon.mic.setKeyterms(moonKeyterms); } catch (err) { log(`on-phone listening: key words not set (${err.message})`); }
    currentResults = [];
    moonStale = moonOpen;
    // A phone call or another app can suspend the audio; wake it each time his turn starts.
    const ac = moon.mic.audioContext;
    if (ac && ac.state === 'suspended') ac.resume().then(() => log('on-phone listening: audio woken up')).catch((err) => log(`on-phone listening: audio would not wake (${err.message})`));
    moon.mic.mute(false);
    listeningSince = Date.now();
    if (onMicReady) { onMicReady(); onMicReady = null; } // the mic is already on
    return;
  }
  if (!Recognition) { setStatus('This browser cannot listen. Use Chrome.', '', 'problem'); return; }
  rec = new Recognition();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = $('continuous').checked;
  if ($('local').checked) rec.processLocally = true;
  rec.onresult = (e) => {
    currentResults = dedupe(Array.from(e.results).map((r) => ({ final: r.isFinal, text: r[0].transcript })));
    lastSpeechAt = Date.now();
    if (restartPending && currentResults.some((r) => r.text.trim())) { midLineRestarts++; restartPending = false; }
  };
  rec.onaudiostart = () => { listeningSince = Date.now(); if (onMicReady) { onMicReady(); onMicReady = null; } };
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
      // Counts as mid-line only if he goes on speaking afterward (see onresult); the phone
      // usually stops right after he finishes, which is not a cut.
      if (earlierSessions.length) restartPending = true;
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
  onMicReady = null;
  if (moonLive()) { try { moon.mic.mute(true); } catch (_) { /* stopped */ } }
  if (rec) { rec.onend = null; try { rec.abort(); } catch (_) { /* already stopped */ } rec = null; }
}

// ---------- the scene ----------
let running = false;
let paused = false;
let lastCue = '';
let lastCueItem = null;
let tapCommand = null;
// Recorded voices for the scene being run (line id -> clip), and which listener this run uses,
// which is what learned phone habits are filed under.
let sceneClips = new Map();
let runEngine = 'google';

function gapMs() { return Number($('gap').value) * 1000; }

// Reads someone else's line: their recorded voice if there is one for this exact line, otherwise
// the phone's voice. Listening is off until it has finished playing.
async function sayOther(text, who = '', item = null) {
  stopListening();
  setStatus(who ? `${who} is speaking` : 'Reading the cue...', '', 'cue');
  const clip = item && sceneClips.get(item.id);
  if (clip) {
    try { await voices.playClip(clip); return; }
    catch (err) { log(`recorded voice failed (${err.message}); using the phone's voice`); }
  }
  await speak(cleanText(stripDirections(text)), who);
}

async function loadSceneClips() {
  sceneClips = new Map();
  let cues = 0;
  for (const st of steps) {
    if (st.item.kind !== 'line' || st.action === 'listen' || st.action === 'show') continue;
    cues++;
    try { const c = await voices.getClip(st.item.id); if (voices.clipFits(c, st.item)) sceneClips.set(st.item.id, c); } catch (_) { /* no storage */ }
  }
  return { cues, recorded: sceneClips.size };
}

// Start listening for his line. The phone's microphone takes a moment to come on and words said
// before then are lost, so the status says "Mic starting..." until it is on (or 2 s have passed,
// in case the phone never reports it).
function listenForLine() {
  if (SIM) { setStatus('Your line. Listening...', 'listening'); startListening(); return; }
  setStatus('Your line. Mic starting...', 'listening');
  const ready = () => { if (onMicReady === ready) { onMicReady = null; setStatus('Your line. Go ahead.', 'listening'); } };
  onMicReady = ready;
  setTimeout(ready, 2000);
  startListening();
}

// Wait for one of his lines, handling commands, until he says a real line.
function awaitMyLine(expected, soundOnly = false) {
  return new Promise((resolve) => {
    let promptLevel = 0;
    let busy = false;
    let phoneRestarts = 0;
    moonKeyterms = madeUpWords(expected);
    resetHeard();
    listenForLine();
    const tick = setInterval(async () => {
      if (busy || speaking) return;
      let cmd = tapCommand; tapCommand = null;
      let utterance = '';
      if (!cmd) {
        utterance = heardText();
        // A sound-only line ("Argh!") may produce no words at all; any sound counts.
        const heardSomething = utterance.length > 0 || (soundOnly && lastSoundAt > 0);
        const lastHeard = soundOnly ? Math.max(lastSpeechAt, lastSoundAt) : lastSpeechAt;
        // Commands and sound-only lines use the plain wait; lines wait less once their end is heard.
        const endHeard = soundOnly || detectCommand(utterance) ? undefined : lineEndHeard(expected, utterance);
        if (!isLineFinished({ heardSomething, lastSpeechAt: lastHeard, now: Date.now(), gapMs: gapMs(), listeningSince, endHeard })) return;
        cmd = detectCommand(utterance);
        // A restart he never spoke after may still have swallowed his last words.
        phoneRestarts = midLineRestarts + (restartPending ? 1 : 0);
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
        const clip = cmd === 'repeat' && lastCueItem && sceneClips.get(lastCueItem.id);
        if (clip) await voices.playClip(clip).catch(() => speak(text));
        else await speak(text);
        resetHeard();
        listenForLine();
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

// ---------- Record mode ----------
// Steps through the lines worth recording; one person reads each, and a tap on Next saves it.
// Each take is saved before moving on, a retake keeps the old one until the new one is saved,
// and it starts where they left off. His own lines are checked by the on-phone listener so he
// can teach it the words it hears wrong.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let recTap = null;
function recWait() { return new Promise((resolve) => { recTap = resolve; }); }
const REC_BUTTONS = ['recNext', 'recRetake', 'recPlay', 'recSkip', 'recBack', 'recDone', 'recLearn', 'recRedo', 'recKeep'];

let learner = null; // { key, tr }: a listener for checking his recorded lines
async function transcribeClip(clip, key, item) {
  if (!self.crossOriginIsolated) throw new Error('the page needs a reload first');
  const lib = await import(MOONSHINE);
  if (!learner || learner.key !== key) {
    if (learner) { try { learner.tr.close(); } catch (_) { /* closed */ } }
    setStatus('Getting the listener ready to check your take...', '', 'rec');
    learner = { key, tr: await lib.Transcriber.load({ language: 'en', modelArch: key === 'moon-small' ? lib.ModelArch.SmallStreaming : lib.ModelArch.TinyStreaming }) };
  }
  try { learner.tr.setKeyterms(madeUpWords(item.text)); } catch (_) { /* biasing unavailable */ }
  // Decoding into a 16 kHz context gives the samples the listener expects.
  const buf = await new OfflineAudioContext(1, 16000, 16000).decodeAudioData(await clip.blob.arrayBuffer());
  const out = learner.tr.transcribe(buf.getChannelData(0), { sampleRate: buf.sampleRate });
  return out.lines.map((l) => l.text).join(' ').trim();
}

// After one of his own takes: what the phone heard, and a chance to teach it. Returns 'next',
// 'redo' or 'done'.
async function checkMyTake(item, clip) {
  const key = engine() === 'google' ? null : engine();
  if (!key) { log('record: your take was saved but not checked (checking uses "Listen with: This phone")'); return 'next'; }
  setStatus('Checking what the phone hears...', '', 'rec');
  let heard;
  try { heard = await transcribeClip(clip, key, item); }
  catch (err) { log(`record: could not check your take: ${err.message}`); setStatus('Could not check that take. It is saved.', '', 'problem'); await sleep(1500); return 'next'; }
  const expected = stripDirections(item.text);
  const fixed = applyHabits(expected, heard, await voices.getHabits(item, key).catch(() => []));
  const r = compareLine(expected, fixed.text);
  log(`record: your line checked with ${key}: ${r.match ? 'matched' : 'differs'} | heard "${heard}"`);
  const spans = r.match ? [] : learnable(diffSpans(expected, heard));
  $('recCheck').hidden = false;
  $('recLearn').hidden = !spans.length;
  if (r.match) $('recCheckText').textContent = `✓ The phone heard it right: "${heard}"`;
  else if (spans.length) $('recCheckText').textContent = `The phone heard ${spans.map((s) => `"${s.heard.join(' ')}" for "${s.written.join(' ')}"`).join(', ')}. If you said it right, tap "That's the phone" and it will know next time. If you slipped, Retake.`;
  else $('recCheckText').textContent = `The phone heard: "${heard || '(nothing)'}". It missed words rather than hearing them wrong, so there's nothing to learn. Retake, or keep it and go on.`;
  setStatus(r.match ? 'Your line came through right.' : 'Was that the phone, or a slip?', '', 'rec');
  try {
    for (;;) {
      const act = await recWait();
      if (act === 'recLearn' && spans.length) {
        await voices.addHabits(item, key, spans);
        log(`record: learned ${spans.length} habit(s) for ${key}`);
        return 'next';
      }
      if (act === 'recRedo' || act === 'recRetake') return 'redo';
      if (act === 'recKeep' || act === 'recNext' || act === 'recSkip') return 'next';
      if (act === 'recDone') return 'done';
      if (act === 'recPlay') await voices.playClip(clip).catch(() => {});
    }
  } finally { $('recCheck').hidden = true; }
}

async function runRecord() {
  if (running) return;
  running = true;
  renderScript();
  const scene = script.scenes[Number($('scene').value) || 0];
  const list = steps.filter((st) => st.item.kind === 'line');
  if (!list.length) { setStatus('Nothing to record in this scene at these settings.', '', 'problem'); running = false; return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (err) { setStatus('Microphone blocked. Allow it in Chrome settings.', '', 'problem'); log(`record: microphone failed: ${err.message}`); running = false; return; }
  await keepAwake();
  voices.audio();
  log(`record: storage protected from automatic clearing: ${await voices.askToKeep()}`);
  const have = await Promise.all(list.map((st) => voices.getClip(st.item.id).then((c) => voices.clipFits(c, st.item)).catch(() => false)));
  let i = have.findIndex((h) => !h);
  if (i < 0) i = 0;
  log(`record start: ${scene.title}; ${have.filter(Boolean).length} of ${list.length} lines already recorded; starting at line ${i + 1}`);
  $('runControls').hidden = true;
  $('recPanel').hidden = false;
  let take = null;
  // Locking the phone or switching apps drops the take in progress; it starts again on return.
  const onHide = () => { if (document.hidden && take) { take.cancel(); take = null; log('record: the phone was locked or switched away; that take was dropped'); if (recTap) { const r = recTap; recTap = null; r('dropped'); } } };
  document.addEventListener('visibilitychange', onHide);
  try {
    while (i < list.length) {
      const st = list[i];
      highlight(steps.indexOf(st));
      const reader = st.action === 'listen' ? 'You read your own line' : (voiceFor(st.item.who, 1).kind === 'man' ? `You read ${st.item.who}` : `Your daughter reads ${st.item.who}`);
      $('recInfo').textContent = `Line ${i + 1} of ${list.length}. ${reader}, then tap Next.${have[i] ? ' (Already recorded; Next replaces it.)' : ''}`;
      setStatus(`Recording ${st.item.who}. Tap Next when done.`, '', 'rec');
      if (document.hidden) await new Promise((r) => document.addEventListener('visibilitychange', r, { once: true }));
      take = voices.startTake(stream);
      const act = await recWait();
      const t = take; take = null;
      if (act === 'dropped' || !t) continue;
      if (act !== 'recNext') {
        t.cancel();
        if (act === 'recSkip') i++;
        else if (act === 'recBack') i = Math.max(0, i - 1);
        else if (act === 'recDone') break;
        else if (act === 'recPlay') {
          const c = await voices.getClip(st.item.id).catch(() => null);
          if (voices.clipFits(c, st.item)) { setStatus('Playing the saved take...', '', 'cue'); await voices.playClip(c).catch(() => {}); }
          else { setStatus('No saved take for this line yet.', '', 'problem'); await sleep(1200); }
        }
        continue; // Retake, Play and the rest start this line again
      }
      const blob = await t.stop();
      if (blob.size < 1500 || Date.now() - t.startedAt < 600) { setStatus('Nothing was recorded. Read the line again.', '', 'problem'); await sleep(1500); continue; }
      const clip = { id: st.item.id, text: st.item.text, who: st.item.who, scene: scene.title, version: script.version || '', mime: blob.type, blob, savedAt: Date.now() };
      try { await voices.putClip(clip); }
      catch (err) { setStatus(`Could not save that take (${err.message}). Read it again.`, '', 'problem'); log(`record: save failed: ${err.message}`); await sleep(2000); continue; }
      have[i] = true;
      log(`record: saved line ${i + 1} of ${list.length} (${st.item.who}, ${Math.round(blob.size / 1024)} KB)`);
      markRecorded();
      if (st.action === 'listen') {
        const next = await checkMyTake(st.item, clip);
        if (next === 'redo') continue;
        if (next === 'done') break;
      }
      i++;
    }
  } finally {
    if (take) take.cancel();
    document.removeEventListener('visibilitychange', onHide);
    stream.getTracks().forEach((tr) => tr.stop());
    $('recPanel').hidden = true;
    $('recCheck').hidden = true;
    $('runControls').hidden = false;
    running = false;
  }
  const done = have.filter(Boolean).length;
  log(`record end: ${done} of ${list.length} lines recorded`);
  setStatus(`Recorded ${done} of ${list.length} lines.${done ? ' Back up in "Recorded voices" below.' : ''}`, '', 'done');
  refreshVoicesBox();
}

// ---------- recorded voices and phone habits, in settings ----------
async function refreshVoicesBox() {
  let clips = [], habits = [];
  try { clips = await voices.allClips(); habits = await voices.allHabits(); } catch (err) { $('voicesCount').textContent = `Storage unavailable: ${err.message}`; return; }
  const n = habits.reduce((s, h) => s + h.items.length, 0);
  $('voicesCount').textContent = `${clips.length} recorded line${clips.length === 1 ? '' : 's'} and ${n} phone habit${n === 1 ? '' : 's'} on this phone.`;
  const ul = $('habitList');
  ul.innerHTML = '';
  for (const h of habits) {
    h.items.forEach((sp, k) => {
      const li = document.createElement('li');
      li.textContent = `"${sp.heard.join(' ')}" for "${sp.written.join(' ')}" in "${cleanText(h.text).slice(0, 60)}" (${h.engine})`;
      const del = document.createElement('button');
      del.textContent = 'Forget';
      del.onclick = async () => { await voices.removeHabit(h.key, k); log(`habit forgotten: "${sp.heard.join(' ')}" for "${sp.written.join(' ')}"`); refreshVoicesBox(); };
      li.append(del);
      ul.append(li);
    });
  }
  if (!n) { const li = document.createElement('li'); li.className = 'note'; li.textContent = 'None yet.'; ul.append(li); }
}

async function backupVoices() {
  try {
    const { file, clips, habits } = await voices.backupFile(script && script.version);
    log(`backup: ${clips} recordings, ${habits} habit entries, ${Math.round(file.size / 1024)} KB`);
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Line Runner voices backup' }); setStatus('Backup shared.', '', 'idle'); return; }
      catch (err) { if (err.name === 'AbortError') { setStatus('Backup not sent.', '', 'idle'); return; } log(`backup: share failed (${err.message}); saving instead`); }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    setStatus('Backup saved to Downloads.', '', 'idle');
  } catch (err) { setStatus(`Backup failed: ${err.message}`, '', 'problem'); log(`backup failed: ${err.message}`); }
}

async function restoreVoices(file) {
  try {
    const r = await voices.restoreFile(file);
    log(`restore: ${r.clips} of ${r.clipsInFile} recordings and ${r.habits} of ${r.habitsInFile} habit entries are now on this phone`);
    setStatus(`Restored ${r.clips} of ${r.clipsInFile} recordings and ${r.habits} of ${r.habitsInFile} habit entries.`, '', r.clips === r.clipsInFile ? 'idle' : 'problem');
    refreshVoicesBox();
    if (!running) renderScript();
  } catch (err) { setStatus(`Restore failed: ${err.message}`, '', 'problem'); log(`restore failed: ${err.message}`); }
}

async function runScene() {
  if (running) return;
  if ($('mode').value === 'record') return runRecord();
  running = true; paused = false; restarts = 0; madeUpSeen = [];
  store.set('ll-gap', $('gap').value);
  renderScript();
  await keepAwake();
  voices.audio(); // wake the audio player on this tap, for recorded voices
  let listenWith = 'Google';
  runEngine = 'google';
  if (!SIM && engine() !== 'google') {
    setStatus('Getting the on-phone listener ready...', '', 'idle');
    const ok = await startMoonScene();
    listenWith = ok ? `Moonshine ${moon.size} on the phone` : 'Google (Moonshine unavailable)';
    if (ok) runEngine = `moon-${moon.size}`;
  }
  const rec = await loadSceneClips();
  log(`scene start: ${script.scenes[Number($('scene').value) || 0].title}; wait ${$('gap').value}s; listening with ${listenWith}${listenWith === 'Google' ? `; continuous ${$('continuous').checked}` : ''}; recorded voices for ${rec.recorded} of ${rec.cues} cue lines`);
  for (let i = 0; i < steps.length && running; i++) {
    const { action, item } = steps[i];
    if (action === 'show' || action === 'skip') continue;
    if (action === 'cue') { if ($('mode').value === 'drill') highlight(i); lastCue = stripDirections(item.text); lastCueItem = item; await sayOther(item.text, item.who, item); continue; }
    highlight(i);
    if (action === 'speak') {
      if (item.kind === 'song') { await sayOther(`Song. ${item.title.replace(/^#\S+\s*/, '')}.`); continue; }
      lastCue = stripDirections(item.text);
      lastCueItem = item;
      await sayOther(item.text, item.who, item);
      continue;
    }
    const expected = stripDirections(item.text);
    const soundOnly = isSoundOnly(expected);
    const { heard, prompted, phoneRestarts } = await awaitMyLine(expected, soundOnly);
    // Habits he taught the phone for this line and this listener are turned back into script words first.
    const habits = soundOnly ? [] : await voices.getHabits(item, runEngine).catch(() => []);
    const fixed = habits.length ? applyHabits(expected, heard, habits) : { text: heard, used: 0 };
    const result = soundOnly ? { match: true, missing: [], extra: [], likelyMishearing: false } : compareLine(expected, fixed.text);
    result.habitUsed = fixed.used;
    log(`line ${i}: ${result.match ? 'matched' : (result.likelyMishearing ? 'probably misheard' : 'differs')}${result.habitUsed ? `, phone habit allowed x${result.habitUsed}` : ''}${result.restarted ? ', restarted' : ''}${prompted ? ', prompted' : ''}${phoneRestarts ? `, phone stopped listening ${phoneRestarts}x mid-line` : ''} | heard: "${heard}"${result.match ? '' : ` | missing: ${result.missing.join(' ')} | extra: ${result.extra.join(' ')}`}`);
    if (result.madeUp && result.madeUp.length) log(`  made-up words: ${result.madeUp.map((m) => `${m.written} -> "${m.heard}" (${m.close ? 'close' : 'check'})`).join('; ')}`);
    showHeard(i, heard, result, prompted, phoneRestarts, item, expected);
    if (result.madeUp && result.madeUp.length) {
      madeUpSeen.push(...result.madeUp);
      // In the drill, flash the made-up words big right after he says them, to check himself.
      if ($('mode').value === 'drill') await flashBig(madeUpWords(item.text).join('  ·  '));
    }
  }
  stopListening();
  stopMoonScene();
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
    `settings: wait ${$('gap').value}s, listen with ${engine()}, continuous ${$('continuous').checked}, on-phone ${$('local').checked}`,
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
  const savedMode = store.get('ll-mode');
  $('mode').value = savedMode === 'drill' || savedMode === 'record' ? savedMode : 'run';
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
  for (const id of REC_BUTTONS) $(id).onclick = () => { if (recTap) { const r = recTap; recTap = null; r(id); } };
  $('backup').onclick = backupVoices;
  $('restoreFile').onchange = () => { const f = $('restoreFile').files[0]; if (f) restoreVoices(f); $('restoreFile').value = ''; };
  refreshVoicesBox();

  const savedEngine = store.get('ll-engine');
  if (savedEngine && [...$('engine').options].some((o) => o.value === savedEngine)) $('engine').value = savedEngine;
  $('engine').onchange = () => {
    store.set('ll-engine', $('engine').value);
    // Fetch the model now, while he's still in settings, rather than at Start.
    if (engine() !== 'google' && !running && !SIM) loadMoon().then((ok) => { if (!running) setStatus(ok ? 'On-phone listener ready. Tap Start.' : 'On-phone listener unavailable; using Google.', '', 'idle'); });
  };

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
