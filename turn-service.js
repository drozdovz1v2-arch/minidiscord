let Turn = null;

try {
  Turn = require('node-turn');
} catch (_) {
  Turn = null;
}

const { pickVpnHostIp } = require('./network');
const { TURN_USER, TURN_PASS } = require('./voice-network');

let turnServer = null;
let turnPort = 3478;

function startTurnServer(port = 3478) {
  if (turnServer) return turnServer;
  if (!Turn) {
    console.warn('🔊 TURN/STUN: пакет node-turn не установлен — выполни npm install');
    return null;
  }

  turnPort = Number(port || 3478);
  const vpnIp = pickVpnHostIp();

  try {
    turnServer = new Turn({
      listeningPort: turnPort,
      listeningIps: ['0.0.0.0'],
      authMech: 'long-term',
      credentials: {
        [TURN_USER]: TURN_PASS
      },
      realm: 'minidiscord.local',
      debug: false
    });

    turnServer.start();
    console.log(`🔊 TURN/STUN: порт ${turnPort} (Radmin ${vpnIp})`);
  } catch (err) {
    console.error('🔊 TURN/STUN: не удалось запустить:', err?.message || err);
    turnServer = null;
  }

  return turnServer;
}

function getTurnPort() {
  return turnPort;
}

function stopTurnServer() {
  if (!turnServer) return;

  try {
    turnServer.stop();
  } catch (_) {}

  turnServer = null;
}

module.exports = {
  startTurnServer,
  getTurnPort,
  stopTurnServer
};
