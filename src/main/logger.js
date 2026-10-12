'use strict';
/*
 * Log dell'app su file: <dati app>/logs/craftdock.log (massimo ~2 MB, poi ruota in craftdock.old.log).
 * Raccoglie console.log/warn/error del processo principale, gli errori non gestiti e quelli
 * dell'interfaccia. Serve per la diagnostica da mandare quando qualcosa non va.
 */
const fs = require('fs');
const path = require('path');

const MAX = 2 * 1024 * 1024;
let file = null;
let stream = null;
const recent = [];

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmt(args) {
  return args.map((a) => (a instanceof Error ? (a.stack || a.message) : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch (_) { return String(a); } })())).join(' ');
}

function write(level, args) {
  const line = `${stamp()} [${level}] ${fmt(args)}`;
  recent.push(line);
  if (recent.length > 400) recent.splice(0, recent.length - 400);
  if (!stream) return;
  try {
    stream.write(line + '\n');
    if (stream.bytesWritten > MAX) rotate();
  } catch (_) { /* il log non deve mai bloccare l'app */ }
}

function rotate() {
  try {
    stream.end();
    fs.renameSync(file, file.replace(/\.log$/, '.old.log'));
  } catch (_) {}
  stream = fs.createWriteStream(file, { flags: 'a' });
}

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'craftdock.log');
  try { if (fs.statSync(file).size > MAX) fs.renameSync(file, file.replace(/\.log$/, '.old.log')); } catch (_) {}
  stream = fs.createWriteStream(file, { flags: 'a' });
  for (const level of ['log', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => { write(level === 'log' ? 'info' : level, args); orig(...args); };
  }
  process.on('uncaughtException', (e) => write('fatal', [e]));
  process.on('unhandledRejection', (e) => write('error', ['Promise non gestita:', e]));
  write('info', ['---- avvio ----']);
  return file;
}

module.exports = {
  init,
  info: (...a) => write('info', a),
  warn: (...a) => write('warn', a),
  error: (...a) => write('error', a),
  file: () => file,
  dir: () => (file ? path.dirname(file) : null),
  recent: (n = 120) => recent.slice(-n),
};
