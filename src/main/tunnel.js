'use strict';
// Connessione senza port forwarding: agente playit.gg integrato + rilevamento reti VPN (Tailscale, ZeroTier, Radmin, Hamachi).
//
// Da playit 1.0 il file Windows pubblicato (playit-windows-x86_64-signed.exe) è solo il demone
// "playitd": non ha più --stdout né un'interfaccia per collegare l'account. Il collegamento
// ("claim") lo fa normalmente playit-cli, che su Windows esiste solo dentro l'installer .msi.
// Qui rifacciamo lo stesso flusso del CLI ufficiale direttamente con l'API di playit
// (vedi packages/playit-cli/src/main.rs e packages/api_client nel repo playit-agent):
//   1. POST /claim/setup    { code, agent_type, version }  → finché l'utente non approva nel browser
//   2. POST /claim/exchange { code }                       → secret_key dell'agente
//   3. avvio del demone con --secret-path <file> (log su stderr)
//   4. POST /v1/agents/rundata (Authorization: Agent-Key …) → agent_id e tunnel con l'indirizzo pubblico
//   5. POST /v1/tunnels/create → tunnel "minecraft-java" verso 127.0.0.1:<porta del server>

const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fsp = require('fs/promises');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { download, exists, stripAnsi, httpRequest, sleep } = require('./util');

const { t } = require('../shared/i18n');
const PLAYIT_URL = 'https://github.com/playit-cloud/playit-agent/releases/latest/download/playit-windows-x86_64-signed.exe';
const API = process.env.CRAFTDOCK_PLAYIT_API || 'https://api.playit.gg';
const CLAIM_RE = /https:\/\/playit\.gg\/(?:claim|mc)\/[A-Za-z0-9_-]+/i;
const ADDR_RE = /\b([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:joinmc\.link|ply\.gg|playit\.gg|playit\.plus))(?::(\d{2,5}))?\b/i;
const CLAIM_TIMEOUT_MS = 15 * 60e3;
// Named pipe/socket nostro, così non entriamo in conflitto con un servizio playit installato a parte.
const SOCKET_PATH = process.platform === 'win32' ? '\\\\.\\pipe\\craftdock-playitd' : path.join(os.tmpdir(), 'craftdock-playitd.sock');

class PlayitApiError extends Error {
  constructor(kind, data) {
    super(typeof data === 'string' ? data : (data && (data.message || data.type)) || kind);
    this.kind = kind; // 'fail' | 'error' | 'http'
    this.data = data;
  }
}

/** Chiamata all'API di playit: risposta { status: "success" | "fail" | "error", data }. */
async function playitCall(pathname, body = {}, secret) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (secret) headers.Authorization = `Agent-Key ${secret.trim()}`;
  let res;
  try {
    res = await httpRequest(API + pathname, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) {
    // httpRequest lancia anche per 4xx: proviamo comunque a leggere il corpo JSON di playit
    const m = String(e.message).match(/ — (\{.*\})$/s);
    if (m) {
      try { const j = JSON.parse(m[1]); throw new PlayitApiError(j.status || 'error', j.data); } catch (inner) { if (inner instanceof PlayitApiError) throw inner; }
    }
    throw new PlayitApiError('http', e.message);
  }
  const j = await res.json();
  if (j.status === 'success') return j.data;
  throw new PlayitApiError(j.status || 'error', j.data);
}

function claimCode() { return crypto.randomBytes(5).toString('hex'); }

class PlayitManager extends EventEmitter {
  constructor(store, { appVersion = '1.0.0', openExternal } = {}) {
    super();
    this.store = store;
    this.appVersion = appVersion;
    this.openExternal = openExternal;
    this.proc = null;
    this.status = 'stopped'; // stopped | linking | starting | running | error
    this.claim = null; // { url, state }
    this.claimAbort = null;
    this.agentId = null;
    this.tunnels = [];
    this.pending = [];
    this.notices = [];
    this.log = [];
    this.pollTimer = null;
    this.wantRunning = false;
    this.restarts = 0;
  }

  get dir() { return path.join(this.store.paths.tools, 'playit'); }
  get localBin() { return path.join(this.store.paths.tools, process.platform === 'win32' ? 'playit.exe' : 'playit'); }
  get secretFile() { return path.join(this.dir, 'playit.toml'); }

