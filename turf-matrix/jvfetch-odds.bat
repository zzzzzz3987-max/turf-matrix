@echo off
setlocal
set ROOT=%~dp0
"%ROOT%tools\jvfetch\bin\Release\jvfetch.exe" --odds-only %*
exit /b %ERRORLEVEL%
