# Firma del codice (avviso SmartScreen)

Windows mostra "Windows ha protetto il PC" per gli .exe scaricati senza firma digitale.
La firma toglie l'avviso "Autore sconosciuto"; l'avviso SmartScreen sparisce del tutto quando
l'app accumula reputazione (dopo un po' di download firmati).

## Opzione consigliata: SignPath Foundation (gratis per progetti open source)

CraftDock rispetta già i requisiti principali: licenza MIT, codice pubblico su GitHub, build
automatiche su GitHub Actions, nome e versione del prodotto impostati in ogni build, programma di
disinstallazione, pagina "Code signing policy" e informativa privacy sul sito
(https://craftdock.numbfede.com/firma-codice e https://craftdock.numbfede.com/privacy).

Il certificato è intestato a "SignPath Foundation", non a te: è normale per questo programma.

### 1. Richiesta (una volta sola)

1. Attiva l'autenticazione a due fattori su GitHub (obbligatoria).
2. Vai su https://signpath.org/apply e compila la richiesta:
   - Progetto: CraftDock
   - Repository: https://github.com/numbfede/CraftDock
   - Sito / pagina download: https://craftdock.numbfede.com
   - Code signing policy: https://craftdock.numbfede.com/firma-codice
   - Licenza: MIT
3. Attendi l'approvazione (di solito qualche giorno o settimana). SignPath ti crea un'organizzazione
   e un progetto.

### 2. Collegamento a GitHub (dopo l'approvazione)

1. Su SignPath, nel progetto CraftDock:
   - aggiungi un **Trusted Build System** di tipo GitHub e collegalo al repository;
   - crea (o usa quella proposta) una **signing policy** chiamata `release-signing`, con te come approvatore;
   - nella **artifact configuration** indica che l'artefatto è uno zip con `CraftDock-Setup.exe` e
     `CraftDock-Portable.exe` da firmare (Authenticode).
2. Crea un **API token** per un utente CI con permesso di inviare richieste di firma.
3. Su GitHub, nel repository CraftDock → Settings → Secrets and variables → Actions:
   - **Secret** `SIGNPATH_API_TOKEN` = il token del passo 2
   - **Variable** `SIGNPATH_ORGANIZATION_ID` = l'ID dell'organizzazione SignPath
   - (facoltative) `SIGNPATH_PROJECT_SLUG` se il progetto non si chiama `CraftDock`,
     `SIGNPATH_POLICY_SLUG` se la policy non si chiama `release-signing`

Da quel momento il workflow **Release** firma da solo gli .exe: si ferma ad aspettare che tu approvi
la richiesta su SignPath (ti arriva una email), poi pubblica gli .exe firmati.
Finché il secret non esiste, il workflow pubblica gli .exe senza firma come oggi.

## Alternative

- **Microsoft Store**: la registrazione come sviluppatore individuale è gratuita e Microsoft firma
  il pacchetto, quindi niente SmartScreen. Serve un pacchetto MSIX (electron-builder target `appx`)
  e la revisione dello Store a ogni versione.
- **Certificato OV da un'autorità (DigiCert, Sectigo, Certum…)**: 150-300 € l'anno, con chiave su
  token hardware o HSM in cloud. Il certificato è intestato a te.
- **Azure Artifact Signing (Trusted Signing)**: circa 10 $ al mese, ma per i privati è disponibile
  solo in Stati Uniti e Canada; in Italia serve un'azienda o ditta registrata.
