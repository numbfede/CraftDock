'use strict';
// Eseguito prima di "npm run dist": scrive src/main/cf-key.json con la chiave presa da CF_API_KEY.
// Senza variabile d'ambiente rimuove il file, così il build esce con CurseForge disattivato.
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'src', 'main', 'cf-key.json');
const key = (process.env.CF_API_KEY || '').trim();
if (key) {
  fs.writeFileSync(out, JSON.stringify({ key }) + '\n');
  console.log('[CraftDock] Chiave CurseForge inserita nel build.');
} else {
  fs.rmSync(out, { force: true });
  console.log('[CraftDock] Nessuna CF_API_KEY: il build avrà CurseForge disattivato.');
}
