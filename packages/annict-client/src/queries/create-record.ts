import type { AnnictRecord } from "../types.js";

export const CREATE_RECORD_MUTATION = /* GraphQL */ `
  mutation CreateRecord($episodeId: ID!, $comment: String) {
    createRecord(input: { episodeId: $episodeId, comment: $comment }) {
      record {
        id
        annictId
        comment
        ratingState
        createdAt
        episode {
          id
          annictId
          number
          numberText
          title
        }
        work {
          id
          annictId
          title
        }
      }
    }
  }
`;

export interface CreateRecordMutationData {
  createRecord: {
    record: AnnictRecord | null;
  };
}
