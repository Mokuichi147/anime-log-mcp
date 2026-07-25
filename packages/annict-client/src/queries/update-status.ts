import type { StatusState } from "../types.js";

export const UPDATE_STATUS_MUTATION = /* GraphQL */ `
  mutation UpdateStatus($workId: ID!, $state: StatusState!) {
    updateStatus(input: { workId: $workId, state: $state }) {
      work {
        id
        annictId
        title
        viewerStatusState
      }
    }
  }
`;

export interface UpdateStatusMutationData {
  updateStatus: {
    work: {
      id: string;
      annictId: number;
      title: string;
      viewerStatusState: StatusState | null;
    } | null;
  };
}
