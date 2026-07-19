@echo off
setlocal
set ROOT=%~dp0
"%ROOT%tools\jvfetch\bin\Release\jvfetch.exe" --week %*
exit /b %ERRORLEVEL%
