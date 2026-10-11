'use strict';
/* Schemi: proprietà del server, game rule (con i nomi nuovi dalla 1.21.11), comandi per l'autocompletamento. */

const PROP_CATS = [
  { id: 'all', label: 'Tutte' },
  { id: 'game', label: 'Gioco' },
  { id: 'players', label: 'Giocatori' },
  { id: 'world', label: 'Mondo' },
  { id: 'perf', label: 'Prestazioni' },
  { id: 'pack', label: 'Pacchetto risorse' },
  { id: 'net', label: 'Rete e sicurezza' },
];

/**
 * type: bool | number | select | text | motd | password
 * live: comando da eseguire a server acceso per applicare subito (riceve il valore)
 * invert: il toggle mostra il contrario del valore (es. "Craccato" = online-mode=false)
 * ifPresent: mostra solo se la chiave esiste nel file (proprietà che cambiano tra le versioni)
 */
const PROPS = [
  { key: 'motd', label: 'Messaggio del server (MOTD)', type: 'motd', cat: 'game', wide: true, help: 'Il testo sotto il nome del server nella lista multigiocatore. Usa i colori con §.' },
  { key: 'max-players', label: 'Max. giocatori', type: 'number', min: 1, max: 1000, icon: 'users', cat: 'players' },
  { key: 'gamemode', label: 'Modalità di gioco', type: 'select', cat: 'game', options: [['survival', 'Sopravvivenza'], ['creative', 'Creativa'], ['adventure', 'Avventura'], ['spectator', 'Spettatore']], live: (v) => `defaultgamemode ${v}` },
  { key: 'difficulty', label: 'Difficoltà', type: 'select', cat: 'game', options: [['peaceful', 'Pacifica'], ['easy', 'Facile'], ['normal', 'Normale'], ['hard', 'Difficile']], live: (v) => `difficulty ${v}` },
  { key: 'white-list', label: 'Lista dei giocatori consentiti', type: 'bool', cat: 'players', live: (v) => `whitelist ${v === 'true' ? 'on' : 'off'}`, help: 'Solo i giocatori nella whitelist possono entrare. Gestiscila nella scheda Giocatori.' },
  { key: 'online-mode', label: 'Craccato', type: 'bool', invert: true, cat: 'players', help: 'Attivo = possono entrare anche account non premium. Disattivalo se tutti hanno Minecraft originale (più sicuro). Cambiare questa opzione cambia gli UUID dei giocatori!' },
  { key: 'allow-flight', label: 'Volo', type: 'bool', cat: 'game', help: 'Evita che i giocatori vengano espulsi per "volo" (consigliato con mod come jetpack o mantelli).' },
  { key: 'force-gamemode', label: 'Modalità di gioco forzata', type: 'bool', cat: 'game', help: 'Rimette la modalità predefinita a ogni accesso.' },
  { key: 'spawn-protection', label: 'Protezione della zona iniziale', type: 'number', min: 0, max: 1000, icon: 'shield', cat: 'world', help: 'Raggio attorno allo spawn in cui solo gli operatori possono costruire. 0 = disattivata.' },
  { key: 'hardcore', label: 'Hardcore', type: 'bool', cat: 'game', help: 'Alla morte si diventa spettatori. Vale per mondi nuovi.' },
  { key: 'pvp', label: 'PvP', type: 'bool', cat: 'game', ifPresent: true, help: 'Dalla 1.21.9 il PvP è una game rule: usa i Controlli rapidi.' },
  { key: 'allow-nether', label: 'Nether', type: 'bool', cat: 'world', ifPresent: true },
  { key: 'spawn-monsters', label: 'Mostri', type: 'bool', cat: 'world', ifPresent: true },
  { key: 'spawn-animals', label: 'Animali', type: 'bool', cat: 'world', ifPresent: true },
  { key: 'spawn-npcs', label: 'Villici', type: 'bool', cat: 'world', ifPresent: true },
  { key: 'view-distance', label: 'Distanza di rendering', type: 'number', min: 2, max: 32, icon: 'eye', cat: 'perf', help: 'Chunk inviati ai giocatori. Più alto = più bello ma più RAM/CPU. 8-12 consigliato.' },
  { key: 'simulation-distance', label: 'Distanza di simulazione', type: 'number', min: 3, max: 32, icon: 'cpu', cat: 'perf', help: 'Chunk in cui mob e redstone sono attivi.' },
  { key: 'pause-when-empty-seconds', label: 'Pausa a server vuoto (secondi)', type: 'number', min: -1, max: 86400, cat: 'perf', ifPresent: true, help: 'Dopo quanti secondi senza giocatori il server mette in pausa il mondo. -1 = mai.' },
  { key: 'entity-broadcast-range-percentage', label: 'Distanza visibilità entità (%)', type: 'number', min: 10, max: 1000, cat: 'perf' },
  { key: 'sync-chunk-writes', label: 'Scrittura chunk sincrona', type: 'bool', cat: 'perf', help: 'Più sicuro contro la corruzione, ma più lento su dischi meccanici.' },
  { key: 'max-tick-time', label: 'Watchdog (ms)', type: 'number', min: -1, max: 600000, cat: 'perf', help: 'Spegne il server se un tick dura più di così. -1 disattiva (utile con modpack pesanti).' },
  { key: 'network-compression-threshold', label: 'Soglia compressione rete', type: 'number', min: -1, max: 65536, cat: 'perf' },
  { key: 'player-idle-timeout', label: 'Espelli inattivi dopo (minuti)', type: 'number', min: 0, max: 1440, cat: 'players', help: '0 = mai.' },
  { key: 'op-permission-level', label: 'Livello permessi operatori', type: 'select', cat: 'players', options: [['1', '1 – ignora protezione spawn'], ['2', '2 – comandi base e command block'], ['3', '3 – comandi multiplayer (kick, ban)'], ['4', '4 – tutti i comandi']] },
  { key: 'enable-command-block', label: 'Command block', type: 'bool', cat: 'game' },
  { key: 'level-seed', label: 'Seed del mondo', type: 'text', cat: 'world', placeholder: 'casuale', help: 'Vale solo quando viene generato un mondo nuovo.' },
  { key: 'level-type', label: 'Tipo di mondo', type: 'select', cat: 'world', options: [['minecraft:normal', 'Normale'], ['minecraft:flat', 'Piatto'], ['minecraft:large_biomes', 'Biomi grandi'], ['minecraft:amplified', 'Amplificato'], ['minecraft:single_biome_surface', 'Bioma singolo']], help: 'Vale solo per mondi nuovi. Con alcune mod ci sono altri tipi: modificalo in "Altre proprietà".' },
  { key: 'generate-structures', label: 'Genera strutture', type: 'bool', cat: 'world' },
  { key: 'max-world-size', label: 'Dimensione massima mondo', type: 'number', min: 1, max: 29999984, cat: 'world' },
  { key: 'require-resource-pack', label: 'Pacchetto di risorse richiesto', type: 'bool', cat: 'pack' },
  { key: 'resource-pack', label: 'Pacchetto di risorse', type: 'text', cat: 'pack', wide: true, placeholder: 'https://example.com/resource-pack.zip', icon: 'fileCode' },
  { key: 'resource-pack-sha1', label: 'SHA-1 del pacchetto', type: 'text', cat: 'pack', placeholder: 'opzionale' },
  { key: 'resource-pack-prompt', label: 'Messaggio pacchetto di risorse', type: 'text', cat: 'pack', wide: true, placeholder: 'Testo mostrato quando il server propone il pacchetto' },
  { key: 'server-port', label: 'Porta', type: 'number', min: 1024, max: 65535, cat: 'net', help: 'Porta locale del server. Con più server accesi ognuno deve averne una diversa.' },
  { key: 'enable-status', label: 'Visibile nella lista server', type: 'bool', cat: 'net' },
  { key: 'hide-online-players', label: 'Nascondi giocatori online', type: 'bool', cat: 'net' },
  { key: 'enforce-secure-profile', label: 'Profilo chat sicuro obbligatorio', type: 'bool', cat: 'net', help: 'Disattivalo se i giocatori vengono espulsi con errori di firma chat (comune con server craccati o mod).' },
  { key: 'enforce-whitelist', label: 'Applica whitelist ai già connessi', type: 'bool', cat: 'net' },
  { key: 'prevent-proxy-connections', label: 'Blocca connessioni da proxy/VPN', type: 'bool', cat: 'net' },
  { key: 'log-ips', label: 'Registra IP nei log', type: 'bool', cat: 'net', ifPresent: true },
  { key: 'accepts-transfers', label: 'Accetta trasferimenti', type: 'bool', cat: 'net', ifPresent: true },
  { key: 'enable-rcon', label: 'RCON', type: 'bool', cat: 'net' },
  { key: 'rcon.port', label: 'Porta RCON', type: 'number', min: 1024, max: 65535, cat: 'net' },
  { key: 'rcon.password', label: 'Password RCON', type: 'password', cat: 'net' },
  { key: 'enable-query', label: 'Query (GameSpy4)', type: 'bool', cat: 'net' },
  { key: 'broadcast-console-to-ops', label: 'Mostra output console agli operatori', type: 'bool', cat: 'net' },
];
const HIDDEN_PROPS = ['level-name'];

