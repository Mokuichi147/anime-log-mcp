import { execute, type RateLimitPolicy } from "./executor.js";
import { CREATE_RECORD_MUTATION, type CreateRecordMutationData } from "./queries/create-record.js";
import { WORK_EPISODES_QUERY, type WorkEpisodesQueryData } from "./queries/episodes.js";
import { LIBRARY_ENTRIES_QUERY, type LibraryEntriesQueryData } from "./queries/library-entries.js";
import { UPDATE_STATUS_MUTATION, type UpdateStatusMutationData } from "./queries/update-status.js";
import { VIEWER_QUERY, type ViewerQueryData } from "./queries/viewer.js";
import { SEARCH_WORKS_QUERY, type SearchWorksQueryData } from "./queries/works.js";
import type {
  AnnictRecord,
  Connection,
  Episode,
  LibraryEntry,
  RawConnection,
  StatusState,
  Viewer,
  Work,
} from "./types.js";

const DEFAULT_ENDPOINT = "https://api.annict.com/graphql";

/** Short enough to keep a retried request well inside typical MCP tool-call timeouts. */
const DEFAULT_RATE_LIMIT_MAX_WAIT_SECONDS = 10;

export interface AnnictClientOptions {
  accessToken: string;
  /** Defaults to the official Annict GraphQL endpoint. */
  endpoint?: string;
  /** Defaults to `globalThis.fetch`. Override for testing or non-standard runtimes. */
  fetch?: typeof fetch;
  /**
   * When Annict answers 429 with a `Retry-After` of at most this many seconds,
   * the request is sent once more after waiting that long. Longer waits throw
   * `AnnictRateLimitError` immediately. 0 disables the retry. Defaults to 10.
   */
  rateLimitMaxWaitSeconds?: number;
  /** Defaults to a `setTimeout`-based sleep. Override for testing. */
  sleep?: (ms: number) => Promise<void>;
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
  private readonly rateLimit: RateLimitPolicy;

  constructor(options: AnnictClientOptions) {
    this.accessToken = options.accessToken;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.rateLimit = {
      maxWaitSeconds: options.rateLimitMaxWaitSeconds ?? DEFAULT_RATE_LIMIT_MAX_WAIT_SECONDS,
      sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    };
  }

  private request<TData>(query: string, variables: Record<string, unknown>): Promise<TData> {
    return execute<TData>(this.endpoint, this.accessToken, query, variables, this.fetchImpl, this.rateLimit);
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
