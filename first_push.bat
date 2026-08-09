@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "GIT=C:\Program Files\Git\cmd\git.exe"
set REMOTE=https://github.com/drozdovz1v2-arch/minidiscord.git

echo MiniDiscord - первый push на GitHub
echo Репозиторий: %REMOTE%
echo.

if not exist "%GIT%" (
  echo Git не найден.
  pause
  exit /b 1
)

"%GIT%" remote set-url origin %REMOTE%
"%GIT%" remote -v

echo.
echo Если репозиторий ещё не создан, выполни:
echo   gh repo create minidiscord --public --source=. --remote=origin --push
echo.
echo Или создай minidiscord на github.com и затем:
echo   git push -u origin main
echo   git push origin v2.8.0
echo.
pause
