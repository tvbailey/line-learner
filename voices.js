// Recorded voices and learned phone habits, kept only on this phone (IndexedDB), with a backup
// file Thomas can share wherever he likes and restore from. Browser-only; the tested logic for
// habits lives in habits.js.

const DB_NAME = 'line-runner';
const DB_VERSION = 1;
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('clips')) d.createObjectStore('clips', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('habits')) d.createObjectStore('habits', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    let result;
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('storage write was aborted'));
  });
}

// ---------- clips ----------
// A clip belongs to a line id, and also remembers the line's words and speaker: if the script
// changes and an id ends up pointing at different words, the clip is not played.
export const getClip = (id) => run('clips', 'readonly', (s) => s.get(id));
export const putClip = (rec) => run('clips', 'readwrite', (s) => s.put(rec));
export const allClips = () => run('clips', 'readonly', (s) => s.getAll());
export function clipFits(clip, item) { return !!clip && clip.text === item.text && clip.who === item.who; }

// ---------- habits ----------
// One entry per line and listening engine: { key, lineId, engine, text, items: [spans] }.
export const habitKey = (lineId, engine) => `${lineId}|${engine}`;
export async function getHabits(item, engine) {
  const rec = await run('habits', 'readonly', (s) => s.get(habitKey(item.id, engine)));
  return rec && rec.text === item.text ? rec.items : [];
}
export async function addHabits(item, engine, spans) {
  const key = habitKey(item.id, engine);
  const rec = (await run('habits', 'readonly', (s) => s.get(key))) || { key, lineId: item.id, engine, text: item.text, who: item.who, items: [] };
  const sameSpan = (a, b) => a.before === b.before && a.after === b.after && a.written.join(' ') === b.written.join(' ') && a.heard.join(' ') === b.heard.join(' ');
  for (const sp of spans) if (!rec.items.some((x) => sameSpan(x, sp))) rec.items.push(sp);
  rec.text = item.text;
  await run('habits', 'readwrite', (s) => s.put(rec));
  return rec.items.length;
}
export const allHabits = () => run('habits', 'readonly', (s) => s.getAll());
export async function removeHabit(key, index) {
  const rec = await run('habits', 'readonly', (s) => s.get(key));
  if (!rec) return;
  rec.items.splice(index, 1);
  await run('habits', 'readwrite', (s) => (rec.items.length ? s.put(rec) : s.delete(key)));
}

// Ask the browser not to clear this site's storage when the phone runs low. It may say no; the
// backup file is the real safety net.
export async function askToKeep() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch (_) { return false; }
}

// ---------- backup and restore ----------
function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
function fromBase64(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

// The backup is a text file (so the phone's Share menu will take it) holding JSON.
export async function backupFile(scriptVersion) {
  const clips = await allClips();
  const habits = await allHabits();
  const out = {
    format: 'line-runner-backup', formatVersion: 1, created: new Date().toISOString(), scriptVersion,
    clips: await Promise.all(clips.map(async (c) => ({ ...c, blob: undefined, data: await toBase64(c.blob) }))),
    habits,
  };
  const day = new Date().toISOString().slice(0, 10);
  return { file: new File([JSON.stringify(out)], `line-runner-voices-${day}.txt`, { type: 'text/plain' }), clips: clips.length, habits: habits.length };
}

// Restores a backup file, merging over what's here (same line, the backup's copy wins). The
// counts returned are what was read back from storage afterward, not just what was attempted.
export async function restoreFile(file) {
  const data = JSON.parse(await file.text());
  if (!data || data.format !== 'line-runner-backup') throw new Error('this is not a Line Runner backup file');
  for (const c of data.clips || []) {
    const { data: b64, ...rest } = c;
    await putClip({ ...rest, blob: fromBase64(b64, c.mime || 'audio/webm') });
  }
  for (const h of data.habits || []) await run('habits', 'readwrite', (s) => s.put(h));
  const ids = new Set((await allClips()).map((c) => c.id));
  const keys = new Set((await allHabits()).map((h) => h.key));
  return {
    clips: (data.clips || []).filter((c) => ids.has(c.id)).length, clipsInFile: (data.clips || []).length,
    habits: (data.habits || []).filter((h) => keys.has(h.key)).length, habitsInFile: (data.habits || []).length,
  };
}

// ---------- recording ----------
// One take: records from start until stop(); stop() resolves with the finished recording only
// after the recorder has handed over its last piece of audio.
export function startTake(stream) {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  const mimeType = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve) => { rec.onstop = () => resolve(); });
  rec.start();
  const startedAt = Date.now();
  return {
    mime: rec.mimeType || mimeType || 'audio/webm',
    startedAt,
    async stop() {
      if (rec.state !== 'inactive') rec.stop();
      await stopped;
      return new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' });
    },
    cancel() { try { if (rec.state !== 'inactive') rec.stop(); } catch (_) { /* already stopped */ } },
  };
}

// ---------- playback ----------
// Plays a recorded clip, skipping the silence before and after the speech (a take starts when
// the line appears and ends at a tap, so both ends have quiet). Resolves when it has finished.
let ctx = null;
const decoded = new Map();
export function audio() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => { /* resumes on the next tap */ });
  return ctx;
}
export async function decodeClip(clip) {
  const key = `${clip.id}|${clip.savedAt}`;
  if (decoded.has(key)) return decoded.get(key);
  const buf = await audio().decodeAudioData(await clip.blob.arrayBuffer());
  decoded.set(key, buf);
  return buf;
}
function speechBounds(buf) {
  const d = buf.getChannelData(0);
  const step = Math.max(1, Math.floor(buf.sampleRate / 100)); // 10 ms windows
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const floor = Math.max(0.02, peak * 0.08);
  let first = -1, last = -1;
  for (let i = 0; i < d.length; i += step) {
    let m = 0;
    for (let k = i; k < Math.min(d.length, i + step); k++) m = Math.max(m, Math.abs(d[k]));
    if (m >= floor) { if (first < 0) first = i; last = i + step; }
  }
  if (first < 0) return { start: 0, end: buf.duration };
  const pad = 0.15;
  return { start: Math.max(0, first / buf.sampleRate - pad), end: Math.min(buf.duration, last / buf.sampleRate + pad) };
}
export async function playClip(clip) {
  const buf = await decodeClip(clip);
  const { start, end } = speechBounds(buf);
  const ac = audio();
  return new Promise((resolve) => {
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    // A safety net in case "ended" never arrives, as speech sometimes doesn't.
    const timer = setTimeout(resolve, (end - start) * 1000 + 3000);
    src.onended = () => { clearTimeout(timer); resolve(); };
    src.start(0, start, Math.max(0.1, end - start));
  });
}
