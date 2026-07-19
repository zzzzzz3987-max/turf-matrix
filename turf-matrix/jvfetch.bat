@echo off
setlocal
set ROOT=%~dp0
powershell -ExecutionPolicy Bypass -File "%ROOT%tools\jvfetch\run-jvfetch.ps1" --week %*
exit /b %ERRORLEVEL%
