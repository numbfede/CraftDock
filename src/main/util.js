'use strict';
// Utility condivise dal processo principale: HTTP, download con progresso,
// confronto versioni, helper per file system.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const USER_AGENT = 'numbfede/CraftDock/1.0.0 (+https://numbfede.com)';

// In Electron usiamo net.fetch (stack di rete di Chromium, rispetta i proxy di sistema);
// fuori da Electron (test) ripieghiamo sul fetch globale di Node.
function getFetch() {
  try {
    const { net } = require('electron');
    if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  } catch (_) { /* non in Electron */ }
  return globalThis.fetch;
}

async function httpRequest(url, opts = {}) {
  const f = getFetch();
  const headers = Object.assign({ 'User-Agent': USER_AGENT }, opts.headers || {});
  let res;
  try {
    res = await f(url, Object.assign({}, opts, { headers }));
  } catch (e) {
    let host = url;
    try { host = new URL(url).host; } catch (_) {}
    throw new Error(`Impossibile contattare ${host}: controlla la connessione a internet (${e.message})`);
  }
  if (!res.ok) {
    let body = '';
    try { body = (await res.text()).slice(0, 300); } catch (_) {}
    const err = new Error(`HTTP ${res.status} su ${url}${body ? ' — ' + body : ''}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

async function getJson(url, opts) {
  const res = await httpRequest(url, opts);
  return res.json();
}

async function getText(url, opts) {
  const res = await httpRequest(url, opts);
  return res.text();
}

async function postJson(url, body, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  const res = await httpRequest(url, Object.assign({}, opts, { method: 'POST', headers, body: JSON.stringify(body) }));
  return res.json();
}

/**
 * Scarica un file su disco con callback di progresso (0..1, o null se dimensione ignota).
 * Scrive su un file .part e rinomina alla fine, così un download interrotto non lascia file corrotti.
 */
async function download(url, dest, { onProgress, headers, sha1 } = {}) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const res = await httpRequest(url, { headers, redirect: 'follow' });
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  const tmp = dest + '.part';
  const hash = sha1 ? crypto.createHash('sha1') : null;
  const body = Readable.fromWeb(res.body);
  let lastEmit = 0;
  body.on('data', (chunk) => {
    received += chunk.length;
    if (hash) hash.update(chunk);
    const now = Date.now();
    if (onProgress && now - lastEmit > 120) {
      lastEmit = now;
      onProgress(total ? received / total : null, received, total);
    }
  });
  await pipeline(body, fs.createWriteStream(tmp));
  if (hash) {
    const got = hash.digest('hex');
    if (got.toLowerCase() !== String(sha1).toLowerCase()) {
      await fsp.rm(tmp, { force: true });
      throw new Error(`Checksum non valido per ${path.basename(dest)}`);
    }
  }
  await fsp.rename(tmp, dest);
  if (onProgress) onProgress(1, received, total);
  return dest;
}

/** Confronta versioni Minecraft: "1.21.11" < "26.1" < "26.1.1". Ignora suffissi tipo "-pre1". */
function compareVersions(a, b) {
  const pa = String(a).split(/[-+ ]/)[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(/[-+ ]/)[0].split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const vGte = (a, b) => compareVersions(a, b) >= 0;

/** Java richiesto stimato quando non abbiamo il dato ufficiale da Mojang. */
function guessJavaMajor(mcVersion) {
  if (!mcVersion) return 21;
  if (vGte(mcVersion, '26.1')) return 25;
  if (vGte(mcVersion, '1.20.5')) return 21;
  if (vGte(mcVersion, '1.18')) return 17;
  if (vGte(mcVersion, '1.17')) return 16;
  return 8;
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch (_) { return false; }
}

async function readJson(p, fallback) {
  try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch (_) { return fallback; }
}

async function writeJson(p, data) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, p);
}

async function sha1File(p) {
  const hash = crypto.createHash('sha1');
  await pipeline(fs.createReadStream(p), hash);
  return hash.digest('hex');
}

async function dirSize(dir) {
  let total = 0;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return 0; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(full);
    else {
      try { total += (await fsp.stat(full)).size; } catch (_) {}
    }
  }
  return total;
}

async function copyDir(src, dest, filter) {
  await fsp.cp(src, dest, { recursive: true, force: true, filter: filter || (() => true) });
}

function slugify(s) {
  return String(s || 'server')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim().replace(/\s+/g, '-').toLowerCase().slice(0, 40) || 'server';
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Toglie i codici colore ANSI dall'output della console. */
function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = {
  USER_AGENT, httpRequest, getJson, getText, postJson, download,
  compareVersions, vGte, guessJavaMajor, exists, readJson, writeJson,
  sha1File, dirSize, copyDir, slugify, uid, stripAnsi, sleep,
};
