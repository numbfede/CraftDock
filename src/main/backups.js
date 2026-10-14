'use strict';
// Backup locali: creazione sicura anche a server acceso (save-off / save-all), ripristino, rotazione, pianificazione.

const path = require('path');
const fsp = require('fs/promises');
const { exists, readJson, writeJson } = require('./util');
const zip = require('./zip');
const properties = require('./properties');
const { BUKKIT_TYPES } = require('./worlds');

const { t } = require('../shared/i18n');
class BackupManager {
  constructor(store, servers) {
    this.store = store;
    this.servers = servers;
    this.timers = new Map();
    this.busy = new Set();
  }

  dir(id) { return this.store.backupDir(id); }
  indexFile(id) { return path.join(this.dir(id), 'backups.json'); }

  async list(id) {
    const index = await readJson(this.indexFile(id), []);
    const out = [];
    for (const b of index) {
      const file = path.join(this.dir(id), b.file);
      if (await exists(file)) {
        try { b.size = (await fsp.stat(file)).size; } catch (_) {}
        out.push(b);
      }
    }
    // backup zip aggiunti a mano nella cartella
    for (const f of await fsp.readdir(this.dir(id)).catch(() => [])) {
      if (f.endsWith('.zip') && !out.some((b) => b.file === f)) {
        const st = await fsp.stat(path.join(this.dir(id), f));
        out.push({ file: f, createdAt: st.mtimeMs, size: st.size, scope: 'world', label: 'Importato', auto: false });
      }
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }

  async saveIndex(id, list) {
    await writeJson(this.indexFile(id), list.map(({ size, ...rest }) => rest));
  }

  /**
   * Crea un backup. scope: 'world' (solo mondi attivi) | 'full' (intera cartella server, escluse librerie e cache).
   */
  async create(id, { scope = 'world', label = '', auto = false, onProgress } = {}) {
    const server = this.store.get(id);
    if (!server) throw new Error(t('Server non trovato'));
    if (this.busy.has(id)) throw new Error(t('C\'è già un backup in corso per questo server'));
    if (this.moving) throw new Error(t('Sto spostando la cartella dei backup: riprova quando ho finito.'));
    await this.ensureReachable(id);
    this.busy.add(id);
    const running = this.servers.isRunning(id) && this.servers.rt(id).status === 'running';
    try {
      if (running) {
        this.servers.info(id, t('Backup: salvataggio del mondo in corso…'));
        this.servers.send(id, 'save-off', { silent: true });
        await this.servers.sendAndWait(id, 'save-all flush', /Saved the game|Saved the world|ThreadedAnvilChunkStorage.*All dimensions are saved/i, 30000);
      }
      const props = await properties.readFile(path.join(server.dir, 'server.properties'));
      const level = props.map['level-name'] || 'world';
      const d = new Date();
      const p2 = (n) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;
      const file = `${stamp}${auto ? '-auto' : ''}-${scope}.zip`;
      const out = path.join(this.dir(id), file);
      let items;
      if (scope === 'full') {
        items = [{ path: server.dir, name: '' }];
      } else {
        items = [{ path: path.join(server.dir, level), name: level }];
        if (BUKKIT_TYPES.includes(server.type)) {
          items.push({ path: path.join(server.dir, level + '_nether'), name: level + '_nether' });
          items.push({ path: path.join(server.dir, level + '_the_end'), name: level + '_the_end' });
        }
      }
      const exclude = scope === 'full' ? (rel) => /^(libraries|cache|\.fabric|versions|logs|crash-reports)(\/|$)/.test(rel) || /\.jar\.part$/.test(rel) : null;
      onProgress && onProgress(null, t('Creo l\'archivio di backup…'));
      await zip.createZip(out, items, { exclude, onProgress: (n) => onProgress && onProgress(null, t('Backup: {n} file…', { n })) });
      const list = (await this.list(id)).filter((x) => x.file !== file);
      list.unshift({ file, createdAt: Date.now(), scope, level, label, auto, mcVersion: server.mcVersion, type: server.type });
      await this.saveIndex(id, list);
      await this.prune(id);
      return list[0];
    } finally {
      if (running && this.servers.isRunning(id)) {
        try { this.servers.send(id, 'save-on', { silent: true }); } catch (_) {}
        this.servers.info(id, t('Backup completato.'));
      }
      this.busy.delete(id);
    }
  }

  /** La cartella dei backup può stare su un disco esterno: se manca, un errore chiaro invece di ENOENT. */
  async ensureReachable(id) {
    try { await fsp.mkdir(this.dir(id), { recursive: true }); } catch (_) {
      throw new Error(t('La cartella dei backup ({dir}) non è raggiungibile. Se è su un disco esterno, collegalo; altrimenti scegline un\'altra in Impostazioni → Backup.', { dir: this.store.paths.backups }));
    }
  }

  /**
   * Backup da eliminare secondo la regola del server: si tengono gli ultimi N (0 = tutti).
   * Di base contano solo gli automatici; con backupPruneManual anche quelli fatti a mano.
   */
  async pruneCandidates(id, keep, includeManual) {
    const n = Number(keep);
    if (!n || n < 1) return [];
    const list = await this.list(id);
    const pool = list.filter((b) => includeManual || b.auto);
    return pool.slice(n);
  }

  async prunePreview(id, keep, includeManual) {
    const del = await this.pruneCandidates(id, keep, includeManual);
    return { count: del.length, size: del.reduce((a, b) => a + (b.size || 0), 0) };
  }

  async prune(id) {
    const server = this.store.get(id);
    if (!server) return 0;
    const keep = server.backupKeep === 0 ? 0 : (Number(server.backupKeep) || 10);
    const toDelete = await this.pruneCandidates(id, keep, !!server.backupPruneManual);
    for (const b of toDelete) await fsp.rm(path.join(this.dir(id), b.file), { force: true });
    if (toDelete.length) {
      const list = await this.list(id);
      await this.saveIndex(id, list);
    }
    return toDelete.length;
  }

  // ---------- spostamento della cartella dei backup (anche su un altro disco) ----------

  /** Calcola dove finiranno i backup e quanto spazio serve, senza toccare niente. */
  async planMove(chosen) {
    const from = path.resolve(this.store.paths.backups);
    if (!chosen) throw new Error(t('Scegli una cartella'));
    let to = path.resolve(chosen);
    // cartella non vuota: i backup vanno in una sottocartella dedicata, per non mescolarli ad altri file
    const entries = await fsp.readdir(to).catch(() => []);
    if (entries.filter((e) => !e.startsWith('.')).length && path.basename(to) !== 'CraftDock backup') to = path.join(to, 'CraftDock backup');
    const rel = path.relative(from, to);
    if (to === from) throw new Error(t('I backup sono già in questa cartella.'));
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error(t('La nuova cartella non può stare dentro quella attuale dei backup.'));
    const relBack = path.relative(to, from);
    if (relBack && !relBack.startsWith('..') && !path.isAbsolute(relBack)) throw new Error(t('La nuova cartella non può contenere quella attuale dei backup.'));
    const { bytes, files } = await dirStats(from);
    let free = null;
    try { const st = await fsp.statfs(await existingParent(to)); free = Number(st.bavail) * Number(st.bsize); } catch (_) {}
    const sameDrive = await sameDevice(from, to);
    return { from, to, bytes, files, free, sameDrive, enough: free === null || sameDrive || free > bytes * 1.02 + 50e6 };
  }

  /**
   * Sposta tutti i backup. Sullo stesso disco è un semplice rinomina; su un altro disco copia
   * ogni file, controlla le dimensioni e solo alla fine cancella gli originali.
   */
  async move(chosen, { onProgress } = {}) {
    if (this.busy.size) throw new Error(t('C\'è un backup in corso: aspetta che finisca.'));
    if (this.moving) throw new Error(t('Spostamento già in corso'));
    const plan = await this.planMove(chosen);
    if (!plan.enough) throw new Error(t('Spazio insufficiente: servono {need}, liberi {free}.', { need: fmtSize(plan.bytes), free: fmtSize(plan.free) }));
    this.moving = true;
    try {
      await fsp.mkdir(plan.to, { recursive: true });
      const top = await fsp.readdir(plan.from).catch(() => []);
      let done = 0;
      const step = (bytes) => { done += bytes; onProgress && onProgress(plan.bytes ? done / plan.bytes : null, t('Sposto i backup… {done} di {total}', { done: fmtSize(done), total: fmtSize(plan.bytes) })); };
      const copied = [];
      for (const name of top) {
        const src = path.join(plan.from, name);
        const dst = path.join(plan.to, name);
        if (await exists(dst)) throw new Error(t('Nella nuova cartella esiste già "{name}": svuotala o scegline un\'altra.', { name }));
        if (plan.sameDrive) {
          try { await fsp.rename(src, dst); step((await dirStats(dst)).bytes); continue; } catch (e) { if (e.code !== 'EXDEV') throw e; }
        }
        await copyTree(src, dst, step);
        copied.push(src);
      }
      // tutto copiato e verificato: ora si possono togliere gli originali
      for (const src of copied) await fsp.rm(src, { recursive: true, force: true });
      await fsp.rmdir(plan.from).catch(() => {});
      await this.store.saveConfig({ backupsDir: plan.to });
      return { to: plan.to, bytes: plan.bytes, files: plan.files };
    } finally {
      this.moving = false;
    }
  }

  async remove(id, file) {
    const p = path.resolve(this.dir(id), file);
    if (path.dirname(p) !== path.resolve(this.dir(id))) return;
    await fsp.rm(p, { force: true });
    const list = (await this.list(id)).filter((b) => b.file !== file);
    await this.saveIndex(id, list);
  }

  /** Ripristina un backup (il server deve essere spento). Fa prima un backup di sicurezza dello stato attuale. */
  async restore(id, file, { onProgress } = {}) {
    const server = this.store.get(id);
    if (this.servers.isRunning(id)) throw new Error(t('Spegni il server prima di ripristinare un backup'));
    const list = await this.list(id);
    const b = list.find((x) => x.file === file);
    if (!b) throw new Error(t('Backup non trovato'));
    onProgress && onProgress(null, t('Backup di sicurezza dello stato attuale…'));
    try { await this.create(id, { scope: 'world', label: 'Prima del ripristino', auto: false }); } catch (_) { /* mondo inesistente: ok */ }
    const archive = path.join(this.dir(id), file);
    const entries = await zip.listEntries(archive);
    const tops = [...new Set(entries.map((e) => e.replace(/\\/g, '/').split('/')[0]).filter(Boolean))];
    if (b.scope !== 'full') {
      for (const top of tops) {
        const p = path.resolve(server.dir, top);
        if (path.dirname(p) === path.resolve(server.dir)) await fsp.rm(p, { recursive: true, force: true });
      }
    }
    onProgress && onProgress(null, t('Ripristino i file…'));
    await zip.extract(archive, server.dir);
    if (b.level) await properties.update(path.join(server.dir, 'server.properties'), { 'level-name': b.level });
    return true;
  }

  /** (Ri)programma i backup automatici di un server mentre è acceso. */
  schedule(id) {
    clearInterval(this.timers.get(id));
    this.timers.delete(id);
    const server = this.store.get(id);
    const minutes = Number(server && server.autoBackupMinutes) || 0;
    if (!minutes || !this.servers.isRunning(id)) return;
    const timer = setInterval(() => {
      if (this.servers.rt(id).status !== 'running') return;
      this.create(id, { auto: true, label: 'Automatico' })
        .then(() => this.onAuto && this.onAuto(id, null))
        .catch((e) => this.onAuto && this.onAuto(id, e));
    }, minutes * 60e3);
    this.timers.set(id, timer);
  }

  unschedule(id) {
    clearInterval(this.timers.get(id));
    this.timers.delete(id);
  }
}

// ---------- utilità per lo spostamento ----------
async function dirStats(dir) {
  let bytes = 0; let files = 0;
  const walk = async (d) => {
    for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) { files++; bytes += (await fsp.stat(p)).size; }
    }
  };
  const st = await fsp.stat(dir).catch(() => null);
  if (st && st.isFile()) return { bytes: st.size, files: 1 };
  if (st) await walk(dir);
  return { bytes, files };
}

async function copyTree(src, dst, step) {
  const st = await fsp.stat(src);
  if (st.isDirectory()) {
    await fsp.mkdir(dst, { recursive: true });
    for (const name of await fsp.readdir(src)) await copyTree(path.join(src, name), path.join(dst, name), step);
    return;
  }
  await fsp.copyFile(src, dst);
  const copy = await fsp.stat(dst);
  if (copy.size !== st.size) throw new Error(t('Copia non riuscita per {file}: i backup originali non sono stati toccati.', { file: path.basename(src) }));
  step(st.size);
}

async function existingParent(p) {
  let cur = p;
  while (!(await exists(cur))) {
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return cur;
}

async function sameDevice(a, b) {
  try {
    const [sa, sb] = await Promise.all([fsp.stat(await existingParent(a)), fsp.stat(await existingParent(b))]);
    return sa.dev === sb.dev;
  } catch (_) { return false; }
}

function fmtSize(n) {
  if (n === null || n === undefined) return '?';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i ? 1 : 0)} ${u[i]}`;
}

module.exports = { BackupManager, dirStats, sameDevice };
