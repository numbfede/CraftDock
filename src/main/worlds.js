'use strict';
// Mondi: elenco, importazione (cartella, zip, salvataggi dei launcher), attivazione, reset, datapack.

const path = require('path');
const os = require('os');
const fsp = require('fs/promises');
const { exists, dirSize, copyDir } = require('./util');
const { readLevelInfo } = require('./nbt');
const properties = require('./properties');
const zip = require('./zip');

const BUKKIT_TYPES = ['paper', 'purpur'];

async function worldInfo(dir) {
  const info = { path: dir, folder: path.basename(dir), levelName: null, version: null, lastPlayed: null, gameMode: null, hardcore: false, icon: null };
  try {
    const buf = await fsp.readFile(path.join(dir, 'level.dat'));
    Object.assign(info, readLevelInfo(buf));
  } catch (_) {}
  try {
    const icon = await fsp.readFile(path.join(dir, 'icon.png'));
    info.icon = 'data:image/png;base64,' + icon.toString('base64');
  } catch (_) {}
  if (!info.lastPlayed) {
    try { info.lastPlayed = (await fsp.stat(path.join(dir, 'level.dat'))).mtimeMs; } catch (_) {}
  }
  return info;
}

async function isWorldDir(dir) { return exists(path.join(dir, 'level.dat')); }

class WorldManager {
  constructor(store) { this.store = store; }

  async levelName(server) {
    const props = await properties.readFile(path.join(server.dir, 'server.properties'));
    return props.map['level-name'] || 'world';
  }

  /** Mondi presenti nella cartella del server (esclude le dimensioni separate di Paper). */
  async list(server) {
    const active = await this.levelName(server);
    const out = [];
    for (const e of await fsp.readdir(server.dir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory()) continue;
      const full = path.join(server.dir, e.name);
      if (!(await isWorldDir(full))) continue;
      if (BUKKIT_TYPES.includes(server.type) && /_(nether|the_end)$/.test(e.name) && await isWorldDir(path.join(server.dir, e.name.replace(/_(nether|the_end)$/, '')))) continue;
      const info = await worldInfo(full);
      info.active = e.name === active;
      info.size = await dirSize(full);
      if (BUKKIT_TYPES.includes(server.type)) {
        info.size += await dirSize(full + '_nether') + await dirSize(full + '_the_end');
      }
      out.push(info);
    }
    out.sort((a, b) => (b.active - a.active) || (b.lastPlayed || 0) - (a.lastPlayed || 0));
    return { active, worlds: out };
  }

  /** Cerca i mondi singleplayer dei launcher più diffusi su questo PC. */
  async scanLocalSaves() {
    const env = process.env;
    const appdata = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const home = os.homedir();
    const sources = [
      { launcher: 'Minecraft Launcher', dir: path.join(appdata, '.minecraft', 'saves') },
    ];
    const instanceRoots = [
      { launcher: 'CurseForge', root: path.join(home, 'curseforge', 'minecraft', 'Instances'), sub: 'saves' },
      { launcher: 'Modrinth App', root: path.join(appdata, 'ModrinthApp', 'profiles'), sub: 'saves' },
      { launcher: 'Modrinth App', root: path.join(appdata, 'com.modrinth.theseus', 'profiles'), sub: 'saves' },
      { launcher: 'Prism Launcher', root: path.join(appdata, 'PrismLauncher', 'instances'), sub: path.join('.minecraft', 'saves') },
      { launcher: 'Prism Launcher', root: path.join(appdata, 'PrismLauncher', 'instances'), sub: path.join('minecraft', 'saves') },
      { launcher: 'MultiMC', root: path.join(home, 'MultiMC', 'instances'), sub: path.join('.minecraft', 'saves') },
      { launcher: 'ATLauncher', root: path.join(appdata, 'ATLauncher', 'instances'), sub: 'saves' },
      { launcher: 'GDLauncher', root: path.join(appdata, 'gdlauncher_carbon', 'data', 'instances'), sub: path.join('instance', 'saves') },
    ];
    for (const ir of instanceRoots) {
      for (const e of await fsp.readdir(ir.root, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory()) sources.push({ launcher: `${ir.launcher} · ${e.name}`, dir: path.join(ir.root, e.name, ir.sub) });
      }
    }
    const results = [];
    for (const s of sources) {
      for (const e of await fsp.readdir(s.dir, { withFileTypes: true }).catch(() => [])) {
        const full = path.join(s.dir, e.name);
        if (e.isDirectory() && await isWorldDir(full)) {
          const info = await worldInfo(full);
          info.launcher = s.launcher;
          results.push(info);
        }
      }
    }
    results.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
    return results;
  }

