'use strict';
/* Pagina server: intestazione, indirizzo, schede, panoramica, file di configurazione, impostazioni server. */

const TABS = [
  { id: 'overview', label: t('Panoramica'), icon: 'home' },
  { id: 'console', label: 'Console', icon: 'terminal' },
  { id: 'options', label: t('Opzioni'), icon: 'sliders' },
  { id: 'controls', label: t('Controlli rapidi'), icon: 'zap' },
  { id: 'players', label: t('Giocatori'), icon: 'users' },
  { id: 'mods', label: t('Mod'), icon: 'puzzle' },
  { id: 'worlds', label: t('Mondi'), icon: 'map' },
  { id: 'backups', label: t('Backup'), icon: 'archive' },
  { id: 'schedule', label: t('Pianificazione'), icon: 'clock' },
  { id: 'files', label: t('File'), icon: 'fileCode' },
  { id: 'settings', label: t('Impostazioni'), icon: 'settings' },
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
    ['globe', t('Niente port forwarding'), t('Tunnel playit.gg integrato. I tuoi amici entrano con un indirizzo pubblico, il router resta com\'è.'), 'big'],
    ['puzzle', t('Mod in un clic'), t('Cerca su Modrinth, installa con le dipendenze.')],
    ['box', t('Tutti i loader'), t('Fabric, Quilt, Forge, NeoForge, Paper, Purpur, Vanilla.')],
    ['map', t('Importa mondi'), t('Dal Minecraft Launcher, da Prism, CurseForge, Modrinth App o da uno zip.'), 'wide'],
    ['archive', t('Backup locali'), t('Manuali, automatici e allo spegnimento, con ripristino sicuro.'), 'wide'],
    ['sliders', t('Pannello opzioni'), t('Proprietà, game rule e comandi rapidi senza scrivere nulla.'), 'wide'],
  ];
  const running = App.servers.filter(isUp).length;

  const intro = h('.home-intro',
    h('span.eyebrow', h('span.eyebrow-dot'), has ? (running ? tn(running, '{n} server acceso', '{n} server accesi') : t('Tutto spento')) : t('Hosting locale')),
    h('h1.home-title', has ? t('Bentornato.') : t('Il tuo server Minecraft,'), has ? null : h('br'), has ? null : h('span.soft', t('sul tuo PC.'))),
    h('p.home-lede', has ? t('Scegli un server dalla lista o creane uno nuovo. Mod, mondi e backup restano tutti in locale.') : t('Crea un server in pochi secondi, aggiungi le mod che vuoi e invita gli amici senza toccare il router.')),
    h('.home-actions',
      btn(t('Crea un server'), { cls: 'primary lg', island: 'plus', onclick: () => openWizard('new') }),
      btn(t('Da modpack'), { cls: 'lg', icon: 'package', onclick: () => openWizard('pack') }),
      btn(t('Importa cartella'), { cls: 'lg ghost', icon: 'folder', onclick: () => openWizard('import') })));

  let aside;
  if (has) {
    aside = h('.home-aside', h('.aside-head', h('span', t('I tuoi server')), h('span.muted', String(App.servers.length))),
      h('.home-servers', App.servers.slice(0, 6).map((s) => {
        const st = serverStatus(s);
        const ic = h('.hs-icon', typeGlyph(s.type));
        loadServerIcon(s.id).then((d) => { if (d) { ic.innerHTML = ''; ic.appendChild(h('img', { src: d })); } });
        return h('button.home-server', { type: 'button', onclick: () => selectServer(s.id) },
          ic,
          h('.hs-main', h('.hs-name', s.name), h('.hs-sub', `${s.typeName} ${s.mcVersion || ''} · ${t('porta {port}', { port: s.port })}`)),
          h('span.status-pill.' + st, h('span.dot.' + st), STATUS_LABEL[st]),
          h('span.hs-go', icon('arrowRight')));
      })));
  } else {
    const steps = [
      [t('Scegli il loader'), t('Fabric, Forge, Paper e gli altri. Java arriva da solo.')],
      [t('Aggiungi le mod'), t('Dal catalogo Modrinth o trascinando i .jar.')],
      [t('Condividi l\'indirizzo'), t('Un clic crea il tunnel pubblico per gli amici.')],
    ];
    aside = h('.home-aside', h('.aside-head', h('span', t('Come funziona')), h('span.muted', t('3 passi'))),
      h('ol.home-steps', steps.map(([tt, d], i) => h('li', h('span.step-n', String(i + 1).padStart(2, '0')), h('div', h('.st-t', tt), h('.st-d', d))))));
  }

  page.appendChild(h('.home-split', intro, aside));
  page.appendChild(h('.bento', features.map(([ic, ft, d, size], i) => h('.feature' + (size ? '.' + size : ''), { style: { '--i': i } },
    h('span.feature-ic', icon(ic)), h('.ft', ft), h('.fd', d)))));
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
  const visibleTabs = TABS.map((tab) => (tab.id === 'mods' ? Object.assign({}, tab, { label: App.info.types[s.type].plugins ? t('Plugin') : t('Mod') }) : tab));
  page.appendChild(h('.tabs', visibleTabs.map((tab) => h('.tab' + (App.tab === tab.id ? '.active' : ''), { onclick: () => { App.tab = tab.id; renderMain(); } }, icon(tab.icon), tab.label))));
  const body = h('#tab-body');
  page.appendChild(body);
  main.appendChild(page);
  const renderers = { overview: renderOverview, console: renderConsoleTab, options: renderOptions, controls: renderControls, players: renderPlayers, mods: renderMods, worlds: renderWorlds, backups: renderBackups, schedule: renderSchedule, files: renderFiles, settings: renderServerSettings };
  (renderers[App.tab] || renderOverview)(body, s);
}

