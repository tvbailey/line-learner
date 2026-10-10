// Reads the plain-text script format (see README) into scenes of items.
import { normalize } from './core.js?v=20261009b';

// Small stable hash (FNV-1a) so a line's id depends only on its own scene, speaker and words.
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

export function parseScript(text) {
  const out = { version: null, scenes: [] };
  let scene = null;
  const seen = new Map();
  const needScene = (n) => { if (!scene) throw new Error(`line ${n}: text before the first scene heading (# ...)`); };
  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (!line) return;
    let m;
    if ((m = line.match(/^@version\s+(.+)$/))) { out.version = m[1].trim(); return; }
    if ((m = line.match(/^#\s+(.+)$/))) { scene = { title: m[1].trim(), items: [] }; out.scenes.push(scene); return; }
    needScene(n);
    if ((m = line.match(/^\[SONG:\s*(.+?)\]$/i))) { scene.items.push({ kind: 'song', title: m[1].trim() }); return; }
    if (/^\[SKIP TO END OF SONG\]$/i.test(line)) { scene.items.push({ kind: 'skip' }); return; }
    if (/^\[END SONG\]$/i.test(line)) { scene.items.push({ kind: 'songEnd' }); return; }
    if ((m = line.match(/^\((.*)\)$/))) { scene.items.push({ kind: 'direction', text: m[1].trim() }); return; }
    if ((m = line.match(/^([A-Z0-9][A-Z0-9 .,&'-]*?):\s*(.+)$/))) {
      const who = m[1].trim();
      const sung = m[2].startsWith('~');
      const body = sung ? m[2].slice(1).trim() : m[2].trim();
      const key = `${scene.title}|${who}|${normalize(body).join(' ')}`;
      const count = (seen.get(key) || 0) + 1;
      seen.set(key, count);
      scene.items.push({ kind: 'line', id: hash(`${key}|${count}`), who, text: body, sung });
      return;
    }
    throw new Error(`line ${n}: cannot read "${line}"`);
  });
  return out;
}
