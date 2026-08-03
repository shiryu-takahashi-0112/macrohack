/*
 * MACROHACK — ホーム画面追加導線（A2HS: Add to Home Screen）
 * 担当：巧（FE） / 2026-08-04
 * 元設計：2026-08-03_home-screen-add-ui-design.html（彩）
 *
 * ▼ 導入方法（index.html への差し込み）
 *   1. このファイルを deploy/ 直下に "a2hs.js" として配置する。
 *   2. index.html の </body> 直前（sw.js 登録スクリプトの後）に1行追加：
 *        <script src="a2hs.js"></script>
 *   3. CSSは本ファイル内で <style> をJSから注入するため、index.html側の編集は上記1行のみ。
 *
 * ▼ 挙動
 *   - すでにPWAとして起動中（display-mode: standalone / iOS navigator.standalone）なら何もしない。
 *   - 直近14日以内に閉じている場合は再表示しない（localStorage: mh_a2hs_dismissed_at）。
 *   - #resultCard が表示された（class="hidden" が外れた）タイミングで初表示。
 *   - iOS Safari → 手順テキスト表示。
 *   - Android等 beforeinstallprompt 対応ブラウザ → 「追加する」ボタンでネイティブプロンプト起動。
 *   - それ以外 → メニューからの手順テキスト（フォールバック）。
 */
(function () {
  "use strict";

  var DISMISS_KEY = "mh_a2hs_dismissed_at";
  var DISMISS_DAYS = 14;
  var shown = false;
  var deferredPrompt = null;

  function isStandalone() {
    return (
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      window.navigator.standalone === true
    );
  }

  function isDismissedRecently() {
    var raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    var elapsedDays = (Date.now() - Number(raw)) / (1000 * 60 * 60 * 24);
    return elapsedDays < DISMISS_DAYS;
  }

  function isIOS() {
    return /iP(hone|od|ad)/.test(navigator.userAgent);
  }

  function injectStyle() {
    var css =
      ".a2hs{background:#fff;border-radius:16px;box-shadow:0 2px 14px rgba(120,0,0,.08);" +
      "padding:14px 16px;display:flex;gap:12px;align-items:flex-start;position:relative;margin-top:16px}" +
      ".a2hs .ic{width:38px;height:38px;border-radius:10px;background:var(--red-tint,#fdeaea);" +
      "display:grid;place-items:center;font-size:19px;flex-shrink:0}" +
      ".a2hs .body{flex:1;min-width:0}" +
      ".a2hs .t{font-size:13px;font-weight:800;margin-bottom:3px}" +
      ".a2hs .d{font-size:11.5px;color:var(--sub,#8a7c7c);line-height:1.5}" +
      ".a2hs .steps{margin-top:8px;font-size:11.5px;color:var(--ink,#241a1a);background:var(--red-tint,#fdeaea);" +
      "border-radius:8px;padding:8px 10px;line-height:1.6}" +
      ".a2hs .steps b{color:var(--red,#DD0000)}" +
      ".a2hs .close{position:absolute;top:8px;right:10px;border:none;background:none;color:var(--sub,#8a7c7c);" +
      "font-size:14px;cursor:pointer;padding:4px}" +
      ".a2hs .cta{display:flex;gap:8px;margin-top:10px}" +
      ".a2hs .btn{border:none;border-radius:9px;padding:8px 12px;font-size:12px;font-weight:800;cursor:pointer}" +
      ".a2hs .btn.primary{background:var(--red,#DD0000);color:#fff}" +
      ".a2hs .btn.ghost{background:#fff;border:1.5px solid var(--line,#ece2e2);color:var(--sub,#8a7c7c)}";
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function dismiss(el) {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function buildBanner() {
    var el = document.createElement("div");
    el.className = "a2hs";
    el.id = "a2hsBanner";

    var stepsOrCta;
    if (isIOS()) {
      stepsOrCta =
        '<div class="steps">下の <b>共有ボタン（□↑）</b> をタップ → <b>「ホーム画面に追加」</b>を選択</div>';
    } else if (deferredPrompt) {
      stepsOrCta =
        '<div class="cta">' +
        '<button class="btn primary" id="a2hsInstallBtn">追加する</button>' +
        '<button class="btn ghost" id="a2hsLaterBtn">あとで</button>' +
        "</div>";
    } else {
      stepsOrCta =
        '<div class="steps">右上の<b>メニュー（⋮）</b> → <b>「ホーム画面に追加」</b>または<b>「アプリをインストール」</b>を選択</div>';
    }

    el.innerHTML =
      '<button class="close" id="a2hsCloseBtn" aria-label="閉じる">×</button>' +
      '<div class="ic">📲</div>' +
      '<div class="body">' +
      '<div class="t">ホーム画面に追加すると次回から一発で開けます</div>' +
      '<div class="d">アプリを入れずに、ブラウザだけで使えます。</div>' +
      stepsOrCta +
      "</div>";
    return el;
  }

  function showBanner() {
    if (shown || isStandalone() || isDismissedRecently()) return;
    var resultCard = document.getElementById("resultCard");
    if (!resultCard) return;
    shown = true;

    var banner = buildBanner();
    resultCard.insertAdjacentElement("afterend", banner);

    var closeBtn = document.getElementById("a2hsCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", function () { dismiss(banner); });

    var laterBtn = document.getElementById("a2hsLaterBtn");
    if (laterBtn) laterBtn.addEventListener("click", function () { dismiss(banner); });

    var installBtn = document.getElementById("a2hsInstallBtn");
    if (installBtn) {
      installBtn.addEventListener("click", function () {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        deferredPrompt.userChoice.finally(function () {
          deferredPrompt = null;
          dismiss(banner);
        });
      });
    }
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
  });

  document.addEventListener("DOMContentLoaded", function () {
    if (isStandalone() || isDismissedRecently()) return;
    injectStyle();

    var resultCard = document.getElementById("resultCard");
    if (!resultCard) return;

    // #resultCard は class="hidden" の付け外しで表示切り替えされる設計のため監視する
    var observer = new MutationObserver(function () {
      if (!resultCard.classList.contains("hidden")) {
        showBanner();
      }
    });
    observer.observe(resultCard, { attributes: true, attributeFilter: ["class"] });

    // 既に表示済みの状態でこのスクリプトが後から評価されるケースにも対応
    if (!resultCard.classList.contains("hidden")) {
      showBanner();
    }
  });
})();
