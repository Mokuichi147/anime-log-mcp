import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mcpApiHandler } from "../src/mcp-handler.js";
import type { Env, Props } from "../src/env.js";

const SERVER_URL = new URL("https://anime-log-mcp.test/mcp");

const PROPS: Props = {
  annictAccessToken: "annict-token",
  annictUsername: "mokuichi",
  clientId: "mcp-client-1",
  scope: "read write",
};

/** Only `props` is read by the handler; the rest of ExecutionContext is unused. */
function executionContext(props: Props = PROPS): ExecutionContext {
  return { props, waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
}

const MCP_TOKEN = "1:grant-1:secret";

/**
 * The helpers the MCP handler could use to delete grants. unwrapToken is kept
 * only to prove the cleanup does not depend on it (see the expiry test).
 */
const oauthProvider = {
  unwrapToken: vi.fn(),
  listUserGrants: vi.fn(),
  revokeGrant: vi.fn(),
};

const env = { OAUTH_PROVIDER: oauthProvider } as unknown as Env;

/**
 * Every request is served in isolation, exactly as a Worker isolate would:
 * a fresh ExecutionContext carrying the grant's props and nothing else.
 */
function serve(request: Request): Promise<Response> {
  return mcpApiHandler.fetch(request, env, executionContext());
}

async function connectClient(): Promise<Client> {
  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    // Modern-only: the connection fails outright if the server cannot speak
    // 2026-07-28, so nothing here can silently fall back to a 2025 session.
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(SERVER_URL, {
    fetch: (url, init) => {
      const request = new Request(url, init);
      request.headers.set("Authorization", `Bearer ${MCP_TOKEN}`);
      return serve(request);
    },
  });
  await client.connect(transport);
  return client;
}

function graphqlResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const VIEWER = {
  id: "VXNlci0x",
  annictId: 1,
  username: "mokuichi",
  name: "Mokuichi",
  avatarUrl: "https://example.test/avatar.png",
  watchingCount: 3,
  watchedCount: 120,
  wannaWatchCount: 7,
  onHoldCount: 0,
  stopWatchingCount: 1,
  recordsCount: 400,
};

describe("stateless MCP handler", () => {
  let annictFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    annictFetch = vi.fn(async () => graphqlResponse({ viewer: VIEWER }));
    vi.stubGlobal("fetch", annictFetch);
    oauthProvider.unwrapToken.mockReset().mockResolvedValue({ grantId: "grant-1", userId: "1" });
    oauthProvider.listUserGrants.mockReset().mockResolvedValue({ items: [{ id: "grant-1", createdAt: 1_000 }] });
    oauthProvider.revokeGrant.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serves tools/list on a 2026-07-28 connection", async () => {
    const client = await connectClient();
    expect(client.getProtocolEra()).toBe("modern");

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "annict_get_episodes",
      "annict_get_library_entries",
      "annict_get_user",
      "annict_get_viewer",
      "annict_get_work",
      "annict_record_episode",
      "annict_search_characters",
      "annict_search_organizations",
      "annict_search_people",
      "annict_search_works",
      "annict_update_status",
    ]);

    await client.close();
  });

  it("answers a bare tools/list with no handshake and no session header", async () => {
    const response = await serve(
      new Request(SERVER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Mcp-Method": "tools/list",
          // Required since SDK 2.3.0: the transport rejects a request whose
          // header and body envelope disagree on the protocol version, so a
          // body naming 2026-07-28 must carry the matching header.
          "MCP-Protocol-Version": "2026-07-28",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    // The header is gone from the transport as of 2026-07-28; nothing here
    // asked to be remembered, and nothing was.
    expect(response.headers.get("mcp-session-id")).toBeNull();

    const body = (await response.json()) as { result: Record<string, unknown> };
    expect(body.result).toMatchObject({
      resultType: "complete",
      // Required on list results by the CacheableResult interface.
      ttlMs: expect.any(Number),
      cacheScope: "private",
      _meta: {
        "io.modelcontextprotocol/serverInfo": { name: "anime-log-mcp" },
      },
    });
    expect(body.result.tools).toHaveLength(11);
  });

  it("calls a tool with the Annict token taken from the request's grant", async () => {
    const client = await connectClient();

    const result = await client.callTool({ name: "annict_get_viewer", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toEqual(VIEWER);

    const [, init] = annictFetch.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "bearer annict-token" });

    await client.close();
  });

  it("serves two tool calls independently, each on its own connection", async () => {
    const first = await connectClient();
    await first.callTool({ name: "annict_get_viewer", arguments: {} });
    await first.close();

    // A second, entirely separate client gets the same answer with no shared
    // state — there is nothing an earlier request could have left behind.
    const second = await connectClient();
    const result = await second.callTool({ name: "annict_get_viewer", arguments: {} });
    await second.close();

    expect(result.isError).toBeFalsy();
    expect(annictFetch).toHaveBeenCalledTimes(2);
  });

  it("rejects a search that would have no filter at all", async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: "annict_search_characters", arguments: {} });
    await client.close();

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toContain("'name' or 'annictId'");
    // Nothing should have reached Annict.
    expect(annictFetch).not.toHaveBeenCalled();
  });

  it("passes the singular search arguments through as Annict's list variables", async () => {
    annictFetch.mockResolvedValueOnce(
      graphqlResponse({
        searchCharacters: {
          edges: [],
          pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
        },
      }),
    );

    const client = await connectClient();
    const result = await client.callTool({
      name: "annict_search_characters",
      arguments: { name: "レム", annictId: 42 },
    });
    await client.close();

    expect(result.isError).toBeFalsy();
    const [, init] = annictFetch.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as { variables: Record<string, unknown> };
    expect(body.variables).toMatchObject({ names: ["レム"], annictIds: [42], first: 25 });
  });

  it("deletes the grant when Annict rejects the token", async () => {
    annictFetch.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));

    const client = await connectClient();
    const result = await client.callTool({ name: "annict_get_viewer", arguments: {} });
    await client.close();

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("401");
    expect(text).toContain("has been deleted");
    // The user unlinked the app on Annict, so their stored token goes too.
    expect(oauthProvider.revokeGrant).toHaveBeenCalledWith("grant-1", "1");
  });

  it("deletes the user's older grants from other MCP clients, but not newer ones", async () => {
    annictFetch.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    // Client A (grant-1) was authorized, the user unlinked the app on Annict
    // and then re-authorized on client B (grant-3). A's 401 says nothing about
    // B, which may well be working; grant-2 and grant-4 predate A, so they
    // were alive at the unlink and died with it. Two pages, via the cursor.
    oauthProvider.listUserGrants
      .mockResolvedValueOnce({
        items: [
          { id: "grant-1", createdAt: 1_000 },
          { id: "grant-2", createdAt: 500 },
          { id: "grant-3", createdAt: 2_000 },
        ],
        cursor: "next",
      })
      .mockResolvedValueOnce({ items: [{ id: "grant-4", createdAt: 100 }] });

    const client = await connectClient();
    await client.callTool({ name: "annict_get_viewer", arguments: {} });
    await client.close();

    expect(oauthProvider.listUserGrants).toHaveBeenNthCalledWith(1, "1", { cursor: undefined });
    expect(oauthProvider.listUserGrants).toHaveBeenNthCalledWith(2, "1", { cursor: "next" });
    const revoked = oauthProvider.revokeGrant.mock.calls.map(([grantId, userId]) => `${userId}/${grantId}`);
    expect(revoked.sort()).toEqual(["1/grant-1", "1/grant-2", "1/grant-4"]);
  });

  it("deletes only the rejected grant when it is not listed yet", async () => {
    annictFetch.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    // A just-written KV entry can be missing from a listing; without the
    // rejected grant's creation time no other grant is known to be older.
    oauthProvider.listUserGrants.mockResolvedValueOnce({ items: [{ id: "grant-2", createdAt: 500 }] });

    const client = await connectClient();
    await client.callTool({ name: "annict_get_viewer", arguments: {} });
    await client.close();

    expect(oauthProvider.revokeGrant.mock.calls).toEqual([["grant-1", "1"]]);
  });

  it("deletes the grants even if the MCP token expires while Annict is answering", async () => {
    annictFetch.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    // What unwrapToken() returns once the token has expired.
    oauthProvider.unwrapToken.mockResolvedValue(null);

    const client = await connectClient();
    const result = await client.callTool({ name: "annict_get_viewer", arguments: {} });
    await client.close();

    expect(oauthProvider.revokeGrant).toHaveBeenCalledWith("grant-1", "1");
    expect(oauthProvider.unwrapToken).not.toHaveBeenCalled();
    expect((result.content as Array<{ text: string }>)[0]!.text).toContain("has been deleted");
  });

  it("does not claim the data was deleted when revoking fails", async () => {
    annictFetch.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    oauthProvider.listUserGrants.mockRejectedValueOnce(new Error("KV unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const client = await connectClient();
    const result = await client.callTool({ name: "annict_get_viewer", arguments: {} });
    await client.close();
    consoleError.mockRestore();

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("401");
    expect(text).not.toContain("deleted");
  });

  it("keeps the grant on errors other than 401", async () => {
    annictFetch.mockResolvedValueOnce(new Response("boom", { status: 500 }));

    const client = await connectClient();
    const result = await client.callTool({ name: "annict_get_viewer", arguments: {} });
    await client.close();

    expect(result.isError).toBe(true);
    expect(oauthProvider.revokeGrant).not.toHaveBeenCalled();
  });

  it("tells the caller how long to wait when Annict is rate limiting", async () => {
    annictFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [{ type: "too_many_requests" }] }), {
        status: 429,
        headers: { "Retry-After": "42" },
      }),
    );

    const client = await connectClient();
    const result = await client.callTool({ name: "annict_get_viewer", arguments: {} });
    await client.close();

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toContain("retry after 42 seconds");
    // 42s is beyond what is waited out in place, so no second request is sent.
    expect(annictFetch).toHaveBeenCalledTimes(1);
    expect(oauthProvider.revokeGrant).not.toHaveBeenCalled();
  });
});
