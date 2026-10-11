'use strict';
// Ponte sicuro tra interfaccia e processo principale (contextIsolation attivo).

const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) {
    const e = new Error(r.error);
    e.code = r.code;
    e.url = r.url;
    throw e;
  }
  return r.data;
}

const EVENTS = ['server:log', 'server:status', 'server:players', 'server:stats', 'server:eula', 'servers:changed', 'task',
  'tunnel:log', 'tunnel:status', 'tunnel:claim', 'tunnel:address', 'backups:changed', 'app:shutting-down'];

contextBridge.exposeInMainWorld('craftdock', {
  call,
  on(channel, fn) {
    if (!EVENTS.includes(channel)) throw new Error('Evento non consentito: ' + channel);
    const listener = (_e, ...args) => fn(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  // percorso reale dei file trascinati nella finestra
  pathFor(file) {
    try { return webUtils.getPathForFile(file); } catch (_) { return file.path || null; }
  },
});
