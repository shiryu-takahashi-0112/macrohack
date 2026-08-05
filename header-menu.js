/*
 * MACROHACK — ヘッダー右上メニュー（保存・提案履歴・マイページ）
 * 担当：彩（UI/UX） × 巧（実装） / 2026-08-05（v3）
 *
 * ▼ v3での変更点
 * ・本番のFirebase Authentication + Firestoreのログイン状態と連携する形に修正。
 * ・ログイン中は「保存した提案」「提案履歴」「ログアウト」を表示。
 *   未ログイン時は「ログイン / 新規登録」のみ表示。
 * ・既存の単独「ログアウト」ボタンはこのメニューに統合し、index.html側で撤去した。
 *
 * ▼ 導入方法（index.html への差し込み）
 * 1. このファイルを deploy/ 直下に "header-menu.js" として配置する。
 * 2. index.html の </body> 直前に1行追加：
 *    <script src="header-menu.js"></script>
 * 3. 既存の <header> の中身・CSSは変更不要（本スクリプトが自動でボタンを注入する）。
 *
 * ▼ index.html 側で用意する連携ポイント（実装済み）
 *   window.MH_AUTH_STATE = { loggedIn: boolean, name: string };
 *   window.dispatchEvent(new Event("mh:auth-changed"));
 *   window.MH_OPEN_LOGIN = function(){ ... };   // ログイン/新規登録ゲートを開く
 *   window.MH_LOGOUT = function(){ ... };       // ログアウトを実行する
 *   window.MH_MENU_HOOKS = {
 *     renderFavorites: function (containerEl) { ... },
 *     renderHistory: function (containerEl) { ... }
 *   };
 *   window.MH_MENU_CLOSE = function(){ ... };   // 外部から（提案を選択した時など）メニューを閉じる
 */
