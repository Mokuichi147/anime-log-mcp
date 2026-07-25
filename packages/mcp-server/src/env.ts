import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  /** Storage for OAuth grants, tokens and client registrations. */
  OAUTH_KV: KVNamespace;
  /** Durable Object namespace backing the MCP sessions. */
  MCP_OBJECT: DurableObjectNamespace;
  /** Credentials of the Annict OAuth application this deployment registers. */
  ANNICT_CLIENT_ID: string;
  ANNICT_CLIENT_SECRET: string;
  /** Injected by OAuthProvider before the default handler runs. */
  OAUTH_PROVIDER: OAuthHelpers;
}

/**
 * Stored on the grant by the OAuth flow and handed back to the MCP agent as
 * `ctx.props` on every authenticated request. The provider keeps these
 * encrypted at rest, keyed by the access token.
 */
export interface Props extends Record<string, unknown> {
  annictAccessToken: string;
  annictUsername: string;
}
