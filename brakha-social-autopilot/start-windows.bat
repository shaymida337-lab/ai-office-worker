@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download it from https://nodejs.org & pause & exit /b 1)
start "" http://localhost:4610
node src\server.js
pause
