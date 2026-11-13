@echo off
title FM AUTO OPS — Enterprise Automation Platform
cd /d "%~dp0apps\local-agent"
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" dist\main\index.js
) else if exist "node_modules\.bin\electron.cmd" (
  start "" "node_modules\.bin\electron.cmd" dist\main\index.js
) else (
  start "" npx electron dist\main\index.js
)
exit
