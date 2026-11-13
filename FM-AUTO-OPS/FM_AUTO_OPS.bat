@echo off
title FM AUTO OPS — Enterprise Automation Platform
cd /d "%~dp0apps\local-agent"
if exist "node_modules\.bin\electron.cmd" (
  start "" "node_modules\.bin\electron.cmd" dist\main\index.js
) else (
  start "" npx electron dist\main\index.js
)
exit
