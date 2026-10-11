'use strict';
/* Avvio dell'interfaccia, eventi dal processo principale, trascinamento file. */

async function refreshServers() {
  App.servers = await api('servers:list');
  renderSidebar();
  return App.servers;
}

function patchServerState(id, patch) {
  const s = App.servers.find((x) => x.id === id);
  if (!s) return null;
  s.state = Object.assign({}, s.state || {}, patch);
  return s;
}

function quickPackModal(file) {
  api('pack:read', file).then((info) => {
    const name = h('input.input', { value: info.name });
    const ram = ramField(Math.max(6144, App.info.config.defaultRamMb));
    const eula = eulaCheck();
    const m = modal({
      title: 'Nuovo server dal modpack',
      body: h('.col', h('div', h('strong', info.name), h('.small.muted', `${App.info.types[info.type].name} ${info.loaderVersion || ''} · Minecraft ${info.mcVersion} · ${info.files.length} mod`)),
        h('.field', h('label', 'Nome del server'), name), ram, eula),
      foot: [btn('Annulla', { onclick: () => m.close() }), btn('Crea server', { cls: 'primary', onclick: async () => {
        if (!eula.isChecked()) return toast('Devi accettare la EULA', 'warn');
        m.close();
        const s = await run(() => api('pack:createFromFile', file, { name: name.value.trim() || info.name, ramMb: ram.getValue(), eula: true }));
        if (s) { await refreshServers(); selectServer(s.id, 'console'); }
      } })],
    });
  }).catch(errToast);
}

async function handleDrop(paths) {
  const s = currentServer();
  const jars = paths.filter((p) => /\.jar$/i.test(p));
  const mrpacks = paths.filter((p) => /\.mrpack$/i.test(p));
  const zips = paths.filter((p) => /\.zip$/i.test(p));
  if (mrpacks.length) return quickPackModal(mrpacks[0]);
  if (jars.length) {
    if (!s) return toast('Seleziona prima un server per aggiungere mod o plugin', 'warn');
    if (s.type === 'vanilla') return toast('Il server Vanilla non supporta mod: cambia loader nelle impostazioni', 'warn');
    await run(() => api('mods:add', s.id, jars), `${jars.length} file aggiunti`);
    if (App.tab === 'mods' && App.hooks.reloadMods) App.hooks.reloadMods();
    return;
  }
  if (zips.length) {
    const file = zips[0];
    const choice = await new Promise((resolve) => {
      const m = modal({
        title: 'Cosa contiene questo zip?',
        body: h('.col', h('.small.muted', file.split(/[\\/]/).pop()),
          s ? btn('Un mondo da importare in ' + s.name, { icon: 'map', onclick: () => { m.close(); resolve('world'); } }) : null,
          s ? btn('Un datapack per il mondo attivo', { icon: 'package', onclick: () => { m.close(); resolve('datapack'); } }) : null,
          App.info.curseforge ? btn('Un modpack CurseForge (nuovo server)', { icon: 'box', onclick: () => { m.close(); resolve('pack'); } }) : h('.small.muted', 'I modpack CurseForge in zip arriveranno con un prossimo aggiornamento.')),
        onClose: () => resolve(null),
      });
    });
    if (choice === 'pack') return quickPackModal(file);
    if (choice === 'world') {
      if (isUp(s)) return toast('Spegni il server prima di importare un mondo', 'warn');
      if (await run(() => api('worlds:import', s.id, file, { activate: true }), 'Mondo importato e attivato') && App.tab === 'worlds') renderMain();
    }
    if (choice === 'datapack') {
      const w = await api('worlds:list', s.id);
      await run(() => api('worlds:addDatapack', s.id, w.active, file), 'Datapack aggiunto');
      if (isUp(s)) run(() => api('servers:send', s.id, 'reload'));
    }
  }
}

function setupDragDrop() {
  let depth = 0;
  window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer.types || [])].includes('Files')) { depth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging'); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging');
    const paths = [...e.dataTransfer.files].map((f) => window.craftdock.pathFor(f)).filter(Boolean);
    if (paths.length) handleDrop(paths);
  });
}

