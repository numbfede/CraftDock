'use strict';
/*
 * "Crea server dal tuo profilo": legge i profili dei launcher installati (launcher ufficiale,
 * Modrinth App, Prism, CurseForge, ATLauncher), capisce versione e loader, divide le mod in
 * "vanno sul server" / "solo nel gioco" / "da controllare" e prepara il server con le mod giuste.
 * Le mod solo-client, gli shader e i resource pack restano disponibili per il pacchetto amici.
 */
const path = require('path');
const os = require('os');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { getJson, postJson, sha1File, exists, readJson } = require('./util');
const { CLIENT_ONLY_RE } = require('./mods');
const { t } = require('../shared/i18n');

const MR = 'https://api.modrinth.com/v2';
const MODDED = ['fabric', 'quilt', 'forge', 'neoforge'];

function appDataDirs() {
  const home = os.homedir();
  const mac = process.platform === 'darwin';
  const appdata = mac ? path.join(home, 'Library', 'Application Support') : (process.env.APPDATA || path.join(home, 'AppData', 'Roaming'));
  return { home, mac, appdata };
}

const idFor = (launcher, dir) => crypto.createHash('sha1').update(`${launcher}|${dir}`).digest('hex').slice(0, 12);

/** "fabric-loader-0.16.14-1.21.1", "1.20.1-forge-47.2.0", "neoforge-21.1.77", "quilt-loader-0.26-1.21.1" */
function parseVersionId(id) {
  const s = String(id || '');
  let m = s.match(/^fabric-loader-([^-]+)-(.+)$/);
  if (m) return { type: 'fabric', loaderVersion: m[1], mcVersion: m[2] };
  m = s.match(/^quilt-loader-([^-]+)-(.+)$/);
  if (m) return { type: 'quilt', loaderVersion: m[1], mcVersion: m[2] };
  m = s.match(/^(\d[\w.]*)-forge-?([\d.]+.*)$/i) || s.match(/^forge-(\d[\w.]*)-([\d.]+.*)$/i);
  if (m) return { type: 'forge', mcVersion: m[1], loaderVersion: m[2] };
  m = s.match(/^neoforge-([\d.]+(?:-beta)?)$/i);
  if (m) return { type: 'neoforge', loaderVersion: m[1], mcVersion: neoToMc(m[1]) };
  if (/^\d+\.\d+(\.\d+)?$/.test(s)) return { type: 'vanilla', mcVersion: s, loaderVersion: null };
  return { type: null, mcVersion: null, loaderVersion: null };
}

/** NeoForge 21.1.77 → Minecraft 1.21.1; 20.4.x → 1.20.4; dal 26.x il numero coincide con quello del gioco. */
function neoToMc(v) {
  const [a, b] = String(v).split('.');
  if (!a || b === undefined) return null;
  if (Number(a) >= 26) return b === '0' ? a : `${a}.${b}`;
  return b === '0' ? `1.${a}` : `1.${a}.${b}`;
}

async function countJars(dir) {
  return (await fsp.readdir(path.join(dir, 'mods')).catch(() => [])).filter((f) => /\.jar$/i.test(f)).length;
}

