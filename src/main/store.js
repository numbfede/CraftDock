'use strict';
// Persistenza di impostazioni e lista server (JSON nella cartella dati dell'app).

const path = require('path');
const os = require('os');
const fsp = require('fs/promises');
const { readJson, writeJson, uid } = require('./util');

const { t } = require('../shared/i18n');
const DEFAULT_ROOT = path.join(os.homedir(), 'CraftDock');

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.configFile = path.join(dataDir, 'config.json');
    this.serversFile = path.join(dataDir, 'servers.json');
    this.config = null;
    this.servers = [];
  }

  async load() {
    const cfg = await readJson(this.configFile, {});
    this.config = Object.assign({
      root: DEFAULT_ROOT,
      defaultRamMb: Math.min(4096, Math.max(1024, Math.floor(os.totalmem() / 1024 / 1024 / 4 / 512) * 512)),
      closeToTray: false,
      language: 'auto',
      checkUpdates: true,
      confirmStopOnExit: true,
      showSnapshots: false,
      playit: { autoStart: false, publicAddress: '' },
    }, cfg);
    this.servers = await readJson(this.serversFile, []);
    await this.ensureDirs();
    return this;
  }

  get paths() {
    const root = this.config.root;
    return {
      root,
      servers: path.join(root, 'servers'),
      // i backup possono stare altrove (es. un disco più capiente): Impostazioni → Backup → Sposta
      backups: this.config.backupsDir || path.join(root, 'backups'),
      java: path.join(root, 'java'),
      tools: path.join(root, 'tools'),
      cache: path.join(root, 'cache'),
    };
  }

  async ensureDirs() {
    for (const [k, p] of Object.entries(this.paths)) {
      try { await fsp.mkdir(p, { recursive: true }); } catch (e) {
        // un disco esterno scollegato non deve impedire l'avvio: lo segnala il backup quando serve
        if (k !== 'backups') throw e;
      }
    }
  }

  async saveConfig(patch) {
    if (patch) this.config = Object.assign({}, this.config, patch);
    await writeJson(this.configFile, this.config);
    await this.ensureDirs();
    return this.config;
  }

  async saveServers() {
    await writeJson(this.serversFile, this.servers);
  }

  get(id) {
    return this.servers.find((s) => s.id === id) || null;
  }

  async add(server) {
    const s = Object.assign({
      id: uid(),
      createdAt: Date.now(),
      ramMb: this.config.defaultRamMb,
      jvmArgs: '',
      aikarFlags: true,
      autoRestart: true,
      autoBackupMinutes: 0,
      backupKeep: 10,
      backupPruneManual: false,
      backupOnStop: false,
      javaPath: '',
      port: 25565,
      publicAddress: '',
      notes: '',
    }, server);
    this.servers.push(s);
    await this.saveServers();
    return s;
  }

  async update(id, patch) {
    const s = this.get(id);
    if (!s) throw new Error(t('Server non trovato'));
    Object.assign(s, patch);
    await this.saveServers();
    return s;
  }

  async remove(id) {
    this.servers = this.servers.filter((s) => s.id !== id);
    await this.saveServers();
  }

  backupDir(id) {
    return path.join(this.paths.backups, id);
  }
}

module.exports = { Store, DEFAULT_ROOT };
