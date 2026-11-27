/* Cartinhas de Natal — Cloudflare Worker
 * - Serve o site estático (binding ASSETS) e a API /api/*.
 * - Guarda cartinhas na tabela public.cartinhas e a mídia no bucket privado cartinhas-midia (Supabase).
 * - A chave SUPABASE_SECRET_KEY só é lida aqui, pela variável de ambiente. Nunca vai para o navegador.
 *
 * Variáveis do Worker
 *   SUPABASE_URL, SUPABASE_SECRET_KEY        (já configuradas)
 *   PAGAMENTO_WEBHOOK_SECRET                  (segredo que o provedor de pagamento envia em X-Webhook-Secret)
 *   AMBIENTE = "teste"                        (SOMENTE em ambiente de teste; habilita /api/teste/liberar em localhost)
 */
const BUCKET = 'cartinhas-midia';
const TIPOS = {
  foto:  { mimes: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }, max: 8 * 1024 * 1024 },
  audio: { mimes: { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aac': 'aac' }, max: 15 * 1024 * 1024 },
  video: { mimes: { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }, max: 55 * 1024 * 1024 }
};
const NOME_MIDIA = /^(foto-[0-4]|audio|video)$/;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{24,96}$/;
const MAX_CONTEUDO = 250 * 1024;

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }
});
const erro = (status, msg) => json({ erro: msg }, status);

function novoToken() {
  return crypto.randomUUID();
}
function igual(a, b) { // comparação em tempo constante
  a = String(a || ''); b = String(b || '');
  let r = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return r === 0;
}

/* ---------- Supabase (só aqui, com a chave secreta do ambiente) ---------- */
function sbHeaders(env, extra = {}) {
  const k = env.SUPABASE_SECRET_KEY;
  if (!k || !env.SUPABASE_URL) throw new Error('Configure SUPABASE_URL e SUPABASE_SECRET_KEY nas variaveis do Worker.');
  const h = { apikey: k, ...extra };
  if (!/^sb_/.test(k)) h.authorization = 'Bearer ' + k; // chaves antigas (JWT) também vão em Authorization
  return h;
}
const base = env => String(env.SUPABASE_URL || '').replace(/\/+$/, '');
async function sbRest(env, path, init = {}) {
  const r = await fetch(base(env) + '/rest/v1/' + path, {
    ...init,
    headers: sbHeaders(env, { 'content-type': 'application/json', ...(init.headers || {}) })
  });
  const txt = await r.text();
  let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  if (!r.ok) throw new Error('supabase ' + r.status + ' ' + (typeof data === 'string' ? data : JSON.stringify(data)));
  return data;
}
const porId = async (env, id) => (await sbRest(env, 'cartinhas?id=eq.' + encodeURIComponent(id) + '&select=*&limit=1'))[0] || null;
const porCol = async (env, col, tok) => (await sbRest(env, 'cartinhas?' + col + '=eq.' + encodeURIComponent(tok) + '&select=*&limit=1'))[0] || null;
const conteudoDe = row => {
  let c = row.conteudo;
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch (e) { c = {}; } }
  return c && typeof c === 'object' ? c : {};
};
async function salvarConteudo(env, id, conteudo, extra = {}) {
  const r = await sbRest(env, 'cartinhas?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ conteudo, ...extra })
  });
  return r[0];
}
const stObj = (env, path) => base(env) + '/storage/v1/object/' + BUCKET + '/' + path.split('/').map(encodeURIComponent).join('/');
async function stApagar(env, path) {
  await fetch(stObj(env, path), { method: 'DELETE', headers: sbHeaders(env) }).catch(() => {});
}

