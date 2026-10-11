'use strict';
/* Nucleo dell'interfaccia: stato, chiamate al backend, helper DOM, icone, modali, notifiche. */

const App = {
  info: null,
  servers: [],
  selectedId: null,
  view: 'home', // home | server | connection | settings
  tab: 'overview',
  logs: new Map(),
  props: new Map(),
  versionCache: new Map(),
  listeners: [],
};

const api = (channel, ...args) => window.craftdock.call(channel, ...args);

/** Crea elementi DOM: h('div.cls#id', {attr, onclick}, ...figli) */
function h(sel, attrs, ...children) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { children.unshift(attrs); attrs = {}; }
  const norm = /^[.#]/.test(sel) ? 'div' + sel : sel;
  const [tagPart, ...rest] = norm.split(/(?=[.#])/);
  const el = document.createElement(tagPart || 'div');
  for (const r of rest) {
    if (r[0] === '.') el.classList.add(r.slice(1));
    else if (r[0] === '#') el.id = r.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

// Icone (stile lucide, disegnate inline per funzionare offline)
const ICONS = {
  play: '<polygon points="6 4 20 12 6 20 6 4" fill="currentColor"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>',
  restart: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  skull: '<circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M8 20v2h8v-2"/><path d="M12.5 17l-.5-1-.5 1h1z"/><path d="M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  puzzle: '<path d="M19.44 13.5a2.5 2.5 0 1 0 0-3H18V7a1 1 0 0 0-1-1h-3.5V4.56a2.5 2.5 0 1 0-3 0V6H7a1 1 0 0 0-1 1v3.5H4.56a2.5 2.5 0 1 0 0 3H6V17a1 1 0 0 0 1 1h3.5v1.44a2.5 2.5 0 1 0 3 0V18H17a1 1 0 0 0 1-1v-3.5z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  fileCode: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M10 13l-2 2 2 2M14 13l2 2-2 2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  refresh: '<path d="M21 2v6h-6M3 22v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L21 8M3 16l2.64 2.36A9 9 0 0 0 20.49 15"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  sun: '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
  rain: '<path d="M16 13v8M8 13v8M12 15v8M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>',
  storm: '<path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9"/><path d="m13 11-4 6h6l-4 6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  crown: '<path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zM5 20h14"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/>',
  package: '<path d="m16.5 9.4-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/>',
  cube: '<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  map: '<path d="m1 6 7-4 8 4 7-4v16l-7 4-8-4-7 4z"/><path d="M8 2v16M16 6v16"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  send: '<path d="m22 2-7 20-4-9-9-4 20-7z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
  sword: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  java: '<path d="M8 18c-2 1 0 2 4 2s6-1 4-2M9 15c-2 1 0 2 3 2s5-1 3-2M12 2c3 3-3 4 0 8M15 5c2 2-2 3 0 5"/>',
};

function icon(name, cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('width', '18');
  s.setAttribute('height', '18');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = ICONS[name] || ICONS.info;
  return s;
}

function btn(label, opts = {}) {
  const cls = ['btn', ...(opts.cls || '').split(' ').filter(Boolean)].join('.');
  return h('button.' + cls, { onclick: opts.onclick, disabled: opts.disabled, title: opts.title, type: 'button' }, opts.icon ? icon(opts.icon) : null, label ? h('span', label) : null);
}

// ---------- Notifiche ----------
function toast(msg, type = 'info', ms = 4200) {
  const t = h('.toast.' + type, msg);
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, ms);
}

function errToast(e) {
  console.error(e);
  const t = h('.toast.err', e.message || String(e));
  if (e.url) t.appendChild(h('div', h('a', { onclick: () => api('shell:openExternal', e.url) }, 'Apri la pagina')));
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), 8000);
}

/** Esegue una chiamata mostrando un toast in caso di errore. */
async function run(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg, 'ok');
    return r;
  } catch (e) { errToast(e); return undefined; }
}

// Task in background (download/installazioni)
const tasks = new Map();
function onTask(t) {
  const root = document.getElementById('tasks');
  let el = tasks.get(t.id);
  if (!el) {
    el = h('.task', h('.tl', h('span.lbl'), h('span.pct.muted')), h('.bar', h('div')));
    root.appendChild(el);
    tasks.set(t.id, el);
  }
  el.querySelector('.lbl').textContent = t.status === 'error' ? `${t.label}: ${t.error}` : t.label;
  const bar = el.querySelector('.bar');
  const pct = el.querySelector('.pct');
  if (t.progress == null && t.status === 'running') { bar.classList.add('indet'); pct.textContent = ''; } else {
    bar.classList.remove('indet');
    bar.firstChild.style.width = Math.round((t.progress || 0) * 100) + '%';
    pct.textContent = t.status === 'running' ? Math.round((t.progress || 0) * 100) + '%' : '';
  }
  el.className = 'task ' + t.status;
  if (t.status !== 'running') {
    setTimeout(() => { el.remove(); tasks.delete(t.id); }, t.status === 'error' ? 9000 : 2200);
  }
}

