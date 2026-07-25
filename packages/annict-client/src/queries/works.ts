import type { RawConnection, Work } from "../types.js";

export const SEARCH_WORKS_QUERY = /* GraphQL */ `
  query SearchWorks(
    $titles: [String!]
    $seasons: [String!]
    $annictIds: [Int!]
    $first: Int
    $after: String
  ) {
    searchWorks(
      titles: $titles
      seasons: $seasons
      annictIds: $annictIds
      first: $first
      after: $after
    ) {
      edges {
        node {
          id
          annictId
          title
          titleEn
          titleKana
          media
          seasonName
          seasonYear
          episodesCount
          reviewsCount
          satisfactionRate
          watchersCount
          viewerStatusState
          malAnimeId
          officialSiteUrl
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

export interface SearchWorksQueryData {
  searchWorks: RawConnection<Work>;
}
