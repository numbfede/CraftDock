'use strict';
/* Pianificazione: riavvii, backup, comandi, messaggi, accensione e spegnimento a orario. */

const SCHEDULE_KINDS = [
  { id: 'restart', icon: 'restart', label: () => t('Riavvio'), hint: () => t('Riavvia il server se è acceso. Con l\'avviso, i giocatori lo sanno 5 e 1 minuto prima.') },
  { id: 'backup', icon: 'archive', label: () => t('Backup'), hint: () => t('Backup del mondo, anche con il server acceso. Conta tra i backup automatici.') },
  { id: 'message', icon: 'send', label: () => t('Messaggio'), hint: () => t('Scrive un messaggio in chat a tutti i giocatori.') },
  { id: 'command', icon: 'terminal', label: () => t('Comando'), hint: () => t('Esegue un comando della console, senza la barra iniziale.') },
  { id: 'start', icon: 'play', label: () => t('Accensione'), hint: () => t('Accende il server se è spento. CraftDock deve essere aperto.') },
  { id: 'stop', icon: 'stop', label: () => t('Spegnimento'), hint: () => t('Spegne il server salvando il mondo.') },
];
// lunedì per primo; i numeri sono quelli di JavaScript (0 = domenica)
const WEEK = [[1, () => t('Lun')], [2, () => t('Mar')], [3, () => t('Mer')], [4, () => t('Gio')], [5, () => t('Ven')], [6, () => t('Sab')], [0, () => t('Dom')]];

function kindInfo(id) { return SCHEDULE_KINDS.find((k) => k.id === id) || SCHEDULE_KINDS[0]; }

function daysLabel(days) {
  if (!days || !days.length || days.length === 7) return t('Ogni giorno');
  const set = new Set(days);
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return t('Dal lunedì al venerdì');
  if (set.size === 2 && set.has(0) && set.has(6)) return t('Nel fine settimana');
  return WEEK.filter(([d]) => set.has(d)).map(([, l]) => l()).join(', ');
}

/** Prossima esecuzione, per mostrare "tra 3 ore" accanto a ogni riga. */
function nextRun(entry, from = new Date()) {
  const [hh, mm] = entry.time.split(':').map(Number);
  const days = entry.days && entry.days.length ? entry.days : [0, 1, 2, 3, 4, 5, 6];
  for (let i = 0; i < 8; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(hh, mm, 0, 0);
    if (d > from && days.includes(d.getDay())) return d;
  }
  return null;
}

function fmtIn(date) {
  if (!date) return '';
  const min = Math.round((date - Date.now()) / 60000);
  if (min < 60) return tn(min, 'tra {n} minuto', 'tra {n} minuti');
  const h = Math.round(min / 60);
  if (h < 24) return tn(h, 'tra {n} ora', 'tra {n} ore');
  return tn(Math.round(h / 24), 'tra {n} giorno', 'tra {n} giorni');
}

