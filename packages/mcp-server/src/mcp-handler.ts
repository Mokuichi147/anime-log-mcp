import { type AuthInfo, createMcpHandler, preloadSchemas } from "@modelcontextprotocol/server";
import { createAnnictMcpServer } from "./server.js";
import type { Env, Props } from "./env.js";

// Workers keep an isolate warm across requests, so paying for the schema
// construction at module scope keeps it out of the first request of each
// isolate.
preloadSchemas();

/**
 * The Annict token travels on `AuthInfo.extra`: the OAuth provider validates
 * the caller's token and hands us the grant's props, and the handler passes
 * that straight through to the factory. Nothing is stored between requests.
 */
interface AnnictAuthExtra extends Record<string, unknown> {
  annictAccessToken: string;
  annictUsername: string;
}

function annictTokenOf(authInfo: AuthInfo | undefined): string {
  const extra = authInfo?.extra as AnnictAuthExtra | undefined;
  if (!extra?.annictAccessToken) {
    // Unreachable in practice: OAuthProvider rejects unauthenticated requests
    // before they ever reach this handler.
    throw new Error("Request reached the MCP handler without an Annict token.");
  }
  return extra.annictAccessToken;
}

/**
 * Under the 2026-07-28 revision there is no `initialize` handshake and no
 * `Mcp-Session-Id`, so a request carries everything needed to serve it. The
 * handler therefore builds a fresh server per request — no Durable Object, no
 * session store, and any Worker isolate can answer any request.
 *
 * `legacy: 'stateless'` (the default) keeps 2025-era clients working: they are
 * served per-request from the same factory, so both eras share one tool set.
 */
const handler = createMcpHandler((ctx) => createAnnictMcpServer(annictTokenOf(ctx.authInfo)), {
  legacy: "stateless",
});

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return /^bearer /i.test(header) ? header.slice("bearer ".length) : "";
}

/**
 * `ctx.props` is set by OAuthProvider from the grant the access token belongs
 * to; requests without a valid token never get here.
 */
export const mcpApiHandler = {
  fetch(request: Request, _env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = ctx.props as Props;
    const authInfo: AuthInfo = {
      token: bearerToken(request),
      clientId: props.clientId ?? "",
      scopes: props.scope ? props.scope.split(" ") : [],
      extra: {
        annictAccessToken: props.annictAccessToken,
        annictUsername: props.annictUsername,
      } satisfies AnnictAuthExtra,
    };
    return handler.fetch(request, { authInfo });
  },
};
