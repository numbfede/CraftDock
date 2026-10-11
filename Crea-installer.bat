@echo off
setlocal
title CraftDock - crea installer
cd /d "%~dp0"
rem --- Trova Node.js anche se il PATH non e' ancora aggiornato ---
where npm >nul 2>nul && goto :nodeok
for %%D in ("%ProgramFiles%\nodejs" "%ProgramFiles(x86)%\nodejs" "%LOCALAPPDATA%\Programs\nodejs" "%APPDATA%\nvm\current" "%NVM_SYMLINK%") do (
  if exist "%%~D\npm.cmd" (
    set "PATH=%%~D;%PATH%"
    goto :nodeok
  )
)
echo.
echo  Non trovo Node.js (npm) su questo PC.
echo  - Se l'hai appena installato: chiudi questa finestra, esci e rientra in Windows
echo    (oppure riavvia il PC) e riprova.
echo  - Altrimenti installalo da https://nodejs.org (versione LTS, lascia attiva
echo    l'opzione "Add to PATH").
echo.
pause
exit /b 1
:nodeok
for /f "delims=" %%V in ('node -v 2^>nul') do set "NODEVER=%%V"
echo  Node.js trovato: %NODEVER%
if not exist node_modules\electron\dist (
  call npm install || (pause & exit /b 1)
)
call npm run dist || (pause & exit /b 1)
echo.
echo  Fatto! Trovi installer e versione portatile nella cartella "dist".
explorer dist
pause
