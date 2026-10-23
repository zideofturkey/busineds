@echo off
chcp 65001 >nul
title Busined's Server
cd /d "%~dp0"
echo Busined's baslatiliyor ve buluttan son veriler cekiliyor...
git pull --rebase --autostash origin main
start "" "http://localhost:3400"
node server.js
pause
