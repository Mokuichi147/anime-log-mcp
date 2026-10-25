export class AnnictApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Annict API request failed with status ${status}: ${body}`);
    this.name = "AnnictApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Annict answered 429. The request was not processed, so it is safe to send
 * again — but not before `retryAfterSeconds` have passed.
 */
export class AnnictRateLimitError extends AnnictApiError {
  /** Seconds Annict asked the caller to wait (`Retry-After`), or null if it sent none. */
  readonly retryAfterSeconds: number | null;

  constructor(body: string, retryAfterSeconds: number | null) {
    super(429, body);
    this.name = "AnnictRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
    const wait = retryAfterSeconds === null ? "" : `; retry after ${retryAfterSeconds} seconds`;
    this.message = `Annict API rate limit exceeded (HTTP 429)${wait}: ${body}`;
  }
}

export class AnnictGraphQLError extends Error {
  readonly errors: unknown[];

  constructor(errors: unknown[]) {
    super(`Annict GraphQL API returned errors: ${JSON.stringify(errors)}`);
    this.name = "AnnictGraphQLError";
    this.errors = errors;
  }
}
