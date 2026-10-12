#!/bin/bash
# Avvia CraftDock dal codice sorgente su macOS (serve Node.js 20 o superiore: https://nodejs.org).
cd "$(dirname "$0")"
if ! command -v npm >/dev/null 2>&1; then
  for p in /opt/homebrew/bin /usr/local/bin "$HOME/.nvm/versions/node"/*/bin; do [ -x "$p/npm" ] && export PATH="$p:$PATH" && break; done
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Serve Node.js 20 o superiore: installalo da https://nodejs.org e riapri questo file."
  open "https://nodejs.org"
  read -n 1 -s -r -p "Premi un tasto per chiudere"; exit 1
fi
[ -d node_modules ] || npm install
npm start
