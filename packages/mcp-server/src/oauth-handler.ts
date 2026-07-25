import { AnnictClient } from "@annict-mcp/annict-client";
import type { AuthRequest, ClientInfo } from "@cloudflare/workers-oauth-provider";
import type { Env, Props } from "./env.js";

const ANNICT_AUTHORIZE_URL = "https://api.annict.com/oauth/authorize";
const ANNICT_TOKEN_URL = "https://api.annict.com/oauth/token";

/** The record/status tools mutate data, so the write scope is required. */
const ANNICT_SCOPE = "read write";

const PENDING_TTL_SECONDS = 600;
const CSRF_COOKIE = "annict_mcp_csrf";
const STATE_COOKIE = "annict_mcp_state";

/**
 * The `__Host-` prefix mandates the Secure attribute, which browsers only
 * honour over HTTPS. Local development runs on http://localhost, so the prefix
 * is applied only where it can actually take effect.
 */
function cookieName(url: URL, base: string): string {
  return url.protocol === "https:" ? `__Host-${base}` : base;
}

function setCookie(url: URL, base: string, value: string, maxAgeSeconds: number): string {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${cookieName(url, base)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function clearCookie(url: URL, base: string): string {
  return setCookie(url, base, "", 0);
}

function readCookie(request: Request, url: URL, base: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const target = cookieName(url, base);
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === target) return rest.join("=");
  }
  return null;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}

function htmlResponse(body: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The consent screen must not be framable (clickjacking).
      "Content-Security-Policy": "frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      ...extraHeaders,
    },
  });
}

