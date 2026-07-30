import type { Character, RawConnection } from "../types.js";

export const SEARCH_CHARACTERS_QUERY = /* GraphQL */ `
  query SearchCharacters($names: [String!], $annictIds: [Int!], $first: Int, $after: String) {
    searchCharacters(names: $names, annictIds: $annictIds, first: $first, after: $after) {
      edges {
        node {
          id
          annictId
          name
          nameEn
          nameKana
          nickname
          description
          series {
            id
            annictId
            name
          }
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

export interface SearchCharactersQueryData {
  searchCharacters: RawConnection<Character>;
}
