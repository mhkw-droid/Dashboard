'use strict';

const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const root = __dirname;
const dataFile = path.join(root, 'data', 'bookmarks.json');
const port = Number(process.env.PORT || 8000);
const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg']
]);

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function send(response, status, payload, contentType = 'application/json; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  response.end(payload);
}

async function handleApi(request, response) {
  if (request.method === 'OPTIONS') return send(response, 204, '');
  if (request.url !== '/api/bookmarks') return send(response, 404, JSON.stringify({ error: 'Not found' }));

  if (request.method === 'GET') {
    const data = await fs.readFile(dataFile, 'utf8');
    return send(response, 200, data);
  }

  if (request.method === 'POST') {
    const body = await readBody(request);
    const parsed = JSON.parse(body);
    await fs.mkdir(path.dirname(dataFile), { recursive: true });
    await fs.writeFile(dataFile, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    return send(response, 200, JSON.stringify({ ok: true }));
  }

  return send(response, 405, JSON.stringify({ error: 'Method not allowed' }));
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = path.normalize(path.join(root, pathname));
  if (!filePath.startsWith(root)) return send(response, 403, 'Forbidden', 'text/plain; charset=utf-8');
  try {
    const content = await fs.readFile(filePath);
    send(response, 200, content, types.get(path.extname(filePath)) || 'application/octet-stream');
  } catch {
    send(response, 404, 'Not found', 'text/plain; charset=utf-8');
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.url.startsWith('/api/')) await handleApi(request, response);
    else await serveStatic(request, response);
  } catch (error) {
    send(response, 500, JSON.stringify({ error: error.message }));
  }
});

server.listen(port, () => {
  console.log(`Admin Dashboard server listening on http://localhost:${port}`);
});
