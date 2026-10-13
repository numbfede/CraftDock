'use strict';
// Mod e plugin: elenco installati, Modrinth, CurseForge, aggiornamenti, modpack (.mrpack e zip CurseForge).

const path = require('path');
const fsp = require('fs/promises');
const { getJson, postJson, download, sha1File, exists, readJson, writeJson, compareVersions } = require('./util');
const zip = require('./zip');
const { MODRINTH_LOADER, CURSE_LOADER, TYPES } = require('./loaders');
const CF_BUILTIN_KEY = require('./curseforge-key');

const { t } = require('../shared/i18n');
const MR = 'https://api.modrinth.com/v2';
const CF = 'https://api.curseforge.com/v1';
const CF_GAME = 432;
const CF_CLASS = { mod: 6, plugin: 5, modpack: 4471 };

// Mod che fanno crashare un server dedicato (solo client) e che vanno disattivate nei modpack
const CLIENT_ONLY_RE = /^(optifine|oculus|iris|sodium|embeddium|rubidium|magnesium|reeses[-_]?sodium|sodium[-_]?extra|indium|lambdynamiclights|xaeros?[-_]?minimap|xaeros?[-_]?worldmap|betterf3|legendarytooltips|fancymenu|drippyloadingscreen|skinlayers3d|3dskinlayers|entity[-_]?model[-_]?features|entitytexturefeatures|continuity|zoomify|ok[-_]?zoomer)/i;

function folderFor(server) {
  return TYPES[server.type] && TYPES[server.type].plugins ? 'plugins' : 'mods';
}

function tomlValue(text, key) {
  const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*(?:"""([\\s\\S]*?)"""|"([^"]*)"|'([^']*)'|([^#\\n]+))`, 'm'));
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim();
}

function yamlValue(text, key) {
  const m = text.match(new RegExp(`^${key}\\s*:\\s*['"]?([^'"\\n]+)['"]?`, 'm'));
  return m ? m[1].trim() : null;
}

class ModManager {
  constructor(store) {
    this.store = store;
    this.metaCache = new Map();
  }

  get cfKey() { return CF_BUILTIN_KEY; }
  get cfEnabled() { return !!CF_BUILTIN_KEY; }

  cfHeaders() {
    if (!this.cfKey) { const e = new Error(t('CurseForge non è ancora disponibile in CraftDock: arriverà con un prossimo aggiornamento. Nel frattempo usa Modrinth.')); e.code = 'CF_DISABLED'; throw e; }
    return { 'x-api-key': this.cfKey, Accept: 'application/json' };
  }

  dir(server) { return path.join(server.dir, folderFor(server)); }
  trackFile(server) { return path.join(this.dir(server), '.craftdock.json'); }
  async track(server) { return readJson(this.trackFile(server), {}); }
  async saveTrack(server, data) { await writeJson(this.trackFile(server), data); }