/**
 * Game rule. old = nome fino alla 1.21.10, neu = nome dalla 1.21.11 (null = non esiste).
 * since = versione minima; inv = valore invertito nel vecchio nome.
 */
const GAMERULES = [
  { old: 'keepInventory', neu: 'keep_inventory', type: 'bool', label: 'Mantieni inventario alla morte', icon: 'heart' },
  { old: 'doDaylightCycle', neu: 'advance_time', type: 'bool', label: 'Ciclo giorno/notte', icon: 'sun' },
  { old: 'doWeatherCycle', neu: 'advance_weather', type: 'bool', label: 'Meteo dinamico', icon: 'cloud' },
  { old: 'doMobSpawning', neu: 'spawn_mobs', type: 'bool', label: 'Generazione mob' },
  { old: 'mobGriefing', neu: 'mob_griefing', type: 'bool', label: 'Mob distruttivi (creeper, enderman)' },
  { old: null, neu: 'pvp', since: '1.21.9', type: 'bool', label: 'PvP tra giocatori', icon: 'sword' },
  { old: 'doFireTick', neu: null, type: 'bool', label: 'Propagazione del fuoco' },
  { old: 'doImmediateRespawn', neu: 'immediate_respawn', type: 'bool', label: 'Respawn immediato' },
  { old: 'naturalRegeneration', neu: 'natural_health_regeneration', type: 'bool', label: 'Rigenerazione naturale' },
  { old: 'fallDamage', neu: 'fall_damage', type: 'bool', label: 'Danno da caduta' },
  { old: 'doInsomnia', neu: 'spawn_phantoms', type: 'bool', label: 'Phantom' },
  { old: 'disableRaids', neu: 'raids', inv: true, type: 'bool', label: 'Incursioni (raid)' },
  { old: 'doPatrolSpawning', neu: 'spawn_patrols', type: 'bool', label: 'Pattuglie di predoni' },
  { old: 'doTraderSpawning', neu: 'spawn_wandering_traders', type: 'bool', label: 'Venditore ambulante' },
  { old: 'doTileDrops', neu: 'block_drops', type: 'bool', label: 'Drop dei blocchi' },
  { old: 'doMobLoot', neu: 'mob_drops', type: 'bool', label: 'Drop dei mob' },
  { old: 'showDeathMessages', neu: 'show_death_messages', type: 'bool', label: 'Messaggi di morte' },
  { old: 'announceAdvancements', neu: 'show_advancement_messages', type: 'bool', label: 'Annuncia progressi' },
  { old: 'locatorBar', neu: 'locator_bar', since: '1.21.6', type: 'bool', label: 'Barra localizzatore' },
  { old: 'commandBlockOutput', neu: 'command_block_output', type: 'bool', label: 'Output command block in chat' },
  { old: 'sendCommandFeedback', neu: 'send_command_feedback', type: 'bool', label: 'Feedback dei comandi' },
  { old: 'spectatorsGenerateChunks', neu: 'spectators_generate_chunks', type: 'bool', label: 'Gli spettatori generano chunk' },
  { old: 'playersSleepingPercentage', neu: 'players_sleeping_percentage', since: '1.17', type: 'int', label: '% giocatori che devono dormire', min: 0, max: 100 },
  { old: 'randomTickSpeed', neu: 'random_tick_speed', type: 'int', label: 'Velocità tick casuali (crescita)', min: 0, max: 4096 },
  { old: 'spawnRadius', neu: 'respawn_radius', type: 'int', label: 'Raggio di spawn', min: 0, max: 128 },
];

