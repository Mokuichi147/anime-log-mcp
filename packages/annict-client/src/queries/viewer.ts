import type { Viewer } from "../types.js";

export const VIEWER_QUERY = /* GraphQL */ `
  query Viewer {
    viewer {
      id
      annictId
      username
      name
      avatarUrl
      watchingCount
      watchedCount
      wannaWatchCount
      onHoldCount
      stopWatchingCount
      recordsCount
    }
  }
`;

export interface ViewerQueryData {
  viewer: Viewer | null;
}
