import type { Episode, RawConnection } from "../types.js";

export const WORK_EPISODES_QUERY = /* GraphQL */ `
  query WorkEpisodes($annictIds: [Int!]!, $first: Int, $after: String) {
    searchWorks(annictIds: $annictIds, first: 1) {
      edges {
        node {
          episodes(first: $first, after: $after) {
            edges {
              node {
                id
                annictId
                number
                numberText
                title
                recordsCount
                viewerDidTrack
                viewerRecordsCount
                satisfactionRate
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
    }
  }
`;

export interface WorkEpisodesQueryData {
  searchWorks: {
    edges: Array<{
      node: {
        episodes: RawConnection<Episode>;
      };
    }>;
  };
}
