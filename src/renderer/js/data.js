'use strict';
/* Schemi: proprietà del server, game rule (con i nomi nuovi dalla 1.21.11), comandi per l'autocompletamento. */

const PROP_CATS = [
  { id: 'all', label: t('Tutte') },
  { id: 'game', label: t('Gioco') },
  { id: 'players', label: t('Giocatori') },
  { id: 'world', label: t('Mondo') },
  { id: 'perf', label: t('Prestazioni') },
  { id: 'pack', label: t('Pacchetto risorse') },
  { id: 'net', label: t('Rete e sicurezza') },
];

/**
 * type: bool | number | select | text | motd | password
 * live: comando da eseguire a server acceso per applicare subito (riceve il valore)
 * invert: il toggle mostra il contrario del valore (es. "Craccato" = online-mode=false)
 * ifPresent: mostra solo se la chiave esiste nel file (proprietà che cambiano tra le versioni)
 */
const PROPS = [
  { key: 'motd', label: t('Messaggio del server (MOTD)'), type: 'motd', cat: 'game', wide: true, help: t('Il testo sotto il nome del server nella lista multigiocatore. Usa i colori con §.') },
  { key: 'max-players', label: t('Max. giocatori'), type: 'number', min: 1, max: 1000, icon: 'users', cat: 'players' },
  { key: 'gamemode', label: t('Modalità di gioco'), type: 'select', cat: 'game', options: [['survival', t('Sopravvivenza')], ['creative', t('Creativa')], ['adventure', t('Avventura')], ['spectator', t('Spettatore')]], live: (v) => `defaultgamemode ${v}` },
  { key: 'difficulty', label: t('Difficoltà'), type: 'select', cat: 'game', options: [['peaceful', t('Pacifica')], ['easy', t('Facile')], ['normal', t('Normale')], ['hard', t('Difficile')]], live: (v) => `difficulty ${v}` },
  { key: 'white-list', label: t('Lista dei giocatori consentiti'), type: 'bool', cat: 'players', live: (v) => `whitelist ${v === 'true' ? 'on' : 'off'}`, help: t('Solo i giocatori nella whitelist possono entrare. Gestiscila nella scheda Giocatori.') },
  { key: 'online-mode', label: t('Craccato'), type: 'bool', invert: true, cat: 'players', help: t('Attivo = possono entrare anche account non premium. Disattivalo se tutti hanno Minecraft originale (più sicuro). Cambiare questa opzione cambia gli UUID dei giocatori!') },
  { key: 'allow-flight', label: t('Volo'), type: 'bool', cat: 'game', help: t('Evita che i giocatori vengano espulsi per "volo" (consigliato con mod come jetpack o mantelli).') },
  { key: 'force-gamemode', label: t('Modalità di gioco forzata'), type: 'bool', cat: 'game', help: t('Rimette la modalità predefinita a ogni accesso.') },
  { key: 'spawn-protection', label: t('Protezione della zona iniziale'), type: 'number', min: 0, max: 1000, icon: 'shield', cat: 'world', help: t('Raggio attorno allo spawn in cui solo gli operatori possono costruire. 0 = disattivata.') },
  { key: 'hardcore', label: t('Hardcore'), type: 'bool', cat: 'game', help: t('Alla morte si diventa spettatori. Vale per mondi nuovi.') },
  { key: 'pvp', label: t('PvP'), type: 'bool', cat: 'game', ifPresent: true, help: t('Dalla 1.21.9 il PvP è una game rule: usa i Controlli rapidi.') },
  { key: 'allow-nether', label: t('Nether'), type: 'bool', cat: 'world', ifPresent: true },
  { key: 'spawn-monsters', label: t('Mostri'), type: 'bool', cat: 'world', ifPresent: true },
  { key: 'spawn-animals', label: t('Animali'), type: 'bool', cat: 'world', ifPresent: true },
  { key: 'spawn-npcs', label: t('Villici'), type: 'bool', cat: 'world', ifPresent: true },
  { key: 'view-distance', label: t('Distanza di rendering'), type: 'number', min: 2, max: 32, icon: 'eye', cat: 'perf', help: t('Chunk inviati ai giocatori. Più alto = più bello ma più RAM/CPU. 8-12 consigliato.') },
  { key: 'simulation-distance', label: t('Distanza di simulazione'), type: 'number', min: 3, max: 32, icon: 'cpu', cat: 'perf', help: t('Chunk in cui mob e redstone sono attivi.') },
  { key: 'pause-when-empty-seconds', label: t('Pausa a server vuoto (secondi)'), type: 'number', min: -1, max: 86400, cat: 'perf', ifPresent: true, help: t('Dopo quanti secondi senza giocatori il server mette in pausa il mondo. -1 = mai.') },
  { key: 'entity-broadcast-range-percentage', label: t('Distanza visibilità entità (%)'), type: 'number', min: 10, max: 1000, cat: 'perf' },
  { key: 'sync-chunk-writes', label: t('Scrittura chunk sincrona'), type: 'bool', cat: 'perf', help: t('Più sicuro contro la corruzione, ma più lento su dischi meccanici.') },
  { key: 'max-tick-time', label: t('Watchdog (ms)'), type: 'number', min: -1, max: 600000, cat: 'perf', help: t('Spegne il server se un tick dura più di così. -1 disattiva (utile con modpack pesanti).') },
  { key: 'network-compression-threshold', label: t('Soglia compressione rete'), type: 'number', min: -1, max: 65536, cat: 'perf' },
  { key: 'player-idle-timeout', label: t('Espelli inattivi dopo (minuti)'), type: 'number', min: 0, max: 1440, cat: 'players', help: t('0 = mai.') },
  { key: 'op-permission-level', label: t('Livello permessi operatori'), type: 'select', cat: 'players', options: [['1', t('1 – ignora protezione spawn')], ['2', t('2 – comandi base e command block')], ['3', t('3 – comandi multiplayer (kick, ban)')], ['4', t('4 – tutti i comandi')]] },
  { key: 'enable-command-block', label: t('Command block'), type: 'bool', cat: 'game' },
  { key: 'level-seed', label: t('Seed del mondo'), type: 'text', cat: 'world', placeholder: 'casuale', help: t('Vale solo quando viene generato un mondo nuovo.') },
  { key: 'level-type', label: t('Tipo di mondo'), type: 'select', cat: 'world', options: [['minecraft:normal', t('Normale')], ['minecraft:flat', t('Piatto')], ['minecraft:large_biomes', t('Biomi grandi')], ['minecraft:amplified', t('Amplificato')], ['minecraft:single_biome_surface', t('Bioma singolo')]], help: t('Vale solo per mondi nuovi. Con alcune mod ci sono altri tipi: modificalo in "Altre proprietà".') },
  { key: 'generate-structures', label: t('Genera strutture'), type: 'bool', cat: 'world' },
  { key: 'max-world-size', label: t('Dimensione massima mondo'), type: 'number', min: 1, max: 29999984, cat: 'world' },
  { key: 'require-resource-pack', label: t('Pacchetto di risorse richiesto'), type: 'bool', cat: 'pack' },
  { key: 'resource-pack', label: t('Pacchetto di risorse'), type: 'text', cat: 'pack', wide: true, placeholder: 'https://example.com/resource-pack.zip', icon: 'fileCode' },
  { key: 'resource-pack-sha1', label: t('SHA-1 del pacchetto'), type: 'text', cat: 'pack', placeholder: 'opzionale' },
  { key: 'resource-pack-prompt', label: t('Messaggio pacchetto di risorse'), type: 'text', cat: 'pack', wide: true, placeholder: t('Testo mostrato quando il server propone il pacchetto') },
  { key: 'server-port', label: t('Porta'), type: 'number', min: 1024, max: 65535, cat: 'net', help: t('Porta locale del server. Con più server accesi ognuno deve averne una diversa.') },
  { key: 'enable-status', label: t('Visibile nella lista server'), type: 'bool', cat: 'net' },
  { key: 'hide-online-players', label: t('Nascondi giocatori online'), type: 'bool', cat: 'net' },
  { key: 'enforce-secure-profile', label: t('Profilo chat sicuro obbligatorio'), type: 'bool', cat: 'net', help: t('Disattivalo se i giocatori vengono espulsi con errori di firma chat (comune con server craccati o mod).') },
  { key: 'enforce-whitelist', label: t('Applica whitelist ai già connessi'), type: 'bool', cat: 'net' },
  { key: 'prevent-proxy-connections', label: t('Blocca connessioni da proxy/VPN'), type: 'bool', cat: 'net' },
  { key: 'log-ips', label: t('Registra IP nei log'), type: 'bool', cat: 'net', ifPresent: true },
  { key: 'accepts-transfers', label: t('Accetta trasferimenti'), type: 'bool', cat: 'net', ifPresent: true },
  { key: 'enable-rcon', label: t('RCON'), type: 'bool', cat: 'net' },
  { key: 'rcon.port', label: t('Porta RCON'), type: 'number', min: 1024, max: 65535, cat: 'net' },
  { key: 'rcon.password', label: t('Password RCON'), type: 'password', cat: 'net' },
  { key: 'enable-query', label: t('Query (GameSpy4)'), type: 'bool', cat: 'net' },
  { key: 'broadcast-console-to-ops', label: t('Mostra output console agli operatori'), type: 'bool', cat: 'net' },
];
const HIDDEN_PROPS = ['level-name'];

