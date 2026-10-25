const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.RANGE_VAULT_PORT) || 5173;
const DATA_FILE = process.env.RANGE_VAULT_DATA_FILE || path.join(__dirname, 'data', 'ranges.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// SB R and SB C are two ways of viewing the same small-blind range. Keep
// their persisted hand selections identical regardless of which view saves.
const SYNCHRONIZED_SPOT_GROUPS = [['SB-RFI', 'SB-Limp']];

function synchronizedSpotIds(spotId) {
  return SYNCHRONIZED_SPOT_GROUPS.find((group) => group.includes(spotId)) || [spotId];
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Serialize every read-modify-write through one queue, so concurrent saves
// each see the previous save's result instead of overwriting each other.
let writeQueue = Promise.resolve();
function readStore() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { '50bb': {}, '100bb': {} };
  }
}
function updateStore(mutate) {
  const run = writeQueue.then(async () => {
    const store = readStore();
    const result = mutate(store);
    await fs.promises.writeFile(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
    return result;
  });
  // A failed write shouldn't block every later save.
  writeQueue = run.catch(() => {});
  return run;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(PUBLIC_DIR, filePath);
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/api/ranges' && req.method === 'GET') {
    sendJson(res, 200, readStore());
    return;
  }

  const depthMatch = pathname.match(/^\/api\/ranges\/([^/]+)$/);
  if (depthMatch && req.method === 'DELETE') {
    const depth = decodeURIComponent(depthMatch[1]);
    await updateStore((store) => {
      delete store[depth];
    });
    sendJson(res, 200, { ok: true });
    return;
  }

  // Registers a preflop collection immediately on creation, even before it
  // has saved spots, so it persists to disk and appears in the saved list.
  if (depthMatch && req.method === 'POST') {
    const depth = decodeURIComponent(depthMatch[1]);
    await updateStore((store) => {
      if (!store[depth]) store[depth] = {};
    });
    sendJson(res, 200, { ok: true });
    return;
  }

  const spotMatch = pathname.match(/^\/api\/ranges\/([^/]+)\/(.+)$/);
  if (spotMatch) {
    const depth = decodeURIComponent(spotMatch[1]);
    const spotId = decodeURIComponent(spotMatch[2]);

    if (req.method === 'PUT') {
      try {
        const body = await readBody(req);
        const hands = body.hands || {};
        const linkedSpotIds = synchronizedSpotIds(spotId);
        const spot = Object.keys(hands).length === 0
          ? null
          : { hands, updatedAt: new Date().toISOString() };
        const response = await updateStore((store) => {
          if (!store[depth]) store[depth] = {};
          for (const linkedSpotId of linkedSpotIds) {
            if (spot) store[depth][linkedSpotId] = spot;
            else delete store[depth][linkedSpotId];
          }
          return {
            ok: true,
            spot: store[depth][spotId] || null,
            synchronizedSpots: Object.fromEntries(
              linkedSpotIds.map((linkedSpotId) => [linkedSpotId, store[depth][linkedSpotId] || null])
            ),
          };
        });
        sendJson(res, 200, response);
      } catch (e) {
        sendJson(res, 400, { ok: false, error: e.message });
      }
      return;
    }

    if (req.method === 'DELETE') {
      await updateStore((store) => {
        if (store[depth]) {
          for (const linkedSpotId of synchronizedSpotIds(spotId)) {
            delete store[depth][linkedSpotId];
          }
        }
      });
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Preflop Range Manager running at http://localhost:${PORT}`);
});
