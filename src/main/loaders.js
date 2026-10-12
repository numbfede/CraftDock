'use strict';
// Catalogo versioni e installazione dei server: Vanilla, Fabric, Quilt, Forge, NeoForge, Paper, Purpur.

const path = require('path');
const fsp = require('fs/promises');
const { spawn } = require('child_process');
const { getJson, getText, download, compareVersions, guessJavaMajor, exists } = require('./util');
const zip = require('./zip');

const { t } = require('../shared/i18n');
const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const FABRIC = 'https://meta.fabricmc.net/v2';
const QUILT = 'https://meta.quiltmc.org/v3';
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const NEO_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';
const PAPER = 'https://fill.papermc.io/v3/projects/paper';
const PURPUR = 'https://api.purpurmc.org/v2/purpur';

const TYPES = {
  vanilla: { name: 'Vanilla', mods: false, plugins: false, desc: t('Minecraft ufficiale, senza modifiche.') },
  fabric: { name: 'Fabric', mods: true, plugins: false, desc: t('Leggero e aggiornato subito alle nuove versioni. Il più usato per le mod moderne.') },
  quilt: { name: 'Quilt', mods: true, plugins: false, desc: t('Fork di Fabric, compatibile con la maggior parte delle mod Fabric.') },
  neoforge: { name: 'NeoForge', mods: true, plugins: false, desc: t('Successore di Forge dalla 1.20.2 in poi, per grandi modpack.') },
  forge: { name: 'Forge', mods: true, plugins: false, desc: t('Il loader storico: necessario per molti modpack fino alla 1.20.1.') },
  paper: { name: 'Paper', mods: false, plugins: true, desc: t('Server ottimizzato con supporto ai plugin Bukkit/Spigot.') },
  purpur: { name: 'Purpur', mods: false, plugins: true, desc: t('Basato su Paper, con molte opzioni di gameplay in più.') },
};

// Mappatura loader → nomi usati da Modrinth/CurseForge
const MODRINTH_LOADER = { fabric: ['fabric'], quilt: ['quilt', 'fabric'], forge: ['forge'], neoforge: ['neoforge'], paper: ['paper', 'spigot', 'bukkit'], purpur: ['purpur', 'paper', 'spigot', 'bukkit'] };
const CURSE_LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

function parseMavenVersions(xml) {
  return [...String(xml).matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
}

/** NeoForge "21.1.77" → MC "1.21.1"; "21.0.5" → "1.21"; "26.1.0.19-beta" → "26.1"; "26.1.1.3" → "26.1.1" */
function neoToMc(v) {
  const p = v.split('-')[0].split('.');
  if (parseInt(p[0], 10) >= 25) {
    return p[2] && p[2] !== '0' ? `${p[0]}.${p[1]}.${p[2]}` : `${p[0]}.${p[1]}`;
  }
  return p[1] && p[1] !== '0' ? `1.${p[0]}.${p[1]}` : `1.${p[0]}`;
}

function mcToNeoPrefix(mc) {
  const p = mc.split('.');
  if (p[0] === '1') return `${p[1]}.${p[2] || '0'}.`;
  return `${p[0]}.${p[1] || '0'}.${p[2] || '0'}.`;
}

async function mojangManifest() {
  return cached('mojang', 30 * 60e3, () => getJson(MOJANG_MANIFEST));
}

async function listGameVersions(type, { snapshots = false } = {}) {
  switch (type) {
    case 'vanilla': {
      const m = await mojangManifest();
      return m.versions.filter((v) => v.type === 'release' || (snapshots && v.type === 'snapshot')).map((v) => ({ id: v.id, stable: v.type === 'release' }));
    }
    case 'fabric': {
      const list = await cached('fabric-game', 30 * 60e3, () => getJson(`${FABRIC}/versions/game`));
      return list.filter((v) => snapshots || v.stable).map((v) => ({ id: v.version, stable: v.stable }));
    }
    case 'quilt': {
      const list = await cached('quilt-game', 30 * 60e3, () => getJson(`${QUILT}/versions/game`));
      return list.filter((v) => snapshots || v.stable).map((v) => ({ id: v.version, stable: v.stable }));
    }
    case 'forge': {
      const versions = await forgeAll();
      const mcs = [...new Set(versions.map((v) => v.split('-')[0]))].filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v));
      return mcs.sort((a, b) => compareVersions(b, a)).map((id) => ({ id, stable: true }));
    }
    case 'neoforge': {
      const versions = await neoAll();
      const mcs = [...new Set(versions.map(neoToMc))];
      return mcs.sort((a, b) => compareVersions(b, a)).map((id) => ({ id, stable: true }));
    }
    case 'paper': {
      const p = await cached('paper', 30 * 60e3, () => getJson(PAPER));
      const all = Object.values(p.versions || {}).flat();
      return all.filter((v) => snapshots || !/-(pre|rc)/.test(v)).sort((a, b) => compareVersions(b, a)).map((id) => ({ id, stable: !/-(pre|rc)/.test(id) }));
    }
    case 'purpur': {
      const p = await cached('purpur', 30 * 60e3, () => getJson(PURPUR));
      return [...p.versions].sort((a, b) => compareVersions(b, a)).map((id) => ({ id, stable: true }));
    }
    default: throw new Error(t('Tipo server sconosciuto: ') + type);
  }
}

