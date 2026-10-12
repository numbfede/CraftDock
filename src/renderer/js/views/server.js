'use strict';
/* Pagina server: intestazione, indirizzo, schede, panoramica, file di configurazione, impostazioni server. */

const TABS = [
  { id: 'overview', label: 'Panoramica', icon: 'home' },
  { id: 'console', label: 'Console', icon: 'terminal' },
  { id: 'options', label: 'Opzioni', icon: 'sliders' },
  { id: 'controls', label: 'Controlli rapidi', icon: 'zap' },
  { id: 'players', label: 'Giocatori', icon: 'users' },
  { id: 'mods', label: 'Mod', icon: 'puzzle' },
  { id: 'worlds', label: 'Mondi', icon: 'map' },
  { id: 'backups', label: 'Backup', icon: 'archive' },
  { id: 'files', label: 'File', icon: 'fileCode' },
  { id: 'settings', label: 'Impostazioni', icon: 'settings' },
];

App.hooks = {};

function renderMain() {
  const main = document.getElementById('main');
  main.innerHTML = '';
  App.hooks = {};
  if (App.view === 'server' && currentServer()) renderServerPage(main);
  else if (App.view === 'connection') renderConnection(main);
  else if (App.view === 'settings') renderAppSettings(main);
  else renderHome(main);
}

function renderHome(main) {
  const page = h('.page.home');
  const has = App.servers.length > 0;
  const features = [
    ['globe', 'Niente port forwarding', 'Tunnel playit.gg integrato. I tuoi amici entrano con un indirizzo pubblico, il router resta com\'è.', 'big'],
    ['puzzle', 'Mod in un clic', 'Cerca su Modrinth, installa con le dipendenze.'],
    ['box', 'Tutti i loader', 'Fabric, Quilt, Forge, NeoForge, Paper, Purpur, Vanilla.'],
    ['map', 'Importa mondi', 'Dal Minecraft Launcher, da Prism, CurseForge, Modrinth App o da uno zip.', 'wide'],
    ['archive', 'Backup locali', 'Manuali, automatici e allo spegnimento, con ripristino sicuro.', 'wide'],
    ['sliders', 'Pannello opzioni', 'Proprietà, game rule e comandi rapidi senza scrivere nulla.', 'wide'],
  ];
  const running = App.servers.filter(isUp).length;

  const intro = h('.home-intro',
    h('span.eyebrow', h('span.eyebrow-dot'), has ? (running ? `${running} ${running === 1 ? 'server acceso' : 'server accesi'}` : 'Tutto spento') : 'Hosting locale'),
    h('h1.home-title', has ? 'Bentornato.' : 'Il tuo server Minecraft,', has ? null : h('br'), has ? null : h('span.soft', 'sul tuo PC.')),
    h('p.home-lede', has ? 'Scegli un server dalla lista o creane uno nuovo. Mod, mondi e backup restano tutti in locale.' : 'Crea un server in pochi secondi, aggiungi le mod che vuoi e invita gli amici senza toccare il router.'),
    h('.home-actions',
      btn('Crea un server', { cls: 'primary lg', island: 'plus', onclick: () => openWizard('new') }),
      btn('Da modpack', { cls: 'lg', icon: 'package', onclick: () => openWizard('pack') }),
      btn('Importa cartella', { cls: 'lg ghost', icon: 'folder', onclick: () => openWizard('import') })));

  let aside;
  if (has) {
    aside = h('.home-aside', h('.aside-head', h('span', 'I tuoi server'), h('span.muted', String(App.servers.length))),
      h('.home-servers', App.servers.slice(0, 6).map((s) => {
        const st = serverStatus(s);
        const ic = h('.hs-icon', typeGlyph(s.type));
        loadServerIcon(s.id).then((d) => { if (d) { ic.innerHTML = ''; ic.appendChild(h('img', { src: d })); } });
        return h('button.home-server', { type: 'button', onclick: () => selectServer(s.id) },
          ic,
          h('.hs-main', h('.hs-name', s.name), h('.hs-sub', `${s.typeName} ${s.mcVersion || ''} · porta ${s.port}`)),
          h('span.status-pill.' + st, h('span.dot.' + st), STATUS_LABEL[st]),
          h('span.hs-go', icon('arrowRight')));
      })));
  } else {
    const steps = [
      ['Scegli il loader', 'Fabric, Forge, Paper e gli altri. Java arriva da solo.'],
      ['Aggiungi le mod', 'Dal catalogo Modrinth o trascinando i .jar.'],
      ['Condividi l\'indirizzo', 'Un clic crea il tunnel pubblico per gli amici.'],
    ];
    aside = h('.home-aside', h('.aside-head', h('span', 'Come funziona'), h('span.muted', '3 passi')),
      h('ol.home-steps', steps.map(([t, d], i) => h('li', h('span.step-n', String(i + 1).padStart(2, '0')), h('div', h('.st-t', t), h('.st-d', d))))));
  }

  page.appendChild(h('.home-split', intro, aside));
  page.appendChild(h('.bento', features.map(([ic, t, d, size], i) => h('.feature' + (size ? '.' + size : ''), { style: { '--i': i } },
    h('span.feature-ic', icon(ic)), h('.ft', t), h('.fd', d)))));
  main.appendChild(page);
}

