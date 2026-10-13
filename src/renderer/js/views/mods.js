'use strict';
/* Mod e plugin: installati (attiva/disattiva, aggiornamenti) e catalogo Modrinth / CurseForge. */

function renderMods(body, s) {
  const ty = App.info.types[s.type];
  if (!ty.mods && !ty.plugins) {
    body.appendChild(h('.card', h('.empty', icon('puzzle'), h('.t', t('Il server Vanilla non supporta mod')),
      h('div', t('Per aggiungere mod passa a Fabric (consigliato), NeoForge o Forge; per i plugin usa Paper. Mondi e impostazioni restano.')), h('.spacer'),
      h('.row', { style: { justifyContent: 'center' } },
        btn(t('Cambia loader'), { cls: 'primary', icon: 'refresh', onclick: () => { App.tab = 'settings'; renderMain(); } }),
        btn(t('Gestisci datapack'), { icon: 'map', onclick: () => { App.tab = 'worlds'; renderMain(); } })))));
    return;
  }
  const noun = ty.plugins ? 'plugin' : 'mod';
  const mode = App.modsMode || 'installed';
  const sw = h('.source-switch',
    h('button' + (mode === 'installed' ? '.on' : ''), { onclick: () => { App.modsMode = 'installed'; renderMain(); } }, t('Installate')),
    h('button' + (mode === 'browse' ? '.on' : ''), { onclick: () => { App.modsMode = 'browse'; renderMain(); } }, t('Cerca e installa')));
  body.appendChild(h('.row', { style: { marginBottom: '14px' } }, sw, h('span.grow'),
    isUp(s) ? h('span.tag.yellow', t('Le {noun} nuove si attivano al riavvio', { noun: t(noun) })) : null));
  if (mode === 'installed') renderInstalledMods(body, s, noun);
  else renderModBrowser(body, s, noun);
}