function renderSchedule(body, s) {
  let list = (s.schedules || []).map((e) => Object.assign({}, e));
  const box = h('.list');

  const save = async (okMsg) => {
    const r = await run(() => api('servers:update', s.id, { schedules: list }), okMsg);
    if (r) { list = (r.schedules || []).map((e) => Object.assign({}, e)); const cur = currentServer(); if (cur) cur.schedules = r.schedules; draw(); }
  };

  const draw = () => {
    box.innerHTML = '';
    if (!list.length) {
      box.appendChild(h('.empty', icon('clock'), h('.t', t('Nessuna operazione programmata')),
        h('div', t('Per esempio un riavvio ogni notte alle 4 o un backup ogni sera.'))));
      return;
    }
    const sorted = list.slice().sort((a, b) => a.time.localeCompare(b.time));
    for (const e of sorted) {
      const k = kindInfo(e.kind);
      const detail = e.kind === 'command' ? '/' + e.command : e.kind === 'message' ? '“' + e.message + '”' : (e.kind === 'restart' || e.kind === 'stop') && e.warn ? t('con avviso ai giocatori') : '';
      const toggle = mcToggle(e.enabled !== false, (v) => { e.enabled = v; save(); });
      box.appendChild(h('.list-item.sched-row' + (e.enabled === false ? '.disabled' : ''),
        h('.li-icon', icon(k.icon)),
        h('.sched-time', e.time),
        h('.li-main',
          h('.li-title', k.label(), detail ? h('span.muted.small', detail) : null),
          h('.li-sub', daysLabel(e.days) + (e.enabled !== false ? ' · ' + fmtIn(nextRun(e)) : ''))),
        toggle,
        btn('', { cls: 'ghost sm icon', icon: 'edit', title: t('Modifica'), onclick: () => editor(e) }),
        btn('', { cls: 'ghost sm icon', icon: 'trash', title: t('Elimina'), onclick: () => { list = list.filter((x) => x !== e); save(t('Operazione eliminata')); } })));
    }
  };

  const editor = (existing) => {
    const e = Object.assign({ kind: 'restart', time: '04:00', days: [], enabled: true, warn: true, command: '', message: '' }, existing || {});
    const kindRow = h('.seg');
    const time = h('input.input', { type: 'time', value: e.time, style: { maxWidth: '150px' } });
    const dayRow = h('.cat-chips', { style: { marginBottom: 0 } });
    const extra = h('div');
    const hint = h('.small.muted', { style: { marginTop: '8px' } });

    const drawKinds = () => {
      kindRow.innerHTML = '';
      SCHEDULE_KINDS.forEach((k) => kindRow.appendChild(btn(k.label(), { cls: 'sm' + (e.kind === k.id ? ' on' : ''), icon: k.icon, onclick: () => { e.kind = k.id; drawKinds(); drawExtra(); } })));
      hint.textContent = kindInfo(e.kind).hint();
    };
    const drawDays = () => {
      dayRow.innerHTML = '';
      const all = !e.days.length || e.days.length === 7;
      dayRow.appendChild(h('.chip' + (all ? '.active' : ''), { onclick: () => { e.days = []; drawDays(); } }, t('Ogni giorno')));
      WEEK.forEach(([d, l]) => dayRow.appendChild(h('.chip' + (!all && e.days.includes(d) ? '.active' : ''), {
        onclick: () => {
          const set = new Set(all ? [] : e.days);
          if (set.has(d)) set.delete(d); else set.add(d);
          e.days = [...set];
          drawDays();
        },
      }, l())));
    };
    const drawExtra = () => {
      extra.innerHTML = '';
      if (e.kind === 'command') {
        const cmd = h('input.input', { value: e.command, placeholder: t('es. weather clear') });
        cmd.addEventListener('input', () => { e.command = cmd.value.trim().replace(/^\//, ''); });
        extra.appendChild(h('.field', h('label', t('Comando')), cmd));
      } else if (e.kind === 'message') {
        const msg = h('input.input', { value: e.message, placeholder: t('es. Ricordatevi di votare il server!') });
        msg.addEventListener('input', () => { e.message = msg.value; });
        extra.appendChild(h('.field', h('label', t('Messaggio in chat')), msg));
      } else if (e.kind === 'restart' || e.kind === 'stop') {
        const warn = h('input', { type: 'checkbox', checked: e.warn !== false });
        warn.addEventListener('change', () => { e.warn = warn.checked; });
        extra.appendChild(h('label.check', warn, h('span', t('Avvisa i giocatori in chat 5 minuti e 1 minuto prima'))));
      }
    };
    drawKinds(); drawDays(); drawExtra();

    const m = modal({
      title: existing ? t('Modifica operazione') : t('Nuova operazione programmata'),
      wide: true,
      body: h('.col', { style: { gap: '18px' } },
        h('.field', h('label', t('Cosa fare')), kindRow, hint),
        h('.grid-2',
          h('.field', h('label', t('Orario')), time),
          h('.field', h('label', t('Giorni')), dayRow)),
        extra,
        h('.info-note', { style: { margin: 0 } }, icon('info'), h('div', t('Le operazioni partono solo mentre CraftDock è aperto (anche ridotto a icona nell\'area di notifica). L\'orario è quello del PC.')))),
      foot: [btn(t('Annulla'), { onclick: () => m.close() }), btn(existing ? t('Salva') : t('Aggiungi'), { cls: 'primary', icon: 'check', onclick: async () => {
        e.time = time.value || '04:00';
        if (e.kind === 'command' && !e.command) return toast(t('Scrivi il comando da eseguire'), 'warn');
        if (e.kind === 'message' && !e.message.trim()) return toast(t('Scrivi il messaggio da mandare'), 'warn');
        if (existing) Object.assign(existing, e); else list.push(e);
        m.close();
        await save(existing ? t('Operazione aggiornata') : t('Operazione programmata aggiunta'));
      } })],
    });
  };

  const presets = [
    [t('Riavvio ogni notte alle 4'), { kind: 'restart', time: '04:00', days: [], warn: true }],
    [t('Backup ogni sera alle 22'), { kind: 'backup', time: '22:00', days: [] }],
    [t('Spegni di notte nei giorni feriali'), { kind: 'stop', time: '01:00', days: [1, 2, 3, 4, 5], warn: true }],
  ];

  body.appendChild(h('.card',
    h('.card-head', icon('clock'), h('h2', t('Operazioni programmate')), h('.act', btn(t('Nuova operazione'), { cls: 'primary sm', icon: 'plus', onclick: () => editor(null) }))),
    h('.small.muted', { style: { marginBottom: '10px' } }, t('Riavvii, backup, messaggi e comandi che partono da soli all\'orario che scegli.')),
    box));
  body.appendChild(h('.card',
    h('.card-head', h('h2', t('Idee veloci'))),
    h('.row.wrap', presets.map(([label, preset]) => btn(label, { cls: 'sm', icon: 'plus', onclick: () => { list.push(Object.assign({ enabled: true, command: '', message: '' }, preset)); save(t('Operazione programmata aggiunta')); } })))));
  draw();
  // aggiorna i "tra X minuti" una volta al minuto
  const timer = setInterval(() => { if (App.tab !== 'schedule' || !document.body.contains(box)) clearInterval(timer); else draw(); }, 60000);
}
