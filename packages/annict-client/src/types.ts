export type StatusState =
  | "NO_STATE"
  | "WANNA_WATCH"
  | "WATCHING"
  | "WATCHED"
  | "ON_HOLD"
  | "STOP_WATCHING";

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

export interface Connection<T> {
  nodes: T[];
  pageInfo: PageInfo;
}

/** @internal raw edges/node shape as returned by the Annict GraphQL API */
export interface RawConnection<T> {
  edges: Array<{ node: T }>;
  pageInfo: PageInfo;
}

export interface Viewer {
  id: string;
  annictId: number;
  username: string;
  name: string;
  avatarUrl: string | null;
  watchingCount: number;
  watchedCount: number;
  wannaWatchCount: number;
  onHoldCount: number;
  stopWatchingCount: number;
  recordsCount: number;
}

export interface Work {
  id: string;
  annictId: number;
  title: string;
  titleEn: string | null;
  titleKana: string | null;
  media: string;
  seasonName: string | null;
  seasonYear: number | null;
  episodesCount: number;
  reviewsCount: number;
  satisfactionRate: number | null;
  watchersCount: number;
  viewerStatusState: StatusState | null;
  malAnimeId: string | null;
  officialSiteUrl: string | null;
  wikipediaUrl: string | null;
}

export interface EpisodeSummary {
  id: string;
  annictId: number;
  number: number | null;
  numberText: string | null;
  title: string | null;
}

export interface Episode extends EpisodeSummary {
  recordsCount: number;
  viewerDidTrack: boolean;
  viewerRecordsCount: number;
  satisfactionRate: number | null;
}

export interface WorkSummary {
  id: string;
  annictId: number;
  title: string;
}

export interface LibraryEntry {
  id: string;
  note: string;
  status: { state: StatusState } | null;
  work: Work;
  nextEpisode: EpisodeSummary | null;
}

export interface AnnictRecord {
  id: string;
  annictId: number;
  comment: string | null;
  ratingState: string | null;
  createdAt: string;
  episode: EpisodeSummary;
  work: WorkSummary;
}
