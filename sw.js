/* KAS SLD.ID — service worker supaya aplikasi cepat dibuka & tetap terbuka saat sinyal lemah.
 * Hanya menyimpan FILE TAMPILAN (html, js, css, ikon). Catatan kas tetap di localStorage
 * dan tidak pernah dibaca, diubah, atau dihapus di sini.
 *
 * - Halaman utama: langsung dari salinan di HP, lalu diperbarui diam-diam dari internet.
 *   Jika ada versi baru, halaman diberi tahu agar bisa muat ulang.
 * - assets/* (nama berisi hash, tidak pernah berubah): dari salinan di HP.
 * - File lain di situs ini: dari salinan, sambil diperbarui di latar belakang.
 * - Situs lain (font Google): tidak disentuh.
 */
const CACHE = 'kas-shell-v1';
const SHELL = new URL('./', self.location).href;
const SHELL_PATHS = [new URL('./', self.location).pathname, new URL('./index.html', self.location).pathname];

const refsIn = (html) =>
  [...html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)].map((m) => new URL(m[1], SHELL).href).filter((u) => !u.includes('/vendor/pdf/'));

async function cacheShell(cache, response) {
  const html = await response.clone().text();
  await cache.put(SHELL, response);
  const wanted = refsIn(html);
  await Promise.all(wanted.map(async (url) => {
    if (await cache.match(url)) return;
    try { const r = await fetch(url); if (r.ok) await cache.put(url, r); } catch { /* coba lagi lain kali */ }
  }));
  // Buang assets versi lama yang tidak dipakai halaman terbaru
  const keep = new Set(wanted);
  for (const req of await cache.keys()) if (req.url.includes('/assets/') && !keep.has(req.url)) await cache.delete(req);
  return html;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try { const r = await fetch(SHELL, { cache: 'no-store' }); if (r.ok) await cacheShell(cache, r); } catch { /* offline: isi nanti */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('kas-shell-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function refreshShell() {
  const cache = await caches.open(CACHE);
  const old = await cache.match(SHELL);
  const oldHtml = old ? await old.text() : '';
  const r = await fetch(SHELL, { cache: 'no-store' });
  if (!r.ok) return;
  const html = await cacheShell(cache, r);
  if (oldHtml && html !== oldHtml) {
    for (const client of await self.clients.matchAll({ type: 'window' })) client.postMessage({ type: 'kas-update' });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    if (!SHELL_PATHS.includes(url.pathname)) return; // mis. legacy.html: biasa saja
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(SHELL);
      const update = refreshShell().catch(() => {});
      if (cached) { event.waitUntil(update); return cached; }
      try { const r = await fetch(req); return r; } finally { event.waitUntil(update); }
    })());
    return;
  }

  if (url.pathname.endsWith('/sw.js')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (url.pathname.includes('/assets/')) {
      if (cached) return cached;
      const r = await fetch(req);
      if (r.ok) event.waitUntil(cache.put(req, r.clone()));
      return r;
    }
    const network = fetch(req).then((r) => { if (r.ok && !url.pathname.includes('/vendor/pdf/')) return cache.put(req, r.clone()).then(() => r); return r; });
    if (cached) { event.waitUntil(network.catch(() => {})); return cached; }
    return network;
  })());
});
