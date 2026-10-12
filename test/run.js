'use strict';
// Test dei moduli del processo principale che non richiedono Electron né rete.
// Esegui con: npm test

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const zlib = require('zlib');

const util = require('../src/main/util');
const properties = require('../src/main/properties');
const { readLevelInfo } = require('../src/main/nbt');
const zip = require('../src/main/zip');
const loaders = require('../src/main/loaders');
const { splitArgs, aikarFlags } = require('../src/main/serverManager');
const { WorldManager } = require('../src/main/worlds');
const { ModManager, CLIENT_ONLY_RE } = require('../src/main/mods');
const { CLAIM_RE, ADDR_RE } = require('../src/main/tunnel');

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---- helper: crea un level.dat NBT minimale ----
function nbtString(s) { const b = Buffer.from(s, 'utf8'); const h = Buffer.alloc(2); h.writeUInt16BE(b.length); return Buffer.concat([h, b]); }
function tag(type, name, payload) { return Buffer.concat([Buffer.from([type]), nbtString(name), payload]); }
function int(v) { const b = Buffer.alloc(4); b.writeInt32BE(v); return b; }
function long(v) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); return b; }
function makeLevelDat(name, version) {
  const versionCompound = Buffer.concat([tag(8, 'Name', nbtString(version)), tag(3, 'Id', int(4189)), Buffer.from([0])]);
  const data = Buffer.concat([
    tag(8, 'LevelName', nbtString(name)), tag(3, 'GameType', int(1)), tag(4, 'LastPlayed', long(1700000000000)),
    tag(10, 'Version', versionCompound), tag(1, 'hardcore', Buffer.from([0])), Buffer.from([0]),
  ]);
  const root = Buffer.concat([tag(10, '', Buffer.concat([tag(10, 'Data', data), Buffer.from([0])]))]);
  return zlib.gzipSync(root);
}

test('compareVersions gestisce il nuovo schema 26.x', () => {
  assert.strictEqual(util.compareVersions('1.21.11', '26.1'), -1);
  assert.strictEqual(util.compareVersions('26.1.1', '26.1'), 1);
  assert.strictEqual(util.compareVersions('1.20.4', '1.20.4'), 0);
  assert.strictEqual(util.compareVersions('1.9', '1.10'), -1);
});

test('guessJavaMajor', () => {
  assert.strictEqual(util.guessJavaMajor('1.16.5'), 8);
  assert.strictEqual(util.guessJavaMajor('1.20.1'), 17);
  assert.strictEqual(util.guessJavaMajor('1.21.1'), 21);
  assert.strictEqual(util.guessJavaMajor('26.1'), 25);
});

test('properties: parse, escape unicode, preserva commenti e ordine', () => {
  const text = '#Minecraft server properties\n#Sun Oct 11\nmotd=\\u00A7aCiao \\u00E8 bello\nserver-port=25565\nlevel-name=world\n';
  const p = properties.parse(text);
  assert.strictEqual(p.map.motd, '§aCiao è bello');
  assert.strictEqual(p.map['server-port'], '25565');
  const out = properties.serialize(p, { 'server-port': '25570', difficulty: 'hard' });
  assert.ok(out.startsWith('#Minecraft server properties\n#Sun Oct 11\nmotd=\\u00a7aCiao \\u00e8 bello\nserver-port=25570'));
  assert.ok(out.includes('difficulty=hard'));
  assert.strictEqual(properties.parse(out).map.motd, '§aCiao è bello');
  assert.strictEqual(properties.parse('a\\=b=c:d\n').map['a=b'], 'c:d');
  assert.strictEqual(properties.parse('resource-pack-prompt=\n').map['resource-pack-prompt'], '');
});

test('nbt: legge level.dat', () => {
  const info = readLevelInfo(makeLevelDat('Il mio mondo', '1.21.1'));
  assert.strictEqual(info.levelName, 'Il mio mondo');
  assert.strictEqual(info.version, '1.21.1');
  assert.strictEqual(info.gameMode, 'creative');
  assert.strictEqual(info.lastPlayed, 1700000000000);
});

