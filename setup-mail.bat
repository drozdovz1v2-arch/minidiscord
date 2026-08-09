@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".env" (
  echo [X] Нет файла .env в папке wq
  echo     Скопируй .env.example в .env и заполни Gmail
  pause
  exit /b 1
)

set "TARGET=%APPDATA%\MiniDiscord"
if not exist "%TARGET%" mkdir "%TARGET%"

copy /Y ".env" "%TARGET%\.env" >nul
echo [OK] .env скопирован в:
echo      %TARGET%\.env
echo.
echo Перезапусти MiniDiscord
pause
