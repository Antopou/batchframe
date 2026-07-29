const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

let server = null;
let wss = null;
let port = null;
let ip = null;
let authToken = null;
let intentHandler = null;

const idToPath = new Map();
const pathToId = new Map();
const clients = new Set();

let currentState = {
  folderPath: '',
  folderName: '',
  subfolders: [],
  parentFolderPath: null,
  images: [],
  previewOpen: false,
  previewIndex: 0,
  previewId: null,
  progress: null,
};

function registerPath(p) {
  if (!p) return null;
  const existing = pathToId.get(p);
  if (existing) return existing;
  const id = crypto.createHash('sha1').update(p).digest('hex').slice(0, 16);
  idToPath.set(id, p);
  pathToId.set(p, id);
  return id;
}

function pickIp() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const info of ifs[name] || []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return '127.0.0.1';
}

function makeUrl() {
  if (!ip || !port) return null;
  return `http://${ip}:${port}/?t=${authToken}`;
}

function serialize() {
  return currentState;
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function pushState(partial) {
  const next = { ...currentState };
  if (partial.folderPath !== undefined) {
    next.folderPath = partial.folderPath || '';
    next.folderName = partial.folderPath ? path.basename(partial.folderPath) : '';
  }
  if (partial.subfolders !== undefined) {
    next.subfolders = (partial.subfolders || []).map((sf) => ({
      name: sf.name,
      path: sf.path,
      id: registerPath(sf.path),
    }));
  }
  if (partial.parentFolderPath !== undefined) {
    next.parentFolderPath = partial.parentFolderPath || null;
  }
  if (partial.images !== undefined) {
    next.images = (partial.images || []).map((img) => ({
      id: registerPath(img.path),
      name: img.name,
      w: img.width || null,
      h: img.height || null,
      size: img.size || null,
      mtime: img.mtime || null,
    }));
  }
  if (partial.previewIndex !== undefined) next.previewIndex = partial.previewIndex || 0;
  if (partial.previewPath !== undefined) {
    next.previewOpen = !!partial.previewPath;
    next.previewId = partial.previewPath ? registerPath(partial.previewPath) : null;
  }
  if (partial.progress !== undefined) next.progress = partial.progress;
  currentState = next;
  broadcast({ type: 'state', state: serialize() });
}

const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg']);

function firstImageInFolder(folderPath) {
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const images = entries
      .filter((e) => e.isFile() && IMG_EXTS.has(path.extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    return images[0] ? path.join(folderPath, images[0]) : null;
  } catch { return null; }
}

async function buildThumbnail(absPath) {
  const cacheDir = path.join(os.homedir(), '.batchframe', 'thumbs');
  await fs.promises.mkdir(cacheDir, { recursive: true });
  const stat = await fs.promises.stat(absPath);
  const key = crypto
    .createHash('sha1')
    .update(`${absPath}|${stat.mtimeMs}|${stat.size}|480`)
    .digest('hex');
  const cached = path.join(cacheDir, `${key}.jpg`);
  try {
    await fs.promises.access(cached);
    return { file: cached, contentType: 'image/jpeg' };
  } catch {}
  const { nativeImage } = require('electron');
  const img = nativeImage.createFromPath(absPath);
  if (!img.isEmpty()) {
    const size = img.getSize();
    const maxSide = 480;
    const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
    const resized = scale < 1
      ? img.resize({ width: Math.round(size.width * scale), quality: 'good' })
      : img;
    await fs.promises.writeFile(cached, resized.toJPEG(72));
    return { file: cached, contentType: 'image/jpeg' };
  }
  // nativeImage can't decode this format (webp/gif/bmp on some platforms).
  // Stream the original if it's small enough; browsers can render most formats.
  const MAX_RAW = 8 * 1024 * 1024;
  if (stat.size <= MAX_RAW) {
    const ext = path.extname(absPath).toLowerCase();
    const type = ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : ext === '.gif' ? 'image/gif'
      : ext === '.bmp' ? 'image/bmp'
      : ext === '.svg' ? 'image/svg+xml'
      : 'image/jpeg';
    return { file: absPath, contentType: type, raw: true };
  }
  throw new Error('unsupported-image');
}

function guardAuth(req, res, next) {
  const t = req.query.t || req.headers['x-auth'];
  if (t !== authToken) return res.status(401).send('unauthorized');
  next();
}

async function start({ onIntent } = {}) {
  if (server) return { ip, port, url: makeUrl(), token: authToken };
  intentHandler = onIntent || null;
  authToken = crypto.randomBytes(12).toString('hex');

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  app.get('/', (req, res, next) => {
    if (req.query.t !== authToken) return res.status(401).send('unauthorized');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.get('/state', guardAuth, (req, res) => res.json(serialize()));

  app.get('/thumb/:id', guardAuth, async (req, res) => {
    const p = idToPath.get(req.params.id);
    if (!p) return res.status(404).end();
    try {
      const r = await buildThumbnail(p);
      res.setHeader('Cache-Control', r.raw ? 'public, max-age=3600' : 'public, max-age=31536000, immutable');
      res.setHeader('Content-Type', r.contentType);
      fs.createReadStream(r.file).pipe(res);
    } catch (err) {
      res.status(415).end();
    }
  });

  app.get('/folder-thumb/:id', guardAuth, async (req, res) => {
    const p = idToPath.get(req.params.id);
    if (!p) return res.status(404).end();
    const first = firstImageInFolder(p);
    if (!first) return res.status(204).end();
    try {
      const r = await buildThumbnail(first);
      res.setHeader('Cache-Control', 'public, max-age=600');
      res.setHeader('Content-Type', r.contentType);
      fs.createReadStream(r.file).pipe(res);
    } catch { res.status(415).end(); }
  });

  app.get('/full/:id', guardAuth, (req, res) => {
    const p = idToPath.get(req.params.id);
    if (!p) return res.status(404).end();
    const ext = path.extname(p).toLowerCase();
    const type =
      ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : ext === '.gif' ? 'image/gif'
      : ext === '.svg' ? 'image/svg+xml'
      : 'image/jpeg';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(p).on('error', () => res.status(404).end()).pipe(res);
  });

  app.use('/static', (req, res, next) => { if (req.query.t !== authToken) return res.status(401).end(); next(); },
    express.static(path.join(__dirname, 'public')));

  server = http.createServer(app);
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { socket.destroy(); return; }
    if (url.searchParams.get('t') !== authToken) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    try { ws.send(JSON.stringify({ type: 'state', state: serialize() })); } catch {}
    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (msg.type === 'intent' && intentHandler) {
        try { intentHandler(msg.intent, msg.payload || {}); } catch (e) { console.error('intent handler', e); }
      }
    });
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '0.0.0.0', () => {
      port = server.address().port;
      ip = pickIp();
      resolve();
    });
  });

  return { ip, port, url: makeUrl(), token: authToken };
}

function stop() {
  if (!server) return;
  try { for (const ws of clients) ws.close(); } catch {}
  clients.clear();
  try { wss && wss.close(); } catch {}
  try { server.close(); } catch {}
  server = null;
  wss = null;
  port = null;
  ip = null;
  authToken = null;
  intentHandler = null;
}

function status() {
  return {
    running: !!server,
    ip,
    port,
    url: makeUrl(),
    token: authToken,
    clients: clients.size,
  };
}

module.exports = { start, stop, status, pushState };
