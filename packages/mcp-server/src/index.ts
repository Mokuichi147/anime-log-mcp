import OAuthProvider from "@cloudflare/workers-oauth-provider";
import type { Env } from "./env.js";
import { mcpApiHandler } from "./mcp-handler.js";
import { annictOAuthHandler, GRANT_TTL_DAYS } from "./oauth-handler.js";

export type { Env, Props } from "./env.js";
export { createAnnictMcpServer } from "./server.js";

/**
 * The provider is the MCP server's own authorization server: it issues and
 * validates the tokens MCP clients present, and hands the Annict token stored
 * on each grant to the MCP handler as `ctx.props`. Requests to /mcp without a
 * valid token never reach it.
 */
export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: mcpApiHandler,
  defaultHandler: annictOAuthHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  // The library's default, set explicitly because the consent screen promises
  // this retention bound. The grant expires this long after authorization.
  refreshTokenTTL: GRANT_TTL_DAYS * 24 * 60 * 60,
});