/**
 * Game rule. old = nome fino alla 1.21.10, neu = nome dalla 1.21.11 (null = non esiste).
 * since = versione minima; inv = valore invertito nel vecchio nome.
 */
const GAMERULES = [
  { old: 'keepInventory', neu: 'keep_inventory', type: 'bool', label: t('Mantieni inventario alla morte'), icon: 'heart' },
  { old: 'doDaylightCycle', neu: 'advance_time', type: 'bool', label: t('Ciclo giorno/notte'), icon: 'sun' },
  { old: 'doWeatherCycle', neu: 'advance_weather', type: 'bool', label: t('Meteo dinamico'), icon: 'cloud' },
  { old: 'doMobSpawning', neu: 'spawn_mobs', type: 'bool', label: t('Generazione mob') },
  { old: 'mobGriefing', neu: 'mob_griefing', type: 'bool', label: t('Mob distruttivi (creeper, enderman)') },
  { old: null, neu: 'pvp', since: '1.21.9', type: 'bool', label: t('PvP tra giocatori'), icon: 'sword' },
  { old: 'doFireTick', neu: null, type: 'bool', label: t('Propagazione del fuoco') },
  { old: 'doImmediateRespawn', neu: 'immediate_respawn', type: 'bool', label: t('Respawn immediato') },
  { old: 'naturalRegeneration', neu: 'natural_health_regeneration', type: 'bool', label: t('Rigenerazione naturale') },
  { old: 'fallDamage', neu: 'fall_damage', type: 'bool', label: t('Danno da caduta') },
  { old: 'doInsomnia', neu: 'spawn_phantoms', type: 'bool', label: t('Phantom') },
  { old: 'disableRaids', neu: 'raids', inv: true, type: 'bool', label: t('Incursioni (raid)') },
  { old: 'doPatrolSpawning', neu: 'spawn_patrols', type: 'bool', label: t('Pattuglie di predoni') },
  { old: 'doTraderSpawning', neu: 'spawn_wandering_traders', type: 'bool', label: t('Venditore ambulante') },
  { old: 'doTileDrops', neu: 'block_drops', type: 'bool', label: t('Drop dei blocchi') },
  { old: 'doMobLoot', neu: 'mob_drops', type: 'bool', label: t('Drop dei mob') },
  { old: 'showDeathMessages', neu: 'show_death_messages', type: 'bool', label: t('Messaggi di morte') },
  { old: 'announceAdvancements', neu: 'show_advancement_messages', type: 'bool', label: t('Annuncia progressi') },
  { old: 'locatorBar', neu: 'locator_bar', since: '1.21.6', type: 'bool', label: t('Barra localizzatore') },
  { old: 'commandBlockOutput', neu: 'command_block_output', type: 'bool', label: t('Output command block in chat') },
  { old: 'sendCommandFeedback', neu: 'send_command_feedback', type: 'bool', label: t('Feedback dei comandi') },
  { old: 'spectatorsGenerateChunks', neu: 'spectators_generate_chunks', type: 'bool', label: t('Gli spettatori generano chunk') },
  { old: 'playersSleepingPercentage', neu: 'players_sleeping_percentage', since: '1.17', type: 'int', label: t('% giocatori che devono dormire'), min: 0, max: 100 },
  { old: 'randomTickSpeed', neu: 'random_tick_speed', type: 'int', label: t('Velocità tick casuali (crescita)'), min: 0, max: 4096 },
  { old: 'spawnRadius', neu: 'respawn_radius', type: 'int', label: t('Raggio di spawn'), min: 0, max: 128 },
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
  ['help', t('Elenco comandi')], ['list', t('Giocatori online')], [t('say <messaggio>'), t('Messaggio a tutti')], [t('tell <giocatore> <messaggio>'), t('Messaggio privato')],
  [t('op <giocatore>'), t('Rendi operatore')], [t('deop <giocatore>'), t('Togli operatore')], [t('kick <giocatore> [motivo]'), t('Espelli')], [t('ban <giocatore> [motivo]'), t('Banna')],
  [t('pardon <giocatore>'), t('Revoca ban')], [t('ban-ip <ip>'), t('Banna IP')], [t('pardon-ip <ip>'), t('Revoca ban IP')], ['banlist', t('Elenco ban')],
  [t('whitelist add <giocatore>'), t('Aggiungi alla whitelist')], [t('whitelist remove <giocatore>'), t('Rimuovi dalla whitelist')], ['whitelist on', t('Attiva whitelist')], ['whitelist off', t('Disattiva whitelist')], ['whitelist list', t('Mostra whitelist')], ['whitelist reload', t('Ricarica whitelist')],
  [t('gamemode survival <giocatore>'), t('Sopravvivenza')], [t('gamemode creative <giocatore>'), t('Creativa')], [t('gamemode adventure <giocatore>'), t('Avventura')], [t('gamemode spectator <giocatore>'), t('Spettatore')],
  [t('defaultgamemode <modalità>'), t('Modalità predefinita')], [t('difficulty <peaceful|easy|normal|hard>'), t('Difficoltà')],
  [t('gamerule <regola> [valore]'), t('Leggi/imposta game rule')], ['time set day', t('Giorno')], ['time set noon', t('Mezzogiorno')], ['time set night', t('Notte')], ['time set midnight', t('Mezzanotte')], [t('time add <tick>'), t('Avanza il tempo')],
  ['weather clear', t('Sereno')], ['weather rain', t('Pioggia')], ['weather thunder', t('Temporale')],
  [t('tp <giocatore> <destinazione>'), t('Teletrasporta')], [t('give <giocatore> <oggetto> [quantità]'), t('Dai oggetto')], [t('clear <giocatore>'), t('Svuota inventario')], [t('kill <bersaglio>'), t('Uccidi')],
  [t('effect give <giocatore> <effetto> [secondi] [livello]'), t('Effetto')], [t('enchant <giocatore> <incantesimo> [livello]'), t('Incanta')], [t('xp add <giocatore> <quantità> levels'), t('Esperienza')],
  ['setworldspawn', t('Imposta spawn del mondo')], [t('spawnpoint <giocatore>'), t('Imposta punto di respawn')], [t('locate structure <struttura>'), t('Trova struttura')], ['seed', t('Mostra seed')],
  [t('worldborder set <diametro>'), t('Bordo del mondo')], ['save-all', t('Salva il mondo')], ['save-all flush', t('Salva subito su disco')], ['save-off', t('Disattiva salvataggio')], ['save-on', t('Attiva salvataggio')],
  ['reload', t('Ricarica datapack')], ['datapack list', t('Elenco datapack')], ['tick query', t('Prestazioni dei tick')], ['tick freeze', t('Congela il gioco')], ['tick unfreeze', t('Riprendi il gioco')],
  [t('forceload add <x> <z>'), t('Chunk sempre caricato')], ['stop', t('Spegni il server')],
];

// Comandi che servono per i "modloader": Forge/NeoForge e Fabric con mod comuni
const MOD_COMMANDS = {
  forge: [['forge tps', t('TPS per dimensione')], ['forge entity list', t('Entità caricate')]],
  neoforge: [['neoforge tps', t('TPS per dimensione')], ['neoforge entity list', t('Entità caricate')]],
  paper: [['tps', t('TPS del server')], ['plugins', t('Plugin installati')], ['version', t('Versione Paper')], ['timings report', t('Report prestazioni')], ['spark profiler', t('Profiler (se installato)')]],
  purpur: [['tps', t('TPS del server')], ['plugins', t('Plugin installati')], ['version', t('Versione')]],
  fabric: [['spark tps', t('TPS (con mod spark)')]],
  quilt: [['spark tps', t('TPS (con mod spark)')]],
};
