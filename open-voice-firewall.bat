@echo off
chcp 65001 >nul
echo ========================================
echo  MiniDiscord — открыть порты в Firewall
echo  (нужны права администратора)
echo ========================================
echo.

net session >nul 2>&1
if errorlevel 1 (
  echo [X] Запусти этот файл от имени администратора
  pause
  exit /b 1
)

netsh advfirewall firewall add rule name="MiniDiscord HTTP" dir=in action=allow protocol=TCP localport=3000
netsh advfirewall firewall add rule name="MiniDiscord Voice WS" dir=in action=allow protocol=TCP localport=4001
netsh advfirewall firewall add rule name="MiniDiscord TURN UDP" dir=in action=allow protocol=UDP localport=3478
netsh advfirewall firewall add rule name="MiniDiscord TURN TCP" dir=in action=allow protocol=TCP localport=3478
netsh advfirewall firewall add rule name="MiniDiscord Discovery UDP" dir=in action=allow protocol=UDP localport=41234
netsh advfirewall firewall add rule name="MiniDiscord WebRTC UDP In" dir=in action=allow protocol=UDP localport=49152-65535
netsh advfirewall firewall add rule name="MiniDiscord WebRTC UDP Out" dir=out action=allow protocol=UDP localport=49152-65535

echo.
echo [OK] Правила добавлены (или уже существовали)
echo      Порты: 3000, 4001, 3478, 41234, UDP 49152-65535
echo.
echo ВАЖНО: запусти этот файл на КАЖДОМ ПК (хост и друзья)!
echo.
pause
