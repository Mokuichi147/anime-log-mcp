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

  it("getUser returns the user", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { user: { id: "u2", name: "hanako" } } }));
    const client = clientWithFetch(fetchImpl);

    const user = await client.getUser("hanako");

    expect(user).toEqual({ id: "u2", name: "hanako" });
  });

  it("getUser returns null when the username does not exist", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { user: null } }));
    const client = clientWithFetch(fetchImpl);

    await expect(client.getUser("nobody")).resolves.toBeNull();
  });

  it("searchCharacters flattens edges into nodes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          searchCharacters: {
            edges: [{ node: { id: "c1", name: "Character A", series: { id: "s1", annictId: 9, name: "Series A" } } }],
            pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
          },
        },
      }),
    );
    const client = clientWithFetch(fetchImpl);

    const result = await client.searchCharacters({ names: ["Character A"] });

    expect(result.nodes).toEqual([
      { id: "c1", name: "Character A", series: { id: "s1", annictId: 9, name: "Series A" } },
    ]);
  });

  it("searchPeople flattens edges into nodes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          searchPeople: {
            edges: [{ node: { id: "p1", name: "Person A" } }],
            pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
          },
        },
      }),
    );
    const client = clientWithFetch(fetchImpl);

    const result = await client.searchPeople({ names: ["Person A"] });

    expect(result.nodes).toEqual([{ id: "p1", name: "Person A" }]);
  });

  it("searchOrganizations flattens edges into nodes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          searchOrganizations: {
            edges: [{ node: { id: "o1", name: "Studio A" } }],
            pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
          },
        },
      }),
    );
    const client = clientWithFetch(fetchImpl);

    const result = await client.searchOrganizations({ names: ["Studio A"] });

    expect(result.nodes).toEqual([{ id: "o1", name: "Studio A" }]);
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