// ---------- Modali ----------
function modal({ title, body, foot, wide, xwide, onClose }) {
  const root = document.getElementById('modal-root');
  const close = () => { back.remove(); document.removeEventListener('keydown', esc); onClose && onClose(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const box = h('.modal' + (wide ? '.wide' : '') + (xwide ? '.xwide' : ''),
    h('.modal-head', h('h2', title), h('button.btn.ghost.sm.icon.x', { onclick: close, title: 'Chiudi' }, icon('x'))),
    h('.modal-body', body),
    foot ? h('.modal-foot', foot) : null);
  const back = h('.modal-back', { onmousedown: (e) => { if (e.target === back) close(); } }, box);
  root.appendChild(back);
  document.addEventListener('keydown', esc);
  return { close, box, body: box.querySelector('.modal-body'), foot: box.querySelector('.modal-foot') };
}

function confirmBox(title, message, { okLabel = 'Conferma', danger = false, extra } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    const m = modal({
      title,
      body: h('div', typeof message === 'string' ? h('p.muted', { style: { margin: 0 } }, message) : message, extra || null),
      foot: [btn('Annulla', { onclick: () => finish(false) }), btn(okLabel, { cls: danger ? 'danger' : 'primary', onclick: () => finish(true) })],
      onClose: () => finish(false),
    });
  });
}

function promptBox(title, { label, value = '', placeholder = '', okLabel = 'OK', hint } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input.input', { value, placeholder });
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(input.value.trim()); });
    const m = modal({
      title,
      body: h('.field', label ? h('label', label) : null, input, hint ? h('.hint', hint) : null),
      foot: [btn('Annulla', { onclick: () => finish(null) }), btn(okLabel, { cls: 'primary', onclick: () => finish(input.value.trim()) })],
      onClose: () => finish(null),
    });
    setTimeout(() => input.focus(), 30);
  });
}

// ---------- Formattazione ----------
function fmtBytes(n) {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
function fmtNum(n) { return new Intl.NumberFormat('it-IT', { notation: n > 99999 ? 'compact' : 'standard' }).format(n || 0); }
function fmtDate(t) { return t ? new Date(t).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
function fmtAgo(t) {
  if (!t) return '—';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'pochi secondi fa';
  if (s < 3600) return `${Math.round(s / 60)} min fa`;
  if (s < 86400) return `${Math.round(s / 3600)} ore fa`;
  return `${Math.round(s / 86400)} giorni fa`;
}
function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600); const mm = Math.floor((s % 3600) / 60); const ss = s % 60;
  return hh ? `${hh}h ${mm}m` : `${mm}m ${String(ss).padStart(2, '0')}s`;
}

/** Converte testo con codici colore § / & in nodi colorati (anteprima MOTD). */
function mcText(text, { amp = false } = {}) {
  const frag = document.createDocumentFragment();
  const re = amp ? /[§&]([0-9a-fk-or])/gi : /§([0-9a-fk-or])/gi;
  let classes = [];
  let last = 0;
  const str = String(text || '').replace(/\\n/g, '\n');
  const push = (s) => { if (!s) return; frag.appendChild(h('span', { class: classes.join(' ') }, s)); };
  let m;
  while ((m = re.exec(str))) {
    push(str.slice(last, m.index));
    const c = m[1].toLowerCase();
    if (/[0-9a-f]/.test(c)) classes = ['mc-' + c];
    else if (c === 'r') classes = [];
    else classes.push('mc-' + c);
    last = re.lastIndex;
  }
  push(str.slice(last));
  return frag;
}

function copyText(text, label = 'Copiato negli appunti') {
  navigator.clipboard.writeText(text).then(() => toast(label, 'ok', 2000)).catch(() => toast('Impossibile copiare', 'err'));
}

const STATUS_LABEL = { stopped: 'Offline', starting: 'Avvio…', running: 'Online', stopping: 'Arresto…', crashed: 'Crash', installing: 'Installazione…', error: 'Errore' };

function currentServer() { return App.servers.find((s) => s.id === App.selectedId) || null; }
function serverStatus(s) { return (s && s.state && s.state.status) || 'stopped'; }
function isUp(s) { return ['starting', 'running', 'stopping'].includes(serverStatus(s)); }

/** Piccolo grafico a linee su canvas (CPU/RAM). */
function sparkline(canvas, values, { color = '#5bd16f', max } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 200; const hgt = canvas.clientHeight || 42;
  canvas.width = w * dpr; canvas.height = hgt * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, hgt);
  if (values.length < 2) return;
  const mx = max || Math.max(...values, 1);
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = hgt - (v / mx) * (hgt - 4) - 2;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  ctx.lineTo(w, hgt); ctx.lineTo(0, hgt); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, hgt);
  g.addColorStop(0, color + '55'); g.addColorStop(1, color + '00');
  ctx.fillStyle = g; ctx.fill();
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
