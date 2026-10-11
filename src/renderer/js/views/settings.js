'use strict';
/* Impostazioni dell'app: cartelle, RAM predefinita, chiave CurseForge, comportamento, installazioni Java. */

function renderAppSettings(main) {
  const cfg = App.info.config;
  const page = h('.page', h('h1.page-title', 'Impostazioni'));
  const root = h('input.input', { value: cfg.root, readonly: true });
  const ram = ramField(cfg.defaultRamMb);
  const tray = h('input', { type: 'checkbox', checked: cfg.closeToTray });
  const snaps = h('input', { type: 'checkbox', checked: cfg.showSnapshots });
  const playitAuto = h('input', { type: 'checkbox', checked: cfg.playit && cfg.playit.autoStart });

  const save = async () => {
    const patch = { root: root.value, defaultRamMb: ram.getValue(), closeToTray: tray.checked, showSnapshots: snaps.checked, playit: Object.assign({}, cfg.playit, { autoStart: playitAuto.checked }) };
    const r = await run(() => api('config:save', patch), 'Impostazioni salvate');
    if (r) { App.info.config = r; App.versionCache.clear(); }
  };

  page.appendChild(h('.card', h('.card-head', h('h2', 'Cartelle')),
    h('.field', h('label', 'Cartella principale (server, backup, Java, strumenti)'),
      h('.row', root,
        btn('Cambia…', { onclick: async () => { const d = await run(() => api('dialog:openFolder', 'Cartella principale di CraftDock')); if (d) root.value = d; } }),
        btn('', { cls: 'icon', icon: 'folder', onclick: () => api('shell:openPath', cfg.root) })),
      h('.hint', 'Cambiandola, i server già creati restano dove sono; i nuovi verranno creati nella nuova cartella.'))));

  page.appendChild(h('.card', h('.card-head', h('h2', 'Predefiniti')), ram, h('.spacer'),
    h('label.check', snaps, h('span', 'Mostra snapshot e pre-release nell\'elenco delle versioni'))));

  page.appendChild(h('.card', h('.card-head', h('h2', 'Cataloghi di mod')),
    h('.row', h('span.tag.green', 'Modrinth · attivo'), App.info.curseforge ? h('span.tag.green', 'CurseForge · attivo') : h('span.tag.yellow', 'CurseForge · in arrivo')),
    h('.small.muted', { style: { marginTop: '10px' } }, App.info.curseforge
      ? 'Mod e modpack si possono cercare e installare sia da Modrinth sia da CurseForge.'
      : 'CurseForge sarà attivato con un prossimo aggiornamento, senza bisogno di configurare nulla. Nel frattempo Modrinth offre quasi tutte le mod e i modpack più popolari.')));

  page.appendChild(h('.card', h('.card-head', h('h2', 'Comportamento')),
    h('label.check', tray, h('div', h('div', 'Chiudendo la finestra, riduci a icona nell\'area di notifica'), h('.small.muted', 'I server continuano a girare in background. Esci dal menu dell\'icona.'))),
    h('.spacer'),
    h('label.check', playitAuto, h('span', 'Avvia il tunnel playit.gg all\'apertura dell\'app'))));

  page.appendChild(h('.row', { style: { margin: '14px 0 24px' } }, btn('Salva impostazioni', { cls: 'primary', icon: 'check', onclick: save })));

  // Java
  const javaList = h('.list');
  const loadJava = async (force) => {
    javaList.innerHTML = '';
    javaList.appendChild(h('.muted', { style: { padding: '12px' } }, 'Cerco le installazioni di Java…'));
    const list = await run(() => api('java:list', force)) || [];
    javaList.innerHTML = '';
    if (!list.length) javaList.appendChild(h('.empty', { style: { padding: '20px' } }, 'Nessun Java trovato: verrà scaricato in automatico al primo avvio di un server.'));
    list.forEach((j) => javaList.appendChild(h('.list-item', h('.li-icon', icon('java')),
      h('.li-main', h('.li-title', `Java ${j.version}`, j.managed ? h('span.tag.green', 'CraftDock') : null, j.fromPath ? h('span.tag', 'PATH') : null), h('.li-sub.selectable', j.path)))));
  };
  page.appendChild(h('.card',
    h('.card-head', h('h2', 'Installazioni Java'), h('.act',
      [8, 17, 21, 25].map((v) => btn('Java ' + v, { cls: 'sm', icon: 'download', title: `Scarica Eclipse Temurin ${v}`, onclick: async () => { if (await run(() => api('java:install', v), `Java ${v} installato`)) loadJava(true); } })),
      btn('', { cls: 'sm icon', icon: 'refresh', onclick: () => loadJava(true) }))),
    h('.small.muted', { style: { marginBottom: '10px' } }, 'Ogni server usa automaticamente la versione giusta (Java 8 fino alla 1.16, 17 fino alla 1.20.4, 21 fino alla 1.21.x, 25 dalla 26.1). Mancante = scaricata da Adoptium.'),
    javaList));
  loadJava(false);

  page.appendChild(h('.card', h('.card-head', h('h2', 'Informazioni')),
    h('div', `CraftDock ${App.info.version} · creato da numbfede`),
    h('.small.muted', { style: { marginTop: '6px' } }, 'Minecraft è un marchio di Mojang/Microsoft. CraftDock non è affiliato a Mojang, Aternos, Modrinth, CurseForge o playit.gg.')));
  main.appendChild(page);
}
