const http = require('http');
const { pickVpnHostIp, getVpnNetworkInfo } = require('../network');
const { discoverServers, startDiscoveryService, stopDiscoveryService } = require('../discovery');

const results = [];

function pass(name, detail) {
  results.push({ ok: true, name, detail });
  console.log(`[OK] ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail) {
  results.push({ ok: false, name, detail });
  console.error(`[FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
}

function fetchJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

async function waitForServer(url, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetchJson(url);
    } catch (_) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error('server not ready');
}

async function main() {
  console.log('MiniDiscord smoke test\n');

  try {
    require('../config');
    pass('config.js loads');
  } catch (err) {
    fail('config.js loads', err.message);
  }

  const vpn = getVpnNetworkInfo();
  const host = pickVpnHostIp();
  pass('VPN detection', `host=${host}, adapters=${vpn.vpnAdapters.length}`);

  let serverModule;
  try {
    serverModule = require('../app/server.js');
    pass('server.js starts');
  } catch (err) {
    fail('server.js starts', err.message);
    printSummary();
    process.exit(1);
  }

  startDiscoveryService(() => ({
    host,
    httpPort: 3000,
    voicePort: 4001
  }));

  try {
    const health = await waitForServer(`http://127.0.0.1:3000/server-info`);
    if (health.status === 200 && health.data?.ok) {
      pass('/server-info', `host=${health.data.host}`);
    } else {
      fail('/server-info', `status=${health.status}`);
    }
  } catch (err) {
    fail('/server-info', err.message);
  }

  try {
    const discovered = await discoverServers(1500);
    if (discovered.some((s) => s.host === host)) {
      pass('UDP discovery', `found ${discovered.length} server(s)`);
    } else {
      fail('UDP discovery', `expected ${host}, got ${JSON.stringify(discovered)}`);
    }
  } catch (err) {
    fail('UDP discovery', err.message);
  }

  try {
    const root = await fetchJson('http://127.0.0.1:3000/');
    if (root.status === 200) pass('HTTP root');
    else fail('HTTP root', `status=${root.status}`);
  } catch (err) {
    fail('HTTP root', err.message);
  }

  stopDiscoveryService();

  if (serverModule?.httpServer) {
    serverModule.httpServer.close();
  }

  printSummary();
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

function printSummary() {
  const failed = results.filter((r) => !r.ok);
  console.log('\n---');
  console.log(`Passed: ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.log('Failed checks:');
    failed.forEach((r) => console.log(` - ${r.name}: ${r.detail}`));
  }
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
