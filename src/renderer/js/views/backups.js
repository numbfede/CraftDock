'use strict';
/* Backup locali: crea (solo mondo o completo), ripristina, elimina, pianificazione rapida. */

function renderBackups(body, s) {
  const list = h('.list');
  const summary = h('span.muted');

  const create = async (scope) => {
    const label = await promptBox(scope === 'full' ? t('Backup completo') : t('Backup del mondo'), { label: t('Etichetta (facoltativa)'), placeholder: t('es. prima di installare Create'), okLabel: t('Crea backup') });
    if (label === null) return;
    if (await run(() => api('backups:create', s.id, { scope, label }), t('Backup creato'))) load();
  };

  const load = async () => {
    const items = await run(() => api('backups:list', s.id)) || [];
    list.innerHTML = '';
    const total = items.reduce((a, b) => a + (b.size || 0), 0);
    summary.textContent = items.length ? `${tn(items.length, '{n} backup', '{n} backup')} · ${fmtBytes(total)}` : '';
    if (!items.length) { list.appendChild(h('.empty', icon('archive'), h('.t', t('Nessun backup')), t('Crea il primo backup o attiva quelli automatici nelle impostazioni del server.'))); return; }
    for (const b of items) {
      list.appendChild(h('.list-item',
        h('.li-icon', icon(b.scope === 'full' ? 'box' : 'map')),
        h('.li-main',
          h('.li-title', b.label || (b.auto ? t('Backup automatico') : t('Backup manuale')), h('span.tag' + (b.scope === 'full' ? '.blue' : ''), b.scope === 'full' ? 'completo' : 'mondo'), b.auto ? h('span.tag', 'auto') : null, b.mcVersion ? h('span.tag', b.mcVersion) : null),
          h('.li-sub', `${fmtDate(b.createdAt)} · ${fmtBytes(b.size)}${b.level ? ' · ' + t('mondo {name}', { name: b.level }) : ''} · ${b.file}`)),
        btn(t('Ripristina'), { cls: 'sm', icon: 'restart', disabled: isUp(currentServer()), title: isUp(currentServer()) ? t('Spegni il server per ripristinare') : '', onclick: async () => {
          const ok = await confirmBox(t('Ripristina backup'), t('Il mondo attuale verrà sostituito con il backup del {date}. Prima viene creato automaticamente un backup di sicurezza dello stato attuale.', { date: fmtDate(b.createdAt) }), { okLabel: t('Ripristina'), danger: true });
          if (ok && await run(() => api('backups:restore', s.id, b.file), t('Backup ripristinato'))) load();
        } }),
        btn('', { cls: 'sm ghost icon', icon: 'trash', title: t('Elimina'), onclick: async () => {
          if (await confirmBox(t('Elimina backup'), t('Eliminare {file}?', { file: b.file }), { okLabel: t('Elimina'), danger: true })) { await run(() => api('backups:remove', s.id, b.file)); load(); }
        } })));
    }
  };

  const every = h('select.input', { style: { maxWidth: '200px' } }, [[0, t('Disattivati')], [15, t('Ogni 15 minuti')], [30, t('Ogni 30 minuti')], [60, t('Ogni ora')], [120, t('Ogni 2 ore')], [360, t('Ogni 6 ore')]].map(([v, l]) => h('option', { value: v, selected: Number(s.autoBackupMinutes) === v }, l)));
  every.addEventListener('change', async () => { if (await run(() => api('servers:update', s.id, { autoBackupMinutes: Number(every.value) }), t('Pianificazione salvata'))) refreshServers(); });
  const onStop = mcToggle(!!s.backupOnStop, async (v) => { if (await run(() => api('servers:update', s.id, { backupOnStop: v }))) refreshServers(); });

  body.appendChild(h('.grid-2',
    h('.card', h('h3', t('Crea un backup')), h('.small.muted', { style: { marginBottom: '12px' } }, t('Funziona anche a server acceso: CraftDock sospende il salvataggio automatico, salva il mondo su disco e poi crea lo zip.')),
      h('.row.wrap', btn(t('Backup del mondo'), { cls: 'primary', icon: 'map', onclick: () => create('world') }), btn(t('Backup completo'), { icon: 'box', title: t('Mondo, mod, configurazioni (esclude librerie scaricabili)'), onclick: () => create('full') }))),
    h('.card', h('h3', t('Automatici')),
      h('.row', h('span.grow', t('Mentre il server è acceso')), every),
      h('.spacer'),
      h('.row', h('span.grow', t('Allo spegnimento del server')), onStop),
      h('.small.muted', { style: { marginTop: '10px' } }, t('Vengono conservati gli ultimi {n} backup automatici; quelli manuali non vengono mai eliminati.', { n: s.backupKeep || 10 })))));
  body.appendChild(h('.card', { style: { marginTop: '14px' } },
    h('.card-head', h('h2', t('Backup salvati')), summary, h('.act', btn(t('Apri cartella'), { cls: 'sm', icon: 'folder', onclick: () => run(() => api('backups:openFolder', s.id)) }), btn('', { cls: 'sm icon', icon: 'refresh', onclick: load }))),
    list));
  load();
  App.hooks.onBackups = load;
}
