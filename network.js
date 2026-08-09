const os = require('os');

function getLocalIPv4List() {
  const nets = os.networkInterfaces();
  const result = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4;
      if (
        net.family === familyV4Value &&
        !net.internal &&
        net.address
      ) {
        result.push({
          name,
          address: net.address
        });
      }
    }
  }

  return result;
}

function isVpnAdapterName(name) {
  return /radmin|hamachi|zerotier|tailscale|wireguard|wg|tun|vpn/i.test(String(name || ''));
}

function isLikelyVpnAddress(address) {
  if (!address) return false;
  if (address.startsWith('26.')) return true;
  if (address.startsWith('25.')) return true;
  if (address.startsWith('5.')) return true;
  return false;
}

function pickVpnHostIp() {
  const list = getLocalIPv4List();

  if (!list.length) {
    return '127.0.0.1';
  }

  const vpnPreferred = list.find((item) => isVpnAdapterName(item.name));
  if (vpnPreferred) return vpnPreferred.address;

  const vpnByAddress = list.find((item) => isLikelyVpnAddress(item.address));
  if (vpnByAddress) return vpnByAddress.address;

  const lan192 = list.find((item) => item.address.startsWith('192.168.'));
  if (lan192) return lan192.address;

  const lan10 = list.find((item) => item.address.startsWith('10.'));
  if (lan10) return lan10.address;

  const lan172 = list.find((item) => {
    const p = item.address.split('.').map(Number);
    return p[0] === 172 && p[1] >= 16 && p[1] <= 31;
  });
  if (lan172) return lan172.address;

  return list[0].address;
}

function getVpnNetworkInfo() {
  const list = getLocalIPv4List();
  const vpnAdapters = list.filter(
    (item) => isVpnAdapterName(item.name) || isLikelyVpnAddress(item.address)
  );

  return {
    host: pickVpnHostIp(),
    adapters: list,
    vpnAdapters,
    hasVpn: vpnAdapters.length > 0
  };
}

module.exports = {
  getLocalIPv4List,
  isVpnAdapterName,
  isLikelyVpnAddress,
  pickVpnHostIp,
  getVpnNetworkInfo
};
