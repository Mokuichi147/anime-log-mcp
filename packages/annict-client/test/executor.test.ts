import { describe, expect, it, vi } from "vitest";
import { AnnictApiError, AnnictGraphQLError } from "../src/errors.js";
import { execute, type RateLimitPolicy } from "../src/executor.js";

/** These cases never see a 429, so the policy is never consulted. */
const NO_RETRY: RateLimitPolicy = { maxWaitSeconds: 0, sleep: async () => {} };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("execute", () => {
  it("sends the query/variables and a lowercase bearer header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }));

    await execute("https://api.annict.com/graphql", "token-123", "query { viewer { id } }", { a: 1 }, fetchImpl, NO_RETRY);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.annict.com/graphql",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "bearer token-123",
          "Content-Type": "application/json",
        }),
      }),
    );
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ query: "query { viewer { id } }", variables: { a: 1 } });
  });

  it("returns data on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { viewer: { id: "1" } } }));

    const data = await execute<{ viewer: { id: string } }>(
      "https://api.annict.com/graphql",
      "token",
      "query {}",
      {},
      fetchImpl,
      NO_RETRY,
    );

    expect(data).toEqual({ viewer: { id: "1" } });
  });

  it("throws AnnictApiError on a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("Not authorized", { status: 401 }));

    await expect(execute("https://api.annict.com/graphql", "bad-token", "query {}", {}, fetchImpl, NO_RETRY)).rejects.toThrow(
      AnnictApiError,
    );
  });

  it("throws AnnictGraphQLError when the response body contains errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: "boom" }] }));

    await expect(execute("https://api.annict.com/graphql", "token", "query {}", {}, fetchImpl, NO_RETRY)).rejects.toThrow(
      AnnictGraphQLError,
    );
  });

  it("throws AnnictApiError when the response has neither data nor errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));

    await expect(execute("https://api.annict.com/graphql", "token", "query {}", {}, fetchImpl, NO_RETRY)).rejects.toThrow(
      AnnictApiError,
    );
  });
});