function renderInstalledMods(body, s, noun) {
  let data = { mods: [] };
  let updates = [];
  let filter = '';
  const listBox = h('.list');
  const updBox = h('div');
  const filterInput = h('input.input', { placeholder: t('Filtra {noun}…', { noun: t(noun) }), style: { maxWidth: '240px' } });

  const countEl = h('span.muted');
  const draw = () => {
    listBox.innerHTML = '';
    countEl.textContent = data.mods.length ? t('{a} attive su {n}', { a: data.mods.filter((m) => m.enabled).length, n: data.mods.length }) : '';
    const items = data.mods.filter((m) => !filter || (m.name + ' ' + m.file).toLowerCase().includes(filter));
    if (!data.mods.length) {
      listBox.appendChild(h('.empty', icon('puzzle'), h('.t', t('Nessuna {noun} installata', { noun: t(noun) })), h('div', t('Cerca nel catalogo oppure trascina qui i file .jar.')), h('.spacer'),
        btn(t('Cerca {noun}', { noun: t(noun) }), { cls: 'primary', icon: 'search', onclick: () => { App.modsMode = 'browse'; renderMain(); } })));
      return;
    }
    for (const m of items) {
      const src = m.source ? h('span.tag' + (m.source.source === 'modrinth' ? '.green' : '.yellow'), m.source.source === 'modrinth' ? 'Modrinth' : 'CurseForge') : null;
      const upd = updates.find((u) => u.file === m.file);
      listBox.appendChild(h('.list-item' + (m.enabled ? '' : '.disabled'),
        h('.li-icon', m.icon ? h('img', { src: m.icon }) : icon('puzzle')),
        h('.li-main',
          h('.li-title', m.name, m.version ? h('span.small.muted', m.version) : null, src, m.environment === 'client' ? h('span.tag.red', t('solo client')) : null, upd ? h('span.tag.blue', '↑ ' + upd.newVersion) : null),
          h('.li-sub', m.description ? `${m.file} · ${m.description}` : `${m.file} · ${fmtBytes(m.size)}`)),
        upd ? btn(t('Aggiorna'), { cls: 'sm blue', icon: 'download', onclick: async () => { if (await run(() => api('mods:applyUpdate', s.id, upd), t('{name} aggiornata', { name: m.name }))) { updates = updates.filter((u) => u !== upd); load(); } } }) : null,
        mcToggle(m.enabled, async () => { await run(() => api('mods:toggle', s.id, m.file)); load(); }),
        btn('', { cls: 'sm ghost icon', icon: 'trash', title: t('Elimina'), onclick: async () => {
          if (await confirmBox(t('Elimina {name}', { name: m.name }), t('Il file {file} verrà cancellato.', { file: m.file }), { okLabel: t('Elimina'), danger: true })) { await run(() => api('mods:remove', s.id, m.file)); load(); }
        } })));
    }
  };

  const drawUpdates = () => {
    updBox.innerHTML = '';
    if (!updates.length) return;
    updBox.appendChild(h('.info-note', icon('download'), h('div.grow', tn(updates.length, '{n} aggiornamento disponibile su Modrinth.', '{n} aggiornamenti disponibili su Modrinth.')),
      btn(t('Aggiorna tutto'), { cls: 'sm blue', onclick: async () => {
        for (const u of [...updates]) await run(() => api('mods:applyUpdate', s.id, u));
        updates = []; drawUpdates(); load(); toast(t('Aggiornamenti completati'), 'ok');
      } })));
  };

  const load = async () => {
    const r = await run(() => api('mods:list', s.id));
    if (r) { data = r; draw(); }
  };

  filterInput.addEventListener('input', debounce(() => { filter = filterInput.value.toLowerCase(); draw(); }, 150));

  body.appendChild(h('.card',
    h('.card-head', h('h2', noun === 'plugin' ? t('Plugin installati') : t('Mod installate')), countEl, h('.act',
      filterInput,
      btn(t('Aggiungi .jar'), { cls: 'sm', icon: 'upload', onclick: async () => {
        const files = await run(() => api('dialog:openFile', t('Aggiungi {noun}', { noun: t(noun) }), [{ name: 'Jar', extensions: ['jar'] }], true));
        if (files && files.length) { await run(() => api('mods:add', s.id, files), tn(files.length, '{n} file aggiunto', '{n} file aggiunti')); load(); }
      } }),
      btn(t('Aggiornamenti'), { cls: 'sm', icon: 'refresh', onclick: async () => {
        const r = await run(() => api('mods:checkUpdates', s.id));
        if (!r) return;
        updates = r; drawUpdates(); draw();
        if (!r.length) toast(t('Tutto aggiornato (controllo su Modrinth)'), 'ok');
      } }),
      noun === 'mod' ? btn(t('Disattiva solo-client'), { cls: 'sm', title: t('Disattiva le mod che funzionano solo sul client (shader, minimappe…) e che fanno crashare il server'), onclick: async () => {
        const r = await run(() => api('mods:disableClientOnly', s.id));
        if (r) { toast(r.length ? t('Disattivate: {list}', { list: r.join(', ') }) : t('Nessuna mod solo-client trovata'), r.length ? 'ok' : 'info', 7000); load(); }
      } }) : null,
      noun === 'mod' ? btn(t('Pacchetto amici'), { cls: 'sm', icon: 'share', title: t('Crea il file con le mod che servono a chi entra nel server'), onclick: () => friendsPackModal(s) }) : null,
      btn('', { cls: 'sm icon', icon: 'folder', title: t('Apri cartella'), onclick: () => run(() => api('servers:openFolder', s.id, noun === 'plugin' ? 'plugins' : 'mods')) }))),
    updBox, listBox));

  load();
  App.hooks.reloadMods = load;
}

