// MACROHACK service worker — app shell offline cache
// 更新履歴: 2026-08-05 巧
//   [修正] "./" と "./index.html" をキャッシュ優先(cache-first)対象から除外し、
//   ネットワーク優先(network-first)に変更。
//   [背景] 旧バージョンはHTML本体もインストール時にキャッシュ優先で固定していたため、
//   本番のindex.htmlを更新しても、一度キャッシュされた端末（特にホーム画面追加＝PWA）
//   には新しい内容が反映されないままになっていた（sw.js自体が変わらない限りキャッシュが
//   更新されないため）。
//   [対応方針] HTML本体は毎回ネットワークから取得を試み、取得できた場合のみキャッシュを
//   更新する。オフライン時のみ最後に取得できたキャッシュにフォールバックする。
//   アイコン等の静的アセットは従来どおりキャッシュ優先（オフライン時の表示速度・安定性を優先）。
//
// [重要] このCACHE名は「デプロイのたびに」変更してください（例: macrohack-v3, macrohack-v4 ...）。
// ブラウザはsw.js自体のバイト列が変わったときだけ新しいService Workerを検知するため、
// 中身（ASSETSの参照先ファイルの実体）だけ変えてもこの文字列が同じだと更新が走りません。
const CACHE = "macrohack-v2";

// 事前キャッシュするのはアプリ本体（HTML）以外の「更新頻度が低い」静的アセットのみ。
// index.html は意図的に含めない（常にネットワークから最新を取りに行くため）。
const ASSETS = [
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./og-image.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() =>
        // 新しいSWが有効化されたことを、開いている全クライアント（ホーム画面PWA含む）に通知。
        // index.html側でこのメッセージを受け取り、「更新があります」バナーを出す想定
        // （pwa-update-check.js が対応）。
        self.clients.matchAll({ type: "window" }).then((clients) => {
          clients.forEach((client) => client.postMessage({ type: "MH_SW_UPDATED" }));
        })
      )
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === location.origin;
  const isNavigation =
    req.mode === "navigate" ||
    (isSameOrigin && (url.pathname === "/" || url.pathname.endsWith("/index.html")));

  if (isNavigation) {
    // HTML本体：ネットワーク優先。取得できたらキャッシュも更新し、
    // オフライン時のみキャッシュ済みの最後のindex.htmlにフォールバック。
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  // それ以外の同一オリジンの静的アセット：キャッシュ優先、なければネットワークから取得しキャッシュ。
  // 解析ビーコン等の外部リクエストはネットワーク優先（従来どおり）。
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res.ok && isSameOrigin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
