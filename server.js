// cPanel hosting (Node.js 22, Phusion Passenger) uchun server.
// Faqat Node'ning o'z modullari ishlatiladi — npm kutubxonalari kerak emas.
//
//  - Statik fayllarni beradi (/ -> index.html).
//  - /.netlify/functions/<nom> so'rovlarini netlify/functions/<nom>.js dagi
//    exports.handler ga Netlify formatida uzatadi. Funksiyalar kodi o'zgarmaydi,
//    shuning uchun sayt Netlify'da ham avvalgidek ishlayveradi.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const FUNCTIONS_DIR = path.join(ROOT, 'netlify', 'functions');
const FUNCTIONS = new Set(['order', 'telegram', 'telegram-setup']);
const FUNCTION_PREFIX = '/.netlify/functions/';
const MAX_BODY = 1024 * 1024; // 1 MB

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
};

// Hech qachon berilmaydigan papkalar va fayllar (birinchi segment bo'yicha).
const BLOCKED_DIRS = new Set(['netlify', 'supabase', 'node_modules', 'tmp']);
const BLOCKED_FILES = new Set(['server.js', 'package.json', 'package-lock.json', 'netlify.toml']);

// ---------- Netlify funksiyalari ----------

const handlers = new Map();
function loadHandler(name) {
  if (!handlers.has(name)) {
    const mod = require(path.join(FUNCTIONS_DIR, `${name}.js`));
    if (typeof mod.handler !== 'function') throw new Error(`${name}.js: exports.handler topilmadi`);
    handlers.set(name, mod.handler);
  }
  return handlers.get(name);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body juda katta'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function requestOrigin(req) {
  const first = (v) => String(v || '').split(',')[0].trim();
  const host = first(req.headers['x-forwarded-host']) || req.headers.host || 'localhost';
  let proto = first(req.headers['x-forwarded-proto']).toLowerCase();
  if (proto !== 'http' && proto !== 'https') {
    if (req.socket.encrypted) proto = 'https';
    else proto = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host) ? 'http' : 'https';
  }
  return `${proto}://${host}`;
}

async function handleFunction(req, res, name, url) {
  if (!FUNCTIONS.has(name)) return sendText(res, 404, 'Function not found');

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return sendText(res, err.status || 400, err.status === 413 ? 'Payload too large' : 'Bad request');
  }

  // Sarlavhalar (Node ularni allaqachon kichik harfga o'tkazadi).
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  // Bu sarlavhani Netlify'ning o'zi qo'yadi; bu yerda uni mijoz soxtalashtirmasligi uchun olib tashlanadi.
  delete headers['x-nf-client-connection-ip'];
  // x-forwarded-for bor bo'lsa — o'zgarmasdan qoladi; yo'q bo'lsa, ulanish manzili qo'yiladi.
  if (!headers['x-forwarded-for'] && req.socket.remoteAddress) {
    headers['x-forwarded-for'] = req.socket.remoteAddress;
  }

  const queryStringParameters = {};
  for (const key of new Set(url.searchParams.keys())) {
    queryStringParameters[key] = url.searchParams.getAll(key).join(',');
  }

  const event = {
    httpMethod: req.method,
    headers,
    body,
    isBase64Encoded: false,
    queryStringParameters,
    path: url.pathname,
    rawUrl: `${requestOrigin(req)}${url.pathname}${url.search}`,
  };

  let result;
  try {
    const handler = loadHandler(name);
    result = await handler(event, {});
  } catch (err) {
    console.error(`Funksiya xatosi (${name}):`, err);
    return sendText(res, 502, 'Function error');
  }

  result = result || {};
  const outHeaders = {};
  for (const [key, value] of Object.entries(result.headers || {})) outHeaders[key] = String(value);
  for (const [key, values] of Object.entries(result.multiValueHeaders || {})) {
    outHeaders[key] = (Array.isArray(values) ? values : [values]).map(String);
  }
  let outBody = result.body == null ? '' : result.body;
  outBody = result.isBase64Encoded ? Buffer.from(String(outBody), 'base64') : Buffer.from(String(outBody), 'utf8');

  res.writeHead(Number(result.statusCode) || 200, outHeaders);
  res.end(req.method === 'HEAD' ? undefined : outBody);
}

// ---------- Statik fayllar ----------

function isBlocked(relPath) {
  const parts = relPath.split('/').filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.some((p) => p.startsWith('.'))) return true; // .git, .github, .htaccess, .well-known ...
  if (BLOCKED_DIRS.has(parts[0])) return true;
  if (parts.length === 1 && BLOCKED_FILES.has(parts[0])) return true;
  return false;
}

function statFile(file) {
  try {
    const st = fs.statSync(file);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

function resolveStatic(pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel.includes('\0')) return null;
  rel = path.posix.normalize(rel);
  if (isBlocked(rel)) return null;

  const abs = path.join(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;

  const candidates = [];
  if (rel.endsWith('/')) candidates.push(path.join(abs, 'index.html'));
  else {
    candidates.push(abs);
    if (!path.extname(abs)) candidates.push(`${abs}.html`, path.join(abs, 'index.html'));
  }
  for (const file of candidates) {
    if (!MIME[path.extname(file).toLowerCase()]) continue;
    const st = statFile(file);
    if (st) return { file, st };
  }
  return null;
}

function sendFile(req, res, status, { file, st }) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(status, {
    'Content-Type': MIME[ext],
    'Content-Length': st.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    'Last-Modified': st.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

function handleStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return sendText(res, 405, 'Method not allowed');
  }
  const found = resolveStatic(url.pathname);
  if (found) return sendFile(req, res, 200, found);

  const notFound = statFile(path.join(ROOT, '404.html'));
  if (notFound) return sendFile(req, res, 404, { file: path.join(ROOT, '404.html'), st: notFound });
  return sendText(res, 404, 'Not found');
}

// ---------- Server ----------

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return sendText(res, 400, 'Bad request');
  }

  if (url.pathname.startsWith(FUNCTION_PREFIX)) {
    const name = url.pathname.slice(FUNCTION_PREFIX.length).replace(/\/+$/, '');
    handleFunction(req, res, name, url).catch((err) => {
      console.error('Server xatosi:', err);
      if (!res.headersSent) sendText(res, 500, 'Internal error');
      else res.destroy();
    });
    return;
  }

  try {
    handleStatic(req, res, url);
  } catch (err) {
    console.error('Server xatosi:', err);
    if (!res.headersSent) sendText(res, 500, 'Internal error');
  }
});

server.listen(PORT, () => {
  console.log(`Server ishga tushdi: port ${PORT}`);
});