async function readIni(file) {
  const out = {};
  const txt = await fsp.readFile(file, 'utf8').catch(() => '');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([^#;=]+?)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// ---------- lettori dei singoli launcher ----------

async function scanOfficial() {
  const { appdata, mac } = appDataDirs();
  const base = path.join(appdata, mac ? 'minecraft' : '.minecraft');
  const lp = await readJson(path.join(base, 'launcher_profiles.json'), null);
  if (!lp || !lp.profiles) return [];
  const out = [];
  const seenDirs = new Set();
  for (const [key, p] of Object.entries(lp.profiles)) {
    let v = parseVersionId(p.lastVersionId);
    if (!v.type) {
      // versioni personalizzate: il json della versione dice da quale versione di gioco deriva
      const vj = await readJson(path.join(base, 'versions', p.lastVersionId || '', `${p.lastVersionId}.json`), null);
      if (vj && vj.inheritsFrom) v = Object.assign(parseVersionId(p.lastVersionId), { mcVersion: vj.inheritsFrom });
    }
    if (v.type === 'neoforge' && !v.mcVersion) {
      const vj = await readJson(path.join(base, 'versions', p.lastVersionId, `${p.lastVersionId}.json`), null);
      if (vj && vj.inheritsFrom) v.mcVersion = vj.inheritsFrom;
    }
    if (!MODDED.includes(v.type)) continue;
    const gameDir = p.gameDir || base;
    const name = p.name || (p.type === 'latest-release' ? 'Minecraft' : key);
    // più profili possono condividere la stessa cartella mods: se ne mostra uno per cartella+versione
    const sig = `${gameDir}|${p.lastVersionId}`;
    if (seenDirs.has(sig)) continue;
    seenDirs.add(sig);
    out.push({ launcher: 'Minecraft Launcher', name, gameDir, ...v });
  }
  return out;
}

async function scanModrinth() {
  const { appdata } = appDataDirs();
  const out = [];
  for (const root of [path.join(appdata, 'ModrinthApp', 'profiles'), path.join(appdata, 'com.modrinth.theseus', 'profiles')]) {
    for (const e of await fsp.readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name);
      // le versioni vecchie dell'app hanno profile.json; le nuove tengono i dati in un database interno
      const pj = await readJson(path.join(dir, 'profile.json'), null);
      const meta = (pj && pj.metadata) || {};
      out.push({
        launcher: 'Modrinth App', name: meta.name || e.name, gameDir: dir,
        type: MODDED.includes(meta.loader) ? meta.loader : null,
        mcVersion: meta.game_version || null,
        loaderVersion: (meta.loader_version && (meta.loader_version.id || meta.loader_version)) || null,
        guess: !pj,
      });
    }
  }
  return out;
}

async function scanPrism() {
  const { appdata, home } = appDataDirs();
  const roots = [];
  for (const [label, base] of [['Prism Launcher', path.join(appdata, 'PrismLauncher')], ['MultiMC', path.join(home, 'MultiMC')]]) {
    const cfg = await readIni(path.join(base, label === 'MultiMC' ? 'multimc.cfg' : 'prismlauncher.cfg'));
    const inst = cfg.InstanceDir ? (path.isAbsolute(cfg.InstanceDir) ? cfg.InstanceDir : path.join(base, cfg.InstanceDir)) : path.join(base, 'instances');
    roots.push([label, inst]);
  }
  const out = [];
  for (const [launcher, root] of roots) {
    for (const e of await fsp.readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || e.name.startsWith('_')) continue;
      const dir = path.join(root, e.name);
      const pack = await readJson(path.join(dir, 'mmc-pack.json'), null);
      if (!pack) continue;
      const cfg = await readIni(path.join(dir, 'instance.cfg'));
      const comp = (uid) => ((pack.components || []).find((c) => c.uid === uid) || {}).version || null;
      const type = comp('net.fabricmc.fabric-loader') ? 'fabric' : comp('org.quiltmc.quilt-loader') ? 'quilt'
        : comp('net.neoforged') ? 'neoforge' : comp('net.minecraftforge') ? 'forge' : 'vanilla';
      const loaderVersion = comp('net.fabricmc.fabric-loader') || comp('org.quiltmc.quilt-loader') || comp('net.neoforged') || comp('net.minecraftforge');
      let gameDir = path.join(dir, '.minecraft');
      if (!(await exists(gameDir))) gameDir = path.join(dir, 'minecraft');
      if (!MODDED.includes(type)) continue;
      out.push({ launcher, name: cfg.name || e.name, gameDir, type, mcVersion: comp('net.minecraft'), loaderVersion });
    }
  }
  return out;
}

async function scanCurseForge() {
  const { home } = appDataDirs();
  const out = [];
  for (const root of [path.join(home, 'curseforge', 'minecraft', 'Instances'), path.join(home, 'Documents', 'curseforge', 'minecraft', 'Instances')]) {
    for (const e of await fsp.readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name);
      const j = await readJson(path.join(dir, 'minecraftinstance.json'), null);
      if (!j) continue;
      const ml = String((j.baseModLoader && j.baseModLoader.name) || '');
      const m = ml.match(/^(fabric|quilt|neoforge|forge)-([\d.]+(?:-beta)?)/i);
      if (!m) continue;
      out.push({
        launcher: 'CurseForge', name: j.name || e.name, gameDir: dir, type: m[1].toLowerCase(), loaderVersion: m[2],
        mcVersion: j.gameVersion || (j.baseModLoader && j.baseModLoader.minecraftVersion) || null,
      });
    }
  }
  return out;
}

