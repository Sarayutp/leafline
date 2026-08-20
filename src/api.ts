import type {
  Article,
  ArticleContent,
  ArticlePage,
  ArticleReadFilter,
  Feed,
  FeedResponse,
  RefreshResult,
  SetupResponse,
  SetupStatus,
} from "./types";

const API_URL_KEY = "leafline.apiUrl";
const TOKEN_KEY = "leafline.syncToken";

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

class LeaflineApi {
  get apiUrl(): string {
    const configured = import.meta.env.VITE_API_URL as string | undefined;
    return normalizeBaseUrl(localStorage.getItem(API_URL_KEY) || configured || "");
  }

  get token(): string {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  configure(apiUrl: string, token?: string): void {
    localStorage.setItem(API_URL_KEY, normalizeBaseUrl(apiUrl));
    if (token) localStorage.setItem(TOKEN_KEY, token.trim());
  }

  disconnect(): void {
    localStorage.removeItem(TOKEN_KEY);
  }

  pairingLink(): string {
    const url = new URL(window.location.href);
    url.hash = "";
    url.search = "";
    return `${url.toString()}#pair=${encodeURIComponent(this.token)}&api=${encodeURIComponent(this.apiUrl)}`;
  }

  consumePairingLink(): boolean {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = params.get("pair");
    const apiUrl = params.get("api");
    if (!token || !apiUrl) return false;
    this.configure(apiUrl, token);
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return true;
  }

  private async request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
    if (!this.apiUrl) throw new ApiError("ยังไม่ได้ระบุ URL ของ Cloudflare Worker", 0);

    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    if (authenticated && this.token) headers.set("Authorization", `Bearer ${this.token}`);

    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}${path}`, { ...init, headers });
    } catch {
      throw new ApiError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบ Worker URL และอินเทอร์เน็ต", 0);
    }

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      throw new ApiError(payload.error || `เกิดข้อผิดพลาด (${response.status})`, response.status);
    }
    return payload as T;
  }

  status(): Promise<SetupStatus> {
    return this.request<SetupStatus>("/api/setup/status", {}, false);
  }

  async setup(setupSecret: string): Promise<string> {
    const result = await this.request<SetupResponse>(
      "/api/setup",
      { method: "POST", body: JSON.stringify({ setupSecret }) },
      false,
    );
    localStorage.setItem(TOKEN_KEY, result.token);
    return result.token;
  }

  verify(): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>("/api/auth/verify");
  }

  async rotateToken(): Promise<string> {
    const result = await this.request<SetupResponse>("/api/auth/rotate", { method: "POST" });
    localStorage.setItem(TOKEN_KEY, result.token);
    return result.token;
  }

  async feeds(): Promise<Feed[]> {
    const result = await this.request<{ feeds: Feed[] }>("/api/feeds");
    return result.feeds;
  }

  async articles(): Promise<Article[]> {
    const result = await this.articlePage({ limit: 500 });
    return result.articles;
  }

  articlePage(options: {
    limit?: number;
    feedId?: string;
    category?: string;
    read?: ArticleReadFilter;
    starred?: boolean;
    cursor?: string | null;
  } = {}): Promise<ArticlePage> {
    const params = new URLSearchParams();
    params.set("limit", String(options.limit || 50));
    if (options.feedId) params.set("feedId", options.feedId);
    if (options.category) params.set("category", options.category);
    if (options.read && options.read !== "all") params.set("read", options.read);
    if (options.starred) params.set("starred", "true");
    if (options.cursor) params.set("cursor", options.cursor);
    return this.request<ArticlePage>(`/api/articles?${params.toString()}`);
  }

  articleContent(articleId: string): Promise<ArticleContent> {
    return this.request<ArticleContent>(`/api/articles/${encodeURIComponent(articleId)}/content`);
  }

  addFeed(url: string, category: string): Promise<FeedResponse> {
    return this.request<FeedResponse>("/api/feeds", {
      method: "POST",
      body: JSON.stringify({ url, category }),
    });
  }

  deleteFeed(feedId: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/api/feeds/${encodeURIComponent(feedId)}`, { method: "DELETE" });
  }

  updateState(articleId: string, patch: { isRead?: boolean; isStarred?: boolean }): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/api/articles/${encodeURIComponent(articleId)}/state`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  bulkRead(articleIds: string[]): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>("/api/articles/bulk-state", {
      method: "POST",
      body: JSON.stringify({ articleIds, isRead: true }),
    });
  }

  refreshFeeds(limit = 8): Promise<RefreshResult> {
    return this.request<RefreshResult>(`/api/feeds/refresh?limit=${limit}`, { method: "POST" });
  }

  refreshFeed(feedId: string): Promise<{ ok: boolean; imported: number }> {
    return this.request<{ ok: boolean; imported: number }>(`/api/feeds/${encodeURIComponent(feedId)}/refresh`, { method: "POST" });
  }

  backfillFeed(feedId: string, pages = 5): Promise<{ ok: boolean; imported: number; completedPages: number; errors: string[] }> {
    return this.request<{ ok: boolean; imported: number; completedPages: number; errors: string[] }>(
      `/api/feeds/${encodeURIComponent(feedId)}/backfill`,
      { method: "POST", body: JSON.stringify({ pages }) },
    );
  }
}

export const api = new LeaflineApi();
