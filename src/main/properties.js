'use strict';
// Lettura/scrittura di server.properties preservando ordine e commenti.
// Gestisce gli escape del formato Java Properties (\uXXXX, \\, \:, \=).

const fsp = require('fs/promises');

function unescapeValue(s) {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c) => {
    if (c[0] === 'u' && c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16));
    if (c === 't') return '\t';
    if (c === 'n') return '\n';
    if (c === 'r') return '\r';
    if (c === 'f') return '\f';
    return c;
  });
}

function escapeValue(s) {
  let out = '';
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code > 0x7e || code < 0x20) {
      // i caratteri fuori dal BMP vanno spezzati in coppie surrogate
      const str = ch;
      for (let i = 0; i < str.length; i++) out += '\\u' + str.charCodeAt(i).toString(16).padStart(4, '0');
    } else out += ch;
  }
  return out;
}

function escapeKey(k) {
  return escapeValue(k).replace(/([=: ])/g, '\\$1');
}

/** Restituisce { lines: [{type:'comment'|'blank'|'prop', raw, key, value}], map: {key:value} } */
function parse(text) {
  const lines = [];
  const map = {};
  const rawLines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i];
    const trimmed = line.trim();
    if (!trimmed) { lines.push({ type: 'blank', raw: line }); continue; }
    if (trimmed[0] === '#' || trimmed[0] === '!') { lines.push({ type: 'comment', raw: line }); continue; }
    // continuazione di riga con backslash finale
    while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < rawLines.length) {
      line = line.slice(0, -1) + rawLines[++i].replace(/^\s+/, '');
    }
    const m = line.replace(/^\s+/, '').match(/^((?:\\.|[^=:\s\\])*)\s*[=:\s]\s*(.*)$/);
    let key; let value;
    if (m) { key = unescapeValue(m[1]); value = unescapeValue(m[2]); } else { key = unescapeValue(line.trim()); value = ''; }
    lines.push({ type: 'prop', key, value });
    map[key] = value;
  }
  return { lines, map };
}

function serialize(parsed, updates = {}, removed = []) {
  const done = new Set();
  const out = [];
  for (const l of parsed.lines) {
    if (l.type !== 'prop') { out.push(l.raw); continue; }
    if (removed.includes(l.key)) continue;
    const v = Object.prototype.hasOwnProperty.call(updates, l.key) ? updates[l.key] : l.value;
    out.push(`${escapeKey(l.key)}=${escapeValue(v)}`);
    done.add(l.key);
  }
  for (const [k, v] of Object.entries(updates)) {
    if (!done.has(k) && !removed.includes(k)) out.push(`${escapeKey(k)}=${escapeValue(v)}`);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

async function readFile(file) {
  let text = '';
  try { text = await fsp.readFile(file, 'utf8'); } catch (_) {}
  return parse(text);
}

async function update(file, updates, removed = []) {
  const parsed = await readFile(file);
  const text = serialize(parsed, updates, removed);
  await fsp.writeFile(file, text, 'utf8');
  return parse(text).map;
}

module.exports = { parse, serialize, readFile, update, escapeValue, unescapeValue };
