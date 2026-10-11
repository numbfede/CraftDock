'use strict';
// Connessione senza port forwarding: agente playit.gg integrato + rilevamento reti VPN (Tailscale, ZeroTier, Radmin, Hamachi).

const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { download, exists, stripAnsi } = require('./util');

const PLAYIT_URL = 'https://github.com/playit-cloud/playit-agent/releases/latest/download/playit-windows-x86_64-signed.exe';
const CLAIM_RE = /https:\/\/playit\.gg\/(?:claim|mc)\/[A-Za-z0-9_-]+/i;
const ADDR_RE = /\b([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:joinmc\.link|ply\.gg|playit\.gg|playit\.plus))(?::(\d{2,5}))?\b/i;

class PlayitManager extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.proc = null;
    this.status = 'stopped';
    this.claimUrl = null;
    this.addresses = new Set();
    this.log = [];
  }

  get localBin() { return path.join(this.store.paths.tools, process.platform === 'win32' ? 'playit.exe' : 'playit'); }

  async findBin() {
    const candidates = [this.localBin];
    if (process.platform === 'win32') {
      for (const pf of [process.env.ProgramFiles, 'C:\\Program Files', process.env['ProgramFiles(x86)']].filter(Boolean)) {
        candidates.push(path.join(pf, 'playit_gg', 'bin', 'playit.exe'));
      }
      if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'playit.exe'));
    } else {
      candidates.push('/usr/local/bin/playit', '/usr/bin/playit', '/opt/playit/playit');
    }
    for (const c of candidates) if (await exists(c)) return c;
    return null;
  }

  async info() {
    return {
      installed: !!(await this.findBin()),
      status: this.status,
      claimUrl: this.claimUrl,
      addresses: [...this.addresses],
      publicAddress: this.store.config.playit.publicAddress || '',
      log: this.log.slice(-300),
    };
  }

  setStatus(s) { this.status = s; this.emit('status', s); }

  pushLog(line) {
    const clean = stripAnsi(line).trim();
    if (!clean) return;
    this.log.push(clean);
    if (this.log.length > 1000) this.log.shift();
    this.emit('log', clean);
    const claim = clean.match(CLAIM_RE);
    if (claim && claim[0] !== this.claimUrl) { this.claimUrl = claim[0]; this.emit('claim', this.claimUrl); }
    const addr = clean.match(ADDR_RE);
    if (addr && !/^(api|www|discord|claim)\./i.test(addr[1])) {
      const full = addr[2] ? `${addr[1]}:${addr[2]}` : addr[1];
      if (!this.addresses.has(full)) {
        this.addresses.add(full);
        this.emit('address', full);
        if (!this.store.config.playit.publicAddress) {
          this.store.saveConfig({ playit: Object.assign({}, this.store.config.playit, { publicAddress: full }) }).catch(() => {});
        }
      }
    }
    if (/tunnel.*(running|ready|connected)|agent.*(connected|registered)/i.test(clean)) this.setStatus('running');
  }

  async install(onProgress) {
    await download(PLAYIT_URL, this.localBin, { onProgress: (p) => onProgress && onProgress(p, 'Scarico l\'agente playit.gg…') });
    return this.localBin;
  }

  async start() {
    if (this.proc) return;
    let bin = await this.findBin();
    if (!bin) bin = await this.install();
    this.claimUrl = null;
    this.setStatus('starting');
    const startedAt = Date.now();
    const p = spawn(bin, ['--stdout'], { windowsHide: true, cwd: path.dirname(bin) });
    this.proc = p;
    let partial = '';
    const onData = (d) => {
      partial += d.toString('utf8');
      const lines = partial.split(/\r?\n/);
      partial = lines.pop();
      lines.forEach((l) => this.pushLog(l));
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', (e) => { this.pushLog('Errore: ' + e.message); });
    p.on('exit', (code) => {
      this.proc = null;
      this.pushLog(`Agente playit terminato (codice ${code}).`);
      if (code !== 0 && Date.now() - startedAt < 5000) {
        this.pushLog('L\'agente non è partito in modalità integrata: usa "Apri finestra playit" per completare la configurazione.');
        this.setStatus('error');
      } else this.setStatus('stopped');
    });
    setTimeout(() => { if (this.proc && this.status === 'starting') this.setStatus('running'); }, 8000);
  }

  stop() {
    if (this.proc) { this.proc.kill(); this.proc = null; }
    this.setStatus('stopped');
  }

  /** Apre l'agente in una finestra di console separata (utile per la prima configurazione/claim). */
  async openConsole() {
    let bin = await this.findBin();
    if (!bin) bin = await this.install();
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '"playit.gg"', bin], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    } else {
      spawn(bin, [], { detached: true, stdio: 'ignore' }).unref();
    }
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

module.exports = { PlayitManager, networkInfo, CLAIM_RE, ADDR_RE };
