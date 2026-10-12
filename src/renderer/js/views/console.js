'use strict';
/* Console: output in tempo reale con colori, ricerca, comandi rapidi, cronologia e autocompletamento. */

const cmdHistory = new Map();

function classifyLine(e) {
  if (e.source === 'input') return 'input';
  if (e.source === 'app') return 'app';
  if (e.source === 'install') return 'install';
  const l = e.line;
  if (/\b(ERROR|FATAL|SEVERE)\b|Exception|^\s+at /.test(l)) return 'error';
  if (/\bWARN(ING)?\b/.test(l)) return 'warn';
  if (/joined the game|left the game/.test(l)) return 'join';
  if (/: <[^>]+> |\[Server\]|\[Not Secure\]/.test(l)) return 'chat';
  return '';
}

function lineEl(e) {
  const cls = classifyLine(e);
  const el = h('div.l' + (cls ? '.' + cls : ''));
  if (e.source !== 'server') el.appendChild(h('span.ts', new Date(e.t).toLocaleTimeString(LOCALE)));
  el.appendChild(document.createTextNode(e.line));
  return el;
}

function renderConsoleTab(body, s) {
  const up = isUp(s);
  let autoscroll = true;
  let filter = '';
  const out = h('.console-out');
  const filterInput = h('input.input', { placeholder: t('Filtra righe…'), style: { maxWidth: '240px', height: '30px' } });
  const scrollBtn = btn(t('Scorrimento auto'), { cls: 'sm', icon: 'check' });
  scrollBtn.onclick = () => { autoscroll = !autoscroll; scrollBtn.querySelector('span').textContent = autoscroll ? t('Scorrimento auto') : t('In pausa'); if (autoscroll) out.scrollTop = out.scrollHeight; };

  const toolbar = h('.console-toolbar',
    filterInput, h('span.grow'), scrollBtn,
    btn(t('Copia'), { cls: 'sm ghost', icon: 'copy', onclick: () => copyText((App.logs.get(s.id) || []).map((l) => l.line).join('\n'), t('Log copiato')) }),
    btn(t('Condividi log'), { cls: 'sm ghost', icon: 'share', title: t('Carica su mclo.gs (il servizio di Aternos) per chiedere aiuto'), onclick: async () => {
      if (!(await confirmBox(t('Condividi log'), t('Il log verrà caricato su mclo.gs e otterrai un link pubblico da mandare a chi ti aiuta. Gli IP vengono oscurati automaticamente da mclo.gs.'), { okLabel: t('Carica') }))) return;
      const url = await run(() => api('servers:shareLog', s.id));
      if (url) { copyText(url, t('Link copiato: ') + url); api('shell:openExternal', url); }
    } }),
    btn(t('Pulisci'), { cls: 'sm ghost', icon: 'trash', onclick: async () => { await api('servers:clearLog', s.id); App.logs.set(s.id, []); draw(); } }),
    btn(t('Log'), { cls: 'sm ghost', icon: 'folder', onclick: () => run(() => api('servers:openFolder', s.id, 'logs')) }));

  // Input con suggerimenti
  const input = h('input', { placeholder: up ? t('Scrivi un comando (senza /) · Tab per completare, ↑↓ cronologia') : t('Avvia il server per inviare comandi'), disabled: !up, spellcheck: 'false' });
  const suggest = h('.suggest.hidden');
  let sugItems = []; let sugIdx = 0;
  const hist = cmdHistory.get(s.id) || [];
  cmdHistory.set(s.id, hist);
  let histIdx = hist.length;

  const allCommands = () => COMMANDS.concat(MOD_COMMANDS[s.type] || []);
  const updateSuggest = () => {
    const v = input.value;
    sugItems = [];
    if (v) {
      const parts = v.split(' ');
      const players = (currentServer().state.players || []);
      if (/^gamerule \S*$/.test(v)) {
        sugItems = gameRulesFor(s.mcVersion).filter((g) => g.name.toLowerCase().startsWith(parts[1].toLowerCase())).map((g) => [`gamerule ${g.name} `, g.label]);
      } else if (parts.length > 1 && players.length) {
        const prefix = parts.slice(0, -1).join(' ');
        const tpl = allCommands().find(([c]) => c.startsWith(prefix + t(' <giocatore>')) || c.startsWith(prefix + t(' <bersaglio>')) || c.startsWith(prefix + t(' <destinazione>')));
        if (tpl) sugItems = players.filter((p) => p.toLowerCase().startsWith(parts[parts.length - 1].toLowerCase())).map((p) => [`${prefix} ${p} `, t('giocatore online')]);
      }
      if (!sugItems.length) sugItems = allCommands().filter(([c]) => c.startsWith(v) && c !== v).slice(0, 12);
    }
    sugIdx = 0;
    suggest.innerHTML = '';
    if (!sugItems.length) { suggest.classList.add('hidden'); return; }
    sugItems.forEach(([c, d], i) => suggest.appendChild(h('div' + (i === 0 ? '.sel' : ''), { onmousedown: (e) => { e.preventDefault(); applySuggestion(i); } }, c, h('span', d))));
    suggest.classList.remove('hidden');
  };
  const applySuggestion = (i) => {
    const c = sugItems[i][0];
    const cut = c.search(/ [<[]/);
    input.value = cut > -1 ? c.slice(0, cut + 1) : c;
    updateSuggest();
    input.focus();
  };
  const sendCmd = async () => {
    const v = input.value.trim();
    if (!v) return;
    if (hist[hist.length - 1] !== v) hist.push(v);
    if (hist.length > 100) hist.shift();
    histIdx = hist.length;
    input.value = '';
    suggest.classList.add('hidden');
    if (v === 'stop' || v === '/stop') { run(() => api('servers:stop', s.id)); return; }
    await run(() => api('servers:send', s.id, v));
  };
  input.addEventListener('input', updateSuggest);
  input.addEventListener('blur', () => setTimeout(() => suggest.classList.add('hidden'), 100));
  input.addEventListener('keydown', (e) => {
    const open = !suggest.classList.contains('hidden');
    if (e.key === 'Tab') { e.preventDefault(); if (open) applySuggestion(sugIdx); return; }
    if (e.key === 'Enter') { e.preventDefault(); sendCmd(); return; }
    if (e.key === 'Escape') { suggest.classList.add('hidden'); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (open) {
        sugIdx = (sugIdx + (e.key === 'ArrowDown' ? 1 : -1) + sugItems.length) % sugItems.length;
        [...suggest.children].forEach((c, i) => c.classList.toggle('sel', i === sugIdx));
        suggest.children[sugIdx].scrollIntoView({ block: 'nearest' });
      } else if (hist.length) {
        histIdx = Math.max(0, Math.min(hist.length, histIdx + (e.key === 'ArrowUp' ? -1 : 1)));
        input.value = hist[histIdx] || '';
      }
    }
  });

  const quick = [['list', t('Giocatori')], ['save-all', t('Salva')], ['time set day', t('Giorno')], ['time set night', t('Notte')], ['weather clear', t('Sereno')], ['tick query', t('TPS')], ['reload', t('Ricarica datapack')]];
  if (App.info.types[s.type].plugins) quick.splice(5, 1, ['tps', t('TPS')]);
  body.appendChild(h('.quick-cmds', quick.map(([c, l]) => btn(l, { cls: 'xs', disabled: !up, title: c, onclick: () => run(() => api('servers:send', s.id, c)) })),
    btn(t('Messaggio a tutti…'), { cls: 'xs', icon: 'send', disabled: !up, onclick: async () => { const msg = await promptBox(t('Messaggio a tutti i giocatori'), { placeholder: t('Ciao a tutti!') }); if (msg) run(() => api('servers:send', s.id, 'say ' + msg)); } })));
  body.appendChild(h('.console-wrap', toolbar, out, h('.console-in', suggest, h('span.prompt', '>'), input, btn(t('Invia'), { cls: 'sm blue', icon: 'send', disabled: !up, onclick: sendCmd }))));

  const matches = (e) => !filter || e.line.toLowerCase().includes(filter);
  const draw = () => {
    out.innerHTML = '';
    const lines = (App.logs.get(s.id) || []).filter(matches).slice(-1500);
    const frag = document.createDocumentFragment();
    lines.forEach((e) => frag.appendChild(lineEl(e)));
    if (!lines.length) frag.appendChild(h('.muted', up ? t('In attesa di output…') : t('Il server è spento. Premi Avvia per vedere qui la console.')));
    out.appendChild(frag);
    out.scrollTop = out.scrollHeight;
  };
  out.addEventListener('scroll', () => {
    const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
    if (!atBottom && autoscroll) { autoscroll = false; scrollBtn.querySelector('span').textContent = t('In pausa'); }
    if (atBottom && !autoscroll) { autoscroll = true; scrollBtn.querySelector('span').textContent = t('Scorrimento auto'); }
  });
  filterInput.addEventListener('input', debounce(() => { filter = filterInput.value.toLowerCase(); draw(); }, 200));
  ensureLogs(s.id).then(draw);
  if (up) setTimeout(() => input.focus(), 50);

  App.hooks.onLog = (entry) => {
    if (!matches(entry)) return;
    if (out.firstChild && out.firstChild.classList.contains('muted')) out.innerHTML = '';
    out.appendChild(lineEl(entry));
    while (out.childNodes.length > 2000) out.removeChild(out.firstChild);
    if (autoscroll) out.scrollTop = out.scrollHeight;
  };
}