function publicAddressFor(s) {
  return s.publicAddress || (App.info.config.playit && App.info.config.playit.publicAddress) || '';
}

function renderServerPage(main) {
  const s = currentServer();
  const page = h('.page');
  page.appendChild(renderHero(s));
  page.appendChild(renderAddressBar(s));
  const visibleTabs = TABS.map((t) => (t.id === 'mods' ? Object.assign({}, t, { label: App.info.types[s.type].plugins ? 'Plugin' : 'Mod' }) : t));
  page.appendChild(h('.tabs', visibleTabs.map((t) => h('.tab' + (App.tab === t.id ? '.active' : ''), { onclick: () => { App.tab = t.id; renderMain(); } }, icon(t.icon), t.label))));
  const body = h('#tab-body');
  page.appendChild(body);
  main.appendChild(page);
  const renderers = { overview: renderOverview, console: renderConsoleTab, options: renderOptions, controls: renderControls, players: renderPlayers, mods: renderMods, worlds: renderWorlds, backups: renderBackups, files: renderFiles, settings: renderServerSettings };
  (renderers[App.tab] || renderOverview)(body, s);
}

function renderHero(s) {
  const st = serverStatus(s);
  const iconBox = h('.hicon', { title: 'Cambia icona del server (64×64)', onclick: () => changeIcon(s) }, h('span.ph', icon('image')));
  loadServerIcon(s.id).then((d) => { if (d) { iconBox.innerHTML = ''; iconBox.appendChild(h('img', { src: d })); } });
  const motd = h('.hero-motd');
  api('props:get', s.id).then((p) => { App.props.set(s.id, p); motd.appendChild(mcText(p.motd || 'A Minecraft Server')); }).catch(() => {});
  const actions = h('.hero-actions');
  if (st === 'stopped' || st === 'crashed' || st === 'error') {
    actions.appendChild(btn('Avvia', { cls: 'primary start-big', island: 'play', disabled: st === 'error' && !s.launch, onclick: () => startServer(s) }));
  } else if (st === 'installing') {
    actions.appendChild(btn('Installazione…', { cls: 'start-big', disabled: true }));
  } else {
    actions.appendChild(btn('Riavvia', { icon: 'restart', disabled: st !== 'running', onclick: () => run(() => api('servers:restart', s.id)) }));
    actions.appendChild(btn(st === 'stopping' ? 'Arresto…' : 'Ferma', { cls: 'danger start-big', island: 'stop', disabled: st === 'stopping', onclick: () => run(() => api('servers:stop', s.id)) }));
    actions.appendChild(btn('', { cls: 'ghost icon', icon: 'skull', title: 'Chiusura forzata (può perdere dati non salvati)', onclick: async () => {
      if (await confirmBox('Chiusura forzata', 'Il server verrà terminato subito senza salvare. Usalo solo se non risponde.', { okLabel: 'Termina', danger: true })) run(() => api('servers:kill', s.id));
    } }));
  }
  return h('.server-hero.st-' + st, iconBox,
    h('.hero-text',
      h('.hero-name', s.name, h('span.status-pill.' + st, h('span.dot.' + st), STATUS_LABEL[st])),
      motd,
      h('.hero-tags', h('span.tag.blue', s.typeName), s.mcVersion ? h('span.tag', 'Minecraft ' + s.mcVersion) : null, s.loaderVersion ? h('span.tag', s.loaderVersion) : null,
        h('span.tag', `${(s.ramMb / 1024).toFixed(1).replace('.0', '')} GB RAM`), s.javaMajor ? h('span.tag', 'Java ' + s.javaMajor) : null)),
    actions);
}

