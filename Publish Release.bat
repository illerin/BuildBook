@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Publish-Release.ps1"
set "result=%errorlevel%"

echo.
if not "%result%"=="0" (
  echo Release was not published.
  pause
  exit /b %result%
)

echo GitHub Actions will build and publish the Windows installer.
pause
