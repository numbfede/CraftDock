'use strict';
/* Procedura guidata: nuovo server, server da modpack, importazione di una cartella server esistente. */

function ramField(initial) {
  const total = App.info.totalRamMb;
  const max = Math.max(2048, Math.floor((total - 1536) / 512) * 512);
  const val = h('strong', '');
  const input = h('input.range', { type: 'range', min: 1024, max, step: 512, value: Math.min(initial, max) });
  const upd = () => {
    const v = Number(input.value);
    val.textContent = `${(v / 1024).toFixed(1).replace('.0', '')} GB`;
    val.style.color = v > total * 0.7 ? 'var(--yellow)' : '';
  };
  input.addEventListener('input', upd);
  upd();
  const field = h('.field', h('label', t('RAM dedicata:'), ' ', val),
    input, h('.hint', t('Il PC ha {gb} GB. Vanilla/Paper: 2-4 GB · mod leggere: 4-6 GB · modpack grandi: 6-10 GB.', { gb: (total / 1024).toFixed(1) })));
  field.getValue = () => Number(input.value);
  return field;
}

function eulaCheck() {
  const cb = h('input', { type: 'checkbox' });
  const el = h('label.check', cb, h('span', t('Accetto la'), ' ', h('a', { onclick: (e) => { e.preventDefault(); api('shell:openExternal', 'https://aka.ms/MinecraftEULA'); } }, t('EULA di Minecraft')), ' ', t('(obbligatoria per avviare qualsiasi server).')));
  el.isChecked = () => cb.checked;
  return el;
}

async function getVersions(type, snapshots) {
  const key = `${type}|${snapshots}`;
  if (!App.versionCache.has(key)) App.versionCache.set(key, await api('versions:game', type, snapshots));
  return App.versionCache.get(key);
}

/** Selettore tipo + versione + versione loader, riutilizzato anche per "Cambia versione". */
function versionPicker({ type = 'fabric', mcVersion, loaderVersion, allowTypeChange = true, onChange } = {}) {
  const state = { type, mcVersion, loaderVersion: loaderVersion || '' };
  const root = h('div.col');
  const typeGrid = h('.type-grid');
  const mcSel = h('select.input');
  const loaderSel = h('select.input');
  const snap = h('input', { type: 'checkbox', checked: App.info.config.showSnapshots });
  const loaderField = h('.field', h('label', t('Versione del loader')), loaderSel, h('.hint', t('La prima è quella consigliata.')));
  const javaHint = h('.hint');

  const drawTypes = () => {
    typeGrid.innerHTML = '';
    for (const [id, ty] of Object.entries(App.info.types)) {
      typeGrid.appendChild(h('.type-card' + (state.type === id ? '.sel' : ''), { onclick: () => { state.type = id; drawTypes(); loadMc(); } },
        id === 'fabric' ? h('span.star.tag.green', t('consigliato')) : null,
        h('.tn', typeGlyph(id), ty.name),
        h('.td', t(ty.desc))));
    }
  };

  const loadLoaders = async () => {
    loaderSel.innerHTML = '';
    if (state.type === 'vanilla') { loaderField.classList.add('hidden'); emit(); return; }
    loaderField.classList.remove('hidden');
    loaderSel.appendChild(h('option', t('Caricamento…')));
    try {
      const list = await api('versions:loader', state.type, state.mcVersion);
      loaderSel.innerHTML = '';
      if (!list.length) loaderSel.appendChild(h('option', { value: '' }, t('Nessuna versione disponibile')));
      list.slice(0, 150).forEach((l, i) => {
        const tagTxt = l.recommended ? ` (${t('consigliata')})` : i === 0 ? ` (${t('ultima')})` : !l.stable ? t(' (beta)') : '';
        loaderSel.appendChild(h('option', { value: l.id }, l.id + tagTxt));
      });
      if (state.loaderVersion && list.some((l) => l.id === state.loaderVersion)) loaderSel.value = state.loaderVersion;
      state.loaderVersion = loaderSel.value;
    } catch (e) { loaderSel.innerHTML = ''; loaderSel.appendChild(h('option', { value: '' }, t('Errore: {msg}', { msg: e.message }))); }
    emit();
  };

  const loadMc = async () => {
    mcSel.innerHTML = '';
    mcSel.appendChild(h('option', t('Caricamento versioni…')));
    try {
      const list = await getVersions(state.type, snap.checked);
      mcSel.innerHTML = '';
      for (const v of list) mcSel.appendChild(h('option', { value: v.id }, v.id + (v.stable ? '' : t(' (snapshot)'))));
      if (state.mcVersion && list.some((v) => v.id === state.mcVersion)) mcSel.value = state.mcVersion;
      state.mcVersion = mcSel.value;
    } catch (e) {
      mcSel.innerHTML = '';
      mcSel.appendChild(h('option', { value: '' }, t('Impossibile caricare: {msg}', { msg: e.message })));
    }
    updateJava();
    await loadLoaders();
  };

  const updateJava = async () => {
    javaHint.textContent = '';
    if (!state.mcVersion) return;
    const j = await api('versions:java', state.mcVersion).catch(() => null);
    if (j) javaHint.textContent = t('Richiede Java {v}, verrà scaricato automaticamente se manca.', { v: j });
  };

  const emit = () => onChange && onChange(Object.assign({}, state));
  mcSel.addEventListener('change', () => { state.mcVersion = mcSel.value; state.loaderVersion = ''; updateJava(); loadLoaders(); });
  loaderSel.addEventListener('change', () => { state.loaderVersion = loaderSel.value; emit(); });
  snap.addEventListener('change', loadMc);

  if (allowTypeChange) { root.appendChild(h('h3', t('Tipo di server'))); root.appendChild(typeGrid); drawTypes(); }
  root.appendChild(h('.grid-2',
    h('.field', h('label', t('Versione di Minecraft')), mcSel, javaHint, h('label.check.small', snap, h('span', t('Mostra snapshot e pre-release')))),
    loaderField));
  root.getState = () => Object.assign({}, state);
  loadMc();
  return root;
}

