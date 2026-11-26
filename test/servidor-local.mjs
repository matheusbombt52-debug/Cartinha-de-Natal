// Servidor local de teste: Worker real (src/worker.js) + Supabase falso em memória + arquivos do site.
// Uso: node test/servidor-local.mjs [porta]   (AMBIENTE=teste só aqui, nunca em produção)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/worker.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const FakeSupabase = require('./fake-supabase.js');

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const porta = +(process.argv[2] || 8787);
const sb = FakeSupabase.criar();
const SUPA = 'https://fake-projeto.supabase.co';
const realFetch = globalThis.fetch;
globalThis.fetch = (req, init) => { const r = req instanceof Request ? req : new Request(req, init); return r.url.startsWith(SUPA) ? sb.fetch(r) : realFetch(req, init); };

const env = { SUPABASE_URL: SUPA, SUPABASE_SECRET_KEY: 'sb_secret_teste', AMBIENTE: process.env.AMBIENTE_TESTE === '0' ? undefined : 'teste', PAGAMENTO_WEBHOOK_SECRET: 'segredo-webhook',
  ASSETS: { fetch: async (req) => { // estáticos
    let p = new URL(req.url).pathname; if (p === '/') p = '/index.html';
    if (p === '/config.js') p = '/config.teste.js'; // só no teste local
    const f = path.join(raiz, p); if (!f.startsWith(raiz) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return new Response('nf', { status: 404 });
    const ext = path.extname(f); const ct = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.jpg': 'image/jpeg' }[ext] || 'application/octet-stream';
    return new Response(fs.readFileSync(f), { headers: { 'content-type': ct } }); } } };

http.createServer(async (rq, rs) => {
  const chunks = []; for await (const c of rq) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = `http://${rq.headers.host}${rq.url}`;
  if (rq.url === '/__estado') { rs.setHeader('content-type', 'application/json'); return rs.end(JSON.stringify({ rows: sb.rows, arquivos: [...sb.files.entries()].map(([k, v]) => ({ k, bytes: v.buf.length, mime: v.mime })) })); }
  const req = new Request(url, { method: rq.method, headers: rq.headers, body: ['GET', 'HEAD'].includes(rq.method) ? undefined : body });
  const res = await worker.fetch(req, env);
  rs.writeHead(res.status, Object.fromEntries(res.headers)); rs.end(Buffer.from(await res.arrayBuffer()));
}).listen(porta, () => console.log('ok http://localhost:' + porta));
