import { describe, expect, it, vi } from "vitest";
import { AnnictClient } from "../src/client.js";

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
