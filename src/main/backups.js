'use strict';
// Backup locali: creazione sicura anche a server acceso (save-off / save-all), ripristino, rotazione, pianificazione.

const path = require('path');
const fsp = require('fs/promises');
const { exists, readJson, writeJson } = require('./util');
const zip = require('./zip');
const properties = require('./properties');
const { BUKKIT_TYPES } = require('./worlds');

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
    if (!server) throw new Error('Server non trovato');
    if (this.busy.has(id)) throw new Error('C\'è già un backup in corso per questo server');
    this.busy.add(id);
    const running = this.servers.isRunning(id) && this.servers.rt(id).status === 'running';
    try {
      if (running) {
        this.servers.info(id, 'Backup: salvataggio del mondo in corso…');
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
      onProgress && onProgress(null, 'Creo l\'archivio di backup…');
      await zip.createZip(out, items, { exclude, onProgress: (n) => onProgress && onProgress(null, `Backup: ${n} file…`) });
      const list = (await this.list(id)).filter((x) => x.file !== file);
      list.unshift({ file, createdAt: Date.now(), scope, level, label, auto, mcVersion: server.mcVersion, type: server.type });
      await this.saveIndex(id, list);
      await this.prune(id);
      return list[0];
    } finally {
      if (running && this.servers.isRunning(id)) {
        try { this.servers.send(id, 'save-on', { silent: true }); } catch (_) {}
        this.servers.info(id, 'Backup completato.');
      }
      this.busy.delete(id);
    }
  }

  /** Mantiene al massimo N backup automatici (quelli manuali non vengono toccati). */
  async prune(id) {
    const server = this.store.get(id);
    const keep = Math.max(1, Number(server && server.backupKeep) || 10);
    const list = await this.list(id);
    const autos = list.filter((b) => b.auto);
    const toDelete = autos.slice(keep);
    for (const b of toDelete) await fsp.rm(path.join(this.dir(id), b.file), { force: true });
    if (toDelete.length) await this.saveIndex(id, list.filter((b) => !toDelete.includes(b)));
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
    if (this.servers.isRunning(id)) throw new Error('Spegni il server prima di ripristinare un backup');
    const list = await this.list(id);
    const b = list.find((x) => x.file === file);
    if (!b) throw new Error('Backup non trovato');
    onProgress && onProgress(null, 'Backup di sicurezza dello stato attuale…');
    try { await this.create(id, { scope: 'world', label: 'Prima del ripristino', auto: false }); } catch (_) { /* mondo inesistente: ok */ }
    const archive = path.join(this.dir(id), file);
    const entries = await zip.listEntries(archive);
    const tops = [...new Set(entries.map((e) => e.replace(/\\/g, '/').split('/')[0]).filter(Boolean))];
    if (b.scope !== 'full') {
      for (const t of tops) {
        const p = path.resolve(server.dir, t);
        if (path.dirname(p) === path.resolve(server.dir)) await fsp.rm(p, { recursive: true, force: true });
      }
    }
    onProgress && onProgress(null, 'Ripristino i file…');
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
    const t = setInterval(() => {
      if (this.servers.rt(id).status !== 'running') return;
      this.create(id, { auto: true, label: 'Automatico' })
        .then(() => this.onAuto && this.onAuto(id, null))
        .catch((e) => this.onAuto && this.onAuto(id, e));
    }, minutes * 60e3);
    this.timers.set(id, t);
  }

  unschedule(id) {
    clearInterval(this.timers.get(id));
    this.timers.delete(id);
  }
}

module.exports = { BackupManager };