test('NeoForge: conversione versioni', () => {
  assert.strictEqual(loaders.neoToMc('21.1.77'), '1.21.1');
  assert.strictEqual(loaders.neoToMc('21.0.5-beta'), '1.21');
  assert.strictEqual(loaders.neoToMc('20.4.237'), '1.20.4');
  assert.strictEqual(loaders.neoToMc('26.1.0.19-beta'), '26.1');
  assert.strictEqual(loaders.neoToMc('26.1.1.3'), '26.1.1');
  assert.strictEqual(loaders.mcToNeoPrefix('1.21.1'), '21.1.');
  assert.strictEqual(loaders.mcToNeoPrefix('1.21'), '21.0.');
  assert.strictEqual(loaders.mcToNeoPrefix('26.1'), '26.1.0.');
  assert.deepStrictEqual(loaders.parseMavenVersions('<versions><version>1</version><version>2-b</version></versions>'), ['1', '2-b']);
});

test('splitArgs e flag Aikar', () => {
  assert.deepStrictEqual(splitArgs('-Dfoo=1 "-Dbar=a b" -XX:+X'), ['-Dfoo=1', '-Dbar=a b', '-XX:+X']);
  assert.ok(aikarFlags(4096).includes('-XX:G1HeapRegionSize=8M'));
  assert.ok(aikarFlags(16384).includes('-XX:G1HeapRegionSize=16M'));
});

test('regex tunnel playit', () => {
  assert.strictEqual('Visit https://playit.gg/claim/ab12CD34 to claim'.match(CLAIM_RE)[0], 'https://playit.gg/claim/ab12CD34');
  const m = 'tunnel ready: slow-cat.gl.joinmc.link => 127.0.0.1:25565'.match(ADDR_RE);
  assert.strictEqual(m[1], 'slow-cat.gl.joinmc.link');
  const m2 = 'address 147.185.221.3 / funny-dog.ply.gg:12345'.match(ADDR_RE);
  assert.strictEqual(m2[1] + ':' + m2[2], 'funny-dog.ply.gg:12345');
});

test('client-only regex', () => {
  assert.ok(CLIENT_ONLY_RE.test('sodium-fabric-0.6.0.jar'));
  assert.ok(CLIENT_ONLY_RE.test('oculus-mc1.20.1-1.7.0.jar'));
  assert.ok(!CLIENT_ONLY_RE.test('create-1.20.1-0.5.1.jar'));
  assert.ok(!CLIENT_ONLY_RE.test('lithium-fabric-0.15.jar'));
});

