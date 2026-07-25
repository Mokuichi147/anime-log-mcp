import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  AnnictApiError,
  AnnictClient,
  AnnictGraphQLError,
  type StatusState,
} from "@annict-mcp/annict-client";

export interface Env {
  ANNICT_ACCESS_TOKEN: string;
  MCP_AUTH_TOKEN?: string;
  MCP_OBJECT: DurableObjectNamespace;
}

const STATUS_STATES = [
  "NO_STATE",
  "WANNA_WATCH",
  "WATCHING",
  "WATCHED",
  "ON_HOLD",
  "STOP_WATCHING",
] as const satisfies readonly StatusState[];

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResult(error: unknown): ToolResult {
  const message =
    error instanceof AnnictApiError || error instanceof AnnictGraphQLError || error instanceof Error
      ? error.message
      : String(error);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

export class AnnictMcpAgent extends McpAgent<Env> {
  server = new McpServer({ name: "annict-mcp", version: "0.1.0" });

  private get client(): AnnictClient {
    return new AnnictClient({ accessToken: this.env.ANNICT_ACCESS_TOKEN });
  }

  async init() {
    this.server.tool("annict_get_viewer", "Get the authenticated Annict user's profile and watch-status counts.", {}, async () => {
      try {
        return ok(await this.client.getViewer());
      } catch (error) {
        return errorResult(error);
      }
    });

    this.server.tool(
      "annict_get_library_entries",
      "List the authenticated user's library entries (works they are tracking), optionally filtered by watch status.",
      {
        status: z.enum(STATUS_STATES).optional().describe("Filter by watch status (e.g. WATCHING, WANNA_WATCH)."),
        first: z.number().int().min(1).max(50).optional().describe("Max number of entries to return (default 25)."),
      },
      async ({ status, first }) => {
        try {
          return ok(await this.client.getLibraryEntries({ states: status ? [status] : undefined, first }));
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    this.server.tool(
      "annict_search_works",
      "Search Annict for anime works by title and/or season.",
      {
        title: z.string().optional().describe("Title (or part of it) to search for."),
        season: z.string().optional().describe("Season string, e.g. '2018-autumn'."),
        first: z.number().int().min(1).max(50).optional().describe("Max number of results to return (default 25)."),
      },
      async ({ title, season, first }) => {
        try {
          return ok(
            await this.client.searchWorks({
              titles: title ? [title] : undefined,
              seasons: season ? [season] : undefined,
              first,
            }),
          );
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    this.server.tool(
      "annict_get_work",
      "Get a single Annict work by its numeric annictId.",
      {
        annictId: z.number().int().describe("The work's numeric Annict ID."),
      },
      async ({ annictId }) => {
        try {
          const work = await this.client.getWork(annictId);
          return ok(work ?? { found: false });
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    this.server.tool(
      "annict_get_episodes",
      "List episodes for a work, given the work's numeric annictId.",
      {
        workAnnictId: z.number().int().describe("The work's numeric Annict ID."),
        first: z.number().int().min(1).max(50).optional().describe("Max number of episodes to return (default 25)."),
      },
      async ({ workAnnictId, first }) => {
        try {
          return ok(await this.client.getEpisodes({ workAnnictId, first }));
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    this.server.tool(
      "annict_record_episode",
      "Mark an episode as watched by creating a record, with an optional comment.",
      {
        episodeId: z.string().describe("The episode's global GraphQL ID (Episode.id, not annictId)."),
        comment: z.string().optional().describe("Optional comment/review text for this record."),
      },
      async ({ episodeId, comment }) => {
        try {
          return ok(await this.client.createRecord({ episodeId, comment }));
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    this.server.tool(
      "annict_update_status",
      "Update the authenticated user's watch status for a work.",
      {
        workId: z.string().describe("The work's global GraphQL ID (Work.id, not annictId)."),
        state: z.enum(STATUS_STATES).describe("The new watch status."),
      },
      async ({ workId, state }) => {
        try {
          return ok(await this.client.updateStatus({ workId, state }));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (env.MCP_AUTH_TOKEN) {
      const auth = request.headers.get("authorization");
      if (auth !== `Bearer ${env.MCP_AUTH_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    const url = new URL(request.url);
    if (url.pathname === "/mcp") {
      return AnnictMcpAgent.serve("/mcp").fetch(request, env, ctx);
    }
    return new Response("Not found", { status: 404 });
  },
};
