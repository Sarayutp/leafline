import type { Article, ArticleReadFilter, LibraryView } from "./types";

function articleSortTime(article: Article): number {
  return new Date(article.publishedAt || article.fetchedAt).getTime();
}

export function mergeArticles(current: Article[], incoming: Article[], maximum?: number): Article[] {
  const byId = new Map(current.map((article) => [article.id, article]));
  for (const article of incoming) byId.set(article.id, article);
  const merged = [...byId.values()].sort((left, right) => articleSortTime(right) - articleSortTime(left));
  return maximum ? merged.slice(0, maximum) : merged;
}

export function articleMatchesView(
  article: Article,
  view: LibraryView,
  readFilter: ArticleReadFilter,
  query: string,
  selectedId: string | null = null,
): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (view.kind === "today" && new Date(article.publishedAt || article.fetchedAt) < today) return false;
  if (view.kind === "starred" && !article.isStarred) return false;
  if (view.kind === "category" && article.feedCategory !== view.id) return false;
  if (view.kind === "feed" && article.feedId !== view.id) return false;
  if (readFilter === "unread" && article.isRead && article.id !== selectedId) return false;
  if (readFilter === "read" && !article.isRead && article.id !== selectedId) return false;
  const normalizedQuery = query.trim().toLocaleLowerCase("th");
  return !normalizedQuery || `${article.title} ${article.summary} ${article.feedTitle}`
    .toLocaleLowerCase("th")
    .includes(normalizedQuery);
}
