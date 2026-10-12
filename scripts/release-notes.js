'use strict';
// Stampa le note della versione indicata (o di quella in package.json) prese da CHANGELOG.md.
// Uso: node scripts/release-notes.js [versione] > release-notes.md
const fs = require('fs');
const path = require('path');

const version = process.argv[2] || require('../package.json').version;
const text = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const start = text.search(new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b.*$`, 'm'));
if (start < 0) {
  console.error(`CHANGELOG.md non ha una sezione per la ${version}`);
  process.exit(1);
}
const rest = text.slice(start).split('\n').slice(1).join('\n');
const end = rest.search(/^## /m);
const body = (end < 0 ? rest : rest.slice(0, end)).trim();
process.stdout.write(body + '\n\n---\n[Scarica / Download](https://craftdock.numbfede.com/download) · [Novità / Changelog](https://craftdock.numbfede.com/novita)\n');