function renderAddressBar(s) {
  const pub = publicAddressFor(s);
  const lan = (App.net || []).find((n) => n.kind === 'lan');
  const vpn = (App.net || []).find((n) => ['tailscale', 'zerotier', 'radmin', 'hamachi'].includes(n.kind));
  const chip = (lbl, addr, main) => h('.row', { style: { gap: '8px' } }, h('div', h('.lbl', lbl), h('.addr', { style: main ? {} : { fontSize: '13px', color: 'var(--text-2)' } }, addr)), btn('', { cls: 'ghost sm icon', icon: 'copy', title: 'Copia', onclick: () => copyText(addr) }));
  const port = Number(s.port) || 25565;
  const withPort = (ip) => (port === 25565 ? ip : `${ip}:${port}`);
  return h('.address-bar',
    pub ? chip('Indirizzo per gli amici', pub, true) : h('div', h('.lbl', 'Indirizzo per gli amici'),
      h('.row', { style: { gap: '8px', marginTop: '4px' } },
        btn('Crea indirizzo pubblico', { cls: 'sm blue', icon: 'globe', title: 'Collega playit.gg (se serve) e crea un tunnel per questo server, senza port forwarding', onclick: async () => {
          if (await run(() => api('tunnel:ensureForServer', s.id), 'Indirizzo pubblico pronto: copialo e mandalo agli amici')) { await refreshServers(); renderMain(); }
        } }),
        h('a.small', { onclick: () => go('connection') }, 'Altre opzioni'))),
    h('span.grow'),
    chip('Sul tuo PC', withPort('localhost')),
    lan ? chip('Rete di casa (LAN)', withPort(lan.ip)) : null,
    vpn ? chip(vpn.kind[0].toUpperCase() + vpn.kind.slice(1), withPort(vpn.ip)) : null);
}

async function changeIcon(s) {
  const f = await run(() => api('dialog:openFile', 'Icona del server', [{ name: 'Immagini', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }]));
  if (!f) return;
  if (await run(() => api('servers:setIcon', s.id, f), 'Icona aggiornata (visibile dopo il riavvio)')) {
    await loadServerIcon(s.id, true);
    renderSidebar(); renderMain();
  }
}

async function startServer(s) {
  try {
    await api('servers:start', s.id);
  } catch (e) {
    if (e.code === 'EULA') {
      const ok = await confirmBox('EULA di Minecraft', h('div', h('p', 'Per avviare il server devi accettare la EULA di Minecraft.'), h('a', { onclick: () => api('shell:openExternal', 'https://aka.ms/MinecraftEULA') }, 'Leggi la EULA')), { okLabel: 'Accetto' });
      if (ok) { await api('servers:acceptEula', s.id); return startServer(s); }
      return;
    }
    errToast(e);
  }
}