  /** Legge i metadati di un jar (Fabric, Quilt, Forge/NeoForge, plugin Bukkit). */
  async readJarMeta(file) {
    const st = await fsp.stat(file);
    const key = `${file}|${st.size}|${st.mtimeMs}`;
    if (this.metaCache.has(key)) return this.metaCache.get(key);
    const meta = { name: null, id: null, version: null, description: '', icon: null, environment: null, authors: [] };
    const wanted = ['fabric.mod.json', 'quilt.mod.json', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml', 'plugin.yml', 'paper-plugin.yml', 'META-INF/MANIFEST.MF'];
    const files = {};
    let iconPath = null;
    try {
      await zip.forEachEntry(file, async (entry, z) => {
        if (!wanted.includes(entry.fileName)) return true;
        const buf = await new Promise((res, rej) => z.openReadStream(entry, async (err, s) => {
          if (err) return rej(err);
          const chunks = []; for await (const c of s) chunks.push(c); res(Buffer.concat(chunks));
        }));
        files[entry.fileName] = buf.toString('utf8');
        return true;
      });
      if (files['fabric.mod.json']) {
        const j = JSON.parse(files['fabric.mod.json'].replace(/[\u0000-\u0019]+/g, ' '));
        Object.assign(meta, { id: j.id, name: j.name || j.id, version: j.version, description: j.description || '', environment: j.environment || '*' });
        meta.authors = (j.authors || []).map((a) => (typeof a === 'string' ? a : a.name));
        iconPath = typeof j.icon === 'string' ? j.icon : (j.icon && Object.values(j.icon).pop());
      } else if (files['quilt.mod.json']) {
        const j = JSON.parse(files['quilt.mod.json']);
        const ql = j.quilt_loader || {};
        Object.assign(meta, { id: ql.id, name: (ql.metadata && ql.metadata.name) || ql.id, version: ql.version, description: (ql.metadata && ql.metadata.description) || '', environment: (j.minecraft && j.minecraft.environment) || '*' });
        iconPath = ql.metadata && (typeof ql.metadata.icon === 'string' ? ql.metadata.icon : null);
      } else if (files['META-INF/neoforge.mods.toml'] || files['META-INF/mods.toml']) {
        const toml = files['META-INF/neoforge.mods.toml'] || files['META-INF/mods.toml'];
        meta.id = tomlValue(toml, 'modId');
        meta.name = tomlValue(toml, 'displayName') || meta.id;
        meta.version = tomlValue(toml, 'version');
        meta.description = (tomlValue(toml, 'description') || '').slice(0, 400);
        iconPath = tomlValue(toml, 'logoFile');
        if (/clientSideOnly\s*=\s*true/.test(toml)) meta.environment = 'client';
        if (meta.version && meta.version.includes('${') && files['META-INF/MANIFEST.MF']) {
          const m = files['META-INF/MANIFEST.MF'].match(/Implementation-Version:\s*(\S+)/);
          meta.version = m ? m[1] : null;
        }
      } else if (files['plugin.yml'] || files['paper-plugin.yml']) {
        const y = files['paper-plugin.yml'] || files['plugin.yml'];
        meta.name = yamlValue(y, 'name');
        meta.id = meta.name;
        meta.version = yamlValue(y, 'version');
        meta.description = yamlValue(y, 'description') || '';
      }
      if (iconPath) {
        const buf = await zip.readEntry(file, iconPath.replace(/^\//, ''));
        if (buf && buf.length < 300 * 1024) meta.icon = 'data:image/png;base64,' + buf.toString('base64');
      }
    } catch (_) { /* jar illeggibile: mostriamo solo il nome file */ }
    this.metaCache.set(key, meta);
    return meta;
  }

  async listInstalled(server) {
    const dir = this.dir(server);
    await fsp.mkdir(dir, { recursive: true });
    const track = await this.track(server);
    const out = [];
    for (const f of await fsp.readdir(dir)) {
      if (!/\.jar(\.disabled)?$/i.test(f)) continue;
      const full = path.join(dir, f);
      const st = await fsp.stat(full);
      const enabled = !f.endsWith('.disabled');
      const meta = await this.readJarMeta(full);
      const baseName = enabled ? f : f.replace(/\.disabled$/, '');
      out.push(Object.assign({ file: f, enabled, size: st.size, source: track[baseName] || null }, meta, { name: meta.name || baseName.replace(/\.jar$/i, '') }));
    }
    out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return { folder: folderFor(server), dir, mods: out };
  }

  async toggle(server, file) {
    const dir = this.dir(server);
    const from = path.join(dir, path.basename(file));
    const to = file.endsWith('.disabled') ? from.replace(/\.disabled$/, '') : from + '.disabled';
    await fsp.rename(from, to);
  }

  async remove(server, file) {
    const p = path.join(this.dir(server), path.basename(file));
    await fsp.rm(p, { force: true });
    const track = await this.track(server);
    delete track[path.basename(file).replace(/\.disabled$/, '')];
    await this.saveTrack(server, track);
  }

  async addFiles(server, files) {
    const dir = this.dir(server);
    await fsp.mkdir(dir, { recursive: true });
    const added = [];
    for (const f of files) {
      if (!/\.jar$/i.test(f)) continue;
      await fsp.copyFile(f, path.join(dir, path.basename(f)));
      added.push(path.basename(f));
    }
    return added;
  }

  // ---------------- Modrinth ----------------

  mrLoaders(server) { return MODRINTH_LOADER[server.type] || []; }

  async modrinthSearch(server, { query = '', projectType, offset = 0, sort = 'relevance', ignoreVersion = false } = {}) {
    const type = projectType || (TYPES[server.type].plugins ? 'plugin' : 'mod');
    const facets = [[`project_type:${type}`]];
    if (type !== 'modpack') {
      const loaders = this.mrLoaders(server);
      if (loaders.length) facets.push(loaders.map((l) => `categories:${l}`));
      if (!ignoreVersion) facets.push([`versions:${server.mcVersion}`]);
      if (type === 'mod') facets.push(['server_side:required', 'server_side:optional']);
    }
    const url = `${MR}/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}&index=${sort}&offset=${offset}&limit=20`;
    const r = await getJson(url);
    return {
      total: r.total_hits,
      hits: r.hits.map((h) => ({
        source: 'modrinth', id: h.project_id, slug: h.slug, title: h.title, description: h.description, icon: h.icon_url,
        downloads: h.downloads, author: h.author, categories: h.display_categories || h.categories, serverSide: h.server_side, clientSide: h.client_side,
        url: `https://modrinth.com/${h.project_type}/${h.slug}`, latest: h.latest_version, versions: h.versions,
      })),
    };
  }

  async modrinthVersions(projectId, { loaders, gameVersions } = {}) {
    let url = `${MR}/project/${encodeURIComponent(projectId)}/version`;
    const qs = [];
    if (loaders && loaders.length) qs.push('loaders=' + encodeURIComponent(JSON.stringify(loaders)));
    if (gameVersions && gameVersions.length) qs.push('game_versions=' + encodeURIComponent(JSON.stringify(gameVersions)));
    if (qs.length) url += '?' + qs.join('&');
    return getJson(url);
  }

  async modrinthProject(id) { return getJson(`${MR}/project/${encodeURIComponent(id)}`); }

  /** Installa una mod da Modrinth con tutte le dipendenze obbligatorie. */
  async installModrinth(server, projectId, { versionId, onProgress, _seen } = {}) {
    const seen = _seen || new Set();
    if (seen.has(projectId)) return [];
    seen.add(projectId);
    const track = await this.track(server);
    const already = Object.entries(track).find(([, v]) => v.source === 'modrinth' && v.projectId === projectId);
    if (already && !versionId && (await exists(path.join(this.dir(server), already[0])))) return [];

    let version;
    if (versionId) version = await getJson(`${MR}/version/${encodeURIComponent(versionId)}`);
    else {
      const list = await this.modrinthVersions(projectId, { loaders: this.mrLoaders(server), gameVersions: [server.mcVersion] });
      version = list.find((v) => v.version_type === 'release') || list[0];
    }
    if (!version) {
      const p = await this.modrinthProject(projectId).catch(() => ({ title: projectId }));
      throw new Error(t('"{title}" non ha una versione per {p1} {mcVersion}', { title: p.title, p1: TYPES[server.type].name, mcVersion: server.mcVersion }));
    }
    const file = version.files.find((f) => f.primary) || version.files[0];
    const dir = this.dir(server);
    await fsp.mkdir(dir, { recursive: true });
    // rimuove la versione precedente della stessa mod (aggiornamento)
    if (already && already[0] !== file.filename) {
      await fsp.rm(path.join(dir, already[0]), { force: true });
      await fsp.rm(path.join(dir, already[0] + '.disabled'), { force: true });
      delete track[already[0]];
    }
    onProgress && onProgress(0, t('Scarico {filename}…', { filename: file.filename }));
    await download(file.url, path.join(dir, file.filename), { sha1: file.hashes && file.hashes.sha1, onProgress: (p) => onProgress && onProgress(p, t('Scarico {filename}…', { filename: file.filename })) });
    const fresh = await this.track(server);
    if (already && already[0] !== file.filename) delete fresh[already[0]];
    fresh[file.filename] = { source: 'modrinth', projectId, versionId: version.id, version: version.version_number };
    await this.saveTrack(server, fresh);
    const installed = [file.filename];
    for (const dep of version.dependencies || []) {
      if (dep.dependency_type !== 'required') continue;
      const depProject = dep.project_id || (dep.version_id && (await getJson(`${MR}/version/${dep.version_id}`)).project_id);
      if (!depProject) continue;
      try {
        installed.push(...await this.installModrinth(server, depProject, { onProgress, _seen: seen }));
      } catch (e) { installed.push(t('⚠ dipendenza non installata: {message}', { message: e.message })); }
    }
    return installed;
  }

  /** Controlla gli aggiornamenti dei jar installati tramite hash (funziona anche per jar aggiunti a mano). */
  async checkUpdates(server) {
    const dir = this.dir(server);
    const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => /\.jar$/i.test(f));
    const hashes = {};
    for (const f of files) hashes[await sha1File(path.join(dir, f))] = f;
    if (!Object.keys(hashes).length) return [];
    const res = await postJson(`${MR}/version_files/update`, {
      hashes: Object.keys(hashes), algorithm: 'sha1', loaders: this.mrLoaders(server), game_versions: [server.mcVersion],
    });
    const updates = [];
    for (const [hash, v] of Object.entries(res)) {
      const current = hashes[hash];
      const primary = v.files.find((f) => f.primary) || v.files[0];
      if (primary && primary.hashes.sha1 !== hash) {
        updates.push({ file: current, projectId: v.project_id, versionId: v.id, newVersion: v.version_number, newFile: primary.filename });
      }
    }
    return updates;
  }

  async applyUpdate(server, upd, onProgress) {
    const track = await this.track(server);
    track[upd.file] = { source: 'modrinth', projectId: upd.projectId };
    await this.saveTrack(server, track);
    return this.installModrinth(server, upd.projectId, { versionId: upd.versionId, onProgress });
  }

  // ---------------- CurseForge ----------------

  async curseSearch(server, { query = '', classKind, offset = 0, sort = 2, ignoreVersion = false } = {}) {
    const kind = classKind || (TYPES[server.type].plugins ? 'plugin' : 'mod');
    const params = new URLSearchParams({ gameId: CF_GAME, classId: CF_CLASS[kind], searchFilter: query, sortField: sort, sortOrder: 'desc', pageSize: 20, index: offset });
    if (kind !== 'modpack') {
      if (!ignoreVersion) params.set('gameVersion', server.mcVersion);
      if (CURSE_LOADER[server.type]) params.set('modLoaderType', CURSE_LOADER[server.type]);
    }
    const r = await getJson(`${CF}/mods/search?${params}`, { headers: this.cfHeaders() });
    return {
      total: r.pagination ? r.pagination.totalCount : r.data.length,
      hits: r.data.map((m) => ({
        source: 'curseforge', id: m.id, slug: m.slug, title: m.name, description: m.summary, icon: m.logo && m.logo.thumbnailUrl,
        downloads: m.downloadCount, author: (m.authors[0] || {}).name, categories: (m.categories || []).map((c) => c.name),
        url: m.links && m.links.websiteUrl,
      })),
    };
  }

  async curseFiles(modId, server, { anyVersion = false } = {}) {
    const params = new URLSearchParams({ pageSize: 50 });
    if (server && !anyVersion) {
      params.set('gameVersion', server.mcVersion);
      if (CURSE_LOADER[server.type]) params.set('modLoaderType', CURSE_LOADER[server.type]);
    }
    const r = await getJson(`${CF}/mods/${modId}/files?${params}`, { headers: this.cfHeaders() });
    return r.data;
  }

  async installCurse(server, modId, { fileId, onProgress, _seen } = {}) {
    const seen = _seen || new Set();
    if (seen.has(modId)) return [];
    seen.add(modId);
    const track = await this.track(server);
    const already = Object.entries(track).find(([, v]) => v.source === 'curseforge' && v.projectId === modId);
    if (already && !fileId && (await exists(path.join(this.dir(server), already[0])))) return [];
    let file;
    if (fileId) file = (await getJson(`${CF}/mods/${modId}/files/${fileId}`, { headers: this.cfHeaders() })).data;
    else {
      const files = await this.curseFiles(modId, server);
      file = files.find((f) => f.releaseType === 1) || files[0];
    }
    if (!file) throw new Error(t('Nessun file CurseForge compatibile con {mcVersion}', { mcVersion: server.mcVersion }));
    if (!file.downloadUrl) {
      const mod = (await getJson(`${CF}/mods/${modId}`, { headers: this.cfHeaders() })).data;
      const e = new Error(t('L\'autore di "{name}" non permette il download da app esterne. Scaricalo dal sito e trascinalo qui.', { name: mod.name }));
      e.url = mod.links && mod.links.websiteUrl;
      throw e;
    }
    const dir = this.dir(server);
    if (already && already[0] !== file.fileName) await fsp.rm(path.join(dir, already[0]), { force: true });
    onProgress && onProgress(0, t('Scarico {fileName}…', { fileName: file.fileName }));
    await download(file.downloadUrl, path.join(dir, file.fileName), { onProgress: (p) => onProgress && onProgress(p, t('Scarico {fileName}…', { fileName: file.fileName })) });
    const fresh = await this.track(server);
    if (already) delete fresh[already[0]];
    fresh[file.fileName] = { source: 'curseforge', projectId: modId, fileId: file.id, version: file.displayName };
    await this.saveTrack(server, fresh);
    const installed = [file.fileName];
    for (const dep of file.dependencies || []) {
      if (dep.relationType !== 3) continue;
      try { installed.push(...await this.installCurse(server, dep.modId, { onProgress, _seen: seen })); } catch (e) { installed.push(t('⚠ dipendenza non installata: {message}', { message: e.message })); }
    }
    return installed;
  }

  // ---------------- Modpack ----------------

  /** Legge un .mrpack e restituisce le info necessarie per creare il server. */
  async readMrpack(file) {
    const buf = await zip.readEntry(file, 'modrinth.index.json');
    if (!buf) throw new Error(t('File .mrpack non valido'));
    const idx = JSON.parse(buf.toString('utf8'));
    const d = idx.dependencies || {};
    let type = 'vanilla'; let loaderVersion = null;
    if (d['fabric-loader']) { type = 'fabric'; loaderVersion = d['fabric-loader']; }
    else if (d['quilt-loader']) { type = 'quilt'; loaderVersion = d['quilt-loader']; }
    else if (d.neoforge) { type = 'neoforge'; loaderVersion = d.neoforge; }
    else if (d.forge) { type = 'forge'; loaderVersion = d.forge; }
    return { name: idx.name, version: idx.versionId, summary: idx.summary, mcVersion: d.minecraft, type, loaderVersion, files: idx.files || [], format: 'mrpack' };
  }

  async readCurseZip(file) {
    const buf = await zip.readEntry(file, 'manifest.json');
    if (!buf) throw new Error(t('Zip CurseForge non valido (manca manifest.json)'));
    const m = JSON.parse(buf.toString('utf8'));
    const loader = ((m.minecraft.modLoaders || []).find((l) => l.primary) || m.minecraft.modLoaders[0] || {}).id || '';
    const [lname, ...rest] = loader.split('-');
    const lv = rest.join('-');
    const type = { forge: 'forge', neoforge: 'neoforge', fabric: 'fabric', quilt: 'quilt' }[lname] || 'vanilla';
    return { name: m.name, version: m.version, mcVersion: m.minecraft.version, type, loaderVersion: lv || null, files: m.files || [], overrides: m.overrides || 'overrides', format: 'curseforge' };
  }

  /** Scarica i file del modpack nella cartella del server (dopo che il loader è stato installato). */
  async installPackFiles(server, packFile, pack, onProgress) {
    const warnings = [];
    if (pack.format === 'mrpack') {
      const files = pack.files.filter((f) => !f.env || f.env.server !== 'unsupported');
      let i = 0;
      for (const f of files) {
        i++;
        const dest = path.resolve(server.dir, f.path);
        if (!dest.startsWith(path.resolve(server.dir) + path.sep)) continue;
        onProgress && onProgress(i / files.length, `Mod ${i}/${files.length}: ${path.basename(f.path)}`);
        try { await download(f.downloads[0], dest, { sha1: f.hashes && f.hashes.sha1 }); } catch (e) { warnings.push(`${path.basename(f.path)}: ${e.message}`); }
      }
      onProgress && onProgress(null, t('Copio configurazioni del modpack…'));
      await zip.extract(packFile, server.dir, { stripPrefix: 'overrides/' });
      await zip.extract(packFile, server.dir, { stripPrefix: 'server-overrides/' });
    } else {
      const ids = pack.files.filter((f) => f.required !== false).map((f) => f.fileID);
      onProgress && onProgress(null, t('Recupero l\'elenco delle mod da CurseForge…'));
      const res = await postJson(`${CF}/mods/files`, { fileIds: ids }, { headers: this.cfHeaders() });
      const files = res.data || [];
      const dir = path.join(server.dir, 'mods');
      let i = 0;
      for (const f of files) {
        i++;
        onProgress && onProgress(i / files.length, `Mod ${i}/${files.length}: ${f.fileName}`);
        if (!f.downloadUrl) { warnings.push(t('{fileName}: download bloccato dall\'autore, va scaricato a mano', { fileName: f.fileName })); continue; }
        try { await download(f.downloadUrl, path.join(dir, f.fileName)); } catch (e) { warnings.push(`${f.fileName}: ${e.message}`); }
      }
      onProgress && onProgress(null, t('Copio configurazioni del modpack…'));
      await zip.extract(packFile, server.dir, { stripPrefix: pack.overrides.replace(/\/?$/, '/') });
    }
    const disabled = await this.disableClientOnly(server);
    return { warnings, disabled };
  }

  /**
   * Mod che servono anche a chi entra nel server: quelle attive, tranne le solo-server,
   * più le mod solo-client che CraftDock ha disattivato sul server (shader, minimappe dei modpack…).
   */
  async friendsMods(server) {
    if (folderFor(server) !== 'mods' || server.type === 'vanilla') return { include: [], skipped: [] };
    const dir = this.dir(server);
    const include = []; const skipped = [];
    for (const f of (await fsp.readdir(dir).catch(() => [])).sort()) {
      if (!/\.jar(\.disabled)?$/i.test(f)) continue;
      const full = path.join(dir, f);
      const meta = await this.readJarMeta(full);
      const name = f.replace(/\.disabled$/i, '');
      const label = meta.name || name;
      if (f.endsWith('.disabled')) {
        if (meta.environment === 'client' || CLIENT_ONLY_RE.test(name)) include.push({ file: full, name, label });
        continue;
      }
      if (meta.environment === 'server') { skipped.push(label); continue; }
      include.push({ file: full, name, label });
    }
    return { include, skipped };
  }

  /**
   * Pacchetto per gli amici. format 'mrpack': si importa in Modrinth App, Prism, ATLauncher e crea
   * un profilo con la stessa versione di Minecraft e del loader; le mod presenti su Modrinth vengono
   * indicate con il loro link, le altre sono incluse nel file. format 'zip': solo i .jar da mettere in mods.
   */
  async exportFriendsPack(server, outFile, { format = 'mrpack', onProgress } = {}) {
    const { include, skipped } = await this.friendsMods(server);
    if (!include.length) throw new Error(t('Questo server non ha mod da passare agli amici: basta Minecraft {mcVersion}.', { mcVersion: server.mcVersion }));
    onProgress && onProgress(null, t('Preparo il pacchetto…'));
    if (format === 'zip') {
      await zip.createZip(outFile, include.map((m) => ({ path: m.file, name: `mods/${m.name}` })));
      return { file: outFile, count: include.length, linked: 0, skipped };
    }
    // cerca su Modrinth le mod per hash: quelle trovate si scaricano da lì, le altre vanno nel pacchetto
    const bySha1 = new Map();
    for (const m of include) bySha1.set(await sha1File(m.file), m);
    let found = {};
    try {
      found = await postJson(`${MR}/version_files`, { hashes: [...bySha1.keys()], algorithm: 'sha1' });
    } catch (_) { /* senza rete tutte le mod finiscono nel pacchetto */ }
    const files = []; const overrides = [];
    for (const [sha1, m] of bySha1) {
      const v = found[sha1];
      const f = v && (v.files || []).find((x) => x.hashes && x.hashes.sha1 === sha1);
      if (f && f.url && f.hashes.sha512) {
        files.push({ path: `mods/${m.name}`, hashes: { sha1, sha512: f.hashes.sha512 }, env: { client: 'required', server: 'optional' }, downloads: [f.url], fileSize: f.size });
      } else overrides.push(m);
    }
    const LOADER_DEP = { fabric: 'fabric-loader', quilt: 'quilt-loader', forge: 'forge', neoforge: 'neoforge' };
    const dependencies = { minecraft: server.mcVersion };
    const loaderVersion = LOADER_DEP[server.type] ? (server.loaderVersion || await this.guessLoaderVersion(server)) : null;
    if (loaderVersion) dependencies[LOADER_DEP[server.type]] = loaderVersion;
    const index = {
      formatVersion: 1, game: 'minecraft', versionId: new Date().toISOString().slice(0, 10),
      name: server.name, summary: t('Le mod per entrare nel server {name} (creato con CraftDock)', { name: server.name }),
      files, dependencies,
    };
    const tmpDir = await fsp.mkdtemp(path.join(require('os').tmpdir(), 'craftdock-pack-'));
    try {
      const indexFile = path.join(tmpDir, 'modrinth.index.json');
      await fsp.writeFile(indexFile, JSON.stringify(index, null, 2));
      await zip.createZip(outFile, [{ path: indexFile, name: 'modrinth.index.json' }].concat(overrides.map((m) => ({ path: m.file, name: `overrides/mods/${m.name}` }))));
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
    return { file: outFile, count: include.length, linked: files.length, skipped, loaderMissing: !!LOADER_DEP[server.type] && !loaderVersion };
  }

  /** Versione del loader per i server importati (non registrata da CraftDock): cartella libraries, poi l'ultima stabile. */
  async guessLoaderVersion(server) {
    const LIB = {
      fabric: ['net', 'fabricmc', 'fabric-loader'], quilt: ['org', 'quiltmc', 'quilt-loader'],
      forge: ['net', 'minecraftforge', 'forge'], neoforge: ['net', 'neoforged', 'neoforge'],
    }[server.type];
    if (!LIB) return null;
    const dirs = (await fsp.readdir(path.join(server.dir, 'libraries', ...LIB)).catch(() => [])).filter((d) => /^\d/.test(d)).sort(compareVersions);
    let v = dirs.pop() || null;
    if (v && server.type === 'forge' && v.startsWith(server.mcVersion + '-')) v = v.slice(server.mcVersion.length + 1);
    if (v) return v;
    if (server.type === 'fabric') {
      const list = await getJson('https://meta.fabricmc.net/v2/versions/loader').catch(() => []);
      const stable = list.find((x) => x.stable) || list[0];
      return stable ? stable.version : null;
    }
    return null;
  }

  /** Disattiva le mod solo-client (che impedirebbero l'avvio del server dedicato). */
  async disableClientOnly(server) {
    const dir = path.join(server.dir, 'mods');
    const disabled = [];
    for (const f of await fsp.readdir(dir).catch(() => [])) {
      if (!/\.jar$/i.test(f)) continue;
      const meta = await this.readJarMeta(path.join(dir, f));
      if (meta.environment === 'client' || CLIENT_ONLY_RE.test(f)) {
        await fsp.rename(path.join(dir, f), path.join(dir, f + '.disabled'));
        disabled.push(meta.name || f);
      }
    }
    return disabled;
  }
}

module.exports = { ModManager, folderFor, CLIENT_ONLY_RE };