function openWizard(initialMode = 'new') {
  let mode = initialMode;
  const m = modal({ title: t('Crea un server'), body: h('div'), wide: true, foot: [] });
  const draw = () => {
    m.body.innerHTML = '';
    m.foot.innerHTML = '';
    const sources = [
      ['new', 'plus', t('Nuovo server'), t('Vanilla, Fabric, Forge, NeoForge, Paper…')],
      ['pack', 'package', t('Da un modpack'), t('Modrinth, CurseForge o file .mrpack/.zip')],
      ['profile', 'play', t('Dal tuo launcher'), t('Le mod che usi già per giocare')],
      ['import', 'folder', t('Importa cartella'), t('Un server che hai già sul PC')],
    ];
    m.body.appendChild(h('.source-grid', sources.map(([id, ic, title, desc]) =>
      h('.source-card' + (mode === id ? '.sel' : ''), { onclick: () => { mode = id; draw(); } }, icon(ic), h('.tn', title), h('.td', desc)))));
    if (mode === 'new') drawNew(m);
    else if (mode === 'pack') drawPack(m);
    else if (mode === 'profile') drawProfile(m);
    else drawImport(m);
  };
  draw();
}

function difficultyOptions(selected = 'normal') {
  return [['peaceful', t('Pacifica')], ['easy', t('Facile')], ['normal', t('Normale')], ['hard', t('Difficile')]].map(([v, l]) => h('option', { value: v, selected: v === selected }, l));
}

