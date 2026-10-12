'use strict';
// Processo principale Electron: finestra, IPC e collegamento tra i moduli.

const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fsp = require('fs/promises');
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, Tray, Menu, Notification } = require('electron');

const { Store } = require('./store');
const { JavaManager } = require('./java');
const loaders = require('./loaders');
const { ServerManager, findFreePort } = require('./serverManager');
const { WorldManager } = require('./worlds');
const { BackupManager } = require('./backups');
const { ModManager } = require('./mods');
const { PlayitManager, networkInfo } = require('./tunnel');
const properties = require('./properties');
const { slugify, exists, uid, getJson, readJson, writeJson, httpRequest, copyDir } = require('./util');

const i18n = require('../shared/i18n');
const { t } = i18n;
const logger = require('./logger');
const { Updater } = require('./updater');
const { Scheduler, sanitize: sanitizeSchedules } = require('./scheduler');
const ICON = path.join(__dirname, '..', 'renderer', 'assets', 'icon.png');

let win = null;
let tray = null;
let quitting = false;
let store; let java; let servers; let worlds; let backups; let mods; let playit; let updater; let scheduler;

// cartella dati alternativa (utile per test o per un'installazione portatile)
if (process.env.CRAFTDOCK_DATA) app.setPath('userData', process.env.CRAFTDOCK_DATA);

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

// ---------- Task con progresso (download, installazioni, backup) ----------
function task(label) {
  const id = uid();
  send('task', { id, label, progress: null, status: 'running' });
  return {
    id,
    progress: (p, l) => send('task', { id, label: l || label, progress: p, status: 'running' }),
    done: (l) => send('task', { id, label: l || label, progress: 1, status: 'done' }),
    fail: (e) => send('task', { id, label, status: 'error', error: e.message || String(e) }),
  };
}
async function withTask(label, fn) {
  const tk = task(label);
  try {
    const r = await fn(tk.progress);
    tk.done();
    return r;
  } catch (e) {
    tk.fail(e);
    throw e;
  }
}

function notify(title, body) {
  try { if (Notification.isSupported() && win && !win.isFocused()) new Notification({ title, body, icon: ICON }).show(); } catch (_) {}
}

function serverView(s) {
  return Object.assign({}, s, { state: servers.state(s.id), typeName: (loaders.TYPES[s.type] || {}).name || s.type });
}

function needServer(id) {
  const s = store.get(id);
  if (!s) throw new Error(t('Server non trovato'));
  return s;
}

function needStopped(id) {
  if (servers.isRunning(id)) throw new Error(t('Spegni prima il server'));
}

// ---------- Creazione / importazione server ----------
const DEFAULT_PROPS = (opts) => ({
  motd: opts.motd || `§a${opts.name}§r §7- ospitato con CraftDock`,
  'server-port': String(opts.port),
  'max-players': String(opts.maxPlayers || 10),
  difficulty: opts.difficulty || 'easy',
  gamemode: opts.gamemode || 'survival',
  'view-distance': '10',
  'simulation-distance': '10',
  'spawn-protection': '0',
  'online-mode': opts.onlineMode === false ? 'false' : 'true',
  'enable-command-block': 'false',
});

async function uniqueDir(name) {
  let base = path.join(store.paths.servers, slugify(name));
  let dir = base; let i = 2;
  while (await exists(dir)) dir = `${base}-${i++}`;
  return dir;
}

