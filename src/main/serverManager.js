'use strict';
// Avvio, arresto e monitoraggio dei processi server, console e giocatori online.

const path = require('path');
const net = require('net');
const fsp = require('fs/promises');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { stripAnsi, exists, sleep } = require('./util');
const properties = require('./properties');

let pidusage = null;
try { pidusage = require('pidusage'); } catch (_) { /* statistiche non disponibili */ }

const MAX_LOG = 3000;

// Flag G1 consigliati da Aikar (riducono i lag da garbage collector)
function aikarFlags(ramMb) {
  const big = ramMb >= 12288;
  return [
    '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions', '-XX:+DisableExplicitGC', '-XX:+AlwaysPreTouch',
    `-XX:G1NewSizePercent=${big ? 40 : 30}`, `-XX:G1MaxNewSizePercent=${big ? 50 : 40}`,
    `-XX:G1HeapRegionSize=${big ? '16M' : '8M'}`, `-XX:G1ReservePercent=${big ? 15 : 20}`,
    '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=4',
    `-XX:InitiatingHeapOccupancyPercent=${big ? 20 : 15}`, '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseIntervalPercent=5', '-XX:SurvivorRatio=32', '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1', '-Dusing.aikars.flags=https://mcflags.emc.gs', '-Daikars.new.flags=true',
  ];
}

/** Divide una stringa di argomenti rispettando le virgolette. */
function splitArgs(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(s || '')))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });
}

async function findFreePort(start = 25565, taken = []) {
  for (let p = start; p < start + 200; p++) {
    if (taken.includes(p)) continue;
    if (await isPortFree(p)) return p;
  }
  return start;
}

class ServerManager extends EventEmitter {
  constructor(store, java) {
    super();
    this.store = store;
    this.java = java;
    this.runtime = new Map();
  }

  rt(id) {
    if (!this.runtime.has(id)) {
      this.runtime.set(id, { proc: null, status: 'stopped', players: new Set(), log: [], startedAt: null, stats: null, statsHistory: [], waiters: [], crashTimes: [], stopRequested: false, restartRequested: false, version: null });
    }
    return this.runtime.get(id);
  }

  state(id) {
    const r = this.rt(id);
    return { status: r.status, players: [...r.players], startedAt: r.startedAt, stats: r.stats, statsHistory: r.statsHistory, pid: r.proc ? r.proc.pid : null };
  }

  logs(id) { return this.rt(id).log; }

  isRunning(id) {
    const s = this.rt(id).status;
    return s === 'starting' || s === 'running' || s === 'stopping';
  }

  runningIds() { return [...this.runtime.entries()].filter(([, r]) => r.proc).map(([id]) => id); }

  setStatus(id, status) {
    const r = this.rt(id);
    if (r.status === status) return;
    r.status = status;
    this.emit('status', id, status);
  }

