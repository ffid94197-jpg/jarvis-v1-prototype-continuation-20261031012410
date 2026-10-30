@echo off
cd /d "%~dp0"
echo Starting JARVIS NEXUS and local Windows desktop companion...
echo This must only run on your personal Windows PC, not a public host.
bun run dev:windows
pause
