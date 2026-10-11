'use strict';
/* Controlli rapidi: difficoltà, modalità, orario, meteo, azioni sui giocatori, distanza di rendering, game rule. */

App.gameruleValues = new Map();

function segButtons(options, current, onPick, { disabled } = {}) {
  const wrap = h('.seg');
  options.forEach(([v, l, ic]) => {
    const b = btn(l, { cls: 'sm' + (String(current) === String(v) ? ' on' : ''), icon: ic, disabled, onclick: async () => {
      await onPick(v);
      wrap.querySelectorAll('.btn').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    } });
    wrap.appendChild(b);
  });
  return wrap;
}

function renderControls(body, s) {
  const up = serverStatus(s) === 'running';
  const props = App.props.get(s.id) || {};
  const send = (c) => run(() => api('servers:send', s.id, c));
  const persist = (patch) => api('props:set', s.id, patch).then((m) => App.props.set(s.id, m)).catch(errToast);

  if (!up) body.appendChild(h('.locked-note', icon('lock'), h('div', isUp(s) ? 'Attendi che il server finisca di avviarsi…' : 'Avvia il server per usare i comandi rapidi. Distanza di rendering e simulazione si possono cambiare anche da spento.')));

  const grid = h('.ctl-grid');
  grid.appendChild(h('.card', h('h3', 'Difficoltà'),
    segButtons([['peaceful', 'Pacifica'], ['easy', 'Facile'], ['normal', 'Normale'], ['hard', 'Difficile']], props.difficulty, async (v) => { await send(`difficulty ${v}`); await persist({ difficulty: v }); }, { disabled: !up })));
  grid.appendChild(h('.card', h('h3', 'Modalità predefinita'),
    segButtons([['survival', 'Sopravv.'], ['creative', 'Creativa'], ['adventure', 'Avventura'], ['spectator', 'Spett.']], props.gamemode, async (v) => { await send(`defaultgamemode ${v}`); await persist({ gamemode: v }); }, { disabled: !up })));
  grid.appendChild(h('.card', h('h3', 'Orario'),
    h('.seg', [['1000', 'Giorno', 'sun'], ['6000', 'Mezzogiorno', 'sun'], ['12000', 'Tramonto', 'cloud'], ['13000', 'Notte', 'moon'], ['18000', 'Mezzanotte', 'moon']].map(([t, l, ic]) => btn(l, { cls: 'sm', icon: ic, disabled: !up, onclick: () => send(`time set ${t}`) })))));
  grid.appendChild(h('.card', h('h3', 'Meteo'),
    h('.seg', [['clear', 'Sereno', 'sun'], ['rain', 'Pioggia', 'rain'], ['thunder', 'Temporale', 'storm']].map(([w, l, ic]) => btn(l, { cls: 'sm', icon: ic, disabled: !up, onclick: () => send(`weather ${w}`) })))));

  // Azioni giocatore
  const players = (s.state && s.state.players) || [];
  const who = h('input.input', { placeholder: 'Nome giocatore', list: 'dl-players', value: players[0] || '' });
  const dl = h('datalist#dl-players', players.map((p) => h('option', { value: p })));
  const target = h('select.input', h('option', { value: '' }, 'Teletrasporta da…'), players.map((p) => h('option', { value: p }, p)));
  const pAct = (fn) => () => { const n = who.value.trim(); if (!n) return toast('Scrivi il nome del giocatore', 'warn'); fn(n); };
  grid.appendChild(h('.card', { style: { gridColumn: 'span 2' } }, h('h3', 'Giocatore'), dl,
    h('.row', who),
    h('.spacer'),
    h('.seg',
      btn('Sopravvivenza', { cls: 'sm', icon: 'shield', disabled: !up, onclick: pAct((n) => send(`gamemode survival ${n}`)) }),
      btn('Creativa', { cls: 'sm', icon: 'cube', disabled: !up, onclick: pAct((n) => send(`gamemode creative ${n}`)) }),
      btn('Avventura', { cls: 'sm', icon: 'map', disabled: !up, onclick: pAct((n) => send(`gamemode adventure ${n}`)) }),
      btn('Spettatore', { cls: 'sm', icon: 'eye', disabled: !up, onclick: pAct((n) => send(`gamemode spectator ${n}`)) })),
    h('.spacer'),
    h('.seg',
      btn('Operatore', { cls: 'sm', icon: 'crown', disabled: !up, onclick: pAct((n) => send(`op ${n}`)) }),
      btn('Togli op', { cls: 'sm', disabled: !up, onclick: pAct((n) => send(`deop ${n}`)) }),
      btn('Cura', { cls: 'sm', icon: 'heart', disabled: !up, onclick: pAct((n) => { send(`effect give ${n} minecraft:instant_health 1 10`); send(`effect give ${n} minecraft:saturation 1 20`); }) }),
      btn('+10 livelli', { cls: 'sm', disabled: !up, onclick: pAct((n) => send(`xp add ${n} 10 levels`)) }),
      btn('Espelli', { cls: 'sm', icon: 'x', disabled: !up, onclick: pAct((n) => send(`kick ${n}`)) }),
      btn('Banna', { cls: 'sm danger', icon: 'ban', disabled: !up, onclick: pAct(async (n) => { if (await confirmBox('Banna ' + n, `${n} non potrà più entrare finché non revochi il ban.`, { okLabel: 'Banna', danger: true })) send(`ban ${n}`); }) })),
    h('.spacer'),
    h('.row', target, btn('→ da questo giocatore', { cls: 'sm', disabled: !up, onclick: pAct((n) => { if (!target.value) return toast('Scegli dove teletrasportare', 'warn'); send(`tp ${n} ${target.value}`); }) }),
      btn('Svuota inventario', { cls: 'sm', icon: 'trash', disabled: !up, onclick: pAct(async (n) => { if (await confirmBox('Svuota inventario', `Tutti gli oggetti di ${n} verranno cancellati.`, { okLabel: 'Svuota', danger: true })) send(`clear ${n}`); }) }))));

  // Distanze
  const dist = (key, label, min, max, def) => {
    const val = Number(props[key]) || def;
    const out = h('strong', String(val));
    const r = h('input.range', { type: 'range', min, max, value: val });
    r.addEventListener('input', () => { out.textContent = r.value; });
    r.addEventListener('change', async () => {
      await persist({ [key]: r.value });
      toast(`${label}: ${r.value} chunk${isUp(s) ? ' — si applica al prossimo riavvio' : ''}`, 'ok');
    });
    return h('.field', h('label', label + ': ', out, ' chunk'), r);
  };
  grid.appendChild(h('.card', h('h3', 'Distanza di rendering e simulazione'),
    dist('view-distance', 'Rendering', 2, 32, 10), h('.spacer'), dist('simulation-distance', 'Simulazione', 3, 32, 10),
    h('.small.muted', { style: { marginTop: '8px' } }, 'Valori alti pesano molto su CPU e RAM. Si applicano al riavvio.'),
    isUp(s) ? h('.row', { style: { marginTop: '8px' } }, btn('Riavvia ora', { cls: 'sm', icon: 'restart', onclick: () => run(() => api('servers:restart', s.id)) })) : null));

  grid.appendChild(h('.card', h('h3', 'Mondo'),
    h('.seg',
      btn('Salva mondo', { cls: 'sm', icon: 'download', disabled: !up, onclick: () => send('save-all') }),
      btn('Bordo mondo…', { cls: 'sm', icon: 'map', disabled: !up, onclick: async () => { const d = await promptBox('Bordo del mondo', { label: 'Diametro in blocchi (centrato su 0,0)', value: '10000' }); if (d && /^\d+$/.test(d)) send(`worldborder set ${d}`); } }),
      btn('Messaggio…', { cls: 'sm', icon: 'send', disabled: !up, onclick: async () => { const m = await promptBox('Messaggio a tutti', {}); if (m) send(`say ${m}`); } }))));
  body.appendChild(grid);

  // Game rule
  const rules = gameRulesFor(s.mcVersion);
  const values = App.gameruleValues.get(s.id) || {};
  App.gameruleValues.set(s.id, values);
  const grList = h('.gr-list');
  const drawRules = () => {
    grList.innerHTML = '';
    for (const g of rules) {
      const raw = values[g.name];
      let control;
      if (g.type === 'bool') {
        const on = raw == null ? null : (raw === 'true') !== !!g.invert;
        control = mcToggle(!!on, async (v) => {
          const val = String(g.invert ? !v : v);
          values[g.name] = val;
          await send(`gamerule ${g.name} ${val}`);
        }, { disabled: !up });
        if (on == null) control.style.opacity = up ? '.7' : '.4';
      } else {
        control = numInput(raw ?? '', { min: g.min, max: g.max, onChange: (v) => { values[g.name] = v; if (up) send(`gamerule ${g.name} ${v}`); } });
        if (!up) control.querySelector('input').disabled = true;
      }
      grList.appendChild(h('.gr-item', g.icon ? icon(g.icon) : null, h('.gl', h('.n', g.label), h('.k', g.name + (raw == null ? ' · valore sconosciuto' : ''))), control));
    }
  };
  const readAll = async (btnEl) => {
    btnEl.disabled = true;
    let ok = 0;
    for (const g of rules) {
      const re = `(?:Game ?rule|Gamerule)\\s+(?:minecraft:)?${g.name}\\s+is currently set to:\\s*(\\S+)`;
      const m = await api('servers:query', s.id, `gamerule ${g.name}`, re, 2500).catch(() => null);
      if (m) { values[g.name] = m[1]; ok++; }
    }
    btnEl.disabled = false;
    drawRules();
    toast(ok ? `Lette ${ok} game rule dal server` : 'Il server non ha risposto: le mod potrebbero aver cambiato il formato', ok ? 'ok' : 'warn');
  };
  const readBtn = btn('Leggi valori dal server', { cls: 'sm', icon: 'refresh', disabled: !up });
  readBtn.onclick = () => readAll(readBtn);
  body.appendChild(h('.card', { style: { marginTop: '14px' } },
    h('.card-head', h('h2', 'Game rule'), h('span.small.muted', vcmp(s.mcVersion || '0', '1.21.11') >= 0 ? 'nomi nuovi (1.21.11+)' : 'nomi classici'), h('.act', readBtn)),
    h('.small.muted', { style: { marginBottom: '12px' } }, 'Le game rule sono salvate nel mondo e si cambiano con il server acceso. Clicca "Leggi valori" per vedere quelle attuali; ogni modifica viene inviata subito.'),
    grList));
  drawRules();
  if (up && !Object.keys(values).length) readAll(readBtn);

  App.hooks.onPlayers = (list) => {
    dl.innerHTML = '';
    list.forEach((p) => dl.appendChild(h('option', { value: p })));
    if (!who.value && list[0]) who.value = list[0];
  };
}
