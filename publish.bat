@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "GIT=C:\Program Files\Git\cmd\git.exe"

echo ========================================
echo  MiniDiscord 2.8.0 - публикация на GitHub
echo ========================================
echo.

if not exist "%GIT%" (
  echo [X] Git не найден. Установи: https://git-scm.com/
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [X] Node.js не найден. Установи: https://nodejs.org/
  pause
  exit /b 1
)

if "%GH_TOKEN%"=="" (
  echo [X] Нужен GitHub token.
  echo.
  echo 1. Аккаунт: drozdovz1v2-arch (как у Legenda Rubezha)
  echo 2. Settings - Developer settings - Personal access tokens
  echo 3. Создай token с правом "repo"
  echo 4. В PowerShell выполни:
  echo    $env:GH_TOKEN="твой_токен"
  echo    cd "%~dp0"
  echo    publish.bat
  echo.
  pause
  exit /b 1
)

for /f "tokens=2 delims=:," %%V in ('findstr /C:"\"version\"" package.json') do set VERSION=%%~V
set VERSION=%VERSION:"=%
set VERSION=%VERSION: =%

echo Версия: %VERSION%
echo.

echo [1/4] Git commit...
"%GIT%" add .
"%GIT%" commit -m "release %VERSION%" 2>nul

echo [2/4] Git tag v%VERSION%...
"%GIT%" tag -f v%VERSION%

echo [3/4] Push на GitHub (drozdovz1v2-arch/minidiscord)...
"%GIT%" push origin main
"%GIT%" push origin v%VERSION% --force

echo [4/4] Сборка и публикация релиза...
call npm run publish

echo.
echo Готово!
echo Релиз: https://github.com/drozdovz1v2-arch/minidiscord/releases/tag/v%VERSION%
echo.
echo Старые клиенты 2.7.x получат обновление автоматически при запуске.
pause
