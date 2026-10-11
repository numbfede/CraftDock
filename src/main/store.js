'use strict';
// Persistenza di impostazioni e lista server (JSON nella cartella dati dell'app).

const path = require('path');
const os = require('os');
const fsp = require('fs/promises');
const { readJson, writeJson, uid } = require('./util');

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
      backups: path.join(root, 'backups'),
      java: path.join(root, 'java'),
      tools: path.join(root, 'tools'),
      cache: path.join(root, 'cache'),
    };
  }

  async ensureDirs() {
    for (const p of Object.values(this.paths)) await fsp.mkdir(p, { recursive: true });
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
    if (!s) throw new Error('Server non trovato');
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