function drawNew(m) {
  const name = h('input.input', { value: t('Il mio server'), maxlength: 40 });
  const picker = versionPicker({ type: 'fabric' });
  const ram = ramField(App.info.config.defaultRamMb);
  const difficulty = h('select.input', difficultyOptions());
  const gamemode = h('select.input', [['survival', t('Sopravvivenza')], ['creative', t('Creativa')], ['adventure', t('Avventura')]].map(([v, l]) => h('option', { value: v }, l)));
  let worldSource = null;
  const worldLabel = h('span.muted', t('Verrà generato un mondo nuovo'));
  const worldBtn = btn(t('Usa un mondo esistente…'), { cls: 'sm', icon: 'map', onclick: () => openWorldPicker((src, label) => { worldSource = src; worldLabel.textContent = label; worldLabel.classList.remove('muted'); }) });
  const eula = eulaCheck();

  m.body.appendChild(picker);
  m.body.appendChild(h('.spacer'));
  m.body.appendChild(h('.grid-2', h('.field', h('label', t('Nome del server')), name), ram));
  m.body.appendChild(h('.spacer'));
  m.body.appendChild(h('.grid-2', h('.field', h('label', t('Difficoltà')), difficulty), h('.field', h('label', t('Modalità di gioco')), gamemode)));
  m.body.appendChild(h('.spacer'));
  m.body.appendChild(h('.field', h('label', t('Mondo')), h('.row', worldBtn, worldLabel)));
  m.body.appendChild(h('.spacer'));
  m.body.appendChild(eula);

  const create = btn(t('Crea server'), { cls: 'primary', icon: 'check', onclick: async () => {
    const s = picker.getState();
    if (!s.mcVersion) return toast(t('Scegli una versione di Minecraft'), 'warn');
    if (!eula.isChecked()) return toast(t('Devi accettare la EULA di Minecraft'), 'warn');
    create.disabled = true;
    m.close();
    const created = await run(() => api('servers:create', {
      name: name.value.trim() || t('Server'), type: s.type, mcVersion: s.mcVersion, loaderVersion: s.loaderVersion || null,
      ramMb: ram.getValue(), difficulty: difficulty.value, gamemode: gamemode.value, worldSource, eula: true,
    }));
    if (created) { await refreshServers(); selectServer(created.id, 'overview'); toast(t('{name} è pronto!', { name: created.name }), 'ok'); }
  } });
  m.foot.append(btn(t('Annulla'), { onclick: m.close }), create);
}

