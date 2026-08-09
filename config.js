const { pickVpnHostIp, getVpnNetworkInfo } = require('./network');

// discover — автопоиск сервера в Radmin (рекомендуется)
// auto — IP этой машины в VPN
// или явный IP: 26.x.x.x
const SERVER_HOST_RAW = process.env.SERVER_HOST || 'discover';

let runtimeHost = null;
const vpnInfo = getVpnNetworkInfo();

function resolveServerHost() {
  if (runtimeHost) return runtimeHost;

  const raw = String(SERVER_HOST_RAW || '').trim();
  if (raw && raw !== 'auto' && raw !== 'discover') {
    return raw;
  }

  return pickVpnHostIp();
}

function setRuntimeHost(host) {
  runtimeHost = host || null;
}

module.exports = {
  PRODUCT_NAME: 'MiniDiscord',

  SERVER_HOST_RAW,
  HTTP_PORT: 3000,
  VOICE_PORT: 4001,
  TURN_PORT: Number(process.env.TURN_PORT || 3478),
  USE_VPN: vpnInfo.hasVpn,

  setRuntimeHost,

  get SERVER_HOST() {
    return resolveServerHost();
  },

  get API_BASE() {
    return `http://${this.SERVER_HOST}:${this.HTTP_PORT}`;
  },

  get WS_TEXT_URL() {
    return `ws://${this.SERVER_HOST}:${this.HTTP_PORT}`;
  },

  get WS_VOICE_URL() {
    return `ws://${this.SERVER_HOST}:${this.VOICE_PORT}`;
  }
};
