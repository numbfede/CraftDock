'use strict';
/* Barra laterale: elenco server, pulsante nuovo server, collegamenti globali. */

const iconCache = new Map();

async function loadServerIcon(id, force) {
  if (iconCache.has(id) && !force) return iconCache.get(id);
  const data = await api('servers:getIcon', id).catch(() => null);
  iconCache.set(id, data);
  return data;
}

function typeGlyph(type) {
  const map = { vanilla: 'cube', fabric: 'puzzle', quilt: 'puzzle', forge: 'box', neoforge: 'box', paper: 'package', purpur: 'package' };
  return icon(map[type] || 'cube');
}

function renderSidebar() {
  const sb = document.getElementById('sidebar');
  sb.innerHTML = '';
  sb.appendChild(h('.brand',
    h('img', { src: 'assets/icon.png', alt: '' }),
    h('div', h('.brand-name', t('Craft'), h('span', t('Dock'))), h('.brand-sub', t('Server Minecraft locali')))));

  sb.appendChild(h('.side-section', btn(t('Nuovo server'), { cls: 'primary', icon: 'plus', onclick: () => openWizard() })));
  const running = App.servers.filter(isUp).length;
  sb.appendChild(h('.side-label', h('span', t('I tuoi server ({n})', { n: App.servers.length })), running ? h('span.tag.green', t('{n} online', { n: running })) : null));

  const list = h('.server-list');
  if (!App.servers.length) list.appendChild(h('.muted.small', { style: { padding: '8px 10px' } }, t('Nessun server ancora. Creane uno o importa una cartella esistente.')));
  for (const s of App.servers) {
    const st = serverStatus(s);
    const ic = h('.sicon', typeGlyph(s.type));
    loadServerIcon(s.id).then((d) => { if (d) { ic.innerHTML = ''; ic.appendChild(h('img', { src: d })); } });
    const players = (s.state && s.state.players) || [];
    list.appendChild(h('.server-item' + (App.view === 'server' && App.selectedId === s.id ? '.active' : ''), { onclick: () => selectServer(s.id) },
      ic,
      h('.meta', h('.name', s.name), h('.sub', `${s.typeName} ${s.mcVersion || ''}`.trim() + (st === 'running' ? ' · ' + t('{n} online', { n: players.length }) : ''))),
      h('span.dot.' + st, { title: STATUS_LABEL[st] })));
  }
  sb.appendChild(list);

  const link = (view, ic, label, badge) => h('.side-link' + (App.view === view ? '.active' : ''), { onclick: () => go(view) }, icon(ic), h('span', label), badge || null);
  const tunnelBadge = App.tunnelStatus === 'running' ? h('span.dot.running.badge', { style: { minWidth: '9px', height: '9px', padding: 0 } }) : null;
  if (App.update && App.update.available) sb.appendChild(renderUpdateCard());
  sb.appendChild(h('.side-footer',
    link('home', 'home', t('Panoramica')),
    link('connection', 'globe', t('Connessione amici'), tunnelBadge),
    link('settings', 'settings', t('Impostazioni'))));
}

/** Avvia l'aggiornamento (installer) o apre la pagina di download (versione portatile). */
async function startUpdate() {
  const u = App.update;
  if (!u) return;
  if (u.portable) { api('shell:openExternal', u.downloadPage); return; }
  const ok = await confirmBox(t('Aggiorna CraftDock'), t('Scarico CraftDock {v} e avvio l\'installazione. L\'app si chiuderà: i server accesi verranno fermati in modo sicuro prima.', { v: u.version }), { okLabel: t('Aggiorna') });
  if (ok) run(() => api('update:install'));
}

/** Avviso di nuova versione in fondo alla barra laterale. */
function renderUpdateCard() {
  const u = App.update;
  const busy = u.state === 'downloading' || u.state === 'launching';
  const action = btn(busy ? t('Download…') : u.portable ? t('Scarica') : t('Aggiorna ora'), {
    cls: 'primary sm', island: u.portable ? 'download' : 'arrowRight', disabled: busy,
    onclick: () => startUpdate(),
  });
  return h('.update-card',
    h('.update-top', h('span.eyebrow-dot'), h('span', t('Nuova versione'))),
    h('.update-ver', t('CraftDock ') + u.version),
    h('.update-actions', action, h('a.small', { onclick: () => api('shell:openExternal', u.notesUrl) }, t('Novità'))));
}

function go(view) {
  App.view = view;
  if (view !== 'server') App.selectedId = null;
  renderSidebar();
  renderMain();
}

function selectServer(id, tab) {
  if (App.selectedId !== id) App.tab = tab || 'overview';
  else if (tab) App.tab = tab;
  App.selectedId = id;
  App.view = 'server';
  renderSidebar();
  renderMain();
}