function drawPack(m) {
  const hasCf = !!App.info.curseforge;
  let source = 'modrinth';
  let selected = null; // { source, id, title, versionId|fileId }
  const query = h('input.input', { placeholder: t('Cerca modpack (es. Cobblemon, Create, Better MC…)') });
  const results = h('div', { style: { maxHeight: '340px', overflowY: 'auto' } });
  const detail = h('div');
  const sw = h('.source-switch',
    h('button.mr.on', { onclick: (e) => setSource('modrinth', e.currentTarget) }, 'Modrinth'),
    h('button.cf', { onclick: (e) => setSource('curseforge', e.currentTarget) }, 'CurseForge', hasCf ? null : h('span.tag', { style: { marginLeft: '6px' } }, t('presto'))),
    h('button', { onclick: (e) => setSource('file', e.currentTarget) }, t('File')));
  const setSource = (s, el) => {
    source = s;
    sw.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
    selected = null; detail.innerHTML = '';
    search();
  };

  const search = debounce(async () => {
    results.innerHTML = '';
    if (source === 'file') {
      results.appendChild(h('.empty', icon('upload'), h('.t', t('Importa un modpack da file')), h('div', hasCf ? t('Supporta .mrpack (Modrinth) e .zip (CurseForge, esportato dal launcher).') : t('Supporta i file .mrpack di Modrinth. Gli zip CurseForge arriveranno presto.')), h('.spacer'),
        btn(t('Scegli file…'), { cls: 'blue', icon: 'folder', onclick: async () => {
          const f = await run(() => api('dialog:openFile', t('Scegli modpack'), [{ name: t('Modpack'), extensions: hasCf ? ['mrpack', 'zip'] : ['mrpack'] }]));
          if (!f) return;
          const info = await run(() => api('pack:read', f));
          if (!info) return;
          selected = { source: 'file', file: f, title: info.name };
          showDetailFile(info);
        } })));
      return;
    }
    if (source === 'curseforge' && !hasCf) {
      results.appendChild(h('.info-note', icon('clock'), h('div', h('strong', t('CurseForge in arrivo.')), ' ', t('CurseForge arriverà con un prossimo aggiornamento di CraftDock. Per ora usa Modrinth: ha quasi tutte le mod e i modpack più popolari. Puoi già importare i file .mrpack con "File".'))));
      return;
    }
    results.appendChild(h('.muted', t('Cerco…')));
    try {
      const r = source === 'modrinth' ? await api('mr:searchPacks', { query: query.value }) : await api('cf:searchPacks', { query: query.value });
      results.innerHTML = '';
      if (!r.hits.length) results.appendChild(h('.empty', t('Nessun risultato')));
      for (const p of r.hits) {
        results.appendChild(h('.result', h('img', { src: p.icon || 'assets/icon.png' }),
          h('.grow', h('.rt', p.title, h('small', t('di {author}', { author: p.author || '?' }))), h('.rd', p.description), h('.row.small.muted', icon('download'), fmtNum(p.downloads))),
          h('.ra', btn(t('Scegli'), { cls: 'sm blue', onclick: () => pickPack(p) }))));
      }
    } catch (e) { results.innerHTML = ''; results.appendChild(h('.locked-note', icon('alert'), e.message)); }
  }, 350);
  query.addEventListener('input', search);

  const name = h('input.input', { placeholder: t('Nome del server') });
  const ram = ramField(Math.max(6144, App.info.config.defaultRamMb));
  const eula = eulaCheck();
  const commonFields = () => h('div', h('.spacer'), h('.grid-2', h('.field', h('label', t('Nome del server')), name), ram), h('.spacer'), eula);

  const pickPack = async (p) => {
    detail.innerHTML = '';
    detail.appendChild(h('.muted', t('Carico le versioni…')));
    name.value = p.title;
    try {
      const verSel = h('select.input');
      if (p.source === 'modrinth') {
        const versions = await api('mr:versions', p.id);
        versions.forEach((v) => verSel.appendChild(h('option', { value: v.id }, `${v.version_number} · MC ${v.game_versions.join(', ')} · ${v.loaders.join('/')}`)));
      } else {
        const files = await api('cf:files', p.id);
        files.forEach((f) => verSel.appendChild(h('option', { value: f.id }, `${f.displayName} · ${f.gameVersions.join(', ')}`)));
      }
      selected = { source: p.source, id: p.id, title: p.title, verSel };
      detail.innerHTML = '';
      detail.appendChild(h('.card', { style: { marginTop: '12px' } },
        h('.row', h('img', { src: p.icon || 'assets/icon.png', style: { width: '40px', height: '40px', borderRadius: '8px' } }), h('div', h('strong', p.title), h('.small.muted', p.description))),
        h('.spacer'), h('.field', h('label', t('Versione del modpack')), verSel), commonFields()));
      detail.scrollIntoView({ behavior: 'smooth' });
    } catch (e) { detail.innerHTML = ''; detail.appendChild(h('.locked-note', icon('alert'), e.message)); }
  };

  const showDetailFile = (info) => {
    name.value = info.name;
    detail.innerHTML = '';
    detail.appendChild(h('.card', { style: { marginTop: '12px' } },
      h('strong', info.name), h('.small.muted', `${App.info.types[info.type].name} ${info.loaderVersion || ''} · Minecraft ${info.mcVersion} · ${tn(info.files.length, '{n} mod', '{n} mod')}`),
      info.format === 'curseforge' && !hasCf ? h('.locked-note', { style: { marginTop: '10px' } }, icon('alert'), t('I modpack CurseForge (.zip) non sono ancora supportati: il supporto arriverà con un prossimo aggiornamento. Cerca lo stesso modpack su Modrinth o usa un file .mrpack.')) : null,
      commonFields()));
  };

  m.body.append(h('.browse-head', sw, query), results, detail);
  const create = btn(t('Crea server dal modpack'), { cls: 'primary', icon: 'check', onclick: async () => {
    if (!selected) return toast(t('Scegli un modpack'), 'warn');
    if (!hasCf && selected.source !== 'modrinth' && !(selected.source === 'file' && /\.mrpack$/i.test(selected.file))) return toast(t('CurseForge non è ancora disponibile'), 'warn');
    if (!eula.isChecked()) return toast(t('Devi accettare la EULA di Minecraft'), 'warn');
    const opts = { name: name.value.trim() || selected.title, ramMb: ram.getValue(), eula: true, difficulty: 'normal' };
    m.close();
    let created;
    if (selected.source === 'file') created = await run(() => api('pack:createFromFile', selected.file, opts));
    else if (selected.source === 'modrinth') created = await run(() => api('pack:createFromModrinth', selected.verSel.value, opts));
    else created = await run(() => api('pack:createFromCurse', selected.id, Number(selected.verSel.value), opts));
    if (created) { await refreshServers(); selectServer(created.id, 'console'); toast(t('{name} installato!', { name: created.name }), 'ok'); }
  } });
  m.foot.append(btn(t('Annulla'), { onclick: m.close }), create);
  search();
}

