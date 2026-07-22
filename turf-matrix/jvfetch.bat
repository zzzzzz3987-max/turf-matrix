@echo off
setlocal
set ROOT=%~dp0
set EXE=%ROOT%tools\jvfetch\bin\Release\jvfetch.exe
if exist "%EXE%" (
  "%EXE%" --week %*
  exit /b %ERRORLEVEL%
)
powershell -ExecutionPolicy Bypass -File "%ROOT%tools\jvfetch\run-week.ps1" %*
exit /b %ERRORLEVEL%