function errorPage(message: string, status: number): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>annict-mcp</title><h1>認可できませんでした</h1><p>${escapeHtml(message)}</p>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function renderConsent(client: ClientInfo, csrf: string): string {
  const name = escapeHtml(client.clientName || client.clientId);
  const redirect = escapeHtml(client.redirectUris[0] ?? "(未登録)");
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>annict-mcp へのアクセス許可</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.7; }
  dl { background: #f6f6f7; border-radius: 8px; padding: 1rem 1.25rem; }
  dt { font-size: .8rem; color: #666; }
  dd { margin: 0 0 .75rem; word-break: break-all; }
  dd:last-child { margin-bottom: 0; }
  button { font-size: 1rem; padding: .6rem 1.4rem; border-radius: 6px; border: 0; cursor: pointer; }
  .approve { background: #1a7f37; color: #fff; }
  .deny { background: #eee; }
</style>
<h1>アクセスを許可しますか？</h1>
<p><strong>${name}</strong> があなたのAnnictアカウントへのアクセスを求めています。</p>
<dl>
  <dt>クライアント</dt><dd>${name}</dd>
  <dt>リダイレクト先</dt><dd>${redirect}</dd>
  <dt>Annictに要求する権限</dt><dd>読み取り + 書き込み（視聴記録の作成・ステータス更新を含む）</dd>
</dl>
<p>許可すると、続けてAnnictのログイン画面に進みます。</p>
<form method="post">
  <input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
  <button class="approve" type="submit" name="action" value="approve">許可する</button>
  <button class="deny" type="submit" name="action" value="deny">拒否する</button>
</form>`;
}

/**
 * Renders this server's own consent screen. Annict issues a single static
 * client ID for the whole deployment, so per-client consent has to happen here
 * before any redirect to Annict — otherwise a returning user's Annict consent
 * cookie would let a newly registered client skip consent entirely.
 */
async function handleAuthorizeGet(request: Request, env: Env, url: URL): Promise<Response> {
  const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  if (!client) {
    return errorPage("OAuthクライアントが見つかりません。", 400);
  }

  // The auth request is held server-side so the browser cannot tamper with the
  // redirect URI between the consent screen and completeAuthorization().
  const csrf = randomToken();
  await env.OAUTH_KV.put(`annict_consent:${csrf}`, JSON.stringify(authRequest), {
    expirationTtl: PENDING_TTL_SECONDS,
  });

  return htmlResponse(renderConsent(client, csrf), {
    "Set-Cookie": setCookie(url, CSRF_COOKIE, csrf, PENDING_TTL_SECONDS),
  });
}

async function handleAuthorizePost(request: Request, env: Env, url: URL): Promise<Response> {
  const form = await request.formData();
  const submitted = form.get("csrf");
  const cookie = readCookie(request, url, CSRF_COOKIE);

  if (typeof submitted !== "string" || !cookie || submitted !== cookie) {
    return errorPage("リクエストの検証に失敗しました。最初からやり直してください。", 400);
  }

  const stored = await env.OAUTH_KV.get(`annict_consent:${cookie}`);
  await env.OAUTH_KV.delete(`annict_consent:${cookie}`);
  if (!stored) {
    return errorPage("同意画面の有効期限が切れています。最初からやり直してください。", 400);
  }

  if (form.get("action") !== "approve") {
    return htmlResponse("<!doctype html><meta charset=\"utf-8\"><p>アクセスを拒否しました。</p>", {
      "Set-Cookie": clearCookie(url, CSRF_COOKIE),
    });
  }

  const authRequest = JSON.parse(stored) as AuthRequest;

  // The state cookie is deliberately set only now, after consent was approved.
  const state = randomToken();
  await env.OAUTH_KV.put(`annict_state:${state}`, JSON.stringify(authRequest), {
    expirationTtl: PENDING_TTL_SECONDS,
  });

  const annictUrl = new URL(ANNICT_AUTHORIZE_URL);
  annictUrl.searchParams.set("client_id", env.ANNICT_CLIENT_ID);
  annictUrl.searchParams.set("redirect_uri", `${url.origin}/callback`);
  annictUrl.searchParams.set("response_type", "code");
  annictUrl.searchParams.set("scope", ANNICT_SCOPE);
  annictUrl.searchParams.set("state", state);

  const headers = new Headers({ Location: annictUrl.toString() });
  headers.append("Set-Cookie", clearCookie(url, CSRF_COOKIE));
  headers.append("Set-Cookie", setCookie(url, STATE_COOKIE, state, PENDING_TTL_SECONDS));
  return new Response(null, { status: 302, headers });
}

interface AnnictTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

async function handleCallback(request: Request, env: Env, url: URL): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = readCookie(request, url, STATE_COOKIE);

  // The state must match both the value issued at redirect time and the cookie
  // bound to this browser, and it is single-use.
  if (!state || !cookieState || state !== cookieState) {
    return errorPage("stateの検証に失敗しました。最初からやり直してください。", 400);
  }
  if (!code) {
    const denied = url.searchParams.get("error") ?? "コードが返されませんでした";
    return errorPage(`Annictでの認可が完了しませんでした: ${denied}`, 400);
  }

  const stored = await env.OAUTH_KV.get(`annict_state:${state}`);
  await env.OAUTH_KV.delete(`annict_state:${state}`);
  if (!stored) {
    return errorPage("認可リクエストの有効期限が切れています。最初からやり直してください。", 400);
  }
  const authRequest = JSON.parse(stored) as AuthRequest;

  const tokenRes = await fetch(ANNICT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.ANNICT_CLIENT_ID,
      client_secret: env.ANNICT_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${url.origin}/callback`,
    }),
  });

  if (!tokenRes.ok) {
    return errorPage(`Annictのトークン発行に失敗しました (HTTP ${tokenRes.status})`, 502);
  }

  const token = (await tokenRes.json()) as AnnictTokenResponse;
  if (!token.access_token) {
    return errorPage(`Annictのトークン発行に失敗しました: ${token.error_description ?? token.error ?? "不明なエラー"}`, 502);
  }

  // Identify the user so the grant is attributed to their Annict account.
  const viewer = await new AnnictClient({ accessToken: token.access_token }).getViewer();

  const props: Props = {
    annictAccessToken: token.access_token,
    annictUsername: viewer.username,
  };

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: authRequest,
    userId: String(viewer.annictId),
    metadata: { username: viewer.username, name: viewer.name },
    scope: authRequest.scope,
    props,
  });

  const headers = new Headers({ Location: redirectTo });
  headers.append("Set-Cookie", clearCookie(url, STATE_COOKIE));
  return new Response(null, { status: 302, headers });
}

export const annictOAuthHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/authorize") {
      if (request.method === "GET") return handleAuthorizeGet(request, env, url);
      if (request.method === "POST") return handleAuthorizePost(request, env, url);
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/callback" && request.method === "GET") {
      return handleCallback(request, env, url);
    }

    if (url.pathname === "/") {
      return htmlResponse(
        `<!doctype html><meta charset="utf-8"><title>annict-mcp</title>
<h1>annict-mcp</h1>
<p>AnnictのMCPサーバーです。MCPクライアントに次のURLを登録してください。</p>
<pre>${escapeHtml(url.origin)}/mcp</pre>`,
      );
    }

    return new Response("Not found", { status: 404 });
  },
};