function drawImport(m) {
  let dir = null;
  const info = h('div');
  const name = h('input.input');
  const copy = h('input', { type: 'checkbox', checked: true });
  let picker = null;
  let missingJar = false;
  m.body.appendChild(h('.info-note', icon('info'), h('div', t('Seleziona la cartella di un server già esistente (con il suo .jar, i mondi e le configurazioni). CraftDock riconosce automaticamente Vanilla, Fabric, Quilt, Forge, NeoForge, Paper e Purpur.'), ' ',
    t('Va bene anche una cartella scaricata da Aternos o da un altro hosting senza il .jar: CraftDock scarica il server che manca.'))));
  m.body.appendChild(btn(t('Scegli cartella del server…'), { cls: 'blue', icon: 'folder', onclick: async () => {
    dir = await run(() => api('dialog:openFolder', t('Cartella del server')));
    if (!dir) return;
    const d = await run(() => api('servers:detect', dir));
    if (!d) return;
    name.value = dir.split(/[\\/]/).pop();
    info.innerHTML = '';
    missingJar = !d.launch;
    picker = missingJar ? versionPicker({ type: d.type, mcVersion: d.mcVersion }) : null;
    info.appendChild(h('.card', { style: { marginTop: '14px' } },
      h('.row', h('span.tag.blue', App.info.types[d.type].name), d.mcVersion ? h('span.tag', 'Minecraft ' + d.mcVersion) : h('span.tag.yellow', t('versione non rilevata')),
        d.launch ? h('span.tag.green', t('avvio: {what}', { what: d.launch.jar || 'args file' })) : h('span.tag.red', t('jar non trovato'))),
      h('.spacer'),
      h('.field', h('label', t('Nome')), name),
      h('.spacer'),
      h('label.check', copy, h('span', t("Copia la cartella dentro CraftDock (consigliato: l'originale resta intatto)"))),
      missingJar ? h('div', h('.spacer'),
        h('.locked-note', icon('alert'), h('div',
          h('strong', t('Manca il file del server (.jar).')), ' ',
          t('Succede con i file scaricati da Aternos e da molti hosting: danno mondo, mod e impostazioni ma non il programma del server. Scegli tipo e versione (CraftDock li ha già indovinati dai tuoi file) e lo scarico io; il resto della cartella non viene toccato.'))),
        picker) : null));
  } }));
  m.body.appendChild(info);
  m.foot.append(btn(t('Annulla'), { onclick: m.close }), btn(t('Importa'), { cls: 'primary', icon: 'check', onclick: async () => {
    if (!dir) return toast(t('Scegli prima una cartella'), 'warn');
    const install = missingJar && picker ? picker.getState() : null;
    if (missingJar && (!install || !install.mcVersion)) return toast(t('Scegli una versione di Minecraft'), 'warn');
    m.close();
    const s = await run(() => api('servers:importFolder', { dir, name: name.value.trim(), copy: copy.checked, install }));
    if (s) { await refreshServers(); selectServer(s.id); toast(t('Server importato'), 'ok'); }
  } }));
}

