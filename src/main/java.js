'use strict';
// Rilevamento e download automatico di Java (Eclipse Temurin via API Adoptium).

const path = require('path');
const os = require('os');
const fsp = require('fs/promises');
const { execFile } = require('child_process');
const { download, exists, httpRequest } = require('./util');
const zip = require('./zip');

const IS_WIN = process.platform === 'win32';
const JAVA_BIN = IS_WIN ? 'java.exe' : 'java';

function javaVersionOf(javaPath) {
  return new Promise((resolve) => {
    execFile(javaPath, ['-version'], { timeout: 15000, windowsHide: true }, (err, stdout, stderr) => {
      const out = String(stderr || '') + String(stdout || '');
      const m = out.match(/version "([^"]+)"/);
      if (!m) return resolve(null);
      const v = m[1];
      const major = v.startsWith('1.') ? parseInt(v.split('.')[1], 10) : parseInt(v, 10);
      resolve({ path: javaPath, version: v, major, vendor: (out.match(/^(.*Runtime Environment.*)$/m) || [])[1] || '' });
    });
  });
}

async function safeReaddir(dir) {
  try { return await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return []; }
}

/** Cerca java.exe in una cartella fino a una certa profondità. */
async function findJavaIn(dir, depth = 4) {
  const found = [];
  const direct = path.join(dir, 'bin', JAVA_BIN);
  if (await exists(direct)) { found.push(direct); return found; }
  if (depth <= 0) return found;
  for (const e of await safeReaddir(dir)) {
    if (e.isDirectory()) found.push(...await findJavaIn(path.join(dir, e.name), depth - 1));
  }
  return found;
}

class JavaManager {
  constructor(store) {
    this.store = store;
    this.cache = null;
  }

  get dir() { return this.store.paths.java; }

  candidateRoots() {
    const roots = [this.dir];
    const env = process.env;
    if (env.JAVA_HOME) roots.push(env.JAVA_HOME);
    if (IS_WIN) {
      const pf = [env.ProgramFiles, env['ProgramFiles(x86)'], 'C:\\Program Files'].filter(Boolean);
      for (const p of pf) {
        for (const vendor of ['Eclipse Adoptium', 'Java', 'Microsoft', 'Zulu', 'BellSoft', 'Amazon Corretto', 'Semeru', 'GraalVM']) roots.push(path.join(p, vendor));
      }
      if (env.APPDATA) roots.push(path.join(env.APPDATA, '.minecraft', 'runtime'));
      if (env.LOCALAPPDATA) {
        roots.push(path.join(env.LOCALAPPDATA, 'Packages', 'Microsoft.4297127D64EC6_8wekyb3d8bbwe', 'LocalCache', 'Local', 'runtime'));
        roots.push(path.join(env.LOCALAPPDATA, 'Programs', 'Eclipse Adoptium'));
      }
      roots.push(path.join(os.homedir(), '.jdks'));
    } else {
      roots.push('/usr/lib/jvm', '/opt/java', '/Library/Java/JavaVirtualMachines');
    }
    return [...new Set(roots)];
  }

  /** Elenca tutte le installazioni Java trovate sul PC. */
  async list(force = false) {
    if (this.cache && !force) return this.cache;
    const paths = new Set();
    for (const r of this.candidateRoots()) {
      if (!(await exists(r))) continue;
      for (const p of await findJavaIn(r, r === this.dir ? 2 : 4)) paths.add(path.normalize(p));
    }
    const results = [];
    for (const p of paths) {
      const info = await javaVersionOf(p);
      if (info) results.push(Object.assign(info, { managed: p.startsWith(path.normalize(this.dir)) }));
    }
    // anche il java nel PATH
    const pathJava = await javaVersionOf(JAVA_BIN);
    if (pathJava && !results.some((r) => r.version === pathJava.version)) results.push(Object.assign(pathJava, { managed: false, fromPath: true }));
    results.sort((a, b) => b.major - a.major);
    this.cache = results;
    return results;
  }

  /**
   * Restituisce il percorso di un Java con la versione richiesta, scaricandolo se manca.
   * Preferisce la versione esatta; per Java >= 17 accetta anche versioni più recenti se exactOnly è false.
   */
  async ensure(major, { onProgress, exactOnly = false } = {}) {
    const list = await this.list();
    const exact = list.find((j) => j.major === major && j.managed) || list.find((j) => j.major === major);
    if (exact) return exact.path;
    if (!exactOnly && major >= 17) {
      const newer = list.filter((j) => j.major > major && j.major <= major + 4).sort((a, b) => a.major - b.major)[0];
      if (newer) return newer.path;
    }
    return this.install(major, { onProgress });
  }

  async install(major, { onProgress } = {}) {
    const osName = IS_WIN ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
    const ext = IS_WIN ? 'zip' : 'tar.gz';
    const target = path.join(this.dir, `temurin-${major}`);
    const archive = path.join(this.store.paths.cache, `temurin-${major}.${ext}`);
    let lastErr;
    for (const imageType of ['jre', 'jdk']) {
      const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${osName}/${arch}/${imageType}/hotspot/normal/eclipse?project=jdk`;
      try {
        if (onProgress) onProgress(0, `Scarico Java ${major} (${imageType.toUpperCase()})…`);
        await download(url, archive, { onProgress: (p) => onProgress && onProgress(p, `Scarico Java ${major}…`) });
        lastErr = null;
        break;
      } catch (e) { lastErr = e; }
    }
    if (lastErr) throw new Error(`Impossibile scaricare Java ${major}: ${lastErr.message}`);
    if (onProgress) onProgress(null, `Estraggo Java ${major}…`);
    await fsp.rm(target, { recursive: true, force: true });
    await fsp.mkdir(target, { recursive: true });
    if (IS_WIN) await zip.extract(archive, target);
    else await new Promise((res, rej) => execFile('tar', ['-xzf', archive, '-C', target], (e) => (e ? rej(e) : res())));
    await fsp.rm(archive, { force: true });
    const found = await findJavaIn(target, 3);
    if (!found.length) throw new Error('Java scaricato ma java.exe non trovato');
    this.cache = null;
    return found[0];
  }

  /** Verifica rapidamente che l'API Adoptium risponda (per la pagina diagnostica). */
  async ping() {
    try { await httpRequest('https://api.adoptium.net/v3/info/available_releases'); return true; } catch (_) { return false; }
  }
}

module.exports = { JavaManager, javaVersionOf };