async function scanATLauncher() {
  const { appdata } = appDataDirs();
  const root = path.join(appdata, 'ATLauncher', 'instances');
  const out = [];
  for (const e of await fsp.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory()) continue;
    const dir = path.join(root, e.name);
    const j = await readJson(path.join(dir, 'instance.json'), null);
    if (!j) continue;
    const lv = (j.launcher && j.launcher.loaderVersion) || {};
    const type = String(lv.type || '').toLowerCase();
    if (!MODDED.includes(type)) continue;
    out.push({ launcher: 'ATLauncher', name: (j.launcher && j.launcher.name) || e.name, gameDir: dir, type, loaderVersion: lv.version || null, mcVersion: j.id || (j.minecraftVersion) || null });
  }
  return out;
}

// ---------- classificazione delle mod ----------

/**
 * Dove serve una mod. Prima i dati di Modrinth (dichiarati dagli autori), poi i metadati del jar,
 * poi l'elenco delle mod solo-client più note. Restituisce { side, reason }.
 * side: 'server' (solo server) | 'both' | 'client' | 'check'
 */
function classify(meta, project, fileName) {
  if (project) {
    if (project.server_side === 'unsupported') return { side: 'client', reason: 'modrinth' };
    if (project.client_side === 'unsupported') return { side: 'server', reason: 'modrinth' };
    return { side: 'both', reason: 'modrinth' };
  }
  if (meta.environment === 'client' || CLIENT_ONLY_RE.test(fileName)) return { side: 'client', reason: 'jar' };
  if (meta.environment === 'server') return { side: 'server', reason: 'jar' };
  return { side: 'check', reason: 'unknown' };
}

class ProfileScanner {
  constructor(mods) {
    this.mods = mods; // ModManager, per leggere i metadati dei jar
    this.cache = new Map();
    this.analysis = new Map();
  }

  async scan() {
    const { home, appdata, mac } = appDataDirs();
    const lists = await Promise.all([scanOfficial(), scanModrinth(), scanPrism(), scanCurseForge(), scanATLauncher()].map((p) => p.catch(() => [])));
    const loaders = require('./loaders');
    const out = [];
    for (const p of lists.flat()) {
      const modCount = await countJars(p.gameDir);
      if (!modCount) continue;
      if (!p.type || !p.mcVersion) {
        // Modrinth App recente: niente file di profilo leggibile, si deduce dalle mod
        const g = await loaders.guessFromContent(p.gameDir).catch(() => ({}));
        p.type = p.type || (MODDED.includes(g.type) ? g.type : null);
        p.mcVersion = p.mcVersion || g.mcVersion || null;
        p.guess = true;
      }
      const prof = Object.assign({ id: idFor(p.launcher, p.gameDir + '|' + p.name), modCount }, p);
      this.cache.set(prof.id, prof);
      out.push(prof);
    }
    out.sort((a, b) => a.launcher.localeCompare(b.launcher) || a.name.localeCompare(b.name));
    const lunar = await exists(path.join(home, '.lunarclient')) || await exists(path.join(appdata, mac ? 'lunarclient' : '.lunarclient'));
    return { profiles: out, lunar };
  }

  get(id) { return this.cache.get(id) || null; }