async function createServer(opts) {
  if (!opts.eula) throw new Error(t('Devi accettare la EULA di Minecraft per creare un server'));
  const taken = store.servers.map((s) => Number(s.port));
  const port = Number(opts.port) || await findFreePort(25565, taken);
  const dir = await uniqueDir(opts.name);
  const server = await store.add({
    name: opts.name || t('Nuovo server'), type: opts.type, mcVersion: opts.mcVersion, loaderVersion: opts.loaderVersion || null,
    dir, port, ramMb: Number(opts.ramMb) || store.config.defaultRamMb, launch: null, javaMajor: null,
  });
  send('servers:changed');
  servers.setStatus(server.id, 'installing');
  try {
    await withTask(t('Installo {name}', { name: server.name }), async (progress) => {
      const res = await loaders.install(server, { java, onProgress: progress, onLog: (l) => servers.pushLog(server.id, l, 'install') });
      await store.update(server.id, res);
      await servers.acceptEula(dir);
      await properties.update(path.join(dir, 'server.properties'), DEFAULT_PROPS(Object.assign({}, opts, { port })));
      if (opts.worldSource) {
        progress(null, t('Importo il mondo…'));
        await worlds.import(server, opts.worldSource, { onProgress: progress });
      }
      if (opts.pack) {
        const r = await mods.installPackFiles(server, opts.pack.file, opts.pack.info, progress);
        if (r.disabled.length) servers.info(server.id, t('Mod solo-client disattivate automaticamente: {p0}', { p0: r.disabled.join(', ') }));
        r.warnings.forEach((w) => servers.info(server.id, '⚠ ' + w));
      }
    });
    servers.setStatus(server.id, 'stopped');
    servers.info(server.id, t('Installazione completata. Premi Avvia!'));
  } catch (e) {
    servers.setStatus(server.id, 'error');
    servers.info(server.id, t('Installazione fallita: ') + e.message);
    send('servers:changed');
    throw e;
  }
  send('servers:changed');
  return serverView(store.get(server.id));
}

async function importServerFolder({ dir, name, copy }) {
  const detected = await loaders.detectServer(dir);
  if (!detected.launch) throw new Error(t('Non trovo il jar del server in questa cartella'));
  let target = dir;
  if (copy) {
    target = await uniqueDir(name || path.basename(dir));
    await withTask(t('Copio la cartella del server…'), () => copyDir(dir, target));
  }
  const props = await properties.readFile(path.join(target, 'server.properties'));
  const s = await store.add({
    name: name || path.basename(dir), type: detected.type, mcVersion: detected.mcVersion || '', loaderVersion: null,
    dir: target, port: Number(props.map['server-port']) || 25565, launch: detected.launch,
    javaMajor: detected.mcVersion ? await loaders.requiredJava(detected.mcVersion) : 21, imported: true,
  });
  send('servers:changed');
  return serverView(s);
}

async function createFromPack(packFile, info, opts) {
  return createServer(Object.assign({
    name: opts.name || info.name, type: info.type, mcVersion: info.mcVersion, loaderVersion: info.loaderVersion,
    pack: { file: packFile, info },
  }, opts));
}

// ---------- Giocatori ----------
function offlineUuid(name) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const h = md5.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function lookupUuid(server, name) {
  const props = await properties.readFile(path.join(server.dir, 'server.properties'));
  if (props.map['online-mode'] === 'false') return { uuid: offlineUuid(name), name };
  const r = await getJson(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`);
  const h = r.id;
  return { uuid: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`, name: r.name };
}

const PLAYER_FILES = { whitelist: 'whitelist.json', ops: 'ops.json', banned: 'banned-players.json', bannedIps: 'banned-ips.json' };

async function playerLists(server) {
  const out = {};
  for (const [k, f] of Object.entries(PLAYER_FILES)) out[k] = await readJson(path.join(server.dir, f), []);
  try {
    const cache = await readJson(path.join(server.dir, 'usercache.json'), []);
    out.known = cache.map((c) => c.name);
  } catch (_) { out.known = []; }
  return out;
}

async function editPlayerList(server, list, action, name, extra = {}) {
  const running = servers.isRunning(server.id) && servers.rt(server.id).status === 'running';
  if (running) {
    const cmds = {
      whitelist: { add: `whitelist add ${name}`, remove: `whitelist remove ${name}` },
      ops: { add: `op ${name}`, remove: `deop ${name}` },
      banned: { add: `ban ${name}${extra.reason ? ' ' + extra.reason : ''}`, remove: `pardon ${name}` },
      bannedIps: { add: `ban-ip ${name}`, remove: `pardon-ip ${name}` },
    };
    servers.send(server.id, cmds[list][action]);
    await new Promise((r) => setTimeout(r, 700));
    return playerLists(server);
  }
  const file = path.join(server.dir, PLAYER_FILES[list]);
  let arr = await readJson(file, []);
  if (action === 'remove') {
    arr = arr.filter((e) => (list === 'bannedIps' ? e.ip !== name : e.name.toLowerCase() !== name.toLowerCase()));
  } else if (list === 'bannedIps') {
    arr.push({ ip: name, created: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' +0000', source: 'CraftDock', expires: 'forever', reason: extra.reason || 'Bannato' });
  } else {
    const p = await lookupUuid(server, name);
    arr = arr.filter((e) => e.uuid !== p.uuid);
    if (list === 'whitelist') arr.push(p);
    if (list === 'ops') arr.push(Object.assign(p, { level: 4, bypassesPlayerLimit: false }));
    if (list === 'banned') arr.push(Object.assign(p, { created: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' +0000', source: 'CraftDock', expires: 'forever', reason: extra.reason || 'Bannato' }));
  }
  await writeJson(file, arr);
  return playerLists(server);
}

