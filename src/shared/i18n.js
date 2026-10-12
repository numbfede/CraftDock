'use strict';
/*
 * Traduzioni di CraftDock, condivise tra processo principale e interfaccia.
 *
 * Il testo italiano è la chiave: t('Avvia') restituisce 'Start' in inglese.
 * I segnaposto si scrivono tra graffe: t('Avvio di {name}…', { name }).
 * Se una frase manca nel dizionario si mostra l'italiano, così niente si rompe.
 *
 * Nel renderer questo file si carica con <script> dopo en.js; nel main con require().
 */
(function (root) {
  const EN = typeof module !== 'undefined' && module.exports ? require('./en.js') : root.CRAFTDOCK_EN || {};
  let lang = 'it';

  function setLang(l) { lang = l === 'en' ? 'en' : 'it'; }
  function getLang() { return lang; }

  /** Lingua da usare: scelta dell'utente o, in automatico, quella di Windows. */
  function resolveLang(setting, systemLocale) {
    if (setting === 'it' || setting === 'en') return setting;
    return /^it\b/i.test(systemLocale || '') ? 'it' : 'en';
  }

  function t(text, params) {
    let out = lang === 'en' && Object.prototype.hasOwnProperty.call(EN, text) ? EN[text] : text;
    if (params) out = out.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
    return out;
  }

  /**
   * Singolare/plurale: tn(n, '{n} giocatore', '{n} giocatori').
   * Se in italiano le due forme coincidono ('{n} mod'), il singolare inglese
   * si può dare con la chiave '{n} mod|1'.
   */
  function tn(n, one, many, params) {
    const p = Object.assign({ n }, params || {});
    if (n === 1 && lang === 'en' && Object.prototype.hasOwnProperty.call(EN, one + '|1')) return t(one + '|1', p).replace(/\{n\}/g, String(n));
    return t(n === 1 ? one : many, p);
  }

  const api = { t, tn, setLang, getLang, resolveLang, EN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    // La lingua arriva dal preload in modo sincrono, prima che le altre parti dell'interfaccia vengano caricate.
    if (root.craftdock && root.craftdock.lang) setLang(root.craftdock.lang);
    if (root.document) root.document.documentElement.lang = lang;
    Object.assign(root, { i18n: api, t, tn });
  }
})(typeof window !== 'undefined' ? window : globalThis);
