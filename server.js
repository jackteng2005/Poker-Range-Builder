const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5173;
const DATA_FILE = path.join(__dirname, 'data', 'ranges.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Serialize all writes so concurrent saves can't corrupt the file.
let writeQueue = Promise.resolve();
function readStore() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { '50bb': {}, '100bb': {} };
  }
}
function writeStore(store) {
  writeQueue = writeQueue.then(
    () => fs.promises.writeFile(DATA_FILE, JSON.stringify(store, null, 2), 'utf8')
  );
  return writeQueue;
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
    const store = readStore();
    delete store[depth];
    await writeStore(store);
    sendJson(res, 200, { ok: true });
    return;
  }

  // Registers a vault immediately on creation, even before it has any saved
  // spots, so it persists to disk and shows up in "Your Vaults" right away.
  if (depthMatch && req.method === 'POST') {
    const depth = decodeURIComponent(depthMatch[1]);
    const store = readStore();
    if (!store[depth]) {
      store[depth] = {};
      await writeStore(store);
    }
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
        const store = readStore();
        if (!store[depth]) store[depth] = {};
        const hands = body.hands || {};
        if (Object.keys(hands).length === 0) {
          delete store[depth][spotId];
        } else {
          store[depth][spotId] = { hands, updatedAt: new Date().toISOString() };
        }
        await writeStore(store);
        sendJson(res, 200, { ok: true, spot: store[depth][spotId] || null });
      } catch (e) {
        sendJson(res, 400, { ok: false, error: e.message });
      }
      return;
    }

    if (req.method === 'DELETE') {
      const store = readStore();
      if (store[depth]) delete store[depth][spotId];
      await writeStore(store);
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
