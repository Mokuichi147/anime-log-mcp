import type { Organization, RawConnection } from "../types.js";

export const SEARCH_ORGANIZATIONS_QUERY = /* GraphQL */ `
  query SearchOrganizations($names: [String!], $annictIds: [Int!], $first: Int, $after: String) {
    searchOrganizations(names: $names, annictIds: $annictIds, first: $first, after: $after) {
      edges {
        node {
          id
          annictId
          name
          nameEn
          nameKana
          url
          wikipediaUrl
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

export interface SearchOrganizationsQueryData {
  searchOrganizations: RawConnection<Organization>;
}