// ---------- Panoramica ----------
function renderOverview(body, s) {
  const st = s.state || {};
  const props = App.props.get(s.id) || {};
  const maxPlayers = props['max-players'] || '?';
  const statusV = h('.v', STATUS_LABEL[serverStatus(s)]);
  const uptime = h('.small.muted', st.startedAt && isUp(s) ? 'da ' + fmtDuration(Date.now() - st.startedAt) : '–');
  const playersV = h('.v', `${(st.players || []).length} / ${maxPlayers}`);
  const cpuV = h('.v', st.stats ? st.stats.cpu + '%' : '–');
  const ramV = h('.v', st.stats ? fmtBytes(st.stats.memMb * 1048576) : '–');
  const cpuC = h('canvas'); const ramC = h('canvas');
  body.appendChild(h('.stats-row',
    h('.stat', h('.k', 'Stato'), statusV, uptime),
    h('.stat', h('.k', 'Giocatori'), playersV, h('.small.muted', 'online ora')),
    h('.stat', h('.k', 'CPU'), cpuV, cpuC),
    h('.stat', h('.k', 'RAM usata'), ramV, ramC)));
  const drawCharts = () => {
    const hist = (currentServer().state || {}).statsHistory || [];
    sparkline(cpuC, hist.map((x) => x.cpu), { color: '#d9d2c3', max: 100 });
    sparkline(ramC, hist.map((x) => x.memMb), { color: '#5bd16f', max: s.ramMb * 1.15 });
  };
  requestAnimationFrame(drawCharts);

  const playersBox = h('.list');
  const drawPlayers = (list) => {
    playersBox.innerHTML = '';
    if (!list.length) { playersBox.appendChild(h('.empty', icon('users'), h('.t', 'Nessuno online'), isUp(s) ? 'Condividi l\'indirizzo qui sopra con i tuoi amici.' : 'Avvia il server per giocare.')); return; }
    for (const p of list) playersBox.appendChild(playerRow(s, p));
  };
  drawPlayers(st.players || []);

  const logBox = h('.log-box', { style: { maxHeight: '250px' } });
  const drawLog = () => {
    const lines = (App.logs.get(s.id) || []).slice(-14);
    logBox.textContent = lines.map((l) => l.line).join('\n') || 'Nessun output. Avvia il server.';
    logBox.scrollTop = logBox.scrollHeight;
  };
  ensureLogs(s.id).then(drawLog);

  body.appendChild(h('.grid-2',
    h('.card', h('.card-head', h('h2', 'Giocatori online'), h('.act', btn('Gestisci', { cls: 'sm', onclick: () => { App.tab = 'players'; renderMain(); } }))), playersBox),
    h('.card', h('.card-head', h('h2', 'Console'), h('.act', btn('Apri console', { cls: 'sm', icon: 'terminal', onclick: () => { App.tab = 'console'; renderMain(); } }))), logBox)));

  const infoRows = [
    ['Tipo', `${s.typeName}${s.loaderVersion ? ' ' + s.loaderVersion : ''}`], ['Minecraft', s.mcVersion || 'non rilevata'],
    ['Porta locale', s.port], ['Java', s.javaPath ? s.javaPath : `automatico (Java ${s.javaMajor || '?'})`],
    ['Backup automatici', s.autoBackupMinutes ? `ogni ${s.autoBackupMinutes} min` : 'disattivati'], ['Creato', fmtDate(s.createdAt)],
  ];
  body.appendChild(h('.card', h('.card-head', h('h2', 'Informazioni'), h('.act', btn('Apri cartella', { cls: 'sm', icon: 'folder', onclick: () => api('shell:openPath', s.dir) }))),
    h('.grid-3', infoRows.map(([k, v]) => h('div', h('.small.muted', k), h('div.selectable', { style: { wordBreak: 'break-all' } }, String(v))))),
    h('.small.muted.selectable', { style: { marginTop: '12px' } }, s.dir)));

  App.hooks.onStats = (stats) => {
    cpuV.textContent = stats.cpu + '%';
    ramV.textContent = fmtBytes(stats.memMb * 1048576);
    const cs = currentServer();
    if (cs.state.startedAt) uptime.textContent = 'da ' + fmtDuration(Date.now() - cs.state.startedAt);
    drawCharts();
  };
  App.hooks.onPlayers = (list) => { drawPlayers(list); playersV.textContent = `${list.length} / ${maxPlayers}`; };
  App.hooks.onLog = debounce(drawLog, 150);
}

function playerRow(s, name) {
  const cmd = (c) => run(() => api('servers:send', s.id, c));
  return h('.list-item',
    h('.li-icon', h('img', { src: `https://mc-heads.net/avatar/${encodeURIComponent(name)}/40`, onerror: (e) => { e.target.replaceWith(icon('users')); } })),
    h('.li-main', h('.li-title', name)),
    h('.btn-group',
      btn('', { cls: 'sm icon', icon: 'crown', title: 'Rendi operatore', onclick: () => cmd(`op ${name}`) }),
      btn('', { cls: 'sm icon', icon: 'shield', title: 'Sopravvivenza', onclick: () => cmd(`gamemode survival ${name}`) }),
      btn('', { cls: 'sm icon', icon: 'cube', title: 'Creativa', onclick: () => cmd(`gamemode creative ${name}`) }),
      btn('', { cls: 'sm icon', icon: 'eye', title: 'Spettatore', onclick: () => cmd(`gamemode spectator ${name}`) }),
      btn('', { cls: 'sm icon', icon: 'x', title: 'Espelli', onclick: () => cmd(`kick ${name}`) })));
}

async function ensureLogs(id) {
  if (!App.logs.has(id)) App.logs.set(id, await api('servers:logs', id).catch(() => []));
  return App.logs.get(id);
}

