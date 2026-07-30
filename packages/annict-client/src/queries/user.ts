import type { Viewer } from "../types.js";

export const USER_QUERY = /* GraphQL */ `
  query GetUser($username: String!) {
    user(username: $username) {
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

export interface UserQueryData {
  user: Viewer | null;
}
