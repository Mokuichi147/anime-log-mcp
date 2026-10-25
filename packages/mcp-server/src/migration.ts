import type { Env } from "./env.js";

/**
 * Support for moving a deployment to a new origin (e.g. a hostname that no
 * longer carries the Annict name, per Art. 13 of the Annict API Terms of Use).
 *
 * One Worker answers on both origins, sharing KV and secrets, so nobody on the
 * old URL is cut off. MCP clients bind tokens to the URL they connected to, so
 * users still have to switch the URL and authorize once; this module decides
 * how hard to push them:
 *
 * - `notice` (before the sunset): everything keeps working on the old origin,
 *   and tool results, server instructions and pages point to the new one.
 * - `retired` (from the sunset on): the old origin issues no new grants and its
 *   tools stop calling Annict; both only point to the new origin. Grants issued
 *   earlier expire within GRANT_TTL_DAYS, after which the client's
 *   re-authorization lands on the migration page.
 */
export interface LegacyOrigin {
  phase: "notice" | "retired";
  /** The origin the request came in on. */
  legacyOrigin: string;
  canonicalOrigin: string;
  sunset: Date | null;
}

export function legacyOriginOf(env: Env, url: URL, now: number = Date.now()): LegacyOrigin | null {
  if (!env.CANONICAL_ORIGIN || !env.LEGACY_ORIGINS) return null;
  const canonicalOrigin = new URL(env.CANONICAL_ORIGIN).origin;
  const legacyOrigins = env.LEGACY_ORIGINS.split(",").map((origin) => new URL(origin.trim()).origin);
  if (url.origin === canonicalOrigin || !legacyOrigins.includes(url.origin)) return null;

  let sunset: Date | null = null;
  if (env.LEGACY_SUNSET) {
    sunset = new Date(env.LEGACY_SUNSET);
    if (Number.isNaN(sunset.getTime())) {
      throw new Error(`LEGACY_SUNSET is not a valid date: ${env.LEGACY_SUNSET}`);
    }
  }
  const phase = sunset !== null && now >= sunset.getTime() ? "retired" : "notice";
  return { phase, legacyOrigin: url.origin, canonicalOrigin, sunset };
}

function formatSunset(sunset: Date, locale: "ja-JP" | "en-US"): string {
  const date = new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", dateStyle: "long" }).format(sunset);
  return locale === "ja-JP" ? date : `${date} (JST)`;
}

/** Sent to MCP clients, which relay it to the user; worded for the model to pass on. */
export function migrationMessage(legacy: LegacyOrigin): string {
  const newUrl = `${legacy.canonicalOrigin}/mcp`;
  const oldUrl = `${legacy.legacyOrigin}/mcp`;
  if (legacy.phase === "retired") {
    return (
      `This MCP server has moved to ${newUrl}, and ${oldUrl} no longer accesses Annict. ` +
      `Tell the user to change the server URL to ${newUrl} in their MCP client settings and authorize again.`
    );
  }
  const deadline = legacy.sunset ? ` ${oldUrl} stops working on ${formatSunset(legacy.sunset, "en-US")}.` : "";
  return (
    `Notice for the user: this MCP server has moved to ${newUrl}.${deadline} ` +
    `Please change the server URL in your MCP client settings and authorize again.`
  );
}

/** HTML for the browser-facing pages. The values come from config but are escaped all the same. */
export function migrationBannerHtml(legacy: LegacyOrigin, escapeHtml: (value: string) => string): string {
  const newUrl = escapeHtml(`${legacy.canonicalOrigin}/mcp`);
  const deadline =
    legacy.phase === "retired"
      ? "このURLは使えなくなりました。"
      : legacy.sunset
        ? `${escapeHtml(formatSunset(legacy.sunset, "ja-JP"))}以降、このURLは使えなくなります。`
        : "";
  return `<p class="notice"><strong>このサーバーのURLは <code>${newUrl}</code> に移転しました。</strong>${deadline}MCPクライアントの設定でサーバーのURLを変更し、改めて許可してください。</p>`;
}
