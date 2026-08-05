/*
 * MACROHACK — PWA更新チェック（新バージョン通知バナー）
 * 担当：巧（FE） / 2026-08-05
 *
 * ▼ 背景
 * sw.js をnetwork-first化しても、iOSのホーム画面追加アプリ（PWA）は
 * 「完全に閉じて再度開く」までは通信を行わず、バックグラウンドから復帰しただけの
 * 場合は古い画面のまま動き続けることがある（iOS Safariの仕様）。
 * このスクリプトは、アプリがフォアグラウンドに戻ったタイミングで新しいService Workerが
 * 有効化されていないか確認し、更新があれば控えめなバナーで知らせて再読み込みを促す。
 *
 * ▼ 導入方法（index.html への差し込み）
 * 1. このファイルを deploy/ 直下に "pwa-update-check.js" として配置する。
 * 2. index.html の </body> 直前（sw.js 登録スクリプトの後）に1行追加：
 *    <script src="pwa-update-check.js"></script>
 * 3. CSSは本ファイル内で <style> をJSから注入するため、index.html側の追加編集は不要。
 *
 * ▼ 挙動
 * - Service Worker から MH_SW_UPDATED メッセージを受け取った場合、または
 *   アプリがフォアグラウンドに戻った際に registration.update() を呼んで更新有無を確認した場合、
 *   画面下部に「新しいバージョンがあります」バナーを表示。
 * - 「更新する」タップで location.reload()。
 * - 「あとで」タップで今回のセッション中は再表示しない。
 */
(function () {
  "use strict";

  if (!("serviceWorker" in navigator)) return;

  var shown = false;
  var dismissedThisSession = false;

  function injectStyle() {
    var css =
      ".mh-update-banner{position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;" +
      "background:#241a1a;color:#fff;border-radius:14px;box-shadow:0 4px 20px rgba(0,0,0,.25);" +
      "padding:12px 14px;display:flex;align-items:center;gap:10px;font-size:13px;" +
      "animation:mh-slide-up .25s ease-out}" +
      "@keyframes mh-slide-up{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}" +
      ".mh-update-banner .mh-msg{flex:1;line-height:1.4}" +
      ".mh-update-banner .mh-btn{border:none;border-radius:9px;padding:8px 12px;font-size:12px;" +
      "font-weight:800;cursor:pointer;white-space:nowrap}" +
      ".mh-update-banner .mh-btn.primary{background:#DD0000;color:#fff}" +
      ".mh-update-banner .mh-btn.ghost{background:transparent;border:1.5px solid rgba(255,255,255,.35);color:#fff;margin-left:6px}";
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function showBanner() {
    if (shown || dismissedThisSession) return;
    shown = true;
    injectStyle();

    var el = document.createElement("div");
    el.className = "mh-update-banner";
    el.id = "mhUpdateBanner";
    el.innerHTML =
      '<div class="mh-msg">新しいバージョンがあります</div>' +
      '<button class="mh-btn primary" id="mhUpdateReloadBtn">更新する</button>' +
      '<button class="mh-btn ghost" id="mhUpdateLaterBtn">あとで</button>';
    document.body.appendChild(el);

    document.getElementById("mhUpdateReloadBtn").addEventListener("click", function () {
      window.location.reload();
    });
    document.getElementById("mhUpdateLaterBtn").addEventListener("click", function () {
      dismissedThisSession = true;
      if (el.parentNode) el.parentNode.removeChild(el);
      shown = false;
    });
  }

  // 新しいSWがactivateされたことの通知を受け取る
  navigator.serviceWorker.addEventListener("message", function (event) {
    if (event.data && event.data.type === "MH_SW_UPDATED") {
      showBanner();
    }
  });

  // アプリがフォアグラウンドに戻ったタイミングで更新確認を行う
  // （iOSのホーム画面PWAはバックグラウンド復帰時に自動で通信しないための対策）
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (reg) reg.update().catch(function () {});
    });
  });

  window.addEventListener("pageshow", function () {
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (reg) reg.update().catch(function () {});
    });
  });
})();
