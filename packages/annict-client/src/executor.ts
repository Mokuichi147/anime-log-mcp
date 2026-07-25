import { AnnictApiError, AnnictGraphQLError } from "./errors.js";

interface GraphQLResponse<TData> {
  data?: TData;
  errors?: unknown[];
}

export async function execute<TData>(
  endpoint: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<TData> {
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Annict's API expects a lowercase "bearer" scheme.
      Authorization: `bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });

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
