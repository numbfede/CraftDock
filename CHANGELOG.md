# Novità di CraftDock

Ogni versione ha le note in italiano e in inglese. Il workflow Release usa la sezione della
versione in `package.json` come testo della release su GitHub, e il sito la mostra nella pagina Novità.

## 1.3.0 (2026-10-24)

### Italiano
- **Versione per macOS** (Apple Silicon e Intel, macOS 11 o successivo). Su Mac l'agente playit.gg si prepara una volta dalla pagina Connessione amici.
- **Interfaccia in inglese.** La lingua segue quella di Windows; si cambia in Impostazioni → Lingua.
- **Aggiornamenti dall'app.** Quando esce una nuova versione compare un avviso: "Aggiorna ora" scarica l'installer, ferma i server in modo sicuro e riapre CraftDock aggiornato. Il controllo si può disattivare.
- **Pianificazione.** Nuova scheda per ogni server: riavvii, backup, messaggi in chat, comandi, accensione e spegnimento a orario, nei giorni che scegli. Riavvio e spegnimento avvisano i giocatori 5 e 1 minuto prima.
- **Supporto.** In Impostazioni c'è "Copia informazioni per il supporto" (versioni, sistema, server, ultime righe del log, senza il tuo nome utente) e il pulsante per aprire la cartella dei log.
- **Importa cartella senza .jar.** Le cartelle scaricate da Aternos o da altri hosting (mondo, mod e impostazioni ma senza il programma del server) ora si importano: CraftDock riconosce tipo e versione dai file e scarica il server che manca.
- **Pacchetto per gli amici.** Nella scheda Mod (e in Connessione amici) crea un file .mrpack da importare in Modrinth App o Prism, con la stessa versione di Minecraft, il loader e le mod che servono per entrare. Le mod solo-server restano fuori.
- **Tunnel senza server.** Se un indirizzo playit porta a una porta dove non c'è nessun server, CraftDock lo segnala e con "Usa per…" sposta il server su quella porta. Le cartelle importate tornano sulla porta 25565.
- Avvisi di playit.gg (verifica email) tradotti e spiegati; il pulsante "Crea indirizzo" ricompare per i server senza tunnel.
- **Crea un server dal tuo launcher.** Nuova opzione "Dal tuo launcher": CraftDock trova i profili di launcher ufficiale, Modrinth App, Prism, CurseForge e ATLauncher, divide le mod in "sul server", "da controllare" e "solo nel gioco" (con i dati di Modrinth) e crea il server con la stessa versione e lo stesso loader. Le mod da gioco, gli shader e i resource pack finiscono nel pacchetto amici; un resource pack pubblicato su Modrinth può essere imposto dal server.
- **Sposta i backup su un altro disco.** In Impostazioni → Backup (o dalla scheda Backup) scegli una nuova cartella, anche su un disco esterno: CraftDock mostra quanto spazio serve, chiede conferma, copia e verifica i backup e solo alla fine cancella gli originali.
- **Eliminazione automatica dei backup vecchi.** Nella scheda Backup scegli quanti tenerne (3, 5, 10, 20, 50 o tutti) e se contare anche quelli manuali.
- Corretti due difetti grafici nella creazione da modpack (pulsante "Scegli file…" e etichetta accanto a CurseForge).
- Il registro dell'app viene salvato su file, utile quando qualcosa va storto.
- Installer con nome fisso: il link di download del sito porta sempre all'ultima versione.

