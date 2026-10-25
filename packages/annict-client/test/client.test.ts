import { describe, expect, it, vi } from "vitest";
import { AnnictClient } from "../src/client.js";
import { AnnictRateLimitError } from "../src/errors.js";
import { parseRetryAfter } from "../src/executor.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function clientWithFetch(fetchImpl: typeof fetch): AnnictClient {
  return new AnnictClient({ accessToken: "token", fetch: fetchImpl });
}

describe("AnnictClient", () => {
  it("getViewer returns the viewer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { viewer: { id: "u1", name: "taro" } } }));
    const client = clientWithFetch(fetchImpl);

    const viewer = await client.getViewer();

    expect(viewer).toEqual({ id: "u1", name: "taro" });
  });

  it("getViewer throws when the API returns no viewer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { viewer: null } }));
    const client = clientWithFetch(fetchImpl);

    await expect(client.getViewer()).rejects.toThrow(/did not return a viewer/);
  });

  it("getLibraryEntries flattens edges into nodes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          viewer: {
            libraryEntries: {
              edges: [{ node: { id: "le1" } }],
              pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
            },
          },
        },
      }),
    );
    const client = clientWithFetch(fetchImpl);

    const result = await client.getLibraryEntries({ states: ["WATCHING"] });

    expect(result.nodes).toEqual([{ id: "le1" }]);
    expect(result.pageInfo.hasNextPage).toBe(false);
  });

  it("getWork returns null when searchWorks finds nothing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: { searchWorks: { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } } },
      }),
    );
    const client = clientWithFetch(fetchImpl);

    await expect(client.getWork(999)).resolves.toBeNull();
  });

  it("createRecord returns the created record", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ data: { createRecord: { record: { id: "r1", comment: "great" } } } }),
    );
    const client = clientWithFetch(fetchImpl);

    const record = await client.createRecord({ episodeId: "ep1", comment: "great" });

    expect(record).toEqual({ id: "r1", comment: "great" });
  });

  it("updateStatus returns the new state", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ data: { updateStatus: { work: { viewerStatusState: "WATCHING" } } } }),
    );
    const client = clientWithFetch(fetchImpl);

    const result = await client.updateStatus({ workId: "w1", state: "WATCHING" });

    expect(result).toEqual({ state: "WATCHING" });
  });

  it("updateStatus throws when no state is returned", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { updateStatus: { work: null } } }));
    const client = clientWithFetch(fetchImpl);

    await expect(client.updateStatus({ workId: "w1", state: "WATCHING" })).rejects.toThrow(
      /did not return the updated state/,
    );
  });
});

function rateLimitedResponse(retryAfter: string): Response {
  return new Response(JSON.stringify({ errors: [{ type: "too_many_requests" }] }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": retryAfter },
  });
}

describe("rate limiting", () => {
  it("waits out a short Retry-After and retries once", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(rateLimitedResponse("3"))
      .mockResolvedValueOnce(jsonResponse({ data: { viewer: { id: "u1" } } }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new AnnictClient({ accessToken: "token", fetch: fetchImpl, sleep });

    await expect(client.getViewer()).resolves.toEqual({ id: "u1" });
    expect(sleep).toHaveBeenCalledWith(3000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws without waiting when Retry-After exceeds the limit", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(rateLimitedResponse("45"));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new AnnictClient({ accessToken: "token", fetch: fetchImpl, sleep, rateLimitMaxWaitSeconds: 10 });

    const error = await client.getViewer().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AnnictRateLimitError);
    expect((error as AnnictRateLimitError).retryAfterSeconds).toBe(45);
    expect((error as AnnictRateLimitError).message).toContain("retry after 45 seconds");
    expect(sleep).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up when the retry is rate limited again", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => rateLimitedResponse("1"));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new AnnictClient({ accessToken: "token", fetch: fetchImpl, sleep });

    await expect(client.getViewer()).rejects.toBeInstanceOf(AnnictRateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never retries when the wait is disabled", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(rateLimitedResponse("1"));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new AnnictClient({ accessToken: "token", fetch: fetchImpl, sleep, rateLimitMaxWaitSeconds: 0 });

    await expect(client.getViewer()).rejects.toBeInstanceOf(AnnictRateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("parses both forms of Retry-After", () => {
    const now = Date.parse("2026-10-25T00:00:00Z");
    expect(parseRetryAfter("30", now)).toBe(30);
    expect(parseRetryAfter("Sun, 25 Oct 2026 00:00:20 GMT", now)).toBe(20);
    expect(parseRetryAfter("garbage", now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });
});
