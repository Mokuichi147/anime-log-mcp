import { execute } from "./executor.js";
import { SEARCH_CHARACTERS_QUERY, type SearchCharactersQueryData } from "./queries/characters.js";
import { CREATE_RECORD_MUTATION, type CreateRecordMutationData } from "./queries/create-record.js";
import { WORK_EPISODES_QUERY, type WorkEpisodesQueryData } from "./queries/episodes.js";
import { LIBRARY_ENTRIES_QUERY, type LibraryEntriesQueryData } from "./queries/library-entries.js";
import { SEARCH_ORGANIZATIONS_QUERY, type SearchOrganizationsQueryData } from "./queries/organizations.js";
import { SEARCH_PEOPLE_QUERY, type SearchPeopleQueryData } from "./queries/people.js";
import { UPDATE_STATUS_MUTATION, type UpdateStatusMutationData } from "./queries/update-status.js";
import { USER_QUERY, type UserQueryData } from "./queries/user.js";
import { VIEWER_QUERY, type ViewerQueryData } from "./queries/viewer.js";
import { SEARCH_WORKS_QUERY, type SearchWorksQueryData } from "./queries/works.js";
import type {
  AnnictRecord,
  Character,
  Connection,
  Episode,
  LibraryEntry,
  Organization,
  Person,
  RawConnection,
  StatusState,
  Viewer,
  Work,
} from "./types.js";

const DEFAULT_ENDPOINT = "https://api.annict.com/graphql";

export interface AnnictClientOptions {
  accessToken: string;
  /** Defaults to the official Annict GraphQL endpoint. */
  endpoint?: string;
  /** Defaults to `globalThis.fetch`. Override for testing or non-standard runtimes. */
  fetch?: typeof fetch;
}

function toConnection<T>(raw: RawConnection<T>): Connection<T> {
  return {
    nodes: raw.edges.map((edge) => edge.node),
    pageInfo: raw.pageInfo,
  };
}

export class AnnictClient {
  private readonly endpoint: string;
  private readonly accessToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnnictClientOptions) {
    this.accessToken = options.accessToken;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private request<TData>(query: string, variables: Record<string, unknown>): Promise<TData> {
    return execute<TData>(this.endpoint, this.accessToken, query, variables, this.fetchImpl);
  }

  async getViewer(): Promise<Viewer> {
    const data = await this.request<ViewerQueryData>(VIEWER_QUERY, {});
    if (!data.viewer) {
      throw new Error("Annict API did not return a viewer for the given access token");
    }
    return data.viewer;
  }

  async getLibraryEntries(params: {
    states?: StatusState[];
    first?: number;
    after?: string;
  }): Promise<Connection<LibraryEntry>> {
    const data = await this.request<LibraryEntriesQueryData>(LIBRARY_ENTRIES_QUERY, {
      states: params.states,
      first: params.first,
      after: params.after,
    });
    if (!data.viewer) {
      throw new Error("Annict API did not return a viewer for the given access token");
    }
    return toConnection(data.viewer.libraryEntries);
  }

  async searchWorks(params: {
    titles?: string[];
    seasons?: string[];
    first?: number;
    after?: string;
  }): Promise<Connection<Work>> {
    const data = await this.request<SearchWorksQueryData>(SEARCH_WORKS_QUERY, {
      titles: params.titles,
      seasons: params.seasons,
      first: params.first,
      after: params.after,
    });
    return toConnection(data.searchWorks);
  }

  async getUser(username: string): Promise<Viewer | null> {
    const data = await this.request<UserQueryData>(USER_QUERY, { username });
    return data.user;
  }

  async searchCharacters(params: {
    names?: string[];
    annictIds?: number[];
    first?: number;
    after?: string;
  }): Promise<Connection<Character>> {
    const data = await this.request<SearchCharactersQueryData>(SEARCH_CHARACTERS_QUERY, {
      names: params.names,
      annictIds: params.annictIds,
      first: params.first,
      after: params.after,
    });
    return toConnection(data.searchCharacters);
  }

  async searchPeople(params: {
    names?: string[];
    annictIds?: number[];
    first?: number;
    after?: string;
  }): Promise<Connection<Person>> {
    const data = await this.request<SearchPeopleQueryData>(SEARCH_PEOPLE_QUERY, {
      names: params.names,
      annictIds: params.annictIds,
      first: params.first,
      after: params.after,
    });
    return toConnection(data.searchPeople);
  }

  async searchOrganizations(params: {
    names?: string[];
    annictIds?: number[];
    first?: number;
    after?: string;
  }): Promise<Connection<Organization>> {
    const data = await this.request<SearchOrganizationsQueryData>(SEARCH_ORGANIZATIONS_QUERY, {
      names: params.names,
      annictIds: params.annictIds,
      first: params.first,
      after: params.after,
    });
    return toConnection(data.searchOrganizations);
  }

  async getWork(annictId: number): Promise<Work | null> {
    const data = await this.request<SearchWorksQueryData>(SEARCH_WORKS_QUERY, {
      annictIds: [annictId],
      first: 1,
    });
    return data.searchWorks.edges[0]?.node ?? null;
  }

  async getEpisodes(params: {
    workAnnictId: number;
    first?: number;
    after?: string;
  }): Promise<Connection<Episode>> {
    const data = await this.request<WorkEpisodesQueryData>(WORK_EPISODES_QUERY, {
      annictIds: [params.workAnnictId],
      first: params.first,
      after: params.after,
    });
    const work = data.searchWorks.edges[0]?.node;
    if (!work) {
      throw new Error(`No work found with annictId ${params.workAnnictId}`);
    }
    return toConnection(work.episodes);
  }

  async createRecord(params: { episodeId: string; comment?: string }): Promise<AnnictRecord> {
    const data = await this.request<CreateRecordMutationData>(CREATE_RECORD_MUTATION, {
      episodeId: params.episodeId,
      comment: params.comment,
    });
    if (!data.createRecord.record) {
      throw new Error("createRecord mutation did not return a record");
    }
    return data.createRecord.record;
  }

  async updateStatus(params: { workId: string; state: StatusState }): Promise<{ state: StatusState }> {
    const data = await this.request<UpdateStatusMutationData>(UPDATE_STATUS_MUTATION, {
      workId: params.workId,
      state: params.state,
    });
    const state = data.updateStatus.work?.viewerStatusState;
    if (!state) {
      throw new Error("updateStatus mutation did not return the updated state");
    }
    return { state };
  }
}
