'use strict';
/* Opzioni del server (server.properties) in stile pannello Aternos, con applicazione live dove possibile. */

function mcToggle(on, onChange, { disabled } = {}) {
  const el = h('.mc-toggle' + (on ? '.on' : '') + (disabled ? '.disabled' : ''), { role: 'switch', tabindex: 0 }, h('.knob'));
  const setIcon = () => { el.firstChild.innerHTML = ''; el.firstChild.appendChild(icon(el.classList.contains('on') ? 'check' : 'x')); };
  setIcon();
  const toggle = () => { if (disabled) return; el.classList.toggle('on'); setIcon(); onChange(el.classList.contains('on')); };
  el.addEventListener('click', toggle);
  el.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
  return el;
}

function numInput(value, { min, max, ic, onChange }) {
  const input = h('input', { type: 'number', value, min, max });
  const clamp = (v) => { let n = Number(v); if (Number.isNaN(n)) n = Number(min) || 0; if (min != null) n = Math.max(min, n); if (max != null) n = Math.min(max, n); return n; };
  const set = (v) => { input.value = clamp(v); onChange(String(input.value)); };
  input.addEventListener('change', () => set(input.value));
  return h('.num', ic ? h('.ico', icon(ic)) : null, input,
    h('.steps', h('button', { type: 'button', onclick: () => set(Number(input.value) + 1) }, '+'), h('button', { type: 'button', onclick: () => set(Number(input.value) - 1) }, '−')));
}

function motdEditor(value, onChange) {
  const input = h('input.ptext', { value: value || '', placeholder: 'A Minecraft Server', style: { flex: 'none', width: '100%' } });
  const preview = h('.motd-preview');
  const draw = () => { preview.innerHTML = ''; preview.appendChild(mcText(input.value || 'A Minecraft Server')); };
  const insert = (code) => {
    const st = input.selectionStart ?? input.value.length;
    input.value = input.value.slice(0, st) + '§' + code + input.value.slice(input.selectionEnd ?? st);
    input.focus();
    input.setSelectionRange(st + 2, st + 2);
    draw(); onChange(input.value);
  };
  input.addEventListener('input', () => { draw(); onChange(input.value); });
  draw();
  const colors = '0123456789abcdef'.split('');
  const palette = h('.color-row',
    colors.map((c) => h('button', { type: 'button', title: '§' + c, class: 'mc-' + c, style: { background: 'currentColor' }, onclick: () => insert(c) })),
    [['l', 'B'], ['o', 'I'], ['n', 'U'], ['m', 'S'], ['k', '?'], ['r', '↺']].map(([c, l]) => h('button', { type: 'button', title: '§' + c, style: { background: 'var(--ink-4)', color: 'var(--paper)' }, onclick: () => insert(c) }, l)),
    h('button', { type: 'button', title: 'A capo (seconda riga)', style: { background: 'var(--ink-4)', color: 'var(--paper)', width: 'auto', padding: '0 6px' }, onclick: () => { input.value += '\\n'; draw(); onChange(input.value); } }, '↵'));
  return h('.col', { style: { flex: 2, gap: '6px', minWidth: 0 } }, input, palette, preview);
}

