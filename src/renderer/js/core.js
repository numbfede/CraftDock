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
  if (el.tagName === 'INPUT' && el.type === 'range') {
    // riempimento verde del cursore fino al valore attuale
    const fill = () => { const mn = Number(el.min) || 0; const mx = Number(el.max) || 100; el.style.setProperty('--fill', ((Number(el.value) - mn) / (mx - mn || 1)) * 100 + '%'); };
    el.addEventListener('input', fill);
    fill();
  }
  return el;
}

// Icone: set Phosphor definito in js/icons.js (viewBox 256, riempite con currentColor)
function icon(name, cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 256 256');
  s.setAttribute('fill', 'currentColor');
  s.setAttribute('width', '18');
  s.setAttribute('height', '18');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
  s.innerHTML = ICONS[name] || ICONS.info;
  return s;
}

function btn(label, opts = {}) {
  const cls = ['btn', ...(opts.cls || '').split(' ').filter(Boolean)].join('.');
  if (opts.island) {
    return h('button.' + cls + '.island', { onclick: opts.onclick, disabled: opts.disabled, title: opts.title, type: 'button' },
      label ? h('span', label) : null, h('span.btn-orb', icon(opts.island === true ? (opts.icon || 'arrowRight') : opts.island)));
  }
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
  if (n == null) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
function fmtNum(n) { return new Intl.NumberFormat('it-IT', { notation: n > 99999 ? 'compact' : 'standard' }).format(n || 0); }
function fmtDate(t) { return t ? new Date(t).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }) : '–'; }
function fmtAgo(t) {
  if (!t) return '–';
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