function renderModBrowser(body, s, noun) {
  const hasCf = !!App.info.curseforge;
  let source = hasCf ? (App.modSource || 'modrinth') : 'modrinth';
  let offset = 0;
  let installedIds = new Set();
  const query = h('input.input', { placeholder: t('Cerca {noun} per {type} {mc}…', { noun: t(noun), type: App.info.types[s.type].name, mc: s.mcVersion }) });
  const sort = h('select.input', { style: { maxWidth: '180px' } });
  const anyVer = h('input', { type: 'checkbox' });
  const results = h('div');
  const more = h('div', { style: { textAlign: 'center', marginTop: '12px' } });
  const sortOptions = () => {
    sort.innerHTML = '';
    const opts = source === 'modrinth'
      ? [['relevance', t('Rilevanza')], ['downloads', t('Più scaricate')], ['follows', t('Più seguite')], ['updated', t('Aggiornate di recente')], ['newest', t('Più nuove')]]
      : [['2', t('Popolarità')], ['6', t('Download totali')], ['3', t('Aggiornate di recente')], ['4', t('Nome')], ['1', t('In evidenza')]];
    opts.forEach(([v, l]) => sort.appendChild(h('option', { value: v }, l)));
  };
  const sw = h('.source-switch',
    h('button.mr' + (source === 'modrinth' ? '.on' : ''), { onclick: () => setSource('modrinth') }, 'Modrinth'),
    h('button.cf' + (source === 'curseforge' ? '.on' : ''), { onclick: () => setSource('curseforge'), title: hasCf ? '' : t('In arrivo') }, 'CurseForge', hasCf ? null : h('span.tag', { style: { marginLeft: '6px' } }, 'presto')));
  const setSource = (src) => {
    source = src; App.modSource = src;
    sw.children[0].classList.toggle('on', src === 'modrinth');
    sw.children[1].classList.toggle('on', src === 'curseforge');
    sortOptions(); search(true);
  };

  const showVersions = async (p) => {
    const m = modal({ title: t('Versioni di {name}', { name: p.title }), wide: true, body: h('.muted', t('Carico…')) });
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
      if (!rows.length) m.body.appendChild(h('.empty', t('Nessuna versione compatibile. Prova "Mostra tutte le versioni".')));
      const list = h('.list');
      rows.slice(0, 80).forEach((r) => list.appendChild(h('.list-item', h('.li-main', h('.li-title', r.name), h('.li-sub', `${r.sub} · ${fmtDate(Date.parse(r.date))}`)),
        btn(t('Installa'), { cls: 'sm primary', onclick: async () => { m.close(); await install(p, r.id); } }))));
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
    toast(files.length ? t('Installato: {list}', { list: files.join(', ') }) : t('{name} è già installata', { name: p.title }), 'ok', 6000);
    warns.forEach((w) => toast(w, 'warn', 8000));
    installedIds.add(String(p.id));
    search(true, true);
  };

  const search = debounce(async (reset = true, keepScroll = false) => {
    if (reset) offset = 0;
    if (source === 'curseforge' && !hasCf) {
      results.innerHTML = '';
      results.appendChild(h('.info-note', icon('clock'), h('div', h('strong', t('CurseForge in arrivo. ')), t('Il catalogo arriverà con un prossimo aggiornamento di CraftDock. Per ora usa Modrinth: ha quasi tutte le mod e i modpack più popolari.'))));
      more.innerHTML = '';
      return;
    }
    if (reset && !keepScroll) { results.innerHTML = ''; results.appendChild(h('.muted', t('Cerco…'))); }
    try {
      const opts = { query: query.value, offset, sort: source === 'modrinth' ? sort.value : Number(sort.value), ignoreVersion: anyVer.checked };
      const r = source === 'modrinth' ? await api('mr:search', s.id, opts) : await api('cf:search', s.id, opts);
      if (reset) results.innerHTML = '';
      if (!r.hits.length && reset) results.appendChild(h('.empty', icon('search'), h('.t', t('Nessun risultato')), t('Prova un\'altra ricerca o spunta "Tutte le versioni".')));
      for (const p of r.hits) {
        const installed = installedIds.has(String(p.id));
        results.appendChild(h('.result',
          h('img', { src: p.icon || 'assets/icon.png', loading: 'lazy' }),
          h('.grow', { style: { minWidth: 0 } },
            h('.rt', h('a', { onclick: () => p.url && api('shell:openExternal', p.url) }, p.title), h('small', t('di {author}', { author: p.author || '?' }))),
            h('.rd', p.description),
            h('.row.small.muted', icon('download'), fmtNum(p.downloads),
              p.serverSide === 'required' ? h('span.tag.green', t('server richiesto')) : null,
              p.clientSide === 'required' && p.serverSide !== 'unsupported' ? h('span.tag', t('serve anche sul client')) : null,
              (p.categories || []).slice(0, 3).map((c) => h('span.tag', c)))),
          h('.ra',
            installed ? btn(t('Installata'), { cls: 'sm', icon: 'check', disabled: true }) : btn(t('Installa'), { cls: 'sm primary', icon: 'download', onclick: () => install(p) }),
            btn(t('Versioni'), { cls: 'sm ghost', onclick: () => showVersions(p) }))));
      }
      offset += r.hits.length;
      more.innerHTML = '';
      if (offset < r.total && r.hits.length) more.appendChild(btn(t('Carica altri'), { cls: 'sm', onclick: () => search(false) }));
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
    ? t('Le mod con "serve anche sul client" vanno installate anche dai giocatori. Le dipendenze obbligatorie vengono installate in automatico.')
    : t('I plugin funzionano solo sul server: i giocatori non devono installare nulla.'))));
  body.appendChild(h('.browse-head', sw, query, sort, h('label.check.small', { style: { whiteSpace: 'nowrap' } }, anyVer, h('span', t('Tutte le versioni')))));
  body.appendChild(results);
  body.appendChild(more);
  api('mods:list', s.id).then((d) => {
    installedIds = new Set(d.mods.filter((m) => m.source).map((m) => String(m.source.projectId)));
    search(true);
  }).catch(() => search(true));
}

