import type { GrantSummary } from "@cloudflare/workers-oauth-provider";
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
  /** Deletes this request's grant and the user's older ones (see revokeUserGrants). */
  revokeUserGrants: () => Promise<void>;
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
      onUnauthorized: extra.revokeUserGrants,
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

interface GrantRef {
  userId: string;
  grantId: string;
}

/**
 * The provider's access tokens are `{userId}:{grantId}:{secret}`, and it has
 * already looked this one up by those parts before calling us. Reading them
 * here, when the request arrives, keeps the later cleanup independent of the
 * token's remaining lifetime: unwrapToken() would return null if the token
 * expired while Annict was being called.
 */
function grantRefOf(token: string): GrantRef | null {
  const [userId, grantId, secret] = token.split(":");
  return userId && grantId && secret ? { userId, grantId } : null;
}

/**
 * The Annict API Terms of Use (Art. 7) require deleting a user's data once
 * they unlink the application. The grants are the only place that data lives
 * (the Annict token and username), so revoking a grant deletes it along with
 * every token issued from it.
 *
 * Which grants to revoke follows from what a 401 proves. Unlinking on Annict
 * is per application and kills every token that exists at that moment, so a
 * grant created before the rejected one was alive then too and is just as
 * dead. A grant created after it may come from re-authorizing after the unlink
 * — possibly on another MCP client, whose grant the provider keeps separately —
 * and may still work, so it is left alone: it goes when it is itself rejected,
 * or when it expires GRANT_TTL_DAYS after authorization.
 *
 * Throws rather than returning quietly when nothing can be revoked, so the
 * caller never tells the user their data was deleted when it was not.
 */
async function revokeUserGrants(env: Env, ref: GrantRef | null): Promise<void> {
  if (!ref) {
    throw new Error("The access token does not identify a grant to revoke.");
  }
  const grants: GrantSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.OAUTH_PROVIDER.listUserGrants(ref.userId, { cursor });
    grants.push(...page.items);
    cursor = page.cursor;
  } while (cursor);

  // The rejected grant itself is always revoked. If it is not listed yet (KV
  // listings are eventually consistent), its creation time is unknown, and no
  // other grant can safely be judged older than it.
  const rejected = grants.find((grant) => grant.id === ref.grantId);
  const grantIds = new Set([ref.grantId]);
  if (rejected) {
    for (const grant of grants) {
      if (grant.createdAt < rejected.createdAt) grantIds.add(grant.id);
    }
  }
  await Promise.all([...grantIds].map((grantId) => env.OAUTH_PROVIDER.revokeGrant(grantId, ref.userId)));
}

/**
 * `ctx.props` is set by OAuthProvider from the grant the access token belongs
 * to; requests without a valid token never get here.
 */
export const mcpApiHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = ctx.props as Props;
    const token = bearerToken(request);
    const grantRef = grantRefOf(token);
    const legacy = legacyOriginOf(env, new URL(request.url));
    const authInfo: AuthInfo = {
      token,
      clientId: props.clientId ?? "",
      scopes: props.scope ? props.scope.split(" ") : [],
      extra: {
        annictAccessToken: props.annictAccessToken,
        annictUsername: props.annictUsername,
        revokeUserGrants: () => revokeUserGrants(env, grantRef),
        notice: legacy?.phase === "notice" ? migrationMessage(legacy) : undefined,
        retiredMessage: legacy?.phase === "retired" ? migrationMessage(legacy) : undefined,
      } satisfies AnnictAuthExtra,
    };
    return handler.fetch(request, { authInfo });
  },
};
