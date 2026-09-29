// Line Learner voice test: browser glue around core.js.
// Everything here is about Chrome's speech APIs; the testable logic lives in core.js.
import { compareLine, detectCommand, promptText, assembleTranscript, isLineFinished, stripDirections, isSoundOnly, cleanText, madeUpWords } from './core.js?v=20260929a';
import { parseScript } from './script.js?v=20260929a';
import { planScene, drillSteps } from './plan.js?v=20260929a';

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

function setStatus(text, cls = '') {
  $('status').textContent = text;
  $('status').className = 'status ' + cls;
}

// ---------- script display ----------
function loadScriptText(text, source) {
  let parsed;
  try { parsed = parseScript(text); }
  catch (err) { setStatus(`Script problem: ${err.message}`, 'paused'); log(`script problem: ${err.message}`); return false; }
  script = parsed;
  const names = new Set();
  script.scenes.forEach((sc) => sc.items.forEach((it) => { if (it.kind === 'line') names.add(it.who); }));
  me = names.has('THE OLD MAN') ? 'THE OLD MAN' : (names.has('OLD MAN') ? 'OLD MAN' : [...names][0]);
  const sel = $('scene');
  sel.innerHTML = '';
  script.scenes.forEach((sc, n) => { const o = document.createElement('option'); o.value = n; o.textContent = sc.title; sel.append(o); });
  const saved = store.get('ll-scene');
  if (saved && script.scenes[Number(saved)]) sel.value = saved;
  log(`script loaded (${source}): ${script.scenes.length} scene(s), version ${script.version || 'none'}, you are ${me}`);
  renderScript();
  return true;
}

