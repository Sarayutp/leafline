export interface Feed {
  id: string;
  url: string;
  title: string;
  siteUrl: string | null;
  category: string;
  iconUrl: string | null;
  enabled: boolean;
  lastFetchedAt: string | null;
  lastError: string | null;
  unreadCount: number;
}

export interface Article {
  id: string;
  feedId: string;
  feedTitle: string;
  feedCategory: string;
  url: string;
  title: string;
  summary: string;
  author: string | null;
  imageUrl: string | null;
  hasContent: boolean;
  publishedAt: string | null;
  fetchedAt: string;
  isRead: boolean;
  isStarred: boolean;
  stateUpdatedAt: string | null;
}

export interface ArticleContent {
  contentHtml: string | null;
  contentSource: string | null;
  imageUrl: string | null;
  fetchedAt: string | null;
}

export type LibraryView =
  | { kind: "inbox"; label: string }
  | { kind: "today"; label: string }
  | { kind: "starred"; label: string }
  | { kind: "category"; id: string; label: string }
  | { kind: "feed"; id: string; label: string };

export interface SetupStatus {
  initialized: boolean;
}

export interface SetupResponse {
  token: string;
}

export interface FeedResponse {
  feed: Feed;
  importedArticles: number;
}