/* ---------- validação do conteúdo (também protege quem abre o link) ---------- */
const s = (v, n) => typeof v === 'string' && v.length <= n;
function validarConteudo(c) {
  if (!c || typeof c !== 'object') return 'conteudo inválido';
  if (!['santa', 'personal'].includes(c.k)) return 'tipo de cartinha inválido';
  if (!['wa', 'print', 'both'].includes(c.d)) return 'entrega inválida';
  const l = c.l;
  if (!l || !s(l.g, 400) || !Array.isArray(l.p) || l.p.length > 60 || !l.p.every(p => s(p, 6000)) || !s(l.c || '', 6000) || !s(l.s || '', 400)) return 'mensagem inválida';
  const v = c.vx;
  if (!v || !/^[a-z0-9_-]{1,24}$/.test(v.fx || '') || !/^[a-z0-9_-]{1,24}$/.test(v.vt || '') || !/^(#[0-9a-fA-F]{3,8})?$/.test(v.vc || '')) return 'visual inválido';
  if (c.poster != null && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]{1,200000}$/.test(c.poster)) return 'capa do vídeo inválida';
  return null;
}
function limpar(c) { // só o que o servidor aceita guardar
  return { v: 1, k: c.k, d: c.d, l: { g: c.l.g, p: c.l.p, c: c.l.c || '', s: c.l.s || '' }, vx: { fx: c.vx.fx, vt: c.vx.vt, vc: c.vx.vc || '' },
    a: c.a && typeof c.a === 'object' ? c.a : {}, eds: c.eds && typeof c.eds === 'object' ? c.eds : {},
    midias_esperadas: Array.isArray(c.arquivos) ? [...new Set(c.arquivos.filter(n => typeof n === 'string' && NOME_MIDIA.test(n) && (c.d !== 'print' || n.startsWith('foto-'))))] : [],
    poster: null, vmeta: c.vmeta && typeof c.vmeta === 'object' ? { dur: Number(c.vmeta.dur) || 0, name: String(c.vmeta.name || '').slice(0, 120) } : null };
}

/* ---------- links (usam o domínio do site) ---------- */
const links = (origin, row, c) => ({
  comprador: origin + '/#acesso-' + row.token_comprador,
  destinatario: c.d !== 'print' ? origin + '/#carta-' + row.token_destinatario : null
});
const urlsMidia = (token, c) => {
  const m = {}; for (const n in (c.midias || {})) m[n] = '/api/midia/' + token + '/' + n; return m;
};
const publico = (c, token) => ({ k: c.k, d: c.d, l: c.l, vx: c.vx, poster: c.poster || null, vmeta: c.vmeta || null,
  midias: Object.fromEntries(Object.entries(c.midias || {}).map(([n, m]) => [n, { mime: m.mime }])), urls: urlsMidia(token, c) });

/* ---------- autorização do comprador ---------- */
async function comprador(request, env, id) {
  if (!ID_RE.test(id)) return [null, erro(404, 'não encontrada')];
  const tok = request.headers.get('x-token-comprador') || '';
  if (!TOKEN_RE.test(tok)) return [null, erro(403, 'sem autorização')];
  const row = await porId(env, id);
  if (!row) return [null, erro(404, 'não encontrada')];
  if (!igual(row.token_comprador, tok)) return [null, erro(403, 'sem autorização')];
  return [row, null];
}

async function rota(request, env) {
  const url = new URL(request.url), p = url.pathname, m = request.method, origin = url.origin;
  let x;

  /* cria um registro novo para cada cartinha */
  if (p === '/api/cartinhas' && m === 'POST') {
    const body = await request.json().catch(() => null);
    const raw = JSON.stringify(body || {});
    if (raw.length > MAX_CONTEUDO) return erro(413, 'conteúdo grande demais');
    const e = validarConteudo(body && body.conteudo); if (e) return erro(400, e);
    const tc = novoToken(), td = novoToken();
    const r = await sbRest(env, 'cartinhas', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ conteudo: limpar(body.conteudo), token_comprador: tc, token_destinatario: td, criada_em: new Date().toISOString() }) });
    return json({ id: r[0].id, token_comprador: tc }, 201);
  }

  /* atualiza o rascunho: só com o token do comprador, e só antes do pagamento */
  if ((x = p.match(/^\/api\/cartinhas\/([^/]+)$/)) && m === 'PUT') {
    const [row, bad] = await comprador(request, env, x[1]); if (bad) return bad;
    if (row.liberada_em) return erro(409, 'cartinha já liberada');
    const body = await request.json().catch(() => null);
    if (JSON.stringify(body || {}).length > MAX_CONTEUDO) return erro(413, 'conteúdo grande demais');
    const e = validarConteudo(body && body.conteudo); if (e) return erro(400, e);
    const atual = conteudoDe(row), novo = limpar(body.conteudo); novo.midias = atual.midias || {};
    if (novo.d === 'print') { // impressão leva só a foto
      for (const n of ['audio', 'video']) if (novo.midias[n]) { await stApagar(env, novo.midias[n].path); delete novo.midias[n]; }
    }
    await salvarConteudo(env, row.id, novo);
    return json({ ok: true });
  }

  /* mídia no bucket privado */
  if ((x = p.match(/^\/api\/cartinhas\/([^/]+)\/midia\/([^/]+)$/)) && (m === 'POST' || m === 'DELETE')) {
    if (!NOME_MIDIA.test(x[2])) return erro(400, 'nome de mídia inválido');
    const [row, bad] = await comprador(request, env, x[1]); if (bad) return bad;
    if (!row.liberada_em) return erro(403, 'mídia disponível após o pagamento');
    const c = conteudoDe(row); c.midias = c.midias || {};
    const nome = x[2], tipo = nome.split('-')[0], antigo = c.midias[nome];
    if (Array.isArray(c.midias_esperadas) && (m !== 'POST' || !c.midias_esperadas.includes(nome))) return erro(409, 'mídia fora do pedido');
    if (Array.isArray(c.midias_esperadas) && antigo) return json({ ok: true, nome });
    if (m === 'DELETE') {
      if (antigo) { await stApagar(env, antigo.path); delete c.midias[nome]; await salvarConteudo(env, row.id, c); }
      return json({ ok: true });
    }
    const mime = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = TIPOS[tipo].mimes[mime];
    if (!ext) return erro(415, 'formato não aceito');
    const len = Number(request.headers.get('content-length') || 0);
    const max = TIPOS[tipo].max;
    if (len > max) return erro(413, 'arquivo grande demais');
    if (!request.body) return erro(400, 'arquivo vazio');
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        return erro(413, 'arquivo grande demais');
      }
      chunks.push(value);
    }
    if (!size) return erro(400, 'arquivo vazio');
    const buf = new Blob(chunks, { type: mime });
    const path = row.id + '/' + nome + '.' + ext;
    if (antigo && antigo.path !== path) await stApagar(env, antigo.path);
    const up = await fetch(stObj(env, path), { method: 'POST', body: buf, headers: sbHeaders(env, { 'content-type': mime, 'x-upsert': 'true', 'cache-control': 'max-age=3600' }) });
    if (!up.ok) return erro(502, 'falha ao guardar a mídia');
    c.midias[nome] = { path, mime, size: buf.size };
    await salvarConteudo(env, row.id, c);
    return json({ ok: true, nome });
  }

  const midiasProntas = c => (c.midias_esperadas || []).every(nome => !!(c.midias || {})[nome]);

  /* o comprador (link privado) lê o estado; é também o que o navegador consulta para saber se o pagamento foi confirmado */
  if ((x = p.match(/^\/api\/acesso\/([^/]+)$/)) && m === 'GET') {
    if (!TOKEN_RE.test(x[1])) return erro(404, 'não encontrada');
    const row = await porCol(env, 'token_comprador', x[1]); if (!row) return erro(404, 'não encontrada');
    const c = conteudoDe(row), lib = !!row.liberada_em;
    if (!lib) return json({ id: row.id, liberada: false });
    if (!midiasProntas(c)) return json({ id: row.id, liberada: true, midias_pendentes: true });
    const l = links(origin, row, c);
    return json({ id: row.id, liberada: true, liberada_em: row.liberada_em, criada_em: row.criada_em, pagamento: c.pagamento || null,
      link_comprador: l.comprador, link_destinatario: l.destinatario, token_destinatario: row.token_destinatario,
      carta: publico(c, row.token_destinatario) });
  }

  /* o destinatário só vê a cartinha, e só depois da liberação e na versão digital */
  if ((x = p.match(/^\/api\/carta\/([^/]+)$/)) && m === 'GET') {
    if (!TOKEN_RE.test(x[1])) return erro(404, 'não encontrada');
    const row = await porCol(env, 'token_destinatario', x[1]);
    if (!row || !row.liberada_em) return erro(404, 'não encontrada');
    const c = conteudoDe(row); if (c.d === 'print' || !midiasProntas(c)) return erro(404, 'não encontrada');
    return json({ carta: publico(c, x[1]) });
  }

  /* arquivo da mídia (privado: passa pelo Worker, com Range para áudio e vídeo) */
  if ((x = p.match(/^\/api\/midia\/([^/]+)\/([^/]+)$/)) && (m === 'GET' || m === 'HEAD')) {
    if (!TOKEN_RE.test(x[1]) || !NOME_MIDIA.test(x[2])) return erro(404, 'não encontrada');
    let row = await porCol(env, 'token_destinatario', x[1]);
    if (row) { if (!row.liberada_em || conteudoDe(row).d === 'print' || !midiasProntas(conteudoDe(row))) row = null; }
    else { row = await porCol(env, 'token_comprador', x[1]); } // o comprador vê a mídia do próprio rascunho
    if (!row) return erro(404, 'não encontrada');
    const md = (conteudoDe(row).midias || {})[x[2]]; if (!md) return erro(404, 'não encontrada');
    const h = sbHeaders(env); const rg = request.headers.get('range'); if (rg) h.range = rg;
    const up = await fetch(stObj(env, md.path), { headers: h });
    if (!up.ok && up.status !== 206) return erro(404, 'não encontrada');
    const out = new Headers({ 'content-type': md.mime, 'cache-control': 'private, max-age=3600', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff' });
    for (const k of ['content-length', 'content-range']) if (up.headers.get(k)) out.set(k, up.headers.get(k));
    return new Response(m === 'HEAD' ? null : up.body, { status: up.status, headers: out });
  }

  /* LIBERAÇÃO: só o servidor confirma o pagamento. O provedor chama este webhook com o segredo. */
  if (p === '/api/pagamento/confirmar' && m === 'POST') {
    if (!env.PAGAMENTO_WEBHOOK_SECRET || !igual(request.headers.get('x-webhook-secret'), env.PAGAMENTO_WEBHOOK_SECRET)) return erro(401, 'não autorizado');
    const body = await request.json().catch(() => null);
    if (!body || body.status !== 'pago' || !ID_RE.test(String(body.cartinha_id || ''))) return erro(400, 'pedido inválido');
    return liberar(env, origin, String(body.cartinha_id), { origem: 'pagamento', referencia: String(body.referencia || '').slice(0, 120) });
  }

  /* SIMULAÇÃO: só existe com AMBIENTE=teste e em localhost. Em produção responde 404. */
  if (p === '/api/teste/liberar' && m === 'POST') {
    const host = url.hostname;
    const local = env.AMBIENTE === 'teste' && ['localhost', '127.0.0.1'].includes(host);
    if (!local) {
      const codigo = env.PAGAMENTO_TESTE_CODIGO;
      if (typeof codigo !== 'string' || codigo.length < 32) return erro(404, 'não encontrada');
      if (!igual(request.headers.get('x-pagamento-teste-codigo'), codigo)) return erro(403, 'código de teste inválido');
    }
    const body = await request.json().catch(() => null);
    const [row, bad] = await comprador(request, env, String(body && body.cartinha_id || '')); if (bad) return bad;
    return liberar(env, origin, row.id, { origem: 'teste' });
  }

  return erro(404, 'não encontrada');
}

async function liberar(env, origin, id, pagamento) {
  const row = await porId(env, id); if (!row) return erro(404, 'não encontrada');
  const c = conteudoDe(row);
  if (!row.liberada_em) {
    c.pagamento = { ...pagamento, em: new Date().toISOString() };
    await salvarConteudo(env, row.id, c, { liberada_em: new Date().toISOString() });
  }
  const l = links(origin, row, c);
  return json({ ok: true, link_comprador: l.comprador, link_destinatario: l.destinatario });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await rota(request, env); }
      catch (e) { console.error(e && e.message); return erro(500, 'erro no servidor'); }
    }
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  }
};