  async findBin() {
    if (await exists(this.localBin)) return this.localBin;
    return null;
  }

  async readSecret() {
    try {
      const txt = await fsp.readFile(this.secretFile, 'utf8');
      const m = txt.match(/secret_key\s*=\s*"([0-9a-fA-F]+)"/) || txt.trim().match(/^([0-9a-fA-F]{16,})$/);
      return m ? m[1] : null;
    } catch (_) { return null; }
  }

  async writeSecret(secret) {
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(this.secretFile, `secret_key = "${secret}"\n`, 'utf8');
  }

  async info() {
    return {
      installed: !!(await this.findBin()),
      linked: !!(await this.readSecret()),
      status: this.status,
      claim: this.claim,
      claimUrl: this.claim && this.claim.url,
      agentId: this.agentId,
      tunnels: this.tunnels,
      pending: this.pending,
      notices: this.notices,
      publicAddress: this.store.config.playit.publicAddress || '',
      log: this.log.slice(-300),
    };
  }

  setStatus(s) { if (this.status !== s) { this.status = s; this.emit('status', s); } }

  pushLog(line) {
    const clean = stripAnsi(line).trim();
    if (!clean) return;
    this.log.push(clean);
    if (this.log.length > 1000) this.log.shift();
    this.emit('log', clean);
  }

  setClaim(claim) { this.claim = claim; this.emit('claim', claim); }

  async install(onProgress) {
    await download(PLAYIT_URL, this.localBin, { onProgress: (p) => onProgress && onProgress(p, t('Scarico l\'agente playit.gg…')) });
    return this.localBin;
  }

  /**
   * Collega CraftDock a un account playit.gg (flusso "claim" del CLI ufficiale).
   * Apre il link nel browser e aspetta che l'utente approvi.
   */
  async link() {
    if (this.claimAbort) return this.claim; // già in corso
    const code = claimCode();
    const url = `https://playit.gg/claim/${code}`;
    const abort = { aborted: false };
    this.claimAbort = abort;
    this.setStatus('linking');
    this.setClaim({ url, state: 'waiting-visit' });
    this.pushLog(t('Apri questo link per collegare CraftDock a playit.gg: {url}', { url }));
    if (this.openExternal) this.openExternal(url);
    const started = Date.now();
    try {
      // 1. aspetta l'approvazione nel browser
      for (;;) {
        if (abort.aborted) throw new Error(t('Collegamento annullato'));
        if (Date.now() - started > CLAIM_TIMEOUT_MS) throw new Error(t('Tempo scaduto: il collegamento non è stato approvato. Riprova.'));
        let state;
        try {
          state = await playitCall('/claim/setup', { code, agent_type: 'self-managed', version: `CraftDock ${this.appVersion}` });
        } catch (e) {
          if (e.kind === 'fail') throw new Error(t('playit.gg ha rifiutato il codice ({message}). Riprova.', { message: e.message }));
          this.pushLog(t('Errore di rete con playit.gg, riprovo… ') + e.message);
          await sleep(2500);
          continue;
        }
        if (state === 'UserAccepted') break;
        if (state === 'UserRejected') throw new Error(t('Collegamento rifiutato nel browser.'));
        const next = state === 'WaitingForUser' ? 'waiting-approval' : 'waiting-visit';
        if (!this.claim || this.claim.state !== next) this.setClaim({ url, state: next });
        await sleep(1500);
      }
      // 2. scambia il codice con la chiave dell'agente
      this.setClaim({ url, state: 'exchanging' });
      let secret = null;
      for (let i = 0; i < 60 && !secret; i++) {
        if (abort.aborted) throw new Error(t('Collegamento annullato'));
        try {
          const r = await playitCall('/claim/exchange', { code });
          secret = r && r.secret_key;
        } catch (e) {
          if (e.kind === 'fail' && /Rejected|Expired|NotFound/.test(e.message)) throw new Error(t('Collegamento non riuscito ({message}).', { message: e.message }));
          await sleep(2000);
        }
      }
      if (!secret) throw new Error(t('playit.gg non ha restituito la chiave. Riprova.'));
      await this.writeSecret(secret);
      this.setClaim({ url, state: 'done' });
      this.pushLog(t('Account playit.gg collegato.'));
      return this.claim;
    } catch (e) {
      this.setClaim({ url, state: 'error', error: e.message });
      this.pushLog(e.message);
      this.setStatus('error');
      throw e;
    } finally {
      this.claimAbort = null;
    }
  }