/**
 * Pacchetto per gli amici: chi entra in un server con mod deve avere le stesse mod nel gioco.
 * .mrpack si importa in Modrinth App / Prism e crea il profilo giusto; .zip contiene solo i .jar.
 */
async function friendsPackModal(s) {
  const info = await run(() => api('mods:friendsInfo', s.id));
  if (!info) return;
  if (!info.count) { toast(t('Questo server non ha mod da passare agli amici: basta Minecraft {mcVersion}.', { mcVersion: s.mcVersion }), 'info', 6000); return; }
  let format = 'mrpack';
  const choice = (value, title, desc, tag) => {
    const el = h('.type-card' + (value === format ? '.sel' : ''), { onclick: () => {
      format = value;
      el.parentNode.querySelectorAll('.type-card').forEach((c) => c.classList.toggle('sel', c === el));
    } }, h('.tn', { style: { flexWrap: 'wrap' } }, icon(value === 'zip' ? 'archive' : 'package'), title, tag ? h('span.tag.green', tag) : null), h('.td', desc));
    return el;
  };
  const names = info.mods.slice(0, 12).join(', ') + (info.mods.length > 12 ? ' ' + t('e altre {n}', { n: info.mods.length - 12 }) : '');
  const m = modal({
    title: t('Pacchetto per gli amici'),
    body: h('div',
      h('p.muted', { style: { marginTop: 0 } }, t('Per entrare in un server con mod, gli amici devono avere nel gioco le stesse mod, nelle stesse versioni. Altrimenti Minecraft li butta fuori con errori come "mismatched mod set".')),
      h('.type-grid', { style: { gridTemplateColumns: '1fr 1fr' } },
        choice('mrpack', t('Profilo pronto (.mrpack)'), t('Si importa in Modrinth App o Prism Launcher: crea il profilo con Minecraft {mcVersion}, il loader e tutte le mod.', { mcVersion: s.mcVersion }), t('consigliato')),
        choice('zip', t('Solo le mod (.zip)'), t('Per chi usa il launcher ufficiale con Fabric/Forge già installato: si estrae nella cartella .minecraft.'))),
      h('.info-note', { style: { marginTop: '12px' } }, icon('info'), h('div',
        h('div', tn(info.count, 'Incluso {n} file: ', 'Inclusi {n} file: ') + names),
        info.skipped.length ? h('.small.muted', t('Escluse perché servono solo al server: {list}', { list: info.skipped.join(', ') })) : null)),
      h('p.small.muted', t('Lunar Client e Badlion non permettono di aggiungere mod: con loro si entra solo nei server senza mod da installare.'))),
    foot: [btn(t('Annulla'), { onclick: () => m.close() }), btn(t('Crea pacchetto'), { cls: 'primary', icon: 'package', onclick: async () => {
      m.close();
      const r = await run(() => api('mods:exportFriendsPack', s.id, format));
      if (!r) return;
      toast(format === 'zip' || !r.linked ? t('Pacchetto creato: {n} mod', { n: r.count }) : t('Pacchetto creato: {n} mod ({linked} scaricate da Modrinth all\'importazione)', { n: r.count, linked: r.linked }), 'ok', 7000);
      if (r.loaderMissing) toast(t('Non conosco la versione del loader di questo server: in Modrinth App controlla che il profilo usi la stessa del server.'), 'info', 9000);
    } })],
  });
}