  /** Trova la cartella del mondo dentro una cartella generica (gestisce zip con cartella annidata). */
  async findWorldRoot(dir, depth = 3) {
    if (await isWorldDir(dir)) return dir;
    if (depth <= 0) return null;
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory() && !e.name.startsWith('__MACOSX')) {
        const r = await this.findWorldRoot(path.join(dir, e.name), depth - 1);
        if (r) return r;
      }
    }
    return null;
  }

  /**
   * Importa un mondo nel server. source: cartella o .zip.
   * opts: { name (cartella di destinazione), activate, onProgress }
   */
  async import(server, source, opts = {}) {
    let src = source;
    let tmp = null;
    if (/\.zip$/i.test(source)) {
      tmp = path.join(this.store.paths.cache, 'import-' + Date.now());
      opts.onProgress && opts.onProgress(null, 'Estraggo lo zip…');
      await zip.extract(source, tmp);
      src = await this.findWorldRoot(tmp);
      if (!src) { await fsp.rm(tmp, { recursive: true, force: true }); throw new Error('Nello zip non c\'è nessun mondo (manca level.dat)'); }
    } else if (!(await isWorldDir(src))) {
      const found = await this.findWorldRoot(src);
      if (!found) throw new Error('La cartella selezionata non contiene un mondo Minecraft (manca level.dat)');
      src = found;
    }
    const info = await worldInfo(src);
    let name = (opts.name || info.levelName || path.basename(src)).replace(/[<>:"/\\|?*]/g, '').trim() || 'world';
    let dest = path.join(server.dir, name);
    let i = 2;
    while (await exists(dest)) { dest = path.join(server.dir, `${name}-${i++}`); }
    name = path.basename(dest);
    opts.onProgress && opts.onProgress(null, `Copio il mondo "${info.levelName || name}"…`);
    await copyDir(src, dest, (f) => !/session\.lock$/.test(f));
    if (tmp) await fsp.rm(tmp, { recursive: true, force: true });

    // Paper/Purpur salvano Nether ed End in cartelle separate
    if (BUKKIT_TYPES.includes(server.type)) await this.splitDimensions(dest);
    if (opts.activate !== false) await this.setActive(server, name);
    return Object.assign(info, { folder: name });
  }

  /** Converte il layout singleplayer (DIM-1/DIM1 dentro il mondo) in quello Bukkit. */
  async splitDimensions(worldDir) {
    const moves = [['DIM-1', '_nether'], ['DIM1', '_the_end']];
    for (const [dim, suffix] of moves) {
      const from = path.join(worldDir, dim);
      if (!(await exists(from))) continue;
      const targetWorld = worldDir + suffix;
      await fsp.mkdir(targetWorld, { recursive: true });
      await fsp.rename(from, path.join(targetWorld, dim));
      try { await fsp.copyFile(path.join(worldDir, 'level.dat'), path.join(targetWorld, 'level.dat')); } catch (_) {}
    }
  }

  async setActive(server, folder) {
    await properties.update(path.join(server.dir, 'server.properties'), { 'level-name': folder });
  }

  async remove(server, folder) {
    const active = await this.levelName(server);
    if (folder === active) throw new Error('Non puoi eliminare il mondo attivo: attivane prima un altro');
    for (const f of [folder, folder + '_nether', folder + '_the_end']) {
      const p = path.resolve(server.dir, f);
      if (path.dirname(p) !== path.resolve(server.dir)) continue;
      await fsp.rm(p, { recursive: true, force: true });
    }
  }

  async exportZip(server, folder, outFile, onProgress) {
    const items = [{ path: path.join(server.dir, folder), name: folder }];
    if (BUKKIT_TYPES.includes(server.type)) {
      // per l'export singleplayer rimettiamo le dimensioni dentro il mondo
      items.push({ path: path.join(server.dir, folder + '_nether', 'DIM-1'), name: `${folder}/DIM-1` });
      items.push({ path: path.join(server.dir, folder + '_the_end', 'DIM1'), name: `${folder}/DIM1` });
    }
    return zip.createZip(outFile, items, { onProgress });
  }

  /** Nuovo mondo: imposta seed/tipo e un nome cartella nuovo; il server lo genera al prossimo avvio. */
  async createNew(server, { name, seed, levelType, generateStructures = true, hardcore = false }) {
    let folder = (name || 'world').replace(/[<>:"/\\|?*]/g, '').trim() || 'world';
    let i = 2;
    while (await exists(path.join(server.dir, folder))) folder = `${name || 'world'}-${i++}`;
    await properties.update(path.join(server.dir, 'server.properties'), {
      'level-name': folder,
      'level-seed': seed || '',
      'level-type': levelType || 'minecraft:normal',
      'generate-structures': String(generateStructures),
      hardcore: String(hardcore),
    });
    return folder;
  }

  async listDatapacks(server, folder) {
    const dir = path.join(server.dir, folder, 'datapacks');
    const out = [];
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      out.push({ name: e.name, isDir: e.isDirectory() });
    }
    return out;
  }

  async addDatapack(server, folder, file) {
    const dir = path.join(server.dir, folder, 'datapacks');
    await fsp.mkdir(dir, { recursive: true });
    const st = await fsp.stat(file);
    if (st.isDirectory()) await copyDir(file, path.join(dir, path.basename(file)));
    else await fsp.copyFile(file, path.join(dir, path.basename(file)));
  }

  async removeDatapack(server, folder, name) {
    const base = path.resolve(server.dir, folder, 'datapacks');
    const p = path.resolve(base, name);
    if (path.dirname(p) !== base) return;
    await fsp.rm(p, { recursive: true, force: true });
  }
}

module.exports = { WorldManager, worldInfo, BUKKIT_TYPES };