(function () {
  "use strict";

  function injectStyle() {
    var css =
      "header{position:relative}" +
      ".mh-menu-btn{position:absolute;top:14px;right:14px;width:40px;height:40px;" +
      "border-radius:50%;border:1.5px solid rgba(255,255,255,.55);background:rgba(255,255,255,.12);" +
      "color:#fff;font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;" +
      "cursor:pointer;z-index:20}" +
      ".mh-menu-btn:active{background:rgba(255,255,255,.25)}" +
      ".mh-menu-overlay{position:fixed;inset:0;background:rgba(0,0,0,.25);z-index:29;opacity:0;" +
      "pointer-events:none;transition:opacity .15s ease}" +
      ".mh-menu-overlay.open{opacity:1;pointer-events:auto}" +
      ".mh-menu-panel{position:fixed;top:64px;right:14px;left:14px;max-width:320px;margin-left:auto;" +
      "background:#fff;border-radius:16px;box-shadow:0 8px 28px rgba(120,0,0,.18);z-index:30;" +
      "overflow:hidden;transform:translateY(-8px);opacity:0;pointer-events:none;" +
      "transition:transform .15s ease,opacity .15s ease;max-height:70vh;display:flex;flex-direction:column}" +
      ".mh-menu-panel.open{transform:translateY(0);opacity:1;pointer-events:auto}" +
      ".mh-menu-mypage{padding:14px 16px;border-bottom:1px solid #ece2e2;display:flex;align-items:center;gap:10px;flex-shrink:0}" +
      ".mh-menu-mypage .mh-avatar{width:34px;height:34px;border-radius:50%;background:#fdeaea;" +
      "color:#DD0000;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}" +
      ".mh-menu-mypage .mh-status-title{font-size:13px;font-weight:800;color:#241a1a;" +
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}" +
      ".mh-menu-mypage .mh-status-sub{font-size:11.5px;color:#8a7c7c;margin-top:1px}" +
      ".mh-menu-item{display:flex;align-items:center;gap:10px;padding:13px 16px;font-size:13.5px;" +
      "color:#241a1a;cursor:pointer;border-bottom:1px solid #f2ecec;font-weight:600}" +
      ".mh-menu-item:last-child{border-bottom:none}" +
      ".mh-menu-item:active{background:#fdeaea}" +
      ".mh-menu-item .mh-ic{width:20px;text-align:center;font-size:15px}" +
      ".mh-menu-item .mh-chev{margin-left:auto;color:#c8bcbc;font-size:12px}" +
      ".mh-menu-back{display:flex;align-items:center;gap:8px;padding:13px 16px;font-size:13px;" +
      "font-weight:700;color:#241a1a;cursor:pointer;border-bottom:1px solid #ece2e2;flex-shrink:0}" +
      ".mh-menu-back:active{background:#fdeaea}" +
      ".mh-menu-subbody{overflow-y:auto;padding:6px 0}" +
      ".mh-menu-empty{padding:22px 16px;text-align:center;font-size:12.5px;color:#8a7c7c}" +
      ".mh-menu-subbody .saved{padding:10px 16px;border-bottom:1px solid #f2ecec}" +
      ".mh-menu-subbody .saved:last-child{border-bottom:none}";
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function getAuthState() {
    if (window.MH_AUTH_STATE && window.MH_AUTH_STATE.loggedIn) {
      return { loggedIn: true, name: window.MH_AUTH_STATE.name || "ログイン中" };
    }
    return { loggedIn: false, name: "" };
  }

  var overlayEl, panelEl, btnEl, isOpen = false, currentView = "main";

  function renderMain() {
    var auth = getAuthState();
    var mypageHtml = auth.loggedIn
      ? '<div class="mh-menu-mypage"><div class="mh-avatar">👤</div><div><div class="mh-status-title">' + auth.name + '</div><div class="mh-status-sub">ログイン中</div></div></div>'
      : '<div class="mh-menu-mypage"><div class="mh-avatar">👤</div><div><div class="mh-status-title">ログインしていません</div><div class="mh-status-sub">ログインすると保存・履歴が使えます</div></div></div>';

    var items = auth.loggedIn
      ? [
          { icon: "⭐", label: "保存した提案", view: "favorites" },
          { icon: "🕐", label: "提案履歴", view: "history" },
          { icon: "🚪", label: "ログアウト", action: "logout" },
          { icon: "💬", label: "ご要望・不具合を報告", external: true }
        ]
      : [
          { icon: "🔑", label: "ログイン / 新規登録", action: "login" },
          { icon: "💬", label: "ご要望・不具合を報告", external: true }
        ];

    panelEl.innerHTML = mypageHtml;
    items.forEach(function (item) {
      var el = document.createElement("div");
      el.className = "mh-menu-item";
      el.innerHTML =
        '<span class="mh-ic">' + item.icon + '</span><span>' + item.label + '</span>' +
        (item.view ? '<span class="mh-chev">›</span>' : "");
      el.addEventListener("click", function () {
        if (item.external) {
          var link = document.querySelector("a[href*='forms.gle']");
          if (link) window.open(link.href, "_blank");
          closeMenu();
        } else if (item.action === "login") {
          closeMenu();
          if (typeof window.MH_OPEN_LOGIN === "function") window.MH_OPEN_LOGIN();
        } else if (item.action === "logout") {
          closeMenu();
          if (typeof window.MH_LOGOUT === "function") window.MH_LOGOUT();
        } else {
          renderSubView(item.view, item.label);
        }
      });
      panelEl.appendChild(el);
    });
  }

  function renderSubView(view, title) {
    currentView = view;
    panelEl.innerHTML = "";

    var back = document.createElement("div");
    back.className = "mh-menu-back";
    back.innerHTML = "<span>←</span><span>" + title + "</span>";
    back.addEventListener("click", function () {
      currentView = "main";
      renderMain();
    });
    panelEl.appendChild(back);

    var body = document.createElement("div");
    body.className = "mh-menu-subbody";
    panelEl.appendChild(body);

    var hooks = window.MH_MENU_HOOKS || {};
    if (view === "favorites" && typeof hooks.renderFavorites === "function") {
      hooks.renderFavorites(body);
    } else if (view === "history" && typeof hooks.renderHistory === "function") {
      hooks.renderHistory(body);
    } else {
      var emptyText = view === "favorites" ? "まだ保存された提案はありません" : "まだ表示した提案の履歴はありません";
      var empty = document.createElement("div");
      empty.className = "mh-menu-empty";
      empty.textContent = emptyText;
      body.appendChild(empty);
    }
  }

  function openMenu() {
    isOpen = true;
    currentView = "main";
    renderMain();
    overlayEl.classList.add("open");
    panelEl.classList.add("open");
  }
  function closeMenu() {
    isOpen = false;
    overlayEl.classList.remove("open");
    panelEl.classList.remove("open");
  }

  window.addEventListener("mh:auth-changed", function () {
    if (isOpen && currentView === "main") renderMain();
  });

  function init() {
    var header = document.querySelector("header");
    if (!header) return;

    injectStyle();

    btnEl = document.createElement("button");
    btnEl.className = "mh-menu-btn";
    btnEl.setAttribute("aria-label", "メニュー");
    btnEl.textContent = "⋮";
    header.appendChild(btnEl);

    overlayEl = document.createElement("div");
    overlayEl.className = "mh-menu-overlay";
    document.body.appendChild(overlayEl);

    panelEl = document.createElement("div");
    panelEl.className = "mh-menu-panel";
    document.body.appendChild(panelEl);

    btnEl.addEventListener("click", function () {
      isOpen ? closeMenu() : openMenu();
    });
    overlayEl.addEventListener("click", closeMenu);

    window.MH_MENU_CLOSE = closeMenu;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