// ---------- File di configurazione ----------
function renderFiles(body, s) {
  const list = h('.file-list');
  const ta = h('textarea.input', { spellcheck: 'false', placeholder: 'Seleziona un file a sinistra' });
  const title = h('strong', '');
  let current = null;
  const save = btn('Salva', { cls: 'primary sm', icon: 'check', disabled: true, onclick: async () => {
    if (await run(() => api('servers:writeFile', s.id, current, ta.value), 'File salvato')) save.disabled = true;
  } });
  ta.addEventListener('input', () => { save.disabled = !current; });
  const folders = [['Cartella server', ''], ['mods', 'mods'], ['plugins', 'plugins'], ['config', 'config'], ['logs', 'logs'], ['crash-reports', 'crash-reports']];
  body.appendChild(h('.row.wrap', { style: { marginBottom: '12px' } },
    h('span.muted.small', 'Apri in Esplora risorse:'),
    folders.map(([l, rel]) => btn(l, { cls: 'sm', icon: 'folder', onclick: () => run(() => api('servers:openFolder', s.id, rel)) }))));
  body.appendChild(h('.file-editor', list, h('.col', { style: { minHeight: 0 } }, h('.row', title, h('span.grow'), save), ta)));
  api('servers:listConfigs', s.id).then((files) => {
    if (!files.length) list.appendChild(h('.muted.small', { style: { padding: '12px' } }, 'Nessun file di configurazione'));
    for (const f of files) {
      const item = h('div', { title: f, onclick: async () => {
        const text = await run(() => api('servers:readFile', s.id, f));
        if (text == null) return;
        current = f; ta.value = text; title.textContent = f; save.disabled = true;
        list.querySelectorAll('div').forEach((d) => d.classList.toggle('sel', d === item));
      } }, f);
      list.appendChild(item);
    }
  }).catch(errToast);
  App.hooks.onStatus = () => {};
}

