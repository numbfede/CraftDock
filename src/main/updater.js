'use strict';
/*
 * Aggiornamenti di CraftDock.
 *
 * All'avvio (e poi ogni 6 ore) legge l'ultima release pubblica su GitHub. Se è più nuova
 * della versione installata, l'interfaccia mostra un avviso. "Aggiorna ora" scarica
 * CraftDock-Setup.exe, ferma i server in modo sicuro e avvia l'installer in modalità
 * silenziosa: al termine CraftDock si riapre da solo (--force-run).
 * La versione portatile non si può aggiornare da sola: l'avviso porta alla pagina di download.
 */
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { getJson, download, compareVersions } = require('./util');
const { t } = require('../shared/i18n');

const REPO = 'numbfede/CraftDock';
const API = process.env.CRAFTDOCK_UPDATE_API || `https://api.github.com/repos/${REPO}/releases/latest`;
const DOWNLOAD_PAGE = process.platform === 'darwin'
  ? `https://craftdock.numbfede.com/download/${process.arch === 'arm64' ? 'mac' : 'mac-intel'}`
  : 'https://craftdock.numbfede.com/download';
const NOTES_PAGE = 'https://craftdock.numbfede.com/novita';
const EVERY_MS = 6 * 3600e3;

class Updater extends EventEmitter {
  constructor({ currentVersion, isPackaged, store }) {
    super();
    this.current = currentVersion;
    this.isPackaged = isPackaged;
    this.store = store;
    // electron-builder imposta questa variabile solo nella versione portatile
    this.portable = !!process.env.PORTABLE_EXECUTABLE_DIR;
    this.state = { available: false, state: 'idle', current: currentVersion, portable: this.portable };
    this.timer = null;
  }

  set(patch) {
    this.state = Object.assign({}, this.state, patch);
    this.emit('state', this.state);
    return this.state;
  }

  startAuto() {
    if (this.timer) return;
    setTimeout(() => this.check().catch(() => {}), 8000);
    this.timer = setInterval(() => this.check().catch(() => {}), EVERY_MS);
  }

  /** Controlla GitHub. Con force=true ignora l'impostazione "controlla aggiornamenti". */
  async check({ force = false } = {}) {
    if (!force && this.store.config.checkUpdates === false) return this.state;
    this.set({ state: this.state.state === 'downloading' ? 'downloading' : 'checking' });
    try {
      const r = await getJson(API, { headers: { Accept: 'application/vnd.github+json' } });
      const version = String(r.tag_name || '').replace(/^v/, '');
      const asset = (r.assets || []).find((a) => /setup.*\.exe$/i.test(a.name));
      const available = !!version && compareVersions(version, this.current) > 0;
      return this.set({
        available, version, checkedAt: Date.now(), state: this.state.state === 'downloading' ? 'downloading' : 'idle', error: null,
        downloadUrl: asset ? asset.browser_download_url : null, size: asset ? asset.size : null,
        notesUrl: NOTES_PAGE, downloadPage: DOWNLOAD_PAGE, publishedAt: r.published_at || null,
        // senza installer firmato o in sviluppo si apre la pagina di download
        portable: this.portable || !this.isPackaged || process.platform !== 'win32' || !asset,
      });
    } catch (e) {
      this.set({ state: 'idle', error: e.message, checkedAt: Date.now() });
      throw e;
    }
  }

  /**
   * Scarica l'installer e lo avvia. beforeQuit ferma i server e chiude l'app:
   * l'installer parte staccato e riapre CraftDock quando ha finito.
   */
  async install({ onProgress, beforeQuit }) {
    if (!this.state.available || !this.state.downloadUrl) throw new Error(t('Nessun aggiornamento da installare'));
    if (this.state.portable) throw new Error(t('La versione portatile si aggiorna scaricando il nuovo file dal sito.'));
    this.set({ state: 'downloading', progress: 0 });
    const dest = path.join(os.tmpdir(), `CraftDock-Setup-${this.state.version}.exe`);
    try {
      await download(this.state.downloadUrl, dest, {
        onProgress: (p) => { this.set({ progress: p }); onProgress && onProgress(p); },
      });
    } catch (e) {
      this.set({ state: 'idle', error: e.message });
      throw e;
    }
    this.set({ state: 'launching' });
    await beforeQuit(async () => {
      // /S = installazione silenziosa nella cartella attuale, --force-run = riapre CraftDock alla fine
      const child = spawn(dest, ['/S', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
    });
    return true;
  }
}

module.exports = { Updater };
