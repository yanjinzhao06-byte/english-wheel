/* ===========================================================
 *  英语 · 单词轮盘 · 离线缓存 Service Worker
 *  —— 联网时优先拿新文件（改完刷新就生效），断网时用缓存
 *
 *  ⚠️ 改完网页文件后，把下面的版本号往上加一（再上传）。
 * =========================================================== */
const VERSION = 'v10';
const CACHE = 'english-wheel-' + VERSION;

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './words.js',
  './sentences.js',
  './manifest.webmanifest',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './restore.html',
  './study.html',
  './study.css',
  './study.js',
  './data/data-tcm.js',
  './data/data-grammar.js',
  './data/data-errors.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  // 图片：缓存优先（省流量、不常变）
  if (/\.(png|jpe?g|webp|gif|ico|svg)$/i.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(req)))
    );
    return;
  }

  // 页面 / JS / CSS / JSON：联网优先，断网回退缓存
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
