'use strict';
/* Giocatori: online, whitelist, operatori, ban. Funziona sia a server acceso (comandi) sia spento (file JSON). */

function renderPlayers(body, s) {
  const up = serverStatus(s) === 'running';
  const props = App.props.get(s.id) || {};
  let lists = { whitelist: [], ops: [], banned: [], bannedIps: [], known: [] };

  const onlineBox = h('.list');
  const drawOnline = (players) => {
    onlineBox.innerHTML = '';
    if (!players.length) { onlineBox.appendChild(h('.empty', icon('users'), h('.t', 'Nessun giocatore online'))); return; }
    players.forEach((p) => onlineBox.appendChild(playerRow(s, p)));
  };
  drawOnline((s.state && s.state.players) || []);

  const avatar = (name) => h('.li-icon', h('img', { src: `https://mc-heads.net/avatar/${encodeURIComponent(name)}/40`, onerror: (e) => e.target.replaceWith(icon('users')) }));

  const section = (key, title, desc, ic, addLabel, extraHead) => {
    const box = h('.list');
    const draw = () => {
      box.innerHTML = '';
      const arr = lists[key] || [];
      if (!arr.length) box.appendChild(h('.empty', { style: { padding: '20px' } }, 'Vuoto'));
      for (const e of arr) {
        const name = key === 'bannedIps' ? e.ip : e.name;
        box.appendChild(h('.list-item',
          key === 'bannedIps' ? h('.li-icon', icon('globe')) : avatar(name),
          h('.li-main', h('.li-title', name, key === 'ops' && e.level ? h('span.tag', 'livello ' + e.level) : null),
            h('.li-sub', key.startsWith('banned') ? `${e.reason || ''} · da ${e.source || '?'} · ${e.created || ''}` : (e.uuid || ''))),
          btn('', { cls: 'sm ghost icon', icon: 'trash', title: 'Rimuovi', onclick: async () => {
            const r = await run(() => api('players:edit', s.id, key, 'remove', name));
            if (r) { lists = r; redrawAll(); }
          } })));
      }
    };
    const add = async () => {
      const name = await promptBox(addLabel, { label: key === 'bannedIps' ? 'Indirizzo IP' : 'Nome del giocatore', hint: !up && key !== 'bannedIps' ? (props['online-mode'] === 'false' ? 'Server craccato: l\'UUID verrà calcolato in modalità offline.' : 'L\'UUID verrà cercato sui server Mojang.') : '' });
      if (!name) return;
      const r = await run(() => api('players:edit', s.id, key, 'add', name), 'Aggiunto');
      if (r) { lists = r; redrawAll(); }
    };
    const card = h('.card', h('.card-head', icon(ic), h('h2', title), h('.act', extraHead || null, btn('Aggiungi', { cls: 'sm', icon: 'plus', onclick: add }))), h('.small.muted', { style: { marginBottom: '8px' } }, desc), box);
    card.draw = draw;
    return card;
  };

  const wlToggle = mcToggle(props['white-list'] === 'true', async (v) => {
    const map = await run(() => api('props:set', s.id, { 'white-list': String(v) }));
    if (map) App.props.set(s.id, map);
    if (isUp(currentServer())) await run(() => api('servers:send', s.id, `whitelist ${v ? 'on' : 'off'}`));
    toast(v ? 'Whitelist attivata: possono entrare solo i giocatori in lista' : 'Whitelist disattivata', 'ok');
  });

  const wl = section('whitelist', 'Whitelist', 'Se attiva, solo questi giocatori possono entrare.', 'shield', 'Aggiungi alla whitelist', h('.row.small', 'Attiva', wlToggle));
  const ops = section('ops', 'Operatori', 'Possono usare tutti i comandi in gioco.', 'crown', 'Rendi operatore');
  const bans = section('banned', 'Giocatori bannati', 'Non possono entrare nel server.', 'ban', 'Banna giocatore');
  const ipbans = section('bannedIps', 'IP bannati', 'Blocca un indirizzo IP.', 'globe', 'Banna IP');
  const knownBox = h('.row.wrap');
  const redrawAll = () => {
    [wl, ops, bans, ipbans].forEach((c) => c.draw());
    knownBox.innerHTML = '';
    const known = (lists.known || []).slice(0, 40);
    if (!known.length) knownBox.appendChild(h('.muted.small', 'I giocatori che entrano almeno una volta compaiono qui.'));
    known.forEach((n) => knownBox.appendChild(h('.tag', { style: { cursor: 'pointer', padding: '5px 10px' }, title: 'Aggiungi alla whitelist', onclick: async () => {
      const r = await run(() => api('players:edit', s.id, 'whitelist', 'add', n), `${n} aggiunto alla whitelist`);
      if (r) { lists = r; redrawAll(); }
    } }, '+ ' + n)));
  };

  body.appendChild(h('.card', h('.card-head', icon('users'), h('h2', 'Online ora')), onlineBox));
  body.appendChild(h('.spacer'));
  body.appendChild(h('.grid-2', wl, ops));
  body.appendChild(h('.spacer'));
  body.appendChild(h('.grid-2', bans, ipbans));
  body.appendChild(h('.card', { style: { marginTop: '14px' } }, h('.card-head', h('h2', 'Giocatori visti di recente')), knownBox));

  const load = async () => { const r = await run(() => api('players:lists', s.id)); if (r) { lists = r; redrawAll(); } };
  load();
  App.hooks.onPlayers = (list) => { drawOnline(list); };
}