  cancelLink() {
    if (this.claimAbort) this.claimAbort.aborted = true;
  }

  async unlink() {
    this.stop();
    await fsp.rm(this.secretFile, { force: true });
    this.agentId = null;
    this.tunnels = [];
    this.pending = [];
    this.emit('tunnels', this.tunnelState());
    this.setClaim(null);
  }

  async start() {
    if (this.proc) return;
    let bin = await this.findBin();
    if (!bin) { this.pushLog(t('Scarico l\'agente playit.gg…')); bin = await this.install(); }
    if (!(await this.readSecret())) await this.link();
    const secret = await this.readSecret();
    if (!secret) throw new Error(t('Collega prima l\'account playit.gg'));

    this.wantRunning = true;
    this.setStatus('starting');
    const args = ['--secret-path', this.secretFile, '--socket-path', SOCKET_PATH];
    this.pushLog(t('Avvio agente playit.gg…'));
    const p = spawn(bin, args, { windowsHide: true, cwd: this.dir, env: Object.assign({}, process.env, { RUST_LOG: process.env.RUST_LOG || 'info' }) });
    this.proc = p;
    const startedAt = Date.now();
    let partial = '';
    const onData = (d) => {
      partial += d.toString('utf8');
      const lines = partial.split(/\r?\n/);
      partial = lines.pop();
      lines.forEach((l) => this.pushLog(l));
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', (e) => this.pushLog(t('Errore: ') + e.message));
    p.on('exit', (code) => {
      this.proc = null;
      clearInterval(this.pollTimer);
      this.pushLog(t('Agente playit terminato (codice {code}).', { code }));
      // Se l'utente non l'ha fermato (es. internet assente), riprova con attese crescenti.
      if (this.wantRunning && this.restarts < 6) {
        const wait = Math.min(60, 5 * 2 ** this.restarts);
        this.restarts++;
        this.setStatus('starting');
        this.pushLog(t('Riprovo ad avviare l\'agente tra {wait} secondi…', { wait }));
        this.restartTimer = setTimeout(() => { if (this.wantRunning) this.start().catch((e) => this.pushLog(e.message)); }, wait * 1000);
        return;
      }
      this.setStatus(code !== 0 && Date.now() - startedAt < 5000 ? 'error' : 'stopped');
    });

    // stato reale dei tunnel dall'API
    await sleep(1500);
    await this.refresh().catch((e) => this.pushLog(t('Impossibile leggere i tunnel: ') + e.message));
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.refresh().catch(() => {}), 10000);
  }

  stop() {
    this.wantRunning = false;
    clearTimeout(this.restartTimer);
    this.cancelLink();
    clearInterval(this.pollTimer);
    if (this.proc) { this.proc.kill(); this.proc = null; }
    this.setStatus('stopped');
  }

  tunnelState() {
    return { agentId: this.agentId, tunnels: this.tunnels, pending: this.pending, notices: this.notices };
  }

  /** Legge agent_id, tunnel e avvisi dell'agente. */
  async refresh() {
    const secret = await this.readSecret();
    if (!secret) return this.tunnelState();
    let data;
    try {
      data = await playitCall('/v1/agents/rundata', {}, secret);
    } catch (e) {
      if (e.kind === 'error' && /auth|key|secret|unauthor/i.test(JSON.stringify(e.data || e.message))) {
        this.pushLog(t('La chiave playit.gg non è più valida: collega di nuovo l\'account.'));
        await fsp.rm(this.secretFile, { force: true });
        this.stop();
      }
      throw e;
    }
    this.agentId = data.agent_id;
    this.tunnels = (data.tunnels || []).map((t) => {
      const fields = (t.agent_config && t.agent_config.fields) || [];
      const f = (n) => (fields.find((x) => x.name === n) || {}).value;
      return {
        id: t.id, name: t.name, address: t.display_address, type: t.tunnel_type, typeLabel: t.tunnel_type_display,
        localIp: f('local_ip') || '127.0.0.1', localPort: Number(f('local_port')) || null, disabled: t.disabled_reason || null,
      };
    });
    this.pending = (data.pending || []).map((t) => ({ id: t.id, name: t.name, status: t.status_msg }));
    this.notices = (data.notices || []).map((n) => ({ priority: n.priority, message: n.message, link: n.resolve_link }));
    if (this.proc && this.status === 'starting') { this.setStatus('running'); this.restarts = 0; }
    this.emit('tunnels', this.tunnelState());
    for (const tun of this.tunnels) if (tun.address) this.emit('address', tun.address);
    return this.tunnelState();
  }

