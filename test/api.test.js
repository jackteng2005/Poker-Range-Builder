// API tests for server.js, using Node's built-in test runner (no dependencies).
// Each run starts the real server on a free port with a throwaway data file,
// so the tests never touch data/ranges.json.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

let server;
let baseUrl;
let tmpDir;
let dataFile;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'range-vault-test-'));
  dataFile = path.join(tmpDir, 'ranges.json');
  const port = await freePort();
  baseUrl = `http://localhost:${port}`;

  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, RANGE_VAULT_PORT: String(port), RANGE_VAULT_DATA_FILE: dataFile },
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  await new Promise((resolve, reject) => {
    server.once('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running at')) resolve();
    });
  });
});

after(() => {
  server.kill();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function api(method, route, body) {
  const res = await fetch(baseUrl + route, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const getStore = async () => (await api('GET', '/api/ranges')).json;

test('GET /api/ranges returns the default vaults before anything is saved', async () => {
  const { status, json } = await api('GET', '/api/ranges');
  assert.equal(status, 200);
  assert.deepEqual(json, { '50bb': {}, '100bb': {} });
});

test('POST registers a new vault and persists it to disk', async () => {
  const { status } = await api('POST', '/api/ranges/20bb');
  assert.equal(status, 200);
  assert.deepEqual((await getStore())['20bb'], {});
  assert.ok('20bb' in JSON.parse(fs.readFileSync(dataFile, 'utf8')));
});

test('PUT saves a spot and GET returns it with a timestamp', async () => {
  const hands = { AA: 'raise', KK: 'raise', AKs: 'call' };
  const { status, json } = await api('PUT', '/api/ranges/100bb/UTG-RFI', { hands });
  assert.equal(status, 200);
  assert.deepEqual(json.spot.hands, hands);

  const saved = (await getStore())['100bb']['UTG-RFI'];
  assert.deepEqual(saved.hands, hands);
  assert.ok(!Number.isNaN(Date.parse(saved.updatedAt)));
});

test('POST on an existing vault keeps its saved spots', async () => {
  await api('PUT', '/api/ranges/30bb/BTN-RFI', { hands: { AA: 'raise' } });
  await api('POST', '/api/ranges/30bb');
  assert.deepEqual((await getStore())['30bb']['BTN-RFI'].hands, { AA: 'raise' });
});

test('PUT with no hands deletes the spot', async () => {
  await api('PUT', '/api/ranges/100bb/CO-RFI', { hands: { QQ: 'raise' } });
  await api('PUT', '/api/ranges/100bb/CO-RFI', { hands: {} });
  assert.equal((await getStore())['100bb']['CO-RFI'], undefined);
});

test('saving SB-RFI keeps the linked SB-Limp spot identical', async () => {
  const hands = { A5s: 'raise', T9s: 'raise' };
  const { json } = await api('PUT', '/api/ranges/50bb/SB-RFI', { hands });
  assert.deepEqual(json.synchronizedSpots['SB-Limp'].hands, hands);

  const store = await getStore();
  assert.deepEqual(store['50bb']['SB-Limp'], store['50bb']['SB-RFI']);
});

test('DELETE removes a single spot, then a whole vault', async () => {
  await api('PUT', '/api/ranges/40bb/HJ-RFI', { hands: { JJ: 'raise' } });
  await api('PUT', '/api/ranges/40bb/LJ-RFI', { hands: { TT: 'raise' } });

  await api('DELETE', '/api/ranges/40bb/HJ-RFI');
  let store = await getStore();
  assert.equal(store['40bb']['HJ-RFI'], undefined);
  assert.ok(store['40bb']['LJ-RFI']);

  await api('DELETE', '/api/ranges/40bb');
  store = await getStore();
  assert.equal(store['40bb'], undefined);
});

test('invalid JSON is rejected with 400 and nothing is saved', async () => {
  const { status, json } = await api('PUT', '/api/ranges/100bb/BB-Defend', '{not json');
  assert.equal(status, 400);
  assert.equal(json.ok, false);
  assert.equal((await getStore())['100bb']['BB-Defend'], undefined);
});

test('unknown API routes return 404', async () => {
  const { status } = await api('GET', '/api/nothing-here');
  assert.equal(status, 404);
});

test('concurrent saves to different spots are all kept', async () => {
  const spotIds = Array.from({ length: 25 }, (_, i) => `concurrent-${i}`);
  await Promise.all(
    spotIds.map((id) => api('PUT', `/api/ranges/60bb/${id}`, { hands: { AA: 'raise' } }))
  );
  const saved = Object.keys((await getStore())['60bb'] || {});
  assert.deepEqual(saved.sort(), [...spotIds].sort());
});
