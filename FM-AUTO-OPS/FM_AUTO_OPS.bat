@echo off
title FM AUTO OPS — Enterprise Automation Platform
echo Starting FM AUTO OPS Desktop Agent...
cd /d "%~dp0apps\local-agent"
start /b npx electron dist/main/index.js
exit
