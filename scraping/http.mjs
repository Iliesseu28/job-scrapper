// ============================================================================
// HTTP — the one function every collector receives.
//   http({ method, url, headers, body, brut, binaire, timeout })
//   → parsed JSON by default · text when `brut` · ArrayBuffer when `binaire`
// A non-2xx response throws an Error whose message starts with "HTTP <code>":
// the AI pass relies on it to retry on 429/5xx.
// Collectors never call fetch() directly, so the same code can run anywhere a
// function with this signature exists (Node, n8n Code nodes, tests with a fake).
// ============================================================================
export async function http({ method = 'GET', url, headers = {}, body, brut = false, binaire = false, timeout = 45000 }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const init = { method, headers: { ...headers }, signal: ctrl.signal };
    if (body !== undefined) {
      const isText = typeof body === 'string';
      const isBinary = body instanceof ArrayBuffer || ArrayBuffer.isView(body);
      init.body = isText || isBinary ? body : JSON.stringify(body);
      if (!isText && !isBinary && !Object.keys(init.headers).some((h) => h.toLowerCase() === 'content-type')) {
        init.headers['Content-Type'] = 'application/json';
      }
    }
    const r = await fetch(url, init);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status} ${method} ${url.slice(0, 120)} — ${txt.slice(0, 300)}`);
    }
    if (binaire) return await r.arrayBuffer();
    const txt = await r.text();
    if (brut) return txt;
    if (!txt) return null;
    try { return JSON.parse(txt); } catch { return txt; }
  } finally {
    clearTimeout(t);
  }
}

/** Wraps `http` and counts calls, so each source's cost shows up in the run log. */
export function countingHttp(base = http) {
  const counter = { calls: 0 };
  const fn = (req) => { counter.calls++; return base(req); };
  fn.counter = counter;
  return fn;
}