async function forgeAll() {
  return cached('forge-all', 60 * 60e3, async () => parseMavenVersions(await getText(`${FORGE_MAVEN}/maven-metadata.xml`)));
}
async function neoAll() {
  return cached('neo-all', 60 * 60e3, async () => parseMavenVersions(await getText(`${NEO_MAVEN}/maven-metadata.xml`)));
}

/** Versioni del loader per una versione di gioco. Il primo elemento è quello consigliato. */
async function listLoaderVersions(type, mc) {
  switch (type) {
    case 'vanilla': return [];
    case 'fabric': {
      const list = await getJson(`${FABRIC}/versions/loader/${encodeURIComponent(mc)}`);
      const items = list.map((x) => ({ id: x.loader.version, stable: x.loader.stable !== false }));
      items.sort((a, b) => (b.stable - a.stable));
      return items;
    }
    case 'quilt': {
      const list = await getJson(`${QUILT}/versions/loader/${encodeURIComponent(mc)}`);
      const items = list.map((x) => ({ id: x.loader.version, stable: !/beta|pre|rc/.test(x.loader.version) }));
      items.sort((a, b) => (b.stable - a.stable));
      return items;
    }
    case 'forge': {
      const all = await forgeAll();
      let promos = {};
      try { promos = (await cached('forge-promos', 60 * 60e3, () => getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'))).promos || {}; } catch (_) {}
      const rec = promos[`${mc}-recommended`];
      const latest = promos[`${mc}-latest`];
      const items = all.filter((v) => v.startsWith(mc + '-')).map((v) => v.slice(mc.length + 1))
        .map((id) => ({ id, stable: true, recommended: id === rec, latest: id === latest }));
      items.sort((a, b) => (b.recommended - a.recommended) || compareVersions(b.id, a.id));
      return items;
    }
    case 'neoforge': {
      const prefix = mcToNeoPrefix(mc);
      const items = (await neoAll()).filter((v) => v.startsWith(prefix)).map((id) => ({ id, stable: !/beta|alpha/.test(id) }));
      items.sort((a, b) => (b.stable - a.stable) || compareVersions(b.id, a.id));
      return items;
    }
    case 'paper': {
      const builds = await getJson(`${PAPER}/versions/${encodeURIComponent(mc)}/builds`);
      return builds.map((b) => ({ id: String(b.id), stable: b.channel === 'STABLE', url: b.downloads && b.downloads['server:default'] && b.downloads['server:default'].url }))
        .sort((a, b) => Number(b.id) - Number(a.id));
    }
    case 'purpur': {
      const info = await getJson(`${PURPUR}/${encodeURIComponent(mc)}`);
      return [...info.builds.all].reverse().map((id) => ({ id, stable: true }));
    }
    default: return [];
  }
}

/** Java richiesto: dato ufficiale Mojang se disponibile, altrimenti stima. */
async function requiredJava(mc) {
  try {
    const m = await mojangManifest();
    const v = m.versions.find((x) => x.id === mc);
    if (v) {
      const json = await cached('ver-' + mc, 24 * 3600e3, () => getJson(v.url));
      if (json.javaVersion && json.javaVersion.majorVersion) return json.javaVersion.majorVersion;
    }
  } catch (_) { /* offline: stima */ }
  return guessJavaMajor(mc);
}

function runJava(javaPath, args, cwd, onLog) {
  return new Promise((resolve, reject) => {
    const p = spawn(javaPath, args, { cwd, windowsHide: true });
    const emit = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => onLog && onLog(l));
    p.stdout.on('data', emit);
    p.stderr.on('data', emit);
    p.on('error', reject);
    p.on('close', (code) => resolve(code));
  });
}

async function rmGlob(dir, re) {
  for (const f of await fsp.readdir(dir).catch(() => [])) if (re.test(f)) await fsp.rm(path.join(dir, f), { force: true });
}

/**
 * Installa (o reinstalla) i file del server nella sua cartella.
 * Restituisce { launch, javaMajor, loaderVersion }.
 */
async function install(server, { java, onProgress, onLog }) {
  const dir = server.dir;
  const mc = server.mcVersion;
  await fsp.mkdir(dir, { recursive: true });
  const step = (p, label) => onProgress && onProgress(p, label);
  const javaMajor = await requiredJava(mc);
  let loaderVersion = server.loaderVersion;
  if (server.type !== 'vanilla' && !loaderVersion) {
    step(null, t('Cerco la versione del loader…'));
    const list = await listLoaderVersions(server.type, mc);
    if (!list.length) throw new Error(t('Nessuna versione di {p0} disponibile per Minecraft {mc}', { p0: TYPES[server.type].name, mc }));
    loaderVersion = list[0].id;
  }
  const needJava = async () => java.ensure(javaMajor, { onProgress: step });

  switch (server.type) {
    case 'vanilla': {
      const m = await mojangManifest();
      const v = m.versions.find((x) => x.id === mc);
      if (!v) throw new Error(t('Versione Minecraft non trovata: ') + mc);
      const json = await getJson(v.url);
      if (!json.downloads || !json.downloads.server) throw new Error(t('La {mc} non ha un server ufficiale scaricabile', { mc }));
      step(0, t('Scarico server Minecraft {mc}…', { mc }));
      await download(json.downloads.server.url, path.join(dir, 'server.jar'), { sha1: json.downloads.server.sha1, onProgress: (p) => step(p, t('Scarico server Minecraft {mc}…', { mc })) });
      return { launch: { kind: 'jar', jar: 'server.jar' }, javaMajor, loaderVersion: null };
    }
    case 'fabric': {
      const installers = await getJson(`${FABRIC}/versions/installer`);
      const inst = (installers.find((i) => i.stable) || installers[0]).version;
      step(0, t('Scarico Fabric {loaderVersion}…', { loaderVersion }));
      const url = `${FABRIC}/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(loaderVersion)}/${encodeURIComponent(inst)}/server/jar`;
      await download(url, path.join(dir, 'fabric-server-launch.jar'), { onProgress: (p) => step(p, t('Scarico Fabric {loaderVersion}…', { loaderVersion })) });
      // il launcher Fabric scarica il server vanilla al primo avvio; lo pre-scarichiamo per un avvio più veloce
      try {
        const m = await mojangManifest();
        const v = m.versions.find((x) => x.id === mc);
        if (v) {
          const json = await getJson(v.url);
          if (json.downloads && json.downloads.server) {
            await download(json.downloads.server.url, path.join(dir, 'server.jar'), { sha1: json.downloads.server.sha1, onProgress: (p) => step(p, t('Scarico server vanilla…')) });
          }
        }
      } catch (e) { onLog && onLog(t('[CraftDock] Pre-download vanilla saltato: ') + e.message); }
      return { launch: { kind: 'jar', jar: 'fabric-server-launch.jar' }, javaMajor, loaderVersion };
    }
    case 'quilt': {
      const meta = parseMavenVersions(await getText('https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/maven-metadata.xml'));
      const instV = meta.filter((v) => !/beta|pre/.test(v)).sort((a, b) => compareVersions(b, a))[0] || meta[meta.length - 1];
      const instJar = path.join(dir, 'quilt-installer.jar');
      step(0, t('Scarico installer Quilt…'));
      await download(`https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${instV}/quilt-installer-${instV}.jar`, instJar, { onProgress: (p) => step(p, t('Scarico installer Quilt…')) });
      const javaPath = await needJava();
      step(null, t('Installo Quilt…'));
      const code = await runJava(javaPath, ['-jar', instJar, 'install', 'server', mc, loaderVersion, '--download-server', '--install-dir=.'], dir, onLog);
      await fsp.rm(instJar, { force: true });
      if (code !== 0) throw new Error(t('Installer Quilt terminato con codice {code}', { code }));
      return { launch: { kind: 'jar', jar: 'quilt-server-launch.jar' }, javaMajor, loaderVersion };
    }
    case 'forge':
    case 'neoforge': {
      const isNeo = server.type === 'neoforge';
      const full = isNeo ? loaderVersion : `${mc}-${loaderVersion}`;
      const url = isNeo ? `${NEO_MAVEN}/${full}/neoforge-${full}-installer.jar` : `${FORGE_MAVEN}/${full}/forge-${full}-installer.jar`;
      const instJar = path.join(dir, 'installer.jar');
      const name = TYPES[server.type].name;
      step(0, t('Scarico installer {name} {loaderVersion}…', { name, loaderVersion }));
      await download(url, instJar, { onProgress: (p) => step(p, t('Scarico installer {name}…', { name })) });
      const javaPath = await needJava();
      step(null, t('Installo {name} (può richiedere qualche minuto)…', { name }));
      let code = await runJava(javaPath, ['-jar', instJar, '--installServer'], dir, onLog);
      if (code !== 0 && isNeo) code = await runJava(javaPath, ['-jar', instJar, '--install-server', '.'], dir, onLog);
      await fsp.rm(instJar, { force: true });
      await fsp.rm(path.join(dir, 'installer.jar.log'), { force: true });
      if (code !== 0) throw new Error(t('Installer {name} terminato con codice {code}. Controlla il log.', { name, code }));
      const launch = await detectLaunch(dir, { type: server.type, loaderVersion: full });
      if (!launch) throw new Error(t('Installazione {name} completata ma non trovo come avviarlo', { name }));
      return { launch, javaMajor, loaderVersion };
    }
    case 'paper': {
      const builds = await listLoaderVersions('paper', mc);
      const b = builds.find((x) => x.id === String(loaderVersion)) || builds[0];
      if (!b || !b.url) throw new Error(t('Build Paper non trovata'));
      await rmGlob(dir, /^paper.*\.jar$/i);
      step(0, t('Scarico Paper {mc} build {id}…', { mc, id: b.id }));
      await download(b.url, path.join(dir, 'paper.jar'), { onProgress: (p) => step(p, t('Scarico Paper {mc}…', { mc })) });
      return { launch: { kind: 'jar', jar: 'paper.jar' }, javaMajor, loaderVersion: b.id };
    }
    case 'purpur': {
      await rmGlob(dir, /^purpur.*\.jar$/i);
      step(0, t('Scarico Purpur {mc} build {loaderVersion}…', { mc, loaderVersion }));
      await download(`${PURPUR}/${encodeURIComponent(mc)}/${encodeURIComponent(loaderVersion)}/download`, path.join(dir, 'purpur.jar'), { onProgress: (p) => step(p, t('Scarico Purpur {mc}…', { mc })) });
      return { launch: { kind: 'jar', jar: 'purpur.jar' }, javaMajor, loaderVersion };
    }
    default: throw new Error(t('Tipo server non supportato: ') + server.type);
  }
}

async function findArgsFile(serverDir, base, preferVersion) {
  if (!(await exists(base))) return null;
  const dirs = (await fsp.readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  dirs.sort((a, b) => (b === preferVersion) - (a === preferVersion) || compareVersions(b, a));
  const fname = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
  for (const d of dirs) {
    const f = path.join(base, d, fname);
    if (await exists(f)) return path.relative(serverDir, f);
  }
  return null;
}

/** Capisce come avviare un server già installato (anche importato da fuori). */
async function detectLaunch(dir, { type, loaderVersion } = {}) {
  const neoBase = path.join(dir, 'libraries', 'net', 'neoforged', 'neoforge');
  const forgeBase = path.join(dir, 'libraries', 'net', 'minecraftforge', 'forge');
  if (type !== 'forge') {
    const f = await findArgsFile(dir, neoBase, loaderVersion);
    if (f) return { kind: 'args', argsFile: f.split(path.sep).join('/') };
  }
  if (type !== 'neoforge') {
    const f = await findArgsFile(dir, forgeBase, loaderVersion);
    if (f) return { kind: 'args', argsFile: f.split(path.sep).join('/') };
  }
  const files = await fsp.readdir(dir).catch(() => []);
  const jars = files.filter((f) => f.toLowerCase().endsWith('.jar') && !/installer|shim/i.test(f));
  const pick = (re) => jars.find((f) => re.test(f));
  const order = [/^forge-.*\.jar$/i, /^fabric-server-launch\.jar$/i, /^fabric-server-mc.*\.jar$/i, /^quilt-server-launch\.jar$/i, /^paper.*\.jar$/i, /^purpur.*\.jar$/i, /^spigot.*\.jar$/i, /^server\.jar$/i, /^minecraft_server.*\.jar$/i];
  for (const re of order) { const j = pick(re); if (j) return { kind: 'jar', jar: j }; }
  if (jars.length === 1) return { kind: 'jar', jar: jars[0] };
  return null;
}

/** Riconosce tipo e versione di una cartella server esistente (per l'importazione). */
async function detectServer(dir) {
  const files = await fsp.readdir(dir).catch(() => []);
  const lower = files.map((f) => f.toLowerCase());
  let type = 'vanilla';
  if (await exists(path.join(dir, 'libraries', 'net', 'neoforged'))) type = 'neoforge';
  else if (await exists(path.join(dir, 'libraries', 'net', 'minecraftforge')) || lower.some((f) => /^forge-.*\.jar$/.test(f))) type = 'forge';
  else if (lower.some((f) => f.startsWith('fabric-server'))) type = 'fabric';
  else if (lower.some((f) => f.startsWith('quilt-server'))) type = 'quilt';
  else if (lower.some((f) => f.startsWith('purpur'))) type = 'purpur';
  else if (lower.some((f) => f.startsWith('paper'))) type = 'paper';
  const launch = await detectLaunch(dir, { type });
  let mcVersion = null;
  for (const j of ['server.jar', launch && launch.jar].filter(Boolean)) {
    try {
      const buf = await zip.readEntry(path.join(dir, j), 'version.json');
      if (buf) { const v = JSON.parse(buf.toString('utf8')); mcVersion = v.id || v.name || null; if (mcVersion) break; }
    } catch (_) {}
  }
  if (!mcVersion && launch && launch.argsFile) {
    const m = launch.argsFile.match(/forge\/([\d.]+)-/);
    if (m) mcVersion = m[1];
    const n = launch.argsFile.match(/neoforge\/([^/]+)\//);
    if (n) mcVersion = neoToMc(n[1]);
  }
  return { type, mcVersion, launch };
}

module.exports = {
  TYPES, MODRINTH_LOADER, CURSE_LOADER,
  listGameVersions, listLoaderVersions, requiredJava, install, detectLaunch, detectServer,
  neoToMc, mcToNeoPrefix, parseMavenVersions,
};