  pushLog(id, line, source = 'server') {
    const r = this.rt(id);
    const entry = { t: Date.now(), line, source };
    r.log.push(entry);
    if (r.log.length > MAX_LOG) r.log.splice(0, r.log.length - MAX_LOG);
    this.emit('log', id, entry);
    this.parseLine(id, line);
    for (const w of [...r.waiters]) {
      const m = line.match(w.re);
      if (m) { r.waiters.splice(r.waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(m); }
    }
  }

  info(id, msg) { this.pushLog(id, '[CraftDock] ' + msg, 'app'); }

  parseLine(id, line) {
    const r = this.rt(id);
    if (r.status === 'starting' && /Done \([\d.,]+s\)!/.test(line)) {
      this.setStatus(id, 'running');
      this.emit('ready', id);
    }
    let m = line.match(/: ([A-Za-z0-9_.]{2,16}) joined the game/);
    if (m) { r.players.add(m[1]); this.emit('players', id, [...r.players]); return; }
    m = line.match(/: ([A-Za-z0-9_.]{2,16}) left the game/);
    if (m) { r.players.delete(m[1]); this.emit('players', id, [...r.players]); return; }
    m = line.match(/There are (\d+) of a max(?: of)? (\d+) players online:\s*(.*)$/);
    if (m) {
      r.players = new Set(m[3].split(',').map((s) => s.trim()).filter(Boolean));
      this.emit('players', id, [...r.players]);
    }
    if (/FAILED TO BIND TO PORT/i.test(line)) this.info(id, 'La porta è già occupata: cambia porta nelle impostazioni del server o chiudi l\'altro programma.');
    if (/You need to agree to the EULA/i.test(line)) this.emit('eula-required', id);
    if (/UnsupportedClassVersionError/.test(line)) this.info(id, 'Versione di Java non compatibile: imposta "Java automatico" nelle impostazioni del server.');
  }

  /** Attende una riga di log che corrisponda a re (dopo aver eventualmente inviato un comando). */
  waitFor(id, re, timeoutMs = 5000) {
    const r = this.rt(id);
    return new Promise((resolve) => {
      const w = { re, resolve, timer: null };
      w.timer = setTimeout(() => { r.waiters.splice(r.waiters.indexOf(w), 1); resolve(null); }, timeoutMs);
      r.waiters.push(w);
    });
  }

  async sendAndWait(id, cmd, re, timeoutMs = 4000) {
    const p = this.waitFor(id, re, timeoutMs);
    this.send(id, cmd, { silent: true });
    return p;
  }

  send(id, cmd, { silent = false } = {}) {
    const r = this.rt(id);
    if (!r.proc || !r.proc.stdin.writable) throw new Error('Il server non è in esecuzione');
    const clean = String(cmd).replace(/^\//, '').trim();
    if (!clean) return;
    if (!silent) this.pushLog(id, '> ' + clean, 'input');
    r.proc.stdin.write(clean + '\n');
  }

  async eulaAccepted(dir) {
    try { return /eula\s*=\s*true/i.test(await fsp.readFile(path.join(dir, 'eula.txt'), 'utf8')); } catch (_) { return false; }
  }

  async acceptEula(dir) {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'eula.txt'), `# Accettato tramite CraftDock il ${new Date().toISOString()}\n# https://aka.ms/MinecraftEULA\neula=true\n`, 'utf8');
  }

  async buildCommand(server, onProgress) {
    let javaPath = server.javaPath;
    if (!javaPath || !(await exists(javaPath))) {
      javaPath = await this.java.ensure(server.javaMajor || 21, { onProgress });
    }
    const ram = Math.max(512, Number(server.ramMb) || 2048);
    const args = [`-Xmx${ram}M`, `-Xms${server.aikarFlags ? ram : Math.min(ram, 1024)}M`];
    if (server.aikarFlags) args.push(...aikarFlags(ram));
    args.push('-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8');
    args.push(...splitArgs(server.jvmArgs));
    const launch = server.launch || {};
    if (launch.kind === 'args') args.push('@' + launch.argsFile);
    else args.push('-jar', launch.jar || 'server.jar');
    args.push('nogui');
    return { javaPath, args };
  }

  async start(id, { onProgress } = {}) {
    const server = this.store.get(id);
    if (!server) throw new Error('Server non trovato');
    const r = this.rt(id);
    if (r.proc) throw new Error('Il server è già avviato');
    if (!server.launch) throw new Error('Il server non è installato. Usa "Reinstalla" nelle impostazioni.');
    if (!(await this.eulaAccepted(server.dir))) { const e = new Error('EULA non accettata'); e.code = 'EULA'; throw e; }

    // Porta: allinea server.properties e controlla che sia libera
    const props = await properties.readFile(path.join(server.dir, 'server.properties'));
    const port = Number(server.port) || Number(props.map['server-port']) || 25565;
    if (String(props.map['server-port']) !== String(port)) await properties.update(path.join(server.dir, 'server.properties'), { 'server-port': String(port) });
    if (!(await isPortFree(port))) {
      const other = this.store.servers.find((s) => s.id !== id && Number(s.port) === port && this.isRunning(s.id));
      throw new Error(other ? `La porta ${port} è usata dal server "${other.name}". Cambia porta in Impostazioni server.` : `La porta ${port} è occupata da un altro programma.`);
    }

    r.stopRequested = false;
    r.players = new Set();
    this.setStatus(id, 'starting');
    let cmd;
    try {
      cmd = await this.buildCommand(server, onProgress);
    } catch (e) {
      this.setStatus(id, 'stopped');
      throw e;
    }
    this.info(id, `Avvio: ${path.basename(cmd.javaPath)} ${cmd.args.filter((a) => !a.startsWith('-XX')).join(' ')}`);
    const proc = spawn(cmd.javaPath, cmd.args, { cwd: server.dir, windowsHide: true, env: Object.assign({}, process.env, { JAVA_TOOL_OPTIONS: '' }) });
    r.proc = proc;
    r.startedAt = Date.now();
    this.emit('players', id, []);

    const onData = (buf) => {
      const text = stripAnsi(buf.toString('utf8'));
      r._partial = (r._partial || '') + text;
      const lines = r._partial.split('\n');
      r._partial = lines.pop();
      for (const l of lines) if (l.trim()) this.pushLog(id, l);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => this.info(id, 'Errore processo: ' + err.message));
    proc.on('exit', (code) => this.onExit(id, code));

    this.startStats(id);
    return true;
  }