// ---------- Impostazioni del server ----------
function renderServerSettings(body, s) {
  const running = isUp(s);
  const name = h('input.input', { value: s.name });
  const ram = ramField(s.ramMb);
  const port = h('input.input', { type: 'number', value: s.port, min: 1024, max: 65535 });
  const pub = h('input.input', { value: s.publicAddress || '', placeholder: (App.info.config.playit && App.info.config.playit.publicAddress) || 'es. nome-casuale.gl.joinmc.link' });
  const jvm = h('input.input', { value: s.jvmArgs || '', placeholder: 'es. -Dfml.queryResult=confirm' });
  const aikar = h('input', { type: 'checkbox', checked: s.aikarFlags });
  const autoRestart = h('input', { type: 'checkbox', checked: s.autoRestart });
  const backupEvery = h('select.input', [[0, 'Disattivati'], [15, 'Ogni 15 minuti'], [30, 'Ogni 30 minuti'], [60, 'Ogni ora'], [120, 'Ogni 2 ore'], [360, 'Ogni 6 ore']].map(([v, l]) => h('option', { value: v, selected: Number(s.autoBackupMinutes) === v }, l)));
  const keep = h('input.input', { type: 'number', min: 1, max: 200, value: s.backupKeep || 10 });
  const onStop = h('input', { type: 'checkbox', checked: s.backupOnStop });
  const javaSel = h('select.input', h('option', { value: '' }, `Automatico (Java ${s.javaMajor || '?'}, scaricato se manca)`));
  api('java:list').then((list) => {
    list.forEach((j) => javaSel.appendChild(h('option', { value: j.path, selected: j.path === s.javaPath }, `Java ${j.version}${j.managed ? ' · CraftDock' : ''} · ${j.path}`)));
  }).catch(() => {});

  const save = btn('Salva impostazioni', { cls: 'primary', icon: 'check', onclick: async () => {
    const patch = {
      name: name.value.trim() || s.name, ramMb: ram.getValue(), port: Number(port.value) || 25565, publicAddress: pub.value.trim(),
      jvmArgs: jvm.value.trim(), aikarFlags: aikar.checked, autoRestart: autoRestart.checked, autoBackupMinutes: Number(backupEvery.value),
      backupKeep: Number(keep.value) || 10, backupOnStop: onStop.checked, javaPath: javaSel.value,
    };
    if (await run(() => api('servers:update', s.id, patch), running ? 'Salvato: RAM, Java e porta valgono dal prossimo avvio' : 'Impostazioni salvate')) await refreshServers();
  } });

  body.appendChild(h('.card', h('.card-head', h('h2', 'Generale')),
    h('.grid-2', h('.field', h('label', 'Nome'), name), ram),
    h('.spacer'),
    h('.grid-2',
      h('.field', h('label', 'Porta locale'), port, h('.hint', 'Diversa per ogni server acceso contemporaneamente.')),
      h('.field', h('label', 'Indirizzo pubblico per questo server'), pub, h('.hint', 'Se usi un tunnel playit diverso per ogni server. Vuoto = quello globale.')))));

  body.appendChild(h('.card', h('.card-head', h('h2', 'Java e avvio')),
    h('.field', h('label', 'Versione di Java'), javaSel),
    h('.spacer'),
    h('.field', h('label', 'Argomenti JVM aggiuntivi'), jvm),
    h('.spacer'),
    h('label.check', aikar, h('div', h('div', 'Flag ottimizzati di Aikar'), h('.small.muted', 'Riducono i lag del garbage collector. Consigliati.'))),
    h('.spacer'),
    h('label.check', autoRestart, h('div', h('div', 'Riavvio automatico in caso di crash'), h('.small.muted', 'Massimo 3 tentativi in 10 minuti.')))));

  body.appendChild(h('.card', h('.card-head', h('h2', 'Backup')),
    h('.grid-2', h('.field', h('label', 'Backup automatici (mentre è acceso)'), backupEvery), h('.field', h('label', 'Backup automatici da conservare'), keep)),
    h('.spacer'),
    h('label.check', onStop, h('span', 'Fai un backup ogni volta che il server viene spento'))));

  body.appendChild(h('.row', { style: { marginTop: '14px' } }, save));

  // Cambio versione / loader
  const picker = versionPicker({ type: s.type, mcVersion: s.mcVersion, loaderVersion: s.loaderVersion });
  body.appendChild(h('.card', { style: { marginTop: '18px' } },
    h('.card-head', h('h2', 'Cambia versione o loader')),
    h('.info-note', icon('info'), h('div', 'Reinstalla i file del server mantenendo mondi e configurazioni (prima viene fatto un backup del mondo). ', h('strong', 'Attenzione:'), ' tornare a una versione più vecchia può danneggiare il mondo; cambiando loader le mod esistenti potrebbero non funzionare.')),
    running ? h('.locked-note', icon('lock'), 'Spegni il server per cambiare versione.') : null,
    picker,
    h('.row', { style: { marginTop: '12px' } }, btn('Reinstalla', { cls: 'blue', icon: 'refresh', disabled: running, onclick: async () => {
      const p = picker.getState();
      if (!(await confirmBox('Reinstalla server', `Installo ${App.info.types[p.type].name} ${p.mcVersion}${p.loaderVersion ? ' (' + p.loaderVersion + ')' : ''}. Mondi e configurazioni restano.`, { okLabel: 'Reinstalla' }))) return;
      if (await run(() => api('servers:reinstall', s.id, p), 'Server reinstallato')) { await refreshServers(); renderMain(); }
    } }))));

  body.appendChild(h('.card', { style: { marginTop: '18px', borderColor: 'rgba(239,66,96,.4)' } },
    h('.card-head', h('h2', { style: { color: 'var(--red)' } }, 'Zona pericolosa')),
    h('.row.wrap',
      btn('Rimuovi da CraftDock', { icon: 'x', disabled: running, onclick: async () => {
        if (await confirmBox('Rimuovi server', 'Il server sparisce dalla lista ma i file restano sul disco.', { okLabel: 'Rimuovi', danger: true })) {
          if (await run(() => api('servers:delete', s.id, false), 'Server rimosso')) { await refreshServers(); go('home'); }
        }
      } }),
      btn('Elimina server e file', { cls: 'danger', icon: 'trash', disabled: running, onclick: async () => {
        const typed = await promptBox('Elimina definitivamente', { label: `Scrivi il nome del server ("${s.name}") per confermare. Mondi e backup nella cartella del server verranno cancellati.`, okLabel: 'Elimina' });
        if (typed !== s.name) { if (typed != null) toast('Il nome non corrisponde', 'warn'); return; }
        if (await run(() => api('servers:delete', s.id, true), 'Server eliminato')) { await refreshServers(); go('home'); }
      } }))));
}
