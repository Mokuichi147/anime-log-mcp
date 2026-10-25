import type { Person, RawConnection } from "../types.js";

export const SEARCH_PEOPLE_QUERY = /* GraphQL */ `
  query SearchPeople($names: [String!], $annictIds: [Int!], $first: Int, $after: String) {
    searchPeople(names: $names, annictIds: $annictIds, first: $first, after: $after) {
      edges {
        node {
          id
          annictId
          name
          nameEn
          nameKana
          nickname
          birthday
          bloodType
          genderText
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

export interface SearchPeopleQueryData {
  searchPeople: RawConnection<Person>;
}
