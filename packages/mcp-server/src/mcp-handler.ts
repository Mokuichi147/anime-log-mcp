import { type AuthInfo, createMcpHandler, preloadSchemas } from "@modelcontextprotocol/server";
import { legacyOriginOf, migrationMessage } from "./migration.js";
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
  /** Deletes the grant this request authenticated with. */
  revokeGrant: () => Promise<void>;
  /** Set when the request came in on an origin being retired (see migration.ts). */
  notice?: string;
  retiredMessage?: string;
}

function annictExtraOf(authInfo: AuthInfo | undefined): AnnictAuthExtra {
  const extra = authInfo?.extra as AnnictAuthExtra | undefined;
  if (!extra?.annictAccessToken) {
    // Unreachable in practice: OAuthProvider rejects unauthenticated requests
    // before they ever reach this handler.
    throw new Error("Request reached the MCP handler without an Annict token.");
  }
  return extra;
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
const handler = createMcpHandler(
  (ctx) => {
    const extra = annictExtraOf(ctx.authInfo);
    return createAnnictMcpServer(extra.annictAccessToken, {
      onUnauthorized: extra.revokeGrant,
      notice: extra.notice,
      retiredMessage: extra.retiredMessage,
    });
  },
  { legacy: "stateless" },
);

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return /^bearer /i.test(header) ? header.slice("bearer ".length) : "";
}

/**
 * The Annict API Terms of Use (Art. 7) require deleting a user's data once
 * they unlink the application. The grant is the only place this deployment
 * keeps it (the Annict token and username), so revoking the grant deletes it
 * along with every token issued from it.
 */
async function revokeGrantOf(env: Env, token: string): Promise<void> {
  const summary = await env.OAUTH_PROVIDER.unwrapToken(token);
  if (summary) {
    await env.OAUTH_PROVIDER.revokeGrant(summary.grantId, summary.userId);
  }
}

/**
 * `ctx.props` is set by OAuthProvider from the grant the access token belongs
 * to; requests without a valid token never get here.
 */
export const mcpApiHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = ctx.props as Props;
    const token = bearerToken(request);
    const legacy = legacyOriginOf(env, new URL(request.url));
    const authInfo: AuthInfo = {
      token,
      clientId: props.clientId ?? "",
      scopes: props.scope ? props.scope.split(" ") : [],
      extra: {
        annictAccessToken: props.annictAccessToken,
        annictUsername: props.annictUsername,
        revokeGrant: () => revokeGrantOf(env, token),
        notice: legacy?.phase === "notice" ? migrationMessage(legacy) : undefined,
        retiredMessage: legacy?.phase === "retired" ? migrationMessage(legacy) : undefined,
      } satisfies AnnictAuthExtra,
    };
    return handler.fetch(request, { authInfo });
  },
};
