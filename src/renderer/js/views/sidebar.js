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
    h('div', h('.brand-name', 'Craft', h('span', 'Dock')), h('.brand-sub', 'Server Minecraft locali'))));

  sb.appendChild(h('.side-section', btn('Nuovo server', { cls: 'primary', icon: 'plus', onclick: () => openWizard() })));
  const running = App.servers.filter(isUp).length;
  sb.appendChild(h('.side-label', h('span', `I tuoi server (${App.servers.length})`), running ? h('span.tag.green', `${running} online`) : null));

  const list = h('.server-list');
  if (!App.servers.length) list.appendChild(h('.muted.small', { style: { padding: '8px 10px' } }, 'Nessun server ancora. Creane uno o importa una cartella esistente.'));
  for (const s of App.servers) {
    const st = serverStatus(s);
    const ic = h('.sicon', typeGlyph(s.type));
    loadServerIcon(s.id).then((d) => { if (d) { ic.innerHTML = ''; ic.appendChild(h('img', { src: d })); } });
    const players = (s.state && s.state.players) || [];
    list.appendChild(h('.server-item' + (App.view === 'server' && App.selectedId === s.id ? '.active' : ''), { onclick: () => selectServer(s.id) },
      ic,
      h('.meta', h('.name', s.name), h('.sub', `${s.typeName} ${s.mcVersion || ''}`.trim() + (st === 'running' ? ` · ${players.length} online` : ''))),
      h('span.dot.' + st, { title: STATUS_LABEL[st] })));
  }
  sb.appendChild(list);

  const link = (view, ic, label, badge) => h('.side-link' + (App.view === view ? '.active' : ''), { onclick: () => go(view) }, icon(ic), h('span', label), badge || null);
  const tunnelBadge = App.tunnelStatus === 'running' ? h('span.dot.running.badge', { style: { minWidth: '9px', height: '9px', padding: 0 } }) : null;
  sb.appendChild(h('.side-footer',
    link('home', 'home', 'Panoramica'),
    link('connection', 'globe', 'Connessione amici', tunnelBadge),
    link('settings', 'settings', 'Impostazioni')));
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