/** Selettore di un mondo esistente: salvataggi dei launcher, zip o cartella. onPick(source, label) */
function openWorldPicker(onPick) {
  let chosen = null;
  const list = h('.pick-list', h('.empty', t('Cerco i mondi sul PC…')));
  const m = modal({
    title: t('Scegli un mondo'), wide: true,
    body: h('div',
      h('.row', { style: { marginBottom: '12px' } },
        btn(t('Da file .zip…'), { cls: 'sm', icon: 'archive', onclick: async () => {
          const f = await run(() => api('dialog:openFile', t('Mondo in zip'), [{ name: t('Zip'), extensions: ['zip'] }]));
          if (f) { m.close(); onPick(f, f.split(/[\\/]/).pop()); }
        } }),
        btn(t('Da cartella…'), { cls: 'sm', icon: 'folder', onclick: async () => {
          const d = await run(() => api('dialog:openFolder', t('Cartella del mondo')));
          if (d) { m.close(); onPick(d, d.split(/[\\/]/).pop()); }
        } }),
        h('span.muted.small', t('oppure scegli uno dei mondi trovati nei tuoi launcher:'))),
      list),
    foot: [btn(t('Annulla'), { onclick: () => m.close() }), btn(t('Usa questo mondo'), { cls: 'primary', onclick: () => { if (!chosen) return toast(t('Seleziona un mondo'), 'warn'); m.close(); onPick(chosen.path, chosen.levelName || chosen.folder); } })],
  });
  api('worlds:scanLocal').then((worlds) => {
    list.innerHTML = '';
    if (!worlds.length) { list.appendChild(h('.empty', h('.t', t('Nessun mondo trovato')), t('Non ho trovato salvataggi del Minecraft Launcher, CurseForge, Modrinth App o Prism. Usa zip o cartella.'))); return; }
    for (const w of worlds) {
      const item = h('.list-item', { onclick: () => { chosen = w; list.querySelectorAll('.list-item').forEach((x) => x.classList.toggle('sel', x === item)); } },
        h('.li-icon', w.icon ? h('img', { src: w.icon }) : icon('map')),
        h('.li-main', h('.li-title', w.levelName || w.folder, w.version ? h('span.tag', w.version) : null, w.hardcore ? h('span.tag.red', 'hardcore') : null),
          h('.li-sub', t('{launcher} · ultima partita {ago}', { launcher: w.launcher, ago: fmtAgo(w.lastPlayed) }))));
      list.appendChild(item);
    }
  }).catch(errToast);
}

/**
 * Server dal profilo di un launcher: trova i profili, divide le mod in "sul server" /
 * "da controllare" / "solo nel gioco" e crea il server con la stessa versione e lo stesso loader.
 */
