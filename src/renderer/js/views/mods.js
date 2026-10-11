'use strict';
/* Mod e plugin: installati (attiva/disattiva, aggiornamenti) e catalogo Modrinth / CurseForge. */

function renderMods(body, s) {
  const t = App.info.types[s.type];
  if (!t.mods && !t.plugins) {
    body.appendChild(h('.card', h('.empty', icon('puzzle'), h('.t', 'Il server Vanilla non supporta mod'),
      h('div', 'Per aggiungere mod passa a Fabric (consigliato), NeoForge o Forge; per i plugin usa Paper. Mondi e impostazioni restano.'), h('.spacer'),
      h('.row', { style: { justifyContent: 'center' } },
        btn('Cambia loader', { cls: 'primary', icon: 'refresh', onclick: () => { App.tab = 'settings'; renderMain(); } }),
        btn('Gestisci datapack', { icon: 'map', onclick: () => { App.tab = 'worlds'; renderMain(); } })))));
    return;
  }
  const noun = t.plugins ? 'plugin' : 'mod';
  const mode = App.modsMode || 'installed';
  const sw = h('.source-switch',
    h('button' + (mode === 'installed' ? '.on' : ''), { onclick: () => { App.modsMode = 'installed'; renderMain(); } }, `Installate`),
    h('button' + (mode === 'browse' ? '.on' : ''), { onclick: () => { App.modsMode = 'browse'; renderMain(); } }, `Cerca e installa`));
  body.appendChild(h('.row', { style: { marginBottom: '14px' } }, sw, h('span.grow'),
    isUp(s) ? h('span.tag.yellow', `Le ${noun} nuove si attivano al riavvio`) : null));
  if (mode === 'installed') renderInstalledMods(body, s, noun);
  else renderModBrowser(body, s, noun);
}

function renderInstalledMods(body, s, noun) {
  let data = { mods: [] };
  let updates = [];
  let filter = '';
  const listBox = h('.list');
  const updBox = h('div');
  const filterInput = h('input.input', { placeholder: `Filtra ${noun}…`, style: { maxWidth: '240px' } });

  const countEl = h('span.muted');
  const draw = () => {
    listBox.innerHTML = '';
    countEl.textContent = data.mods.length ? `${data.mods.filter((m) => m.enabled).length} attive su ${data.mods.length}` : '';
    const items = data.mods.filter((m) => !filter || (m.name + ' ' + m.file).toLowerCase().includes(filter));
    if (!data.mods.length) {
      listBox.appendChild(h('.empty', icon('puzzle'), h('.t', `Nessuna ${noun} installata`), h('div', `Cerca nel catalogo oppure trascina qui i file .jar.`), h('.spacer'),
        btn('Cerca ' + noun, { cls: 'primary', icon: 'search', onclick: () => { App.modsMode = 'browse'; renderMain(); } })));
      return;
    }
    for (const m of items) {
      const src = m.source ? h('span.tag' + (m.source.source === 'modrinth' ? '.green' : '.yellow'), m.source.source === 'modrinth' ? 'Modrinth' : 'CurseForge') : null;
      const upd = updates.find((u) => u.file === m.file);
      listBox.appendChild(h('.list-item' + (m.enabled ? '' : '.disabled'),
        h('.li-icon', m.icon ? h('img', { src: m.icon }) : icon('puzzle')),
        h('.li-main',
          h('.li-title', m.name, m.version ? h('span.small.muted', m.version) : null, src, m.environment === 'client' ? h('span.tag.red', 'solo client') : null, upd ? h('span.tag.blue', '↑ ' + upd.newVersion) : null),
          h('.li-sub', m.description ? `${m.file} · ${m.description}` : `${m.file} · ${fmtBytes(m.size)}`)),
        upd ? btn('Aggiorna', { cls: 'sm blue', icon: 'download', onclick: async () => { if (await run(() => api('mods:applyUpdate', s.id, upd), `${m.name} aggiornata`)) { updates = updates.filter((u) => u !== upd); load(); } } }) : null,
        mcToggle(m.enabled, async () => { await run(() => api('mods:toggle', s.id, m.file)); load(); }),
        btn('', { cls: 'sm ghost icon', icon: 'trash', title: 'Elimina', onclick: async () => {
          if (await confirmBox(`Elimina ${m.name}`, `Il file ${m.file} verrà cancellato.`, { okLabel: 'Elimina', danger: true })) { await run(() => api('mods:remove', s.id, m.file)); load(); }
        } })));
    }
  };

  const drawUpdates = () => {
    updBox.innerHTML = '';
    if (!updates.length) return;
    updBox.appendChild(h('.info-note', icon('download'), h('div.grow', `${updates.length} aggiornamenti disponibili su Modrinth.`),
      btn('Aggiorna tutto', { cls: 'sm blue', onclick: async () => {
        for (const u of [...updates]) await run(() => api('mods:applyUpdate', s.id, u));
        updates = []; drawUpdates(); load(); toast('Aggiornamenti completati', 'ok');
      } })));
  };

  const load = async () => {
    const r = await run(() => api('mods:list', s.id));
    if (r) { data = r; draw(); }
  };

  filterInput.addEventListener('input', debounce(() => { filter = filterInput.value.toLowerCase(); draw(); }, 150));

  body.appendChild(h('.card',
    h('.card-head', h('h2', noun === 'plugin' ? 'Plugin installati' : 'Mod installate'), countEl, h('.act',
      filterInput,
      btn('Aggiungi .jar', { cls: 'sm', icon: 'upload', onclick: async () => {
        const files = await run(() => api('dialog:openFile', 'Aggiungi ' + noun, [{ name: 'Jar', extensions: ['jar'] }], true));
        if (files && files.length) { await run(() => api('mods:add', s.id, files), `${files.length} file aggiunti`); load(); }
      } }),
      btn('Aggiornamenti', { cls: 'sm', icon: 'refresh', onclick: async () => {
        const r = await run(() => api('mods:checkUpdates', s.id));
        if (!r) return;
        updates = r; drawUpdates(); draw();
        if (!r.length) toast('Tutto aggiornato (controllo su Modrinth)', 'ok');
      } }),
      noun === 'mod' ? btn('Disattiva solo-client', { cls: 'sm', title: 'Disattiva le mod che funzionano solo sul client (shader, minimappe…) e che fanno crashare il server', onclick: async () => {
        const r = await run(() => api('mods:disableClientOnly', s.id));
        if (r) { toast(r.length ? `Disattivate: ${r.join(', ')}` : 'Nessuna mod solo-client trovata', r.length ? 'ok' : 'info', 7000); load(); }
      } }) : null,
      btn('', { cls: 'sm icon', icon: 'folder', title: 'Apri cartella', onclick: () => run(() => api('servers:openFolder', s.id, noun === 'plugin' ? 'plugins' : 'mods')) }))),
    updBox, listBox));

  load();
  App.hooks.reloadMods = load;
}

