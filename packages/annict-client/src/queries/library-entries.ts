import type { LibraryEntry, RawConnection } from "../types.js";

export const LIBRARY_ENTRIES_QUERY = /* GraphQL */ `
  query LibraryEntries($states: [StatusState!], $first: Int, $after: String) {
    viewer {
      libraryEntries(states: $states, first: $first, after: $after) {
        edges {
          node {
            id
            note
            status {
              state
            }
            work {
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
            nextEpisode {
              id
              annictId
              number
              numberText
              title
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
  }
`;

export interface LibraryEntriesQueryData {
  viewer: {
    libraryEntries: RawConnection<LibraryEntry>;
  } | null;
}
