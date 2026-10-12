// sw.js — ホーム画面に「インストール」できる条件を満たすためだけの、最小の Service Worker（しりとりと同じ。Phase 3 Step 18）。
// 何も保存しない（オフライン対応なし）。取りに行くたびにサーバーへ確かめる（cache: 'no-cache'）ので、古い版が残り続けない。
// 登録は src/main.js（http(s) で開いたときだけ）。
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;   // 読み込み以外はブラウザにまかせる
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).catch(function () { return fetch(e.request); })
  );
});
