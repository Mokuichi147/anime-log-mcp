import { AnnictApiError, AnnictGraphQLError, AnnictRateLimitError } from "./errors.js";

interface GraphQLResponse<TData> {
  data?: TData;
  errors?: unknown[];
}

export interface RateLimitPolicy {
  /** Longest `Retry-After` that is waited out in place; anything longer is thrown. */
  maxWaitSeconds: number;
  sleep: (ms: number) => Promise<void>;
}

/**
 * Parses a `Retry-After` header into whole seconds. Annict sends a number of
 * seconds, but the HTTP-date form is accepted too since the header allows it.
 */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}

export async function execute<TData>(
  endpoint: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: typeof fetch,
  rateLimit: RateLimitPolicy,
): Promise<TData> {
  const send = () =>
    fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Annict's API expects a lowercase "bearer" scheme.
        Authorization: `bearer ${accessToken}`,
      },
      body: JSON.stringify({ query, variables }),
    });

  let res = await send();

  // Annict asks clients to wait for Retry-After before resuming after a 429.
  // A short wait is absorbed here with a single retry; a longer one is handed
  // back to the caller so the request is not held open for minutes.
  if (res.status === 429) {
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    if (retryAfter !== null && rateLimit.maxWaitSeconds > 0 && retryAfter <= rateLimit.maxWaitSeconds) {
      await res.body?.cancel();
      await rateLimit.sleep(retryAfter * 1000);
      res = await send();
    }
  }

  if (res.status === 429) {
    throw new AnnictRateLimitError(await res.text(), parseRetryAfter(res.headers.get("retry-after")));
  }

  if (!res.ok) {
    throw new AnnictApiError(res.status, await res.text());
  }

  const json = (await res.json()) as GraphQLResponse<TData>;

  if (json.errors && json.errors.length > 0) {
    throw new AnnictGraphQLError(json.errors);
  }

  if (!json.data) {
    throw new AnnictApiError(res.status, "Annict API response did not contain data");
  }

  return json.data;
}