function renderHero(s) {
  const st = serverStatus(s);
  const iconBox = h('.hicon', { title: t('Cambia icona del server (64×64)'), onclick: () => changeIcon(s) }, h('span.ph', icon('image')));
  loadServerIcon(s.id).then((d) => { if (d) { iconBox.innerHTML = ''; iconBox.appendChild(h('img', { src: d })); } });
  const motd = h('.hero-motd');
  api('props:get', s.id).then((p) => { App.props.set(s.id, p); motd.appendChild(mcText(p.motd || 'A Minecraft Server')); }).catch(() => {});
  const actions = h('.hero-actions');
  if (st === 'stopped' || st === 'crashed' || st === 'error') {
    actions.appendChild(btn(t('Avvia'), { cls: 'primary start-big', island: 'play', disabled: st === 'error' && !s.launch, onclick: () => startServer(s) }));
  } else if (st === 'installing') {
    actions.appendChild(btn(t('Installazione…'), { cls: 'start-big', disabled: true }));
  } else {
    actions.appendChild(btn(t('Riavvia'), { icon: 'restart', disabled: st !== 'running', onclick: () => run(() => api('servers:restart', s.id)) }));
    actions.appendChild(btn(st === 'stopping' ? t('Arresto…') : t('Ferma'), { cls: 'danger start-big', island: 'stop', disabled: st === 'stopping', onclick: () => run(() => api('servers:stop', s.id)) }));
    actions.appendChild(btn('', { cls: 'ghost icon', icon: 'skull', title: t('Chiusura forzata (può perdere dati non salvati)'), onclick: async () => {
      if (await confirmBox(t('Chiusura forzata'), t('Il server verrà terminato subito senza salvare. Usalo solo se non risponde.'), { okLabel: t('Termina'), danger: true })) run(() => api('servers:kill', s.id));
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
  const chip = (lbl, addr, main) => h('.row', { style: { gap: '8px' } }, h('div', h('.lbl', lbl), h('.addr', { style: main ? {} : { fontSize: '13px', color: 'var(--text-2)' } }, addr)), btn('', { cls: 'ghost sm icon', icon: 'copy', title: t('Copia'), onclick: () => copyText(addr) }));
  const port = Number(s.port) || 25565;
  const withPort = (ip) => (port === 25565 ? ip : `${ip}:${port}`);
  return h('.address-bar',
    pub ? chip(t('Indirizzo per gli amici'), pub, true) : h('div', h('.lbl', t('Indirizzo per gli amici')),
      h('.row', { style: { gap: '8px', marginTop: '4px' } },
        btn(t('Crea indirizzo pubblico'), { cls: 'sm blue', icon: 'globe', title: t('Collega playit.gg (se serve) e crea un tunnel per questo server, senza port forwarding'), onclick: async () => {
          if (await run(() => api('tunnel:ensureForServer', s.id), t('Indirizzo pubblico pronto: copialo e mandalo agli amici'))) { await refreshServers(); renderMain(); }
        } }),
        h('a.small', { onclick: () => go('connection') }, t('Altre opzioni')))),
    h('span.grow'),
    chip(t('Sul tuo PC'), withPort('localhost')),
    lan ? chip(t('Rete di casa (LAN)'), withPort(lan.ip)) : null,
    vpn ? chip(vpn.kind[0].toUpperCase() + vpn.kind.slice(1), withPort(vpn.ip)) : null);
}

async function changeIcon(s) {
  const f = await run(() => api('dialog:openFile', t('Icona del server'), [{ name: t('Immagini'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }]));
  if (!f) return;
  if (await run(() => api('servers:setIcon', s.id, f), t('Icona aggiornata (visibile dopo il riavvio)'))) {
    await loadServerIcon(s.id, true);
    renderSidebar(); renderMain();
  }
}

async function startServer(s) {
  try {
    await api('servers:start', s.id);
  } catch (e) {
    if (e.code === 'EULA') {
      const ok = await confirmBox(t('EULA di Minecraft'), h('div', h('p', t('Per avviare il server devi accettare la EULA di Minecraft.')), h('a', { onclick: () => api('shell:openExternal', 'https://aka.ms/MinecraftEULA') }, t('Leggi la EULA'))), { okLabel: t('Accetto') });
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
  const uptime = h('.small.muted', st.startedAt && isUp(s) ? t('da ') + fmtDuration(Date.now() - st.startedAt) : '–');
  const playersV = h('.v', `${(st.players || []).length} / ${maxPlayers}`);
  const cpuV = h('.v', st.stats ? st.stats.cpu + '%' : '–');
  const ramV = h('.v', st.stats ? fmtBytes(st.stats.memMb * 1048576) : '–');
  const cpuC = h('canvas'); const ramC = h('canvas');
  body.appendChild(h('.stats-row',
    h('.stat', h('.k', t('Stato')), statusV, uptime),
    h('.stat', h('.k', t('Giocatori')), playersV, h('.small.muted', t('online ora'))),
    h('.stat', h('.k', 'CPU'), cpuV, cpuC),
    h('.stat', h('.k', t('RAM usata')), ramV, ramC)));
  const drawCharts = () => {
    const hist = (currentServer().state || {}).statsHistory || [];
    sparkline(cpuC, hist.map((x) => x.cpu), { color: '#d9d2c3', max: 100 });
    sparkline(ramC, hist.map((x) => x.memMb), { color: '#5bd16f', max: s.ramMb * 1.15 });
  };
  requestAnimationFrame(drawCharts);

  const playersBox = h('.list');
  const drawPlayers = (list) => {
    playersBox.innerHTML = '';
    if (!list.length) { playersBox.appendChild(h('.empty', icon('users'), h('.t', t('Nessuno online')), isUp(s) ? t('Condividi l\'indirizzo qui sopra con i tuoi amici.') : t('Avvia il server per giocare.'))); return; }
    for (const p of list) playersBox.appendChild(playerRow(s, p));
  };
  drawPlayers(st.players || []);

  const logBox = h('.log-box', { style: { maxHeight: '250px' } });
  const drawLog = () => {
    const lines = (App.logs.get(s.id) || []).slice(-14);
    logBox.textContent = lines.map((l) => l.line).join('\n') || t('Nessun output. Avvia il server.');
    logBox.scrollTop = logBox.scrollHeight;
  };
  ensureLogs(s.id).then(drawLog);

  body.appendChild(h('.grid-2',
    h('.card', h('.card-head', h('h2', t('Giocatori online')), h('.act', btn(t('Gestisci'), { cls: 'sm', onclick: () => { App.tab = 'players'; renderMain(); } }))), playersBox),
    h('.card', h('.card-head', h('h2', 'Console'), h('.act', btn(t('Apri console'), { cls: 'sm', icon: 'terminal', onclick: () => { App.tab = 'console'; renderMain(); } }))), logBox)));

  const infoRows = [
    [t('Tipo'), `${s.typeName}${s.loaderVersion ? ' ' + s.loaderVersion : ''}`], ['Minecraft', s.mcVersion || t('non rilevata')],
    [t('Porta locale'), s.port], ['Java', s.javaPath ? s.javaPath : t('automatico (Java {v})', { v: s.javaMajor || '?' })],
    [t('Backup automatici'), s.autoBackupMinutes ? t('ogni {n} min', { n: s.autoBackupMinutes }) : 'disattivati'], [t('Creato'), fmtDate(s.createdAt)],
  ];
  body.appendChild(h('.card', h('.card-head', h('h2', t('Informazioni')), h('.act', btn(t('Apri cartella'), { cls: 'sm', icon: 'folder', onclick: () => api('shell:openPath', s.dir) }))),
    h('.grid-3', infoRows.map(([k, v]) => h('div', h('.small.muted', k), h('div.selectable', { style: { wordBreak: 'break-all' } }, String(v))))),
    h('.small.muted.selectable', { style: { marginTop: '12px' } }, s.dir)));

  App.hooks.onStats = (stats) => {
    cpuV.textContent = stats.cpu + '%';
    ramV.textContent = fmtBytes(stats.memMb * 1048576);
    const cs = currentServer();
    if (cs.state.startedAt) uptime.textContent = t('da ') + fmtDuration(Date.now() - cs.state.startedAt);
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
      btn('', { cls: 'sm icon', icon: 'crown', title: t('Rendi operatore'), onclick: () => cmd(`op ${name}`) }),
      btn('', { cls: 'sm icon', icon: 'shield', title: t('Sopravvivenza'), onclick: () => cmd(`gamemode survival ${name}`) }),
      btn('', { cls: 'sm icon', icon: 'cube', title: t('Creativa'), onclick: () => cmd(`gamemode creative ${name}`) }),
      btn('', { cls: 'sm icon', icon: 'eye', title: t('Spettatore'), onclick: () => cmd(`gamemode spectator ${name}`) }),
      btn('', { cls: 'sm icon', icon: 'x', title: t('Espelli'), onclick: () => cmd(`kick ${name}`) })));
}

async function ensureLogs(id) {
  if (!App.logs.has(id)) App.logs.set(id, await api('servers:logs', id).catch(() => []));
  return App.logs.get(id);
}

// ---------- File di configurazione ----------
function renderFiles(body, s) {
  const list = h('.file-list');
  const ta = h('textarea.input', { spellcheck: 'false', placeholder: t('Seleziona un file a sinistra') });
  const title = h('strong', '');
  let current = null;
  const save = btn(t('Salva'), { cls: 'primary sm', icon: 'check', disabled: true, onclick: async () => {
    if (await run(() => api('servers:writeFile', s.id, current, ta.value), t('File salvato'))) save.disabled = true;
  } });
  ta.addEventListener('input', () => { save.disabled = !current; });
  const folders = [[t('Cartella server'), ''], ['mods', 'mods'], ['plugins', 'plugins'], ['config', 'config'], ['logs', 'logs'], ['crash-reports', 'crash-reports']];
  body.appendChild(h('.row.wrap', { style: { marginBottom: '12px' } },
    h('span.muted.small', App.info.platform === 'darwin' ? t('Apri nel Finder:') : t('Apri in Esplora risorse:')),
    folders.map(([l, rel]) => btn(l, { cls: 'sm', icon: 'folder', onclick: () => run(() => api('servers:openFolder', s.id, rel)) }))));
  body.appendChild(h('.file-editor', list, h('.col', { style: { minHeight: 0 } }, h('.row', title, h('span.grow'), save), ta)));
  api('servers:listConfigs', s.id).then((files) => {
    if (!files.length) list.appendChild(h('.muted.small', { style: { padding: '12px' } }, t('Nessun file di configurazione')));
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
  const pub = h('input.input', { value: s.publicAddress || '', placeholder: (App.info.config.playit && App.info.config.playit.publicAddress) || t('es. nome-casuale.gl.joinmc.link') });
  const jvm = h('input.input', { value: s.jvmArgs || '', placeholder: t('es. -Dfml.queryResult=confirm') });
  const aikar = h('input', { type: 'checkbox', checked: s.aikarFlags });
  const autoRestart = h('input', { type: 'checkbox', checked: s.autoRestart });
  const backupEvery = h('select.input', [[0, t('Disattivati')], [15, t('Ogni 15 minuti')], [30, t('Ogni 30 minuti')], [60, t('Ogni ora')], [120, t('Ogni 2 ore')], [360, t('Ogni 6 ore')]].map(([v, l]) => h('option', { value: v, selected: Number(s.autoBackupMinutes) === v }, l)));
  const keep = h('input.input', { type: 'number', min: 0, max: 200, value: s.backupKeep === 0 ? 0 : (s.backupKeep || 10), title: t('0 = non eliminare mai') });
  const onStop = h('input', { type: 'checkbox', checked: s.backupOnStop });
  const javaSel = h('select.input', h('option', { value: '' }, t('Automatico (Java {v}, scaricato se manca)', { v: s.javaMajor || '?' })));
  api('java:list').then((list) => {
    list.forEach((j) => javaSel.appendChild(h('option', { value: j.path, selected: j.path === s.javaPath }, `Java ${j.version}${j.managed ? ' · CraftDock' : ''} · ${j.path}`)));
  }).catch(() => {});

  const save = btn(t('Salva impostazioni'), { cls: 'primary', icon: 'check', onclick: async () => {
    const patch = {
      name: name.value.trim() || s.name, ramMb: ram.getValue(), port: Number(port.value) || 25565, publicAddress: pub.value.trim(),
      jvmArgs: jvm.value.trim(), aikarFlags: aikar.checked, autoRestart: autoRestart.checked, autoBackupMinutes: Number(backupEvery.value),
      backupKeep: keep.value === '' ? 10 : Math.max(0, Number(keep.value) || 0), backupOnStop: onStop.checked, javaPath: javaSel.value,
    };
    if (await run(() => api('servers:update', s.id, patch), running ? t('Salvato: RAM, Java e porta valgono dal prossimo avvio') : t('Impostazioni salvate'))) await refreshServers();
  } });

  body.appendChild(h('.card', h('.card-head', h('h2', t('Generale'))),
    h('.grid-2', h('.field', h('label', t('Nome')), name), ram),
    h('.spacer'),
    h('.grid-2',
      h('.field', h('label', t('Porta locale')), port, h('.hint', t('Diversa per ogni server acceso contemporaneamente.'))),
      h('.field', h('label', t('Indirizzo pubblico per questo server')), pub, h('.hint', t('Se usi un tunnel playit diverso per ogni server. Vuoto = quello globale.'))))));

  body.appendChild(h('.card', h('.card-head', h('h2', t('Java e avvio'))),
    h('.field', h('label', t('Versione di Java')), javaSel),
    h('.spacer'),
    h('.field', h('label', t('Argomenti JVM aggiuntivi')), jvm),
    h('.spacer'),
    h('label.check', aikar, h('div', h('div', t('Flag ottimizzati di Aikar')), h('.small.muted', t('Riducono i lag del garbage collector. Consigliati.')))),
    h('.spacer'),
    h('label.check', autoRestart, h('div', h('div', t('Riavvio automatico in caso di crash')), h('.small.muted', t('Massimo 3 tentativi in 10 minuti.'))))));

  body.appendChild(h('.card', h('.card-head', h('h2', t('Backup'))),
    h('.grid-2', h('.field', h('label', t('Backup automatici (mentre è acceso)')), backupEvery), h('.field', h('label', t('Backup da conservare (0 = tutti)')), keep)),
    h('.spacer'),
    h('label.check', onStop, h('span', t('Fai un backup ogni volta che il server viene spento')))));

  body.appendChild(h('.row', { style: { marginTop: '14px' } }, save));

  // Cambio versione / loader
  const picker = versionPicker({ type: s.type, mcVersion: s.mcVersion, loaderVersion: s.loaderVersion });
  body.appendChild(h('.card', { style: { marginTop: '18px' } },
    h('.card-head', h('h2', t('Cambia versione o loader'))),
    h('.info-note', icon('info'), h('div', t('Reinstalla i file del server mantenendo mondi e configurazioni (prima viene fatto un backup del mondo). '), h('strong', t('Attenzione:')), t(' tornare a una versione più vecchia può danneggiare il mondo; cambiando loader le mod esistenti potrebbero non funzionare.'))),
    running ? h('.locked-note', icon('lock'), t('Spegni il server per cambiare versione.')) : null,
    picker,
    h('.row', { style: { marginTop: '12px' } }, btn(t('Reinstalla'), { cls: 'blue', icon: 'refresh', disabled: running, onclick: async () => {
      const p = picker.getState();
      if (!(await confirmBox(t('Reinstalla server'), t('Installo {what}. Mondi e configurazioni restano.', { what: `${App.info.types[p.type].name} ${p.mcVersion}${p.loaderVersion ? ' (' + p.loaderVersion + ')' : ''}` }), { okLabel: t('Reinstalla') }))) return;
      if (await run(() => api('servers:reinstall', s.id, p), t('Server reinstallato'))) { await refreshServers(); renderMain(); }
    } }))));

  body.appendChild(h('.card', { style: { marginTop: '18px', borderColor: 'rgba(239,66,96,.4)' } },
    h('.card-head', h('h2', { style: { color: 'var(--red)' } }, t('Zona pericolosa'))),
    h('.row.wrap',
      btn(t('Rimuovi da CraftDock'), { icon: 'x', disabled: running, onclick: async () => {
        if (await confirmBox(t('Rimuovi server'), t('Il server sparisce dalla lista ma i file restano sul disco.'), { okLabel: t('Rimuovi'), danger: true })) {
          if (await run(() => api('servers:delete', s.id, false), t('Server rimosso'))) { await refreshServers(); go('home'); }
        }
      } }),
      btn(t('Elimina server e file'), { cls: 'danger', icon: 'trash', disabled: running, onclick: async () => {
        const typed = await promptBox(t('Elimina definitivamente'), { label: t('Scrivi il nome del server ("{name}") per confermare. Mondi e backup nella cartella del server verranno cancellati.', { name: s.name }), okLabel: t('Elimina') });
        if (typed !== s.name) { if (typed != null) toast(t('Il nome non corrisponde'), 'warn'); return; }
        if (await run(() => api('servers:delete', s.id, true), t('Server eliminato'))) { await refreshServers(); go('home'); }
      } }))));
}
