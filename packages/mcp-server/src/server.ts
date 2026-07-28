import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { AnnictClient, type StatusState } from "@annict-mcp/annict-client";

/** Applied when the caller omits `first`, rather than relying on Annict's default. */
const DEFAULT_PAGE_SIZE = 25;

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
  // AnnictApiError and AnnictGraphQLError both extend Error.
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

const firstParam = (unit: string) =>
  z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe(`Max number of ${unit} to return (default ${DEFAULT_PAGE_SIZE}).`);

const afterParam = z
  .string()
  .optional()
  .describe("Pagination cursor: pass pageInfo.endCursor from a previous response to fetch the next page.");

/**
 * The tool list is identical for every caller, so it is safe for a client to
 * cache — but it is served behind a per-user token, so only that client may
 * hold it (`private`).
 */
const TOOL_LIST_CACHE_HINT = { ttlMs: 3_600_000, cacheScope: "private" } as const;

/**
 * Builds a fully configured server instance. Under the 2026-07-28 revision
 * there is no session to attach state to, so one of these is built per request
 * from the Annict token that request authenticated with; nothing survives the
 * response.
 */
export function createAnnictMcpServer(annictAccessToken: string): McpServer {
  const client = new AnnictClient({ accessToken: annictAccessToken });

  const server = new McpServer(
    { name: "annict-mcp", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      cacheHints: {
        "tools/list": TOOL_LIST_CACHE_HINT,
        "server/discover": TOOL_LIST_CACHE_HINT,
      },
    },
  );

  server.registerTool(
    "annict_get_viewer",
    { description: "Get the authenticated Annict user's profile and watch-status counts." },
    async () => {
      try {
        return ok(await client.getViewer());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "annict_get_library_entries",
    {
      description:
        "List the authenticated user's library entries (works they are tracking), optionally filtered by watch status.",
      inputSchema: z.object({
        status: z.enum(STATUS_STATES).optional().describe("Filter by watch status (e.g. WATCHING, WANNA_WATCH)."),
        first: firstParam("entries"),
        after: afterParam,
      }),
    },
    async ({ status, first, after }) => {
      try {
        return ok(
          await client.getLibraryEntries({
            states: status ? [status] : undefined,
            first: first ?? DEFAULT_PAGE_SIZE,
            after,
          }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "annict_search_works",
    {
      description: "Search Annict for anime works by title and/or season. At least one of title or season is required.",
      inputSchema: z.object({
        title: z.string().min(1).optional().describe("Title (or part of it) to search for."),
        season: z.string().min(1).optional().describe("Season string, e.g. '2018-autumn'."),
        first: firstParam("results"),
        after: afterParam,
      }),
    },
    async ({ title, season, first, after }) => {
      // Without a filter this would ask Annict for its entire catalogue.
      if (!title && !season) {
        return errorResult(new Error("Provide at least one of 'title' or 'season'."));
      }
      try {
        return ok(
          await client.searchWorks({
            titles: title ? [title] : undefined,
            seasons: season ? [season] : undefined,
            first: first ?? DEFAULT_PAGE_SIZE,
            after,
          }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "annict_get_work",
    {
      description: "Get a single Annict work by its numeric annictId.",
      inputSchema: z.object({
        annictId: z.number().int().describe("The work's numeric Annict ID."),
      }),
    },
    async ({ annictId }) => {
      try {
        const work = await client.getWork(annictId);
        return ok(work ?? { found: false });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "annict_get_episodes",
    {
      description: "List episodes for a work, given the work's numeric annictId.",
      inputSchema: z.object({
        workAnnictId: z.number().int().describe("The work's numeric Annict ID."),
        first: firstParam("episodes"),
        after: afterParam,
      }),
    },
    async ({ workAnnictId, first, after }) => {
      try {
        return ok(await client.getEpisodes({ workAnnictId, first: first ?? DEFAULT_PAGE_SIZE, after }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "annict_record_episode",
    {
      description: "Mark an episode as watched by creating a record, with an optional comment.",
      inputSchema: z.object({
        episodeId: z.string().describe("The episode's global GraphQL ID (Episode.id, not annictId)."),
        comment: z.string().optional().describe("Optional comment/review text for this record."),
      }),
    },
    async ({ episodeId, comment }) => {
      try {
        return ok(await client.createRecord({ episodeId, comment }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "annict_update_status",
    {
      description: "Update the authenticated user's watch status for a work.",
      inputSchema: z.object({
        workId: z.string().describe("The work's global GraphQL ID (Work.id, not annictId)."),
        state: z.enum(STATUS_STATES).describe("The new watch status."),
      }),
    },
    async ({ workId, state }) => {
      try {
        return ok(await client.updateStatus({ workId, state }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
