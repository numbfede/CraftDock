'use strict';
/*
 * Operazioni programmate per ogni server: riavvio, backup, comando, messaggio in chat,
 * accensione e spegnimento a un orario, nei giorni scelti.
 *
 * Ogni server ha server.schedules = [{ id, kind, time: 'HH:MM', days: [0..6], enabled, command, message, warn }]
 * (days usa la numerazione di JavaScript: 0 = domenica). Il controllo gira ogni 20 secondi e
 * ricorda l'ultimo minuto eseguito, così ogni operazione parte una volta sola.
 * Per riavvio e spegnimento, con "warn" attivo, i giocatori ricevono un avviso 5 e 1 minuto prima.
 */
const { EventEmitter } = require('events');
const { t, tn } = require('../shared/i18n');

const KINDS = ['restart', 'backup', 'command', 'message', 'start', 'stop'];
const WARN_BEFORE = [5, 1];

function minuteKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
}
function hhmm(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function dueAt(entry, d) {
  if (!entry || entry.enabled === false || !KINDS.includes(entry.kind)) return false;
  const days = Array.isArray(entry.days) && entry.days.length ? entry.days : [0, 1, 2, 3, 4, 5, 6];
  return days.includes(d.getDay()) && entry.time === hhmm(d);
}

/** Pulisce quello che arriva dall'interfaccia prima di salvarlo. */
function sanitize(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 50).map((e) => ({
    id: String(e.id || Math.random().toString(36).slice(2, 10)),
    kind: KINDS.includes(e.kind) ? e.kind : 'restart',
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(e.time) ? e.time : '04:00',
    days: Array.isArray(e.days) ? [...new Set(e.days.map(Number).filter((n) => n >= 0 && n <= 6))].sort() : [],
    enabled: e.enabled !== false,
    command: String(e.command || '').replace(/^\//, '').slice(0, 500),
    message: String(e.message || '').slice(0, 300),
    warn: e.warn !== false,
  }));
}

class Scheduler extends EventEmitter {
  /**
   * @param {object} deps store, servers (ServerManager), backups (BackupManager)
   */
  constructor({ store, servers, backups }) {
    super();
    this.store = store;
    this.servers = servers;
    this.backups = backups;
    this.done = new Set();
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(new Date()).catch((e) => console.error('Pianificazione:', e)), 20e3);
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  async tick(now) {
    if (this.done.size > 2000) this.done.clear();
    for (const server of this.store.servers) {
      for (const entry of server.schedules || []) {
        // avvisi prima di riavvio / spegnimento
        if (entry.warn !== false && (entry.kind === 'restart' || entry.kind === 'stop') && this.servers.isRunning(server.id)) {
          for (const m of WARN_BEFORE) {
            const ahead = new Date(now.getTime() + m * 60e3);
            const key = `${server.id}|${entry.id}|warn${m}|${minuteKey(ahead)}`;
            if (dueAt(entry, ahead) && !this.done.has(key)) {
              this.done.add(key);
              this.say(server.id, entry.kind === 'restart'
                ? tn(m, 'Riavvio programmato del server tra {n} minuto', 'Riavvio programmato del server tra {n} minuti')
                : tn(m, 'Spegnimento programmato del server tra {n} minuto', 'Spegnimento programmato del server tra {n} minuti'));
            }
          }
        }
        const key = `${server.id}|${entry.id}|${minuteKey(now)}`;
        if (!dueAt(entry, now) || this.done.has(key)) continue;
        this.done.add(key);
        await this.run(server, entry).catch((e) => {
          this.servers.info(server.id, t('Operazione programmata non riuscita: {msg}', { msg: e.message }));
          this.emit('error', server.id, entry, e);
        });
      }
    }
  }

  say(id, text) {
    try { this.servers.send(id, `say ${text}`, { silent: true }); } catch (_) {}
  }

  async run(server, entry) {
    const id = server.id;
    const up = this.servers.isRunning(id);
    const label = { restart: t('Riavvio'), backup: t('Backup'), command: t('Comando'), message: t('Messaggio'), start: t('Accensione'), stop: t('Spegnimento') }[entry.kind];
    this.servers.info(id, t('Operazione programmata: {what} ({time})', { what: label, time: entry.time }));
    switch (entry.kind) {
      case 'restart':
        if (up) await this.servers.restart(id);
        break;
      case 'start':
        if (!up) await this.servers.start(id);
        break;
      case 'stop':
        if (up) await this.servers.stop(id);
        break;
      case 'backup':
        await this.backups.create(id, { auto: true, label: t('Programmato') });
        break;
      case 'command':
        if (up && entry.command) this.servers.send(id, entry.command);
        break;
      case 'message':
        if (up && entry.message) this.say(id, entry.message);
        break;
      default:
    }
    this.emit('ran', id, entry);
  }
}

module.exports = { Scheduler, sanitize, dueAt, KINDS };