function renderScript() {
  const scene = script.scenes[Number($('scene').value) || 0];
  const drill = $('mode').value === 'drill';
  // The drill takes every line with made-up words, songs included.
  steps = drill ? drillSteps(planScene(scene.items, me)) : planScene(scene.items, me, { skipSongs: $('skipSongs').checked });
  $('script').innerHTML = '';
  $('summary').hidden = true;
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
  if (el) { el.classList.add('now'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}

function showHeard(i, heard, result, prompted) {
  const el = $('ln' + i);
  const span = document.createElement('span');
  const ok = result.match && !prompted;
  span.className = 'heard ' + (ok ? 'ok' : 'bad');
  let note = heard ? `Heard: "${heard}"` : 'Heard: a sound (no words needed for this line)';
  if (prompted) note += ' (you asked for "line")';
  if (result.restarted) note += ' (you restarted, then got it)';
  if (result.missing.length || result.extra.length) note += ` | missing: ${result.missing.join(' ') || 'none'} | extra: ${result.extra.join(' ') || 'none'}`;
  if (result.likelyMishearing && !prompted) { note += ' | probably the phone mishearing'; span.className = 'heard maybe'; }
  if (result.checkMadeUp && !prompted && !result.missing.length && !result.extra.length) span.className = 'heard maybe';
  span.textContent = note;
  el.append(span);
  for (const m of result.madeUp || []) {
    const row = document.createElement('span');
    row.className = 'heard ' + (m.close ? 'ok' : 'maybe');
    row.textContent = `Script: ${m.written}  |  Phone heard: ${m.heard || '(nothing)'}  |  ${m.close ? 'sounds close' : 'check this one'}`;
    el.append(row);
  }
}

// ---------- speaking ----------
let voice = null;
function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  const sel = $('voice');
  const current = sel.value;
  sel.innerHTML = '';
  voices.forEach((v, n) => {
    const o = document.createElement('option');
    o.value = n; o.textContent = `${v.name} (${v.lang})`;
    sel.append(o);
  });
  if (current) sel.value = current;
  voice = voices[Number(sel.value) || 0] || null;
  sel.onchange = () => { voice = voices[Number(sel.value)] || null; };
  log(`voices available: ${voices.length}`);
}

let speaking = false;
function speak(text) {
  return new Promise((resolve) => {
    speaking = true;
    const done = (why) => { if (!speaking) return; speaking = false; clearTimeout(timer); if (why) log(`speech ${why}`); resolve(); };
    // Chrome sometimes never fires "end"; don't hang the scene waiting for it.
    const timer = setTimeout(() => done(SIM ? '' : 'timed out (no end event)'), SIM ? 300 : text.length * 90 + 3000);
    if (SIM || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
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
function resetHeard() { earlierSessions = []; currentResults = []; lastSpeechAt = 0; lastSoundAt = 0; }

function startListening() {
  wantListening = true;
  if (SIM) return;
  if (!Recognition) { setStatus('This browser cannot listen. Use Chrome.', 'paused'); return; }
  rec = new Recognition();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = $('continuous').checked;
  if ($('local').checked) rec.processLocally = true;
  rec.onresult = (e) => {
    currentResults = dedupe(Array.from(e.results).map((r) => ({ final: r.isFinal, text: r[0].transcript })));
    lastSpeechAt = Date.now();
  };
  rec.onsoundstart = () => { lastSoundAt = Date.now(); };
  rec.onsoundend = () => { lastSoundAt = Date.now(); };
  rec.onerror = (e) => {
    if (e.error === 'aborted') return; // our own stop between lines
    log(`listening error: ${e.error}`);
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      micBlocked = true; wantListening = false;
      setStatus('Microphone blocked. Allow it in Chrome settings.', 'paused');
    }
  };
  rec.onend = () => {
    if (currentResults.length) earlierSessions.push(currentResults.map((r) => r.text).join(' '));
    currentResults = [];
    if (wantListening && !micBlocked) {
      restarts++;
      log(`listening stopped by the phone; restarting (#${restarts})`);
      setTimeout(() => { if (wantListening) startListening(); }, 100);
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

async function sayOther(text) {
  stopListening();
  setStatus('Reading the cue...');
  await speak(cleanText(stripDirections(text)));
}

// Wait for one of his lines, handling commands, until he says a real line.
function awaitMyLine(expected, soundOnly = false) {
  return new Promise((resolve) => {
    let promptLevel = 0;
    let busy = false;
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
        if (!isLineFinished({ heardSomething, lastSpeechAt: lastHeard, now: Date.now(), gapMs: gapMs() })) return;
        cmd = detectCommand(utterance);
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
      resolve({ heard: utterance, prompted: promptLevel > 0 });
    }, 150);
  });
}

let madeUpSeen = [];

// Shows text big across the screen for a few seconds.
function flashBig(text) {
  return new Promise((resolve) => {
    $('big').textContent = text;
    $('big').hidden = false;
    setTimeout(() => { $('big').hidden = true; resolve(); }, 3500);
  });
}

// End of scene: every made-up word, the script's spelling beside what the phone heard.
function showSummary() {
  if (!madeUpSeen.length) return;
  const box = $('summary');
  box.innerHTML = '<b>Made-up words: script vs. what the phone heard</b>';
  for (const m of madeUpSeen) {
    const row = document.createElement('div');
    row.className = 'heard ' + (m.close ? 'ok' : 'maybe');
    row.textContent = `${m.written}  |  ${m.heard || '(nothing)'}  |  ${m.close ? 'sounds close' : 'check this one'}`;
    box.append(row);
  }
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
    if (action === 'cue') { if ($('mode').value === 'drill') highlight(i); lastCue = stripDirections(item.text); await sayOther(item.text); continue; }
    highlight(i);
    if (action === 'speak') {
      if (item.kind === 'song') { await sayOther(`Song. ${item.title.replace(/^#\S+\s*/, '')}.`); continue; }
      lastCue = stripDirections(item.text);
      await sayOther(item.text);
      continue;
    }
    const expected = stripDirections(item.text);
    const soundOnly = isSoundOnly(expected);
    const { heard, prompted } = await awaitMyLine(expected, soundOnly);
    const result = soundOnly ? { match: true, missing: [], extra: [], likelyMishearing: false } : compareLine(expected, heard);
    log(`line ${i}: ${result.match ? 'matched' : (result.likelyMishearing ? 'probably misheard' : 'differs')}${result.restarted ? ', restarted' : ''}${prompted ? ', prompted' : ''} | heard: "${heard}"${result.match ? '' : ` | missing: ${result.missing.join(' ')} | extra: ${result.extra.join(' ')}`}`);
    if (result.madeUp && result.madeUp.length) log(`  made-up words: ${result.madeUp.map((m) => `${m.written} -> "${m.heard}" (${m.close ? 'close' : 'check'})`).join('; ')}`);
    showHeard(i, heard, result, prompted);
    if (result.madeUp && result.madeUp.length) {
      madeUpSeen.push(...result.madeUp);
      // In the drill, flash the made-up words big right after he says them, to check himself.
      if ($('mode').value === 'drill') await flashBig(madeUpWords(item.text).join('  ·  '));
    }
  }
  stopListening();
  running = false;
  log(`scene end; listening restarts: ${restarts}`);
  showSummary();
  setStatus('Scene done. Red lines need work; orange ones were probably the phone mishearing you.');
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
    'Line Learner voice test report',
    `when: ${new Date().toString()}`,
    `browser: ${navigator.userAgent}`,
    `listening supported: ${!!(window.SpeechRecognition || window.webkitSpeechRecognition)}`,
    `settings: wait ${$('gap').value}s, continuous ${$('continuous').checked}, on-phone ${$('local').checked}`,
    `listening restarts: ${restarts}`,
    '', ...logLines,
  ].join('\n');
  try { await navigator.clipboard.writeText(report); setStatus('Report copied. Paste it to Reginald.'); }
  catch (_) { setStatus('Copy failed; open the Event log and copy it by hand.', 'paused'); }
}

// ---------- setup ----------
async function setup() {
  $('mode').value = store.get('ll-mode') === 'drill' ? 'drill' : 'run';
  $('mode').onchange = () => { store.set('ll-mode', $('mode').value); if (!running) renderScript(); };
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
  $('gap').oninput = () => { $('gapVal').textContent = $('gap').value; };
  $('start').onclick = runScene;
  $('pause').onclick = () => { tapCommand = paused ? 'resume' : 'pause'; };
  $('repeat').onclick = () => { tapCommand = 'repeat'; };
  $('lineBtn').onclick = () => { tapCommand = 'line'; };
  $('copy').onclick = copyReport;

  const cont = document.createElement('label');
  cont.innerHTML = '<input id="continuous" type="checkbox"> Continuous listening (compare on and off in the test)';
  $('localWrap').before(cont);

  if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (R && 'processLocally' in R.prototype) {
    $('localWrap').hidden = false;
    if (typeof R.available === 'function') {
      try { log(`on-phone listening: ${await R.available({ langs: ['en-US'], processLocally: true })}`); }
      catch (err) { log(`on-phone check failed: ${err.message}`); }
    }
  } else log('on-phone listening: not offered by this browser');
  if (!R && !SIM) setStatus('This browser cannot listen. Open it in Chrome.', 'paused');

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
