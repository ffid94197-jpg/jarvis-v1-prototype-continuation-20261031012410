@echo off
rem JARVIS V1 local Windows installation launcher.
rem Forwards every argument to the PowerShell installer, so
rem   INSTALL_JARVIS_V1.cmd -SkipProductionBuild -AppPath D:\jarvis\app
rem reaches the script unchanged.
rem Run this only on your own Windows PC. It performs no release signing and
rem grants no certification. PENDING LIVE WINDOWS ACCEPTANCE.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL_JARVIS_V1.ps1" %*
set "JARVIS_INSTALL_EXIT=%ERRORLEVEL%"
endlocal & exit /b %JARVIS_INSTALL_EXIT%
