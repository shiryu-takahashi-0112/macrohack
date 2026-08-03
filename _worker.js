// MACROHACK — Cloudflare Worker (Static Assets) カスタムスクリプト
// 目的：Web Analytics集計からShiryuさん本人のテストアクセスを除外するため、
//       クライアント側（index.html）が呼び出せる `/api/is-admin` を追加する。
//
// ▼ デプロイ手順（Shiryuさん作業）
//   1. このファイルを `_worker.js` にリネームし、Cloudflare Workers の
//      「静的アセット（Assets）」機能を使っているプロジェクトのルートに配置する
//      （index.html 等の静的ファイルと同じ階層、またはwrangler.tomlのassetsディレクトリ直下）。
//   2. wrangler.toml（または既存の設定）で assets binding 名が `ASSETS` になっていることを確認。
//      デフォルト設定であれば変更不要。
//   3. 通常どおりデプロイすると、`/api/is-admin` 以外のリクエストは
//      これまでどおり静的ファイル（index.html等）がそのまま配信される。
//
// ▼ 動作仕様
//   - GET/HEAD `/api/is-admin` にアクセスすると、リクエスト元IP（CF-Connecting-IP）が
//     Shiryuさんのテスト用除外IPと一致するかどうかを判定し、JSONで返す。
//     例: { "isAdmin": true }
//   - キャッシュされないよう Cache-Control: no-store を付与。
//   - 上記以外のパスは env.ASSETS.fetch(request) にフォールバックし、
//     既存の静的サイト配信を一切変更しない。
//
// ▼ フロントエンド連携（次タスク：8/2 動作確認 or 別途実装予定）
//   index.html側で起動時に fetch('/api/is-admin') を呼び、
//   isAdmin === true の場合は Cloudflare Web Analytics のビーコンscriptタグを
//   注入しない（もしくは即座にremoveする）ことで、Shiryuさん本人のアクセスを
//   Web Analytics の実訪問数（Visits）から除外できる。
//   ※ Cloudflare Web Analytics はサーバー側IPフィルタを提供していないため、
//     クライアント側でビーコン読み込みを止める方式を採用する。

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/is-admin") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      // Shiryuさん本人のテスト用除外IPアドレス(環境変数 ADMIN_IP から読み込み)
      const ADMIN_IPS = [env.ADMIN_IP];

      const clientIp = request.headers.get("CF-Connecting-IP") || "";
      const isAdmin = ADMIN_IPS.includes(clientIp);

      return new Response(JSON.stringify({ isAdmin }), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    // それ以外は既存の静的アセット配信にフォールバック（挙動は変更しない）
    return env.ASSETS.fetch(request);
  },
};