  /**
   * Garantisce un tunnel Minecraft Java verso la porta locale indicata e ne restituisce l'indirizzo.
   * Se esiste già (stessa porta) lo riusa; altrimenti lo crea tramite l'API.
   */
  async ensureTunnel(port, name) {
    const secret = await this.readSecret();
    if (!secret) throw new Error(t('Collega prima l\'account playit.gg'));
    await this.refresh();
    const existing = this.tunnels.find((x) => x.localPort === Number(port) && (!x.type || /minecraft-java/i.test(x.type)));
    if (existing && existing.address) return existing;
    if (!existing) {
      const safeName = String(name || `CraftDock ${port}`).replace(/[^\x20-\x7E]/g, '').slice(0, 40) || `CraftDock ${port}`;
      try {
        await playitCall('/v1/tunnels/create', {
          ports: { type: 'tunnel-type', details: 'minecraft-java' },
          origin: {
            type: 'agent',
            data: {
              agent_id: this.agentId,
              config: { fields: [{ name: 'local_ip', value: '127.0.0.1' }, { name: 'local_port', value: String(port) }] },
            },
          },
          enabled: true,
          alloc: null,
          name: safeName,
          firewall_id: null,
        }, secret);
        this.pushLog(t('Creato il tunnel "{safeName}" verso 127.0.0.1:{port}.', { safeName, port }));
      } catch (e) {
        const hint = {
          RequiresVerifiedAccount: t('playit.gg chiede di verificare l\'account (email) prima di creare tunnel.'),
          AgentVersionTooOld: t('La versione dell\'agente è troppo vecchia: CraftDock la riscaricherà.'),
          RequiresPlayitPremium: t('Questo tipo di tunnel richiede playit Premium.'),
        }[e.message];
        throw new Error(hint || t('playit.gg non ha creato il tunnel: {message}', { message: e.message }));
      }
    }
    // l'indirizzo viene assegnato dopo qualche secondo
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      await this.refresh().catch(() => {});
      const tun = this.tunnels.find((x) => x.localPort === Number(port));
      if (tun && tun.address) return tun;
    }
    const tun = this.tunnels.find((x) => x.localPort === Number(port));
    if (tun) return tun;
    throw new Error(t('Il tunnel è stato creato ma l\'indirizzo non è ancora pronto: riprova tra poco.'));
  }

  async setPublicAddress(addr) {
    await this.store.saveConfig({ playit: Object.assign({}, this.store.config.playit, { publicAddress: String(addr || '').trim() }) });
  }
}

/** Indirizzi di rete locali, con riconoscimento delle VPN "LAN virtuale" più usate. */
function networkInfo() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      const ip = a.address;
      const [o1, o2] = ip.split('.').map(Number);
      let kind = 'other';
      if (/tailscale/i.test(name) || (o1 === 100 && o2 >= 64 && o2 <= 127)) kind = 'tailscale';
      else if (/zerotier/i.test(name)) kind = 'zerotier';
      else if (/radmin/i.test(name) || o1 === 26) kind = 'radmin';
      else if (/hamachi/i.test(name) || o1 === 25) kind = 'hamachi';
      else if (o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168)) kind = 'lan';
      if (/vEthernet|VirtualBox|VMware|WSL|Hyper-V/i.test(name) && kind === 'lan') kind = 'virtual';
      out.push({ name, ip, kind });
    }
  }
  return out;
}

module.exports = { PlayitManager, networkInfo, playitCall, claimCode, CLAIM_RE, ADDR_RE, SOCKET_PATH };
