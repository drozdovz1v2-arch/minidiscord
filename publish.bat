@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "GIT=C:\Program Files\Git\cmd\git.exe"
set "NPX=%~dp0node_modules\.bin\npx.cmd"

if not exist "%GIT%" (
  echo Git не найден. Установи Git for Windows.
  pause
  exit /b 1
)

if "%GH_TOKEN%"=="" (
  echo.
  echo Нужен GitHub token для публикации релиза.
  echo 1. GitHub - Settings - Developer settings - Personal access tokens
  echo 2. Права: repo
  echo 3. В PowerShell: $env:GH_TOKEN="твой_токен"
  echo.
  pause
  exit /b 1
)

echo Версия:
findstr /C:"\"version\"" package.json

echo.
echo Коммит и push...
"%GIT%" add .
"%GIT%" commit -m "release 2.8.0" 2>nul
"%GIT%" tag -f v2.8.0 2>nul
"%GIT%" push origin main
"%GIT%" push origin v2.8.0 --force

echo.
echo Сборка инсталлера и публикация на GitHub...
call "%NPX%" electron-builder --win nsis --publish always

echo.
echo Готово: https://github.com/Frayze370/F/releases
pause