  startStats(id) {
    const r = this.rt(id);
    clearInterval(r.statsTimer);
    r.statsHistory = [];
    if (!pidusage) return;
    r.statsTimer = setInterval(async () => {
      if (!r.proc) return;
      try {
        const s = await pidusage(r.proc.pid);
        r.stats = { cpu: Math.round(s.cpu), memMb: Math.round(s.memory / 1048576), uptime: Date.now() - r.startedAt };
        r.statsHistory.push({ t: Date.now(), cpu: r.stats.cpu, memMb: r.stats.memMb });
        if (r.statsHistory.length > 90) r.statsHistory.shift();
        this.emit('stats', id, r.stats);
      } catch (_) {}
    }, 2000);
  }

  async onExit(id, code) {
    const r = this.rt(id);
    clearInterval(r.statsTimer);
    if (r._partial && r._partial.trim()) this.pushLog(id, r._partial);
    r._partial = '';
    r.proc = null;
    r.players = new Set();
    r.stats = null;
    if (pidusage && pidusage.clear) try { pidusage.clear(); } catch (_) {}
    this.emit('players', id, []);
    const wasRequested = r.stopRequested;
    this.info(id, `Server terminato (codice ${code}).`);
    if (r.restartRequested) {
      r.restartRequested = false;
      this.setStatus(id, 'stopped');
      this.emit('stopped', id, { requested: true });
      await sleep(1000);
      this.start(id).catch((e) => this.info(id, 'Riavvio fallito: ' + e.message));
      return;
    }
    if (wasRequested || code === 0) {
      this.setStatus(id, 'stopped');
      this.emit('stopped', id, { requested: true });
      return;
    }
    this.setStatus(id, 'crashed');
    this.emit('stopped', id, { requested: false, code });
    const server = this.store.get(id);
    const now = Date.now();
    r.crashTimes = r.crashTimes.filter((t) => now - t < 10 * 60e3);
    r.crashTimes.push(now);
    if (server && server.autoRestart && r.crashTimes.length <= 3 && r.startedAt && now - r.startedAt > 30e3) {
      this.info(id, 'Crash rilevato: riavvio automatico tra 5 secondi…');
      await sleep(5000);
      if (!this.rt(id).proc) this.start(id).catch((e) => this.info(id, 'Riavvio automatico fallito: ' + e.message));
    } else if (server && server.autoRestart && r.crashTimes.length > 3) {
      this.info(id, 'Troppi crash in poco tempo: riavvio automatico sospeso. Controlla la console.');
    }
  }

  async stop(id, timeoutMs = 60000) {
    const r = this.rt(id);
    if (!r.proc) return;
    r.stopRequested = true;
    this.setStatus(id, 'stopping');
    const exited = new Promise((resolve) => r.proc.once('exit', resolve));
    try { this.send(id, 'stop'); } catch (_) {}
    const timer = setTimeout(() => {
      if (r.proc) { this.info(id, 'Il server non risponde: chiusura forzata.'); r.proc.kill('SIGKILL'); }
    }, timeoutMs);
    await exited;
    clearTimeout(timer);
  }

  async restart(id) {
    const r = this.rt(id);
    if (!r.proc) return this.start(id);
    r.restartRequested = true;
    return this.stop(id);
  }

  kill(id) {
    const r = this.rt(id);
    if (!r.proc) return;
    r.stopRequested = true;
    r.proc.kill('SIGKILL');
  }

  async stopAll() {
    await Promise.all(this.runningIds().map((id) => this.stop(id, 45000).catch(() => {})));
  }

  clearLog(id) { this.rt(id).log = []; }
}

module.exports = { ServerManager, isPortFree, findFreePort, splitArgs, aikarFlags };