test('zip + mondi: importazione da zip annidato, split dimensioni Paper, rilevamento server', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'craftdock-test-'));
  try {
    // mondo singleplayer finto con Nether
    const src = path.join(tmp, 'src', 'Cartella Esterna', 'Mondo Bello');
    await fsp.mkdir(path.join(src, 'DIM-1', 'region'), { recursive: true });
    await fsp.mkdir(path.join(src, 'region'), { recursive: true });
    await fsp.writeFile(path.join(src, 'level.dat'), makeLevelDat('Mondo Bello', '1.21.1'));
    await fsp.writeFile(path.join(src, 'region', 'r.0.0.mca'), 'x');
    await fsp.writeFile(path.join(src, 'DIM-1', 'region', 'r.0.0.mca'), 'n');
    await fsp.writeFile(path.join(src, 'session.lock'), 'lock');
    const zipFile = path.join(tmp, 'mondo.zip');
    await zip.createZip(zipFile, [{ path: path.join(tmp, 'src', 'Cartella Esterna'), name: 'Cartella Esterna' }]);
    const entries = await zip.listEntries(zipFile);
    assert.ok(entries.some((e) => e.endsWith('level.dat')));
    assert.ok(!entries.some((e) => e.endsWith('session.lock')), 'session.lock escluso');

    const store = { paths: { cache: path.join(tmp, 'cache') } };
    const wm = new WorldManager(store);
    const serverDir = path.join(tmp, 'server');
    await fsp.mkdir(serverDir);
    await fsp.writeFile(path.join(serverDir, 'server.properties'), 'level-name=world\n');
    const server = { dir: serverDir, type: 'paper' };
    const info = await wm.import(server, zipFile, {});
    assert.strictEqual(info.folder, 'Mondo Bello');
    assert.ok(fs.existsSync(path.join(serverDir, 'Mondo Bello', 'level.dat')));
    assert.ok(fs.existsSync(path.join(serverDir, 'Mondo Bello_nether', 'DIM-1', 'region', 'r.0.0.mca')), 'nether separato per Paper');
    const props = await properties.readFile(path.join(serverDir, 'server.properties'));
    assert.strictEqual(props.map['level-name'], 'Mondo Bello');
    const list = await wm.list(server);
    assert.strictEqual(list.worlds.length, 1);
    assert.ok(list.worlds[0].active);

    // reimportazione dalla cartella: nome unico
    const again = await wm.import({ dir: serverDir, type: 'fabric' }, path.join(tmp, 'src'), { activate: false });
    assert.strictEqual(again.folder, 'Mondo Bello-2');

    // export rimette le dimensioni dentro il mondo
    const out = path.join(tmp, 'export.zip');
    await wm.exportZip(server, 'Mondo Bello', out);
    const ex = await zip.listEntries(out);
    assert.ok(ex.some((e) => e.replace(/\\/g, '/').startsWith('Mondo Bello/DIM-1/')));

    // zip slip
    const extractDir = path.join(tmp, 'x');
    await zip.extract(zipFile, extractDir, { stripPrefix: 'Cartella Esterna/' });
    assert.ok(fs.existsSync(path.join(extractDir, 'Mondo Bello', 'level.dat')));

    // rilevamento server
    const fabricDir = path.join(tmp, 'fab');
    await fsp.mkdir(fabricDir);
    await fsp.writeFile(path.join(fabricDir, 'fabric-server-launch.jar'), '');
    let d = await loaders.detectServer(fabricDir);
    assert.strictEqual(d.type, 'fabric');
    assert.strictEqual(d.launch.jar, 'fabric-server-launch.jar');
    const neoDir = path.join(tmp, 'neo');
    const argsDir = path.join(neoDir, 'libraries', 'net', 'neoforged', 'neoforge', '21.1.77');
    await fsp.mkdir(argsDir, { recursive: true });
    await fsp.writeFile(path.join(argsDir, process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt'), '');
    d = await loaders.detectServer(neoDir);
    assert.strictEqual(d.type, 'neoforge');
    assert.strictEqual(d.launch.kind, 'args');
    assert.strictEqual(d.launch.argsFile, `libraries/net/neoforged/neoforge/21.1.77/${process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt'}`);
    assert.strictEqual(d.mcVersion, '1.21.1');
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('mod: metadati jar Fabric e Forge + disattivazione client-only', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'craftdock-mods-'));
  try {
    const mk = async (name, files) => {
      const d = path.join(tmp, 'build-' + name);
      for (const [f, c] of Object.entries(files)) { await fsp.mkdir(path.dirname(path.join(d, f)), { recursive: true }); await fsp.writeFile(path.join(d, f), c); }
      const items = Object.keys(files).map((f) => ({ path: path.join(d, f), name: f }));
      await zip.createZip(path.join(tmp, 'server', 'mods', name), items);
    };
    await mk('lithium.jar', { 'fabric.mod.json': JSON.stringify({ id: 'lithium', name: 'Lithium', version: '0.15.0', environment: '*' }) });
    await mk('zoomy.jar', { 'fabric.mod.json': JSON.stringify({ id: 'zoomy', name: 'Zoomy', version: '1.0', environment: 'client' }) });
    await mk('create.jar', { 'META-INF/mods.toml': 'modLoader="javafml"\n[[mods]]\nmodId="create"\nversion="${file.jarVersion}"\ndisplayName="Create"\n', 'META-INF/MANIFEST.MF': 'Implementation-Version: 0.5.1\n' });
    const mm = new ModManager({ config: {} });
    const server = { dir: path.join(tmp, 'server'), type: 'fabric' };
    const { mods } = await mm.listInstalled(server);
    const byName = Object.fromEntries(mods.map((m) => [m.name, m]));
    assert.strictEqual(byName.Lithium.version, '0.15.0');
    assert.strictEqual(byName.Create.version, '0.5.1');
    const disabled = await mm.disableClientOnly(server);
    assert.deepStrictEqual(disabled, ['Zoomy']);
    assert.ok(fs.existsSync(path.join(server.dir, 'mods', 'zoomy.jar.disabled')));
    await mm.toggle(server, 'zoomy.jar.disabled');
    assert.ok(fs.existsSync(path.join(server.dir, 'mods', 'zoomy.jar')));
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('playit: collegamento account, lettura tunnel e creazione automatica (API finta)', async () => {
  const http = require('http');
  const calls = [];
  let setupCalls = 0;
  const tunnels = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const json = body ? JSON.parse(body) : {};
      calls.push({ path: req.url, auth: req.headers.authorization || null, body: json });
      const ok = (data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: 'success', data })); };
      if (req.url === '/claim/setup') { setupCalls++; return ok(setupCalls < 2 ? 'WaitingForUserVisit' : setupCalls < 3 ? 'WaitingForUser' : 'UserAccepted'); }
      if (req.url === '/claim/exchange') return ok({ secret_key: 'abcdef0123456789abcdef0123456789' });
      if (req.url === '/v1/agents/rundata') {
        return ok({ agent_id: '11111111-2222-3333-4444-555555555555', tunnels, pending: [], notices: [], permissions: { is_self_managed: true, has_premium: false, account_status: 'Verified' } });
      }
      if (req.url === '/v1/tunnels/create') {
        tunnels.push({ id: 't1', internal_id: 1, name: json.name, display_address: 'happy-creeper.gl.joinmc.link', port_type: 'tcp', port_count: 1, tunnel_type: 'minecraft-java', tunnel_type_display: 'Minecraft Java', agent_config: json.origin.data.config, disabled_reason: null });
        return ok({ id: 't1' });
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.CRAFTDOCK_PLAYIT_API = `http://127.0.0.1:${srv.address().port}`;
  delete require.cache[require.resolve('../src/main/tunnel')];
  const { PlayitManager } = require('../src/main/tunnel');
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'craftdock-playit-'));
  try {
    const opened = [];
    const store = { paths: { tools: tmp }, config: { playit: {} }, saveConfig: async () => {} };
    const pm = new PlayitManager(store, { appVersion: '1.0.1', openExternal: (u) => opened.push(u) });
    const states = [];
    pm.on('claim', (c) => c && states.push(c.state));
    await pm.link();
    assert.match(opened[0], /^https:\/\/playit\.gg\/claim\/[0-9a-f]{10}$/);
    assert.deepStrictEqual([...new Set(states)], ['waiting-visit', 'waiting-approval', 'exchanging', 'done']);
    assert.strictEqual(await pm.readSecret(), 'abcdef0123456789abcdef0123456789');
    assert.match(await fsp.readFile(path.join(tmp, 'playit', 'playit.toml'), 'utf8'), /^secret_key = "abcdef/);
    const setup = calls.find((c) => c.path === '/claim/setup');
    assert.strictEqual(setup.body.agent_type, 'self-managed');
    assert.strictEqual(setup.body.version, 'CraftDock 1.0.1');

    const t = await pm.ensureTunnel(25570, 'CraftDock Survival è bello');
    assert.strictEqual(t.address, 'happy-creeper.gl.joinmc.link');
    assert.strictEqual(t.localPort, 25570);
    const create = calls.find((c) => c.path === '/v1/tunnels/create');
    assert.strictEqual(create.auth, 'Agent-Key abcdef0123456789abcdef0123456789');
    assert.deepStrictEqual(create.body.ports, { type: 'tunnel-type', details: 'minecraft-java' });
    assert.strictEqual(create.body.origin.data.agent_id, '11111111-2222-3333-4444-555555555555');
    assert.deepStrictEqual(create.body.origin.data.config.fields, [{ name: 'local_ip', value: '127.0.0.1' }, { name: 'local_port', value: '25570' }]);
    assert.strictEqual(create.body.name, 'CraftDock Survival  bello');
    // seconda volta: riusa il tunnel esistente, nessuna nuova creazione
    await pm.ensureTunnel(25570, 'x');
    assert.strictEqual(calls.filter((c) => c.path === '/v1/tunnels/create').length, 1);
  } finally {
    srv.close();
    delete process.env.CRAFTDOCK_PLAYIT_API;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

(async () => {
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); } catch (e) { console.error('  ✗ ' + t.name + '\n    ' + (e.stack || e)); process.exitCode = 1; }
  }
  console.log(`\n${passed}/${tests.length} test superati`);
})();
