@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  MiniDiscord
echo  ===========
echo  Обычно достаточно просто: npm start
echo  Этот файл нужен только если хочешь запустить сервер отдельно.
echo.
node app\server.js
pause
