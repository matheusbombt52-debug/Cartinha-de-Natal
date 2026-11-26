/* Supabase falso, em memória (REST + Storage), para testar o Worker sem rede.
   Usa só Request/Response, então roda no Node e no navegador (demo). */
(function (root) {
  function criar() {
    const rows = []; const files = new Map(); let seq = 0;
    const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
    const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + (++seq) + '-' + Math.random().toString(16).slice(2));
    function filtro(url) {
      const f = []; url.searchParams.forEach((v, k) => { const m = /^eq\.(.*)$/.exec(v); if (m && k !== 'select') f.push([k, m[1]]); });
      return rows.filter(r => f.every(([k, v]) => String(r[k]) === v));
    }
    async function fetchFake(req) {
      const url = new URL(req.url), p = url.pathname;
      if (!req.headers.get('apikey')) return j({ message: 'No API key found' }, 401);
      if (p.startsWith('/rest/v1/cartinhas')) {
        if (req.method === 'GET') return j(filtro(url).slice(0, +(url.searchParams.get('limit') || 1e9)).map(r => JSON.parse(JSON.stringify(r))));
        if (req.method === 'POST') { const b = await req.json(); const r = { id: uuid(), liberada_em: null, ...b }; rows.push(r); return j([JSON.parse(JSON.stringify(r))], 201); }
        if (req.method === 'PATCH') { const b = await req.json(); const hit = filtro(url); hit.forEach(r => Object.assign(r, b)); return j(hit.map(r => JSON.parse(JSON.stringify(r)))); }
      }
      const m = p.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
      if (m) {
        const key = m[1] + '/' + decodeURIComponent(m[2]);
        if (req.method === 'POST') { const buf = new Uint8Array(await req.arrayBuffer()); files.set(key, { buf, mime: req.headers.get('content-type') }); return j({ Key: key }); }
        if (req.method === 'DELETE') { files.delete(key); return j({ message: 'Successfully deleted' }); }
        if (req.method === 'GET') {
          const f = files.get(key); if (!f) return j({ message: 'Object not found' }, 404);
          const rg = /bytes=(\d+)-(\d*)/.exec(req.headers.get('range') || '');
          if (rg) { const a = +rg[1], b = rg[2] ? +rg[2] : f.buf.length - 1; return new Response(f.buf.slice(a, b + 1), { status: 206, headers: { 'content-type': f.mime, 'content-range': 'bytes ' + a + '-' + b + '/' + f.buf.length, 'content-length': String(b - a + 1) } }); }
          return new Response(f.buf, { headers: { 'content-type': f.mime, 'content-length': String(f.buf.length) } });
        }
      }
      return j({ message: 'not found' }, 404);
    }
    return { fetch: fetchFake, rows, files };
  }
  root.FakeSupabase = { criar };
  if (typeof module !== 'undefined') module.exports = root.FakeSupabase;
})(typeof window !== 'undefined' ? window : globalThis);
