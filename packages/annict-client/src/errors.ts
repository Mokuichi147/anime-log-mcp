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

export class AnnictGraphQLError extends Error {
  readonly errors: unknown[];

  constructor(errors: unknown[]) {
    super(`Annict GraphQL API returned errors: ${JSON.stringify(errors)}`);
    this.name = "AnnictGraphQLError";
    this.errors = errors;
  }
}
