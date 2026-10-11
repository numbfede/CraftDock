'use strict';
/* Backup locali: crea (solo mondo o completo), ripristina, elimina, pianificazione rapida. */

function renderBackups(body, s) {
  const list = h('.list');
  const summary = h('span.muted');

  const create = async (scope) => {
    const label = await promptBox(scope === 'full' ? 'Backup completo' : 'Backup del mondo', { label: 'Etichetta (facoltativa)', placeholder: 'es. prima di installare Create', okLabel: 'Crea backup' });
    if (label === null) return;
    if (await run(() => api('backups:create', s.id, { scope, label }), 'Backup creato')) load();
  };

  const load = async () => {
    const items = await run(() => api('backups:list', s.id)) || [];
    list.innerHTML = '';
    const total = items.reduce((a, b) => a + (b.size || 0), 0);
    summary.textContent = items.length ? `${items.length} backup · ${fmtBytes(total)}` : '';
    if (!items.length) { list.appendChild(h('.empty', icon('archive'), h('.t', 'Nessun backup'), 'Crea il primo backup o attiva quelli automatici nelle impostazioni del server.')); return; }
    for (const b of items) {
      list.appendChild(h('.list-item',
        h('.li-icon', icon(b.scope === 'full' ? 'box' : 'map')),
        h('.li-main',
          h('.li-title', b.label || (b.auto ? 'Backup automatico' : 'Backup manuale'), h('span.tag' + (b.scope === 'full' ? '.blue' : ''), b.scope === 'full' ? 'completo' : 'mondo'), b.auto ? h('span.tag', 'auto') : null, b.mcVersion ? h('span.tag', b.mcVersion) : null),
          h('.li-sub', `${fmtDate(b.createdAt)} · ${fmtBytes(b.size)}${b.level ? ' · mondo ' + b.level : ''} · ${b.file}`)),
        btn('Ripristina', { cls: 'sm', icon: 'restart', disabled: isUp(currentServer()), title: isUp(currentServer()) ? 'Spegni il server per ripristinare' : '', onclick: async () => {
          const ok = await confirmBox('Ripristina backup', `Il mondo attuale verrà sostituito con il backup del ${fmtDate(b.createdAt)}. Prima viene creato automaticamente un backup di sicurezza dello stato attuale.`, { okLabel: 'Ripristina', danger: true });
          if (ok && await run(() => api('backups:restore', s.id, b.file), 'Backup ripristinato')) load();
        } }),
        btn('', { cls: 'sm ghost icon', icon: 'trash', title: 'Elimina', onclick: async () => {
          if (await confirmBox('Elimina backup', `Eliminare ${b.file}?`, { okLabel: 'Elimina', danger: true })) { await run(() => api('backups:remove', s.id, b.file)); load(); }
        } })));
    }
  };

  const every = h('select.input', { style: { maxWidth: '200px' } }, [[0, 'Disattivati'], [15, 'Ogni 15 minuti'], [30, 'Ogni 30 minuti'], [60, 'Ogni ora'], [120, 'Ogni 2 ore'], [360, 'Ogni 6 ore']].map(([v, l]) => h('option', { value: v, selected: Number(s.autoBackupMinutes) === v }, l)));
  every.addEventListener('change', async () => { if (await run(() => api('servers:update', s.id, { autoBackupMinutes: Number(every.value) }), 'Pianificazione salvata')) refreshServers(); });
  const onStop = mcToggle(!!s.backupOnStop, async (v) => { if (await run(() => api('servers:update', s.id, { backupOnStop: v }))) refreshServers(); });

  body.appendChild(h('.grid-2',
    h('.card', h('h3', 'Crea un backup'), h('.small.muted', { style: { marginBottom: '12px' } }, 'Funziona anche a server acceso: CraftDock sospende il salvataggio automatico, salva il mondo su disco e poi crea lo zip.'),
      h('.row.wrap', btn('Backup del mondo', { cls: 'primary', icon: 'map', onclick: () => create('world') }), btn('Backup completo', { icon: 'box', title: 'Mondo, mod, configurazioni (esclude librerie scaricabili)', onclick: () => create('full') }))),
    h('.card', h('h3', 'Automatici'),
      h('.row', h('span.grow', 'Mentre il server è acceso'), every),
      h('.spacer'),
      h('.row', h('span.grow', 'Allo spegnimento del server'), onStop),
      h('.small.muted', { style: { marginTop: '10px' } }, `Vengono conservati gli ultimi ${s.backupKeep || 10} backup automatici; quelli manuali non vengono mai eliminati.`))));
  body.appendChild(h('.card', { style: { marginTop: '14px' } },
    h('.card-head', h('h2', 'Backup salvati'), summary, h('.act', btn('Apri cartella', { cls: 'sm', icon: 'folder', onclick: () => run(() => api('backups:openFolder', s.id)) }), btn('', { cls: 'sm icon', icon: 'refresh', onclick: load }))),
    list));
  load();
  App.hooks.onBackups = load;
}
