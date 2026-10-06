#!/usr/bin/env node
// Serves the hosted build (dist/) on a local port for checking. Usage: node scripts/serve.js [--port 8080] [--dir dist]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../src/lib/cli.js';

const { flags } = parseArgs(process.argv.slice(2));
const port = Number(flags.port) || 8080;
const dir = path.resolve(String(flags.dir || 'dist'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.statusCode = 400; res.end('bad request'); return; }
  let file = path.join(dir, pathname);
  if (!file.startsWith(dir)) { res.statusCode = 403; res.end('forbidden'); return; }
  if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
  try {
    const body = await readFile(file);
    res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}).listen(port, () => console.log(`Serving ${dir} at http://localhost:${port}/`));