function renderModBrowser(body, s, noun) {
  const hasCf = !!App.info.curseforge;
  let source = hasCf ? (App.modSource || 'modrinth') : 'modrinth';
  let offset = 0;
  let installedIds = new Set();
  const query = h('input.input', { placeholder: `Cerca ${noun} per ${App.info.types[s.type].name} ${s.mcVersion}…` });
  const sort = h('select.input', { style: { maxWidth: '180px' } });
  const anyVer = h('input', { type: 'checkbox' });
  const results = h('div');
  const more = h('div', { style: { textAlign: 'center', marginTop: '12px' } });
  const sortOptions = () => {
    sort.innerHTML = '';
    const opts = source === 'modrinth'
      ? [['relevance', 'Rilevanza'], ['downloads', 'Più scaricate'], ['follows', 'Più seguite'], ['updated', 'Aggiornate di recente'], ['newest', 'Più nuove']]
      : [['2', 'Popolarità'], ['6', 'Download totali'], ['3', 'Aggiornate di recente'], ['4', 'Nome'], ['1', 'In evidenza']];
    opts.forEach(([v, l]) => sort.appendChild(h('option', { value: v }, l)));
  };
  const sw = h('.source-switch',
    h('button.mr' + (source === 'modrinth' ? '.on' : ''), { onclick: () => setSource('modrinth') }, 'Modrinth'),
    h('button.cf' + (source === 'curseforge' ? '.on' : ''), { onclick: () => setSource('curseforge'), title: hasCf ? '' : 'In arrivo' }, 'CurseForge', hasCf ? null : h('span.tag', { style: { marginLeft: '6px' } }, 'presto')));
  const setSource = (src) => {
    source = src; App.modSource = src;
    sw.children[0].classList.toggle('on', src === 'modrinth');
    sw.children[1].classList.toggle('on', src === 'curseforge');
    sortOptions(); search(true);
  };

  const showVersions = async (p) => {
    const m = modal({ title: `Versioni di ${p.title}`, wide: true, body: h('.muted', 'Carico…') });
    try {
      let rows;
      if (p.source === 'modrinth') {
        const list = await api('mr:versions', p.id, anyVer.checked ? {} : { loaders: s.type === 'quilt' ? ['quilt', 'fabric'] : App.info.types[s.type].plugins ? ['paper', 'spigot', 'bukkit', 'purpur'] : [s.type], gameVersions: [s.mcVersion] });
        rows = list.map((v) => ({ id: v.id, name: v.version_number, sub: `${v.game_versions.slice(-4).join(', ')} · ${v.loaders.join('/')} · ${v.version_type}`, date: v.date_published }));
      } else {
        const list = await api('cf:files', p.id, anyVer.checked ? null : s.id);
        rows = list.map((f) => ({ id: f.id, name: f.displayName, sub: f.gameVersions.join(', '), date: f.fileDate }));
      }
      m.body.innerHTML = '';
      if (!rows.length) m.body.appendChild(h('.empty', 'Nessuna versione compatibile. Prova "Mostra tutte le versioni".'));
      const list = h('.list');
      rows.slice(0, 80).forEach((r) => list.appendChild(h('.list-item', h('.li-main', h('.li-title', r.name), h('.li-sub', `${r.sub} · ${fmtDate(Date.parse(r.date))}`)),
        btn('Installa', { cls: 'sm primary', onclick: async () => { m.close(); await install(p, r.id); } }))));
      m.body.appendChild(list);
    } catch (e) { m.body.innerHTML = ''; m.body.appendChild(h('.locked-note', icon('alert'), e.message)); }
  };

  const install = async (p, versionId) => {
    const r = p.source === 'modrinth'
      ? await run(() => api('mr:install', s.id, p.id, versionId))
      : await run(() => api('cf:install', s.id, p.id, versionId));
    if (!r) return;
    const files = r.filter((x) => !String(x).startsWith('⚠'));
    const warns = r.filter((x) => String(x).startsWith('⚠'));
    toast(files.length ? `Installato: ${files.join(', ')}` : `${p.title} è già installata`, 'ok', 6000);
    warns.forEach((w) => toast(w, 'warn', 8000));
    installedIds.add(String(p.id));
    search(true, true);
  };

  const search = debounce(async (reset = true, keepScroll = false) => {
    if (reset) offset = 0;
    if (source === 'curseforge' && !hasCf) {
      results.innerHTML = '';
      results.appendChild(h('.info-note', icon('clock'), h('div', h('strong', 'CurseForge in arrivo. '), 'Il catalogo arriverà con un prossimo aggiornamento di CraftDock. Per ora usa Modrinth: ha quasi tutte le mod e i modpack più popolari.')));
      more.innerHTML = '';
      return;
    }
    if (reset && !keepScroll) { results.innerHTML = ''; results.appendChild(h('.muted', 'Cerco…')); }
    try {
      const opts = { query: query.value, offset, sort: source === 'modrinth' ? sort.value : Number(sort.value), ignoreVersion: anyVer.checked };
      const r = source === 'modrinth' ? await api('mr:search', s.id, opts) : await api('cf:search', s.id, opts);
      if (reset) results.innerHTML = '';
      if (!r.hits.length && reset) results.appendChild(h('.empty', icon('search'), h('.t', 'Nessun risultato'), `Prova un'altra ricerca o spunta "Tutte le versioni".`));
      for (const p of r.hits) {
        const installed = installedIds.has(String(p.id));
        results.appendChild(h('.result',
          h('img', { src: p.icon || 'assets/icon.png', loading: 'lazy' }),
          h('.grow', { style: { minWidth: 0 } },
            h('.rt', h('a', { onclick: () => p.url && api('shell:openExternal', p.url) }, p.title), h('small', 'di ' + (p.author || '?'))),
            h('.rd', p.description),
            h('.row.small.muted', icon('download'), fmtNum(p.downloads),
              p.serverSide === 'required' ? h('span.tag.green', 'server richiesto') : null,
              p.clientSide === 'required' && p.serverSide !== 'unsupported' ? h('span.tag', 'serve anche sul client') : null,
              (p.categories || []).slice(0, 3).map((c) => h('span.tag', c)))),
          h('.ra',
            installed ? btn('Installata', { cls: 'sm', icon: 'check', disabled: true }) : btn('Installa', { cls: 'sm primary', icon: 'download', onclick: () => install(p) }),
            btn('Versioni', { cls: 'sm ghost', onclick: () => showVersions(p) }))));
      }
      offset += r.hits.length;
      more.innerHTML = '';
      if (offset < r.total && r.hits.length) more.appendChild(btn('Carica altri', { cls: 'sm', onclick: () => search(false) }));
    } catch (e) {
      results.innerHTML = '';
      results.appendChild(h('.locked-note', icon('alert'), e.message));
    }
  }, 300);

  query.addEventListener('input', () => search(true));
  sort.addEventListener('change', () => search(true));
  anyVer.addEventListener('change', () => search(true));
  sortOptions();
  body.appendChild(h('.info-note', icon('info'), h('div', noun === 'mod'
    ? 'Le mod con "serve anche sul client" vanno installate anche dai giocatori. Le dipendenze obbligatorie vengono installate in automatico.'
    : 'I plugin funzionano solo sul server: i giocatori non devono installare nulla.')));
  body.appendChild(h('.browse-head', sw, query, sort, h('label.check.small', { style: { whiteSpace: 'nowrap' } }, anyVer, h('span', 'Tutte le versioni'))));
  body.appendChild(results);
  body.appendChild(more);
  api('mods:list', s.id).then((d) => {
    installedIds = new Set(d.mods.filter((m) => m.source).map((m) => String(m.source.projectId)));
    search(true);
  }).catch(() => search(true));
}
