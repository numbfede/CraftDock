'use strict';
/* Impostazioni dell'app: cartelle, RAM predefinita, chiave CurseForge, comportamento, installazioni Java. */

function renderAppSettings(main) {
  const cfg = App.info.config;
  const page = h('.page', h('header.page-head', h('span.eyebrow', h('span.eyebrow-dot'), 'CraftDock ' + App.info.version), h('h1.page-title', t('Impostazioni')), h('p.page-lede', t('Cartelle, avvio, Java e cataloghi di mod. Valgono per tutti i server.'))));
  const root = h('input.input', { value: cfg.root, readonly: true });
  const ram = ramField(cfg.defaultRamMb);
  const tray = h('input', { type: 'checkbox', checked: cfg.closeToTray });
  const snaps = h('input', { type: 'checkbox', checked: cfg.showSnapshots });
  const playitAuto = h('input', { type: 'checkbox', checked: cfg.playit && cfg.playit.autoStart });

  const save = async () => {
    const patch = { root: root.value, defaultRamMb: ram.getValue(), closeToTray: tray.checked, showSnapshots: snaps.checked, playit: Object.assign({}, cfg.playit, { autoStart: playitAuto.checked }) };
    const r = await run(() => api('config:save', patch), t('Impostazioni salvate'));
    if (r) { App.info.config = r; App.versionCache.clear(); }
  };

  page.appendChild(h('.card', h('.card-head', h('h2', t('Cartelle'))),
    h('.field', h('label', t('Cartella principale (server, backup, Java, strumenti)')),
      h('.row', root,
        btn(t('Cambia…'), { onclick: async () => { const d = await run(() => api('dialog:openFolder', t('Cartella principale di CraftDock'))); if (d) root.value = d; } }),
        btn('', { cls: 'icon', icon: 'folder', onclick: () => api('shell:openPath', cfg.root) })),
      h('.hint', t('Cambiandola, i server già creati restano dove sono; i nuovi verranno creati nella nuova cartella.')))));

  // cartella dei backup: si può spostare su un altro disco
  const bkDir = h('code.selectable', { style: { wordBreak: 'break-all' } }, '…');
  const bkInfo = h('.small.muted');
  const bkActs = h('.row.wrap', { style: { marginTop: '12px' } });
  const drawBk = async () => {
    const l = await api('backups:location').catch(() => null);
    if (!l) return;
    bkDir.textContent = l.dir;
    bkInfo.textContent = l.reachable ? `${fmtBytes(l.bytes)} · ${tn(l.files, '{n} file', '{n} file')}` : t('Non raggiungibile: se è su un disco esterno, collegalo.');
    bkActs.innerHTML = '';
    bkActs.append(
      btn(t('Sposta…'), { cls: 'primary', icon: 'hardDrive', onclick: () => moveBackupsFlow(drawBk) }),
      l.reachable ? btn(t('Apri'), { icon: 'folder', onclick: () => api('shell:openPath', l.dir) }) : null,
      l.custom ? btn(t('Riporta nella cartella di CraftDock'), { cls: 'ghost', onclick: () => moveBackupsFlow(drawBk, l.defaultDir) }) : null);
  };
  page.appendChild(h('.card', h('.card-head', icon('archive'), h('h2', t('Backup'))),
    h('.field', h('label', t('Cartella dei backup (tutti i server)')), bkDir, bkInfo),
    h('.small.muted', { style: { marginTop: '8px' } }, t('Se i backup diventano grandi puoi spostarli su un disco più capiente, anche esterno. CraftDock sposta quelli esistenti e salva lì i nuovi.')),
    bkActs));
  drawBk();

  page.appendChild(h('.card', h('.card-head', h('h2', t('Predefiniti'))), ram, h('.spacer'),
    h('label.check', snaps, h('span', t('Mostra snapshot e pre-release nell\'elenco delle versioni')))));

  page.appendChild(h('.card', h('.card-head', h('h2', t('Cataloghi di mod'))),
    h('.row', h('span.tag.green', t('Modrinth · attivo')), App.info.curseforge ? h('span.tag.green', t('CurseForge · attivo')) : h('span.tag.yellow', t('CurseForge · in arrivo'))),
    h('.small.muted', { style: { marginTop: '10px' } }, App.info.curseforge
      ? t('Mod e modpack si possono cercare e installare sia da Modrinth sia da CurseForge.')
      : t('CurseForge sarà attivato con un prossimo aggiornamento, senza bisogno di configurare nulla. Nel frattempo Modrinth offre quasi tutte le mod e i modpack più popolari.'))));

  page.appendChild(h('.card', h('.card-head', h('h2', t('Comportamento'))),
    h('label.check', tray, h('div', h('div', t('Chiudendo la finestra, riduci a icona nell\'area di notifica')), h('.small.muted', t('I server continuano a girare in background. Esci dal menu dell\'icona.')))),
    h('.spacer'),
    h('label.check', playitAuto, h('span', t('Avvia il tunnel playit.gg all\'apertura dell\'app')))));

  page.appendChild(h('.row', { style: { margin: '14px 0 24px' } }, btn(t('Salva impostazioni'), { cls: 'primary', icon: 'check', onclick: save })));

  // Java
  const javaList = h('.list');
  const loadJava = async (force) => {
    javaList.innerHTML = '';
    javaList.appendChild(h('.muted', { style: { padding: '12px' } }, t('Cerco le installazioni di Java…')));
    const list = await run(() => api('java:list', force)) || [];
    javaList.innerHTML = '';
    if (!list.length) javaList.appendChild(h('.empty', { style: { padding: '20px' } }, t('Nessun Java trovato: verrà scaricato in automatico al primo avvio di un server.')));
    list.forEach((j) => javaList.appendChild(h('.list-item', h('.li-icon', icon('java')),
      h('.li-main', h('.li-title', `Java ${j.version}`, j.managed ? h('span.tag.green', 'CraftDock') : null, j.fromPath ? h('span.tag', t('PATH')) : null), h('.li-sub.selectable', j.path)))));
  };
  page.appendChild(h('.card',
    h('.card-head', h('h2', t('Installazioni Java')), h('.act',
      [8, 17, 21, 25].map((v) => btn('Java ' + v, { cls: 'sm', icon: 'download', title: t('Scarica Eclipse Temurin {v}', { v }), onclick: async () => { if (await run(() => api('java:install', v), t('Java {v} installato', { v }))) loadJava(true); } })),
      btn('', { cls: 'sm icon', icon: 'refresh', onclick: () => loadJava(true) }))),
    h('.small.muted', { style: { marginBottom: '10px' } }, t('Ogni server usa automaticamente la versione giusta (Java 8 fino alla 1.16, 17 fino alla 1.20.4, 21 fino alla 1.21.x, 25 dalla 26.1). Mancante = scaricata da Adoptium.')),
    javaList));
  loadJava(false);

  // Lingua
  const langSel = h('select.input', { style: { maxWidth: '260px' } },
    [['auto', t('Automatica (lingua di Windows)')], ['it', 'Italiano'], ['en', 'English']].map(([v, l]) => h('option', { value: v, selected: (cfg.language || 'auto') === v }, l)));
  langSel.addEventListener('change', async () => {
    const r = await run(() => api('app:setLanguage', langSel.value));
    if (r) location.reload();
  });
  page.appendChild(h('.card', h('.card-head', icon('globe'), h('h2', t('Lingua'))),
    h('.row.wrap', langSel, h('span.small.muted', t('L\'interfaccia si ricarica subito; i server accesi non vengono toccati.')))));

  // Aggiornamenti
  const upd = h('div');
  const autoUpd = h('input', { type: 'checkbox', checked: cfg.checkUpdates !== false });
  autoUpd.addEventListener('change', async () => { const r = await run(() => api('config:save', { checkUpdates: autoUpd.checked })); if (r) App.info.config = r; });
  const drawUpd = (u) => {
    upd.innerHTML = '';
    const line = !u ? t('Stato sconosciuto')
      : u.state === 'checking' ? t('Controllo in corso…')
      : u.available ? t('È disponibile la versione {v}.', { v: u.version })
      : u.error ? t('Impossibile controllare: {msg}', { msg: u.error })
      : u.checkedAt ? t('Hai l\'ultima versione ({v}).', { v: App.info.version }) : t('Non ancora controllato.');
    upd.append(h('.row.wrap',
      h('.grow', h('div', line), u && u.checkedAt ? h('.small.muted', t('Ultimo controllo: {when}', { when: fmtAgo(u.checkedAt) })) : null),
      btn(t('Controlla ora'), { cls: 'sm', icon: 'refresh', onclick: async () => { const r = await run(() => api('update:check')); if (r) { App.update = r; drawUpd(r); renderSidebar(); } } }),
      u && u.available ? btn(u.portable ? t('Scarica') : t('Aggiorna ora'), { cls: 'sm primary', island: u.portable ? 'download' : 'arrowRight', onclick: () => startUpdate() }) : null,
      btn(t('Novità'), { cls: 'sm ghost', icon: 'external', onclick: () => api('shell:openExternal', (u && u.notesUrl) || 'https://craftdock.numbfede.com/novita') })));
  };
  drawUpd(App.update);
  App.hooks.onUpdate = drawUpd;
  page.appendChild(h('.card', h('.card-head', icon('download'), h('h2', t('Aggiornamenti'))), upd, h('.spacer'),
    h('label.check', autoUpd, h('div', h('div', t('Controlla gli aggiornamenti all\'avvio')), h('.small.muted', t('CraftDock legge solo il numero dell\'ultima versione da GitHub. Non invia nessun dato.'))))));

  // Supporto e diagnostica
  page.appendChild(h('.card', h('.card-head', icon('info'), h('h2', t('Supporto'))),
    h('.small.muted', { style: { marginBottom: '12px' } }, t('Se qualcosa non funziona, copia le informazioni di diagnostica e incollale nella tua richiesta di aiuto: versioni, sistema, server e ultime righe del log. Il nome utente di Windows viene nascosto.')),
    h('.row.wrap',
      btn(t('Copia informazioni per il supporto'), { cls: 'primary sm', icon: 'copy', onclick: async () => { const txt = await run(() => api('app:diagnostics')); if (txt) copyText(txt, t('Informazioni copiate: incollale nella richiesta di aiuto')); } }),
      btn(t('Apri cartella dei log'), { cls: 'sm', icon: 'folder', onclick: () => run(() => api('app:openLogs')) }),
      btn(t('Segnala un problema'), { cls: 'sm ghost', icon: 'external', onclick: () => api('shell:openExternal', 'https://github.com/numbfede/CraftDock/issues/new') }))));

  page.appendChild(h('.card', h('.card-head', h('h2', t('Informazioni'))),
    h('div', t('CraftDock {v} · creato da numbfede', { v: App.info.version })),
    h('.small.muted', { style: { marginTop: '6px' } }, t('Minecraft è un marchio di Mojang/Microsoft. CraftDock non è affiliato a Mojang, Aternos, Modrinth, CurseForge o playit.gg.'))));
  main.appendChild(page);
}
