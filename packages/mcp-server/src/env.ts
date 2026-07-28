import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  /** Storage for OAuth grants, tokens and client registrations. */
  OAUTH_KV: KVNamespace;
  /** Credentials of the Annict OAuth application this deployment registers. */
  ANNICT_CLIENT_ID: string;
  ANNICT_CLIENT_SECRET: string;
  /** Injected by OAuthProvider before the default handler runs. */
  OAUTH_PROVIDER: OAuthHelpers;
}

/**
 * Stored on the grant by the OAuth flow and handed back as `ctx.props` on every
 * authenticated request. The provider keeps these encrypted at rest, keyed by
 * the access token. Because MCP itself no longer carries a session, this grant
 * is the only per-user state the deployment holds.
 */
export interface Props extends Record<string, unknown> {
  annictAccessToken: string;
  annictUsername: string;
  /** Absent on grants issued before these fields were recorded. */
  clientId?: string;
  scope?: string;
}
