import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, Props } from "../src/env.js";
import { mcpApiHandler } from "../src/mcp-handler.js";
import { legacyOriginOf } from "../src/migration.js";
import { annictOAuthHandler } from "../src/oauth-handler.js";

const NEW_ORIGIN = "https://new-mcp.example.test";
const OLD_ORIGIN = "https://old-mcp.example.test";
const SUNSET = "2026-11-24T23:59:59+09:00";
const BEFORE_SUNSET = Date.parse("2026-11-01T00:00:00+09:00");
const AFTER_SUNSET = Date.parse("2026-11-25T00:00:00+09:00");

const MIGRATION_VARS = { CANONICAL_ORIGIN: NEW_ORIGIN, LEGACY_ORIGINS: OLD_ORIGIN, LEGACY_SUNSET: SUNSET };

function envWith(vars: Partial<Env>): Env {
  return {
    OAUTH_PROVIDER: { listUserGrants: vi.fn(), revokeGrant: vi.fn() },
    ...vars,
  } as unknown as Env;
}

describe("legacyOriginOf", () => {
  const env = envWith(MIGRATION_VARS);

  it("is off unless both origins are configured", () => {
    expect(legacyOriginOf(envWith({ LEGACY_ORIGINS: OLD_ORIGIN }), new URL(`${OLD_ORIGIN}/mcp`))).toBeNull();
    expect(legacyOriginOf(envWith({ CANONICAL_ORIGIN: NEW_ORIGIN }), new URL(`${OLD_ORIGIN}/mcp`))).toBeNull();
  });

  it("leaves the new origin and unrelated origins alone", () => {
    expect(legacyOriginOf(env, new URL(`${NEW_ORIGIN}/mcp`), AFTER_SUNSET)).toBeNull();
    expect(legacyOriginOf(env, new URL("http://localhost:8000/mcp"), AFTER_SUNSET)).toBeNull();
  });

  it("gives notice on the old origin before the sunset and retires it after", () => {
    expect(legacyOriginOf(env, new URL(`${OLD_ORIGIN}/mcp`), BEFORE_SUNSET)?.phase).toBe("notice");
    expect(legacyOriginOf(env, new URL(`${OLD_ORIGIN}/mcp`), AFTER_SUNSET)?.phase).toBe("retired");
  });

  it("keeps giving notice when no sunset is set", () => {
    const noSunset = envWith({ CANONICAL_ORIGIN: NEW_ORIGIN, LEGACY_ORIGINS: OLD_ORIGIN });
    expect(legacyOriginOf(noSunset, new URL(`${OLD_ORIGIN}/mcp`), AFTER_SUNSET)?.phase).toBe("notice");
  });

  it("rejects a malformed sunset instead of silently ignoring it", () => {
    const broken = envWith({ ...MIGRATION_VARS, LEGACY_SUNSET: "next month" });
    expect(() => legacyOriginOf(broken, new URL(`${OLD_ORIGIN}/mcp`))).toThrow(/LEGACY_SUNSET/);
  });
});

const PROPS: Props = {
  annictAccessToken: "annict-token",
  annictUsername: "mokuichi",
  clientId: "mcp-client-1",
  scope: "read write",
};

async function callViewer(origin: string, env: Env): Promise<{ isError?: boolean; texts: string[] }> {
  const ctx = { props: PROPS, waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    fetch: (url, init) => mcpApiHandler.fetch(new Request(url, init), env, ctx),
  });
  await client.connect(transport);
  const result = await client.callTool({ name: "annict_get_viewer", arguments: {} });
  await client.close();
  return {
    isError: result.isError as boolean | undefined,
    texts: (result.content as Array<{ text: string }>).map((item) => item.text),
  };
}

