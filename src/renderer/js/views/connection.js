'use strict';
/* Connessione amici senza port forwarding: tunnel playit.gg integrato + alternative VPN/LAN. */

function renderConnection(main) {
  const page = h('.page', h('h1.page-title.green', 'Connessione amici'));
  page.appendChild(h('p.muted', { style: { marginTop: '-8px', maxWidth: '820px' } },
    'Il tuo router blocca le connessioni in entrata, per questo di solito serve il port forwarding. Con un tunnel il PC apre lui la connessione verso un server esterno, che inoltra i giocatori al tuo Minecraft: nessuna configurazione del router, il tuo IP resta nascosto.'));

  const statusPill = h('span.status-pill');
  const claimBox = h('div');
  const logBox = h('.log-box');
  const detected = h('.row.wrap');
  const addr = h('input.input', { placeholder: 'es. nome-casuale.gl.joinmc.link', style: { fontFamily: 'var(--mono)' } });
  const startBtn = btn('Avvia tunnel', { cls: 'primary', icon: 'play' });
  const stopBtn = btn('Ferma', { cls: 'danger', icon: 'stop' });
  const ports = App.servers.map((s) => `${s.name}: 127.0.0.1:${s.port}`).join(' · ') || 'crea prima un server';

  const setStatus = (st) => {
    statusPill.className = 'status-pill ' + (st === 'running' ? 'running' : st === 'starting' ? 'starting' : st === 'error' ? 'error' : '');
    statusPill.textContent = { running: 'Attivo', starting: 'Avvio…', error: 'Da configurare', stopped: 'Spento' }[st] || st;
    startBtn.classList.toggle('hidden', st === 'running' || st === 'starting');
    stopBtn.classList.toggle('hidden', !(st === 'running' || st === 'starting'));
  };
  const showClaim = (url) => {
    claimBox.innerHTML = '';
    if (!url) return;
    claimBox.appendChild(h('.info-note', icon('link'), h('div.grow', h('strong', 'Collega l\'agente al tuo account playit.gg'), h('div.small', 'Apri il link, accedi o registrati gratis e conferma: il tunnel verrà attivato.')),
      btn('Apri link', { cls: 'sm blue', icon: 'external', onclick: () => api('shell:openExternal', url) })));
  };
  const addDetected = (a) => {
    if ([...detected.children].some((c) => c.dataset.a === a)) return;
    detected.appendChild(h('span.tag.green', { dataset: { a }, style: { cursor: 'pointer', padding: '5px 10px' }, title: 'Usa questo indirizzo', onclick: async () => { addr.value = a; await saveAddr(); } }, '✓ ' + a));
  };
  const saveAddr = async () => {
    await run(() => api('tunnel:setAddress', addr.value.trim()), 'Indirizzo salvato: lo trovi in ogni server');
    App.info.config.playit = Object.assign({}, App.info.config.playit, { publicAddress: addr.value.trim() });
  };

  startBtn.onclick = () => run(() => api('tunnel:start'));
  stopBtn.onclick = () => run(() => api('tunnel:stop'));

  page.appendChild(h('.card',
    h('.card-head', icon('globe'), h('h2', 'playit.gg'), h('span.tag.green', 'consigliato · gratuito'), statusPill,
      h('.act', startBtn, stopBtn,
        btn('Apri finestra playit', { icon: 'external', title: 'Apre l\'agente in una finestra separata: utile per la prima configurazione', onclick: () => run(() => api('tunnel:openConsole')) }),
        btn('Sito', { cls: 'ghost', icon: 'external', onclick: () => api('shell:openExternal', 'https://playit.gg/account/tunnels') }))),
    claimBox,
    h('.grid-2', { style: { alignItems: 'start' } },
      h('div',
        h('h3', 'Configurazione (una volta sola)'),
        h('.how-steps',
          h('div', h('div', h('strong', 'Avvia il tunnel'), h('.small.muted', 'L\'agente ufficiale viene scaricato in automatico. Se non compare il link al punto 2, usa "Apri finestra playit".'))),
          h('div', h('div', h('strong', 'Collega il tuo account'), h('.small.muted', 'Apri il link di registrazione (claim) e accedi su playit.gg.'))),
          h('div', h('div', h('strong', 'Crea un tunnel "Minecraft Java"'), h('.small.muted', 'Sul sito, in Tunnels → Add Tunnel, indirizzo locale e porta del server: ', h('code', ports)))),
          h('div', h('div', h('strong', 'Copia l\'indirizzo qui a destra'), h('.small.muted', 'È quello che darai ai tuoi amici. Rimane lo stesso per sempre.'))))),
      h('div',
        h('h3', 'Indirizzo pubblico'),
        h('.row', addr, btn('Salva', { cls: 'primary', onclick: saveAddr })),
        h('.small.muted', { style: { margin: '6px 0 10px' } }, 'Indirizzi rilevati dall\'agente (clicca per usarli):'),
        detected,
        h('.spacer'),
        h('h3', 'Registro dell\'agente'),
        logBox))));

  // Alternative
  const netBox = h('div');
  const KIND = { tailscale: ['Tailscale', 'green'], zerotier: ['ZeroTier', 'green'], radmin: ['Radmin VPN', 'green'], hamachi: ['Hamachi', 'green'], lan: ['Rete di casa', 'blue'], virtual: ['Adattatore virtuale', ''], other: ['Altro', ''] };
  const drawNet = (list) => {
    netBox.innerHTML = '';
    if (!list.length) netBox.appendChild(h('.muted', 'Nessuna rete trovata.'));
    list.forEach((n) => {
      const [label, color] = KIND[n.kind] || KIND.other;
      netBox.appendChild(h('.net-row', h('span.tag' + (color ? '.' + color : ''), label), h('code.selectable', n.ip), h('span.muted.small.grow', n.name),
        btn('', { cls: 'sm ghost icon', icon: 'copy', onclick: () => copyText(n.ip) })));
    });
  };
  page.appendChild(h('.grid-2', { style: { marginTop: '14px', alignItems: 'start' } },
    h('.card',
      h('.card-head', icon('wifi'), h('h2', 'Alternativa: LAN virtuale')),
      h('p.small.muted', { style: { marginTop: 0 } }, 'Con Tailscale, ZeroTier o Radmin VPN tu e i tuoi amici installate lo stesso programma ed entrate nella stessa rete privata: si connettono all\'IP virtuale del tuo PC. Latenza ottima, ma ogni giocatore deve installare il programma.'),
      h('.row.wrap',
        btn('Tailscale', { cls: 'sm', icon: 'external', onclick: () => api('shell:openExternal', 'https://tailscale.com/download/windows') }),
        btn('ZeroTier', { cls: 'sm', icon: 'external', onclick: () => api('shell:openExternal', 'https://www.zerotier.com/download/') }),
        btn('Radmin VPN', { cls: 'sm', icon: 'external', onclick: () => api('shell:openExternal', 'https://www.radmin-vpn.com/') }))),
    h('.card',
      h('.card-head', icon('cpu'), h('h2', 'Indirizzi di questo PC'), h('.act', btn('', { cls: 'sm icon', icon: 'refresh', onclick: async () => { App.net = await api('net:info'); drawNet(App.net); } }))),
      h('p.small.muted', { style: { marginTop: 0 } }, 'Amici sulla stessa rete Wi-Fi usano l\'IP "Rete di casa". Se il server non usa la porta 25565 aggiungi ":porta".'),
      netBox)));
  main.appendChild(page);

  drawNet(App.net || []);
  api('tunnel:info').then((info) => {
    setStatus(info.status);
    addr.value = info.publicAddress || '';
    showClaim(info.claimUrl);
    info.addresses.forEach(addDetected);
    logBox.textContent = info.log.join('\n') || (info.installed ? 'Agente installato. Premi "Avvia tunnel".' : 'Agente non ancora scaricato: premi "Avvia tunnel".');
    logBox.scrollTop = logBox.scrollHeight;
  }).catch(errToast);

  App.hooks.tunnelLog = (l) => { if (logBox.textContent.startsWith('Agente')) logBox.textContent = ''; logBox.textContent += (logBox.textContent ? '\n' : '') + l; logBox.scrollTop = logBox.scrollHeight; };
  App.hooks.tunnelStatus = setStatus;
  App.hooks.tunnelClaim = showClaim;
  App.hooks.tunnelAddress = (a) => { addDetected(a); if (!addr.value) addr.value = a; };
}
