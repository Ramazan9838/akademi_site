// Şifreli site için service worker (diğer şifreli sitelerdeki düzenle aynı).
// Açık repoda yalnızca şifreli dosyalar (k/<ad>) bulunur. Giriş sayfası, kullanıcının kendi adı + şifresiyle
// kasadan açtığı ana anahtarı buraya bırakır; sitenin her isteği burada yakalanır, ilgili şifreli dosya
// indirilir ve tarayıcıda çözülerek sayfaya verilir. Anahtar dışa aktarılamaz biçimde IndexedDB'de durur.
const KAPSAM = new URL(self.registration.scope);
const ACIK = new Set(['sw.js', 'kasa.json', 'robots.txt']);
const TURLER = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', txt: 'text/plain; charset=utf-8', wasm: 'application/wasm',
};
const tur = (yol) => TURLER[yol.split('.').pop().toLowerCase()] || 'application/octet-stream';
const metin = (s) => new TextEncoder().encode(s);
// Yalnız şifreli statik dosyalar önbelleğe alınır. Güncel veritabanı hariçtir.
const ONBELLEK = 'tgm-statik-3b1dbe43d347dc8d';
const statikMi = (yol) => yol.startsWith('assets/') ||
  ['yerel/sunucu.zip', 'yerel/isci.js'].includes(yol);

// ------------------------------------------------------------------ anahtar deposu (IndexedDB)
// IndexedDB bütün <kullanıcı>.github.io sitelerince paylaşılır; karışmaması için ad sitenin yoluna bağlıdır.
const DB_ADI = `kasa:${KAPSAM.pathname}`;
function db() {
  return new Promise((ok, hata) => {
    const r = indexedDB.open(DB_ADI, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('s');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => hata(r.error);
  });
}
async function depo(islem, deger) {
  const d = await db();
  return new Promise((ok, hata) => {
    const s = d.transaction('s', islem === 'al' ? 'readonly' : 'readwrite').objectStore('s');
    const r = islem === 'al' ? s.get('k') : islem === 'yaz' ? s.put(deger, 'k') : s.delete('k');
    r.onsuccess = () => ok(r.result ?? null);
    r.onerror = () => hata(r.error);
  });
}
let ANAHTAR = null; // { aes, mac, bitis, uid, entryId, username }
async function anahtar() {
  if (!ANAHTAR) ANAHTAR = await depo('al').catch(() => null);
  if (ANAHTAR && ANAHTAR.bitis < Date.now()) await cikis();
  return ANAHTAR;
}
async function cikis() { ANAHTAR = null; await depo('sil').catch(() => {}); }

// ------------------------------------------------------------------ yaşam döngüsü ve mesajlar
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  await Promise.all((await caches.keys())
    .filter((ad) => ad.startsWith('tgm-statik-') && ad !== ONBELLEK)
    .map((ad) => caches.delete(ad)));
  await self.clients.claim();
})()));
self.addEventListener('message', (e) => {
  const m = e.data || {};
  const cevapla = (v) => e.ports[0] && e.ports[0].postMessage(v);
  e.waitUntil((async () => {
    try {
      if (m.tur === 'giris') {
        const ham = new Uint8Array(m.ham);
        const aes = await crypto.subtle.importKey('raw', ham.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
        const mac = await crypto.subtle.importKey('raw', ham.slice(32, 64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        ANAHTAR = { aes, mac, bitis: Date.now() + (m.kalici ? 30 * 864e5 : 12 * 36e5), uid: m.uid, entryId: m.entryId, username: m.username };
        await depo('yaz', ANAHTAR);
        cevapla({ ok: true });
      } else if (m.tur === 'cikis') {
        await cikis();
        cevapla({ ok: true });
      }
    } catch (h) { cevapla({ ok: false, hata: String(h) }); }
  })());
});

// ------------------------------------------------------------------ istekleri çözme
async function dosyaAdi(mac, yol) {
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', mac, metin(`ad\u0000${yol}`)));
  return [...h.slice(0, 20)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const girise = () => Response.redirect(KAPSAM.href, 302);

async function cevap(istek, yol) {
  const gezinme = istek.mode === 'navigate';
  if (yol === 'cikis') { await cikis(); return girise(); }
  const a = await anahtar();
  if (!a) {
    if (yol === 'index.html') return fetch(istek); // giriş sayfası
    return gezinme ? girise() : new Response('Giriş gerekli', { status: 401 });
  }
  const sifreliUrl = new URL(`k/${await dosyaAdi(a.mac, yol)}`, KAPSAM);
  let r;
  if (statikMi(yol)) {
    const onbellek = await caches.open(ONBELLEK);
    r = await onbellek.match(sifreliUrl);
    if (!r) {
      r = await fetch(sifreliUrl, { cache: 'no-cache' });
      if (r.ok) await onbellek.put(sifreliUrl, r.clone()).catch(() => {});
    }
  } else {
    r = await fetch(sifreliUrl, { cache: 'no-cache' });
  }
  if (!r.ok) {
    if (gezinme && yol === 'index.html') { await cikis(); return fetch(istek); }
    return new Response('Bulunamadı', { status: 404 });
  }
  const b = new Uint8Array(await r.arrayBuffer());
  try {
    const duz = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12), additionalData: metin(yol) }, a.aes, b.subarray(12));
    return new Response(duz, { headers: { 'Content-Type': tur(yol), 'Cache-Control': 'no-store' } });
  } catch {
    await cikis();
    return gezinme ? girise() : new Response('Anahtar geçersiz', { status: 403 });
  }
}

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== KAPSAM.origin || !u.pathname.startsWith(KAPSAM.pathname)) return;
  let yol;
  try { yol = decodeURIComponent(u.pathname.slice(KAPSAM.pathname.length)); } catch { return; }
  if (yol === '' || yol.endsWith('/')) yol += 'index.html';
  if (ACIK.has(yol) || yol.startsWith('k/')) return;
  e.respondWith(cevap(e.request, yol));
});
