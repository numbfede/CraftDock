'use strict';
/* Connessione amici senza port forwarding: tunnel playit.gg integrato (collegamento e tunnel automatici) + alternative VPN/LAN. */

const CLAIM_TEXT = {
  'waiting-visit': t('Si è aperta una pagina di playit.gg nel browser: accedi o crea un account gratuito.'),
  'waiting-approval': t('Ora conferma nel browser per autorizzare CraftDock.'),
  exchanging: t('Approvato! Completo il collegamento…'),
  done: t('Account collegato.'),
};

function renderConnection(main) {
  const page = h('.page', h('header.page-head', h('span.eyebrow', h('span.eyebrow-dot'), t('Senza port forwarding')), h('h1.page-title', t('Connessione amici')), h('p.page-lede', t('Un tunnel playit.gg gratuito dà a ogni server un indirizzo pubblico. Il router non si tocca.'))));
  page.appendChild(h('p.muted', { style: { marginTop: '-8px', maxWidth: '820px' } },
    t('Il router di casa blocca le connessioni in entrata, per questo di solito serve il port forwarding. Con il tunnel di playit.gg è il tuo PC a collegarsi verso l\'esterno e gli amici entrano da lì: niente configurazione del router, il tuo IP resta nascosto.')));

  let info = null;
  const statusPill = h('span.status-pill');
  const body = h('div');
  const logBox = h('.log-box');
  const actions = h('.act');

  const setStatus = (st) => {
    const map = { running: ['running', t('Attivo')], starting: ['starting', t('Avvio…')], linking: ['starting', t('Collegamento…')], error: ['error', t('Errore')], stopped: ['', t('Spento')] };
    const [cls, label] = map[st] || ['', st];
    statusPill.className = 'status-pill ' + cls;
    statusPill.textContent = label;
  };

  const tunnelFor = (port) => ((info && info.tunnels) || []).find((x) => x.localPort === Number(port));

  const draw = () => {
    if (!info) return;
    setStatus(info.status);
    actions.innerHTML = '';
    body.innerHTML = '';
    const up = info.status === 'running' || info.status === 'starting';

    // --- non collegato / collegamento in corso ---
    if (!info.linked) {
      const claim = info.claim;
      if (claim && claim.state !== 'error' && claim.state !== 'done') {
        body.appendChild(h('.info-note', icon('link'), h('div.grow',
          h('strong', CLAIM_TEXT[claim.state] || t('Collegamento in corso…')),
          h('div.small', { style: { marginTop: '4px' } }, t('Se la pagina non si è aperta usa il pulsante qui accanto. Il collegamento si completa da solo appena confermi.'))),
          h('.col', { style: { gap: '6px' } },
            btn(t('Apri il link'), { cls: 'sm blue', icon: 'external', onclick: () => api('shell:openExternal', claim.url) }),
            btn(t('Annulla'), { cls: 'sm ghost', onclick: () => run(() => api('tunnel:cancelLink')) }))));
      } else {
        if (claim && claim.state === 'error') body.appendChild(h('.locked-note', icon('alert'), claim.error || t('Collegamento non riuscito.')));
        body.appendChild(h('.how-steps',
          h('div', h('div', h('strong', t('Collega playit.gg')), h('.small.muted', t('Si apre il browser: accedi o crea un account gratuito e conferma. Serve solo la prima volta.')))),
          h('div', h('div', h('strong', t('CraftDock crea il tunnel')), h('.small.muted', t('Per ogni server viene creato in automatico un tunnel Minecraft Java verso la sua porta.')))),
          h('div', h('div', h('strong', t('Condividi l\'indirizzo')), h('.small.muted', t('Ricevi un indirizzo fisso (tipo nome.gl.joinmc.link) che compare in cima a ogni server, pronto da copiare.'))))));
        actions.appendChild(btn(t('Collega playit.gg'), { cls: 'primary', icon: 'link', onclick: () => run(() => api('tunnel:start')) }));
      }
      return;
    }

    // --- collegato ---
    actions.append(
      up ? btn(t('Ferma'), { cls: 'danger', icon: 'stop', onclick: () => run(() => api('tunnel:stop')) })
        : btn(t('Avvia tunnel'), { cls: 'primary', icon: 'play', onclick: () => run(() => api('tunnel:start')) }),
      btn(t('Gestisci su playit.gg'), { cls: 'ghost', icon: 'external', onclick: () => api('shell:openExternal', 'https://playit.gg/account/tunnels') }));

    (info.notices || []).forEach((n) => body.appendChild(h(n.priority === 'Low' ? '.info-note' : '.locked-note', icon('alert'),
      h('div.grow', n.message), n.link ? btn(t('Risolvi'), { cls: 'sm', icon: 'external', onclick: () => api('shell:openExternal', n.link) }) : null)));

    if (!up) body.appendChild(h('.info-note', icon('info'), t('Account collegato. Avvia il tunnel per rendere raggiungibili i tuoi server.')));

    const list = h('.list');
    if (!App.servers.length) list.appendChild(h('.empty', { style: { padding: '20px' } }, t('Crea prima un server.')));
    for (const s of App.servers) {
      const tun = tunnelFor(s.port);
      const addr = (tun && tun.address) || '';
      list.appendChild(h('.list-item',
        h('.li-icon', typeGlyph(s.type)),
        h('.li-main',
          h('.li-title', s.name, h('span.tag', t('porta {port}', { port: s.port })), tun && tun.disabled ? h('span.tag.red', tun.disabled) : null),
          h('.li-sub', addr ? h('code.selectable', addr) : (tun ? t('Indirizzo in assegnazione…') : t('Nessun tunnel per questo server')))),
        addr ? btn('', { cls: 'sm ghost icon', icon: 'copy', title: t('Copia'), onclick: () => copyText(addr) }) : null,
        !t ? btn(t('Crea indirizzo'), { cls: 'sm blue', icon: 'globe', onclick: async () => {
          if (await run(() => api('tunnel:ensureForServer', s.id), t('Indirizzo pubblico pronto'))) { await refreshServers(); load(); }
        } }) : null));
    }
    (info.pending || []).forEach((p) => list.appendChild(h('.list-item', h('.li-icon', icon('clock')), h('.li-main', h('.li-title', p.name), h('.li-sub', p.status)))));
    body.appendChild(h('h3', { style: { margin: '14px 0 8px' } }, t('I tuoi server')));
    body.appendChild(h('.card', { style: { padding: 0 } }, list));

    const others = (info.tunnels || []).filter((x) => !App.servers.some((s) => Number(s.port) === x.localPort));
    if (others.length) {
      body.appendChild(h('h3', { style: { margin: '14px 0 8px' } }, t('Altri tunnel dell\'agente')));
      const ol = h('.list');
      others.forEach((x) => ol.appendChild(h('.list-item', h('.li-icon', icon('globe')), h('.li-main', h('.li-title', x.name || x.typeLabel), h('.li-sub', `${x.address || '…'} → ${x.localIp}:${x.localPort || '?'}`)),
        x.address ? btn('', { cls: 'sm ghost icon', icon: 'copy', onclick: () => copyText(x.address) }) : null)));
      body.appendChild(h('.card', { style: { padding: 0 } }, ol));
    }

    body.appendChild(h('.row', { style: { marginTop: '12px' } },
      btn(t('Aggiorna'), { cls: 'sm', icon: 'refresh', onclick: () => run(() => api('tunnel:refresh')).then(load) }),
      h('span.grow'),
      btn(t('Scollega account'), { cls: 'sm ghost', icon: 'x', onclick: async () => {
        if (await confirmBox(t('Scollega playit.gg'), t('CraftDock dimentica la chiave dell\'agente. I tunnel restano sul tuo account playit.gg e potrai ricollegarti quando vuoi.'), { okLabel: t('Scollega'), danger: true })) { await run(() => api('tunnel:unlink')); load(); }
      } })));
  };

  const manual = h('input.input', { placeholder: t('es. nome-casuale.gl.joinmc.link'), style: { fontFamily: 'var(--mono)' } });
  const saveManual = async () => {
    await run(() => api('tunnel:setAddress', manual.value.trim()), t('Indirizzo salvato'));
    App.info.config.playit = Object.assign({}, App.info.config.playit, { publicAddress: manual.value.trim() });
  };

  page.appendChild(h('.card',
    h('.card-head', icon('globe'), h('h2', 'playit.gg'), h('span.tag.green', t('consigliato · gratuito')), statusPill, actions),
    body,
    h('details', { style: { marginTop: '16px' } },
      h('summary.small.muted', { style: { cursor: 'pointer' } }, t('Registro dell\'agente e opzioni avanzate')),
      h('.spacer'),
      logBox,
      h('.spacer'),
      h('.field', h('label', t('Indirizzo pubblico manuale (se usi un tunnel creato a mano)')), h('.row', manual, btn(t('Salva'), { cls: 'sm', onclick: saveManual }))))));

  // Alternative
  const netBox = h('div');
  const KIND = { tailscale: ['Tailscale', 'green'], zerotier: ['ZeroTier', 'green'], radmin: ['Radmin VPN', 'green'], hamachi: ['Hamachi', 'green'], lan: [t('Rete di casa'), 'blue'], virtual: [t('Adattatore virtuale'), ''], other: [t('Altro'), ''] };
  const drawNet = (list) => {
    netBox.innerHTML = '';
    if (!list.length) netBox.appendChild(h('.muted', t('Nessuna rete trovata.')));
    list.forEach((n) => {
      const [label, color] = KIND[n.kind] || KIND.other;
      netBox.appendChild(h('.net-row', h('span.tag' + (color ? '.' + color : ''), label), h('code.selectable', n.ip), h('span.muted.small.grow', n.name),
        btn('', { cls: 'sm ghost icon', icon: 'copy', onclick: () => copyText(n.ip) })));
    });
  };
  page.appendChild(h('.grid-2', { style: { marginTop: '14px', alignItems: 'start' } },
    h('.card',
      h('.card-head', icon('wifi'), h('h2', t('Alternativa: LAN virtuale'))),
      h('p.small.muted', { style: { marginTop: 0 } }, t('Con Tailscale, ZeroTier o Radmin VPN tu e i tuoi amici installate lo stesso programma ed entrate nella stessa rete privata: si connettono all\'IP virtuale del tuo PC.')),
      h('.row.wrap',
        btn('Tailscale', { cls: 'sm', icon: 'external', onclick: () => api('shell:openExternal', 'https://tailscale.com/download/windows') }),
        btn('ZeroTier', { cls: 'sm', icon: 'external', onclick: () => api('shell:openExternal', 'https://www.zerotier.com/download/') }),
        btn('Radmin VPN', { cls: 'sm', icon: 'external', onclick: () => api('shell:openExternal', 'https://www.radmin-vpn.com/') }))),
    h('.card',
      h('.card-head', icon('cpu'), h('h2', t('Indirizzi di questo PC')), h('.act', btn('', { cls: 'sm icon', icon: 'refresh', onclick: async () => { App.net = await api('net:info'); drawNet(App.net); } }))),
      h('p.small.muted', { style: { marginTop: 0 } }, t('Amici sulla stessa rete Wi-Fi usano l\'IP "Rete di casa". Se il server non usa la porta 25565 aggiungi ":porta".')),
      netBox)));
  main.appendChild(page);

  drawNet(App.net || []);
  const load = async () => {
    const i = await api('tunnel:info').catch(errToast);
    if (!i) return;
    info = i;
    manual.value = i.publicAddress || '';
    logBox.textContent = i.log.join('\n') || t('Nessun messaggio.');
    logBox.scrollTop = logBox.scrollHeight;
    draw();
  };
  load();

  App.hooks.tunnelLog = (l) => { if (logBox.textContent === 'Nessun messaggio.') logBox.textContent = ''; logBox.textContent += (logBox.textContent ? '\n' : '') + l; logBox.scrollTop = logBox.scrollHeight; };
  App.hooks.tunnelStatus = (st) => { if (info) { info.status = st; if (st === 'running' || st === 'starting') info.linked = true; draw(); } };
  App.hooks.tunnelClaim = (claim) => { if (info) { info.claim = claim; if (claim && claim.state === 'done') info.linked = true; draw(); } };
  App.hooks.tunnelTunnels = (st) => { if (info) { Object.assign(info, st); info.linked = true; draw(); } };
}
