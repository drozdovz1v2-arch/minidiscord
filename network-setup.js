const CONFIG = require('./config');
const { pickVpnHostIp } = require('./network');
const { discoverServers, startDiscoveryService } = require('./discovery');

let localServerStarted = false;
let isLocalServerHost = false;

function startLocalServer() {
  if (localServerStarted) return;
  require('./app/server.js');
  localServerStarted = true;
}

function startLocalDiscovery() {
  startDiscoveryService(() => ({
    host: pickVpnHostIp(),
    httpPort: CONFIG.HTTP_PORT,
    voicePort: CONFIG.VOICE_PORT,
    turnPort: CONFIG.TURN_PORT
  }));
}

async function initializeNetwork(options = {}) {
  const onStatus = options.onStatus || (() => {});
  const localIp = pickVpnHostIp();

  onStatus('Поиск сервера в Radmin VPN...');

  const servers = await discoverServers(2800);
  const remoteServers = servers.filter(
    (server) => server.host && server.host !== localIp && server.host !== '127.0.0.1'
  );

  if (remoteServers.length > 0) {
    remoteServers.sort((a, b) => a.host.localeCompare(b.host));
    CONFIG.setRuntimeHost(remoteServers[0].host);
    isLocalServerHost = false;
    onStatus(`Подключено к серверу ${remoteServers[0].host}`);
    return {
      host: remoteServers[0].host,
      isLocalServer: false,
      discovered: servers
    };
  }

  onStatus('Сервер не найден — запускаем на этом ПК...');
  startLocalServer();
  startLocalDiscovery();

  CONFIG.setRuntimeHost(localIp);
  isLocalServerHost = true;
  onStatus(`Вы хост: ${localIp}`);

  return {
    host: localIp,
    isLocalServer: true,
    discovered: servers
  };
}

function getNetworkState() {
  return {
    host: CONFIG.SERVER_HOST,
    httpPort: CONFIG.HTTP_PORT,
    voicePort: CONFIG.VOICE_PORT,
    turnPort: CONFIG.TURN_PORT,
    apiBase: CONFIG.API_BASE,
    wsTextUrl: CONFIG.WS_TEXT_URL,
    wsVoiceUrl: CONFIG.WS_VOICE_URL,
    isLocalServer: isLocalServerHost
  };
}

module.exports = {
  initializeNetwork,
  getNetworkState,
  startLocalDiscovery
};