function wireEvents() {
  window.craftdock.on('task', onTask);
  window.craftdock.on('servers:changed', async () => { await refreshServers(); if (App.view === 'server' && !currentServer()) go('home'); });
  window.craftdock.on('server:log', (id, entry) => {
    const arr = App.logs.get(id);
    if (arr) { arr.push(entry); if (arr.length > 3000) arr.splice(0, arr.length - 3000); }
    if (id === App.selectedId && App.view === 'server' && App.hooks.onLog) App.hooks.onLog(entry);
  });
  window.craftdock.on('server:status', (id, status) => {
    const s = patchServerState(id, { status, startedAt: status === 'starting' ? Date.now() : (App.servers.find((x) => x.id === id) || {}).state?.startedAt });
    renderSidebar();
    if (s && id === App.selectedId && App.view === 'server') {
      // ricostruisce la pagina mantenendo la scheda (abilita/disabilita i controlli)
      const scroll = document.querySelector('.page')?.scrollTop || 0;
      renderMain();
      const page = document.querySelector('.page');
      if (page) page.scrollTop = scroll;
    }
    if (status === 'running') toast(`${s ? s.name : 'Server'} è online!`, 'ok');
    if (status === 'crashed') toast(`${s ? s.name : 'Server'} si è arrestato in modo anomalo: controlla la console`, 'err', 8000);
    if (status === 'starting' || status === 'running' || status === 'stopped') api('servers:get', id).then((full) => { const i = App.servers.findIndex((x) => x.id === id); if (i > -1) App.servers[i] = full; }).catch(() => {});
  });
  window.craftdock.on('server:players', (id, list) => {
    patchServerState(id, { players: list });
    renderSidebar();
    if (id === App.selectedId && App.hooks.onPlayers) App.hooks.onPlayers(list);
  });
  window.craftdock.on('server:stats', (id, stats) => {
    const s = App.servers.find((x) => x.id === id);
    if (!s) return;
    const hist = (s.state && s.state.statsHistory) || [];
    hist.push({ t: Date.now(), cpu: stats.cpu, memMb: stats.memMb });
    if (hist.length > 90) hist.shift();
    patchServerState(id, { stats, statsHistory: hist });
    if (id === App.selectedId && App.hooks.onStats) App.hooks.onStats(stats);
  });
  window.craftdock.on('server:eula', (id) => {
    const s = App.servers.find((x) => x.id === id);
    toast(`${s ? s.name : 'Il server'} richiede di accettare la EULA: premi Avvia per confermare.`, 'warn', 7000);
  });
  window.craftdock.on('backups:changed', (id) => { if (id === App.selectedId && App.hooks.onBackups) App.hooks.onBackups(); });
  window.craftdock.on('tunnel:log', (l) => App.hooks.tunnelLog && App.hooks.tunnelLog(l));
  window.craftdock.on('tunnel:status', (st) => { App.tunnelStatus = st; renderSidebar(); if (App.hooks.tunnelStatus) App.hooks.tunnelStatus(st); });
  window.craftdock.on('tunnel:claim', (url) => { if (App.hooks.tunnelClaim) App.hooks.tunnelClaim(url); else toast('playit.gg: apri la pagina Connessione amici per collegare l\'account', 'info', 7000); });
  window.craftdock.on('tunnel:address', (a) => {
    if (!App.info.config.playit.publicAddress) App.info.config.playit.publicAddress = a;
    if (App.hooks.tunnelAddress) App.hooks.tunnelAddress(a);
  });
  window.craftdock.on('app:shutting-down', () => {
    document.getElementById('modal-root').innerHTML = '';
    modal({ title: 'Chiusura in corso', body: h('.col', h('div', 'Sto fermando i server e salvando i mondi…'), h('.bar.indet', h('div'))) });
  });
}

// aggiorna i contatori di uptime ogni secondo dove visibili
setInterval(() => {
  const s = currentServer();
  if (s && App.view === 'server' && App.tab === 'overview' && s.state && s.state.stats && App.hooks.onStats) App.hooks.onStats(s.state.stats);
}, 5000);

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'n') { e.preventDefault(); openWizard(); }
  if (e.ctrlKey && /^[1-9]$/.test(e.key) && App.view === 'server') { const t = TABS[Number(e.key) - 1]; if (t) { App.tab = t.id; renderMain(); } }
});

(async function boot() {
  try {
    App.info = await api('app:info');
    App.net = await api('net:info').catch(() => []);
    await refreshServers();
    const tinfo = await api('tunnel:info').catch(() => null);
    if (tinfo) App.tunnelStatus = tinfo.status;
    wireEvents();
    setupDragDrop();
    renderSidebar();
    if (App.servers.length === 1) selectServer(App.servers[0].id); else renderMain();
  } catch (e) {
    document.getElementById('main').appendChild(h('.page', h('h1.page-title', 'Errore di avvio'), h('pre.selectable', e.stack || e.message)));
  }
})();
