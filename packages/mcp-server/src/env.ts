import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  /** Storage for OAuth grants, tokens and client registrations. */
  OAUTH_KV: KVNamespace;
  /** Credentials of the Annict OAuth application this deployment registers. */
  ANNICT_CLIENT_ID: string;
  ANNICT_CLIENT_SECRET: string;
  /** Injected by OAuthProvider before the default handler runs. */
  OAUTH_PROVIDER: OAuthHelpers;
  /**
   * Optional URL move (see migration.ts). Where the deployment now lives,
   * e.g. "https://mcp.example.com"; requires LEGACY_ORIGINS.
   */
  CANONICAL_ORIGIN?: string;
  /** Comma-separated origins being retired in favour of CANONICAL_ORIGIN. */
  LEGACY_ORIGINS?: string;
  /** When the legacy origins stop working, as ISO 8601 with an offset. Unset: they keep working. */
  LEGACY_SUNSET?: string;
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