function vcmp(a, b) {
  const pa = String(a).split(/[-+ ]/)[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(/[-+ ]/)[0].split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  }
  return 0;
}

/** Game rule valide per una versione, con il nome corretto. */
function gameRulesFor(mcVersion) {
  const v = mcVersion || '1.21.1';
  const modern = vcmp(v, '1.21.11') >= 0;
  return GAMERULES
    .filter((g) => !g.since || vcmp(v, g.since) >= 0)
    .map((g) => Object.assign({}, g, { name: modern ? g.neu : g.old, invert: !modern && g.inv }))
    .filter((g) => g.name);
}

const COMMANDS = [
  ['help', 'Elenco comandi'], ['list', 'Giocatori online'], ['say <messaggio>', 'Messaggio a tutti'], ['tell <giocatore> <messaggio>', 'Messaggio privato'],
  ['op <giocatore>', 'Rendi operatore'], ['deop <giocatore>', 'Togli operatore'], ['kick <giocatore> [motivo]', 'Espelli'], ['ban <giocatore> [motivo]', 'Banna'],
  ['pardon <giocatore>', 'Revoca ban'], ['ban-ip <ip>', 'Banna IP'], ['pardon-ip <ip>', 'Revoca ban IP'], ['banlist', 'Elenco ban'],
  ['whitelist add <giocatore>', 'Aggiungi alla whitelist'], ['whitelist remove <giocatore>', 'Rimuovi dalla whitelist'], ['whitelist on', 'Attiva whitelist'], ['whitelist off', 'Disattiva whitelist'], ['whitelist list', 'Mostra whitelist'], ['whitelist reload', 'Ricarica whitelist'],
  ['gamemode survival <giocatore>', 'Sopravvivenza'], ['gamemode creative <giocatore>', 'Creativa'], ['gamemode adventure <giocatore>', 'Avventura'], ['gamemode spectator <giocatore>', 'Spettatore'],
  ['defaultgamemode <modalità>', 'Modalità predefinita'], ['difficulty <peaceful|easy|normal|hard>', 'Difficoltà'],
  ['gamerule <regola> [valore]', 'Leggi/imposta game rule'], ['time set day', 'Giorno'], ['time set noon', 'Mezzogiorno'], ['time set night', 'Notte'], ['time set midnight', 'Mezzanotte'], ['time add <tick>', 'Avanza il tempo'],
  ['weather clear', 'Sereno'], ['weather rain', 'Pioggia'], ['weather thunder', 'Temporale'],
  ['tp <giocatore> <destinazione>', 'Teletrasporta'], ['give <giocatore> <oggetto> [quantità]', 'Dai oggetto'], ['clear <giocatore>', 'Svuota inventario'], ['kill <bersaglio>', 'Uccidi'],
  ['effect give <giocatore> <effetto> [secondi] [livello]', 'Effetto'], ['enchant <giocatore> <incantesimo> [livello]', 'Incanta'], ['xp add <giocatore> <quantità> levels', 'Esperienza'],
  ['setworldspawn', 'Imposta spawn del mondo'], ['spawnpoint <giocatore>', 'Imposta punto di respawn'], ['locate structure <struttura>', 'Trova struttura'], ['seed', 'Mostra seed'],
  ['worldborder set <diametro>', 'Bordo del mondo'], ['save-all', 'Salva il mondo'], ['save-all flush', 'Salva subito su disco'], ['save-off', 'Disattiva salvataggio'], ['save-on', 'Attiva salvataggio'],
  ['reload', 'Ricarica datapack'], ['datapack list', 'Elenco datapack'], ['tick query', 'Prestazioni dei tick'], ['tick freeze', 'Congela il gioco'], ['tick unfreeze', 'Riprendi il gioco'],
  ['forceload add <x> <z>', 'Chunk sempre caricato'], ['stop', 'Spegni il server'],
];

// Comandi che servono per i "modloader": Forge/NeoForge e Fabric con mod comuni
const MOD_COMMANDS = {
  forge: [['forge tps', 'TPS per dimensione'], ['forge entity list', 'Entità caricate']],
  neoforge: [['neoforge tps', 'TPS per dimensione'], ['neoforge entity list', 'Entità caricate']],
  paper: [['tps', 'TPS del server'], ['plugins', 'Plugin installati'], ['version', 'Versione Paper'], ['timings report', 'Report prestazioni'], ['spark profiler', 'Profiler (se installato)']],
  purpur: [['tps', 'TPS del server'], ['plugins', 'Plugin installati'], ['version', 'Versione']],
  fabric: [['spark tps', 'TPS (con mod spark)']],
  quilt: [['spark tps', 'TPS (con mod spark)']],
};