function drawProfile(m) {
  const box = h('div');
  const foot = h('div', { style: { display: 'contents' } });
  m.body.appendChild(box);
  let analysis = null;
  let profilesList = [];
  const LAUNCHER_HINT = t('CraftDock cerca i profili di: launcher ufficiale di Minecraft, Modrinth App, Prism Launcher, CurseForge e ATLauncher.');

  const typeLabel = (p) => `${(App.info.types[p.type] || {}).name || p.type || '?'} ${p.mcVersion || '?'}`;

  const drawList = (res) => {
    box.innerHTML = '';
    profilesList = res.profiles;
    box.appendChild(h('p.small.muted', { style: { marginTop: 0 } }, t('Scegli il profilo che usi per giocare: CraftDock crea un server con la stessa versione, lo stesso loader e le mod che servono, e tiene da parte quelle solo da gioco per il pacchetto amici.')));
    if (res.lunar) box.appendChild(h('.info-note', icon('info'), h('div', h('strong', t('Lunar Client trovato.')), ' ', t('Le sue funzioni (HUD, zoom, FPS…) sono integrate e servono solo nel gioco, quindi non c\'è niente da portare sul server. Per i server con mod usa un profilo di Modrinth App, Prism o CurseForge.'))));
    if (!res.profiles.length) {
      box.appendChild(h('.empty', icon('play'), h('.t', t('Nessun profilo con mod trovato')), h('div', LAUNCHER_HINT), h('.spacer'),
        btn(t('Cerca di nuovo'), { cls: 'sm', icon: 'refresh', onclick: load })));
      return;
    }
    const list = h('.list', { style: { maxHeight: '360px', overflowY: 'auto' } });
    for (const p of res.profiles) {
      const bad = !p.type || !p.mcVersion;
      list.appendChild(h('.list-item' + (bad ? '.disabled' : ''), { style: { cursor: bad ? 'default' : 'pointer' }, onclick: bad ? null : () => analyze(p) },
        h('.li-icon', icon('play')),
        h('.li-main',
          h('.li-title', p.name, h('span.tag', p.launcher), bad ? h('span.tag.yellow', t('versione non riconosciuta')) : h('span.tag.green', typeLabel(p)), p.guess && !bad ? h('span.tag', { title: t('Versione dedotta dalle mod del profilo') }, t('dedotta')) : null),
          h('.li-sub', `${tn(p.modCount, '{n} mod', '{n} mod')} · ${p.gameDir}`)),
        bad ? null : btn(t('Scegli'), { cls: 'sm', icon: 'arrowRight', onclick: (e) => { e.stopPropagation(); analyze(p); } })));
    }
    box.appendChild(h('.card', { style: { padding: 0 } }, list));
    box.appendChild(h('.small.muted', { style: { marginTop: '10px' } }, LAUNCHER_HINT));
  };

  const load = async () => {
    box.innerHTML = '';
    m.foot.innerHTML = '';
    m.foot.append(btn(t('Annulla'), { onclick: m.close }));
    box.appendChild(h('.empty', icon('search'), h('.t', t('Cerco i profili dei tuoi launcher…'))));
    const res = await run(() => api('profiles:scan'));
    if (res) drawList(res);
  };

  const analyze = async (p) => {
    box.innerHTML = '';
    box.appendChild(h('.empty', icon('puzzle'), h('.t', t('Analizzo {n} mod…', { n: p.modCount })), h('div', t('Controllo su Modrinth dove serve ogni mod: sul server, nel gioco o in entrambi.'))));
    analysis = await run(() => api('profiles:analyze', p.id));
    if (!analysis) { drawList({ profiles: profilesList }); return; }
    drawAnalysis();
  };

  const drawAnalysis = () => {
    const a = analysis;
    const p = a.profile;
    box.innerHTML = '';
    const checks = new Map();
    const groups = [
      ['server', t('Sul server'), t('Aggiungono contenuti o servono anche al server.'), (x) => x.side === 'both' || x.side === 'server', true],
      ['check', t('Da controllare'), t('Non sono su Modrinth e il file non dice dove servono: di solito vanno messe. Se il server non parte, togli quelle grafiche o di interfaccia.'), (x) => x.side === 'check', true],
      ['client', t('Solo nel gioco'), t('Grafica, interfaccia, minimappe, shader loader: sul server non servono e alcune lo farebbero crashare. Finiscono nel pacchetto amici.'), (x) => x.side === 'client', false],
    ];
    const counter = h('span.muted');
    const updCount = () => { counter.textContent = t('{n} mod sul server', { n: [...checks.values()].filter((c) => c.checked).length }); };
    box.appendChild(h('.row', { style: { gap: '10px', marginBottom: '12px', flexWrap: 'wrap' } },
      btn(t('Altri profili'), { cls: 'sm ghost', icon: 'arrowRight', onclick: () => drawList({ profiles: profilesList }) }),
      h('strong', p.name), h('span.tag', p.launcher), h('span.tag.green', typeLabel(p)), p.loaderVersion ? h('span.tag', `loader ${p.loaderVersion}`) : null, h('span.grow'), counter));
    if (!a.online) box.appendChild(h('.locked-note', icon('alert'), t('Modrinth non è raggiungibile: la divisione si basa solo sui file delle mod, controlla bene l\'elenco.')));
    const lists = h('div', { style: { maxHeight: '330px', overflowY: 'auto', paddingRight: '4px' } });
    for (const [key, title, desc, filter, def] of groups) {
      const items = a.mods.filter(filter);
      if (!items.length) continue;
      const list = h('.list');
      for (const it of items) {
        const cb = h('input', { type: 'checkbox', checked: def });
        cb.addEventListener('change', updCount);
        checks.set(it.file, cb);
        list.appendChild(h('label.list-item', { style: { cursor: 'pointer' } },
          cb,
          h('.li-icon', it.icon ? h('img', { src: it.icon }) : icon('puzzle')),
          h('.li-main', h('.li-title', it.title || it.name, it.version ? h('span.small.muted', it.version) : null, it.side === 'server' ? h('span.tag.blue', t('solo server')) : null, it.reason === 'modrinth' ? h('span.tag.green', 'Modrinth') : null),
            h('.li-sub', it.file))));
      }
      lists.appendChild(h('div', { style: { marginBottom: '14px' } },
        h('.row', { style: { gap: '8px', alignItems: 'baseline' } }, h('h3', { style: { margin: '0 0 2px' } }, title), h('span.muted.small', String(items.length))),
        h('.small.muted', { style: { marginBottom: '8px' } }, desc),
        h('.card', { style: { padding: 0 } }, list)));
    }
    box.appendChild(lists);
    updCount();

    // shader, resource pack e mondo
    const extrasCb = h('input', { type: 'checkbox', checked: true });
    const rpOnModrinth = a.resourcepacks.filter((r) => r.modrinth);
    const rpSel = h('select.input', h('option', { value: '' }, t('Nessuno')), rpOnModrinth.map((r) => h('option', { value: r.name }, r.name)));
    const worldSel = h('select.input', h('option', { value: '' }, t('Mondo nuovo')), a.worlds.map((w) => h('option', { value: w.path }, w.name)));
    const extraBits = [];
    if (a.shaders.length || a.resourcepacks.length) {
      extraBits.push(h('label.check', extrasCb, h('span', t('Metti nel pacchetto amici anche {s} shader e {r} resource pack del profilo', { s: a.shaders.length, r: a.resourcepacks.length }))));
    }
    const name = h('input.input', { value: p.name.slice(0, 40), maxlength: 40 });
    const sug = a.mods.length > 150 ? 8192 : a.mods.length > 80 ? 6144 : a.mods.length > 25 ? 4096 : 3072;
    const ram = ramField(Math.max(App.info.config.defaultRamMb, sug));
    const eula = eulaCheck();
    box.appendChild(h('div', { style: { marginTop: '6px' } },
      h('.grid-2',
        h('.field', h('label', t('Mondo')), worldSel, h('.hint', a.worlds.length ? t('Puoi partire da un mondo in single player di questo profilo.') : t('Questo profilo non ha mondi in single player.'))),
        h('.field', h('label', t('Resource pack del server')), rpSel, h('.hint', rpOnModrinth.length ? t('Chi entra lo riceve in automatico (solo pack pubblicati su Modrinth).') : t('Nessun resource pack del profilo è su Modrinth: si possono passare col pacchetto amici.')))),
      extraBits.length ? h('div', { style: { marginTop: '10px' } }, extraBits) : null,
      h('.spacer'),
      h('.grid-2', h('.field', h('label', t('Nome del server')), name), ram),
      h('.spacer'),
      eula));

    m.foot.innerHTML = '';
    const create = btn(t('Crea server dal profilo'), { cls: 'primary', icon: 'check', onclick: async () => {
      if (!eula.isChecked()) return toast(t('Devi accettare la EULA di Minecraft'), 'warn');
      const include = [...checks.entries()].filter(([, c]) => c.checked).map(([f]) => f);
      m.close();
      const created = await run(() => api('profiles:createServer', {
        profileId: p.id, include, resourcePack: rpSel.value || null, extras: extrasCb.checked,
        name: name.value.trim() || p.name, ramMb: ram.getValue(), eula: true, worldSource: worldSel.value || null,
      }));
      if (created) {
        await refreshServers();
        selectServer(created.id, 'console');
        toast(t('{name} è pronto! Per gli amici: scheda Mod → "Pacchetto amici".', { name: created.name }), 'ok', 9000);
      }
    } });
    m.foot.append(btn(t('Annulla'), { onclick: m.close }), create);
  };

  load();
}
