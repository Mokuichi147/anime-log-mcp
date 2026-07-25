import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { AnnictMcpAgent } from "./agent.js";
import type { Env } from "./env.js";
import { annictOAuthHandler } from "./oauth-handler.js";

export { AnnictMcpAgent };
export type { Env, Props } from "./env.js";

/**
 * The provider is the MCP server's own authorization server: it issues and
 * validates the tokens MCP clients present, and hands the Annict token stored
 * on each grant to the agent as `ctx.props`. Requests to /mcp without a valid
 * token never reach the agent.
 */
export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: AnnictMcpAgent.serve("/mcp"),
  defaultHandler: annictOAuthHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