describe("tools on a legacy origin", () => {
  let annictFetch: ReturnType<typeof vi.fn>;
  const env = envWith(MIGRATION_VARS);

  beforeEach(() => {
    annictFetch = vi.fn(
      async () => new Response(JSON.stringify({ data: { viewer: { id: "VXNlci0x" } } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", annictFetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("still work before the sunset and tell the user where the server moved", async () => {
    vi.useFakeTimers({ now: BEFORE_SUNSET, toFake: ["Date"] });

    const result = await callViewer(OLD_ORIGIN, env);

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.texts[0]!)).toEqual({ id: "VXNlci0x" });
    expect(result.texts[1]).toContain(`${NEW_ORIGIN}/mcp`);
    expect(result.texts[1]).toContain("November 24, 2026");
  });

  it("stop calling Annict after the sunset", async () => {
    vi.useFakeTimers({ now: AFTER_SUNSET, toFake: ["Date"] });

    const result = await callViewer(OLD_ORIGIN, env);

    expect(result.isError).toBe(true);
    expect(result.texts.join("\n")).toContain(`${NEW_ORIGIN}/mcp`);
    expect(annictFetch).not.toHaveBeenCalled();
  });

  it("carry no notice on the new origin", async () => {
    vi.useFakeTimers({ now: AFTER_SUNSET, toFake: ["Date"] });

    const result = await callViewer(NEW_ORIGIN, env);

    expect(result.isError).toBeFalsy();
    expect(result.texts).toHaveLength(1);
  });
});

describe("pages on a legacy origin", () => {
  const env = envWith(MIGRATION_VARS);

  afterEach(() => {
    vi.useRealTimers();
  });

  it("point the top page at the new URL before the sunset", async () => {
    vi.useFakeTimers({ now: BEFORE_SUNSET, toFake: ["Date"] });

    const response = await annictOAuthHandler.fetch(new Request(`${OLD_ORIGIN}/`), env);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("移転しました");
    expect(html).toContain("2026年11月24日");
    expect(html).toContain(`<pre>${NEW_ORIGIN}/mcp</pre>`);
  });

  it("refuse to authorize after the sunset and show where to go instead", async () => {
    vi.useFakeTimers({ now: AFTER_SUNSET, toFake: ["Date"] });

    const response = await annictOAuthHandler.fetch(new Request(`${OLD_ORIGIN}/authorize?client_id=x`), env);
    const html = await response.text();

    // The mock has no parseAuthRequest, so reaching the consent flow would throw.
    expect(response.status).toBe(410);
    expect(html).toContain(`${NEW_ORIGIN}/mcp`);
  });

  it("refuse to complete a flow that began before the sunset and returns after it", async () => {
    vi.useFakeTimers({ now: AFTER_SUNSET, toFake: ["Date"] });
    const tokenFetch = vi.fn();
    vi.stubGlobal("fetch", tokenFetch);
    const oauthKv = { get: vi.fn(async () => JSON.stringify({ clientId: "c", scope: [] })), delete: vi.fn() };
    const envWithState = { ...env, OAUTH_KV: oauthKv } as unknown as Env;

    // The state cookie and KV entry are still valid, as they would be within
    // ten minutes of an approval given just before the sunset.
    const response = await annictOAuthHandler.fetch(
      new Request(`${OLD_ORIGIN}/callback?code=annict-code&state=s1`, {
        headers: { Cookie: "__Host-annict_mcp_state=s1" },
      }),
      envWithState,
    );
    vi.unstubAllGlobals();

    expect(response.status).toBe(410);
    expect(await response.text()).toContain(`${NEW_ORIGIN}/mcp`);
    // Neither the code exchange with Annict nor the grant was attempted.
    expect(tokenFetch).not.toHaveBeenCalled();
    expect(oauthKv.get).not.toHaveBeenCalled();
  });

  it("leave the new origin's top page as it was", async () => {
    const response = await annictOAuthHandler.fetch(new Request(`${NEW_ORIGIN}/`), env);
    const html = await response.text();

    expect(html).not.toContain("移転しました");
    expect(html).toContain(`<pre>${NEW_ORIGIN}/mcp</pre>`);
  });
});
