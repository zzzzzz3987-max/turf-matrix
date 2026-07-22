@echo off
setlocal
set ROOT=%~dp0
powershell -ExecutionPolicy Bypass -File "%ROOT%tools\jvfetch\run-week.ps1" %*
exit /b %ERRORLEVEL%
