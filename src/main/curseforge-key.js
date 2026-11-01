'use strict';
// CurseForge in CraftDock passa dal server del sito (craftdock.numbfede.com/api/cf), che aggiunge
// la chiave API dal suo lato: la chiave non è mai dentro l'app né nel repository.
// Solo per lo sviluppo si può usare una chiave propria con la variabile d'ambiente CF_API_KEY:
// in quel caso l'app parla direttamente con api.curseforge.com.
module.exports = String(process.env.CF_API_KEY || '').trim();