// ---------- IPC ----------
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (e) { return { ok: false, error: e.message || String(e), code: e.code, url: e.url }; }
  });
}

function registerIpc() {
  // lingua: letta in modo sincrono dal preload prima che l'interfaccia parta
  ipcMain.on('app:lang', (e) => { e.returnValue = i18n.getLang(); });
  handle('app:info', async () => ({
    version: app.getVersion(), platform: process.platform, totalRamMb: Math.floor(os.totalmem() / 1048576),
    config: store.config, paths: store.paths, curseforge: mods.cfEnabled, lang: i18n.getLang(),
    types: Object.fromEntries(Object.entries(loaders.TYPES).map(([k, v]) => [k, Object.assign({}, v, { desc: t(v.desc) })])),
    logsDir: logger.dir(), packaged: app.isPackaged,
  }));
  handle('app:setLanguage', async (lang) => {
    const value = ['it', 'en'].includes(lang) ? lang : 'auto';
    await store.saveConfig({ language: value });
    i18n.setLang(i18n.resolveLang(value, app.getLocale()));
    if (tray) tray.setContextMenu(trayMenu());
    return i18n.getLang();
  });
  handle('app:diagnostics', () => diagnostics());
  handle('app:openLogs', () => shell.openPath(logger.dir()));
  handle('app:logError', (msg) => { logger.error('[interfaccia]', String(msg).slice(0, 4000)); return true; });

  handle('update:get', () => updater.state);
  handle('update:check', () => updater.check({ force: true }));
  handle('update:install', () => {
    const tk = task(t('Scarico l\'aggiornamento di CraftDock'));
    return updater.install({
      onProgress: (p) => tk.progress(p),
      beforeQuit: async (launch) => {
        tk.done(t('Aggiornamento scaricato: chiudo CraftDock e installo'));
        logger.info('Aggiornamento a', updater.state.version);
        quitting = true;
        send('app:shutting-down');
        await servers.stopAll();
        playit.stop();
        await launch();
        setTimeout(() => app.quit(), 400);
      },
    }).catch((e) => { tk.fail(e); throw e; });
  });
  handle('config:save', (patch) => store.saveConfig(patch));

  handle('dialog:openFolder', async (title) => {
    const r = await dialog.showOpenDialog(win, { title, properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('dialog:openFile', async (title, filters, multi) => {
    const r = await dialog.showOpenDialog(win, { title, filters, properties: multi ? ['openFile', 'multiSelections'] : ['openFile'] });
    return r.canceled ? null : (multi ? r.filePaths : r.filePaths[0]);
  });
  handle('shell:openPath', (p) => shell.openPath(p));
  handle('shell:openExternal', (url) => { if (/^https?:\/\//.test(url)) return shell.openExternal(url); return null; });

  // Server
  handle('servers:list', () => store.servers.map(serverView));
  handle('servers:get', (id) => serverView(needServer(id)));
  handle('servers:create', (opts) => createServer(opts));
  handle('servers:importFolder', (opts) => importServerFolder(opts));
  handle('servers:detect', (dir) => loaders.detectServer(dir));
  handle('servers:update', async (id, patch) => {
    const allowed = ['name', 'ramMb', 'jvmArgs', 'aikarFlags', 'autoRestart', 'autoBackupMinutes', 'backupKeep', 'backupOnStop', 'javaPath', 'port', 'publicAddress', 'notes', 'mcVersion', 'schedules'];
    const clean = {};
    for (const k of allowed) if (k in patch) clean[k] = patch[k];
    if ('schedules' in clean) clean.schedules = sanitizeSchedules(clean.schedules);
    const s = await store.update(id, clean);
    if ('port' in clean) await properties.update(path.join(s.dir, 'server.properties'), { 'server-port': String(clean.port) });
    if ('autoBackupMinutes' in clean) backups.schedule(id);
    send('servers:changed');
    return serverView(s);
  });
  handle('servers:delete', async (id, deleteFiles) => {
    needStopped(id);
    const s = needServer(id);
    await store.remove(id);
    if (deleteFiles && s.dir.startsWith(store.paths.servers)) await fsp.rm(s.dir, { recursive: true, force: true });
    send('servers:changed');
    return true;
  });
  handle('servers:reinstall', async (id, { type, mcVersion, loaderVersion, backupFirst = true }) => {
    needStopped(id);
    const s = needServer(id);
    if (backupFirst) await withTask(t('Backup prima della reinstallazione'), (p) => backups.create(id, { scope: 'world', label: 'Prima di cambiare versione', onProgress: p })).catch(() => {});
    const next = Object.assign({}, s, { type: type || s.type, mcVersion: mcVersion || s.mcVersion, loaderVersion: loaderVersion || null });
    servers.setStatus(id, 'installing');
    try {
      const res = await withTask(t('Reinstallo {name}', { name: s.name }), (progress) => loaders.install(next, { java, onProgress: progress, onLog: (l) => servers.pushLog(id, l, 'install') }));
      await store.update(id, Object.assign({ type: next.type, mcVersion: next.mcVersion }, res));
      servers.setStatus(id, 'stopped');
    } catch (e) {
      servers.setStatus(id, 'stopped');
      throw e;
    }
    send('servers:changed');
    return serverView(store.get(id));
  });
  handle('servers:start', async (id) => {
    let tk = null; // il task compare solo se serve scaricare Java
    const onProgress = (p, l) => { if (!tk) tk = task(t('Preparo Java…')); tk.progress(p, l); };
    try {
      const r = await servers.start(id, { onProgress });
      if (tk) tk.done(t('Java pronto'));
      return r;
    } catch (e) {
      if (tk) tk.fail(e);
      throw e;
    }
  });
  handle('servers:stop', (id) => servers.stop(id));
  handle('servers:restart', (id) => servers.restart(id));
  handle('servers:kill', (id) => servers.kill(id));
  handle('servers:acceptEula', (id) => servers.acceptEula(needServer(id).dir));
  handle('servers:send', (id, cmd) => servers.send(id, cmd));
  handle('servers:logs', (id) => servers.logs(id));
  handle('servers:clearLog', (id) => servers.clearLog(id));
  handle('servers:query', async (id, cmd, reSource, timeout) => {
    const m = await servers.sendAndWait(id, cmd, new RegExp(reSource, 'i'), timeout || 3000);
    return m ? [...m] : null;
  });
  handle('servers:setIcon', async (id, file) => {
    const s = needServer(id);
    const img = nativeImage.createFromPath(file);
    if (img.isEmpty()) throw new Error(t('Immagine non valida'));
    await fsp.writeFile(path.join(s.dir, 'server-icon.png'), img.resize({ width: 64, height: 64, quality: 'best' }).toPNG());
    return true;
  });
  handle('servers:getIcon', async (id) => {
    const s = needServer(id);
    try { return 'data:image/png;base64,' + (await fsp.readFile(path.join(s.dir, 'server-icon.png'))).toString('base64'); } catch (_) { return null; }
  });
  handle('servers:shareLog', async (id) => {
    const content = servers.logs(id).map((l) => l.line).join('\n').slice(-500000);
    const res = await httpRequest('https://api.mclo.gs/1/log', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'content=' + encodeURIComponent(content) });
    const j = await res.json();
    if (!j.success) throw new Error(j.error || t('Caricamento fallito'));
    return j.url;
  });
  handle('servers:openFolder', async (id, rel) => {
    const s = needServer(id);
    const p = path.resolve(s.dir, rel || '.');
    if (!p.startsWith(path.resolve(s.dir))) throw new Error(t('Percorso non valido'));
    await fsp.mkdir(p, { recursive: true });
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
    return true;
  });
  handle('servers:readFile', async (id, rel) => {
    const s = needServer(id);
    const p = path.resolve(s.dir, rel);
    if (!p.startsWith(path.resolve(s.dir))) throw new Error(t('Percorso non valido'));
    return fsp.readFile(p, 'utf8');
  });
  handle('servers:writeFile', async (id, rel, content) => {
    const s = needServer(id);
    const p = path.resolve(s.dir, rel);
    if (!p.startsWith(path.resolve(s.dir))) throw new Error(t('Percorso non valido'));
    await fsp.writeFile(p, content, 'utf8');
    return true;
  });
  handle('servers:listConfigs', async (id) => {
    const s = needServer(id);
    const out = [];
    const walk = async (dir, depth) => {
      for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && depth > 0 && !['libraries', 'mods', 'logs', 'crash-reports', 'cache', 'versions', '.fabric', 'world', 'backups'].includes(e.name)) await walk(full, depth - 1);
        else if (e.isFile() && /\.(properties|json|json5|toml|ya?ml|txt|cfg|conf|ini|snbt)$/i.test(e.name)) {
          const st = await fsp.stat(full);
          if (st.size < 512 * 1024) out.push(path.relative(s.dir, full).split(path.sep).join('/'));
        }
      }
    };
    await walk(s.dir, 3);
    return out.sort();
  });

  // server.properties
  handle('props:get', async (id) => (await properties.readFile(path.join(needServer(id).dir, 'server.properties'))).map);
  handle('props:set', async (id, updates, removed) => {
    const s = needServer(id);
    const map = await properties.update(path.join(s.dir, 'server.properties'), updates, removed || []);
    if (updates['server-port']) await store.update(id, { port: Number(updates['server-port']) });
    return map;
  });

  // Versioni & Java
  handle('versions:game', (type, snapshots) => loaders.listGameVersions(type, { snapshots }));
  handle('versions:loader', (type, mc) => loaders.listLoaderVersions(type, mc));
  handle('versions:java', (mc) => loaders.requiredJava(mc));
  handle('java:list', (force) => java.list(force));
  handle('java:install', (major) => withTask(t('Installo Java {major}', { major }), (p) => java.install(major, { onProgress: p })));

  // Giocatori
  handle('players:lists', (id) => playerLists(needServer(id)));
  handle('players:edit', (id, list, action, name, extra) => editPlayerList(needServer(id), list, action, name, extra));

  // Mondi
  handle('worlds:list', (id) => worlds.list(needServer(id)));
  handle('worlds:scanLocal', () => worlds.scanLocalSaves());
  handle('worlds:import', async (id, source, opts) => {
    needStopped(id);
    return withTask(t('Importo il mondo'), (p) => worlds.import(needServer(id), source, Object.assign({}, opts, { onProgress: p })));
  });
  handle('worlds:setActive', (id, folder) => { needStopped(id); return worlds.setActive(needServer(id), folder); });
  handle('worlds:remove', (id, folder) => { needStopped(id); return worlds.remove(needServer(id), folder); });
  handle('worlds:export', async (id, folder) => {
    const r = await dialog.showSaveDialog(win, { title: t('Esporta mondo'), defaultPath: path.join(app.getPath('downloads'), `${folder}.zip`), filters: [{ name: 'Zip', extensions: ['zip'] }] });
    if (r.canceled) return null;
    if (servers.isRunning(id)) {
      servers.send(id, 'save-all flush', { silent: true });
      await servers.waitFor(id, /Saved the game|Saved the world/i, 20000);
    }
    await withTask(t('Esporto {folder}', { folder }), (p) => worlds.exportZip(needServer(id), folder, r.filePath, (n) => p(null, t('Esporto: {n} file…', { n }))));
    shell.showItemInFolder(r.filePath);
    return r.filePath;
  });
  handle('worlds:createNew', (id, opts) => { needStopped(id); return worlds.createNew(needServer(id), opts); });
  handle('worlds:datapacks', (id, folder) => worlds.listDatapacks(needServer(id), folder));
  handle('worlds:addDatapack', (id, folder, file) => worlds.addDatapack(needServer(id), folder, file));
  handle('worlds:removeDatapack', (id, folder, name) => worlds.removeDatapack(needServer(id), folder, name));

  // Backup
  handle('backups:list', (id) => backups.list(id));
  handle('backups:create', (id, opts) => withTask(t('Backup in corso'), (p) => backups.create(id, Object.assign({}, opts, { onProgress: p }))));
  handle('backups:restore', (id, file) => withTask(t('Ripristino backup'), (p) => backups.restore(id, file, { onProgress: p })));
  handle('backups:remove', (id, file) => backups.remove(id, file));
  handle('backups:openFolder', async (id) => { await fsp.mkdir(backups.dir(id), { recursive: true }); return shell.openPath(backups.dir(id)); });

  // Mod / plugin
  handle('mods:list', (id) => mods.listInstalled(needServer(id)));
  handle('mods:toggle', (id, file) => mods.toggle(needServer(id), file));
  handle('mods:remove', (id, file) => mods.remove(needServer(id), file));
  handle('mods:add', (id, files) => mods.addFiles(needServer(id), files));
  handle('mods:checkUpdates', (id) => mods.checkUpdates(needServer(id)));
  handle('mods:applyUpdate', (id, upd) => withTask(t('Aggiorno mod'), (p) => mods.applyUpdate(needServer(id), upd, p)));
  handle('mods:disableClientOnly', (id) => mods.disableClientOnly(needServer(id)));
  handle('mr:search', (id, opts) => mods.modrinthSearch(needServer(id), opts));
  handle('mr:searchPacks', (opts) => mods.modrinthSearch({ type: 'fabric', mcVersion: '' }, Object.assign({ projectType: 'modpack' }, opts)));
  handle('mr:versions', (projectId, filter) => mods.modrinthVersions(projectId, filter || {}));
  handle('mr:install', (id, projectId, versionId) => withTask(t('Installo da Modrinth'), (p) => mods.installModrinth(needServer(id), projectId, { versionId, onProgress: p })));
  handle('cf:search', (id, opts) => mods.curseSearch(needServer(id), opts));
  handle('cf:searchPacks', (opts) => mods.curseSearch({ type: 'vanilla', mcVersion: '' }, Object.assign({ classKind: 'modpack' }, opts)));
  handle('cf:files', (modId, id) => mods.curseFiles(modId, id ? needServer(id) : null, { anyVersion: !id }));
  handle('cf:install', (id, modId, fileId) => withTask(t('Installo da CurseForge'), (p) => mods.installCurse(needServer(id), modId, { fileId, onProgress: p })));

  // Modpack → nuovo server
  handle('pack:read', async (file) => (/\.mrpack$/i.test(file) ? mods.readMrpack(file) : mods.readCurseZip(file)));
  handle('pack:createFromFile', async (file, opts) => {
    const info = /\.mrpack$/i.test(file) ? await mods.readMrpack(file) : await mods.readCurseZip(file);
    return createFromPack(file, info, opts);
  });
  handle('pack:createFromModrinth', async (versionId, opts) => {
    const v = await getJson(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`);
    const f = v.files.find((x) => x.primary) || v.files[0];
    const file = path.join(store.paths.cache, f.filename);
    await withTask(t('Scarico il modpack'), (p) => require('./util').download(f.url, file, { onProgress: (x) => p(x, t('Scarico {filename}…', { filename: f.filename })) }));
    const info = await mods.readMrpack(file);
    return createFromPack(file, info, opts);
  });
  handle('pack:createFromCurse', async (modId, fileId, opts) => {
    const f = (await getJson(`https://api.curseforge.com/v1/mods/${modId}/files/${fileId}`, { headers: mods.cfHeaders() })).data;
    if (!f.downloadUrl) throw new Error(t('Il download di questo modpack è bloccato per le app esterne: scaricalo dal sito e importa lo zip.'));
    const file = path.join(store.paths.cache, f.fileName);
    await withTask(t('Scarico il modpack'), (p) => require('./util').download(f.downloadUrl, file, { onProgress: (x) => p(x, t('Scarico {fileName}…', { fileName: f.fileName })) }));
    const info = await mods.readCurseZip(file);
    return createFromPack(file, info, opts);
  });

  // Tunnel / rete
  handle('tunnel:info', () => playit.info());
  handle('tunnel:start', () => playit.start());
  handle('tunnel:stop', () => playit.stop());
  handle('tunnel:link', () => playit.link());
  handle('tunnel:cancelLink', () => playit.cancelLink());
  handle('tunnel:unlink', () => playit.unlink());
  handle('tunnel:refresh', () => playit.refresh());
  handle('tunnel:install', () => withTask(t('Scarico playit.gg'), (p) => playit.install(p)));
  handle('tunnel:buildMac', async () => { const f = await playit.buildScriptMac(); const err = await shell.openPath(f); if (err) throw new Error(err); return f; });
  handle('tunnel:installFromFile', async () => {
    const r = await dialog.showOpenDialog(win, { title: t('Scegli l\'agente playit (playitd)'), properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return playit.installFromFile(r.filePaths[0]);
  });
  handle('tunnel:setAddress', (addr) => playit.setPublicAddress(addr));
  // Crea (o riusa) il tunnel Minecraft per la porta del server e salva l'indirizzo nel server
  handle('tunnel:ensureForServer', async (id) => {
    const s = needServer(id);
    if (!playit.proc) await playit.start();
    const tun = await withTask(t('Creo l\'indirizzo pubblico per {name}', { name: s.name }), () => playit.ensureTunnel(Number(s.port) || 25565, `CraftDock ${s.name}`));
    if (tun.address) {
      await store.update(id, { publicAddress: tun.address });
      if (!store.config.playit.publicAddress) await playit.setPublicAddress(tun.address);
      send('servers:changed');
    }
    return tun;
  });
  handle('net:info', () => networkInfo());
}

// ---------- Eventi verso l'interfaccia ----------
function wireEvents() {
  servers.on('log', (id, entry) => send('server:log', id, entry));
  servers.on('status', (id, status) => {
    send('server:status', id, status);
    const s = store.get(id);
    if (!s) return;
    if (status === 'running') { backups.schedule(id); notify(s.name, t('Server online ✔')); }
    if (status === 'crashed') notify(s.name, t('Il server si è arrestato in modo anomalo'));
    if (status === 'stopped' || status === 'crashed') backups.unschedule(id);
  });
  servers.on('players', (id, list) => send('server:players', id, list));
  servers.on('stats', (id, st) => send('server:stats', id, st));
  servers.on('eula-required', (id) => send('server:eula', id));
  servers.on('stopped', async (id, { requested }) => {
    const s = store.get(id);
    if (s && s.backupOnStop && requested) {
      withTask(t('Backup di {name} allo spegnimento', { name: s.name }), (p) => backups.create(id, { auto: true, label: 'Allo spegnimento', onProgress: p })).catch(() => {});
    }
  });
  backups.onAuto = (id, err) => {
    const s = store.get(id);
    if (err) servers.info(id, t('Backup automatico fallito: ') + err.message);
    else send('backups:changed', id, s && s.name);
  };
  playit.on('log', (l) => send('tunnel:log', l));
  playit.on('status', (st) => send('tunnel:status', st));
  playit.on('claim', (claim) => send('tunnel:claim', claim));
  playit.on('address', (a) => send('tunnel:address', a));
  playit.on('tunnels', (st) => send('tunnel:tunnels', st));
  updater.on('state', (st) => send('update:state', st));
  scheduler.on('error', (id, entry, e) => logger.warn('Pianificazione', id, entry.kind, e.message));
  scheduler.on('ran', (id, entry) => logger.info('Pianificazione eseguita', id, entry.kind, entry.time));
  servers.on('status', (id, status) => logger.info('Server', id, '→', status));
}

/** Testo da copiare quando si chiede aiuto: versioni, sistema, server, tunnel e ultime righe del log. */
async function diagnostics() {
  const javas = await java.list().catch(() => []);
  const lines = [
    `CraftDock ${app.getVersion()}${app.isPackaged ? '' : ' (sviluppo)'}${process.env.PORTABLE_EXECUTABLE_DIR ? ' portatile' : ''}`,
    `Sistema: ${os.type()} ${os.release()} ${os.arch()} · RAM ${Math.round(os.totalmem() / 1073741824)} GB · CPU ${os.cpus().length}x ${(os.cpus()[0] || {}).model || '?'}`,
    `Electron ${process.versions.electron} · Node ${process.versions.node} · Chrome ${process.versions.chrome} · lingua ${i18n.getLang()} (${app.getLocale()})`,
    `Cartella dati: ${store.config.root}`,
    `Java trovati: ${javas.map((j) => `${j.version}${j.managed ? '*' : ''}`).join(', ') || 'nessuno'}`,
    `playit: ${playit.status}${store.config.playit && store.config.playit.publicAddress ? ' · ' + store.config.playit.publicAddress : ''}`,
    `Aggiornamenti: ${updater.state.available ? 'disponibile ' + updater.state.version : 'aggiornato'}${updater.state.error ? ' (errore: ' + updater.state.error + ')' : ''}`,
    '',
    `Server (${store.servers.length}):`,
    ...store.servers.map((s) => {
      const st = servers.state(s.id) || {};
      return `- ${s.name}: ${s.type} ${s.mcVersion || '?'}${s.loaderVersion ? ' / ' + s.loaderVersion : ''} · ${s.ramMb} MB · porta ${s.port} · Java ${s.javaPath ? 'personalizzato' : 'auto ' + (s.javaMajor || '?')} · ${st.status || 'stopped'}${(s.schedules || []).length ? ' · ' + s.schedules.length + ' operazioni programmate' : ''}`;
    }),
    '',
    'Ultime righe del log:',
    ...logger.recent(80),
  ];
  // niente percorsi con il nome utente di Windows nel testo da condividere
  const home = os.homedir();
  const esc = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return lines.join('\n').replace(new RegExp(`(?<=^|[\\s'"(])${esc}(?=[\\\\/]|$)`, 'gim'), process.platform === 'win32' ? '%USERPROFILE%' : '~');
}

// ---------- Finestra ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1040, minHeight: 680,
    backgroundColor: '#0c0b09', title: 'CraftDock', icon: ICON, show: false,
    autoHideMenuBar: true,
    // Windows/Linux: barra del titolo scura con i pulsanti di sistema disegnati sopra.
    // macOS: semafori integrati nella barra laterale.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 16 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#0c0b09', symbolColor: '#f3efe7', height: 40 } }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });

  win.on('close', async (e) => {
    if (quitting) return;
    if (store.config.closeToTray) { e.preventDefault(); win.hide(); ensureTray(); return; }
    const running = servers.runningIds();
    if (!running.length) { quitting = true; playit.stop(); return; }
    e.preventDefault();
    const names = running.map((id) => store.get(id).name).join(', ');
    const r = await dialog.showMessageBox(win, {
      type: 'warning', buttons: [t('Ferma i server ed esci'), t('Annulla')], defaultId: 0, cancelId: 1,
      title: t('Server in esecuzione'), message: t('Sono accesi: {names}', { names }), detail: t('I server verranno fermati in modo sicuro (salvando i mondi) prima di chiudere.'),
    });
    if (r.response !== 0) return;
    await shutdown();
  });
}

async function shutdown() {
  quitting = true;
  send('app:shutting-down');
  await servers.stopAll();
  playit.stop();
  app.quit();
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: t('Apri CraftDock'), click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: t('Esci (ferma i server)'), click: () => shutdown() },
  ]);
}

function ensureTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'assets', 'icon-small.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('CraftDock');
  tray.setContextMenu(trayMenu());
  tray.on('double-click', () => { win.show(); win.focus(); });
}

app.whenReady().then(async () => {
  logger.init(path.join(app.getPath('userData'), 'logs'));
  logger.info(`CraftDock ${app.getVersion()} · Electron ${process.versions.electron} · ${os.type()} ${os.release()} ${os.arch()}`);
  store = await new Store(app.getPath('userData')).load();
  i18n.setLang(i18n.resolveLang(store.config.language, app.getLocale()));
  java = new JavaManager(store);
  servers = new ServerManager(store, java);
  worlds = new WorldManager(store);
  backups = new BackupManager(store, servers);
  mods = new ModManager(store);
  playit = new PlayitManager(store, { appVersion: app.getVersion(), openExternal: (url) => shell.openExternal(url) });
  updater = new Updater({ currentVersion: app.getVersion(), isPackaged: app.isPackaged, store });
  scheduler = new Scheduler({ store, servers, backups });
  // Su macOS il menu dell'app serve per Cmd+C/V/Q e per la finestra; su Windows non si mostra.
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]) : null);
  registerIpc();
  wireEvents();
  createWindow();
  if (store.config.playit && store.config.playit.autoStart) playit.start().catch(() => {});
  scheduler.start();
  if (!process.env.CRAFTDOCK_NO_UPDATE) updater.startAuto();
});

app.on('before-quit', (e) => {
  if (!quitting && servers && servers.runningIds().length) { e.preventDefault(); shutdown(); }
});
app.on('window-all-closed', () => app.quit());
// macOS: clic sull'icona nel Dock con la finestra nascosta
app.on('activate', () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); } });
