#!/bin/bash
# Installa CraftDock in Applicazioni e toglie il blocco "scaricato da internet".
# CraftDock non ha ancora una firma Apple a pagamento: senza questo passaggio macOS lo blocca.
cd "$(dirname "$0")"
echo "CraftDock · installazione"
if [ ! -d "CraftDock.app" ]; then
  echo "Non trovo CraftDock.app accanto a questo file. Estrai di nuovo lo zip e riprova."
  read -n 1 -s -r -p "Premi un tasto per chiudere"; exit 1
fi
osascript -e 'tell application "CraftDock" to quit' >/dev/null 2>&1 || true
sleep 1
rm -rf "/Applications/CraftDock.app" 2>/dev/null || sudo rm -rf "/Applications/CraftDock.app"
cp -R "CraftDock.app" "/Applications/" 2>/dev/null || sudo cp -R "CraftDock.app" "/Applications/"
xattr -dr com.apple.quarantine "/Applications/CraftDock.app" 2>/dev/null || sudo xattr -dr com.apple.quarantine "/Applications/CraftDock.app"
codesign --force --deep --sign - "/Applications/CraftDock.app" >/dev/null 2>&1 || true
echo "Fatto: CraftDock è in Applicazioni."
open "/Applications/CraftDock.app"
sleep 1