### English
- **macOS version** (Apple Silicon and Intel, macOS 11 or later). On a Mac the playit.gg agent is prepared once from the Friends connection page.
- **English interface.** The language follows Windows; change it in Settings → Language.
- **In-app updates.** When a new version is out you get a notice: "Update now" downloads the installer, stops servers safely and reopens the updated CraftDock. The check can be turned off.
- **Schedule.** New tab for every server: restarts, backups, chat messages, commands, start and stop at a set time, on the days you pick. Restarts and stops warn players 5 and 1 minute before.
- **Support.** Settings has "Copy support info" (versions, system, servers, last log lines, without your user name) and a button to open the logs folder.
- **Import a folder without the .jar.** Folders downloaded from Aternos or other hosts (world, mods and settings but no server program) can now be imported: CraftDock works out type and version from the files and downloads the missing server.
- **Friends pack.** In the Mods tab (and on Friends connection) create a .mrpack to import in Modrinth App or Prism, with the same Minecraft version, loader and the mods needed to join. Server-only mods are left out.
- **Tunnels without a server.** If a playit address points to a port with no server, CraftDock flags it and "Use for…" moves the server to that port. Imported folders go back to port 25565.
- playit.gg notices (email verification) are translated and explained; the "Create address" button shows again for servers without a tunnel.
- **Create a server from your launcher.** New "From your launcher" option: CraftDock finds profiles from the official launcher, Modrinth App, Prism, CurseForge and ATLauncher, splits mods into "on the server", "to check" and "game only" (using Modrinth data) and creates the server with the same version and loader. Game-only mods, shaders and resource packs go in the friends pack; a resource pack published on Modrinth can be enforced by the server.
- **Move backups to another drive.** In Settings → Backups (or from the Backups tab) pick a new folder, even on an external drive: CraftDock shows the space needed, asks for confirmation, copies and verifies the backups and only then deletes the originals.
- **Automatic deletion of old backups.** In the Backups tab choose how many to keep (3, 5, 10, 20, 50 or all) and whether manual ones count too.
- Fixed two visual glitches when creating from a modpack (the "Choose file…" button and the label next to CurseForge).
- The app log is saved to a file, handy when something goes wrong.
- Fixed installer name: the website download link always points to the latest version.

## 1.1.2 (2026-10-12)

### Italiano
- Installer e versione portatile hanno ora un nome fisso (`CraftDock-Setup.exe`, `CraftDock-Portable.exe`) per il download diretto dal sito.

### English
- The installer and portable version now have fixed names (`CraftDock-Setup.exe`, `CraftDock-Portable.exe`) for direct downloads from the website.

## 1.1.1 (2026-10-12)

### Italiano
- Nuova icona dell'app, con una versione semplificata per la barra delle applicazioni e l'area di notifica.

### English
- New app icon, with a simplified version for the taskbar and notification area.

## 1.1.0 (2026-10-12)

### Italiano
- Interfaccia ridisegnata: nuovi caratteri e icone, card a doppia cornice, barra del titolo scura e home con le funzioni principali.
- Interruttori, cursori e caselle di spunta nello stile dell'app; animazioni più morbide (disattivate se Windows ha le animazioni ridotte).

### English
- Redesigned interface: new fonts and icons, double-bezel cards, a dark title bar and a home page with the main features.
- Toggles, sliders and checkboxes in the app's style; smoother animations (turned off when Windows has reduced motion).

## 1.0.2 (2026-10-12)

### Italiano
- Corretto un flag di avvio di Java scritto male che impediva l'avvio di alcuni server.
- Java ignora i flag non riconosciuti invece di fermarsi.

### English
- Fixed a misspelled Java startup flag that stopped some servers from starting.
- Java now ignores unrecognized flags instead of stopping.

## 1.0.1 (2026-10-12)

### Italiano
- Compatibilità con playit.gg 1.0: collegamento dell'account dal browser e creazione automatica del tunnel per ogni server.

### English
- playit.gg 1.0 support: link your account from the browser and get a tunnel created automatically for each server.

## 1.0.0 (2026-10-11)

### Italiano
- Prima versione: server Fabric, Quilt, Forge, NeoForge, Paper, Purpur e Vanilla, mod e modpack da Modrinth, importazione di mondi, backup, pannello opzioni, controlli rapidi e amici connessi senza port forwarding.

### English
- First release: Fabric, Quilt, Forge, NeoForge, Paper, Purpur and Vanilla servers, Modrinth mods and modpacks, world import, backups, an options panel, quick controls and friends connected without port forwarding.
