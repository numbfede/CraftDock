'use strict';
// Chiave API CurseForge integrata nell'app.
// NON va mai scritta qui né committata: il repository è pubblico.
// Viene inserita solo al momento del build (npm run dist) da scripts/inject-cf-key.js,
// leggendo la variabile d'ambiente CF_API_KEY, e finisce in cf-key.json (escluso da git).
// Finché la chiave è vuota CurseForge resta disattivato nell'interfaccia.

let key = '';
try { key = require('./cf-key.json').key || ''; } catch (_) { /* nessuna chiave inserita */ }
if (process.env.CF_API_KEY) key = process.env.CF_API_KEY;

module.exports = String(key).trim();
