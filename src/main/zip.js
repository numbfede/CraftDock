'use strict';
// Lettura/estrazione/creazione di archivi zip (mondi, backup, modpack, JRE).

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const yauzl = require('yauzl');
const archiver = require('archiver');

function openZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => (err ? reject(err) : resolve(zip)));
  });
}

function openStream(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream)));
  });
}

/** Itera le voci dell'archivio. fn(entry, zip) può essere async; restituire false interrompe. */
async function forEachEntry(file, fn) {
  const zip = await openZip(file);
  try {
    await new Promise((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', async (entry) => {
        try {
          const r = await fn(entry, zip);
          if (r === false) { resolve(); return; }
          zip.readEntry();
        } catch (e) { reject(e); }
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

async function listEntries(file) {
  const names = [];
  await forEachEntry(file, (e) => { names.push(e.fileName); });
  return names;
}

/** Legge una singola voce come Buffer (null se non esiste). */
async function readEntry(file, name) {
  let out = null;
  const wanted = Array.isArray(name) ? name : [name];
  await forEachEntry(file, async (entry, zip) => {
    if (!wanted.includes(entry.fileName)) return true;
    const stream = await openStream(zip, entry);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    out = Buffer.concat(chunks);
    return false;
  });
  return out;
}

/**
 * Estrae l'archivio in destDir. Protegge dallo "zip slip" (percorsi che escono dalla cartella).
 * opts.stripPrefix: rimuove un prefisso (es. "overrides/") e salta le voci che non lo hanno.
 * opts.filter(name): restituisce false per saltare una voce.
 */
async function extract(file, destDir, opts = {}) {
  const root = path.resolve(destDir);
  await fsp.mkdir(root, { recursive: true });
  let count = 0;
  await forEachEntry(file, async (entry, zip) => {
    let name = entry.fileName.replace(/\\/g, '/');
    if (opts.stripPrefix) {
      if (!name.startsWith(opts.stripPrefix)) return true;
      name = name.slice(opts.stripPrefix.length);
      if (!name) return true;
    }
    if (opts.filter && !opts.filter(name)) return true;
    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep)) return true; // zip slip
    if (name.endsWith('/')) {
      await fsp.mkdir(target, { recursive: true });
      return true;
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const stream = await openStream(zip, entry);
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(target);
      stream.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
      stream.pipe(ws);
    });
    count++;
    if (opts.onProgress && count % 50 === 0) opts.onProgress(count);
    return true;
  });
  return count;
}

/**
 * Crea uno zip. items: [{ path: assoluto, name: nome nell'archivio }]. Cartelle incluse ricorsivamente.
 * exclude(relPath) permette di saltare file (es. session.lock bloccato dal server).
 */
function createZip(outFile, items, { onProgress, exclude } = {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const tmp = outFile + '.part';
    const output = fs.createWriteStream(tmp);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', () => {
      fs.renameSync(tmp, outFile);
      resolve({ file: outFile, size: archive.pointer() });
    });
    archive.on('warning', (err) => { if (err.code !== 'ENOENT') reject(err); });
    archive.on('error', reject);
    if (onProgress) archive.on('progress', (p) => onProgress(p.entries.processed, p.fs.processedBytes));
    archive.pipe(output);
    for (const it of items) {
      let st;
      try { st = fs.statSync(it.path); } catch (_) { continue; }
      if (st.isDirectory()) {
        archive.directory(it.path, it.name, (entry) => {
          const rel = (it.name ? it.name + '/' : '') + entry.name;
          if (/(^|\/)session\.lock$/.test(rel)) return false;
          if (exclude && exclude(rel)) return false;
          return entry;
        });
      } else {
        archive.file(it.path, { name: it.name });
      }
    }
    archive.finalize();
  });
}

module.exports = { forEachEntry, listEntries, readEntry, extract, createZip };