  /** Legge mod, shader, resource pack e mondi di un profilo. */
  async analyze(id, { onProgress } = {}) {
    const p = this.get(id);
    if (!p) throw new Error(t('Profilo non trovato: aggiorna l\'elenco'));
    const modsDir = path.join(p.gameDir, 'mods');
    const files = (await fsp.readdir(modsDir).catch(() => [])).filter((f) => /\.jar$/i.test(f)).sort();
    const items = [];
    let i = 0;
    for (const f of files) {
      onProgress && onProgress(files.length ? i / files.length : null, t('Leggo le mod… {i} di {n}', { i: ++i, n: files.length }));
      const full = path.join(modsDir, f);
      const meta = await this.mods.readJarMeta(full).catch(() => ({}));
      items.push({ file: f, path: full, name: meta.name || f.replace(/\.jar$/i, ''), version: meta.version || '', environment: meta.environment || null, icon: meta.icon || null, sha1: await sha1File(full) });
    }
    // Modrinth: chi è la mod e dove serve, secondo i suoi autori
    let versions = {};
    let projects = {};
    let online = true;
    try {
      onProgress && onProgress(null, t('Controllo le mod su Modrinth…'));
      if (items.length) versions = await postJson(`${MR}/version_files`, { hashes: items.map((x) => x.sha1), algorithm: 'sha1' });
      const ids = [...new Set(Object.values(versions).map((v) => v.project_id))];
      for (let k = 0; k < ids.length; k += 100) {
        const chunk = ids.slice(k, k + 100);
        for (const pr of await getJson(`${MR}/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`)) projects[pr.id] = pr;
      }
    } catch (_) { online = false; }
    for (const it of items) {
      const v = versions[it.sha1];
      const pr = v && projects[v.project_id];
      Object.assign(it, classify({ environment: it.environment }, pr, it.file));
      if (v) { it.projectId = v.project_id; it.versionId = v.id; }
      if (pr) it.title = pr.title;
    }
    // shader e resource pack: nel gioco, non sul server (un resource pack su Modrinth si può imporre dal server)
    const listDir = async (sub) => (await fsp.readdir(path.join(p.gameDir, sub), { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory() || /\.zip$/i.test(e.name)).map((e) => ({ name: e.name, path: path.join(p.gameDir, sub, e.name), dir: e.isDirectory() }));
    const shaders = await listDir('shaderpacks');
    const resourcepacks = await listDir('resourcepacks');
    if (online) {
      const zips = resourcepacks.filter((r) => !r.dir);
      for (const r of zips) r.sha1 = await sha1File(r.path);
      try {
        const rv = zips.length ? await postJson(`${MR}/version_files`, { hashes: zips.map((r) => r.sha1), algorithm: 'sha1' }) : {};
        for (const r of zips) {
          const v = rv[r.sha1];
          const f = v && (v.files || []).find((x) => x.hashes && x.hashes.sha1 === r.sha1);
          if (f) r.modrinth = { url: f.url, sha1: r.sha1 };
        }
      } catch (_) {}
    }
    // mondi in single player di questo profilo
    const worlds = [];
    for (const e of await fsp.readdir(path.join(p.gameDir, 'saves'), { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory() && await exists(path.join(p.gameDir, 'saves', e.name, 'level.dat'))) worlds.push({ name: e.name, path: path.join(p.gameDir, 'saves', e.name) });
    }
    const result = { profile: p, mods: items.map(({ sha1, environment, ...rest }) => rest), shaders, resourcepacks, worlds, online };
    this.analysis.set(id, { result, items });
    return result;
  }

  /**
   * Copia nel server le mod scelte. Le altre del profilo (solo client o escluse) finiscono nella
   * cartella mods come .disabled e segnate "per gli amici": il pacchetto amici le include.
   */
  async applyToServer(server, id, { include = [], resourcePack = null, extras = true } = {}, progress) {
    const a = this.analysis.get(id);
    if (!a) throw new Error(t('Analisi del profilo non trovata: riaprila e riprova'));
    const modsDir = path.join(server.dir, 'mods');
    await fsp.mkdir(modsDir, { recursive: true });
    const track = await this.mods.track(server);
    const on = new Set(include);
    let n = 0;
    for (const it of a.result.mods) {
      progress && progress(null, t('Copio le mod… {i} di {n}', { i: ++n, n: a.result.mods.length }));
      const onServer = on.has(it.file);
      const dest = path.join(modsDir, onServer ? it.file : it.file + '.disabled');
      await fsp.copyFile(it.path, dest);
      const entry = it.projectId ? { source: 'modrinth', projectId: it.projectId, versionId: it.versionId, version: it.version } : { source: 'profile' };
      if (!onServer) entry.clientOnly = true;
      if (it.side === 'server') entry.serverOnly = true;
      track[it.file] = entry;
    }
    await this.mods.saveTrack(server, track);
    const extrasDir = path.join(server.dir, 'client-extras');
    if (extras) {
      for (const [sub, list] of [['shaderpacks', a.result.shaders], ['resourcepacks', a.result.resourcepacks]]) {
        if (!list.length) continue;
        await fsp.mkdir(path.join(extrasDir, sub), { recursive: true });
        for (const x of list) await fsp.cp(x.path, path.join(extrasDir, sub, x.name), { recursive: true, force: true });
      }
    }
    let props = null;
    if (resourcePack) {
      const rp = a.result.resourcepacks.find((r) => r.name === resourcePack && r.modrinth);
      if (rp) props = { 'resource-pack': rp.modrinth.url, 'resource-pack-sha1': rp.modrinth.sha1, 'require-resource-pack': 'false' };
    }
    return { props, copied: a.result.mods.length };
  }
}

module.exports = { ProfileScanner, parseVersionId, neoToMc, classify };
