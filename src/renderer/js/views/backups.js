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

  // rotazione: si tengono gli ultimi N (0 = tutti); di base solo gli automatici
  const keepNow = s.backupKeep === 0 ? 0 : (Number(s.backupKeep) || 10);
  const KEEP = [[0, t('Mai (tieni tutti)')], [3, t('Tieni gli ultimi 3')], [5, t('Tieni gli ultimi 5')], [10, t('Tieni gli ultimi 10')], [20, t('Tieni gli ultimi 20')], [50, t('Tieni gli ultimi 50')]];
  if (!KEEP.some(([v]) => v === keepNow)) KEEP.push([keepNow, t('Tieni gli ultimi {n}', { n: keepNow })]);
  const keepSel = h('select.input', { style: { maxWidth: '200px' } }, KEEP.sort((a, b) => a[0] - b[0]).map(([v, l]) => h('option', { value: v, selected: v === keepNow }, l)));
  let manualNow = !!s.backupPruneManual;
  const keepNote = h('.small.muted', { style: { marginTop: '10px' } });
  const drawNote = (keep, manual) => {
    keepNote.textContent = !keep ? t('Nessun backup viene eliminato in automatico.')
      : manual ? t('Dopo ogni backup restano solo gli ultimi {n}, automatici o manuali: i più vecchi vengono eliminati.', { n: keep })
        : t('Dopo ogni backup restano gli ultimi {n} automatici; quelli manuali non vengono eliminati.', { n: keep });
  };
  drawNote(keepNow, manualNow);
  const applyKeep = async (keep, manual) => {
    const pv = await run(() => api('backups:prunePreview', s.id, keep, manual));
    if (!pv) return false;
    if (pv.count && !(await confirmBox(t('Eliminare i backup più vecchi?'),
      tn(pv.count, 'Con questa regola {n} backup ({size}) viene eliminato subito. L\'operazione non si può annullare.', 'Con questa regola {n} backup ({size}) vengono eliminati subito. L\'operazione non si può annullare.', { size: fmtBytes(pv.size) }),
      { okLabel: t('Elimina e salva'), danger: true }))) return false;
    if (!(await run(() => api('servers:update', s.id, { backupKeep: keep, backupPruneManual: manual })))) return false;
    if (pv.count) await run(() => api('backups:prune', s.id));
    s.backupKeep = keep; s.backupPruneManual = manual;
    drawNote(keep, manual);
    refreshServers(); load();
    toast(t('Regola salvata'), 'ok');
    return true;
  };
  keepSel.addEventListener('change', async () => {
    if (!(await applyKeep(Number(keepSel.value), manualNow))) keepSel.value = String(s.backupKeep === 0 ? 0 : (Number(s.backupKeep) || 10));
  });
  const manualToggle = mcToggle(manualNow, async (v) => {
    const keep = Number(keepSel.value);
    if (await applyKeep(keep, v)) manualNow = v;
    else renderMain(); // annullato: torna allo stato salvato
  });

  const where = h('.small.muted.selectable', { style: { marginTop: '6px' } });
  api('backups:location').then((l) => { where.textContent = t('Cartella dei backup: {dir}', { dir: l.dir }) + (l.reachable ? '' : ' · ' + t('non raggiungibile')); }).catch(() => {});

  body.appendChild(h('.grid-2',
    h('.card', h('h3', t('Crea un backup')), h('.small.muted', { style: { marginBottom: '12px' } }, t('Funziona anche a server acceso: CraftDock sospende il salvataggio automatico, salva il mondo su disco e poi crea lo zip.')),
      h('.row.wrap', btn(t('Backup del mondo'), { cls: 'primary', icon: 'map', onclick: () => create('world') }), btn(t('Backup completo'), { icon: 'box', title: t('Mondo, mod, configurazioni (esclude librerie scaricabili)'), onclick: () => create('full') }))),
    h('.card', h('h3', t('Automatici')),
      h('.row', h('span.grow', t('Mentre il server è acceso')), every),
      h('.spacer'),
      h('.row', h('span.grow', t('Allo spegnimento del server')), onStop),
      h('.spacer'),
      h('.row', h('span.grow', t('Elimina i più vecchi')), keepSel),
      h('.spacer'),
      h('.row', h('span.grow', t('Conta anche i backup manuali')), manualToggle),
      keepNote)));
  body.appendChild(h('.card', { style: { marginTop: '14px' } },
    h('.card-head', h('h2', t('Backup salvati')), summary, h('.act',
      btn(t('Sposta su un altro disco…'), { cls: 'sm', icon: 'hardDrive', onclick: () => moveBackupsFlow(load) }),
      btn(t('Apri cartella'), { cls: 'sm', icon: 'folder', onclick: () => run(() => api('backups:openFolder', s.id)) }), btn('', { cls: 'sm icon', icon: 'refresh', onclick: load }))),
    where, list));
  load();
  App.hooks.onBackups = load;
}

/**
 * Sposta la cartella dei backup di tutti i server (anche su un altro disco).
 * Prima mostra cosa succede e chiede una conferma esplicita con la casella "Ho capito".
 */
async function moveBackupsFlow(after, target) {
  const dir = target || await run(() => api('dialog:openFolder', t('Dove vuoi spostare i backup?')));
  if (!dir) return;
  const plan = await run(() => api('backups:planMove', dir));
  if (!plan) return;
  const flag = h('input', { type: 'checkbox' });
  const go = btn(t('Sposta i backup'), { cls: 'primary', icon: 'hardDrive', disabled: true, onclick: async () => {
    m.close();
    const r = await run(() => api('backups:move', plan.to));
    if (r) { toast(t('Backup spostati in {dir}', { dir: r.to }), 'ok', 7000); after && after(r); }
  } });
  flag.addEventListener('change', () => { go.disabled = !flag.checked || !plan.enough; });
  const row = (k, v) => h('.row', { style: { gap: '12px', alignItems: 'baseline' } }, h('span.muted', { style: { minWidth: '110px' } }, k), h('code.selectable', { style: { wordBreak: 'break-all' } }, v));
  const m = modal({
    title: t('Sposta la cartella dei backup'),
    body: h('div',
      row(t('Da'), plan.from),
      h('.spacer'),
      row(t('A'), plan.to),
      h('.spacer'),
      h('.row', { style: { gap: '12px' } }, h('span.muted', { style: { minWidth: '110px' } }, t('Da spostare')), h('span', `${fmtBytes(plan.bytes)} · ${tn(plan.files, '{n} file', '{n} file')}`)),
      plan.free !== null ? h('.row', { style: { gap: '12px', marginTop: '6px' } }, h('span.muted', { style: { minWidth: '110px' } }, t('Spazio libero')), h('span', fmtBytes(plan.free))) : null,
      h('.info-note', { style: { marginTop: '14px' } }, icon('info'), h('div',
        plan.sameDrive ? t('Stesso disco: lo spostamento è quasi istantaneo.')
          : t('Disco diverso: CraftDock copia ogni backup, controlla che la copia sia completa e solo alla fine cancella gli originali. Con backup grandi può richiedere diversi minuti.'),
        ' ', t('Vale per tutti i server; durante lo spostamento non si possono creare backup.'))),
      !plan.enough ? h('.locked-note', { style: { marginTop: '10px' } }, icon('alert'), t('Spazio insufficiente sul disco di destinazione.')) : null,
      h('label.check', { style: { marginTop: '14px' } }, flag, h('span', t('Ho capito: sposta tutti i backup ({size}) nella nuova cartella.', { size: fmtBytes(plan.bytes) })))),
    foot: [btn(t('Annulla'), { onclick: () => m.close() }), go],
  });
}
