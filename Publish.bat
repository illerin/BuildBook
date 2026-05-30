@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Publish-Menu.ps1"

set "result=%errorlevel%"

echo.
if not "%result%"=="0" (
    echo Publish failed.
    pause
    exit /b %result%
)

echo Publish completed.
pause