function renderOptions(body, s) {
  const running = isUp(s);
  let props = {};
  let pending = {};
  let cat = App.optCat || 'all';
  let search = '';
  const grid = h('.prop-grid');
  const extraGrid = h('.prop-grid');
  const saveBar = h('.save-bar.hidden');
  const searchInput = h('input.input', { placeholder: 'Cerca un\'opzione…', style: { maxWidth: '260px' } });

  const chips = h('.cat-chips', PROP_CATS.map((c) => h('.chip' + (c.id === cat ? '.active' : ''), { onclick: (e) => { cat = c.id; App.optCat = cat; chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === e.target)); draw(); } }, c.label)));

  const card = (def, value) => {
    const changed = Object.prototype.hasOwnProperty.call(pending, def.key);
    const cur = changed ? pending[def.key] : value;
    const keyLine = h('span', `${def.key}=${def.type === 'password' && cur ? '••••' : cur ?? ''}`);
    const set = (v) => {
      if (String(v) === String(props[def.key] ?? '')) delete pending[def.key]; else pending[def.key] = String(v);
      keyLine.textContent = `${def.key}=${def.type === 'password' && v ? '••••' : v}`;
      el.classList.toggle('changed', Object.prototype.hasOwnProperty.call(pending, def.key));
      updateBar();
    };
    let control;
    if (def.type === 'bool') {
      const on = String(cur) === 'true';
      control = mcToggle(def.invert ? !on : on, (v) => set(String(def.invert ? !v : v)));
    } else if (def.type === 'number') control = numInput(cur ?? '', { min: def.min, max: def.max, ic: def.icon, onChange: set });
    else if (def.type === 'select') {
      control = h('select.input.mc-select', def.options.map(([v, l]) => h('option', { value: v, selected: String(cur) === v }, l)));
      if (cur && !def.options.some(([v]) => v === String(cur))) control.appendChild(h('option', { value: cur, selected: true }, cur));
      control.addEventListener('change', () => set(control.value));
    } else if (def.type === 'motd') control = motdEditor(cur, set);
    else {
      control = h('input.ptext', { value: cur ?? '', placeholder: def.placeholder || '', type: def.type === 'password' ? 'password' : 'text' });
      control.addEventListener('input', () => set(control.value));
    }
    const badge = running ? (def.live ? h('span.live', '● si applica subito') : h('span.restart', '↻ dopo il riavvio')) : null;
    const el = h('.prop-card' + (def.wide || def.type === 'motd' ? '.wide' : '') + (changed ? '.changed' : ''),
      h('.prop-main', h('.plabel', def.label, def.help ? h('span.help', { title: def.help }, '?') : null), control),
      h('.prop-key', keyLine, badge));
    return el;
  };

  const draw = () => {
    grid.innerHTML = '';
    extraGrid.innerHTML = '';
    const q = search.toLowerCase();
    const match = (def) => (cat === 'all' || def.cat === cat) && (!q || def.label.toLowerCase().includes(q) || def.key.includes(q));
    const defs = PROPS.filter((d) => (!d.ifPresent || d.key in props) && match(d));
    defs.forEach((d) => grid.appendChild(card(d, props[d.key] ?? (d.type === 'bool' ? 'false' : ''))));
    if (!defs.length) grid.appendChild(h('.muted', 'Nessuna opzione corrisponde.'));
    const known = new Set(PROPS.map((p) => p.key).concat(HIDDEN_PROPS));
    const extra = Object.keys(props).filter((k) => !known.has(k) && (!q || k.includes(q))).sort();
    extra.forEach((k) => extraGrid.appendChild(card({ key: k, label: k, type: 'text' }, props[k])));
    extraSection.classList.toggle('hidden', !extra.length || (cat !== 'all' && cat !== 'net'));
  };

  const updateBar = () => {
    const n = Object.keys(pending).length;
    saveBar.classList.toggle('hidden', !n);
    saveBar.innerHTML = '';
    if (!n) return;
    const liveDefs = PROPS.filter((d) => d.live && d.key in pending);
    const needsRestart = Object.keys(pending).some((k) => !PROPS.find((d) => d.key === k && d.live));
    saveBar.append(...[
      h('strong', `${n} ${n === 1 ? 'modifica' : 'modifiche'} non salvate`),
      running && needsRestart ? h('span.small', { style: { color: 'var(--yellow)' } }, 'Alcune richiedono il riavvio del server.') : null,
      h('span.grow'),
      btn('Annulla', { cls: 'sm', onclick: () => { pending = {}; draw(); updateBar(); } }),
      running && needsRestart ? btn('Salva e riavvia', { cls: 'sm blue', icon: 'restart', onclick: () => save(true) }) : null,
      btn(running && liveDefs.length ? 'Salva e applica' : 'Salva', { cls: 'sm primary', icon: 'check', onclick: () => save(false) }),
    ].filter(Boolean));
  };

  const save = async (restart) => {
    const changes = Object.assign({}, pending);
    const r = await run(() => api('props:set', s.id, changes));
    if (!r) return;
    props = r;
    App.props.set(s.id, r);
    pending = {};
    if (isUp(currentServer())) {
      for (const d of PROPS.filter((x) => x.live && x.key in changes)) {
        await run(() => api('servers:send', s.id, d.live(changes[d.key])));
      }
    }
    if (restart) { await run(() => api('servers:restart', s.id)); toast('Salvato, riavvio in corso…', 'ok'); } else toast('Opzioni salvate', 'ok');
    if ('server-port' in changes) await refreshServers();
    draw(); updateBar();
    if ('motd' in changes) renderMain();
  };

  searchInput.addEventListener('input', debounce(() => { search = searchInput.value; draw(); }, 150));

  const extraSection = h('.props-panel.hidden', h('.props-panel-title', icon('fileCode'), 'Altre proprietà', h('span.small.muted', { style: { fontWeight: 400, fontSize: '13px' } }, 'presenti nel file ma senza un controllo dedicato')), extraGrid);
  body.appendChild(h('.row', { style: { marginBottom: '6px' } }, chips, h('span.grow'), searchInput));
  if (running) body.appendChild(h('.info-note', icon('info'), h('div', 'Il server è acceso: difficoltà, modalità predefinita e whitelist si applicano subito; le altre opzioni dopo il riavvio. Per game rule, meteo, orario e modalità dei singoli giocatori usa ', h('a', { onclick: () => { App.tab = 'controls'; renderMain(); } }, 'Controlli rapidi'), '.')));
  body.appendChild(h('.props-panel',
    h('.props-panel-title', icon('fileCode'), 'server.properties', h('.act',
      btn('Apri file', { cls: 'sm', icon: 'external', onclick: () => run(() => api('servers:openFolder', s.id, '.')) }),
      btn('Ricarica', { cls: 'sm', icon: 'refresh', onclick: () => load() }))),
    grid));
  body.appendChild(extraSection);
  body.appendChild(saveBar);

  const load = async () => {
    props = await run(() => api('props:get', s.id)) || {};
    App.props.set(s.id, props);
    pending = {};
    draw(); updateBar();
  };
  load();
}
