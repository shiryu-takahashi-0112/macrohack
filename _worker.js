// _worker.js
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/slack-notify") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      const providedSecret = request.headers.get("X-Relay-Secret") || "";
      if (!env.RELAY_SECRET || providedSecret !== env.RELAY_SECRET) {
        return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }
      let payload;
      try {
        payload = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }
      if (!payload.channel || !payload.text) {
        return new Response(JSON.stringify({ ok: false, error: "missing_channel_or_text" }), {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }
      const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          channel: payload.channel,
          text: payload.text,
          thread_ts: payload.thread_ts
        })
      });
      const slackJson = await slackRes.json();
      return new Response(JSON.stringify(slackJson), {
        status: slackRes.ok ? 200 : 502,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });
    }
    if (url.pathname === "/api/is-admin") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      const ADMIN_IPS = [env.ADMIN_IP];
      const clientIp = request.headers.get("CF-Connecting-IP") || "";
      const isAdmin = ADMIN_IPS.includes(clientIp);
      return new Response(JSON.stringify({ isAdmin }), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });
    }
    if (url.pathname === "/api/user-count") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY || !env.FIREBASE_PROJECT_ID) {
        return new Response(JSON.stringify({
          ok: false,
          error: "not_configured",
          message: "FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY / FIREBASE_PROJECT_ID がCloudflare Workerのシークレットに未設定です"
        }), {
          status: 501,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
        });
      }
      try {
        const accessToken = await getGoogleAccessToken(env);
        const userCount = await countFirebaseUsers(env.FIREBASE_PROJECT_ID, accessToken);
        return new Response(JSON.stringify({ ok: true, userCount, asOf: new Date().toISOString() }), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: "fetch_failed", message: String((e && e.message) || e) }), {
          status: 502,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
        });
      }
    }
    return env.ASSETS.fetch(request);
  }
};

/* ---- Firebase Authentication ユーザー数取得（サービスアカウント経由） ----
 * 担当：巧（FE） / 2026-08-07
 * 必要なシークレット（Cloudflareダッシュボード → Workers & Pages → macrohack → Settings → Variables で設定。
 * Shiryuさんが直接値を入力すること。このファイル自体には鍵の値は一切含まれない）：
 *   - FIREBASE_PROJECT_ID     : Firebaseプロジェクト ID（例: macrohack-66aa2）
 *   - FIREBASE_CLIENT_EMAIL   : サービスアカウントの client_email
 *   - FIREBASE_PRIVATE_KEY    : サービスアカウントの private_key
 *       （JSON内では改行が \n として含まれているので、Cloudflareのシークレットには
 *        そのまま貼り付けてOK。本コード側で \n を実改行に変換して読み込む）
 */

function base64UrlEncode(bytes) {
  const bytesArr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < bytesArr.length; i++) binary += String.fromCharCode(bytesArr[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function strToBase64Url(str) {
  return base64UrlEncode(new TextEncoder().encode(str));
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    sub: env.FIREBASE_CLIENT_EMAIL,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/identitytoolkit"
  };
  const signingInput = `${strToBase64Url(JSON.stringify(header))}.${strToBase64Url(JSON.stringify(claims))}`;
  const privateKeyPem = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");
  const keyData = pemToArrayBuffer(privateKeyPem);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

async function getGoogleAccessToken(env) {
  const jwt = await signJwt(env);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`token exchange failed: ${res.status} ${t}`);
  }
  const json = await res.json();
  return json.access_token;
}

async function countFirebaseUsers(projectId, accessToken) {
  let total = 0;
  let nextPageToken = "";
  do {
    const params = new URLSearchParams({ maxResults: "1000" });
    if (nextPageToken) params.set("nextPageToken", nextPageToken);
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:batchGet?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`accounts:batchGet failed: ${res.status} ${t}`);
    }
    const json = await res.json();
    const users = json.users || json.userInfo || [];
    total += users.length;
    nextPageToken = json.nextPageToken || "";
  } while (nextPageToken);
  return total;
}

export {
  worker_default as default
};
